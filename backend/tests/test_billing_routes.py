"""HTTP billing security tests: real auth/signatures; only provider I/O is a fixture."""
import asyncio
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
import hashlib
import hmac
import json
import time
from types import SimpleNamespace
from urllib.parse import urlsplit

import pytest
import stripe
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import auth, models
from app.api import billing as routes
from app.db import Base, get_db
from app.main import app
from app.services import billing


class HTTPClient:
    """Send exact bytes through the production ASGI app without optional httpx."""
    def request(self, method, path, *, headers=None, json_body=None, body=b""):
        parsed = urlsplit(path)
        if json_body is not None:
            body = json.dumps(json_body).encode()
        headers = dict(headers or {})
        if json_body is not None:
            headers["Content-Type"] = "application/json"
        scope = {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.4"},
                 "method": method, "scheme": "https", "http_version": "1.1",
                 "path": parsed.path, "raw_path": parsed.path.encode(), "root_path": "",
                 "query_string": parsed.query.encode(),
                 "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
                 "server": ("testserver", 443), "client": ("127.0.0.1", 12345)}
        messages, delivered = [], False

        async def receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": body, "more_body": False}
            await asyncio.Event().wait()

        async def send(message):
            messages.append(message)

        async def run():
            try:
                await app(scope, receive, send)
            except Exception:
                if not any(m["type"] == "http.response.start" for m in messages):
                    raise

        asyncio.run(run())
        start = next(m for m in messages if m["type"] == "http.response.start")
        response_body = b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body")
        return SimpleNamespace(status_code=start["status"],
                               headers={k.decode(): v.decode() for k, v in start["headers"]},
                               body=response_body, json=lambda: json.loads(response_body))

    def get(self, path, **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path, **kwargs):
        return self.request("POST", path, **kwargs)


class Provider:
    """Provider-state fixture; it never substitutes auth or webhook verification."""
    def __init__(self, context):
        self.context = context
        self.snapshots, self.checkouts = {}, {}
        self.calls, self.price_changes = [], {}
        self.failure = None
        self.portal_url = "https://billing.stripe.com/p/sessionfixture"

    def retrieve_price(self, identifier):
        self.calls.append(("price", identifier))
        config = self.context.config
        annual = identifier == config.annual_price_id
        return {"id": identifier, "livemode": config.livemode, "currency": "usd",
                "unit_amount": 29000 if annual else 2900, "type": "recurring", "active": True,
                "recurring": {"interval": "year" if annual else "month", "interval_count": 1},
                **self.price_changes}

    def create_customer(self, params, key):
        self.calls.append(("customer", deepcopy(params), key))
        mode = "L" if self.context.config.livemode else "T"
        return {"id": "cus_" + mode + params["metadata"]["edgelab_user_id"],
                "livemode": self.context.config.livemode}

    def list_subscriptions(self, customer):
        self.calls.append(("subscriptions", customer))
        if self.failure:
            raise self.failure
        return deepcopy(self.snapshots.get(customer, {"data": [], "has_more": False}))

    def create_checkout(self, params, key):
        self.calls.append(("checkout", deepcopy(params), key))
        identifier = "cs_" + ("live_" if self.context.config.livemode else "test_") + str(len(self.checkouts) + 1)
        value = {"id": identifier, "customer": params["customer"], "livemode": self.context.config.livemode,
                 "mode": "subscription", "status": "open", "url": "https://checkout.stripe.com/c/pay/" + identifier}
        self.checkouts[identifier] = value
        return deepcopy(value)

    def retrieve_checkout(self, identifier):
        self.calls.append(("retrieve_checkout", identifier))
        return deepcopy(self.checkouts[identifier])

    def expire_checkout(self, identifier):
        self.calls.append(("expire_checkout", identifier))
        self.checkouts[identifier]["status"] = "expired"
        return deepcopy(self.checkouts[identifier])

    def create_portal(self, params):
        self.calls.append(("portal", deepcopy(params)))
        return {"url": self.portal_url}


