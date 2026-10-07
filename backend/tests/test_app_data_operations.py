import asyncio
import json as jsonlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import AsyncExitStack
from dataclasses import replace
from datetime import timedelta
from threading import Barrier
from types import SimpleNamespace
from uuid import uuid4
from urllib.parse import unquote, urlsplit

import pytest
from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker
from starlette.background import BackgroundTask
from starlette.responses import JSONResponse, StreamingResponse

from app import auth, models
from app.api import routes
from app.db import Base, get_db
from app.services import app_data_operations as operations


class ASGIClient:
    """Exercise HTTP through the actual app without an optional client package."""

    def __init__(self, app):
        self.app = app

    def request(self, method, url, headers=None, json=None):
        parsed = urlsplit(url)
        messages = []
        sent = False
        encoded_headers = [(key.lower().encode(), value.encode()) for key, value in (headers or {}).items()]
        body = b"" if json is None else jsonlib.dumps(json).encode()
        if json is not None:
            encoded_headers.append((b"content-type", b"application/json"))
        scope = {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.4"}, "method": method, "scheme": "http", "http_version": "1.1", "path": unquote(parsed.path), "raw_path": parsed.path.encode(), "root_path": "", "query_string": parsed.query.encode(), "headers": encoded_headers, "server": ("testserver", 80), "client": ("127.0.0.1", 12345)}

        async def receive():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": body, "more_body": False}
            await asyncio.Event().wait()

        async def send(message):
            messages.append(message)

        async def run():
            try:
                await self.app(scope, receive, send)
            except Exception:
                if not any(item["type"] == "http.response.start" for item in messages):
                    raise

        asyncio.run(run())
        start = next(item for item in messages if item["type"] == "http.response.start")
        response_body = b"".join(item.get("body", b"") for item in messages if item["type"] == "http.response.body")
        return SimpleNamespace(status_code=start["status"], headers={key.decode(): value.decode() for key, value in start["headers"]}, json=lambda: jsonlib.loads(response_body))

    def get(self, url, **kwargs):
        return self.request("GET", url, **kwargs)

    def put(self, url, **kwargs):
        return self.request("PUT", url, **kwargs)

    def post(self, url, **kwargs):
        return self.request("POST", url, **kwargs)

    def options(self, url, **kwargs):
        return self.request("OPTIONS", url, **kwargs)


@pytest.fixture
def context(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'receipts.sqlite'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    monkeypatch.setattr(operations, "SessionLocal", factory)
    beta_settings = replace(routes.settings, deployment_mode="beta", beta_seats_total=2, jwt_secret="receipt-test-secret")
    for module in (auth, routes, operations):
        monkeypatch.setattr(module, "settings", beta_settings)
    monkeypatch.setattr(routes.rate_limiter, "consume", lambda *args, **kwargs: SimpleNamespace(allowed=True))
    headers = []
    owners = []
    with factory() as db:
        for index, status in enumerate(["APPROVED", "APPROVED", "WAITLISTED"]):
            user = models.BetaUser(email=f"receipt-{index}@example.test", name="Receipt owner", provider="email", status=status)
            db.add(user)
            db.flush()
            expires = models.utcnow() + timedelta(hours=1)
            session = models.BetaSession(id=f"receipt-session-{index}", user_id=user.id, expires_at=expires)
            db.add(session)
            owners.append(user.id)
            headers.append({"Authorization": f"Bearer {auth.create_session_token(user.id, session.id, expires)}"})
        db.commit()

    app = FastAPI()
    app.include_router(routes.router, prefix="/api")
    app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

    def dependency():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = dependency
    yield SimpleNamespace(app=app, client=ASGIClient(app), factory=factory, engine=engine, headers=headers, owners=owners)
    engine.dispose()


def reserve(context, key, method="PUT", path="/app-storage/preferences/workspace", owner=0):
    return context.client.post(f"/api/app-data/operations/{key}/reserve", json={"method": method, "path": path}, headers=context.headers[owner])


def recover(context, key, owner=0):
    return context.client.post(f"/api/app-data/operations/{key}/recover", headers=context.headers[owner])


def guarded_headers(context, key, owner=0):
    return {**context.headers[owner], operations.OPERATION_HEADER: key}


def receipt(context, key, owner=0):
    with context.factory() as db:
        return db.get(models.AppDataOperation, (context.owners[owner], key))


def test_real_guarded_save_receipt_and_ordinary_read(context):
    key = str(uuid4())
    response = reserve(context, key)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["status"] == "reserved"
    saved = context.client.put("/api/app-storage/preferences/workspace", json={"value": {"saved": [1, True]}}, headers=guarded_headers(context, key))
    assert saved.status_code == 200
    assert saved.json()["value"] == {"saved": [1, True]}
    recovered = recover(context, key)
    assert recovered.status_code == 200
    assert recovered.headers["cache-control"] == "no-store"
    assert recovered.json()["status"] == "completed"
    assert recovered.json()["http_status"] == 200
    assert recovered.json()["result"] is None
    assert recovered.json()["completed_at"]
    assert "user_id" not in recovered.json()
    read = context.client.get("/api/app-storage/preferences/workspace", headers=context.headers[0])
    assert read.json()["value"] == {"saved": [1, True]}
    duplicate = context.client.put("/api/app-storage/preferences/workspace", json={"value": "duplicate"}, headers=guarded_headers(context, key))
    assert duplicate.status_code == 409
    assert context.client.get("/api/app-storage/preferences/workspace", headers=context.headers[0]).json()["value"] == {"saved": [1, True]}


def test_missing_recovery_tombstone_prevents_delayed_reserve_and_real_write(context):
    key = str(uuid4())
    canceled = recover(context, key).json()
    assert canceled["status"] == "canceled"
    assert canceled["method"] is canceled["path"] is None
    assert reserve(context, key).json() == canceled
    assert context.client.put("/api/app-storage/preferences/workspace", json={"value": "late"}, headers=guarded_headers(context, key)).status_code == 409
    assert context.client.get("/api/app-storage/preferences/workspace", headers=context.headers[0]).json()["value"] is None


def test_reserved_recovery_cancels_and_uuid_binds_method_and_path(context):
    key = str(uuid4())
    assert reserve(context, key).status_code == 200
    assert reserve(context, key).status_code == 200
    assert reserve(context, key, method="DELETE").status_code == 409
    assert reserve(context, key, path="/app-storage/preferences/other").status_code == 409
    assert recover(context, key).json()["status"] == "canceled"
    assert reserve(context, key, method="DELETE").status_code == 409
    assert reserve(context, key, path="/app-storage/preferences/other").status_code == 409
    assert context.client.put("/api/app-storage/preferences/workspace", json={"value": 1}, headers=guarded_headers(context, key)).status_code == 409


def test_identical_uuid_is_private_to_each_owner(context):
    key = str(uuid4())
    reserve(context, key)
    context.client.put("/api/app-storage/preferences/workspace", json={"value": "owner secret"}, headers=guarded_headers(context, key))
    other = recover(context, key, owner=1).json()
    assert other["status"] == "canceled"
    assert other["method"] is other["path"] is other["result"] is None
    assert recover(context, key).json()["status"] == "completed"
    assert context.client.get("/api/app-storage/preferences/workspace", headers=context.headers[1]).json()["value"] is None
    second = str(uuid4())
    assert reserve(context, second, owner=1).status_code == 200
    assert reserve(context, second).status_code == 200


@pytest.mark.parametrize("key", ["garbage", "00000000-0000-0000-0000-000000000000", str(uuid4()).replace("-", ""), "550e8400-e29b-11d4-a716-446655440000"])
def test_malformed_operation_ids_reject_without_receipts(context, key):
    assert reserve(context, key).status_code == 400
    assert recover(context, key).status_code == 400
    assert context.client.put("/api/app-storage/preferences/workspace", json={"value": 1}, headers=guarded_headers(context, key)).status_code == 400
    with context.factory() as db:
        assert list(db.scalars(select(models.AppDataOperation))) == []


@pytest.mark.parametrize("payload,status", [
    ({"method": "put", "path": "/app-storage/x/y"}, 422),
    ({"method": "HEAD", "path": "/app-storage/x/y"}, 422),
    ({"method": "PUT", "path": 1}, 422),
    ({"method": "PUT", "path": "/app-storage/x/y", "extra": True}, 422),
    ({"method": "PUT", "path": ""}, 422),
    ({"method": "PUT", "path": "/" + "x" * 512}, 422),
    ({"method": "POST", "path": "/auth/logout"}, 400),
    ({"method": "GET", "path": "/app-storage/x/y"}, 400),
    ({"method": "GET", "path": "/app-data/export"}, 400),
    ({"method": "PUT", "path": "/../app-storage/x/y"}, 400),
    ({"method": "PUT", "path": "/app-storage/x/y?x=1"}, 400),
    ({"method": "PUT", "path": "/app-storage/x/y#fragment"}, 400),
    ({"method": "PUT", "path": "/app-storage/x\\y"}, 400),
])
def test_reserve_schema_and_supported_paths(context, payload, status):
    key = str(uuid4())
    response = context.client.post(f"/api/app-data/operations/{key}/reserve", json=payload, headers=context.headers[0])
    assert response.status_code == status
    assert receipt(context, key) is None


def test_scope_path_is_decoded_once_not_twice(context):
    key = str(uuid4())
    assert reserve(context, key, path="/app-storage/preferences/%2e%2e").status_code == 200
    response = context.client.put("/api/app-storage/preferences/%252e%252e", json={"value": "literal escaped key"}, headers=guarded_headers(context, key))
    assert response.status_code == 200
    assert response.json()["key"] == "%2e%2e"
    assert receipt(context, key).path == "/app-storage/preferences/%2e%2e"


@pytest.mark.parametrize("mode", ["unapproved", "unauthenticated", "wrong-token"])
def test_receipt_and_guard_require_real_approved_session(context, mode):
    headers = context.headers[2] if mode == "unapproved" else ({} if mode == "unauthenticated" else {"Authorization": "Bearer invalid"})
    key = str(uuid4())
    status = 403 if mode == "unapproved" else 401
    response = context.client.post(f"/api/app-data/operations/{key}/reserve", json={"method": "PUT", "path": "/app-storage/preferences/workspace"}, headers=headers)
    assert response.status_code == status
    # Owner-only recovery remains available without a workspace entitlement.
    response = context.client.post(f"/api/app-data/operations/{key}/recover", headers=headers)
    assert response.status_code == (200 if mode == "unapproved" else 401)
    response = context.client.put("/api/app-storage/preferences/workspace", json={"value": 1}, headers={**headers, operations.OPERATION_HEADER: key})
    assert response.status_code == status
    if mode == "unapproved":
        with context.factory() as db:
            assert db.get(models.AppDataOperation, (context.owners[2], key)).status == "canceled"
    else:
        assert receipt(context, key) is None


def test_validation_failure_finishes_and_no_header_compatibility(context):
    key = str(uuid4())
    reserve(context, key)
    assert context.client.put("/api/app-storage/preferences/workspace", json=[], headers=guarded_headers(context, key)).status_code == 422
    assert recover(context, key).json()["http_status"] == 422
    ordinary = context.client.put("/api/app-storage/preferences/workspace", json={"value": "ordinary"}, headers=context.headers[0])
    assert ordinary.status_code == 200
    with context.factory() as db:
        assert len(list(db.scalars(select(models.AppDataOperation)))) == 1


def test_import_retains_receipts_and_only_real_counts_ack(context):
    old_key, key = str(uuid4()), str(uuid4())
    reserve(context, old_key)
    body = {"app": "edgelab", "version": 1, "tables": {"app_storage": [{"id": 777, "namespace": "private", "key": "secret", "value": {"do_not_store_in_receipt": "private-row-value"}}]}}
    assert reserve(context, key, method="POST", path="/app-data/import").status_code == 200
    response = context.client.post("/api/app-data/import", json=body, headers=guarded_headers(context, key))
    assert response.status_code == 200
    result = response.json()
    assert len(result["summary"]) == 23
    assert result["summary"]["app_storage"] == 1
    assert sum(result["summary"].values()) == 1
    assert result["imported_at"]
    stored = recover(context, key).json()
    assert stored["result"] == result
    assert "private-row-value" not in str(stored)
    assert receipt(context, old_key).status == "reserved"
    assert context.client.get("/api/app-storage/private/secret", headers=context.headers[0]).json()["value"] == {"do_not_store_in_receipt": "private-row-value"}


@pytest.mark.parametrize("race", ["two-claims", "claim-recover"])
def test_database_claim_races_are_atomic_without_timing(context, race):
    key = str(uuid4())
    reserve(context, key)
    barrier = Barrier(2)

    def before_update(connection, cursor, statement, parameters, execution_context, executemany):
        if statement.startswith("UPDATE app_data_operations"):
            barrier.wait(timeout=10)

    event.listen(context.engine, "before_cursor_execute", before_update)

    def claim():
        try:
            operations.claim(context.owners[0], key, "PUT", "/app-storage/preferences/workspace")
            return "claimed"
        except HTTPException as error:
            assert error.status_code == 409
            return "rejected"

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(claim), pool.submit(claim if race == "two-claims" else lambda: operations.recover(context.owners[0], key).status)]
            results = [future.result(timeout=15) for future in futures]
    finally:
        event.remove(context.engine, "before_cursor_execute", before_update)
    if race == "two-claims":
        assert sorted(results) == ["claimed", "rejected"]
        assert receipt(context, key).status == "running"
    else:
        assert results in [["claimed", "running"], ["rejected", "canceled"]]
        assert receipt(context, key).status in {"running", "canceled"}


def operation_request(context, key, path):
    return Request({"type": "http", "method": "PUT", "path": path, "root_path": "", "query_string": b"", "headers": [(name.lower().encode(), value.encode()) for name, value in guarded_headers(context, key).items()]})


async def routed_response(router, request):
    async with AsyncExitStack() as stack:
        for name in ["fastapi_middleware_astack", "fastapi_inner_astack", "fastapi_function_astack"]:
            request.scope[name] = stack
        return await router.routes[0].get_route_handler()(request)


@pytest.mark.parametrize("failure,status", [(HTTPException(status_code=418, detail="finished error"), 418), (RuntimeError("finished internal error"), 500)])
def test_finished_handler_errors_record_only_http_status(context, failure, status):
    key = str(uuid4())
    path = "/app-storage/proof/error/future"
    reserve(context, key, path=path)
    router = APIRouter(route_class=operations.AppDataOperationRoute, dependency_overrides_provider=context.app)

    @router.put(path)
    async def endpoint():
        raise failure

    context.app.include_router(router, prefix="/api")
    assert context.client.put("/api" + path, headers=guarded_headers(context, key)).status_code == status
    row = receipt(context, key)
    assert row.status == "completed"
    assert row.http_status == status
    assert row.result is None


def test_async_cancellation_keeps_running_receipt(context):
    key = str(uuid4())
    path = "/app-storage/proof/canceled/future"
    reserve(context, key, path=path)
    router = APIRouter(route_class=operations.AppDataOperationRoute, dependency_overrides_provider=context.app)

    @router.put(path)
    async def endpoint():
        raise asyncio.CancelledError()

    context.app.include_router(router, prefix="/api")
    with pytest.raises(asyncio.CancelledError):
        context.client.put("/api" + path, headers=guarded_headers(context, key))
    assert receipt(context, key).status == "running"
    assert recover(context, key).json()["status"] == "running"


@pytest.mark.parametrize("mode", ["stream", "background", "background-error"])
def test_receipt_waits_for_stream_and_background_completion(context, mode):
    key = str(uuid4())
    path = "/app-storage/proof/response"
    reserve(context, key, path=path)
    router = APIRouter(route_class=operations.AppDataOperationRoute, dependency_overrides_provider=context.app)

    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()

        async def pending():
            entered.set()
            await release.wait()
            if mode == "background-error":
                raise RuntimeError("Background failed")

        async def stream():
            await pending()
            yield b"finished"

        @router.put(path)
        async def endpoint():
            return StreamingResponse(stream()) if mode == "stream" else JSONResponse({"ok": True}, background=BackgroundTask(pending))

        response = await routed_response(router, operation_request(context, key, path))
        assert receipt(context, key).status == "running"

        async def send(message):
            pass

        async def receive():
            await asyncio.Event().wait()

        task = asyncio.create_task(response({"type": "http", "asgi": {"spec_version": "2.4"}}, receive, send))
        await entered.wait()
        assert receipt(context, key).status == "running"
        release.set()
        if mode == "background-error":
            with pytest.raises(RuntimeError, match="Background failed"):
                await task
        else:
            await task
        row = receipt(context, key)
        assert row.status == "completed"
        assert row.http_status == (500 if mode == "background-error" else 200)

    asyncio.run(scenario())


def test_operation_header_cors_and_shared_rate_limit(context, monkeypatch):
    from app.main import app as production_app

    cors = next(middleware for middleware in production_app.user_middleware if middleware.cls is CORSMiddleware)
    origin = "http://localhost:5173"
    actual_cors_client = ASGIClient(CORSMiddleware(context.app, **{**cors.kwargs, "allow_origins": [origin]}))
    preflight = actual_cors_client.options("/api/app-storage/preferences/workspace", headers={"Origin": origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "authorization,x-edgelab-operation-id"})
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == origin
    assert operations.OPERATION_HEADER.lower() in preflight.headers["access-control-allow-headers"]
    calls = []

    def denied(bucket, **kwargs):
        calls.append((bucket, kwargs))
        return SimpleNamespace(allowed=False, retry_after_seconds=19)

    monkeypatch.setattr(routes.rate_limiter, "consume", denied)
    key = str(uuid4())
    for response in [reserve(context, key), recover(context, key)]:
        assert response.status_code == 429
        assert response.headers["retry-after"] == "19"
    assert len(calls) == 2
    assert all(bucket == f"rate-limit:app-data-operations:user:{context.owners[0]}" for bucket, _ in calls)
    assert all(kwargs["limit"] == routes.APP_DATA_OPERATION_RATE_LIMIT for _, kwargs in calls)
    assert receipt(context, key) is None


@pytest.mark.parametrize("disconnect", [False, True])
def test_asgi_20_disconnect_does_not_complete_unfinished_stream(context, disconnect):
    key = str(uuid4())
    path = "/app-storage/proof/old-asgi"
    reserve(context, key, path=path)
    router = APIRouter(route_class=operations.AppDataOperationRoute, dependency_overrides_provider=context.app)

    async def scenario():
        entered, release, canceled = asyncio.Event(), asyncio.Event(), asyncio.Event()
        background_calls = []

        async def stream():
            entered.set()
            try:
                await release.wait()
                yield b"finished"
            except asyncio.CancelledError:
                canceled.set()
                raise

        async def background():
            background_calls.append("ran")

        @router.put(path)
        async def endpoint():
            return StreamingResponse(stream(), background=BackgroundTask(background))

        response = await routed_response(router, operation_request(context, key, path))

        async def receive():
            await entered.wait()
            if disconnect:
                return {"type": "http.disconnect"}
            await asyncio.Event().wait()

        async def send(message):
            pass

        task = asyncio.create_task(response({"type": "http", "asgi": {"spec_version": "2.0"}}, receive, send))
        await entered.wait()
        assert receipt(context, key).status == "running"
        if not disconnect:
            release.set()
        await task
        assert background_calls == ["ran"]
        row = receipt(context, key)
        if disconnect:
            assert canceled.is_set()
            assert row.status == "running"
            assert row.completed_at is None
        else:
            assert row.status == "completed"
            assert row.http_status == 200

    asyncio.run(scenario())
    assert recover(context, key).json()["status"] == ("running" if disconnect else "completed")


@pytest.mark.parametrize("status", ["running", "canceled"])
def test_receipts_are_not_forgotten_or_unblocked_by_age(context, status):
    key = str(uuid4())
    reserve(context, key)
    if status == "running":
        operations.claim(context.owners[0], key, "PUT", "/app-storage/preferences/workspace")
    else:
        recover(context, key)
    with context.factory() as db:
        row = db.get(models.AppDataOperation, (context.owners[0], key))
        row.created_at = models.utcnow() - timedelta(days=3650)
        db.commit()
    assert recover(context, key).json()["status"] == status
    assert reserve(context, key).json()["status"] == status
    assert context.client.put("/api/app-storage/preferences/workspace", json={"value": "must stay blocked"}, headers=guarded_headers(context, key)).status_code == 409


def test_real_body_limit_http_status_matches_completed_receipt(context):
    from app.main import RequestBodyLimitMiddleware

    context.app.add_middleware(RequestBodyLimitMiddleware, max_body_size=300)
    key = str(uuid4())
    assert reserve(context, key).status_code == 200
    response = context.client.put("/api/app-storage/preferences/workspace", json={"value": "x" * 400}, headers=guarded_headers(context, key))
    assert response.status_code == 413
    row = receipt(context, key)
    assert row.status == "completed"
    assert row.http_status == response.status_code
    assert context.client.get("/api/app-storage/preferences/workspace", headers=context.headers[0]).json()["value"] is None
