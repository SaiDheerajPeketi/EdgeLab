"""Exercise full ASGI lifetimes, privacy boundaries and real multiprocess metrics."""
import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import os
from pathlib import Path
import stat
import subprocess
import sys
from threading import Event as ThreadEvent, Thread
from time import monotonic
from types import SimpleNamespace

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.common.trace_encoder import encode_spans
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import Event, ReadableSpan
from opentelemetry.sdk.trace.export import SpanExportResult
from opentelemetry.sdk.util.instrumentation import InstrumentationScope
from prometheus_client.parser import text_string_to_metric_families
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.exc import StatementError
from starlette.responses import JSONResponse

import app.observability as obs


def scope(*, path="/api/items/42", method="GET", request_id=b"req-214", kind="http"):
    return {"type": kind, "method": method, "path": path, "raw_path": path.encode(), "root_path": "",
            "query_string": b"token=PRIVATE-QUERY", "headers": [(b"x-request-id", request_id),
            (b"authorization", b"Bearer PRIVATE-AUTH"), (b"cookie", b"session=PRIVATE-COOKIE")],
            "client": ("192.0.2.213", 43210), "server": ("private.example", 8000), "scheme": "https",
            "http_version": "1.1", "asgi": {"version": "3.0", "spec_version": "2.4"}}


async def call(app, request_scope):
    messages = []
    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}
    async def send(message):
        messages.append(message)
    await app(request_scope, receive, send)
    return messages


def sample(registry, name, labels=None):
    return registry.registry.get_sample_value(name, labels or {})


def test_stream_body_and_cleanup_keep_inflight_duration_and_request_context(monkeypatch, caplog):
    registry = obs.HttpMetricsRegistry()
    clock = [0.0]
    monkeypatch.setattr(obs, "perf_counter", lambda: clock[0])
    caplog.set_level(logging.INFO, logger="edgelab.http")

    async def run():
        began, finish_body, body_done, cleanup = (asyncio.Event() for _ in range(4))
        seen, after = [], []
        async def app(request_scope, receive, send):
            request_scope["route"] = SimpleNamespace(path="/api/items/{item_id}")
            seen.append(obs.current_request_id())
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"first", "more_body": True})
            began.set()
            await finish_body.wait()
            seen.append(obs.current_request_id())
            await send({"type": "http.response.body", "body": b"last", "more_body": False})
            body_done.set()
            await cleanup.wait()
            seen.append(obs.current_request_id())
        middleware = obs.RequestContextMiddleware(obs.HTTPMetricsMiddleware(app, registry),
                                                   config=obs.TelemetryConfig(success_log_sample_ratio=1))
        async def invoke():
            result = await call(middleware, scope())
            after.append(obs.current_request_id())
            return result
        task = asyncio.create_task(invoke())
        try:
            await asyncio.wait_for(began.wait(), 1)
            assert sample(registry, "edgelab_http_in_flight_requests") == 1
            clock[0] = 2
            finish_body.set()
            await asyncio.wait_for(body_done.wait(), 1)
            assert sample(registry, "edgelab_http_in_flight_requests") == 1
            assert sample(registry, "edgelab_http_requests_total", {"method": "GET", "route": "/api/items/{item_id}", "status": "200"}) is None
            clock[0] = 3
            cleanup.set()
            messages = await asyncio.wait_for(task, 1)
            assert dict(messages[0]["headers"])[b"x-request-id"] == b"req-214"
            assert seen == ["req-214"] * 3 and after == [None]
            assert sample(registry, "edgelab_http_in_flight_requests") == 0
            assert sample(registry, "edgelab_http_request_duration_seconds_sum", {"method": "GET", "route": "/api/items/{item_id}"}) == 3
            record = next(record for record in caplog.records if record.name == "edgelab.http")
            assert record.__dict__["http.duration_ms"] == 3000
            assert record.__dict__["http.completed"] is True
        finally:
            finish_body.set()
            cleanup.set()
            await asyncio.gather(task, return_exceptions=True)
    asyncio.run(run())