@pytest.fixture
def context(monkeypatch):
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    monkeypatch.setattr(auth, "settings", SimpleNamespace(deployment_mode="production", jwt_secret="billing-route-jwt", api_token="static-api-key"))
    config = billing.BillingConfig(enabled=True, mode="live", secret_key="sk_live_routefixture",
                                   webhook_secret="whsec_routefixture", monthly_price_id="price_ProMonthly",
                                   annual_price_id="price_ProAnnual", public_origin="https://edgelab.example")
    value = SimpleNamespace(factory=factory, config=config, headers=[], owners=[], sessions=[], client=HTTPClient())
    with factory() as db:
        for index, status in enumerate(["APPROVED", "APPROVED", "WAITLISTED"]):
            user = models.BetaUser(email=f"billing-{index}@example.test", name=f"Owner {index}", provider="google", google_subject=f"verified_billing_{index}", status=status)
            db.add(user)
            db.flush()
            expires = models.utcnow() + timedelta(hours=1)
            session = models.BetaSession(id=f"billing-session-{index}", user_id=user.id, expires_at=expires)
            db.add(session)
            value.owners.append(user.id)
            value.sessions.append(session.id)
            value.headers.append({"Authorization": "Bearer " + auth.create_session_token(user.id, session.id, expires)})
        db.commit()
    value.provider = Provider(value)

    def database():
        with factory() as db:
            yield db

    original = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[routes.get_billing_config] = lambda: value.config
    app.dependency_overrides[routes.get_billing_provider] = lambda: value.provider
    try:
        yield value
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(original)
        engine.dispose()


def checkout(context, owner=0, cadence="monthly"):
    return context.client.post("/api/billing/checkout", headers=context.headers[owner],
                               json_body={"plan": "pro", "cadence": cadence})


def customer(context, owner=0):
    with context.factory() as db:
        row = db.scalar(select(models.BillingCustomer).where(
            models.BillingCustomer.user_id == context.owners[owner],
            models.BillingCustomer.livemode == context.config.livemode))
        return row.stripe_customer_id if row else None


def snapshot(context, customer_id, *, state="active", cadence="monthly", identifier="sub_paid"):
    price = context.provider.retrieve_price(context.config.price_id(cadence))
    return {"data": [{"id": identifier, "customer": customer_id, "livemode": context.config.livemode,
                      "status": state, "cancel_at_period_end": False,
                      "items": {"data": [{"price": price, "quantity": 1,
                                           "current_period_end": int(time.time()) + 86400}], "has_more": False},
                      "latest_invoice": {"id": "in_paid", "customer": customer_id, "livemode": context.config.livemode,
                                         "parent": {"type": "subscription_details",
                                                    "subscription_details": {"subscription": identifier}},
                                         "status": "paid"}}],
            "has_more": False}


def event(context, identifier="evt_route", customer_id=None, *, kind="customer.subscription.updated", created=1):
    return {"id": identifier, "object": "event", "api_version": billing.API_VERSION,
            "type": kind, "livemode": context.config.livemode, "created": created,
            "data": {"object": {"id": "sub_payload", "customer": customer_id}}}


def signed(context, value, *, timestamp=None, raw=None):
    # Independent HMAC producer. Production verification uses the actual Stripe SDK.
    payload = raw if raw is not None else json.dumps(value, ensure_ascii=False, indent=2).encode()
    stamp = str(int(time.time()) if timestamp is None else timestamp)
    signature = hmac.new(context.config.webhook_secret.encode(), stamp.encode() + b"." + payload, hashlib.sha256).hexdigest()
    return payload, {"Stripe-Signature": f"t={stamp},v1={signature}", "Content-Type": "application/json"}


def deliver(context, value, **kwargs):
    body, headers = signed(context, value, **kwargs)
    return context.client.post("/api/billing/webhook", headers=headers, body=body)


def status(context, owner=0, query=""):
    return context.client.get("/api/billing/status" + query, headers=context.headers[owner])


def count(context, model):
    with context.factory() as db:
        return len(db.scalars(select(model)).all())


def test_production_catalog_public_and_identity_status_private_no_secrets(context):
    response = context.client.get("/api/billing/catalog")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["checkout_available"] is True
    assert response.json()["plans"] == [{"id": "pro", "name": "EdgeLab Pro", "currency": "usd",
                                       "monthly_amount": 2900, "annual_amount": 29000}]
    assert context.config.secret_key.encode() not in response.body
    assert context.config.webhook_secret.encode() not in response.body
    own = status(context)
    assert own.status_code == 200 and own.headers["cache-control"] == "no-store"
    assert own.json()["workspace_access"] is False and own.json()["subscription_access"] is False


