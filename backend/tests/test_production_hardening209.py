import asyncio
import time

import pytest
from fastapi import FastAPI
from types import SimpleNamespace
from sqlalchemy.engine import make_url
from sqlalchemy.exc import TimeoutError as DatabasePoolTimeout

from app.config import (
    database_connect_args,
    database_engine_options,
    default_database_url,
    default_market_data_database_url,
)
from app.main import (
    PRIVATE_API_HEADERS,
    PrivateAPICacheMiddleware,
    database_pool_timeout_handler,
    unhandled_exception_handler,
)


def request(app, path, *, allow_error=False):
    messages = []

    async def invoke():
        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            messages.append(message)

        try:
            await app({"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
                       "method": "GET", "scheme": "http", "path": path, "raw_path": path.encode(),
                       "query_string": b"", "root_path": "", "headers": [],
                       "client": ("127.0.0.1", 1), "server": ("localhost", 80)}, receive, send)
        except Exception:
            if not allow_error:
                raise

    asyncio.run(invoke())
    started = next(message for message in messages if message["type"] == "http.response.start")
    return SimpleNamespace(status_code=started["status"],
        headers={k.decode().lower(): v.decode() for k, v in started["headers"]},
        text=b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body").decode())


def test_compose_credentials_are_escaped_for_both_stores(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("EDGELAB_MARKET_DATA_DATABASE_URL", raising=False)
    monkeypatch.setenv("POSTGRES_USER", "tenant@owner")
    monkeypatch.setenv("POSTGRES_PASSWORD", "p:/@#?% word")
    monkeypatch.setenv("POSTGRES_DB", "isolated")
    monkeypatch.setenv("EDGELAB_POSTGRES_HOST", "transaction-pool")
    monkeypatch.setenv("EDGELAB_POSTGRES_CONNECT_PORT", "6432")
    monkeypatch.setenv("EDGELAB_MARKET_DATA_POSTGRES_HOST", "market-pool")
    monkeypatch.setenv("EDGELAB_MARKET_DATA_POSTGRES_PORT", "6433")
    transactional = make_url(default_database_url())
    market = make_url(default_market_data_database_url())
    assert transactional.username == market.username == "tenant@owner"
    assert transactional.password == market.password == "p:/@#?% word"
    assert transactional.host == "transaction-pool"
    assert market.host == "market-pool"
    assert market.port == 6433
    monkeypatch.setenv("EDGELAB_MARKET_DATA_DATABASE_URL", "sqlite:///explicit.db")
    assert default_market_data_database_url() == "sqlite:///explicit.db"


def test_pool_and_connect_deadlines_bound_invalid_negative_values(monkeypatch):
    monkeypatch.setenv("EDGELAB_DB_POOL_SIZE", "-2")
    monkeypatch.setenv("EDGELAB_DB_POOL_MAX_OVERFLOW", "-1")
    monkeypatch.setenv("EDGELAB_DB_POOL_TIMEOUT_SECONDS", "-3")
    monkeypatch.setenv("EDGELAB_DB_CONNECT_TIMEOUT_SECONDS", "0")
    opts = database_engine_options("postgresql+psycopg://example/db")
    assert opts["pool_size"] == 1
    assert opts["max_overflow"] == 0
    assert opts["pool_timeout"] == 0.1
    assert database_connect_args("postgresql+psycopg://example/db")["connect_timeout"] == 1
    assert database_engine_options("sqlite:///test.db") == {"pool_pre_ping": True}


@pytest.mark.parametrize("path,status", [("/api/account", 200), ("/api/auth", 401), ("/api/missing", 404)])
def test_api_cannot_advertise_public_cacheability(path, status):
    from fastapi.responses import JSONResponse
    app = FastAPI()
    app.add_middleware(PrivateAPICacheMiddleware)
    if status != 404:
        @app.get(path)
        def endpoint():
            return JSONResponse({"tenant": "private"}, status_code=status,
                                headers={"Cache-Control": "public, max-age=3600"})
    response = request(app, path)
    assert response.status_code == status
    for name, value in PRIVATE_API_HEADERS.items():
        assert response.headers[name.lower()] == value


def test_public_assets_keep_cache_policy():
    from fastapi.responses import Response
    app = FastAPI()
    app.add_middleware(PrivateAPICacheMiddleware)
    @app.get("/assets/app.js")
    def asset():
        return Response("code", headers={"Cache-Control": "public, max-age=31536000"})
    response = request(app, "/assets/app.js")
    assert response.headers["cache-control"] == "public, max-age=31536000"
    assert "cdn-cache-control" not in response.headers


def test_pool_exhaustion_and_unhandled_errors_remain_private():
    app = FastAPI()
    app.add_middleware(PrivateAPICacheMiddleware)
    app.add_exception_handler(DatabasePoolTimeout, database_pool_timeout_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
    @app.get("/api/busy")
    def busy():
        raise DatabasePoolTimeout("secret database details")
    @app.get("/api/failure")
    def failure():
        raise RuntimeError("secret server details")
    busy = request(app, "/api/busy")
    failure = request(app, "/api/failure", allow_error=True)
    assert busy.status_code == 503
    assert busy.headers["retry-after"] == "1"
    assert failure.status_code == 500
    for response in (busy, failure):
        assert "secret" not in response.text
        assert response.headers["cache-control"] == "private, no-store"


def test_initial_socket_authorization_does_not_block_other_tasks(monkeypatch):
    from fastapi import HTTPException
    from app.api import routes

    class Socket:
        async def accept(self):
            pass

        async def receive_json(self):
            return {"authToken": "test"}

        async def close(self, **kwargs):
            assert kwargs["code"] == 4401

    class Session:
        def close(self):
            pass

    def slow_verification(_token):
        time.sleep(0.15)
        raise HTTPException(status_code=401, detail="expired")

    monkeypatch.setattr(routes, "SessionLocal", Session)
    monkeypatch.setattr(routes, "verify_stream_access", slow_verification)

    async def check():
        task = asyncio.create_task(routes.dataset_stream(Socket()))
        await asyncio.sleep(0.02)
        assert not task.done(), "Blocking verification starved the event-loop timer"
        await task

    asyncio.run(check())


def test_dataset_pool_timeout_preserves_retry_contract():
    from app.api.routes import dataset_error_response
    error = dataset_error_response(DatabasePoolTimeout("private connection detail"))
    assert error.status_code == 503
    assert error.headers == {"Retry-After": "1"}
    assert "private" not in error.detail


def test_single_store_reuses_engine_and_transaction(monkeypatch):
    from app import market_data_db
    expected = market_data_db.application_engine
    def separate_engine(*args, **kwargs):
        raise AssertionError("A shared store must retain the caller transaction")
    monkeypatch.setattr(market_data_db, "create_engine", separate_engine)
    assert market_data_db._engine_for_url(market_data_db.settings.database_url) is expected


def test_alembic_handles_encoded_password(monkeypatch):
    import contextlib
    import runpy
    from pathlib import Path
    from alembic import context
    from alembic.config import Config
    url = "postgresql+psycopg://fixture:escaped%40%3A%2F@localhost/fixture"
    config = Config()
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setattr(context, "config", config, raising=False)
    monkeypatch.setattr(context, "is_offline_mode", lambda: True)
    monkeypatch.setattr(context, "configure", lambda **kwargs: None)
    monkeypatch.setattr(context, "begin_transaction", contextlib.nullcontext)
    monkeypatch.setattr(context, "run_migrations", lambda: None)
    runpy.run_path(str(Path(__file__).parents[1] / "alembic/env.py"))
    assert config.get_main_option("sqlalchemy.url") == url
