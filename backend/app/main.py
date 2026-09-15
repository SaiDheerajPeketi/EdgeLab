import logging

from fastapi import FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.api.routes import router
from app.config import settings
from app.db import engine, init_db
from app.market_data_db import init_market_data_db, market_data_engine
from app.observability import (
    HTTPMetricsMiddleware,
    HttpMetricsRegistry,
    PROMETHEUS_CONTENT_TYPE,
    RequestContextMiddleware,
    configure_logging,
    configure_tracing,
)
from app.services.integration_secrets import validate_vault_startup


configure_logging(
    log_level=settings.observability_log_level,
    json_logs=settings.observability_json_logs,
    service_name=settings.otel_service_name or "edgelab-api",
)
logger = logging.getLogger(__name__)
http_metrics = HttpMetricsRegistry()


class RequestBodyTooLarge(Exception):
    pass


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
)

app.add_middleware(
    RequestBodyLimitMiddleware,
    max_body_size=settings.max_request_body_bytes,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(HTTPMetricsMiddleware, registry=http_metrics)
app.add_middleware(RequestContextMiddleware)

tracing_status = configure_tracing(
    app=app,
    service_name=settings.otel_service_name or "edgelab-api",
    service_namespace=settings.otel_service_namespace,
    environment=settings.otel_environment,
    otlp_endpoint=settings.otel_exporter_otlp_endpoint,
    otlp_headers=settings.otel_exporter_otlp_headers,
    sample_ratio=settings.otel_trace_sample_ratio,
    sql_engines=(engine, market_data_engine),
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


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled API error")
    detail = "Internal server error"
    return JSONResponse(
        status_code=500,
        content={
            "detail": detail,
            "error": {
                "code": 500,
                "message": detail,
            },
        },
    )


@app.on_event("startup")
def on_startup() -> None:
    validate_vault_startup(settings.environment)
    init_db()
    init_market_data_db()
    if tracing_status.enabled:
        logger.info(
            "OpenTelemetry tracing enabled for %s",
            tracing_status.exporter_endpoint,
        )
    else:
        logger.info("OpenTelemetry tracing disabled: %s", tracing_status.reason)


@app.get("/api/observability/metrics", include_in_schema=False)
def observability_metrics() -> PlainTextResponse:
    return PlainTextResponse(
        http_metrics.render(),
        media_type=PROMETHEUS_CONTENT_TYPE,
    )


app.include_router(router, prefix="/api")
