"""Compose the shared API package used by primary and market worker services.

Nginx partitions traffic between deployments; routes here keep the same auth,
transaction and error contracts regardless of which worker handles a request.
"""

import logging
from collections import deque
from contextlib import asynccontextmanager

import anyio.to_thread
from fastapi import FastAPI, HTTPException, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy.exc import TimeoutError as DatabasePoolTimeout
from starlette.datastructures import MutableHeaders
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.api.routes import router
from app.api.billing import router as billing_router
from app.config import database_request_admission_limits, settings
from app.db import engine, init_db
from app.market_data_db import init_market_data_db, market_data_engine
from app.observability import (
    HTTPMetricsMiddleware,
    HttpMetricsRegistry,
    PROMETHEUS_CONTENT_TYPE,
    RequestContextMiddleware,
    configure_logging,
    configure_tracing,
    http_metrics,
    telemetry_config,
)
from app.services.integration_secrets import validate_vault_startup


configure_logging(
    log_level=settings.observability_log_level,
    json_logs=settings.observability_json_logs,
    service_name=settings.otel_service_name or "edgelab-api",
)
logger = logging.getLogger(__name__)
http_metrics.instrument_pool(engine, "primary")
if market_data_engine is not engine:
    http_metrics.instrument_pool(market_data_engine, "market")


@asynccontextmanager
async def lifespan(_: FastAPI):
    validate_vault_startup(settings.environment)
    # The container startup script migrates before forking; create_all alone
    # cannot upgrade changed columns in an existing production database.
    init_db()
    init_market_data_db()
    if tracing_status.enabled:
        logger.info(
            "OpenTelemetry tracing enabled",
        )
    else:
        logger.info("OpenTelemetry tracing disabled: %s", tracing_status.reason)
    yield


PRIVATE_API_HEADERS = {
    "Cache-Control": "private, no-store",
    "CDN-Cache-Control": "no-store",
    "Cloudflare-CDN-Cache-Control": "no-store",
}


class RequestAdmissionMiddleware:
    """Admit work before it can occupy threads waiting for database checkouts."""

    def __init__(self, app: ASGIApp, max_requests: int = 0, db_engine=None, admission_config=None,
                 metrics: HttpMetricsRegistry | None = None) -> None:
        self.app = app
        tuning = admission_config if admission_config is not None else settings.request_admission
        thread_tokens = anyio.to_thread.current_default_thread_limiter().total_tokens
        self.limit, self.probe_limit = database_request_admission_limits(
            db_engine if db_engine is not None else engine, max_requests,
            thread_tokens=thread_tokens, admission_config=tuning,
        )
        self.active_requests = 0
        self.active_probes = 0
        self.queue_limit = tuning.queue_depth or self.limit or 0
        self.queue_wait_seconds = tuning.queue_wait_seconds
        self.waiting_requests: deque[anyio.Event] = deque()
        self.metrics = metrics if metrics is not None and metrics.enabled and self.limit is not None else None
        self._metric_gauges = {}
        self._metric_values = {}
        if self.metrics:
            for state, value in (("request", self.limit), ("probe", self.probe_limit), ("queue", self.queue_limit)):
                self.metrics.admission_limit.labels(state).set(value)
                gauge = self.metrics.admission_active.labels(state)
                gauge.set(0)
                self._metric_gauges[state], self._metric_values[state] = gauge, 0

    def _record_state(self) -> None:
        if self.metrics:
            for state, value in (("request", self.active_requests), ("probe", self.active_probes),
                                 ("queue", len(self.waiting_requests))):
                if self._metric_values[state] != value:
                    self._metric_gauges[state].set(value)
                    self._metric_values[state] = value

    async def _admit_request(self, *, wait: bool) -> bool:
        # Checking/reserving never awaits: new arrivals cannot overtake waiters.
        if self.active_requests < self.limit and not self.waiting_requests:
            self.active_requests += 1
            self._record_state()
            return True
        if not wait or self.queue_wait_seconds == 0 or len(self.waiting_requests) >= self.queue_limit:
            return False
        waiter = anyio.Event()
        self.waiting_requests.append(waiter)
        self._record_state()
        queued_at = anyio.current_time()
        admitted = False
        try:
            # Waiting uses only the event loop, preserving worker thread reserves.
            with anyio.move_on_after(self.queue_wait_seconds) as timeout:
                await waiter.wait()
            admitted = not timeout.cancel_called and anyio.current_time() < timeout.deadline
            return admitted
        finally:
            if waiter.is_set():
                if not admitted:
                    # Cancellation/timeout can race with a transferred slot.
                    self._release_request()
            else:
                self.waiting_requests.remove(waiter)
            if self.metrics:
                self.metrics.queue_wait.observe(anyio.current_time() - queued_at)
            self._record_state()

    def _release_request(self) -> None:
        if self.waiting_requests:
            # Transfer the active slot before waking the oldest waiter.
            self.waiting_requests.popleft().set()
        else:
            self.active_requests -= 1
        self._record_state()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get("path", "")
        if (scope["type"] != "http" or self.limit is None or
                not (path == "/api" or path.startswith("/api/")) or path == "/api/observability/metrics"):
            await self.app(scope, receive, send)
            return
        # Database-backed health checks use bounded reserved capacity. An
        # unlimited liveness bypass could itself occupy every worker thread.
        probe_path = path in {"/api/health", "/api/ready"}
        probe = probe_path and self.probe_limit > 0
        if probe:
            admitted = self.active_probes < self.probe_limit
            if admitted:
                self.active_probes += 1
                self._record_state()
        else:
            admitted = await self._admit_request(wait=not probe_path)
        if not admitted:
            if self.metrics:
                self.metrics.admission_rejected.labels("probe_busy" if probe_path else "request_busy").inc()
            await JSONResponse(status_code=503, content={"detail": "Service busy. Try again shortly."},
                               headers={**PRIVATE_API_HEADERS, "Retry-After": "1"})(scope, receive, send)
            return
        try:
            # Hold admission through validation, streaming and DB dependency cleanup.
            await self.app(scope, receive, send)
        finally:
            if probe:
                self.active_probes -= 1
                self._record_state()
            else:
                self._release_request()


