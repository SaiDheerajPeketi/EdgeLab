"""Google quota through the real ASGI route, auth, provider parser, and database.
Only provider transport, isolated persistence, configuration, and time are seams.
"""
import json
from dataclasses import replace
from types import SimpleNamespace
from urllib.parse import parse_qs

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import auth, models
from app.api import routes
from app.config import settings as default_settings
from app.db import Base, get_db
from app.main import app
from app.services.auth_rate_limits import GoogleExchangeLimiter
from test_billing_routes import HTTPClient


@pytest.fixture
def exchange(monkeypatch):
    engine = create_engine("sqlite://", poolclass=StaticPool,
                           connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    config = replace(default_settings, deployment_mode="production",
                     jwt_secret="owned-google-limits120", google_client_id="fixture-client",
                     google_client_secret="fixture-secret",
                     google_redirect_uri="https://example.test/auth/callback/google")
    for module in (routes, auth):
        monkeypatch.setattr(module, "settings", config)
    calls, claims = [], {"sub": "verified_quota_subject", "email": "quota@example.test",
                         "email_verified": True, "name": "Quota owner"}
    context = SimpleNamespace(factory=factory, config=config, calls=calls, claims=claims,
                              client=HTTPClient(), failure=None, db_opens=0, clock=[100.0])
    context.limiter = GoogleExchangeLimiter(clock=lambda: context.clock[0], limit=2, window_seconds=60)
    monkeypatch.setattr(routes, "google_exchange_limiter", context.limiter)

    class ProviderResponse:
        def __init__(self, payload): self.payload = payload
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def read(self): return json.dumps(self.payload).encode()

    def transport(request, timeout):
        assert timeout == 20
        calls.append(request.full_url)
        if context.failure:
            raise context.failure
        if request.full_url == "https://oauth2.googleapis.com/token":
            assert parse_qs(request.data.decode()) == {
                "client_id": [config.google_client_id], "client_secret": [config.google_client_secret],
                "code": ["real-authorized-code"], "grant_type": ["authorization_code"],
                "redirect_uri": [config.google_redirect_uri]}
            return ProviderResponse({"access_token": "owned-provider-token"})
        assert request.full_url == "https://openidconnect.googleapis.com/v1/userinfo"
        assert request.get_header("Authorization") == "Bearer owned-provider-token"
        return ProviderResponse(claims)

    monkeypatch.setattr(routes, "urlopen", transport)
    def database():
        context.db_opens += 1
        with factory() as db:
            yield db
    previous = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = database
    try:
        yield context
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)
        engine.dispose()


def submit(context, **headers):
    return context.client.post("/api/auth/google/exchange", headers=headers, json_body={
        "code": "real-authorized-code", "redirect_uri": context.config.google_redirect_uri})


def snapshot(context):
    """All tables, including enrollment/session timestamps, must remain unchanged."""
    with context.factory() as db:
        return {table.name: [tuple(row) for row in db.execute(select(table)).all()]
                for table in Base.metadata.sorted_tables}


@pytest.mark.parametrize("mode", ["beta", "production"])
def test_exhausted_exchange_denies_before_provider_and_every_database_mutation(exchange, monkeypatch, mode):
    c = exchange
    config = replace(c.config, deployment_mode=mode)
    for module in (auth, routes):
        monkeypatch.setattr(module, "settings", config)
    responses = [submit(c) for _ in range(2)]
    assert [r.status_code for r in responses] == [200, 200]
    assert len(c.calls) == 4
    before, calls, opens = snapshot(c), list(c.calls), c.db_opens
    for index in range(4):
        c.claims.update(sub=f"different_{index}", email=f"different-{index}@example.test")
        denied = submit(c, **{"X-Forwarded-For": f"198.51.100.{index}", "X-Real-IP": "203.0.113.8"})
        assert denied.status_code == 429
        assert denied.headers["retry-after"] == "60"
    assert c.calls == calls and c.db_opens == opens
    assert snapshot(c) == before


def test_fixed_window_expiry_reopens_exchange_without_denial_sliding_the_window(exchange):
    c = exchange
    assert submit(c).status_code == 200 and submit(c).status_code == 200
    c.clock[0] = 159.25
    denied = submit(c)
    assert denied.status_code == 429 and denied.headers["retry-after"] == "1"
    c.clock[0] = 160.0
    assert submit(c).status_code == 200
    assert len(c.calls) == 6
    with c.factory() as db:
        assert len(db.scalars(select(models.BetaUser)).all()) == 1
        assert len(db.scalars(select(models.BetaSession)).all()) == 3


def test_failed_provider_attempts_consume_quota_and_denial_has_no_retry_io(exchange):
    c = exchange
    c.failure = OSError("owned provider unavailable")
    initial = snapshot(c)
    assert submit(c).status_code == 502 and submit(c).status_code == 502
    assert len(c.calls) == 2 and snapshot(c) == initial
    opens = c.db_opens
    assert submit(c).status_code == 429
    assert len(c.calls) == 2 and c.db_opens == opens and snapshot(c) == initial


def test_existing_authenticated_session_reads_are_not_consumers_of_exchange_quota(exchange):
    c = exchange
    first = submit(c)
    assert first.status_code == 200
    assert submit(c).status_code == 200 and submit(c).status_code == 429
    result = c.client.get("/api/auth/session", headers={
        "Authorization": "Bearer " + first.json()["session"]["token"]})
    assert result.status_code == 200 and result.json()["user"]["email"] == c.claims["email"]
    assert len(c.calls) == 4


@pytest.mark.parametrize("reply", [None, [], [1, 0], [1, 60001], [True, 60000], [0, "5000"], RuntimeError("Redis down")])
def test_redis_runtime_or_protocol_failure_denies_before_database_and_provider(exchange, monkeypatch, reply):
    c = exchange
    class RedisTransport:
        def eval(self, *args):
            if isinstance(reply, Exception):
                raise reply
            return reply
    monkeypatch.setattr(routes, "google_exchange_limiter", GoogleExchangeLimiter(client=RedisTransport()))
    before = snapshot(c)
    denied = submit(c)
    assert denied.status_code == 503 and denied.headers["retry-after"] == "5"
    assert c.calls == [] and c.db_opens == 0 and snapshot(c) == before


def test_active_exchange_capacity_denies_without_queue_or_provider_and_slot_recovers(exchange, monkeypatch):
    c = exchange
    limiter = GoogleExchangeLimiter(limit=10, max_concurrent=1)
    monkeypatch.setattr(routes, "google_exchange_limiter", limiter)
    before = snapshot(c)
    with limiter.admit():
        denied = submit(c)
        assert denied.status_code == 429 and denied.headers["retry-after"] == "1"
        assert c.calls == [] and c.db_opens == 0 and snapshot(c) == before
    assert submit(c).status_code == 200 and len(c.calls) == 2
