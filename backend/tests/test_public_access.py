"""Public enrollment and workspace policy through real JWT/DB/ASGI boundaries.
Only OAuth/provider I/O, database and clock/configuration are fixtures.
"""
import asyncio
from dataclasses import replace
from datetime import datetime, timedelta, timezone
import json
import re
import time
from urllib.parse import parse_qs
from uuid import uuid4

import pytest
from sqlalchemy import select

from app import auth, models
from app.config import settings as default_settings
from app.api import routes
from app.main import app
from app.services import access_policy, app_data_operations, billing
from test_billing_routes import (context as billing_context, checkout, customer, snapshot, status)


@pytest.fixture
def public(billing_context, monkeypatch):
    c = billing_context
    c.settings = replace(default_settings, deployment_mode="production", environment="development",
        jwt_secret="billing-route-jwt", google_client_id="public-client", google_client_secret="public-secret",
        google_redirect_uri="https://edgelab.example/auth/callback/google",
        beta_manual_access_enabled=True, dev_auth_bypass_enabled=True,
        public_origin=c.config.public_origin, billing_enabled=True, stripe_mode="live",
        stripe_secret_key=c.config.secret_key, stripe_webhook_secret=c.config.webhook_secret,
        stripe_monthly_price_id=c.config.monthly_price_id, stripe_annual_price_id=c.config.annual_price_id)
    def settings(**changes):
        c.settings = replace(c.settings, **changes)
        for module in (auth, routes, app_data_operations, billing):
            monkeypatch.setattr(module, "settings", c.settings)
    c.set_settings = settings
    settings()
    monkeypatch.setattr(routes, "SessionLocal", c.factory)
    monkeypatch.setattr(app_data_operations, "SessionLocal", c.factory)
    monkeypatch.setattr(billing, "StripeProvider", lambda conf: c.provider)
    c.claims = {"sub": "google-public-sub", "email": "new-public@example.test",
                "email_verified": True, "name": "New public account"}
    c.oauth_calls = []
    class NetworkResponse:
        def __init__(self, value): self.value = value
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def read(self): return json.dumps(self.value).encode()
    def oauth(request, timeout):
        c.oauth_calls.append(request)
        assert timeout == 20
        if request.full_url == "https://oauth2.googleapis.com/token":
            payload = parse_qs(request.data.decode())
            assert payload == {"client_id": ["public-client"], "client_secret": ["public-secret"],
                "code": ["real-code-fixture"], "grant_type": ["authorization_code"],
                "redirect_uri": [c.settings.google_redirect_uri]}
            return NetworkResponse({"access_token": "oauth-network-fixture"})
        assert request.full_url == "https://openidconnect.googleapis.com/v1/userinfo"
        assert request.get_header("Authorization") == "Bearer oauth-network-fixture"
        return NetworkResponse(c.claims)
    monkeypatch.setattr(routes, "urlopen", oauth)
    with c.factory() as db:
        for index, owner in enumerate(c.owners):
            db.get(models.BetaUser, owner).google_subject = f"verified-owner-{index}"
            db.add(models.AppStorageItem(user_id=owner, namespace="preferences", key="workspace",
                                         value={"private_owner": index}))
        db.commit()
    yield c


def exchange(c, **changes):
    c.claims.update(changes)
    return c.client.post("/api/auth/google/exchange", json_body={
        "code": "real-code-fixture", "redirect_uri": c.settings.google_redirect_uri})


def identity(c, owner=0):
    return c.client.get("/api/auth/session", headers=c.headers[owner])


def workspace(c, owner=0):
    return c.client.get("/api/app-storage/preferences/workspace", headers=c.headers[owner])


def paid(c, owner=0):
    assert checkout(c, owner).status_code == 200
    identifier = customer(c, owner)
    c.provider.snapshots[identifier] = snapshot(c, identifier)
    assert status(c, owner).json()["workspace_access"] is True
    return identifier


def assert_access(user, *, mode="production", allowed=False, plan="none"):
    assert user["deployment_mode"] == mode
    assert user["workspace_access"] is allowed
    assert user["plan"] == plan
    assert user["is_beta_user"] is (mode == "beta")
    if allowed:
        assert datetime.fromisoformat(user["access_expires_at"].replace("Z", "+00:00")) > datetime.now(timezone.utc)
    else:
        assert user["access_expires_at"] is None