@pytest.mark.parametrize("finish", ["disconnect", "exception", "cancel"])
def test_interrupted_requests_count_and_reset_context(finish, caplog):
    registry = obs.HttpMetricsRegistry()
    caplog.set_level(logging.INFO, logger="edgelab.http")
    async def run():
        began = asyncio.Event()
        seen, after = [], []
        async def app(request_scope, receive, send):
            try:
                if finish == "exception":
                    raise RuntimeError("PRIVATE-EXCEPTION")
                await send({"type": "http.response.start", "status": 200, "headers": []})
                await send({"type": "http.response.body", "body": b"partial", "more_body": True})
                if finish == "disconnect":
                    assert (await receive())["type"] == "http.disconnect"
                else:
                    began.set()
                    await asyncio.Event().wait()
            finally:
                seen.append(obs.current_request_id())
        async def receive():
            return {"type": "http.disconnect"}
        async def send(message):
            pass
        middleware = obs.RequestContextMiddleware(obs.HTTPMetricsMiddleware(app, registry),
                                                   config=obs.TelemetryConfig(success_log_sample_ratio=1))
        async def invoke():
            try:
                await middleware(scope(), receive, send)
            finally:
                after.append(obs.current_request_id())
        task = asyncio.create_task(invoke())
        if finish == "cancel":
            await asyncio.wait_for(began.wait(), 1)
            task.cancel()
        if finish == "disconnect":
            await task
        else:
            with pytest.raises(asyncio.CancelledError if finish == "cancel" else RuntimeError):
                await task
        assert seen == ["req-214"] and after == [None]
        assert sample(registry, "edgelab_http_in_flight_requests") == 0
        assert sample(registry, "edgelab_http_interrupted_total") == 1
        status = "500" if finish == "exception" else "200"
        assert sample(registry, "edgelab_http_requests_total", {"method": "GET", "route": "unmatched", "status": status}) == 1
        record = next(record for record in caplog.records if record.name == "edgelab.http")
        assert record.__dict__["http.completed"] is False
        assert "PRIVATE-EXCEPTION" not in obs.JsonLogFormatter().format(record)
    asyncio.run(run())


def test_unknown_paths_and_methods_have_finite_private_labels_and_logs(caplog):
    registry = obs.HttpMetricsRegistry()
    caplog.set_level(logging.INFO, logger="edgelab.http")
    async def app(request_scope, receive, send):
        await JSONResponse({"detail": "missing"}, status_code=404)(request_scope, receive, send)
    middleware = obs.RequestContextMiddleware(obs.HTTPMetricsMiddleware(app, registry))
    async def run():
        for number in range(12):
            await call(middleware, scope(path=f"/PRIVATE-PATH-{number}", method=f"PRIVATE-METHOD-{number}"))
    asyncio.run(run())
    metrics = registry.render()
    assert sample(registry, "edgelab_http_requests_total", {"method": "OTHER", "route": "unmatched", "status": "404"}) == 12
    for record in caplog.records:
        if record.name == "edgelab.http":
            assert record.__dict__["http.method"] == "OTHER"
            assert record.__dict__["http.route"] == "unmatched"
            metrics += obs.JsonLogFormatter().format(record)
    for private in ("PRIVATE-", "192.0.2.213", "private.example", "token=", "Bearer", "session="):
        assert private not in metrics


@pytest.mark.parametrize("request_id,valid", [(b"a" * 128, True), (b"a" * 129, False),
    (b"invalid\ncontrol", False), (b"invalid\x00control", False), (b"", False)])
def test_request_ids_have_safe_characters_and_128_character_bound(request_id, valid):
    async def app(request_scope, receive, send):
        assert obs.current_request_id() == request_scope["edgelab.request_id"]
        await JSONResponse({"ok": True})(request_scope, receive, send)
    messages = asyncio.run(call(obs.RequestContextMiddleware(app), scope(request_id=request_id)))
    value = dict(messages[0]["headers"])[b"x-request-id"].decode()
    assert 1 <= len(value) <= 128 and obs._REQUEST_ID_PATTERN.fullmatch(value)
    assert (value == request_id.decode()) is valid


