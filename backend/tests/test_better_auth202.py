"""Real Better Auth HTTP + FastAPI identity/billing ownership boundaries."""
from dataclasses import replace
from datetime import timedelta
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import auth, models
from app.api import routes
from app.config import settings
from app.db import Base, get_db
from app.main import app
from app.services import better_auth, billing, access_policy
from test_billing_routes import HTTPClient


@pytest.fixture
def context(monkeypatch):
    root = Path(__file__).resolve().parents[2]
    process = subprocess.Popen(["node", str(root / "backend/tests/fixtures/better-auth202.mjs")], cwd=root,
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    try:
        remote = json.loads(process.stdout.readline())
        config = replace(settings, auth_provider="better-auth", better_auth_internal_url=remote["origin"],
                         auth_service_key=remote["key"], public_origin="https://edgelab.example", deployment_mode="production",
                         redis_url="", jwt_secret="isolated-legacy-secret202", billing_enabled=True, stripe_mode="live",
                         stripe_secret_key="sk_live_owned202", stripe_webhook_secret="whsec_owned202",
                         stripe_monthly_price_id="price_month202", stripe_annual_price_id="price_year202")
        for module in (auth, routes, better_auth, billing):
            monkeypatch.setattr(module, "settings", config)
        engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        Base.metadata.create_all(engine)
        factory = sessionmaker(bind=engine)
        def database():
            with factory() as db:
                yield db
        original = dict(app.dependency_overrides)
        app.dependency_overrides[get_db] = database
        try:
            yield SimpleNamespace(factory=factory, client=HTTPClient(), remote=remote, config=config)
        finally:
            app.dependency_overrides.clear(); app.dependency_overrides.update(original); engine.dispose()
    finally:
        process.terminate(); process.communicate(timeout=10)


def exchange(context, *, origin="https://edgelab.example", cookie=None):
    return context.client.post("/api/auth/better-auth/exchange", headers={"Origin": origin,
        "Cookie": cookie or context.remote["cookie"]}, json_body={"sub": "attacker", "email": "attacker@example.test"})


def test_real_cookie_bridge_preserves_paid_numeric_owner_and_revocation(context):
    now = models.utcnow()
    with context.factory() as db:
        user = models.BetaUser(email="old202@gmail.com", name="Before", provider="google", google_subject="stable_google_202", status="PUBLIC")
        db.add(user); db.flush(); owner = user.id
        db.add(models.AppStorageItem(user_id=owner, namespace="owned", key="owned202", value={"private": True}))
        customer = models.BillingCustomer(user_id=owner, livemode=True, stripe_customer_id="cus_owned202", verified_at=now)
        db.add(customer); db.flush()
        db.add(models.BillingSubscription(user_id=owner, billing_customer_id=customer.id, livemode=True,
            stripe_subscription_id="sub_owned202", price_id="price_month202", cadence="monthly", status="active",
            eligible=True, invoice_paid=True, current_period_end=now + timedelta(days=10)))
        legacy = models.BetaSession(id="legacy-owner202", user_id=owner, expires_at=now + timedelta(hours=1))
        db.add(legacy); db.commit()
    response = exchange(context)
    assert response.status_code == 200, response.body
    session = response.json()["session"]
    assert session["user"]["id"] == owner
    assert session["user"]["email"] == "owner202@gmail.com"
    assert session["user"]["workspace_access"] is True
    assert session["user"]["plan"] == "pro"
    assert session["token"].startswith("ba:")
    headers = {"Authorization": "Bearer " + session["token"]}
    refreshed = context.client.get("/api/auth/session", headers=headers)
    assert refreshed.status_code == 200
    assert refreshed.json()["token"] == session["token"]
    assert context.client.get("/api/app-data/export", headers=headers).status_code == 200
    with context.factory() as db:
        assert db.scalar(select(models.AppStorageItem).where(models.AppStorageItem.user_id == owner)).value == {"private": True}
        assert db.get(models.BetaSession, "legacy-owner202") is not None
        assert db.scalar(select(models.BillingSubscription)).user_id == owner
    legacy_token = auth.create_session_token(owner, "legacy-owner202", now + timedelta(hours=1))
    assert context.client.get("/api/auth/session", headers={"Authorization": "Bearer " + legacy_token}).status_code == 200
    assert context.client.request("DELETE", "/api/auth/session", headers=headers).status_code == 200
    assert context.client.get("/api/auth/session", headers=headers).status_code == 401
    assert context.client.get("/api/app-data/export", headers=headers).status_code == 401
    assert exchange(context).status_code == 401
    assert context.client.get("/api/auth/session", headers={"Authorization": "Bearer " + legacy_token}).status_code == 200


def test_bridge_origin_cookie_fencing_and_unpaid_new_account(context):
    config = context.client.get("/api/auth/config")
    assert config.status_code == 200
    assert config.json()["auth_provider"] == "better-auth" and config.json()["google_enabled"] is True
    assert config.json()["google_client_id"] is None
    assert exchange(context, origin="https://attacker.example").status_code == 403
    assert exchange(context, cookie=context.remote["cookie"] + "; " + context.remote["cookie"]).status_code == 401
    response = exchange(context, cookie="unrelated=private; " + context.remote["cookie"])
    assert response.status_code == 200, response.body
    user = response.json()["session"]["user"]
    assert user["workspace_access"] is False and user["plan"] == "none"
    assert user["email"] == "owner202@gmail.com"
    assert context.client.get("/api/app-data/export", headers={"Authorization": "Bearer " + response.json()["session"]["token"]}).status_code == 403
    # Network failure is not a new session, nor a legacy fallback.
    better_auth.settings = replace(context.config, better_auth_internal_url="http://127.0.0.1:1")
    assert context.client.get("/api/auth/session", headers={"Authorization": "Bearer " + response.json()["session"]["token"]}).status_code == 503


def test_existing_manual_gmail_recovery_revokes_only_unverified_legacy_sessions(context):
    with context.factory() as db:
        user = models.BetaUser(email="owner202@gmail.com", name="Manual", provider="email", status="PUBLIC")
        db.add(user); db.flush(); owner = user.id
        db.add(models.BetaSession(id="unverified202", user_id=owner, expires_at=models.utcnow() + timedelta(hours=1)))
        db.commit()
    response = exchange(context)
    assert response.status_code == 200
    assert response.json()["session"]["user"]["id"] == owner
    with context.factory() as db:
        assert db.get(models.BetaSession, "unverified202") is None
        assert db.get(models.BetaUser, owner).google_subject == "stable_google_202"


def test_conflicting_verified_email_never_transfers_ownership(context):
    with context.factory() as db:
        db.add(models.BetaUser(email="owner202@gmail.com", name="Other", provider="google", google_subject="other_subject202", status="PUBLIC"))
        db.commit()
    assert exchange(context).status_code == 409
    with context.factory() as db:
        assert len(db.scalars(select(models.BetaUser)).all()) == 1
        assert db.scalar(select(models.BetaUser)).google_subject == "other_subject202"


def test_readiness_and_fixed_target_fail_closed(monkeypatch):
    monkeypatch.setattr(better_auth, "settings", replace(settings, auth_provider="better-auth", auth_service_key=""))
    assert better_auth.readiness() is False
    with pytest.raises(HTTPException) as error:
        better_auth.request_session(cookie="edgelab.session_token=owned.signature")
    assert error.value.status_code == 503
    monkeypatch.setattr(better_auth, "settings", replace(settings, auth_provider="better-auth", auth_service_key="k" * 40,
        better_auth_internal_url="http://127.0.0.1:3002/attacker"))
    with pytest.raises(HTTPException) as error:
        better_auth.request_session(token="ba:owned.signature")
    assert error.value.status_code == 503
