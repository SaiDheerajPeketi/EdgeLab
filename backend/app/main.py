import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.api.routes import router
from app.config import settings
from app.db import init_db
from app.market_data_db import init_market_data_db
from app.observability import HTTPMetricsMiddleware, HttpMetricsRegistry, PROMETHEUS_CONTENT_TYPE


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
    init_db()
    init_market_data_db()


@app.get("/api/observability/metrics", include_in_schema=False)
def observability_metrics() -> PlainTextResponse:
    return PlainTextResponse(
        http_metrics.render(),
        media_type=PROMETHEUS_CONTENT_TYPE,
    )


app.include_router(router, prefix="/api")