@pytest.mark.parametrize("ratio,status,duration,raises,expected", [
    (0, 200, 0.001, False, False), (0.1, 200, 0.001, False, False),
    (1, 200, 0.001, False, True), (0, 404, 0.001, False, True),
    (0, 503, 0.001, False, True), (0, 200, 2, False, True), (0, 200, 0.001, True, True),
])
def test_success_logs_sampled_but_errors_and_slow_requests_always_log(monkeypatch, caplog, ratio, status, duration, raises, expected):
    caplog.set_level(logging.INFO, logger="edgelab.http")
    monkeypatch.setattr(obs, "random", lambda: 0.9)
    clock = iter((0, duration))
    monkeypatch.setattr(obs, "perf_counter", lambda: next(clock))
    async def app(request_scope, receive, send):
        if raises:
            raise ValueError("PRIVATE-EXCEPTION")
        await JSONResponse({"ok": True}, status_code=status)(request_scope, receive, send)
    middleware = obs.RequestContextMiddleware(app, config=obs.TelemetryConfig(success_log_sample_ratio=ratio))
    if raises:
        with pytest.raises(ValueError):
            asyncio.run(call(middleware, scope()))
    else:
        asyncio.run(call(middleware, scope()))
    assert bool([record for record in caplog.records if record.name == "edgelab.http"]) is expected


def test_exception_formatters_omit_sql_bound_parameters_and_exception_messages():
    try:
        raise StatementError("PRIVATE-MESSAGE", "INSERT INTO accounts VALUES ('PRIVATE-SQL')",
                             {"token": "PRIVATE-PARAM"}, RuntimeError("PRIVATE-DRIVER"))
    except StatementError:
        record = logging.LogRecord("edgelab.db", logging.ERROR, __file__, 1,
                                   "database request failed", (), sys.exc_info())
    for formatter in (obs.JsonLogFormatter(), obs.SafeTextLogFormatter("%(message)s")):
        formatted = formatter.format(record)
        assert "StatementError" in formatted
        assert "PRIVATE-" not in formatted and "INSERT INTO" not in formatted


class CaptureExporter:
    def __init__(self):
        self.spans = []
    def export(self, spans):
        self.spans.extend(spans)
        return SpanExportResult.SUCCESS
    def shutdown(self):
        pass
    def force_flush(self, timeout_millis=30000):
        return True


def test_otlp_export_sanitizes_sensitive_text_and_preserves_route_ids_and_timing():
    context = trace.SpanContext(1, 2, False, trace.TraceFlags(1), trace.TraceState([("vendor", "PRIVATE-TRACE-STATE")]))
    parent = trace.SpanContext(1, 3, True, trace.TraceFlags(1), trace.TraceState([("vendor", "PRIVATE-PARENT-STATE")]))
    exporter = CaptureExporter()
    common = dict(context=context, parent=parent, resource=Resource({
        "service.name": "edgelab-api", "service.namespace": "edgelab", "deployment.environment": "test",
        "telemetry.sdk.name": "opentelemetry", "telemetry.sdk.language": "python", "telemetry.sdk.version": "1.28.2",
        "cloud.account.id": "PRIVATE-RESOURCE-SECRET", "process.command_args": ["PRIVATE-COMMAND"]}),
                  start_time=100, end_time=200, instrumentation_scope=InstrumentationScope("test"),
                  status=trace.Status(trace.StatusCode.ERROR, "PRIVATE-STATUS"), events=[
                      Event("PRIVATE-EVENT", {"payload": "PRIVATE-EVENT-VALUE"}, 125),
                      Event("exception", {"exception.type": "ValueError", "exception.message": "PRIVATE-MESSAGE",
                                          "exception.stacktrace": "PRIVATE-STACK"}, 150)])
    spans = [ReadableSpan("GET /PRIVATE-PATH?token=PRIVATE-QUERY", attributes={
        "http.method": "GET", "http.route": "/api/items/{item_id}", "http.status_code": 500,
        "url.full": "https://PRIVATE-URL/?token=PRIVATE-TOKEN", "http.target": "/PRIVATE-PATH",
        "http.request.header.authorization": "Bearer PRIVATE-AUTH", "net.peer.ip": "192.0.2.213"}, **common),
        ReadableSpan("SELECT PRIVATE-SQL", attributes={"db.system": "sqlite",
            "db.statement": "SELECT * FROM secret WHERE token='PRIVATE-PARAM'"}, **common),
        ReadableSpan("PRIVATE-PATH http send", attributes={"asgi.event.type": "http.response.body"}, **common),
        ReadableSpan("PRIVATE-NON-HTTP-NAME", attributes={}, **common)]
    assert obs.SanitizingSpanExporter(exporter).export(spans) == SpanExportResult.SUCCESS
    assert [span.name for span in exporter.spans] == ["GET /api/items/{item_id}", "SELECT", "asgi", "internal"]
    for span in exporter.spans:
        for actual, original in ((span.context, context), (span.parent, parent)):
            assert (actual.trace_id, actual.span_id, actual.is_remote, actual.trace_flags) == (
                original.trace_id, original.span_id, original.is_remote, original.trace_flags)
            assert list(actual.trace_state.items()) == []
        assert dict(span.resource.attributes) == {
            "service.name": "edgelab-api", "service.namespace": "edgelab", "deployment.environment": "test",
            "telemetry.sdk.name": "opentelemetry", "telemetry.sdk.language": "python", "telemetry.sdk.version": "1.28.2"}
        assert (span.start_time, span.end_time) == (100, 200)
        assert span.status.status_code == trace.StatusCode.ERROR and span.status.description is None
        assert [(event.name, dict(event.attributes), event.timestamp) for event in span.events] == [
            ("exception", {"exception.type": "ValueError"}, 150)]
    wire = encode_spans(exporter.spans).SerializeToString()
    assert b"PRIVATE-" not in wire and b"192.0.2.213" not in wire
    assert b"/api/items/{item_id}" in wire


