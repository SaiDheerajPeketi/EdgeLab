import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.routes import router
from app.config import settings
from app.db import init_db


logger = logging.getLogger(__name__)

app = FastAPI(
    title="EdgeLab API",
    description="Find your edge with CSV-powered backtesting, trade journaling, and performance metrics.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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


app.include_router(router, prefix="/api")