def test_production_signup_uses_verified_network_subject_beyond_beta_capacity(public):
    c = public
    with c.factory() as db:
        db.add_all(models.BetaUser(email=f"legacy-{i}@example.test", name="Legacy", provider="google",
                   status="APPROVED", beta_position=i + 1) for i in range(500))
        db.commit()
    response = exchange(c)
    assert response.status_code == 200
    value = response.json()
    assert_access(value["session"]["user"])
    assert value["session"]["user"]["approved"] is False
    assert value["session"]["user"]["beta_position"] is None
    assert value["program"]["seats_total"] == 0
    assert len(c.oauth_calls) == 2
    with c.factory() as db:
        user = db.get(models.BetaUser, value["session"]["user"]["id"])
        assert user.google_subject == c.claims["sub"] and user.status == "PUBLIC"
    bearer = {"Authorization": "Bearer " + value["session"]["token"]}
    assert c.client.get("/api/auth/session", headers=bearer).status_code == 200
    assert c.client.get("/api/app-storage/preferences/workspace", headers=bearer).status_code == 403
    # Access fields have one canonical owner, inside user rather than duplicated top-level state.
    assert "workspace_access" not in value["session"]


@pytest.mark.parametrize("claim,value", [("email_verified", False), ("email_verified", "true"),
    ("email_verified", None), ("sub", None), ("sub", ""), ("sub", "x" * 256), ("sub", "contains space")])
def test_unverified_or_unstable_google_identity_creates_no_session(public, claim, value):
    response = exchange(public, **{claim: value})
    assert response.status_code == 502
    with public.factory() as db:
        assert len(db.scalars(select(models.BetaUser)).all()) == 3
        assert len(db.scalars(select(models.BetaSession)).all()) == 3


def test_redirect_and_claims_are_not_browser_authority(public):
    c = public
    response = c.client.post("/api/auth/google/exchange", json_body={"code": "real-code-fixture",
        "redirect_uri": "https://attacker.example/callback", "email": "billing-0@example.test",
        "email_verified": True, "sub": "forged", "workspace_access": True})
    assert response.status_code == 400 and c.oauth_calls == []
    user = identity(c).json()["user"]
    assert user["approved"] is True  # Legacy beta status is preserved, never a production entitlement.
    assert_access(user)
    assert workspace(c).status_code == 403


def test_subject_binding_preserves_legacy_id_data_and_email_change(public):
    c = public
    with c.factory() as db:
        db.get(models.BetaUser, c.owners[0]).google_subject = None
        db.commit()
    first = exchange(c, email="billing-0@example.test", sub="bound-original")
    assert first.status_code == 200 and first.json()["session"]["user"]["id"] == c.owners[0]
    second = exchange(c, email="renamed-google@example.test", sub="bound-original")
    assert second.status_code == 200 and second.json()["session"]["user"]["id"] == c.owners[0]
    with c.factory() as db:
        assert db.get(models.BetaUser, c.owners[0]).google_subject == "bound-original"
        assert db.scalar(select(models.AppStorageItem).where(models.AppStorageItem.user_id == c.owners[0])).value == {"private_owner": 0}
        assert len(db.scalars(select(models.BetaUser)).all()) == 3
    assert exchange(c, email="renamed-google@example.test", sub="different-owner").status_code == 409
    assert exchange(c, email="billing-1@example.test", sub="bound-original").status_code == 409
    with c.factory() as db:
        db.get(models.BetaUser, c.owners[2]).provider = "email"
        db.commit()
    assert exchange(c, email="billing-2@example.test", sub="email-impostor").status_code == 409


def test_manual_and_dev_flags_cannot_enable_production_signup(public):
    c = public
    assert c.settings.beta_manual_access_enabled and c.settings.dev_auth_bypass_enabled
    assert c.client.post("/api/auth/beta/access", json_body={"email": "manual@example.test", "provider": "google"}).status_code == 403
    assert c.client.post("/api/auth/dev/bypass").status_code == 404
    with c.factory() as db:
        assert len(db.scalars(select(models.BetaUser)).all()) == 3


def test_explicit_beta_allows_approved_but_not_waitlist_and_never_needs_payment(public):
    c = public
    c.set_settings(deployment_mode="beta", beta_seats_total=1, billing_enabled=False)
    user = identity(c).json()["user"]
    assert_access(user, mode="beta", allowed=True, plan="beta")
    assert workspace(c).status_code == 200
    waiting = identity(c, 2).json()["user"]
    assert_access(waiting, mode="beta")
    assert workspace(c, 2).status_code == 403
    signup = exchange(c).json()
    assert_access(signup["session"]["user"], mode="beta")
    assert signup["program"]["waitlist_count"] >= 1


@pytest.mark.parametrize("mode", ["", "typo", "Production"])
def test_unknown_deployment_mode_fails_closed(public, mode):
    c = public
    paid(c)
    c.set_settings(deployment_mode=mode)
    assert identity(c).status_code == 503
    assert workspace(c).status_code == 503
    assert exchange(c).status_code == 503


