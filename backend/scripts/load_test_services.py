from __future__ import annotations

import argparse
import json
import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


DEFAULT_FRONTEND_URL = "http://127.0.0.1:8080"
DEFAULT_API_URL = "http://127.0.0.1:8080/api"


@dataclass
class RequestResult:
    ok: bool
    status: int | None
    latency_ms: float
    response_bytes: int
    error: str | None = None
    observed_latency_ms: float = 0.0


@dataclass
class RequestStats:
    # Quantiles use conservative upper bounds of 1%-wide logarithmic buckets.
    # Storage depends on the latency range, not the number of requests.
    count: int = 0
    errors: int = 0
    response_bytes: int = 0
    total_latency_ms: float = 0.0
    wall_bins: dict[int, int] = field(default_factory=dict)
    observed_bins: dict[int, int] = field(default_factory=dict)
    statuses: dict[str, int] = field(default_factory=dict)
    sample_errors: set[str] = field(default_factory=set)

    def record(self, result: RequestResult) -> None:
        self.count += 1
        self.errors += not result.ok
        self.response_bytes += result.response_bytes
        self.total_latency_ms += result.latency_ms
        for bins, latency in ((self.wall_bins, result.latency_ms), (self.observed_bins, result.observed_latency_ms)):
            bucket = math.ceil(math.log(max(latency, 0.001), 1.01))
            bins[bucket] = bins.get(bucket, 0) + 1
        status = str(result.status) if result.status is not None else "transport_error"
        self.statuses[status] = self.statuses.get(status, 0) + 1
        if result.error and len(self.sample_errors) < 3:
            self.sample_errors.add(result.error[:200])

    def quantile(self, fraction: float, *, observed: bool = False) -> float:
        if not self.count:
            return math.nan
        rank = math.ceil(self.count * fraction)
        seen = 0
        for bucket, count in sorted((self.observed_bins if observed else self.wall_bins).items()):
            seen += count
            if seen >= rank:
                return 1.01 ** bucket
        return math.nan

    def report(self, duration: float, p95_ms: float, p99_ms: float, max_error_rate: float) -> dict:
        error_rate = self.errors / self.count if self.count else 1.0
        p95, p99 = self.quantile(0.95), self.quantile(0.99)
        return {
            "requests": self.count, "errors": self.errors, "error_rate": error_rate,
            "mean_wall_ms": self.total_latency_ms / self.count if self.count else None,
            "p95_wall_ms": p95 if self.count else None, "p99_wall_ms": p99 if self.count else None,
            "p95_observed_ms": self.quantile(0.95, observed=True) if self.count else None,
            "p99_observed_ms": self.quantile(0.99, observed=True) if self.count else None,
            "requests_per_second": self.count / max(duration, 0.0001),
            "response_bytes": self.response_bytes, "status_counts": self.statuses,
            "sample_errors": sorted(self.sample_errors),
            "passed": self.count > 0 and error_rate < max_error_rate and p95 < p95_ms and p99 < p99_ms,
        }


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[max(math.ceil(len(ordered) * fraction) - 1, 0)]


def fetch(url: str, headers: dict[str, str], timeout: float, *, expect_json: bool = False, network_rtt_ms: float = 0) -> RequestResult:
    request = Request(url, headers=headers)
    started_at = time.perf_counter()
    if network_rtt_ms:
        time.sleep(network_rtt_ms / 1000)
    observed_at = time.perf_counter()
    body, status, error = b"", None, None
    try:
        with urlopen(request, timeout=timeout) as response:
            status = response.status
            body = response.read()
        ok = 200 <= status < 300
        if expect_json and ok:
            try:
                json.loads(body)
            except (ValueError, UnicodeDecodeError):
                ok, error = False, "Invalid JSON response"
    except HTTPError as exc:
        status, ok, error = exc.code, False, f"HTTP {exc.code}"
        try:
            body = exc.read()
        finally:
            exc.close()
    except Exception as exc:
        ok, error = False, str(getattr(exc, "reason", exc))
    ended_at = time.perf_counter()
    return RequestResult(ok, status, (ended_at - started_at) * 1000, len(body), error, (ended_at - observed_at) * 1000)