@pytest.mark.parametrize("method,path,payload", [
    ("GET", "/api/billing/status", None), ("POST", "/api/billing/checkout", {"plan": "pro", "cadence": "monthly"}),
    ("POST", "/api/billing/portal", {}),
])
@pytest.mark.parametrize("authorization", [None, "Bearer static-api-key", "Bearer invalid.jwt.token"])
def test_money_routes_require_actual_account_session(context, method, path, payload, authorization):
    response = context.client.request(method, path, json_body=payload,
                                      headers={} if authorization is None else {"Authorization": authorization})
    assert response.status_code == 401
    assert context.provider.calls == [] and count(context, models.BillingCustomer) == 0


def test_revoked_real_session_cannot_checkout(context):
    with context.factory() as db:
        db.delete(db.get(models.BetaSession, context.sessions[0]))
        db.commit()
    assert checkout(context).status_code == 401
    assert context.provider.calls == []


@pytest.mark.parametrize("path,payload", [
    ("/api/billing/checkout", {"plan": "pro", "cadence": "monthly", "price_id": "price_attacker"}),
    ("/api/billing/checkout", {"plan": "pro", "cadence": "monthly", "user_id": 2}),
    ("/api/billing/checkout", {"plan": "pro", "cadence": "annual", "success_url": "https://attacker.example"}),
    ("/api/billing/checkout", {"plan": "pro", "cadence": "weekly"}),
    ("/api/billing/portal", {"customer": "cus_other"}),
    ("/api/billing/portal", {"return_url": "https://attacker.example"}),
])
def test_client_cannot_choose_owner_price_or_redirect(context, path, payload):
    assert context.client.post(path, headers=context.headers[0], json_body=payload).status_code == 422
    assert context.provider.calls == []


def test_two_owners_server_prices_portal_and_checkout_retry_are_bound(context):
    for owner, cadence in [(0, "monthly"), (1, "annual")]:
        first = checkout(context, owner, cadence)
        assert first.status_code == 200 and first.headers["cache-control"] == "no-store"
        assert checkout(context, owner, cadence).json() == first.json()
        params = [c[1] for c in context.provider.calls if c[0] == "checkout"][-1]
        assert params["customer"] == customer(context, owner)
        assert params["client_reference_id"] == str(context.owners[owner])
        assert params["line_items"] == [{"price": context.config.price_id(cadence), "quantity": 1}]
        assert params["success_url"] == "https://edgelab.example/pricing?billing=success"
        assert params["cancel_url"] == "https://edgelab.example/pricing?billing=cancel"
        portal = context.client.post("/api/billing/portal", json_body={}, headers=context.headers[owner])
        assert portal.status_code == 200 and portal.headers["cache-control"] == "no-store"
        assert context.provider.calls[-1] == ("portal", {"customer": customer(context, owner),
                                                        "return_url": "https://edgelab.example/pricing"})
    assert customer(context, 0) != customer(context, 1)
    assert len([c for c in context.provider.calls if c[0] == "checkout"]) == 2
    assert status(context, 0, "?user_id=" + str(context.owners[1])).json()["workspace_access"] is False
    assert context.client.post("/api/billing/portal", json_body={}, headers=context.headers[2]).status_code == 409


def test_invalid_configured_provider_price_blocks_purchase_before_customer_creation(context):
    context.provider.price_changes = {"unit_amount": 2901}
    assert context.client.get("/api/billing/catalog").json()["checkout_available"] is False
    assert checkout(context).status_code == 503
    assert not any(c[0] in {"customer", "checkout"} for c in context.provider.calls)


def test_redirect_and_paid_checkout_payload_do_not_grant_access_without_current_subscription(context):
    assert checkout(context).status_code == 200
    query = "?billing=success&paid=true&session_id=" + next(iter(context.provider.checkouts))
    assert status(context, query=query).json()["workspace_access"] is False
    value = event(context, customer_id=customer(context), kind="checkout.session.completed")
    value["data"]["object"].update(payment_status="paid", status="complete", client_reference_id=str(context.owners[0]))
    assert deliver(context, value).status_code == 200
    assert status(context).json()["workspace_access"] is False
    assert count(context, models.BillingSubscription) == 0