def test_live_paid_owner_can_read_write_and_session_expiry_bounds_lease(public):
    c = public
    paid(c)
    assert workspace(c).status_code == 200
    response = c.client.request("PUT", "/api/app-storage/preferences/workspace", headers=c.headers[0],
                                json_body={"value": {"native_source": "saved"}})
    assert response.status_code == 200
    result = identity(c).json()
    assert_access(result["user"], allowed=True, plan="pro")
    expiry = datetime.fromisoformat(result["user"]["access_expires_at"].replace("Z", "+00:00"))
    assert expiry <= datetime.now(timezone.utc) + timedelta(seconds=billing.ACCESS_LEASE_SECONDS)
    assert expiry <= datetime.fromisoformat(result["expires_at"].replace("Z", "+00:00"))
    assert workspace(c, 1).status_code == 403


@pytest.mark.parametrize("reason", ["test", "canceled", "expired", "stale_provider_failure", "disabled"])
def test_paid_proof_cannot_survive_invalid_mode_term_or_unverified_lease(public, reason):
    c = public
    paid(c)
    with c.factory() as db:
        row = db.scalar(select(models.BillingSubscription).where(models.BillingSubscription.user_id == c.owners[0]))
        owner = db.scalar(select(models.BillingCustomer).where(models.BillingCustomer.user_id == c.owners[0]))
        if reason == "canceled": row.status = "canceled"
        if reason == "expired": row.current_period_end = models.utcnow() - timedelta(seconds=1)
        if reason == "stale_provider_failure":
            owner.verified_at = models.utcnow() - timedelta(seconds=301)
            c.provider.failure = billing.BillingError(503, "Provider unavailable")
        db.commit()
    if reason == "test": c.set_settings(stripe_mode="test", stripe_secret_key="sk_test_fixture")
    if reason == "disabled": c.set_settings(billing_enabled=False)
    assert workspace(c).status_code == 403
    assert_access(identity(c).json()["user"])
    assert c.client.request("PUT", "/api/app-storage/preferences/workspace", headers=c.headers[0], json_body={"value": "forged"}).status_code == 403
    with c.factory() as db:
        assert db.scalar(select(models.AppStorageItem).where(models.AppStorageItem.user_id == c.owners[0])).value == {"private_owner": 0}


def test_expired_lease_reconciles_current_provider_before_allowing_workspace(public):
    c = public
    identifier = paid(c)
    with c.factory() as db:
        db.scalar(select(models.BillingCustomer).where(models.BillingCustomer.user_id == c.owners[0])).verified_at = models.utcnow() - timedelta(seconds=301)
        db.commit()
    before = len(c.provider.calls)
    assert workspace(c).status_code == 200
    assert ("subscriptions", identifier) in c.provider.calls[before:]
    c.provider.snapshots[identifier] = snapshot(c, identifier, state="canceled")
    with c.factory() as db:
        db.scalar(select(models.BillingCustomer).where(models.BillingCustomer.user_id == c.owners[0])).verified_at = models.utcnow() - timedelta(seconds=301)
        db.commit()
    assert workspace(c).status_code == 403


# Independently enumerated account/public boundaries; do not import production's exemption list.
ACCOUNT_PUBLIC = {
    ("GET", "/health"), ("GET", "/ready"), ("GET", "/ui/rollout"),
    ("GET", "/auth/config"), ("GET", "/auth/beta/status"), ("POST", "/auth/beta/access"),
    ("POST", "/auth/dev/bypass"), ("POST", "/auth/google/exchange"),
    ("GET", "/auth/session"), ("DELETE", "/auth/session"),
    ("POST", "/app-data/operations/{operation_id}/recover"), ("POST", "/quant/jobs/{job_id}/cancel"),
    ("DELETE", "/integration-secrets/{secret_id}"), ("DELETE", "/broker-connections/{connection_id}"),
    ("DELETE", "/market-data/subscriptions/{subscription_id}"), ("GET", "/workspace-shares/open"), ("GET", "/workspace-shares"),
    ("GET", "/quant/scripts/{script_id}/permissions"),
    ("GET", "/integration-secrets"), ("GET", "/integration-secrets/{secret_id}"),
    ("GET", "/broker-connections"), ("GET", "/broker-connections/{connection_id}"),
    ("POST", "/workspace-shares/{snapshot_id}/revoke"), ("DELETE", "/workspace-shares/{snapshot_id}/payload"),
    ("DELETE", "/quant/scripts/{script_id}/permissions/{permission_id}"),
}