def exercise_target(name: str, url: str, headers: dict[str, str], *, requests: int, concurrency: int, timeout: float) -> dict:
    # This burst is endpoint diagnostics, not a user-capacity benchmark.
    for _ in range(min(5, requests)):
        fetch(url, headers, timeout)
    stats = RequestStats()
    started_at = time.perf_counter()
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        # map consumes bounded batches instead of queuing an unbounded request list.
        for offset in range(0, requests, concurrency):
            for result in executor.map(lambda _: fetch(url, headers, timeout, expect_json=name.startswith("api_")), range(min(concurrency, requests - offset))):
                stats.record(result)
    duration = time.perf_counter() - started_at
    report = stats.report(duration, math.inf, math.inf, 1.0)
    print(f"{name}: {requests} requests, {concurrency} request workers, p95={report['p95_wall_ms']:.2f}ms p99={report['p99_wall_ms']:.2f}ms errors={report['error_rate']:.2%}, {report['requests_per_second']:.2f} req/s")
    return report


def mixed_targets(args, session_id: int | None) -> list[tuple[str, str, bool]]:
    api_url = args.api_url.rstrip("/")
    targets = []
    if args.frontend_url:
        targets.append(("frontend_root", args.frontend_url.rstrip("/"), False))
    targets.extend([
        ("bootstrap_shell", f"{api_url}/bootstrap-shell?limit=25", True),
        ("bootstrap", f"{api_url}/bootstrap?limit=25", True),
        ("datasets", f"{api_url}/datasets", True),
        ("backtests_summaries", f"{api_url}/backtests/summaries?limit={args.summaries_limit}", True),
        ("trades_page", f"{api_url}/trades/page?limit=100", True),
    ])
    if not args.no_analytics:
        targets.extend([(name, f"{api_url}/metrics/{path}", True) for name, path in (("metrics_summary", "summary"), ("metrics_curves", "curves"))])
    if not args.no_market_data:
        session_query = {"session_id": session_id} if session_id is not None else {}
        meta_query = "?" + urlencode(session_query) if session_query else ""
        targets.extend([
            ("market_data_meta", f"{api_url}/market-data/meta{meta_query}", True),
            ("market_data_bars", f"{api_url}/market-data/bars?{urlencode({**session_query, 'limit': args.bars_limit})}", True),
        ])
    return targets


def benchmark_identities(args) -> list[tuple[str, int | None]]:
    if args.benchmark_users_file:
        rows = json.loads(Path(args.benchmark_users_file).read_text())["auth_tokens"]
        user_ids = [row["user_id"] for row in rows]
        if len(set(user_ids)) != len(user_ids):
            raise ValueError("Benchmark manifest contains duplicate users")
        identities = [(str(row["token"]), row.get("latest_backtest_session_id")) for row in rows]
    else:
        tokens = [item.strip() for item in (args.auth_tokens or args.auth_token).split(",") if item.strip()]
        session_ids = [int(item.strip()) for item in args.session_ids.split(",") if item.strip()]
        if session_ids and len(session_ids) != len(tokens):
            raise ValueError("Session IDs must align one-to-one with tokens in the same order")
        identities = [(token, session_ids[index] if session_ids else args.session_id) for index, token in enumerate(tokens)]
    if any(not token for token, _ in identities) or len({token for token, _ in identities}) != len(identities):
        raise ValueError("Supply distinct, nonempty user tokens")
    if len(identities) < args.concurrency:
        raise ValueError("Mixed workload requires at least one distinct user credential per concurrent worker")
    return identities[:args.concurrency]


