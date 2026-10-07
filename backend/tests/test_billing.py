import copy
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import hashlib
import hmac
import json
from threading import Barrier
import time

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import BetaUser, BillingCustomer, BillingSubscription, BillingWebhookEvent, MarketDataEntitlement, utcnow
from app.services import billing


def config(mode="live"):
    return billing.BillingConfig(True, f"sk_{mode}_fixture", "whsec_fixture", mode, "price_month001", "price_year001", "https://edgelab.example")


class FakeProvider:
    def __init__(self, conf):
        self.config = conf
        self.prices = {
            conf.price_id(cadence): {"id": conf.price_id(cadence), "active": True, "livemode": conf.livemode, "type": "recurring", "currency": "usd", "unit_amount": amount, "recurring": {"interval": interval, "interval_count": 1, "usage_type": "licensed"}}
            for cadence, (interval, amount) in billing.CADENCES.items()
        }
        self.subscriptions = []
        self.customers = {}
        self.checkouts = {}
        self.calls = []
        self.fail_list = False
        self.fail_checkout_once = False

    def retrieve_price(self, price_id):
        self.calls.append(("price", price_id))
        return copy.deepcopy(self.prices[price_id])

    def create_customer(self, params, key):
        self.calls.append(("customer", copy.deepcopy(params), key))
        if key not in self.customers:
            self.customers[key] = {"id": f"cus_{self.config.mode}{len(self.customers)+1}", "livemode": self.config.livemode}
        return copy.deepcopy(self.customers[key])

    def list_subscriptions(self, customer):
        self.calls.append(("list", customer))
        if self.fail_list:
            raise billing.BillingError(503, "Temporary provider failure.")
        return {"data": copy.deepcopy(self.subscriptions), "has_more": False}

    def create_checkout(self, params, key):
        self.calls.append(("checkout", copy.deepcopy(params), key))
        if key not in self.checkouts:
            self.checkouts[key] = {"id": f"cs_{self.config.mode}_{len(self.checkouts)+1}", "livemode": self.config.livemode, "customer": params["customer"], "mode": "subscription", "status": "open", "url": "https://checkout.stripe.com/c/pay/fixture"}
        if self.fail_checkout_once:
            self.fail_checkout_once = False
            raise billing.BillingError(503, "Response was lost after provider creation.")
        return copy.deepcopy(self.checkouts[key])

    def retrieve_checkout(self, session_id):
        return copy.deepcopy(next(value for value in self.checkouts.values() if value["id"] == session_id))

    def expire_checkout(self, session_id):
        found = next(value for value in self.checkouts.values() if value["id"] == session_id)
        found["status"] = "expired"
        return copy.deepcopy(found)

    def create_portal(self, params):
        self.calls.append(("portal", copy.deepcopy(params)))
        return {"url": "https://billing.stripe.com/p/session/fixture"}


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    session.add_all([BetaUser(id=1, email="one@example.com", name="One", status="APPROVED"), BetaUser(id=2, email="two@example.com", name="Two", status="WAITLISTED")])
    session.commit()
    yield session
    session.close()
    engine.dispose()


def customer(db, conf, user_id=1):
    value = BillingCustomer(user_id=user_id, livemode=conf.livemode, stripe_customer_id=f"cus_{conf.mode}{user_id}")
    db.add(value)
    db.commit()
    return value


def subscription(conf, cust, *, status="active", price=None, period=None, paid=True, sub_id="sub_001"):
    return {
        "id": sub_id, "customer": cust.stripe_customer_id, "livemode": conf.livemode,
        "status": status, "cancel_at_period_end": False,
        "items": {"data": [{"price": price or FakeProvider(conf).prices[conf.monthly_price_id], "quantity": 1, "current_period_end": period or int(time.time()) + 3600}], "has_more": False},
        "latest_invoice": {"id": "in_001", "customer": cust.stripe_customer_id, "livemode": conf.livemode, "parent": {"type": "subscription_details", "subscription_details": {"subscription": sub_id}}, "status": "paid" if paid else "open"},
    }


def event(conf, cust, *, event_id="evt_001", kind="invoice.paid", advertised_status="active", created=None):
    return {"id": event_id, "object": "event", "livemode": conf.livemode, "api_version": billing.API_VERSION, "type": kind, "created": created or int(time.time()), "data": {"object": {"id": "in_001", "object": "invoice", "customer": cust.stripe_customer_id, "status": advertised_status}}}