def test_sdk_verifies_exact_utf8_body_and_signed_duplicate_is_idempotent(context, monkeypatch):
    original = stripe.Webhook.construct_event
    observed = []

    def canonical(payload, signature, secret, *args, **kwargs):
        observed.append((payload, signature, secret))
        return original(payload, signature, secret, *args, **kwargs)

    monkeypatch.setattr(stripe.Webhook, "construct_event", canonical)
    value = event(context, kind="unhandled.fixture")
    value["data"]["object"]["name"] = "Élodie"
    raw, headers = signed(context, value)
    first = context.client.post("/api/billing/webhook", body=raw, headers=headers)
    assert first.status_code == 200 and first.json() == {"received": True, "duplicate": False}
    assert observed == [(raw, headers["Stripe-Signature"], context.config.webhook_secret)]
    compact = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
    assert deliver(context, value, raw=compact).json() == {"received": True, "duplicate": True}
    assert observed[-1][0] == compact and count(context, models.BillingWebhookEvent) == 1


@pytest.mark.parametrize("fault", ["missing", "incorrect", "past", "future", "changed-body", "malformed-json"])
def test_signature_failures_cannot_create_receipts_or_provider_reads(context, fault):
    value = event(context)
    timestamp = int(time.time()) + (-1000 if fault == "past" else 1000 if fault == "future" else 0)
    raw, headers = signed(context, value, timestamp=timestamp)
    if fault == "missing":
        headers.pop("Stripe-Signature")
    elif fault == "incorrect":
        headers["Stripe-Signature"] = f"t={timestamp},v1=" + "0" * 64
    elif fault == "changed-body":
        raw += b" "
    elif fault == "malformed-json":
        raw, headers = signed(context, value, raw=b'{"broken":')
    assert context.client.post("/api/billing/webhook", body=raw, headers=headers).status_code == 400
    assert context.provider.calls == [] and count(context, models.BillingWebhookEvent) == 0


@pytest.mark.parametrize("field,value", [("livemode", False), ("api_version", "2020-08-27"), ("account", "acct_other")])
def test_authentic_signed_wrong_environment_or_connected_account_is_rejected(context, field, value):
    payload = event(context)
    payload[field] = value
    assert deliver(context, payload).status_code == 400
    assert count(context, models.BillingWebhookEvent) == 0 and context.provider.calls == []


def test_raw_webhook_stream_is_bounded_before_verification(context):
    raw = b" " * (billing.WEBHOOK_BYTES + 1)
    assert deliver(context, event(context), raw=raw).status_code == 413
    assert count(context, models.BillingWebhookEvent) == 0


def test_signed_metadata_cannot_rebind_an_owned_customer_or_create_unknown_owner(context):
    assert checkout(context).status_code == 200
    own = customer(context)
    context.provider.snapshots[own] = snapshot(context, own)
    payload = event(context, customer_id=own)
    payload["data"]["object"]["metadata"] = {"edgelab_user_id": str(context.owners[1])}
    assert deliver(context, payload).status_code == 200
    assert status(context, 0).json()["workspace_access"] is True
    assert status(context, 1).json()["workspace_access"] is False
    unknown = event(context, "evt_unknown", "cus_unknown")
    unknown["data"]["object"]["metadata"] = {"edgelab_user_id": str(context.owners[1])}
    assert deliver(context, unknown).status_code == 200
    assert status(context, 1).json()["workspace_access"] is False
    with context.factory() as db:
        assert [s.user_id for s in db.scalars(select(models.BillingSubscription)).all()] == [context.owners[0]]


def test_duplicate_and_conflicting_event_ids_do_not_repeat_provider_effects(context):
    assert checkout(context).status_code == 200
    own = customer(context)
    context.provider.snapshots[own] = snapshot(context, own)
    payload = event(context, customer_id=own)
    assert deliver(context, payload).json()["duplicate"] is False
    calls = len(context.provider.calls)
    assert deliver(context, payload).json()["duplicate"] is True
    assert len(context.provider.calls) == calls
    payload["created"] += 1
    assert deliver(context, payload).status_code == 409
    assert len(context.provider.calls) == calls
    assert count(context, models.BillingWebhookEvent) == count(context, models.BillingSubscription) == 1