def test_every_actual_workspace_http_route_denies_unpaid_before_payload_or_service(public):
    exercised = []
    # Installed FastAPI stores included routers lazily; its actual OpenAPI paths
    # are the resolved application inventory, then every denial is sent via ASGI.
    for route_path, operations in app.openapi()["paths"].items():
        if not route_path.startswith("/api/") or route_path.startswith("/api/billing/") or route_path == "/api/observability/metrics":
            continue
        logical = route_path.removeprefix("/api")
        for verb in sorted(operations):
            method = verb.upper()
            if method not in {"GET", "POST", "PUT", "PATCH", "DELETE"} or (method, logical) in ACCOUNT_PUBLIC:
                continue
            path = re.sub(r"\{[^}]+\}", "1", route_path)
            result = public.client.request(method, path, headers=public.headers[0], json_body={})
            exercised.append((method, route_path, result.status_code))
    assert len(exercised) == 138, exercised
    assert all(code == 403 for _, _, code in exercised), [r for r in exercised if r[2] != 403]


def test_unpaid_receipt_recovery_and_revoke_stay_owner_scoped(public):
    c = public
    assert c.client.get("/api/app-data/export", headers=c.headers[0]).status_code == 403
    operation = str(uuid4())
    recover = c.client.post(f"/api/app-data/operations/{operation}/recover", headers=c.headers[0])
    assert recover.status_code == 200 and recover.json()["status"] == "canceled"
    # Other owner's recovery creates their own tombstone, not access to this owner's receipt.
    other = c.client.post(f"/api/app-data/operations/{operation}/recover", headers=c.headers[1])
    assert other.status_code == 200
    with c.factory() as db:
        rows = db.scalars(select(models.AppDataOperation).where(models.AppDataOperation.operation_id == operation)).all()
        assert {row.user_id for row in rows} == {c.owners[0], c.owners[1]}
    assert c.client.get("/api/billing/status", headers=c.headers[0]).status_code == 200
    assert c.client.request("DELETE", "/api/auth/session", headers=c.headers[0]).status_code == 200
    assert identity(c).status_code == 401 and identity(c, 1).status_code == 200


def test_access_denial_precedes_durable_operation_claim(public):
    c = public
    paid(c)
    operation = str(uuid4())
    path = "/app-storage/preferences/workspace"
    assert c.client.post(f"/api/app-data/operations/{operation}/reserve", headers=c.headers[0],
                         json_body={"method": "PUT", "path": path}).status_code == 200
    c.set_settings(billing_enabled=False)
    result = c.client.request("PUT", "/api" + path,
        headers={**c.headers[0], "X-EdgeLab-Operation-Id": operation}, json_body={"value": "unauthorized"})
    assert result.status_code == 403
    with c.factory() as db:
        row = db.scalar(select(models.AppDataOperation).where(models.AppDataOperation.operation_id == operation))
        assert row.status == "reserved" and row.http_status is None
    new = str(uuid4())
    assert c.client.post(f"/api/app-data/operations/{new}/reserve", headers=c.headers[0],
                         json_body={"method": "PUT", "path": path}).status_code == 403
    with c.factory() as db:
        assert db.scalar(select(models.AppDataOperation).where(models.AppDataOperation.operation_id == new)) is None
    assert c.client.post(f"/api/app-data/operations/{operation}/recover", headers=c.headers[0]).json()["status"] == "canceled"


def test_portable_import_cannot_create_or_replace_billing_authority(public):
    c = public
    paid(c)
    exported = c.client.get("/api/app-data/export", headers=c.headers[0])
    assert exported.status_code == 200
    bundle = exported.json()
    assert [row["value"] for row in bundle["tables"]["app_storage"]] == [{"private_owner": 0}]
    assert not any("billing" in key or "beta" in key for key in bundle["tables"])
    bundle["tables"]["billing_subscriptions"] = [{"user_id": c.owners[0], "status": "active", "eligible": True}]
    assert c.client.post("/api/app-data/import", headers=c.headers[0], json_body=bundle).status_code == 400
    with c.factory() as db:
        assert len(db.scalars(select(models.BillingSubscription)).all()) == 1
        assert db.scalar(select(models.AppStorageItem).where(models.AppStorageItem.user_id == c.owners[0])).value == {"private_owner": 0}


def seed_job(c):
    with c.factory() as db:
        conv = models.AIConversation(user_id=c.owners[0], kind="SCRIPT", title="Owned job", retention_until=models.utcnow() + timedelta(days=1))
        db.add(conv); db.flush()
        msg = models.AIMessage(user_id=c.owners[0], conversation_id=conv.id, sequence=1, role="USER", content="Owned request", content_digest="a" * 64)
        db.add(msg); db.flush()
        job = models.AIGenerationJob(user_id=c.owners[0], conversation_id=conv.id, request_message_id=msg.id,
            idempotency_key="access-job", operation="GENERATE", model_id="fixture", provider="fixture", status="RUNNING",
            estimated_input_tokens=1, max_output_tokens=1, estimated_cost_micros=1, hard_cost_ceiling_micros=1)
        db.add(job); db.flush()
        db.add(models.AIJobEvent(user_id=c.owners[0], job_id=job.id, sequence=1, event_type="STATUS", payload={"status": "RUNNING"}))
        db.commit()
        return job.id