def signed(value, conf, timestamp=None):
    payload = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
    stamp = str(int(time.time()) if timestamp is None else timestamp)
    signature = hmac.new(conf.webhook_secret.encode(), stamp.encode() + b"." + payload, hashlib.sha256).hexdigest()
    return payload, f"t={stamp},v1={signature}"


def hook(db, conf, provider, value):
    payload, signature = signed(value, conf)
    result = billing.process_webhook(db, payload, signature, conf, provider)
    db.commit()
    return result


def test_unconfigured_catalog_status_and_checkout_are_honest(db):
    conf = billing.BillingConfig()
    catalog = billing.catalog(conf)
    assert catalog["checkout_available"] is False
    assert catalog["reason"] == "Paid checkout is not configured."
    assert catalog["plans"][0]["monthly_amount"] == 2900
    assert billing.status(db, 1, conf)["workspace_access"] is False
    with pytest.raises(billing.BillingError, match="not configured"):
        billing.create_checkout(db, 1, "pro", "monthly", conf)
    assert db.scalar(select(BillingCustomer)) is None


@pytest.mark.parametrize("mutation", [
    {"currency": "inr"}, {"unit_amount": 1}, {"unit_amount": True}, {"active": False}, {"livemode": False},
    {"recurring": {"interval": "year", "interval_count": 1}}, {"recurring": {"interval": "month", "interval_count": 2}},
    {"recurring": {"interval": "month", "interval_count": 1, "usage_type": "metered"}},
])
def test_allowlisted_price_must_match_published_catalog(db, mutation):
    conf = config()
    provider = FakeProvider(conf)
    provider.prices[conf.monthly_price_id].update(mutation)
    assert billing.catalog(conf, provider)["checkout_available"] is False
    with pytest.raises(billing.BillingError, match="does not match"):
        billing.create_checkout(db, 1, "pro", "monthly", conf, provider)
    assert not any(call[0] == "customer" for call in provider.calls)


def test_checkout_is_server_owned_pending_reused_and_cadence_change_expires_old(db):
    conf = config()
    provider = FakeProvider(conf)
    first = billing.create_checkout(db, 1, "pro", "monthly", conf, provider)
    db.commit()
    again = billing.create_checkout(db, 1, "pro", "monthly", conf, provider)
    assert first == again
    assert len(provider.checkouts) == 1
    cust = db.scalar(select(BillingCustomer))
    call = next(call for call in provider.calls if call[0] == "checkout")
    assert call[1]["customer"] == cust.stripe_customer_id
    assert call[1]["line_items"] == [{"price": conf.monthly_price_id, "quantity": 1}]
    assert call[1]["success_url"] == "https://edgelab.example/pricing?billing=success"
    assert call[1]["subscription_data"]["metadata"]["edgelab_user_id"] == "1"
    assert billing.workspace_access(db, 1, conf) is False
    billing.create_checkout(db, 1, "pro", "annual", conf, provider)
    db.commit()
    assert len(provider.checkouts) == 2
    assert list(provider.checkouts.values())[0]["status"] == "expired"
    assert len(provider.customers) == 1
    assert db.get(BetaUser, 1).status == "APPROVED"
    assert db.scalar(select(MarketDataEntitlement)) is None


def test_lost_checkout_response_retries_same_durable_idempotency_token(db):
    conf = config()
    provider = FakeProvider(conf)
    provider.fail_checkout_once = True
    with pytest.raises(billing.BillingError, match="lost"):
        billing.create_checkout(db, 1, "pro", "monthly", conf, provider)
    db.rollback()
    nonce = db.scalar(select(BillingCustomer)).pending_nonce
    assert nonce
    billing.create_checkout(db, 1, "pro", "monthly", conf, provider)
    db.commit()
    calls = [call for call in provider.calls if call[0] == "checkout"]
    assert calls[0][1:] == calls[1][1:]
    assert len(provider.checkouts) == 1


def test_portal_uses_only_this_user_stored_customer(db):
    conf = config()
    provider = FakeProvider(conf)
    cust = customer(db, conf)
    assert billing.create_portal(db, 1, conf, provider)["url"].startswith("https://billing.stripe.com/")
    assert provider.calls[-1] == ("portal", {"customer": cust.stripe_customer_id, "return_url": "https://edgelab.example/pricing"})
    with pytest.raises(billing.BillingError, match="No billing account"):
        billing.create_portal(db, 2, conf, provider)


