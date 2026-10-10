"""Admission must leave threads free for validation and release every response slot."""
import asyncio
import json
from threading import Event, current_thread, main_thread

import anyio.to_thread
from fastapi import Depends, FastAPI
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, field_validator
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import database_request_admission_limits
from app.main import PRIVATE_API_HEADERS, RequestAdmissionMiddleware


def test_limits_use_actual_pool_and_preserve_sqlite_defaults(monkeypatch, tmp_path):
    monkeypatch.setenv("EDGELAB_DB_POOL_SIZE", "99")
    pooled = create_engine(f"sqlite:///{tmp_path / 'limits.db'}", pool_size=3, max_overflow=1)
    static = create_engine("sqlite://", poolclass=StaticPool)
    postgres = create_engine("postgresql+psycopg://fixture:fixture@127.0.0.1/fixture", pool_size=5, max_overflow=10)
    try:
        assert database_request_admission_limits(pooled, thread_tokens=40) == (None, 0)
        assert database_request_admission_limits(pooled, 999, thread_tokens=40) == (8, 2)
        assert database_request_admission_limits(pooled, 1, thread_tokens=40) == (1, 2)
        assert database_request_admission_limits(static, thread_tokens=40) == (None, 0)
        assert database_request_admission_limits(postgres, thread_tokens=40) == (30, 2)
        assert database_request_admission_limits(postgres, 999, thread_tokens=40) == (30, 2)
        assert database_request_admission_limits(postgres, 7, thread_tokens=40) == (7, 2)
        assert database_request_admission_limits(postgres, thread_tokens=10) == (6, 2)
        assert database_request_admission_limits(postgres, thread_tokens=2) == (1, 0)
        assert database_request_admission_limits(postgres, thread_tokens=1) == (1, 0)
        assert database_request_admission_limits(postgres, thread_tokens=float("inf")) == (30, 2)
        with pytest.raises(ValueError, match="zero.*positive"):
            database_request_admission_limits(postgres, -1, thread_tokens=40)
        with pytest.raises(ValueError, match="thread budget.*positive"):
            database_request_admission_limits(postgres, thread_tokens=0)
    finally:
        pooled.dispose()
        static.dispose()
        postgres.dispose()


def test_sync_response_validation_finishes_with_tiny_thread_and_sql_pools(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'admission.db'}", pool_size=1, max_overflow=0,
                           pool_timeout=0.2, connect_args={"check_same_thread": False})
    factory = sessionmaker(bind=engine)
    entered, release, validated = Event(), Event(), Event()
    dependency_calls = []

    def database():
        with factory() as db:
            dependency_calls.append(True)
            db.execute(select(1)).scalar_one()
            yield db

    class Payload(BaseModel):
        answer: int

        @field_validator("answer")
        @classmethod
        def validate_answer(cls, value):
            assert current_thread() is not main_thread()
            assert engine.pool.checkedout() == 1  # Cleanup still follows response validation.
            validated.set()
            return value

    app = FastAPI()
    app.add_middleware(RequestAdmissionMiddleware, max_requests=999, db_engine=engine)

    @app.get("/api/data", response_model=Payload)
    def data(_db=Depends(database)):
        entered.set()
        assert release.wait(3)
        return {"answer": 42}

    async def run():
        limiter = anyio.to_thread.current_default_thread_limiter()
        previous = limiter.total_tokens
        limiter.total_tokens = 2
        first = None
        try:
            first = asyncio.create_task(response_call(app, scope()))
            assert await asyncio.to_thread(entered.wait, 2)
            denied = await asyncio.wait_for(response_call(app, scope()), 1)
            assert denied[0]["status"] == 503
            assert json.loads(denied[1]["body"]) == {"detail": "Service busy. Try again shortly."}
            headers = dict(denied[0]["headers"])
            assert headers[b"retry-after"] == b"1"
            for name, value in PRIVATE_API_HEADERS.items():
                assert headers[name.lower().encode()] == value.encode()
            assert dependency_calls == [True]
            release.set()
            response = await asyncio.wait_for(first, 2)
            assert response[0]["status"] == 200
            assert json.loads(response[1]["body"]) == {"answer": 42}
            assert validated.is_set()
            assert engine.pool.checkedout() == 0
        finally:
            release.set()
            if first is not None and not first.done():
                await first
            limiter.total_tokens = previous

    try:
        asyncio.run(run())
    finally:
        engine.dispose()


def test_bounded_database_checkout_wait_finishes_after_first_response_validation(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'queued.db'}", pool_size=1, max_overflow=0,
                           pool_timeout=1, connect_args={"check_same_thread": False})
    factory = sessionmaker(bind=engine)
    entered, release, waiting = Event(), Event(), Event()
    dependency_calls, steps = [], []

    def database():
        with factory() as db:
            dependency_calls.append(True)
            number = len(dependency_calls)
            db.info["number"] = number
            if number == 2:
                waiting.set()
            db.execute(select(1)).scalar_one()
            steps.append(("acquired", number))
            yield db

    class Payload(BaseModel):
        answer: int

        @field_validator("answer")
        @classmethod
        def validate_answer(cls, value):
            assert current_thread() is not main_thread()
            assert engine.pool.checkedout() == 1
            steps.append(("validated", value))
            return value

    app = FastAPI()
    app.add_middleware(RequestAdmissionMiddleware, max_requests=999, db_engine=engine)

    @app.get("/api/data", response_model=Payload)
    def data(db=Depends(database)):
        if db.info["number"] == 1:
            entered.set()
            assert release.wait(3)
        return {"answer": db.info["number"]}

    async def run():
        limiter = anyio.to_thread.current_default_thread_limiter()
        previous = limiter.total_tokens
        limiter.total_tokens = 4
        requests = []
        try:
            requests.append(asyncio.create_task(response_call(app, scope())))
            assert await asyncio.to_thread(entered.wait, 2)
            requests.append(asyncio.create_task(response_call(app, scope())))
            assert await asyncio.to_thread(waiting.wait, 2)
            assert not requests[1].done()
            assert steps == [("acquired", 1)]
            assert (await asyncio.wait_for(response_call(app, scope()), 1))[0]["status"] == 503
            assert len(dependency_calls) == 2
            release.set()
            responses = await asyncio.wait_for(asyncio.gather(*requests), 2)
            assert [response[0]["status"] for response in responses] == [200, 200]
            assert [json.loads(response[1]["body"]) for response in responses] == [{"answer": 1}, {"answer": 2}]
            assert steps == [("acquired", 1), ("validated", 1), ("acquired", 2), ("validated", 2)]
            assert engine.pool.checkedout() == 0
        finally:
            release.set()
            await asyncio.gather(*requests, return_exceptions=True)
            limiter.total_tokens = previous

    try:
        asyncio.run(run())
    finally:
        engine.dispose()


