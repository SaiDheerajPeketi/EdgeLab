from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Callable, Iterable
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import UTC, datetime
import json
import logging
from logging import LogRecord
from threading import Lock
from time import perf_counter
from uuid import uuid4

from fastapi import Request
from sqlalchemy.engine import Engine
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
REQUEST_ID_HEADER = "X-Request-ID"
TRACE_ID_HEADER = "X-Trace-ID"
_REQUEST_ID: ContextVar[str | None] = ContextVar("edgelab_request_id", default=None)
_LOGGING_CONFIGURED = False
_FASTAPI_INSTRUMENTED_APP_IDS: set[int] = set()
_INSTRUMENTED_ENGINE_IDS: set[int] = set()

try:
    from opentelemetry import trace
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor
    from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased

    OTEL_SDK_AVAILABLE = True
except ImportError:
    trace = None
    OTELSpanExporter = None
    FastAPIInstrumentor = None
    SQLAlchemyInstrumentor = None
    Resource = None
    TracerProvider = None
    BatchSpanProcessor = None
    ParentBased = None
    TraceIdRatioBased = None
    OTEL_SDK_AVAILABLE = False


@dataclass(frozen=True)
class TraceRuntimeStatus:
    enabled: bool
    reason: str
    exporter_endpoint: str | None = None


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


class RequestContextMiddleware(BaseHTTPMiddleware):
    def __init__(self, app) -> None:
        super().__init__(app)
        self.logger = logging.getLogger("edgelab.http")

    async def dispatch(self, request: Request, call_next: Callable):
        request_id = (request.headers.get(REQUEST_ID_HEADER) or "").strip() or uuid4().hex
        token = _REQUEST_ID.set(request_id)
        started_at = perf_counter()
        status_code = 500
        response = None
        try:
            response = await call_next(request)
            status_code = response.status_code
        except Exception:
            raise
        finally:
            duration_ms = round((perf_counter() - started_at) * 1000, 3)
            self.logger.info(
                "request finished",
                extra={
                    "event": "http_request",
                    "http.method": request.method,
                    "http.route": _route_label(request),
                    "http.path": request.url.path,
                    "http.status_code": status_code,
                    "http.duration_ms": duration_ms,
                    "client.address": request.client.host if request.client else None,
                    "request_id": request_id,
                    "trace_id": current_trace_id(),
                },
            )
            _REQUEST_ID.reset(token)
        if response is None:
            raise RuntimeError("RequestContextMiddleware expected response object")
        response.headers.setdefault(REQUEST_ID_HEADER, request_id)
        trace_id = current_trace_id()
        if trace_id:
            response.headers.setdefault(TRACE_ID_HEADER, trace_id)
        return response


