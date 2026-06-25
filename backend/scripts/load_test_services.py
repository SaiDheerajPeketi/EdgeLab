from __future__ import annotations

import argparse
import statistics
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
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


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(int(len(ordered) * fraction) - 1, 0)
    return ordered[index]


def fetch(url: str, headers: dict[str, str], timeout: float) -> RequestResult:
    request = Request(url, headers=headers)
    started_at = time.perf_counter()
    try:
        with urlopen(request, timeout=timeout) as response:
            body = response.read()
        return RequestResult(
            ok=200 <= response.status < 400,
            status=response.status,
            latency_ms=(time.perf_counter() - started_at) * 1000,
            response_bytes=len(body),
        )
    except HTTPError as exc:
        return RequestResult(
            ok=False,
            status=exc.code,
            latency_ms=(time.perf_counter() - started_at) * 1000,
            response_bytes=0,
            error=f"HTTP {exc.code}",
        )
    except URLError as exc:
        return RequestResult(
            ok=False,
            status=None,
            latency_ms=(time.perf_counter() - started_at) * 1000,
            response_bytes=0,
            error=str(exc.reason),
        )
    except Exception as exc:
        return RequestResult(
            ok=False,
            status=None,
            latency_ms=(time.perf_counter() - started_at) * 1000,
            response_bytes=0,
            error=str(exc),
        )


def exercise_target(
    name: str,
    url: str,
    headers: dict[str, str],
    *,
    requests: int,
    concurrency: int,
    timeout: float,
) -> None:
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        for _ in range(min(5, requests)):
            fetch(url, headers, timeout)

        started_at = time.perf_counter()
        futures = [
            executor.submit(fetch, url, headers, timeout)
            for _ in range(requests)
        ]
        results = [future.result() for future in futures]
        duration_seconds = time.perf_counter() - started_at

    latencies = [result.latency_ms for result in results]
    failures = [result for result in results if not result.ok]
    bytes_total = sum(result.response_bytes for result in results)

    print(name)
    print(f"  URL: {url}")
    print(f"  Requests: {requests}")
    print(f"  Concurrency: {concurrency}")
    print(f"  Mean latency: {statistics.mean(latencies):.2f} ms")
    print(f"  P95 latency:  {percentile(latencies, 0.95):.2f} ms")
    print(f"  Error rate:   {len(failures) / max(len(results), 1):.2%}")
    print(f"  Throughput:   {requests / max(duration_seconds, 0.0001):.2f} req/s")
    print(f"  Bytes read:   {bytes_total}")
    if failures:
        sample_errors = ", ".join(
            sorted({failure.error or str(failure.status) for failure in failures})[:3]
        )
        print(f"  Sample errors: {sample_errors}")
    print()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Load-test the EdgeLab frontend/API entrypoints in single-VM or split-service deployments."
    )
    parser.add_argument("--frontend-url", default=DEFAULT_FRONTEND_URL)
    parser.add_argument("--api-url", default=DEFAULT_API_URL)
    parser.add_argument("--auth-token", default="")
    parser.add_argument("--requests", type=int, default=200)
    parser.add_argument("--concurrency", type=int, default=20)
    parser.add_argument("--timeout", type=float, default=5.0)
    parser.add_argument("--summaries-limit", type=int, default=50)
    args = parser.parse_args()

    frontend_url = args.frontend_url.rstrip("/")
    api_url = args.api_url.rstrip("/")

    targets: list[tuple[str, str, dict[str, str]]] = []
    if frontend_url:
        targets.append(("frontend_root", frontend_url or "/", {}))
    if api_url:
        targets.extend(
            [
                ("api_health", f"{api_url}/health", {}),
                ("api_ready", f"{api_url}/ready", {}),
            ]
        )
        if args.auth_token:
            auth_headers = {"Authorization": f"Bearer {args.auth_token}"}
            targets.extend(
                [
                    ("api_bootstrap_shell", f"{api_url}/bootstrap-shell", auth_headers),
                    ("api_bootstrap", f"{api_url}/bootstrap", auth_headers),
                    ("api_metrics_summary", f"{api_url}/metrics/summary", auth_headers),
                    ("api_metrics_curves", f"{api_url}/metrics/curves", auth_headers),
                    ("api_trades_page", f"{api_url}/trades/page?limit=100", auth_headers),
                    (
                        "api_session_summaries",
                        f"{api_url}/backtests/summaries?limit={args.summaries_limit}",
                        auth_headers,
                    ),
                ]
            )

    if not targets:
        raise SystemExit("No targets configured. Provide --frontend-url and/or --api-url.")

    if api_url and not args.auth_token:
        print("No auth token supplied: skipping authenticated bootstrap/session summary targets.\n")

    for name, url, headers in targets:
        exercise_target(
            name,
            url,
            headers,
            requests=args.requests,
            concurrency=args.concurrency,
            timeout=args.timeout,
        )


if __name__ == "__main__":
    main()
