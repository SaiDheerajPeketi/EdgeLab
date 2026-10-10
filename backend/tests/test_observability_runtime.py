import json
import logging

import anyio
from starlette.responses import JSONResponse

import app.observability as observability


def test_request_context_middleware_preserves_request_id_header():
    scope = {
            "type": "http",
            "method": "GET",
            "path": "/ping",
            "headers": [
                (
                    observability.REQUEST_ID_HEADER.lower().encode("ascii"),
                    b"req-123",
                )
            ],
            "query_string": b"",
            "scheme": "http",
            "server": ("testserver", 80),
            "client": ("127.0.0.1", 12345),
            "root_path": "",
            "app": None,
        }

    async def app(scope, receive, send):
        await JSONResponse({"ok": True})(scope, receive, send)

    messages = []
    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}
    async def send(message):
        messages.append(message)

    anyio.run(observability.RequestContextMiddleware(app), scope, receive, send)
    assert messages[0]["status"] == 200
    assert dict(messages[0]["headers"])[b"x-request-id"] == b"req-123"


def test_json_log_formatter_renders_structured_payload():
    formatter = observability.JsonLogFormatter(service_name="edgelab-api")
    record = logging.LogRecord(
        name="edgelab.http",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="request finished",
        args=(),
        exc_info=None,
    )
    record.request_id = "req-1"
    record.trace_id = "trace-1"
    record.__dict__["event"] = "http_request"
    record.__dict__["http.method"] = "GET"
    record.__dict__["http.status_code"] = 200

    payload = json.loads(formatter.format(record))

    assert payload["service.name"] == "edgelab-api"
    assert payload["request_id"] == "req-1"
    assert payload["trace_id"] == "trace-1"
    assert payload["event"] == "http_request"
    assert payload["http.method"] == "GET"
    assert payload["http.status_code"] == 200


def test_configure_tracing_disables_cleanly_without_endpoint():
    status = observability.configure_tracing(service_name="edgelab-api")

    assert status.enabled is False
    assert status.reason == "otlp endpoint not configured"


def test_configure_tracing_handles_missing_sdk(monkeypatch):
    monkeypatch.setattr(observability, "OTEL_SDK_AVAILABLE", False)

    status = observability.configure_tracing(
        service_name="edgelab-api",
        otlp_endpoint="http://tempo:4318/v1/traces",
    )

    assert status.enabled is False
    assert status.reason == "opentelemetry packages unavailable"
    assert status.exporter_endpoint == "http://tempo:4318/v1/traces"