class PrivateAPICacheMiddleware:
    """Keep tenant data and authorization results out of browser/shared caches."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope.get("path", "").startswith("/api/"):
            await self.app(scope, receive, send)
            return

        async def private_send(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in PRIVATE_API_HEADERS.items():
                    if name != "Cache-Control" or headers.get(name) != "no-store":
                        headers[name] = value
            await send(message)

        await self.app(scope, receive, private_send)


class RequestBodyTooLarge(HTTPException):
    def __init__(self) -> None:
        super().__init__(status_code=413, detail="Request body too large")


class RequestBodyLimitMiddleware:
    def __init__(self, app: ASGIApp, max_body_size: int) -> None:
        self.app = app
        self.max_body_size = max_body_size

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_body_size:
                    raise RequestBodyTooLarge
            return message

        try:
            await self.app(scope, limited_receive, send)
        except RequestBodyTooLarge:
            detail = "Request body too large"
            response = JSONResponse(
                status_code=413,
                content={
                    "detail": detail,
                    "error": {
                        "code": 413,
                        "message": detail,
                    },
                },
            )
            await response(scope, receive, send)


app = FastAPI(
    title="EdgeLab API",
    description="Find your edge with CSV-powered backtesting, trade journaling, and performance metrics.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    RequestBodyLimitMiddleware,
    max_body_size=settings.max_request_body_bytes,
)
app.add_middleware(RequestAdmissionMiddleware, max_requests=settings.http_request_limit, metrics=http_metrics)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(HTTPMetricsMiddleware, registry=http_metrics)
app.add_middleware(RequestContextMiddleware)
app.add_middleware(PrivateAPICacheMiddleware)

tracing_status = configure_tracing(
    app=app,
    service_name=settings.otel_service_name or "edgelab-api",
    service_namespace=settings.otel_service_namespace,
    environment=settings.otel_environment,
    otlp_endpoint=settings.otel_exporter_otlp_endpoint,
    otlp_headers=settings.otel_exporter_otlp_headers,
    sample_ratio=settings.otel_trace_sample_ratio,
    sql_engines=tuple(dict.fromkeys((engine, market_data_engine))),
)


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(
    request: Request,
    exc: StarletteHTTPException,
) -> JSONResponse:
    detail = "Not found" if exc.status_code == 404 else exc.detail
    if not isinstance(detail, (str, list, dict)):
        detail = str(detail)
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": detail,
            "error": {
                "code": exc.status_code,
                "message": detail,
            },
        },
        headers=exc.headers,
    )


@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(
    request: Request,
    exc: RequestValidationError,
):
    if not request.url.path.startswith("/api/integration-secrets"):
        return await request_validation_exception_handler(request, exc)
    return JSONResponse(
        status_code=422,
        content={"detail": sanitize_secret_validation_errors(exc.errors())},
    )


def sanitize_secret_validation_errors(
    validation_errors: list[dict[str, object]],
) -> list[dict[str, object]]:
    errors = []
    for error in validation_errors:
        sanitized = dict(error)
        sanitized.pop("input", None)
        sanitized.pop("ctx", None)
        errors.append(sanitized)
    return errors


@app.exception_handler(DatabasePoolTimeout)
async def database_pool_timeout_handler(request: Request, exc: DatabasePoolTimeout) -> JSONResponse:
    if http_metrics.enabled:
        http_metrics.pool_timeouts.inc()
    return JSONResponse(
        status_code=503,
        content={"detail": "Service busy. Try again shortly."},
        headers={**PRIVATE_API_HEADERS, "Retry-After": "1"},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    request_id = request.scope.get("edgelab.request_id")
    logger.exception("Unhandled API error", extra={"request_id": request_id})
    detail = "Internal server error"
    return JSONResponse(
        status_code=500,
        headers={**PRIVATE_API_HEADERS, **({"X-Request-ID": request_id} if request_id else {})},
        content={
            "detail": detail,
            "error": {
                "code": 500,
                "message": detail,
            },
        },
    )


@app.get("/api/observability/metrics", include_in_schema=False)
def observability_metrics() -> PlainTextResponse:
    if not telemetry_config.metrics_enabled:
        raise HTTPException(404, "Not found")
    return PlainTextResponse(
        http_metrics.render(),
        media_type=PROMETHEUS_CONTENT_TYPE,
    )


app.include_router(router, prefix="/api")
app.include_router(billing_router, prefix="/api")