@pytest.mark.parametrize("url", ["https://checkout.stripe.com.evil.example/a", "http://checkout.stripe.com/a", "https://user@checkout.stripe.com/a", "https://checkout.stripe.com:443/a", "https://checkout.stripe.com:bad/a", "https://checkout.stripe.com/a\n"])
def test_redirects_are_exact_provider_hosts(url):
    with pytest.raises(billing.BillingError, match="invalid redirect"):
        billing._hosted_url(url, "checkout.stripe.com")


def test_real_sdk_verifier_raw_utf8_replay_and_environment_guards(db):
    conf = config()
    cust = customer(db, conf)
    value = event(conf, cust)
    value["description"] = "café"
    body, signature = signed(value, conf)
    assert billing.verify_event(body, signature, conf) == value
    for bad_body, bad_signature in [(body + b" ", signature), (body, signature + ",t=1"), (body, "t=1,v1=" + "0"*64)]:
        with pytest.raises(billing.BillingError):
            billing.verify_event(bad_body, bad_signature, conf)
    for stamp in [int(time.time()) - 301, int(time.time()) + 301]:
        with pytest.raises(billing.BillingError, match="expired"):
            billing.verify_event(*signed(value, conf, stamp), conf)
    for mutation in [{"livemode": False}, {"api_version": "2024-06-20"}, {"account": "acct_other"}]:
        wrong = value | mutation
        with pytest.raises(billing.BillingError):
            billing.verify_event(*signed(wrong, conf), conf)


@pytest.mark.parametrize("status,paid,expected", [
    ("active", True, True), ("active", False, False), ("incomplete", True, False),
    ("trialing", True, False), ("past_due", True, False), ("unpaid", True, False),
    ("canceled", True, False), ("paused", True, False),
])
def test_access_requires_current_paid_active_subscription(db, status, paid, expected):
    conf = config()
    provider = FakeProvider(conf)
    cust = customer(db, conf)
    provider.subscriptions = [subscription(conf, cust, status=status, paid=paid)]
    result = billing.status(db, 1, conf, provider)
    db.commit()
    assert result["workspace_access"] is expected
    assert billing.workspace_access(db, 1, conf) is expected
    assert billing.workspace_access(db, 2, conf) is False


def test_short_lease_and_term_expiry_fail_closed_and_refresh_recovers(db):
    conf = config()
    provider = FakeProvider(conf)
    cust = customer(db, conf)
    provider.subscriptions = [subscription(conf, cust)]
    assert billing.refresh_workspace_access(db, 1, conf, provider) is True
    db.commit()
    cust.verified_at = utcnow() - timedelta(seconds=301)
    db.commit()
    before = cust.verified_at
    assert billing.workspace_access(db, 1, conf) is False
    assert billing.status(db, 1, conf, provider, refresh=False)["refresh_required"] is True
    provider.fail_list = True
    with pytest.raises(billing.BillingError):
        billing.refresh_workspace_access(db, 1, conf, provider)
    db.rollback()
    assert cust.verified_at == before
    assert billing.workspace_access(db, 1, conf) is False
    provider.fail_list = False
    assert billing.refresh_workspace_access(db, 1, conf, provider) is True
    db.commit()
    provider.subscriptions[0]["items"]["data"][0]["current_period_end"] = int(time.time()) - 1
    assert billing.refresh_workspace_access(db, 1, conf, provider) is False


def test_webhooks_idempotent_current_state_not_event_order_and_failed_retry(db):
    conf = config()
    provider = FakeProvider(conf)
    cust = customer(db, conf)
    provider.subscriptions = [subscription(conf, cust)]
    first = event(conf, cust)
    assert hook(db, conf, provider, first)["duplicate"] is False
    calls = len(provider.calls)
    assert hook(db, conf, provider, first)["duplicate"] is True
    assert len(provider.calls) == calls
    provider.subscriptions[0]["status"] = "canceled"
    older = event(conf, cust, event_id="evt_older", advertised_status="active", created=first["created"])
    hook(db, conf, provider, older)
    assert billing.workspace_access(db, 1, conf) is False
    provider.subscriptions.append(subscription(conf, cust, sub_id="sub_new"))
    hook(db, conf, provider, event(conf, cust, event_id="evt_new", created=first["created"]))
    assert billing.workspace_access(db, 1, conf) is True
    provider.fail_list = True
    retry = event(conf, cust, event_id="evt_retry")
    with pytest.raises(billing.BillingError):
        hook(db, conf, provider, retry)
    db.rollback()
    assert db.get(BillingWebhookEvent, ("evt_retry", True)) is None
    provider.fail_list = False
    assert hook(db, conf, provider, retry)["duplicate"] is False
    conflict = first | {"description": "changed"}
    with pytest.raises(billing.BillingError, match="reused"):
        hook(db, conf, provider, conflict)