def test_unpaid_can_cancel_only_their_own_running_job(public):
    job = seed_job(public)
    assert public.client.post(f"/api/quant/jobs/{job}/cancel", headers=public.headers[1]).status_code == 404
    response = public.client.post(f"/api/quant/jobs/{job}/cancel", headers=public.headers[0])
    assert response.status_code == 200 and response.json()["cancel_requested_at"] is not None
    with public.factory() as db:
        assert db.get(models.AIGenerationJob, job).cancel_requested_at is not None


def revoke(c, reason):
    with c.factory() as db:
        if reason == "session":
            db.delete(db.get(models.BetaSession, c.sessions[0]))
        else:
            sub = db.scalar(select(models.BillingSubscription).where(models.BillingSubscription.user_id == c.owners[0]))
            sub.status = "canceled"
        db.commit()


@pytest.mark.parametrize("reason,close", [("session", 4401), ("payment", 4403)])
def test_dataset_websocket_timer_rechecks_real_session_and_paid_access(public, monkeypatch, reason, close):
    c = public
    paid(c)
    monkeypatch.setattr(routes, "DATASET_STREAM_INTERVAL_SECONDS", 0.02)
    token = c.headers[0]["Authorization"].removeprefix("Bearer ")
    messages, read_count = [], 0
    started = time.monotonic()
    async def receive():
        nonlocal read_count
        read_count += 1
        if read_count == 1: return {"type": "websocket.connect"}
        if read_count == 2: return {"type": "websocket.receive", "text": json.dumps({"authToken": token})}
        await asyncio.Event().wait()  # No client activity: only the production timer can recheck.
    async def send(message):
        messages.append(message)
        if message["type"] == "websocket.send":
            assert json.loads(message["text"])["type"] == "catalog"
            revoke(c, reason)
    scope = {"type": "websocket", "asgi": {"version": "3.0", "spec_version": "2.4"},
        "scheme": "wss", "path": "/api/datasets/stream", "raw_path": b"/api/datasets/stream",
        "root_path": "", "query_string": b"", "headers": [], "subprotocols": [],
        "server": ("testserver", 443), "client": ("127.0.0.1", 12345)}
    async def run(): await asyncio.wait_for(app(scope, receive, send), timeout=2)
    asyncio.run(run())
    assert messages[0]["type"] == "websocket.accept"
    assert messages[-1] == {"type": "websocket.close", "code": close, "reason": ""}
    assert sum(m["type"] == "websocket.send" for m in messages) == 1
    assert read_count >= 3 and time.monotonic() - started >= 0.02


@pytest.mark.parametrize("reason", ["session", "payment"])
def test_sse_rechecks_access_before_emitting_further_owned_events(public, reason):
    c = public
    paid(c)
    job = seed_job(c)
    messages, received, changed = [], False, False
    async def receive():
        nonlocal received
        if not received:
            received = True
            return {"type": "http.request", "body": b"", "more_body": False}
        await asyncio.Event().wait()
    async def send(message):
        nonlocal changed
        messages.append(message)
        if message["type"] == "http.response.body" and b"event: status" in message.get("body", b"") and not changed:
            changed = True
            revoke(c, reason)
            with c.factory() as db:
                db.add(models.AIJobEvent(user_id=c.owners[0], job_id=job, sequence=2,
                    event_type="SECRET_LATER", payload={"private": "must not escape"}))
                db.commit()
    path = f"/api/quant/jobs/{job}/events/stream"
    scope = {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.4"}, "method": "GET",
        "scheme": "https", "http_version": "1.1", "path": path, "raw_path": path.encode(), "root_path": "",
        "query_string": b"", "headers": [(b"authorization", c.headers[0]["Authorization"].encode())],
        "server": ("testserver", 443), "client": ("127.0.0.1", 12345)}
    async def run(): await asyncio.wait_for(app(scope, receive, send), timeout=2)
    asyncio.run(run())
    assert next(m for m in messages if m["type"] == "http.response.start")["status"] == 200
    body = b"".join(m.get("body", b"") for m in messages)
    assert changed and b"event: status" in body and b"event: access_revoked" in body
    assert b"SECRET_LATER" not in body and b"must not escape" not in body
    assert messages[-1]["type"] == "http.response.body" and not messages[-1].get("more_body", False)


