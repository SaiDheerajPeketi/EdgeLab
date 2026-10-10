"""Personal access through real database, JWT and HTTP/WebSocket boundaries."""
import asyncio
from dataclasses import replace
from datetime import timedelta
import json
import os
from pathlib import Path
import subprocess
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Request
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import auth, models
from app.api import routes
from app.config import settings as defaults
from app.db import Base, get_db
from app.main import app
from app.personal_access import PERSONAL_EMAIL, PersonalAccessMiddleware, validate_personal_settings
from app.schemas import BetaAccessRequest, GoogleAuthExchangeRequest
from app.services import access_policy, billing


@pytest.fixture
def personal(monkeypatch):
    settings = replace(defaults, deployment_mode="personal", environment="development",
        public_origin="http://localhost:8080", cors_origins=("http://localhost:8080",),
        personal_proxy_secret="personal-proxy-fixture-key-32-characters", jwt_secret="personal-jwt-fixture",
        billing_enabled=False, google_client_id="", google_client_secret="",
        beta_manual_access_enabled=True, dev_auth_bypass_enabled=False)
    validate_personal_settings(settings)
    for module in (auth, routes):
        monkeypatch.setattr(module, "settings", settings)
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    def database():
        with factory() as db:
            yield db
    original = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = database
    monkeypatch.setattr(routes, "SessionLocal", factory)
    yield SimpleNamespace(settings=settings, factory=factory, app=PersonalAccessMiddleware(app, settings))
    app.dependency_overrides.clear()
    app.dependency_overrides.update(original)
    engine.dispose()


def scope(path="/api/auth/dev/bypass", *, kind="http", method="POST", peer="172.20.0.3", host="localhost:8080", headers=()):
    return {"type": kind, "asgi": {"version": "3.0", "spec_version": "2.4"},
            "method": method, "scheme": "http" if kind == "http" else "ws", "http_version": "1.1",
            "path": path, "raw_path": path.encode(), "root_path": "", "query_string": b"",
            "headers": [(b"host", host.encode()), *headers], "server": ("localhost", 8080),
            "client": (peer, 12345)}


def call(asgi_app, request_scope, body=b""):
    messages = []
    delivered = False
    async def receive():
        nonlocal delivered
        if not delivered:
            delivered = True
            return {"type": "http.request", "body": body, "more_body": False}
        await asyncio.Event().wait()
    async def send(message):
        messages.append(message)
    asyncio.run(asgi_app(request_scope, receive, send))
    return messages


def http(personal, path, *, method="GET", token=None, headers=(), peer="172.20.0.3", host="localhost:8080"):
    if token:
        headers = (*headers, (b"authorization", f"Bearer {token}".encode()))
    messages = call(personal.app, scope(path, method=method, peer=peer, host=host, headers=headers))
    start = next(item for item in messages if item["type"] == "http.response.start")
    body = b"".join(item.get("body", b"") for item in messages if item["type"] == "http.response.body")
    return start["status"], json.loads(body)


def proxy_key(personal):
    return ((b"x-edgelab-personal-key", personal.settings.personal_proxy_secret.encode()),)


def login(personal):
    status, result = http(personal, "/api/auth/dev/bypass", method="POST", headers=proxy_key(personal))
    assert status == 200, result
    return result["session"]


def test_personal_fixed_identity_workspace_export_and_expiry_without_billing(personal, monkeypatch):
    monkeypatch.setattr(billing.BillingConfig, "from_settings", classmethod(lambda cls: pytest.fail("Personal access must not consult Stripe")))
    monkeypatch.setattr(access_policy, "sync_beta", lambda *_: pytest.fail("Personal access must not enroll beta seats"))
    first = login(personal)
    second = login(personal)
    assert first["user"]["id"] == second["user"]["id"]
    user = first["user"]
    assert user["email"] == PERSONAL_EMAIL
    assert user["workspace_access"] and user["plan"] == "personal"
    assert user["deployment_mode"] == "personal" and not user["is_beta_user"]
    assert user["beta_position"] is None
    assert user["access_expires_at"] == first["expires_at"]
    key = proxy_key(personal)
    token = first["token"]
    for path in ("/api/auth/session", "/api/bootstrap-shell", "/api/app-data/export"):
        status, result = http(personal, path, token=token, headers=key)
        assert status == 200, (path, result)
    stream_user = routes.verify_stream_access(token)
    assert stream_user.access_expires_at == stream_user.session_expires_at
    with personal.factory() as db:
        assert len(db.scalars(select(models.BetaUser)).all()) == 1
        session = db.get(models.BetaSession, auth._decode_jwt(token)["session_id"])
        session.expires_at = models.utcnow() - timedelta(seconds=1)
        db.commit()
    assert http(personal, "/api/app-data/export", token=token, headers=key)[0] == 401