def scope(path="/api/data", kind="http"):
    return {"type": kind, "path": path, "raw_path": path.encode(), "root_path": "", "query_string": b"",
            "method": "GET", "headers": [], "http_version": "1.1", "scheme": "http", "server": ("fixture", 80),
            "client": ("127.0.0.1", 1), "asgi": {"version": "3.0", "spec_version": "2.3"}}


async def response_call(app, request_scope):
    messages = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    await app(request_scope, receive, _send_to(messages))
    return messages


def _send_to(messages):
    async def send(message):
        messages.append(message)
    return send


def test_health_capacity_is_reserved_bounded_and_non_database_surfaces_bypass(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'probes.db'}", pool_size=3, max_overflow=0)

    async def run():
        entered, release = asyncio.Queue(), asyncio.Event()

        async def app(request_scope, receive, send):
            if request_scope["type"] != "http":
                return
            if request_scope["path"] in {"/api/data", "/api/health", "/api/ready"}:
                await entered.put(request_scope["path"])
                await release.wait()
            await JSONResponse({"ok": True})(request_scope, receive, send)

        admission = RequestAdmissionMiddleware(app, max_requests=1, db_engine=engine)
        tasks = []
        try:
            for path in ["/api/data", "/api/health", "/api/ready"]:
                tasks.append(asyncio.create_task(response_call(admission, scope(path))))
                assert await asyncio.wait_for(entered.get(), 1) == path
            assert (await response_call(admission, scope()))[0]["status"] == 503
            assert (await response_call(admission, scope("/api/health")))[0]["status"] == 503
            assert (await response_call(admission, scope("/api/observability/metrics")))[0]["status"] == 200
            assert (await response_call(admission, scope("/static/app.js")))[0]["status"] == 200
            assert await response_call(admission, scope(kind="websocket")) == []
            assert await response_call(admission, scope(kind="lifespan")) == []
        finally:
            release.set()
            await asyncio.gather(*tasks)
        assert admission.active_requests == admission.active_probes == 0

    try:
        asyncio.run(run())
    finally:
        engine.dispose()


@pytest.mark.parametrize("finish", ["complete", "disconnect", "cancel"])
def test_stream_completion_disconnect_and_cancellation_release_database_and_admission(tmp_path, finish):
    engine = create_engine(f"sqlite:///{tmp_path / 'stream.db'}", pool_size=1, max_overflow=0,
                           connect_args={"check_same_thread": False})
    factory = sessionmaker(bind=engine)

    async def run():
        began, release = asyncio.Event(), asyncio.Event()
        incoming = asyncio.Queue()
        await incoming.put({"type": "http.request", "body": b"", "more_body": False})

        async def app(request_scope, receive, send):
            if request_scope["path"] != "/api/stream":
                await JSONResponse({"ok": True})(request_scope, receive, send)
                return
            with factory() as db:
                db.execute(select(1))

                async def chunks():
                    yield b"first\n"
                    began.set()
                    await release.wait()
                    yield b"last\n"

                await StreamingResponse(chunks())(request_scope, receive, send)

        admission = RequestAdmissionMiddleware(app, max_requests=1, db_engine=engine)
        stream = asyncio.create_task(admission(scope("/api/stream"), incoming.get, _send_to([])))
        try:
            await asyncio.wait_for(began.wait(), 1)
            assert engine.pool.checkedout() == admission.active_requests == 1
            assert (await response_call(admission, scope()))[0]["status"] == 503
            if finish == "complete":
                release.set()
            elif finish == "disconnect":
                await incoming.put({"type": "http.disconnect"})
            else:
                stream.cancel()
            try:
                await asyncio.wait_for(stream, 1)
            except asyncio.CancelledError:
                assert finish == "cancel"
            assert admission.active_requests == engine.pool.checkedout() == 0
            assert (await response_call(admission, scope()))[0]["status"] == 200
        finally:
            release.set()
            if not stream.done():
                stream.cancel()
                await asyncio.gather(stream, return_exceptions=True)

    try:
        asyncio.run(run())
    finally:
        engine.dispose()


def test_downstream_exception_releases_admission(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'failure.db'}", pool_size=1, max_overflow=0)

    async def fail(*_args):
        raise RuntimeError("fixture failure")

    async def run():
        admission = RequestAdmissionMiddleware(fail, max_requests=1, db_engine=engine)
        with pytest.raises(RuntimeError, match="fixture failure"):
            await response_call(admission, scope())
        assert admission.active_requests == 0

    try:
        asyncio.run(run())
    finally:
        engine.dispose()