@pytest.mark.parametrize("reason", ["unpaid", "beta", "test", "canceled", "stale", "disabled"])
def test_export_requires_fresh_live_paid_subscription_even_in_beta(public, reason):
    c = public
    if reason not in {"unpaid", "beta"}:
        paid(c)
    if reason == "beta": c.set_settings(deployment_mode="beta", billing_enabled=False)
    if reason == "test": c.set_settings(stripe_mode="test", stripe_secret_key="sk_test_fixture")
    if reason == "disabled": c.set_settings(billing_enabled=False)
    if reason in {"canceled", "stale"}:
        with c.factory() as db:
            if reason == "canceled":
                db.scalar(select(models.BillingSubscription).where(models.BillingSubscription.user_id == c.owners[0])).status = "canceled"
            else:
                db.scalar(select(models.BillingCustomer).where(models.BillingCustomer.user_id == c.owners[0])).verified_at = models.utcnow() - timedelta(seconds=301)
                c.provider.failure = billing.BillingError(503, "Provider unavailable")
            db.commit()
    assert c.client.get("/api/app-data/export", headers=c.headers[0]).status_code == 403
    if reason == "beta": assert workspace(c).status_code == 200


def test_real_paid_test_mode_subscription_never_grants_workspace_or_export(public):
    c = public
    c.config = replace(c.config, mode="test", secret_key="sk_test_fixture")
    c.set_settings(stripe_mode="test", stripe_secret_key="sk_test_fixture")
    assert checkout(c).status_code == 200
    identifier = customer(c)
    c.provider.snapshots[identifier] = snapshot(c, identifier)
    value = status(c).json()
    assert value["subscription_access"] is True and value["workspace_access"] is False
    assert_access(identity(c).json()["user"])
    assert workspace(c).status_code == 403
    assert c.client.get("/api/app-data/export", headers=c.headers[0]).status_code == 403


def test_beta_export_receipt_header_cannot_reach_claim_before_paid_gate(public, monkeypatch):
    c = public
    c.set_settings(deployment_mode="beta", billing_enabled=False)
    assert workspace(c).status_code == 200
    claims = []
    original = app_data_operations.claim
    def observed(*args, **kwargs):
        claims.append(args)
        return original(*args, **kwargs)
    monkeypatch.setattr(app_data_operations, "claim", observed)
    response = c.client.get("/api/app-data/export", headers={**c.headers[0], "X-EdgeLab-Operation-Id": str(uuid4())})
    assert response.status_code == 403
    assert claims == []


def test_live_paid_export_allowed_in_explicit_beta_but_not_another_owner(public):
    c = public
    paid(c)
    c.set_settings(deployment_mode="beta")
    exported = c.client.get("/api/app-data/export", headers=c.headers[0])
    assert exported.status_code == 200
    assert [row["value"] for row in exported.json()["tables"]["app_storage"]] == [{"private_owner": 0}]
    assert c.client.get("/api/app-data/export", headers=c.headers[1]).status_code == 403


def test_unpaid_discovery_and_revocation_reveal_only_own_metadata_not_credentials(public):
    c = public
    identifiers = []
    with c.factory() as db:
        for index, owner in enumerate(c.owners[:2]):
            secret = models.IntegrationSecret(user_id=owner, provider="angelone", purpose="broker",
                key_id="fixture-key", nonce=b"012345678901", ciphertext=b"private-credential-value")
            db.add(secret); db.flush()
            connection = models.BrokerConnection(user_id=owner, provider="angelone", display_name=f"Private broker {index}", secret_id=secret.id)
            share = models.WorkspaceShareSnapshot(user_id=owner, workspace_key="workspace", snapshot_version=1,
                scope="complete-workspace", title=f"Private share {index}", token_digest=str(index) * 64,
                payload={"never_metadata": "private workspace content"})
            script = models.QuantScript(user_id=owner, name=f"Private script {index}", slug=f"private-{index}")
            db.add_all([connection, share, script]); db.flush()
            permission = models.QuantScriptPermission(user_id=owner, script_id=script.id,
                grantee_user_id=c.owners[2], permission="VIEW")
            db.add(permission); db.flush()
            identifiers.append((secret.id, connection.id, share.id, script.id, permission.id))
        db.commit()
    secret, connection, share, script, permission = identifiers[0]
    other_secret, other_connection, other_share, other_script, other_permission = identifiers[1]
    for path, key in [("/integration-secrets", secret), ("/broker-connections", connection), ("/workspace-shares", share)]:
        result = c.client.get("/api" + path, headers=c.headers[0])
        assert result.status_code == 200
        assert [row["id"] for row in result.json()] == [key]
        assert b"private-credential-value" not in result.body
        assert b"ciphertext" not in result.body and b"nonce" not in result.body
        assert b"private workspace content" not in result.body and b"token_digest" not in result.body
    for path in [f"/integration-secrets/{secret}", f"/broker-connections/{connection}", f"/quant/scripts/{script}/permissions"]:
        assert c.client.get("/api" + path, headers=c.headers[0]).status_code == 200
    for path in [f"/integration-secrets/{other_secret}", f"/broker-connections/{other_connection}", f"/quant/scripts/{other_script}/permissions"]:
        assert c.client.get("/api" + path, headers=c.headers[0]).status_code == 404
    for method, path in [("DELETE", f"/integration-secrets/{other_secret}"), ("DELETE", f"/broker-connections/{other_connection}"),
        ("POST", f"/workspace-shares/{other_share}/revoke"), ("DELETE", f"/workspace-shares/{other_share}/payload"),
        ("DELETE", f"/quant/scripts/{other_script}/permissions/{other_permission}")]:
        assert c.client.request(method, "/api" + path, headers=c.headers[0]).status_code == 404
    # Revocation remains available after the paid workspace becomes unavailable.
    for method, path in [("DELETE", f"/integration-secrets/{secret}"), ("DELETE", f"/broker-connections/{connection}"),
        ("POST", f"/workspace-shares/{share}/revoke"), ("DELETE", f"/workspace-shares/{share}/payload"),
        ("DELETE", f"/quant/scripts/{script}/permissions/{permission}")]:
        assert c.client.request(method, "/api" + path, headers=c.headers[0]).status_code == 200
    with c.factory() as db:
        assert db.get(models.IntegrationSecret, secret).revoked_at is not None
        assert db.get(models.BrokerConnection, connection).revoked_at is not None
        assert db.get(models.WorkspaceShareSnapshot, share).payload == {}
        assert db.get(models.QuantScriptPermission, permission).revoked_at is not None
        assert db.get(models.IntegrationSecret, other_secret).revoked_at is None
    # Creation, credential replacement/connect and permission regrant are workspace operations.
    for method, path in [("POST", "/integration-secrets"), ("PUT", f"/integration-secrets/{secret}"),
        ("POST", f"/integration-secrets/{secret}/connect"), ("POST", "/broker-connections"),
        ("POST", "/workspace-shares"), ("POST", f"/quant/scripts/{script}/permissions")]:
        assert c.client.request(method, "/api" + path, headers=c.headers[0], json_body={}).status_code == 403