def test_sampled_remote_parent_cannot_override_zero_local_trace_ratio(monkeypatch):
    providers = []
    monkeypatch.setattr(obs, "_OWNED_TRACER_PROVIDER", None)
    monkeypatch.setattr(obs, "_OWNED_TRACER_CONFIG", None)
    monkeypatch.setattr(obs.trace, "get_tracer_provider", lambda: providers[0] if providers else object())
    monkeypatch.setattr(obs.trace, "set_tracer_provider", providers.append)
    monkeypatch.setattr(obs, "BoundedOTLPSpanExporter", lambda **kwargs: CaptureExporter())
    status = obs.configure_tracing(service_name="edgelab-test", otlp_endpoint="http://localhost:4318/v1/traces", sample_ratio=0)
    assert status.enabled is True and len(providers) == 1
    provider = providers[0]
    try:
        remote = trace.SpanContext(1, 2, True, trace.TraceFlags(1))
        context = trace.set_span_in_context(trace.NonRecordingSpan(remote))
        with provider.get_tracer("remote-parent-test").start_as_current_span("request", context=context) as span:
            assert span.is_recording() is False
            assert span.get_span_context().trace_flags.sampled is False
        assert obs.configure_tracing(service_name="edgelab-test", otlp_endpoint="http://localhost:4318/v1/traces", sample_ratio=0).enabled
        assert len(providers) == 1
        with pytest.raises(ValueError, match="EdgeLab-owned sanitized pipeline"):
            obs.configure_tracing(service_name="edgelab-test", otlp_endpoint="http://localhost:4318/v1/traces", sample_ratio=1)
    finally:
        provider.shutdown()


def test_preexisting_foreign_provider_rejected_before_instrumentation(monkeypatch):
    provider = obs.TracerProvider()
    calls = []
    monkeypatch.setattr(obs, "_OWNED_TRACER_PROVIDER", None)
    monkeypatch.setattr(obs, "_OWNED_TRACER_CONFIG", None)
    monkeypatch.setattr(obs.trace, "get_tracer_provider", lambda: provider)
    monkeypatch.setattr(provider, "add_span_processor", lambda processor: calls.append("processor"))
    monkeypatch.setattr(obs.FastAPIInstrumentor, "instrument_app", lambda *args, **kwargs: calls.append("fastapi"))
    monkeypatch.setattr(obs.SQLAlchemyInstrumentor, "instrument", lambda *args, **kwargs: calls.append("sql"))
    try:
        with pytest.raises(ValueError, match="EdgeLab-owned sanitized pipeline"):
            obs.configure_tracing(service_name="edgelab-test", otlp_endpoint="http://localhost:4318/v1/traces",
                                  app=object(), sql_engines=(object(),))
        assert calls == []
    finally:
        provider.shutdown()