def test_out_of_order_payload_uses_current_provider_state_not_embedded_status(context):
    assert checkout(context).status_code == 200
    own = customer(context)
    context.provider.snapshots[own] = snapshot(context, own)
    old = event(context, "evt_oldDeleted", own, kind="customer.subscription.deleted", created=1)
    old["data"]["object"]["status"] = "canceled"
    assert deliver(context, old).status_code == 200
    assert status(context).json()["workspace_access"] is True
    context.provider.snapshots[own] = snapshot(context, own, state="past_due")
    new = event(context, "evt_newActive", own, created=2)
    new["data"]["object"]["status"] = "active"
    assert deliver(context, new).status_code == 200
    assert status(context).json()["workspace_access"] is False
    late = event(context, "evt_laterDeliveryOld", own, created=1)
    late["data"]["object"]["status"] = "active"
    assert deliver(context, late).status_code == 200
    assert status(context).json()["status"] == "past_due"


def test_provider_failure_is_retryable_and_does_not_commit_partial_event_or_lease(context):
    assert checkout(context).status_code == 200
    own = customer(context)
    context.provider.snapshots[own] = snapshot(context, own)
    assert status(context).json()["workspace_access"] is True
    with context.factory() as db:
        previous = db.scalar(select(models.BillingCustomer)).verified_at
    context.provider.failure = billing.BillingError(503, "Payment provider is unavailable. Try again.")
    payload = event(context, customer_id=own)
    assert deliver(context, payload).status_code == 503
    assert status(context).status_code == 503
    assert count(context, models.BillingWebhookEvent) == 0
    with context.factory() as db:
        assert db.scalar(select(models.BillingCustomer)).verified_at == previous
        assert db.scalar(select(models.BillingSubscription)).status == "active"
    context.provider.failure = None
    context.provider.snapshots[own] = snapshot(context, own, state="past_due")
    assert deliver(context, payload).status_code == 200
    assert status(context).json()["workspace_access"] is False


@pytest.mark.parametrize("fault", ["incomplete", "foreign-customer"])
def test_incomplete_or_cross_owner_provider_snapshot_cannot_replace_verified_state(context, fault):
    assert checkout(context).status_code == 200
    own = customer(context)
    context.provider.snapshots[own] = snapshot(context, own)
    assert status(context).json()["workspace_access"] is True
    invalid = snapshot(context, own)
    if fault == "incomplete":
        invalid["has_more"] = True
    else:
        invalid["data"][0]["customer"] = "cus_other"
    context.provider.snapshots[own] = invalid
    assert deliver(context, event(context, customer_id=own)).status_code == 503
    assert count(context, models.BillingWebhookEvent) == 0
    with context.factory() as db:
        assert db.scalar(select(models.BillingSubscription)).status == "active"


def test_test_mode_entitlement_is_separate_and_never_grants_live_workspace(context):
    assert checkout(context).status_code == 200
    live_customer = customer(context)
    context.provider.snapshots[live_customer] = snapshot(context, live_customer)
    assert status(context).json()["workspace_access"] is True
    live_event = event(context, customer_id=live_customer)
    context.config = replace(context.config, mode="test", secret_key="sk_test_routefixture")
    assert deliver(context, live_event).status_code == 400
    assert status(context).json()["status"] == "inactive"
    assert checkout(context).status_code == 200
    test_customer = customer(context)
    assert test_customer != live_customer
    context.provider.snapshots[test_customer] = snapshot(context, test_customer, identifier="sub_testPaid")
    test_status = status(context).json()
    assert test_status["subscription_access"] is True and test_status["workspace_access"] is False
    with context.factory() as db:
        assert sorted(row.livemode for row in db.scalars(select(models.BillingCustomer)).all()) == [False, True]
        assert sorted(row.livemode for row in db.scalars(select(models.BillingSubscription)).all()) == [False, True]


def test_disabled_billing_retains_identity_and_beta_without_paid_access_or_provider_calls(context):
    context.config = replace(context.config, enabled=False)
    assert context.client.get("/api/billing/catalog").json()["checkout_available"] is False
    own = status(context).json()
    assert own["configured"] is False and own["workspace_access"] is False
    assert checkout(context).status_code == 503
    assert context.client.post("/api/billing/portal", headers=context.headers[0], json_body={}).status_code == 503
    assert context.provider.calls == []