def test_personal_config_and_signup_have_only_local_identity(personal, monkeypatch):
    status, conf = http(personal, "/api/auth/config", headers=proxy_key(personal))
    assert status == 200 and conf["dev_auth_bypass_enabled"]
    assert not conf["google_enabled"] and not conf["manual_access_enabled"]
    assert conf["auth_provider"] == "legacy"
    monkeypatch.setattr(routes, "fetch_google_token_payload", lambda *_: pytest.fail("Google must not be contacted"))
    with personal.factory() as db:
        for function in (lambda: routes.beta_access(BetaAccessRequest(email="arbitrary@example.com"), db),
                         lambda: routes.grant_beta_access_response(db, email="arbitrary@example.com", name="Other", provider="email"),
                         lambda: routes.exchange_google_auth_code(GoogleAuthExchangeRequest(code="code", redirect_uri="http://localhost/callback"), db),
                         lambda: routes.exchange_better_auth_session(Request(scope()), db)):
            with pytest.raises(HTTPException) as error:
                function()
            assert error.value.status_code == 403
        assert db.scalars(select(models.BetaUser)).all() == []
        foreign = models.BetaUser(email="arbitrary@example.com", provider="email", status="APPROVED")
        db.add(foreign)
        db.flush()
        foreign_session = routes.issue_beta_session(db, foreign)
        db.commit()
        assert not foreign_session.user.workspace_access
        with pytest.raises(HTTPException) as error:
            auth.authenticate_token(db, foreign_session.token)
        assert error.value.status_code == 401
        with pytest.raises(HTTPException):
            auth.authenticate_token(db, "ba:foreign")


@pytest.mark.parametrize("kind", ["http", "websocket"])
@pytest.mark.parametrize("peer,host,headers,allowed", [
    ("127.0.0.1", "localhost:8080", (), True),
    ("::1", "[::1]:8080", (), True),
    ("203.0.113.4", "localhost", (), False),
    ("203.0.113.4", "localhost", ((b"x-forwarded-for", b"127.0.0.1"),), False),
    ("203.0.113.4", "remote.example", ((b"x-forwarded-host", b"localhost"),), False),
    ("127.0.0.1", "remote.example", (), False),
    ("127.0.0.1", "0.0.0.0", (), False),
    ("172.20.0.3", "localhost", ((b"x-edgelab-personal-key", b"invalid"),), False),
    ("127.0.0.1", "localhost/", (), False),
])
def test_personal_every_http_and_websocket_has_loopback_guard(personal, kind, peer, host, headers, allowed):
    called = []
    async def downstream(request_scope, receive, send):
        called.append(request_scope)
    middleware = PersonalAccessMiddleware(downstream, personal.settings)
    messages = call(middleware, scope(kind=kind, peer=peer, host=host, headers=headers))
    assert bool(called) is allowed
    if not allowed:
        if kind == "websocket":
            assert messages == [{"type": "websocket.close", "code": 4403}]
        else:
            assert messages[0]["status"] == 403


@pytest.mark.parametrize("kind", ["http", "websocket"])
def test_personal_proxy_secret_admits_only_loopback_host(personal, kind):
    called = []
    async def downstream(request_scope, receive, send):
        called.append(True)
    middleware = PersonalAccessMiddleware(downstream, personal.settings)
    assert call(middleware, scope(kind=kind, headers=proxy_key(personal))) == []
    assert called == [True]
    messages = call(middleware, scope(kind=kind, host="remote.example", headers=proxy_key(personal)))
    assert len(called) == 1 and messages


