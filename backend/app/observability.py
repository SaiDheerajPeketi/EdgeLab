from __future__ import annotations

from collections.abc import Iterable
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import UTC, datetime
import json
import logging
from logging import LogRecord
import math
import os
from random import random
import re
from time import perf_counter
from threading import Event as ThreadEvent
import traceback
from urllib.parse import unquote, urlsplit
from uuid import uuid4

from urllib3.util import Timeout

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram, generate_latest, multiprocess
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.pool import QueuePool
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send


PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8"
DEFAULT_LATENCY_BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0)
REQUEST_ID_HEADER = "X-Request-ID"
TRACE_ID_HEADER = "X-Trace-ID"
_REQUEST_ID: ContextVar[str | None] = ContextVar("edgelab_request_id", default=None)
_LOGGING_CONFIGURED = False
_FASTAPI_INSTRUMENTED_APP_IDS: set[int] = set()
_INSTRUMENTED_ENGINE_IDS: set[int] = set()
_OWNED_TRACER_PROVIDER = None
_OWNED_TRACER_CONFIG = None
_METHODS = frozenset({"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "CONNECT", "TRACE"})
_EXCLUDED_PATHS = frozenset({"/api/health", "/api/ready", "/api/observability/metrics"})
_REQUEST_ID_PATTERN = re.compile(r"[A-Za-z0-9._-]{1,128}\Z")


def number_env(name: str, default: float, minimum: float, maximum: float, *, integer=False):
    try:
        value = (int if integer else float)(os.getenv(name, str(default)))
    except ValueError:
        raise ValueError(f"{name} must be a finite number between {minimum} and {maximum}") from None
    if not math.isfinite(value) or not minimum <= value <= maximum:
        raise ValueError(f"{name} must be a finite number between {minimum} and {maximum}")
    return value


@dataclass(frozen=True)
class TelemetryConfig:
    metrics_enabled: bool = True
    success_log_sample_ratio: float = 0.1
    slow_request_seconds: float = 1.0
    trace_queue_size: int = 2048
    trace_batch_size: int = 512
    trace_schedule_delay_ms: int = 5000
    trace_export_timeout_seconds: float = 5.0
    trace_shutdown_timeout_seconds: float = 5.0
    latency_buckets: tuple[float, ...] = DEFAULT_LATENCY_BUCKETS

    @classmethod
    def from_env(cls):
        enabled = os.getenv("EDGELAB_METRICS_ENABLED", "1").strip().lower()
        if enabled not in {"1", "0", "true", "false", "yes", "no", "on", "off"}:
            raise ValueError("EDGELAB_METRICS_ENABLED must be a boolean")
        raw_buckets = os.getenv("EDGELAB_HTTP_LATENCY_BUCKETS", ",".join(map(str, DEFAULT_LATENCY_BUCKETS)))
        try:
            buckets = tuple(float(value.strip()) for value in raw_buckets.split(","))
        except ValueError:
            raise ValueError("EDGELAB_HTTP_LATENCY_BUCKETS must contain ascending positive finite seconds") from None
        if (not 1 <= len(buckets) <= 24 or any(not math.isfinite(value) or value <= 0 for value in buckets)
                or any(left >= right for left, right in zip(buckets, buckets[1:]))):
            raise ValueError("EDGELAB_HTTP_LATENCY_BUCKETS must contain 1..24 ascending positive finite seconds")
        queue_size = number_env("EDGELAB_OTEL_MAX_QUEUE_SIZE", 2048, 1, 65536, integer=True)
        batch_size = number_env("EDGELAB_OTEL_MAX_BATCH_SIZE", 512, 1, 4096, integer=True)
        if batch_size > queue_size:
            raise ValueError("EDGELAB_OTEL_MAX_BATCH_SIZE cannot exceed EDGELAB_OTEL_MAX_QUEUE_SIZE")
        return cls(
            metrics_enabled=enabled in {"1", "true", "yes", "on"},
            success_log_sample_ratio=number_env("EDGELAB_HTTP_LOG_SAMPLE_RATIO", 0.1, 0, 1),
            slow_request_seconds=number_env("EDGELAB_HTTP_SLOW_REQUEST_SECONDS", 1.0, 0.001, 3600),
            trace_queue_size=queue_size,
            trace_batch_size=batch_size,
            trace_schedule_delay_ms=number_env("EDGELAB_OTEL_SCHEDULE_DELAY_MS", 5000, 100, 60000, integer=True),
            trace_export_timeout_seconds=number_env("EDGELAB_OTEL_EXPORT_TIMEOUT_SECONDS", 5, 0.1, 30),
            trace_shutdown_timeout_seconds=number_env("EDGELAB_OTEL_SHUTDOWN_TIMEOUT_SECONDS", 5, 0.1, 15),
            latency_buckets=buckets,
        )


telemetry_config = TelemetryConfig.from_env()

try:
    from opentelemetry import trace
    from opentelemetry.exporter.otlp.proto.http import Compression
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import Event, ReadableSpan, TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor, SpanExportResult
    from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased

    OTEL_SDK_AVAILABLE = True
except ImportError:
    trace = OTLPSpanExporter = FastAPIInstrumentor = SQLAlchemyInstrumentor = None
    Resource = TracerProvider = BatchSpanProcessor = ParentBased = TraceIdRatioBased = None
    OTEL_SDK_AVAILABLE = False


@dataclass(frozen=True)
class TraceRuntimeStatus:
    enabled: bool
    reason: str
    exporter_endpoint: str | None = None


class HttpMetricsRegistry:
    """One registry per worker; the scrape registry sums mmap files across workers."""

    def __init__(self, buckets: tuple[float, ...] = DEFAULT_LATENCY_BUCKETS, *, enabled=True) -> None:
        self.enabled = enabled
        self.registry = CollectorRegistry()
        self.requests = Counter("edgelab_http_requests_total", "Completed HTTP requests.",
                                ("method", "route", "status"), registry=self.registry)
        self.duration = Histogram("edgelab_http_request_duration_seconds", "Full ASGI request duration.",
                                  ("method", "route"), buckets=buckets, registry=self.registry)
        self.in_flight = Gauge("edgelab_http_in_flight_requests", "HTTP requests in flight.",
                               multiprocess_mode="livesum", registry=self.registry)
        self.interrupted = Counter("edgelab_http_interrupted_total", "Incomplete or failed ASGI requests.",
                                   registry=self.registry)
        self.admission_active = Gauge("edgelab_admission_active", "Admitted or queued requests.", ("state",),
                                      multiprocess_mode="livesum", registry=self.registry)
        self.admission_limit = Gauge("edgelab_admission_limit", "Configured worker admission capacity.", ("state",),
                                     multiprocess_mode="livesum", registry=self.registry)
        self.admission_rejected = Counter("edgelab_admission_rejected_total", "Requests rejected by admission.",
                                         ("reason",), registry=self.registry)
        self.queue_wait = Histogram("edgelab_admission_wait_seconds", "Time spent awaiting admission.",
                                    buckets=buckets, registry=self.registry)
        self.pool_checked_out = Gauge("edgelab_db_pool_checked_out", "Checked out database connections.",
                                     ("store",), multiprocess_mode="livesum", registry=self.registry)
        self.pool_capacity = Gauge("edgelab_db_pool_capacity", "Maximum database checkout capacity.",
                                  ("store",), multiprocess_mode="livesum", registry=self.registry)
        self.pool_timeouts = Counter("edgelab_db_pool_timeouts_total", "Database checkout timeouts.",
                                    registry=self.registry)
        self.cache_operations = Counter("edgelab_cache_operations_total", "Redis read-model operations.",
                                       ("outcome",), registry=self.registry)
        self.trace_batches = Counter("edgelab_trace_export_batches_total", "OTLP batch export results.",
                                     ("outcome",), registry=self.registry)

    def begin_request(self) -> None:
        if self.enabled:
            self.in_flight.inc()

    def observe_request(self, *, method: str, route: str, status_code: int, duration_seconds: float) -> None:
        if self.enabled:
            method = _method_label(method)
            self.requests.labels(method, route, str(status_code)).inc()
            self.duration.labels(method, route).observe(duration_seconds)

    def end_request(self) -> None:
        if self.enabled:
            self.in_flight.dec()

    def render(self) -> str:
        registry = self.registry
        if os.environ.get("PROMETHEUS_MULTIPROC_DIR"):
            registry = CollectorRegistry()
            multiprocess.MultiProcessCollector(registry)
        return generate_latest(registry).decode("utf-8")

    def instrument_pool(self, engine: Engine, store: str) -> None:
        if not self.enabled or not isinstance(engine.pool, QueuePool) or engine.pool._max_overflow < 0:
            return
        checked_out = self.pool_checked_out.labels(store)
        self.pool_capacity.labels(store).set(engine.pool.size() + engine.pool._max_overflow)
        marker = f"edgelab_metric_checkout_{store}"

        def checkout(connection, record, proxy):
            if not record.record_info.get(marker):
                record.record_info[marker] = True
                checked_out.inc()

        def checkin(connection, record):
            if record.record_info.pop(marker, False):
                checked_out.dec()

        event.listen(engine.pool, "checkout", checkout)
        event.listen(engine.pool, "checkin", checkin)


http_metrics = HttpMetricsRegistry(telemetry_config.latency_buckets, enabled=telemetry_config.metrics_enabled)


class HTTPMetricsMiddleware:
    def __init__(self, app: ASGIApp, registry: HttpMetricsRegistry) -> None:
        self.app, self.registry = app, registry

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("path") in _EXCLUDED_PATHS or not self.registry.enabled:
            await self.app(scope, receive, send)
            return
        self.registry.begin_request()
        started_at, status_code, completed = perf_counter(), 500, False

        async def track_send(message: Message) -> None:
            nonlocal status_code, completed
            if message["type"] == "http.response.start":
                status_code = message["status"]
            await send(message)
            if message["type"] == "http.response.body" and not message.get("more_body", False):
                completed = True

        failed = False
        try:
            await self.app(scope, receive, track_send)
        except BaseException:
            failed = True
            raise
        finally:
            if failed or not completed:
                self.registry.interrupted.inc()
            self.registry.observe_request(method=scope["method"], route=_route_label(scope),
                                          status_code=status_code, duration_seconds=perf_counter() - started_at)
            self.registry.end_request()


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp, *, config: TelemetryConfig = telemetry_config) -> None:
        self.app, self.config = app, config
        self.logger = logging.getLogger("edgelab.http")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        supplied_id = Headers(scope=scope).get(REQUEST_ID_HEADER, "")
        request_id = supplied_id if _REQUEST_ID_PATTERN.fullmatch(supplied_id) else uuid4().hex
        scope["edgelab.request_id"] = request_id
        token = _REQUEST_ID.set(request_id)
        started_at, status_code, completed, failed = perf_counter(), 500, False, False

        async def context_send(message: Message) -> None:
            nonlocal status_code, completed
            if message["type"] == "http.response.start":
                status_code = message["status"]
                headers = MutableHeaders(scope=message)
                headers[REQUEST_ID_HEADER] = request_id
                trace_id = current_trace_id()
                if trace_id:
                    headers[TRACE_ID_HEADER] = trace_id
            await send(message)
            if message["type"] == "http.response.body" and not message.get("more_body", False):
                completed = True

        try:
            await self.app(scope, receive, context_send)
        except BaseException:
            failed = True
            raise
        finally:
            duration = perf_counter() - started_at
            if (failed or status_code >= 400 or duration >= self.config.slow_request_seconds or
                    (scope.get("path") not in _EXCLUDED_PATHS and random() < self.config.success_log_sample_ratio)):
                self.logger.log(logging.WARNING if failed or status_code >= 500 else logging.INFO,
                    "request finished", extra={"event": "http_request", "http.method": _method_label(scope["method"]),
                        "http.route": _route_label(scope), "http.status_code": status_code,
                        "http.duration_ms": round(duration * 1000, 3), "http.completed": completed and not failed,
                        "request_id": request_id, "trace_id": current_trace_id()})
            _REQUEST_ID.reset(token)


class JsonLogFormatter(logging.Formatter):
    def __init__(self, *, service_name: str | None = None) -> None:
        super().__init__()
        self.service_name = service_name

    def formatException(self, exc_info) -> str:
        # SQL driver exception messages can include bound values and credentials.
        frames = traceback.extract_tb(exc_info[2])
        return "\n".join([exc_info[0].__name__, *(f"{frame.filename}:{frame.lineno} in {frame.name}" for frame in frames)])

    def format(self, record: LogRecord) -> str:
        payload: dict[str, object] = {"timestamp": datetime.now(UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname, "logger": record.name, "message": record.getMessage()}
        if self.service_name:
            payload["service.name"] = self.service_name
        for key, value in (("request_id", getattr(record, "request_id", None) or current_request_id()),
                           ("trace_id", getattr(record, "trace_id", None) or current_trace_id())):
            if value:
                payload[key] = value
        for field in ("event", "http.method", "http.route", "http.status_code", "http.duration_ms", "http.completed"):
            value = getattr(record, field, None)
            if value is not None:
                payload[field] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, separators=(",", ":"), sort_keys=True)


class SafeTextLogFormatter(logging.Formatter):
    formatException = JsonLogFormatter.formatException


def configure_logging(*, log_level="INFO", json_logs=True, service_name=None) -> None:
    global _LOGGING_CONFIGURED
    if _LOGGING_CONFIGURED:
        return
    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.setLevel(logging._nameToLevel.get(log_level.strip().upper(), logging.INFO))
    handler = logging.StreamHandler()
    formatter = (JsonLogFormatter(service_name=service_name) if json_logs else
                 SafeTextLogFormatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    handler.setFormatter(formatter)
    root_logger.addHandler(handler)
    # Gunicorn's UvicornWorker installs its own raw error handlers before app
    # import. Route them through the same redactor, including unhandled SQL errors.
    for logger_name in ("uvicorn.error", "gunicorn.error"):
        named_logger = logging.getLogger(logger_name)
        named_logger.handlers.clear()
        named_logger.setLevel(logging.NOTSET)
        named_logger.propagate = True
    for logger_name in ("uvicorn.access", "gunicorn.access"):
        named_logger = logging.getLogger(logger_name)
        named_logger.handlers.clear()
        named_logger.propagate = False
        named_logger.disabled = True
    _LOGGING_CONFIGURED = True


_SAFE_SPAN_ATTRIBUTES = frozenset({"http.method", "http.request.method", "http.route", "http.status_code",
    "http.response.status_code", "http.flavor", "network.protocol.version", "db.system", "db.operation",
    "db.operation.name", "db.name", "db.namespace", "db.sql.table", "asgi.event.type"})


class SanitizingSpanExporter:
    """Keep routing/timing/status and causal IDs, but never payloads, URLs or SQL values."""
    def __init__(self, exporter):
        self.exporter = exporter
        self.stopped = ThreadEvent()

    def export(self, spans):
        if self.stopped.is_set():
            if http_metrics.enabled:
                http_metrics.trace_batches.labels("shutdown_drop").inc()
            return SpanExportResult.FAILURE
        sanitized = []
        for span in spans:
            attributes = {key: value for key, value in (span.attributes or {}).items() if key in _SAFE_SPAN_ATTRIBUTES}
            method = attributes.get("http.request.method") or attributes.get("http.method")
            name = "internal"
            if "asgi.event.type" in attributes:
                name = "asgi"
            if method:
                name = f"{_method_label(method)} {attributes.get('http.route', 'unmatched')}"
            elif "db.system" in attributes:
                statement = (span.attributes or {}).get("db.statement", "")
                operation = str(statement).split(maxsplit=1)[0].upper() if statement else "database"
                name = operation if operation in {"SELECT", "INSERT", "UPDATE", "DELETE", "BEGIN", "COMMIT", "ROLLBACK"} else "database"
            events = tuple(Event("exception", {"exception.type": event.attributes.get("exception.type", "Error")}, event.timestamp)
                           for event in span.events if event.name == "exception")
            resource = Resource({key: value for key, value in span.resource.attributes.items()
                                 if key in {"service.name", "service.namespace", "deployment.environment",
                                            "telemetry.sdk.name", "telemetry.sdk.language", "telemetry.sdk.version"}})
            def clean_context(context):
                if context is None:
                    return None
                return trace.SpanContext(context.trace_id, context.span_id, context.is_remote,
                                         context.trace_flags, trace.TraceState())
            sanitized.append(ReadableSpan(name=name, context=clean_context(span.context), parent=clean_context(span.parent),
                resource=resource, attributes=attributes, events=events, kind=span.kind,
                status=trace.Status(span.status.status_code), start_time=span.start_time, end_time=span.end_time,
                instrumentation_scope=span.instrumentation_scope))
        try:
            result = self.exporter.export(sanitized)
        except Exception:
            if http_metrics.enabled:
                http_metrics.trace_batches.labels("failure").inc()
            raise
        if http_metrics.enabled:
            http_metrics.trace_batches.labels("success" if result == SpanExportResult.SUCCESS else "failure").inc()
        return result

    def shutdown(self):
        self.stopped.set()
        return self.exporter.shutdown()

    def force_flush(self, timeout_millis=30000):
        return self.exporter.force_flush(timeout_millis)


if OTEL_SDK_AVAILABLE:
    class BoundedOTLPSpanExporter(OTLPSpanExporter):
        # SDK 1.28.2 retries 5xx for over a minute. Telemetry is expendable:
        # attempt each batch once, never log a collector's response payload.
        def _export_serialized_spans(self, serialized_data):
            try:
                response = self._session.post(self._endpoint, data=serialized_data,
                    verify=self._certificate_file, cert=self._client_cert, stream=True, allow_redirects=False,
                    timeout=Timeout(total=self._timeout, connect=self._timeout, read=self._timeout))
                try:
                    return SpanExportResult.SUCCESS if 200 <= response.status_code < 300 else SpanExportResult.FAILURE
                finally:
                    response.close()
            except Exception:
                return SpanExportResult.FAILURE


    class BoundedBatchSpanProcessor(BatchSpanProcessor):
        # These lifecycle fields are pinned to SDK 1.28.2 and covered by tests.
        def __init__(self, exporter, *, shutdown_timeout_seconds=5.0, **kwargs):
            super().__init__(exporter, **kwargs)
            self.shutdown_timeout_seconds = shutdown_timeout_seconds

        def shutdown(self):
            self.done = True
            with self.condition:
                self.condition.notify_all()
            self.worker_thread.join(timeout=self.shutdown_timeout_seconds)
            # A blocked collector cannot prolong API process shutdown. The
            # daemon finishes its current attempt and drops the remaining queue.
            self.span_exporter.shutdown()


def configure_tracing(*, app=None, service_name: str, service_namespace="edgelab", environment="production",
                      otlp_endpoint="", otlp_headers="", sample_ratio=0.1, sql_engines: Iterable[Engine] = (),
                      config: TelemetryConfig = telemetry_config) -> TraceRuntimeStatus:
    global _OWNED_TRACER_PROVIDER, _OWNED_TRACER_CONFIG
    endpoint = otlp_endpoint.strip()
    if not endpoint:
        return TraceRuntimeStatus(False, "otlp endpoint not configured")
    parsed = urlsplit(endpoint)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("OTEL_EXPORTER_OTLP_ENDPOINT must be an HTTP(S) endpoint without credentials or query data; use OTLP headers")
    if not math.isfinite(sample_ratio) or not 0 <= sample_ratio <= 1:
        raise ValueError("EDGELAB_OTEL_TRACE_SAMPLE_RATIO must be a finite number between 0 and 1")
    if not OTEL_SDK_AVAILABLE:
        logging.getLogger(__name__).warning("OpenTelemetry endpoint configured but SDK dependencies are unavailable")
        return TraceRuntimeStatus(False, "opentelemetry packages unavailable", endpoint)
    provider = trace.get_tracer_provider()
    pipeline_config = (service_name, service_namespace, environment, endpoint, otlp_headers, sample_ratio, config)
    if isinstance(provider, TracerProvider):
        if provider is not _OWNED_TRACER_PROVIDER or pipeline_config != _OWNED_TRACER_CONFIG:
            raise ValueError("OpenTelemetry must use the EdgeLab-owned sanitized pipeline; external or conflicting providers are unsupported")
    else:
        sampler = TraceIdRatioBased(sample_ratio)
        provider = TracerProvider(resource=Resource.create({"service.name": service_name,
            "service.namespace": service_namespace, "deployment.environment": environment}),
            sampler=ParentBased(sampler, remote_parent_sampled=sampler, remote_parent_not_sampled=sampler))
        provider.add_span_processor(BoundedBatchSpanProcessor(SanitizingSpanExporter(BoundedOTLPSpanExporter(endpoint=endpoint,
            headers=_parse_otel_headers(otlp_headers), timeout=config.trace_export_timeout_seconds,
            compression=Compression.NoCompression)),
            shutdown_timeout_seconds=config.trace_shutdown_timeout_seconds,
            max_queue_size=config.trace_queue_size, max_export_batch_size=config.trace_batch_size,
            schedule_delay_millis=config.trace_schedule_delay_ms,
            export_timeout_millis=int(config.trace_export_timeout_seconds * 1000)))
        trace.set_tracer_provider(provider)
        _OWNED_TRACER_PROVIDER, _OWNED_TRACER_CONFIG = provider, pipeline_config
    if app is not None and id(app) not in _FASTAPI_INSTRUMENTED_APP_IDS:
        FastAPIInstrumentor.instrument_app(app, tracer_provider=provider,
            excluded_urls="/api/health,/api/ready,/api/observability/metrics")
        _FASTAPI_INSTRUMENTED_APP_IDS.add(id(app))
    instrumentor = SQLAlchemyInstrumentor()
    for engine in sql_engines:
        if id(engine) not in _INSTRUMENTED_ENGINE_IDS:
            instrumentor.instrument(engine=engine, tracer_provider=provider, enable_commenter=False)
            _INSTRUMENTED_ENGINE_IDS.add(id(engine))
    return TraceRuntimeStatus(True, "tracing enabled", endpoint)


def current_request_id() -> str | None:
    return _REQUEST_ID.get()


def current_trace_id() -> str | None:
    if not OTEL_SDK_AVAILABLE:
        return None
    context = trace.get_current_span().get_span_context()
    return f"{context.trace_id:032x}" if context and context.is_valid else None


def _route_label(scope: Scope) -> str:
    return getattr(scope.get("route"), "path", None) or "unmatched"


def _method_label(method: str) -> str:
    return method if method in _METHODS else "OTHER"


def _parse_otel_headers(raw_headers: str) -> dict[str, str]:
    headers = {}
    for item in raw_headers.split(","):
        key, separator, value = item.partition("=")
        if separator and key.strip() and value.strip():
            headers[unquote(key.strip())] = unquote(value.strip())
    return headers