class JsonLogFormatter(logging.Formatter):
    def __init__(self, *, service_name: str | None = None) -> None:
        super().__init__()
        self.service_name = service_name

    def format(self, record: LogRecord) -> str:
        payload: dict[str, object] = {
            "timestamp": datetime.now(UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if self.service_name:
            payload["service.name"] = self.service_name

        request_id = getattr(record, "request_id", None) or current_request_id()
        if request_id:
            payload["request_id"] = request_id

        trace_id = getattr(record, "trace_id", None) or current_trace_id()
        if trace_id:
            payload["trace_id"] = trace_id

        for field in (
            "event",
            "http.method",
            "http.route",
            "http.path",
            "http.status_code",
            "http.duration_ms",
            "client.address",
        ):
            value = getattr(record, field, None)
            if value is not None:
                payload[field] = value

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(payload, separators=(",", ":"), sort_keys=True)


def configure_logging(
    *,
    log_level: str = "INFO",
    json_logs: bool = True,
    service_name: str | None = None,
) -> None:
    global _LOGGING_CONFIGURED
    if _LOGGING_CONFIGURED:
        return

    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.setLevel(_coerce_log_level(log_level))

    handler = logging.StreamHandler()
    if json_logs:
        handler.setFormatter(JsonLogFormatter(service_name=service_name))
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
        )
    root_logger.addHandler(handler)

    # Keep single structured stream instead of duplicate Uvicorn access lines.
    for logger_name in ("uvicorn.access",):
        named_logger = logging.getLogger(logger_name)
        named_logger.handlers.clear()
        named_logger.propagate = True

    _LOGGING_CONFIGURED = True


def configure_tracing(
    *,
    app=None,
    service_name: str,
    service_namespace: str = "edgelab",
    environment: str = "production",
    otlp_endpoint: str = "",
    otlp_headers: str = "",
    sample_ratio: float = 1.0,
    sql_engines: Iterable[Engine] = (),
) -> TraceRuntimeStatus:
    endpoint = otlp_endpoint.strip()
    if not endpoint:
        return TraceRuntimeStatus(
            enabled=False,
            reason="otlp endpoint not configured",
        )
    if not OTEL_SDK_AVAILABLE:
        logging.getLogger(__name__).warning(
            "OpenTelemetry endpoint configured but SDK dependencies are unavailable"
        )
        return TraceRuntimeStatus(
            enabled=False,
            reason="opentelemetry packages unavailable",
            exporter_endpoint=endpoint,
        )

    provider = trace.get_tracer_provider()
    if not isinstance(provider, TracerProvider):
        provider = TracerProvider(
            resource=Resource.create(
                {
                    "service.name": service_name,
                    "service.namespace": service_namespace,
                    "deployment.environment": environment,
                }
            ),
            sampler=ParentBased(TraceIdRatioBased(_clamp_sample_ratio(sample_ratio))),
        )
        provider.add_span_processor(
            BatchSpanProcessor(
                OTLPSpanExporter(
                    endpoint=endpoint,
                    headers=_parse_otel_headers(otlp_headers),
                )
            )
        )
        trace.set_tracer_provider(provider)

    if app is not None and id(app) not in _FASTAPI_INSTRUMENTED_APP_IDS:
        FastAPIInstrumentor.instrument_app(
            app,
            tracer_provider=provider,
            excluded_urls="/api/health,/api/observability/metrics",
        )
        _FASTAPI_INSTRUMENTED_APP_IDS.add(id(app))

    instrumentor = SQLAlchemyInstrumentor()
    for engine in sql_engines:
        if id(engine) in _INSTRUMENTED_ENGINE_IDS:
            continue
        instrumentor.instrument(
            engine=engine,
            tracer_provider=provider,
            enable_commenter=True,
            commenter_options={"db_driver": True, "db_framework": True},
        )
        _INSTRUMENTED_ENGINE_IDS.add(id(engine))

    return TraceRuntimeStatus(
        enabled=True,
        reason="tracing enabled",
        exporter_endpoint=endpoint,
    )


def current_request_id() -> str | None:
    return _REQUEST_ID.get()


def current_trace_id() -> str | None:
    if not OTEL_SDK_AVAILABLE:
        return None
    span = trace.get_current_span()
    span_context = span.get_span_context()
    if not span_context or not span_context.is_valid:
        return None
    return f"{span_context.trace_id:032x}"


def _route_label(request: Request) -> str:
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    return path or request.url.path


def _format_bucket(value: float) -> str:
    return f"{value:g}"


def _label(value: str) -> str:
    return value.replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')


def _coerce_log_level(level: str) -> int:
    return logging._nameToLevel.get(level.strip().upper(), logging.INFO)


def _clamp_sample_ratio(value: float) -> float:
    if value < 0:
        return 0.0
    if value > 1:
        return 1.0
    return value


def _parse_otel_headers(raw_headers: str) -> dict[str, str]:
    headers: dict[str, str] = {}
    for item in raw_headers.split(","):
        key, separator, value = item.partition("=")
        if separator and key.strip() and value.strip():
            headers[key.strip()] = value.strip()
    return headers
