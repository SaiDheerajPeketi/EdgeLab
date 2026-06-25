from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Callable
from threading import Lock
from time import perf_counter

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware


PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8"
DEFAULT_LATENCY_BUCKETS = (
    0.005,
    0.01,
    0.025,
    0.05,
    0.1,
    0.25,
    0.5,
    1.0,
    2.5,
    5.0,
    10.0,
)


class HttpMetricsRegistry:
    def __init__(self, buckets: tuple[float, ...] = DEFAULT_LATENCY_BUCKETS) -> None:
        self.buckets = buckets
        self._lock = Lock()
        self._in_flight = 0
        self._requests_total: Counter[tuple[str, str, str]] = Counter()
        self._duration_bucket_counts: defaultdict[tuple[str, str], Counter[str]] = defaultdict(Counter)
        self._duration_sums: Counter[tuple[str, str]] = Counter()
        self._duration_counts: Counter[tuple[str, str]] = Counter()

    def begin_request(self) -> None:
        with self._lock:
            self._in_flight += 1

    def observe_request(
        self,
        *,
        method: str,
        route: str,
        status_code: int,
        duration_seconds: float,
    ) -> None:
        status = str(status_code)
        with self._lock:
            self._requests_total[(method, route, status)] += 1
            self._duration_sums[(method, route)] += duration_seconds
            self._duration_counts[(method, route)] += 1
            bucket_counter = self._duration_bucket_counts[(method, route)]
            for bucket in self.buckets:
                if duration_seconds <= bucket:
                    bucket_counter[_format_bucket(bucket)] += 1
            bucket_counter["+Inf"] += 1

    def end_request(self) -> None:
        with self._lock:
            self._in_flight = max(self._in_flight - 1, 0)

    def render(self) -> str:
        lines = [
            "# HELP edgelab_http_requests_total Total HTTP requests processed.",
            "# TYPE edgelab_http_requests_total counter",
        ]
        with self._lock:
            for (method, route, status), value in sorted(self._requests_total.items()):
                lines.append(
                    "edgelab_http_requests_total"
                    f'{{method="{_label(method)}",route="{_label(route)}",status="{_label(status)}"}} {value}'
                )

            lines.extend(
                [
                    "# HELP edgelab_http_request_duration_seconds Request latency histogram.",
                    "# TYPE edgelab_http_request_duration_seconds histogram",
                ]
            )
            for (method, route), bucket_counter in sorted(self._duration_bucket_counts.items()):
                for bucket in (*self.buckets, float("inf")):
                    bucket_label = "+Inf" if bucket == float("inf") else _format_bucket(bucket)
                    lines.append(
                        "edgelab_http_request_duration_seconds_bucket"
                        f'{{method="{_label(method)}",route="{_label(route)}",le="{bucket_label}"}} '
                        f"{bucket_counter.get(bucket_label, 0)}"
                    )
                key = (method, route)
                lines.append(
                    "edgelab_http_request_duration_seconds_sum"
                    f'{{method="{_label(method)}",route="{_label(route)}"}} '
                    f"{self._duration_sums.get(key, 0.0):.9f}"
                )
                lines.append(
                    "edgelab_http_request_duration_seconds_count"
                    f'{{method="{_label(method)}",route="{_label(route)}"}} '
                    f"{self._duration_counts.get(key, 0)}"
                )

            lines.extend(
                [
                    "# HELP edgelab_http_in_flight_requests Current HTTP requests in flight.",
                    "# TYPE edgelab_http_in_flight_requests gauge",
                    f"edgelab_http_in_flight_requests {self._in_flight}",
                ]
            )
        return "\n".join(lines) + "\n"


class HTTPMetricsMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, registry: HttpMetricsRegistry) -> None:
        super().__init__(app)
        self.registry = registry

    async def dispatch(self, request: Request, call_next: Callable):
        self.registry.begin_request()
        start = perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            route = _route_label(request)
            self.registry.observe_request(
                method=request.method,
                route=route,
                status_code=status_code,
                duration_seconds=perf_counter() - start,
            )
            self.registry.end_request()


def _route_label(request: Request) -> str:
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    return path or request.url.path


def _format_bucket(value: float) -> str:
    return f"{value:g}"


def _label(value: str) -> str:
    return value.replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')