def exercise_mixed(args) -> dict:
    identities = benchmark_identities(args)
    lock = threading.Lock()
    total = RequestStats()
    endpoints: dict[str, RequestStats] = {}
    worker_counts = [0] * args.concurrency
    completed_iterations = [0] * args.concurrency
    timeline = {}

    def begin() -> None:
        timeline["started"] = time.perf_counter()
        timeline["cpu_started"] = time.process_time()

    barrier = threading.Barrier(args.concurrency + 1, action=begin)

    def worker(index: int) -> None:
        token, session_id = identities[index]
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
        targets = mixed_targets(args, session_id)
        barrier.wait(timeout=30)
        deadline = timeline["started"] + args.duration_seconds
        while time.perf_counter() < deadline:
            for name, url, expect_json in targets:
                if time.perf_counter() >= deadline:
                    return
                request_headers = headers if expect_json else {}
                result = fetch(url, request_headers, args.timeout, expect_json=expect_json, network_rtt_ms=args.network_rtt_ms)
                with lock:
                    total.record(result)
                    endpoints.setdefault(name, RequestStats()).record(result)
                    worker_counts[index] += 1
            completed_iterations[index] += 1
            remaining = deadline - time.perf_counter()
            if args.think_time and remaining > 0:
                time.sleep(min(args.think_time, remaining))

    worker_errors = []
    with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        futures = [executor.submit(worker, index) for index in range(args.concurrency)]
        barrier.wait(timeout=30)
        for future in futures:
            try:
                future.result()
            except Exception as exc:
                worker_errors.append(f"{type(exc).__name__}: {exc}")
    measured_seconds = time.perf_counter() - timeline["started"]
    generator_cpu_seconds = time.process_time() - timeline["cpu_started"]
    limits = (args.p95_ms, args.p99_ms, args.max_error_rate)
    aggregate = total.report(measured_seconds, *limits)
    endpoint_reports = {name: stats.report(measured_seconds, *limits) for name, stats in sorted(endpoints.items())}
    missing_endpoints = sorted({name for name, _, _ in mixed_targets(args, identities[0][1])} - endpoints.keys())
    active_workers = sum(count > 0 for count in worker_counts)
    passed = (aggregate["passed"] and all(report["passed"] for report in endpoint_reports.values())
        and not missing_endpoints and not worker_errors and active_workers == args.concurrency and all(completed_iterations))
    return {
        "workload": "mixed sequential read stress loop", "passed": passed,
        "concurrent_credential_slots": args.concurrency, "active_workers": active_workers,
        "sustained_capacity_test": args.duration_seconds >= 30 and passed,
        "distinct_manifest_users": args.concurrency if args.benchmark_users_file else None,
        "registered_user_capacity": None,
        "configured_hold_seconds": args.duration_seconds, "measured_seconds_including_drain": measured_seconds,
        "completed_iterations": sum(completed_iterations), "worker_request_counts": worker_counts,
        "think_time_seconds": args.think_time, "modeled_extra_rtt_ms_per_request": args.network_rtt_ms,
        "latency_method": "Client wall including body read, observed network/server time and configured modeled RTT; quantiles are conservative 1%-wide histogram upper bounds. Actual network RTT is not isolated.",
        "connection_model": "urllib request connections; browser connection reuse and HTTP/2 multiplexing are not modeled",
        "requests_per_second_per_active_user": aggregate["requests_per_second"] / max(active_workers, 1),
        "response_bytes_per_second": total.response_bytes / max(measured_seconds, 0.0001),
        "generator_cpu_seconds": generator_cpu_seconds,
        "generator_cpu_core_fraction": generator_cpu_seconds / max(measured_seconds, 0.0001),
        "generator_headroom_verified": False,
        "generator_limit_note": "Run the generator separately and monitor its CPU/network. A low process CPU fraction alone does not prove headroom; server and generator sharing a host confounds capacity.",
        "worker_errors": worker_errors, "missing_endpoints": missing_endpoints,
        "slo": {"p95_ms": args.p95_ms, "p99_ms": args.p99_ms, "max_error_rate": args.max_error_rate},
        "aggregate": aggregate, "endpoints": endpoint_reports,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Endpoint diagnostics or distinct-user, duration-based EdgeLab read capacity testing.")
    parser.add_argument("--frontend-url", default=DEFAULT_FRONTEND_URL)
    parser.add_argument("--api-url", default=DEFAULT_API_URL)
    parser.add_argument("--auth-token", default="")
    parser.add_argument("--auth-tokens", default="")
    parser.add_argument("--session-ids", default="")
    parser.add_argument("--benchmark-users-file", help="Seed script JSON; avoids credentials in command arguments")
    parser.add_argument("--workload", choices=("endpoints", "mixed"), default="endpoints")
    parser.add_argument("--requests", type=int, default=200)
    parser.add_argument("--concurrency", type=int, default=20)
    parser.add_argument("--timeout", type=float, default=5.0)
    parser.add_argument("--duration-seconds", type=float, default=120)
    parser.add_argument("--think-time", type=float, default=1)
    parser.add_argument("--network-rtt-ms", type=float, default=0, help="Modeled fixed extra delay per request, not measured network RTT")
    parser.add_argument("--p95-ms", type=float, default=750)
    parser.add_argument("--p99-ms", type=float, default=1500)
    parser.add_argument("--max-error-rate", type=float, default=0.01)
    parser.add_argument("--json-output")
    parser.add_argument("--no-analytics", action="store_true")
    parser.add_argument("--no-market-data", action="store_true")
    parser.add_argument("--summaries-limit", type=int, default=50)
    parser.add_argument("--bars-limit", type=int, default=300)
    parser.add_argument("--session-id", type=int)
    args = parser.parse_args()
    for name in ("requests", "concurrency", "timeout", "duration_seconds", "p95_ms", "p99_ms", "summaries_limit", "bars_limit"):
        value = getattr(args, name)
        if not math.isfinite(value) or value <= 0:
            parser.error(f"--{name.replace('_', '-')} must be finite and positive")
    if any(not math.isfinite(value) or value < 0 for value in (args.think_time, args.network_rtt_ms)):
        parser.error("Think time and modeled RTT must be finite and nonnegative")
    if not math.isfinite(args.max_error_rate) or not 0 < args.max_error_rate <= 1:
        parser.error("--max-error-rate must be in (0, 1]")
    if args.workload == "mixed":
        if not args.api_url:
            parser.error("Mixed workload requires --api-url")
        try:
            report = exercise_mixed(args)
        except (ValueError, KeyError, OSError) as exc:
            parser.error(str(exc))
        payload = json.dumps(report, indent=2, allow_nan=False)
        if args.json_output:
            Path(args.json_output).write_text(payload + "\n")
        print(payload)
        raise SystemExit(0 if report["passed"] else 1)

    frontend_url, api_url = args.frontend_url.rstrip("/"), args.api_url.rstrip("/")
    targets = []
    if frontend_url:
        targets.append(("frontend_root", frontend_url, {}))
    if api_url:
        targets.extend((name, f"{api_url}/{path}", {}) for name, path in (("api_health", "health"), ("api_ready", "ready")))
        if args.auth_token:
            targets.extend((f"api_{name}", url, {"Authorization": f"Bearer {args.auth_token}"}) for name, url, _ in mixed_targets(args, args.session_id) if name != "frontend_root")
    if not targets:
        parser.error("No targets configured")
    reports = {name: exercise_target(name, url, headers, requests=args.requests, concurrency=args.concurrency, timeout=args.timeout) for name, url, headers in targets}
    if args.json_output:
        Path(args.json_output).write_text(json.dumps({"workload": "endpoint request-worker diagnostics", "endpoints": reports}, indent=2) + "\n")
    if any(report["errors"] for report in reports.values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