@pytest.mark.parametrize("status", [503, 307])
def test_otlp_collector_failures_attempt_once_without_body_logs_or_redirect(status, caplog):
    paths = []
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass
        def do_POST(self):
            paths.append(self.path)
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            body = b"PRIVATE-COLLECTOR-BODY"
            self.send_response(status if self.path == "/v1/traces" else 200, "PRIVATE-REASON")
            if status == 307:
                self.send_header("Location", f"http://127.0.0.1:{self.server.server_port}/target")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    caplog.set_level(logging.INFO)
    exporter = obs.BoundedOTLPSpanExporter(endpoint=f"http://127.0.0.1:{server.server_port}/v1/traces",
        headers={"authorization": "Bearer PRIVATE-CREDENTIAL"}, timeout=0.2, compression=obs.Compression.NoCompression)
    span = ReadableSpan("internal", context=trace.SpanContext(1, 2, False, trace.TraceFlags(1)),
                        start_time=100, end_time=200, resource=Resource({"service.name": "test"}))
    try:
        started = monotonic()
        assert obs.SanitizingSpanExporter(exporter).export([span]) == SpanExportResult.FAILURE
        assert monotonic() - started < 1
        assert paths == ["/v1/traces"]
        assert "PRIVATE-" not in caplog.text
    finally:
        exporter.shutdown()
        server.shutdown()
        server.server_close()
        thread.join(timeout=1)


def test_delayed_export_does_not_block_requests_and_shutdown_drops_queued_spans(monkeypatch):
    began, release = ThreadEvent(), ThreadEvent()
    class DelayedExporter(CaptureExporter):
        def export(self, spans):
            self.spans.extend(spans)
            began.set()
            assert release.wait(3)
            return SpanExportResult.SUCCESS
    metrics = obs.HttpMetricsRegistry()
    monkeypatch.setattr(obs, "http_metrics", metrics)
    exporter = DelayedExporter()
    wrapper = obs.SanitizingSpanExporter(exporter)
    processor = obs.BoundedBatchSpanProcessor(wrapper, shutdown_timeout_seconds=0.1,
        max_queue_size=4, max_export_batch_size=1, schedule_delay_millis=100,
        export_timeout_millis=100)
    provider = obs.TracerProvider()
    provider.add_span_processor(processor)
    tracer = provider.get_tracer("delayed-test")
    try:
        with tracer.start_as_current_span("first"):
            pass
        assert began.wait(1)
        async def app(request_scope, receive, send):
            with tracer.start_as_current_span("request"):
                await JSONResponse({"ok": True})(request_scope, receive, send)
        started = monotonic()
        assert asyncio.run(call(app, scope()))[0]["status"] == 200
        with tracer.start_as_current_span("queued"):
            pass
        assert monotonic() - started < 0.2
        assert len(processor.queue) == 2
        started = monotonic()
        processor.shutdown()
        assert 0.08 <= monotonic() - started < 0.5
        assert processor.worker_thread.is_alive() and wrapper.stopped.is_set()
        release.set()
        processor.worker_thread.join(timeout=1)
        assert not processor.worker_thread.is_alive() and len(processor.queue) == 0
        assert len(exporter.spans) == 1
        assert sample(metrics, "edgelab_trace_export_batches_total", {"outcome": "shutdown_drop"}) == 2
    finally:
        release.set()
        processor.worker_thread.join(timeout=1)
        provider.shutdown()