@pytest.mark.parametrize("fault", ["mode", "association", "missing-parent", "parent-kind"])
def test_invoice_identity_failure_cannot_grant_access_through_signed_http_event(context, fault):
    assert checkout(context).status_code == 200
    own = customer(context)
    current = snapshot(context, own)
    invoice = current["data"][0]["latest_invoice"]
    if fault == "mode":
        invoice["livemode"] = False
    elif fault == "association":
        invoice["parent"]["subscription_details"]["subscription"] = "sub_other"
    elif fault == "missing-parent":
        del invoice["parent"]
    else:
        invoice["parent"]["type"] = "quote_details"
    context.provider.snapshots[own] = current
    with context.factory() as db:
        before = db.scalar(select(models.BillingCustomer)).verified_at
    response = deliver(context, event(context, customer_id=own, kind="invoice.paid"))
    assert response.status_code == 503
    assert status(context).status_code == 503
    assert count(context, models.BillingWebhookEvent) == count(context, models.BillingSubscription) == 0
    with context.factory() as db:
        assert db.scalar(select(models.BillingCustomer)).verified_at == before


def test_signed_delivery_counter_retry_is_duplicate_but_immutable_changes_conflict(context):
    assert checkout(context).status_code == 200
    own = customer(context)
    context.provider.snapshots[own] = snapshot(context, own)
    original = event(context, customer_id=own)
    original["pending_webhooks"] = 2
    assert deliver(context, original).json() == {"received": True, "duplicate": False}
    calls = len(context.provider.calls)
    retry = deepcopy(original)
    retry["pending_webhooks"] = 1
    response = deliver(context, retry)
    assert response.status_code == 200 and response.json() == {"received": True, "duplicate": True}
    assert len(context.provider.calls) == calls
    changed_created = deepcopy(retry)
    changed_created["created"] += 1
    assert deliver(context, changed_created).status_code == 409
    changed_data = deepcopy(retry)
    changed_data["data"]["object"]["status"] = "unpaid"
    assert deliver(context, changed_data).status_code == 409
    assert len(context.provider.calls) == calls
    assert count(context, models.BillingWebhookEvent) == count(context, models.BillingSubscription) == 1


@pytest.mark.parametrize("association,current_state,allowed", [
    ("sub_original", "canceled", True),
    ("sub_original", "incomplete_expired", True),
    ("sub_other", "canceled", False),
    ("sub_original", None, False),
])
def test_repurchase_requires_completed_checkout_exact_current_terminal_subscription(context, association, current_state, allowed):
    assert checkout(context).status_code == 200
    own = customer(context)
    previous_checkout = next(iter(context.provider.checkouts))
    context.provider.snapshots[own] = snapshot(context, own, identifier="sub_original")
    assert status(context).json()["workspace_access"] is True
    context.provider.checkouts[previous_checkout].update(status="complete", subscription=association)
    # An absent provider record makes the local cached row canceled. It still
    # cannot prove terminal fulfillment of this completed checkout.
    context.provider.snapshots[own] = (snapshot(context, own, state=current_state, identifier="sub_original")
                                       if current_state else {"data": [], "has_more": False})
    second = checkout(context, cadence="annual")
    if allowed:
        assert second.status_code == 200
        creates = [call for call in context.provider.calls if call[0] == "checkout"]
        assert len(creates) == 2
        assert creates[-1][1]["line_items"] == [{"price": "price_ProAnnual", "quantity": 1}]
        assert creates[-1][1]["customer"] == own
        assert second.json()["url"] != context.provider.checkouts[previous_checkout]["url"]
        assert checkout(context, cadence="annual").json() == second.json()
    else:
        assert second.status_code == 409
        assert len([call for call in context.provider.calls if call[0] == "checkout"]) == 1
        with context.factory() as db:
            assert db.scalar(select(models.BillingCustomer)).checkout_session_id == previous_checkout
    assert not any(call[0] == "expire_checkout" for call in context.provider.calls)


@pytest.mark.parametrize("raw", [b"[]", b"null", b'{"deep":' + b"[" * 1500 + b"0" + b"]" * 1500 + b"}"],
                         ids=["signed-list", "signed-null", "signed-deep-json"])
def test_valid_hmac_invalid_event_structure_returns_controlled_400(context, raw):
    response = deliver(context, None, raw=raw)
    assert response.status_code == 400
    assert context.config.secret_key.encode() not in response.body
    assert context.config.webhook_secret.encode() not in response.body
    assert context.provider.calls == []
    assert count(context, models.BillingWebhookEvent) == 0