def test_invalid_provider_ownership_incomplete_snapshot_or_unknown_price_cannot_grant(db):
    conf = config()
    provider = FakeProvider(conf)
    cust = customer(db, conf)
    provider.subscriptions = [subscription(conf, cust)]
    provider.subscriptions[0]["customer"] = "cus_someoneelse"
    with pytest.raises(billing.BillingError, match="ownership"):
        billing.status(db, 1, conf, provider)
    db.rollback()
    assert cust.verified_at is None
    provider.subscriptions = [subscription(conf, cust)]
    provider.subscriptions[0]["items"]["data"][0]["price"]["id"] = "price_unknown"
    assert billing.status(db, 1, conf, provider)["workspace_access"] is False
    db.commit()
    provider.list_subscriptions = lambda _: {"data": [], "has_more": True}
    with pytest.raises(billing.BillingError, match="complete"):
        billing.status(db, 1, conf, provider)


def test_sandbox_live_mode_switch_retains_history_and_never_grants_test_access(db):
    test, live = config("test"), config("live")
    test_provider, live_provider = FakeProvider(test), FakeProvider(live)
    billing.create_checkout(db, 1, "pro", "monthly", test, test_provider)
    db.commit()
    test_customer = db.scalar(select(BillingCustomer).where(BillingCustomer.livemode.is_(False)))
    test_provider.subscriptions = [subscription(test, test_customer)]
    result = billing.status(db, 1, test, test_provider)
    db.commit()
    assert result["subscription_access"] is True and result["workspace_access"] is False
    billing.create_checkout(db, 1, "pro", "monthly", live, live_provider)
    db.commit()
    assert len(db.scalars(select(BillingCustomer)).all()) == 2
    live_customer = db.scalar(select(BillingCustomer).where(BillingCustomer.livemode.is_(True)))
    assert live_customer.stripe_customer_id != test_customer.stripe_customer_id
    assert billing.workspace_access(db, 1, live) is False
    live_provider.subscriptions = [subscription(live, live_customer, sub_id="sub_live")]
    assert billing.status(db, 1, live, live_provider)["workspace_access"] is True
    db.commit()
    assert len(db.scalars(select(BillingSubscription)).all()) == 2


def test_concurrent_checkout_reuses_one_purchase_and_customer(tmp_path):
    conf = config()
    provider = FakeProvider(conf)
    engine = create_engine(f"sqlite:///{tmp_path / 'billing.sqlite'}", connect_args={"check_same_thread": False, "timeout": 10})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    with factory() as seed:
        seed.add(BetaUser(id=1, email="one@example.com", name="One", status="APPROVED"))
        seed.commit()
    start = Barrier(2)
    def purchase():
        with factory() as session:
            start.wait(timeout=5)
            result = billing.create_checkout(session, 1, "pro", "monthly", conf, provider)
            session.commit()
            return result
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: purchase(), range(2)))
    assert results[0] == results[1]
    assert len(provider.customers) == len(provider.checkouts) == 1
    with factory() as check:
        assert len(check.scalars(select(BillingCustomer)).all()) == 1
    engine.dispose()


@pytest.mark.parametrize("mutation", [
    {"livemode": False}, {"livemode": None},
    {"parent": {"type": "subscription_details", "subscription_details": {"subscription": "sub_other"}}},
    {"parent": None}, {"customer": "cus_other"},
])
def test_latest_invoice_requires_exact_mode_and_subscription_association(db, mutation):
    conf = config()
    provider = FakeProvider(conf)
    cust = customer(db, conf)
    provider.subscriptions = [subscription(conf, cust)]
    provider.subscriptions[0]["latest_invoice"].update(mutation)
    with pytest.raises(billing.BillingError, match="Invoice ownership"):
        billing.status(db, 1, conf, provider)
    db.rollback()
    assert cust.verified_at is None
    assert billing.workspace_access(db, 1, conf) is False