@pytest.mark.parametrize("reason,close", [("session", 4401), ("payment", 4403)])
def test_angel_outgoing_tick_rechecks_actual_access_at_expiry_before_delivery(public, monkeypatch, reason, close):
    import websockets
    c = public
    identifier = paid(c)
    clock = [models.utcnow()]
    for module in (routes, access_policy, billing):
        monkeypatch.setattr(module, "utcnow", lambda: clock[0])
    checks, attempts = [], []
    verify = routes.verify_stream_access
    def observed(token):
        attempts.append({"clock": clock[0].isoformat(), "owner_token": token == c.headers[0]["Authorization"].removeprefix("Bearer ")})
        try:
            result = verify(token)
        except Exception as error:
            attempts[-1].update(status=getattr(error, "status_code", None), error=str(error))
            raise
        # Real JWT/session/database/subscription policy, never substituted.
        checks.append(result.access_expires_at)
        return result
    monkeypatch.setattr(routes, "verify_stream_access", observed)
    network_calls = []
    class Upstream:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): return False
        async def send(self, value): network_calls.append(json.loads(value))
        def __aiter__(self): return self.messages()
        async def messages(self):
            # Real upstream delivery is asynchronous; let subscription/watch
            # tasks start before the provider fixture emits its first quote.
            await asyncio.sleep(0)
            yield "first-owned-tick"
            yield "forbidden-after-access-expiry"
            await asyncio.Event().wait()
    def connect(url, **kwargs):
        assert url == routes.ANGELONE_WS_URL
        assert kwargs.get("additional_headers", kwargs.get("extra_headers"))["x-client-code"] == "broker-fixture"
        return Upstream()
    monkeypatch.setattr(websockets, "connect", connect)
    token = c.headers[0]["Authorization"].removeprefix("Bearer ")
    initial = {"apiToken": token, "credentials": {"clientCode": "broker-fixture", "jwtToken": "broker-jwt",
        "apiKey": "broker-key", "feedToken": "broker-feed"}, "symbols": [{"exchangeType": 1, "token": "123"}]}
    messages, read_count = [], 0
    async def receive():
        nonlocal read_count
        read_count += 1
        if read_count == 1: return {"type": "websocket.connect"}
        if read_count == 2: return {"type": "websocket.receive", "text": json.dumps(initial)}
        await asyncio.Event().wait()
    async def send(message):
        messages.append(message)
        if message["type"] == "websocket.send" and json.loads(message["text"]).get("message") == "first-owned-tick":
            clock[0] = checks[0] + timedelta(microseconds=1)
            if reason == "session": revoke(c, reason)
            else: c.provider.snapshots[identifier] = snapshot(c, identifier, state="canceled")
    scope = {"type": "websocket", "asgi": {"version": "3.0", "spec_version": "2.4"}, "scheme": "wss",
        "path": "/api/live/angelone/stream", "raw_path": b"/api/live/angelone/stream", "root_path": "",
        "query_string": b"", "headers": [], "subprotocols": [], "server": ("testserver", 443), "client": ("127.0.0.1", 12345)}
    async def run(): await asyncio.wait_for(app(scope, receive, send), timeout=2)
    asyncio.run(run())
    payloads = [json.loads(m["text"]) for m in messages if m["type"] == "websocket.send"]
    assert {"type": "message", "message": "first-owned-tick"} in payloads
    assert not any(p.get("message") == "forbidden-after-access-expiry" for p in payloads)
    assert len(attempts) >= 2 and all(a["owner_token"] for a in attempts), attempts
    assert messages[-1]["type"] == "websocket.close" and messages[-1]["code"] == close, {"messages": messages, "attempts": attempts, "checks": checks}
    assert len(checks) == 1  # The next real verifier raises rather than returning an entitled user.
    assert len(network_calls) == 1 and network_calls[0]["action"] == 1