@pytest.mark.parametrize("name,value", [
    ("EDGELAB_METRICS_ENABLED", "maybe"), ("EDGELAB_HTTP_LOG_SAMPLE_RATIO", "nan"),
    ("EDGELAB_HTTP_LOG_SAMPLE_RATIO", "1.1"), ("EDGELAB_HTTP_SLOW_REQUEST_SECONDS", "inf"),
    ("EDGELAB_HTTP_SLOW_REQUEST_SECONDS", "0"), ("EDGELAB_OTEL_MAX_QUEUE_SIZE", "0"),
    ("EDGELAB_OTEL_MAX_BATCH_SIZE", "0"), ("EDGELAB_OTEL_SCHEDULE_DELAY_MS", "-1"),
    ("EDGELAB_OTEL_EXPORT_TIMEOUT_SECONDS", "nan"), ("EDGELAB_OTEL_EXPORT_TIMEOUT_SECONDS", "31"),
    ("EDGELAB_OTEL_SHUTDOWN_TIMEOUT_SECONDS", "nan"), ("EDGELAB_OTEL_SHUTDOWN_TIMEOUT_SECONDS", "16"),
    ("EDGELAB_HTTP_LATENCY_BUCKETS", "0.1,0.1"), ("EDGELAB_HTTP_LATENCY_BUCKETS", "0.2,0.1"),
    ("EDGELAB_HTTP_LATENCY_BUCKETS", "nan,1"), ("EDGELAB_HTTP_LATENCY_BUCKETS", "0,1"),
    ("EDGELAB_HTTP_LATENCY_BUCKETS", ""),
])
def test_invalid_telemetry_bounds_fail_with_variable_name(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(ValueError, match=name):
        obs.TelemetryConfig.from_env()


def test_trace_batch_cannot_exceed_queue(monkeypatch):
    monkeypatch.setenv("EDGELAB_OTEL_MAX_QUEUE_SIZE", "3")
    monkeypatch.setenv("EDGELAB_OTEL_MAX_BATCH_SIZE", "4")
    with pytest.raises(ValueError, match="cannot exceed"):
        obs.TelemetryConfig.from_env()


@pytest.mark.parametrize("ratio", [float("nan"), float("inf"), -0.1, 1.1])
def test_invalid_trace_sampling_ratio_rejected(ratio):
    with pytest.raises(ValueError, match="EDGELAB_OTEL_TRACE_SAMPLE_RATIO"):
        obs.configure_tracing(service_name="edgelab-test", otlp_endpoint="http://localhost:4318/v1/traces", sample_ratio=ratio)


def test_sqlite_pool_checkout_invalidation_and_reuse_keep_gauge_balanced(tmp_path):
    registry = obs.HttpMetricsRegistry()
    engine = create_engine(f"sqlite:///{tmp_path / 'pool.db'}", pool_size=2, max_overflow=1)
    registry.instrument_pool(engine, "transactional")
    registry.instrument_pool(engine, "transactional")
    labels = {"store": "transactional"}
    first = second = None
    try:
        assert sample(registry, "edgelab_db_pool_capacity", labels) == 3
        assert sample(registry, "edgelab_db_pool_checked_out", labels) == 0
        first, second = engine.connect(), engine.connect()
        first.execute(select(1))
        second.execute(select(1))
        assert sample(registry, "edgelab_db_pool_checked_out", labels) == 2
        second.invalidate()
        assert sample(registry, "edgelab_db_pool_checked_out", labels) == 1
        second.close()
        assert sample(registry, "edgelab_db_pool_checked_out", labels) == 1
        first.close()
        assert sample(registry, "edgelab_db_pool_checked_out", labels) == 0
        with engine.connect() as reused:
            reused.execute(select(1))
            assert sample(registry, "edgelab_db_pool_checked_out", labels) == 1
        assert sample(registry, "edgelab_db_pool_checked_out", labels) == 0
    finally:
        if second is not None:
            second.close()
        if first is not None:
            first.close()
        engine.dispose()


def test_sqlite_primary_and_separate_market_connections_keep_configured_native_lock_timeout(tmp_path):
    script = """import json
from app.db import engine, init_db
from app.market_data_db import market_data_engine, init_market_data_db
init_db()
init_market_data_db()
timeouts = []
for store in (engine, market_data_engine):
    native = store.raw_connection()
    try:
        timeouts.append(native.execute('PRAGMA busy_timeout').fetchone()[0])
    finally:
        native.close()
print(json.dumps({'timeouts': timeouts, 'separate': engine is not market_data_engine}))
"""
    environment = dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parents[1]),
        DATABASE_URL=f"sqlite:///{tmp_path / 'primary.db'}",
        EDGELAB_MARKET_DATA_DATABASE_URL=f"sqlite:///{tmp_path / 'market.db'}",
        EDGELAB_DB_SQLITE_LOCK_TIMEOUT_SECONDS="3.25")
    result = subprocess.run([sys.executable, "-c", script], env=environment,
                            capture_output=True, text=True, timeout=10, check=True)
    assert json.loads(result.stdout) == {"timeouts": [3250, 3250], "separate": True}