def test_mutable_event_delivery_count_does_not_conflict_or_extend_lease(db):
    conf = config()
    provider = FakeProvider(conf)
    cust = customer(db, conf)
    provider.subscriptions = [subscription(conf, cust)]
    first = event(conf, cust) | {"pending_webhooks": 2}
    hook(db, conf, provider, first)
    verified = cust.verified_at
    calls = len(provider.calls)
    assert hook(db, conf, provider, first | {"pending_webhooks": 1})["duplicate"] is True
    assert cust.verified_at == verified and len(provider.calls) == calls
    changed = copy.deepcopy(first)
    changed["data"]["object"]["status"] = "changed"
    with pytest.raises(billing.BillingError, match="reused"):
        hook(db, conf, provider, changed)


def test_checkout_commit_gap_never_adopts_another_purchase_attempt(db, monkeypatch):
    conf = config()
    provider = FakeProvider(conf)
    original_commit = db.commit
    def interleaved_commit():
        original_commit()
        cust = db.scalar(select(BillingCustomer))
        cust.pending_nonce = "another_request_nonce"
        cust.pending_cadence = "annual"
        cust.pending_price_id = conf.annual_price_id
        original_commit()
    monkeypatch.setattr(db, "commit", interleaved_commit)
    with pytest.raises(billing.BillingError, match="attempt changed"):
        billing.create_checkout(db, 1, "pro", "monthly", conf, provider)
    assert not any(call[0] == "checkout" for call in provider.calls)
    assert db.scalar(select(BillingCustomer)).pending_cadence == "annual"


def test_checkout_commit_gap_rechecks_current_provider_and_existing_session(db, monkeypatch):
    conf = config()
    provider = FakeProvider(conf)
    original_commit = db.commit
    def completed_during_gap():
        original_commit()
        cust = db.scalar(select(BillingCustomer))
        provider.subscriptions = [subscription(conf, cust)]
    monkeypatch.setattr(db, "commit", completed_during_gap)
    with pytest.raises(billing.BillingError, match="existing subscription"):
        billing.create_checkout(db, 1, "pro", "monthly", conf, provider)
    assert not any(call[0] == "checkout" for call in provider.calls)


@pytest.mark.parametrize("association,seen_terminal,allowed", [
    ("sub_001", True, True), ("sub_other", True, False),
    (None, True, False), ("sub_001", False, False),
])
def test_completed_checkout_requires_known_terminal_association_before_repurchase(db, association, seen_terminal, allowed):
    conf = config()
    provider = FakeProvider(conf)
    billing.create_checkout(db, 1, "pro", "monthly", conf, provider)
    db.commit()
    cust = db.scalar(select(BillingCustomer))
    first = next(iter(provider.checkouts.values()))
    first.update(status="complete", subscription=association)
    provider.subscriptions = [subscription(conf, cust, status="canceled")] if seen_terminal else []
    billing.status(db, 1, conf, provider)
    db.commit()
    if allowed:
        billing.create_checkout(db, 1, "pro", "monthly", conf, provider)
        db.commit()
        assert len(provider.checkouts) == 2
        assert cust.checkout_session_id != first["id"]
        assert billing.workspace_access(db, 1, conf) is False
    else:
        for _ in range(2):
            with pytest.raises(billing.BillingError, match="Checkout is completed"):
                billing.create_checkout(db, 1, "pro", "monthly", conf, provider)
            db.rollback()
        assert len(provider.checkouts) == 1


@pytest.mark.parametrize("payload", [b"[]", b"null", b"[" * 1100 + b"0" + b"]" * 1100])
def test_actual_sdk_malformed_signed_payload_is_a_controlled_boundary_error(payload):
    conf = config()
    timestamp = str(int(time.time()))
    digest = hmac.new(conf.webhook_secret.encode(), timestamp.encode() + b"." + payload, hashlib.sha256).hexdigest()
    with pytest.raises(billing.BillingError) as error:
        billing.verify_event(payload, f"t={timestamp},v1={digest}", conf)
    assert error.value.status_code == 400