@pytest.mark.parametrize("path,method,allowed", [
    ("/api/health", "GET", True), ("/api/health", "POST", False),
    ("/api/ready", "GET", False), ("/api/observability/metrics", "GET", False),
    ("/api/app-data/export", "GET", False), ("/api/auth/dev/bypass", "POST", False),
])
def test_health_probe_exemption_cannot_reach_identity_data_or_metrics(personal, path, method, allowed):
    called = []
    async def downstream(request_scope, receive, send):
        called.append(True)
    messages = call(PersonalAccessMiddleware(downstream, personal.settings), scope(path, method=method))
    assert bool(called) is allowed
    if not allowed:
        assert messages[0]["status"] == 403


@pytest.mark.parametrize("changes", [
    {"environment": "production"}, {"public_origin": "https://edgelab.example"},
    {"public_origin": "http://0.0.0.0:8080"}, {"public_origin": "http://localhost@remote.example"},
    {"cors_origins": ("http://localhost:8080", "https://remote.example")},
    {"cors_origins": ("*",)}, {"cors_origins": ()},
    {"personal_proxy_secret": "short"}, {"personal_proxy_secret": ""},
])
def test_unsupported_personal_configuration_fails(personal, changes):
    with pytest.raises(ValueError):
        validate_personal_settings(replace(personal.settings, **changes))


def test_runtime_config_copy_preserves_proxy_secret_and_rejects_production_at_import():
    env = {**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1]),
           "EDGELAB_DEPLOYMENT_MODE": "personal", "EDGELAB_ENVIRONMENT": "development",
           "EDGELAB_PUBLIC_ORIGIN": "http://localhost:8080", "CORS_ORIGINS": "http://localhost:8080",
           "EDGELAB_PERSONAL_PROXY_SECRET": "personal-proxy-fixture-key-32-characters", "GOOGLE_REDIRECT_URI": ""}
    result = subprocess.run([os.sys.executable, "-c", "from app.config import settings; assert len(settings.personal_proxy_secret) >= 32; assert settings.google_redirect_uri"], env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    env["EDGELAB_ENVIRONMENT"] = "production"
    result = subprocess.run([os.sys.executable, "-c", "from app.config import settings"], env=env, capture_output=True, text=True)
    assert result.returncode != 0 and "requires EDGELAB_ENVIRONMENT=development" in result.stderr


@pytest.mark.parametrize("deployment", ["production", "beta"])
def test_personal_free_identity_never_gains_nonpersonal_paid_export(personal, monkeypatch, deployment):
    session = login(personal)
    monkeypatch.setattr(auth, "settings", replace(personal.settings, deployment_mode=deployment))
    monkeypatch.setattr(billing.BillingConfig, "from_settings", classmethod(lambda cls: billing.BillingConfig()))
    with personal.factory() as db:
        user = db.get(models.BetaUser, session["user"]["id"])
        current = auth.AuthenticatedUser(user.id, user.email, user.name, "email", False, None,
            "fixture", models.utcnow(), models.utcnow() + timedelta(hours=1))
        with pytest.raises(HTTPException) as error:
            auth.require_subscription(current, db)
        assert error.value.status_code == 403 and "Verified Google" in error.value.detail
        user.provider, user.google_subject = "google", "verified_fixture"
        db.commit()
        with pytest.raises(HTTPException) as error:
            auth.require_subscription(current, db)
        assert error.value.status_code == 403 and "active subscription" in error.value.detail


@pytest.mark.parametrize("path", ["/api/live/dukascopy/instruments", "/api/live/dukascopy/candles?instrument=EURUSD"])
def test_personal_dukascopy_requires_provider_permission_without_fetch(personal, monkeypatch, path):
    session = login(personal)
    monkeypatch.setattr(routes, "fetch_dukascopy_json", lambda *_: pytest.fail("Unlicensed automated access must not fetch data"))
    if "?" in path:
        request_scope = scope(path.split("?", 1)[0], method="GET", headers=(*proxy_key(personal), (b"authorization", f"Bearer {session['token']}".encode())))
        request_scope["query_string"] = b"instrument=EURUSD"
        messages = call(personal.app, request_scope)
        assert messages[0]["status"] == 403
        assert b"provider-specific permission" in b"".join(item.get("body", b"") for item in messages)
    else:
        status, body = http(personal, path, token=session["token"], headers=proxy_key(personal))
        assert status == 403 and "provider-specific permission" in body["detail"]