def test_multiprocess_metrics_aggregate_and_dead_gauges_and_restart_are_isolated(tmp_path):
    first_dir, restart_dir = tmp_path / "first", tmp_path / "restart"
    for directory in (first_dir, restart_dir):
        directory.mkdir(mode=0o700)
        assert stat.S_IMODE(directory.stat().st_mode) == 0o700
    producer = """import json, os, sys
from app.observability import http_metrics
count, duration, active = int(sys.argv[1]), float(sys.argv[2]), int(sys.argv[3])
for _ in range(count):
    http_metrics.observe_request(method='GET', route='/api/trades', status_code=200, duration_seconds=duration)
for _ in range(active):
    http_metrics.begin_request()
print(json.dumps({'pid': os.getpid()}))
"""
    collector = """import json, sys
from app.observability import http_metrics
from prometheus_client import multiprocess
for pid in sys.argv[1:]:
    multiprocess.mark_process_dead(int(pid))
print(json.dumps({'metrics': http_metrics.render()}))
"""
    def environment(directory):
        return dict(os.environ, PROMETHEUS_MULTIPROC_DIR=str(directory),
                    PYTHONPATH=str(Path(__file__).resolve().parents[1]))
    def collect(directory, *dead):
        result = subprocess.run([sys.executable, "-c", collector, *map(str, dead)],
                                env=environment(directory), capture_output=True, text=True, timeout=10, check=True)
        return json.loads(result.stdout)["metrics"]
    def value(text, name, labels=None):
        for family in text_string_to_metric_families(text):
            for metric in family.samples:
                if metric.name == name and metric.labels == (labels or {}):
                    return metric.value
        return None
    processes = [subprocess.Popen([sys.executable, "-c", producer, str(count), str(duration), str(active)],
        env=environment(first_dir), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        for count, duration, active in ((3, 0.1, 2), (5, 0.2, 3))]
    try:
        pids = []
        for process in processes:
            output, error = process.communicate(timeout=10)
            assert process.returncode == 0, error
            pids.append(json.loads(output)["pid"])
        rendered = collect(first_dir)
        labels = {"method": "GET", "route": "/api/trades"}
        assert value(rendered, "edgelab_http_requests_total", labels | {"status": "200"}) == 8
        assert value(rendered, "edgelab_http_request_duration_seconds_count", labels) == 8
        assert value(rendered, "edgelab_http_request_duration_seconds_sum", labels) == pytest.approx(1.3)
        assert value(rendered, "edgelab_http_request_duration_seconds_bucket", labels | {"le": "0.1"}) == 3
        assert value(rendered, "edgelab_http_in_flight_requests") == 5
        assert value(collect(first_dir, pids[0]), "edgelab_http_in_flight_requests") == 3
        after_death = collect(first_dir, pids[1])
        assert value(after_death, "edgelab_http_in_flight_requests") == 0
        assert value(after_death, "edgelab_http_requests_total", labels | {"status": "200"}) == 8
        isolated = collect(restart_dir)
        assert value(isolated, "edgelab_http_requests_total", labels | {"status": "200"}) is None
        assert value(isolated, "edgelab_http_in_flight_requests") == 0
        assert first_dir != restart_dir and list(first_dir.glob("counter_*.db"))
    finally:
        for process in processes:
            if process.poll() is None:
                process.kill()
                process.communicate(timeout=5)


def test_server_error_handlers_cannot_bypass_exception_redaction(monkeypatch):
    import io
    import sys
    sink = io.StringIO()
    root = logging.getLogger()
    original_root = (root.handlers[:], root.level)
    names = ("uvicorn.error", "gunicorn.error", "uvicorn.access", "gunicorn.access")
    originals = {name: (logging.getLogger(name).handlers[:], logging.getLogger(name).level,
                        logging.getLogger(name).propagate, logging.getLogger(name).disabled) for name in names}
    monkeypatch.setattr(obs, "_LOGGING_CONFIGURED", False)
    monkeypatch.setattr(sys, "stderr", sink)
    try:
        for name in names:
            logger = logging.getLogger(name)
            logger.handlers = [logging.StreamHandler(sink)]
            logger.propagate = False
        obs.configure_logging()
        try:
            raise RuntimeError("SQL PARAMETERS PRIVATE-BOUND-VALUE")
        except RuntimeError:
            logging.getLogger("uvicorn.error").exception("Exception in ASGI application")
        logging.getLogger("uvicorn.access").warning("GET /callback?code=PRIVATE-CODE")
        output = sink.getvalue()
        assert "PRIVATE-BOUND-VALUE" not in output and "PRIVATE-CODE" not in output
        records = [json.loads(line) for line in output.splitlines()]
        assert len(records) == 1
        assert "RuntimeError" in records[0]["exception"]
        assert records[0]["logger"] == "uvicorn.error"
    finally:
        root.handlers, root.level = original_root
        for name, state in originals.items():
            logger = logging.getLogger(name)
            logger.handlers, logger.level, logger.propagate, logger.disabled = state