def test_provider_failure_does_not_rollback_verified_legacy_google_identity(public):
    c = public
    paid(c)
    with c.factory() as db:
        db.get(models.BetaUser, c.owners[0]).google_subject = None
        db.scalar(select(models.BillingCustomer).where(models.BillingCustomer.user_id == c.owners[0])).verified_at = models.utcnow() - timedelta(seconds=301)
        db.commit()
    c.provider.failure = billing.BillingError(503, "Provider unavailable")
    result = exchange(c, email="billing-0@example.test", sub="legacy-stable-sub")
    assert result.status_code == 200
    assert result.json()["session"]["user"]["id"] == c.owners[0]
    assert_access(result.json()["session"]["user"])
    changed = exchange(c, email="stable-new-email@example.test", sub="legacy-stable-sub")
    assert changed.status_code == 200
    with c.factory() as db:
        user = db.get(models.BetaUser, c.owners[0])
        assert user.email == "stable-new-email@example.test" and user.google_subject == "legacy-stable-sub"
        assert len(db.scalars(select(models.BetaUser)).all()) == 3
        assert db.scalar(select(models.AppStorageItem).where(models.AppStorageItem.user_id == c.owners[0])).value == {"private_owner": 0}


def test_first_verified_legacy_binding_revokes_every_old_session_before_paid_access(public):
    c = public
    paid(c)
    with c.factory() as db:
        db.get(models.BetaUser, c.owners[0]).google_subject = None
        other = models.BetaSession(id="old-manual-impersonation", user_id=c.owners[0], expires_at=models.utcnow() + timedelta(hours=1))
        db.add(other); db.commit()
        token = auth.create_session_token(c.owners[0], other.id, other.expires_at)
    for headers in [c.headers[0], {"Authorization": "Bearer " + token}]:
        assert c.client.get("/api/auth/session", headers=headers).status_code == 401
        assert c.client.get("/api/billing/status", headers=headers).status_code == 401
        assert c.client.get("/api/app-data/export", headers=headers).status_code == 401
    verified = exchange(c, email="billing-0@example.test", sub="now-verified-subject")
    assert verified.status_code == 200
    fresh = {"Authorization": "Bearer " + verified.json()["session"]["token"]}
    assert c.client.get("/api/app-storage/preferences/workspace", headers=fresh).status_code == 200
    assert c.client.get("/api/app-data/export", headers=fresh).status_code == 200
    for headers in [c.headers[0], {"Authorization": "Bearer " + token}]:
        assert c.client.get("/api/auth/session", headers=headers).status_code == 401
    with c.factory() as db:
        owned = db.scalars(select(models.BetaSession).where(models.BetaSession.user_id == c.owners[0])).all()
        assert len(owned) == 1 and owned[0].id not in {c.sessions[0], "old-manual-impersonation"}


def test_beta_manual_identity_free_workspace_does_not_authorize_billing_or_paid_export(public):
    c = public
    paid(c)
    c.set_settings(deployment_mode="beta")
    with c.factory() as db:
        user = db.get(models.BetaUser, c.owners[0])
        user.provider, user.google_subject = "email", None
        db.commit()
    assert identity(c).status_code == 200 and workspace(c).status_code == 200
    for method, path, body in [("GET", "/api/billing/status", None), ("POST", "/api/billing/checkout", {"plan": "pro", "cadence": "monthly"}),
        ("POST", "/api/billing/portal", {}), ("GET", "/api/app-data/export", None)]:
        result = c.client.request(method, path, headers=c.headers[0], json_body=body)
        assert result.status_code == 403 and "Verified Google" in result.json()["detail"]
    c.set_settings(deployment_mode="production")
    assert identity(c).status_code == 401 and workspace(c).status_code == 401
