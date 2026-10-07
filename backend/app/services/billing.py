"""Server-owned Stripe billing. No client callback or beta approval grants paid access."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
import re
from secrets import token_hex
import time
from typing import Protocol
from threading import Lock
from urllib.parse import urlsplit

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.models import BetaUser, BillingCustomer, BillingSubscription, BillingWebhookEvent, utcnow

API_VERSION = "2026-09-30.endive"
WEBHOOK_BYTES = 1_048_576
ACCESS_LEASE_SECONDS = 300
CADENCES = {"monthly": ("month", 2900), "annual": ("year", 29000)}
OPEN_SUBSCRIPTIONS = {"active", "trialing", "past_due", "unpaid", "incomplete", "paused"}
_catalog_cache: dict[str, tuple[float, dict]] = {}
_catalog_lock = Lock()
EVENT_TYPES = {
    "checkout.session.completed", "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed", "customer.subscription.created",
    "customer.subscription.updated", "customer.subscription.deleted",
    "invoice.paid", "invoice.payment_failed",
}


class BillingError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.public_message = message


@dataclass(frozen=True)
class BillingConfig:
    enabled: bool = False
    secret_key: str = ""
    webhook_secret: str = ""
    mode: str = "test"
    monthly_price_id: str = ""
    annual_price_id: str = ""
    public_origin: str = ""

    @classmethod
    def from_settings(cls):
        return cls(
            enabled=getattr(settings, "billing_enabled", False),
            secret_key=getattr(settings, "stripe_secret_key", "").strip(),
            webhook_secret=getattr(settings, "stripe_webhook_secret", "").strip(),
            mode=getattr(settings, "stripe_mode", "test").strip(),
            monthly_price_id=getattr(settings, "stripe_monthly_price_id", "").strip(),
            annual_price_id=getattr(settings, "stripe_annual_price_id", "").strip(),
            public_origin=settings.public_origin.rstrip("/"),
        )

    @property
    def livemode(self):
        return self.mode == "live"

    def price_id(self, cadence: str):
        if cadence not in CADENCES:
            raise BillingError(400, "Unknown billing cadence.")
        return self.monthly_price_id if cadence == "monthly" else self.annual_price_id

    def require_ready(self):
        try:
            origin = urlsplit(self.public_origin)
            origin.port
        except ValueError:
            raise BillingError(503, "Billing requires a configured public origin.") from None
        local_test = self.mode == "test" and origin.scheme == "http" and origin.hostname in {"localhost", "127.0.0.1", "::1"}
        if not self.enabled or self.mode not in {"test", "live"} or not self.secret_key.startswith("sk_" + self.mode + "_") or not self.webhook_secret.startswith("whsec_"):
            raise BillingError(503, "Paid checkout is not configured.")
        if not origin.hostname or origin.username or origin.password or origin.path or origin.query or origin.fragment or (origin.scheme != "https" and not local_test):
            raise BillingError(503, "Billing requires a configured public origin.")
        if not _id(self.monthly_price_id, "price") or not _id(self.annual_price_id, "price") or self.monthly_price_id == self.annual_price_id:
            raise BillingError(503, "Billing prices are not configured.")


class Provider(Protocol):
    def retrieve_price(self, price_id: str) -> dict: ...
    def create_customer(self, params: dict, key: str) -> dict: ...
    def list_subscriptions(self, customer_id: str) -> dict: ...
    def create_checkout(self, params: dict, key: str) -> dict: ...
    def retrieve_checkout(self, session_id: str) -> dict: ...
    def expire_checkout(self, session_id: str) -> dict: ...
    def create_portal(self, params: dict) -> dict: ...


class StripeProvider:
    """An isolated SDK client; credentials never enter module-global SDK state."""
    def __init__(self, config: BillingConfig):
        config.require_ready()
        try:
            import stripe
        except ImportError:
            raise BillingError(503, "Payment provider is unavailable.") from None
        self.client = stripe.StripeClient(
            config.secret_key, stripe_version=API_VERSION, max_network_retries=1,
            http_client=stripe.RequestsClient(timeout=8),
        )

    def _call(self, action, *args, **kwargs):
        try:
            result = action(*args, **kwargs).to_dict()
        except Exception:
            raise BillingError(503, "Payment provider is unavailable. Try again.") from None
        if not isinstance(result, dict):
            raise BillingError(503, "Payment provider returned an invalid response.")
        return result

    def retrieve_price(self, price_id):
        return self._call(self.client.v1.prices.retrieve, price_id)

    def create_customer(self, params, key):
        return self._call(self.client.v1.customers.create, params=params, options={"idempotency_key": key})

    def list_subscriptions(self, customer_id):
        return self._call(self.client.v1.subscriptions.list, params={"customer": customer_id, "status": "all", "limit": 100, "expand": ["data.latest_invoice"]})

    def create_checkout(self, params, key):
        return self._call(self.client.v1.checkout.sessions.create, params=params, options={"idempotency_key": key})

    def retrieve_checkout(self, session_id):
        return self._call(self.client.v1.checkout.sessions.retrieve, session_id)

    def expire_checkout(self, session_id):
        return self._call(self.client.v1.checkout.sessions.expire, session_id)

    def create_portal(self, params):
        return self._call(self.client.v1.billing_portal.sessions.create, params=params)


def _id(value, prefix):
    return isinstance(value, str) and len(value) <= 128 and re.fullmatch(prefix + r"_[A-Za-z0-9_]+", value) is not None


def _utc(value: datetime):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _timestamp(value):
    if type(value) is not int or not 0 < value <= 253402300799:
        return None
    return datetime.fromtimestamp(value, timezone.utc)


def _price_matches(price: dict, config: BillingConfig, cadence: str, *, active: bool):
    recurring = price.get("recurring")
    interval, amount = CADENCES[cadence]
    return (
        isinstance(recurring, dict) and price.get("id") == config.price_id(cadence)
        and price.get("livemode") is config.livemode and price.get("currency") == "usd"
        and type(price.get("unit_amount")) is int and price["unit_amount"] == amount
        and recurring.get("interval") == interval and type(recurring.get("interval_count")) is int
        and recurring["interval_count"] == 1 and recurring.get("usage_type", "licensed") == "licensed"
        and price.get("type") == "recurring" and (not active or price.get("active") is True)
    )


def validate_price(provider: Provider, config: BillingConfig, cadence: str):
    price = provider.retrieve_price(config.price_id(cadence))
    if not _price_matches(price, config, cadence, active=True):
        raise BillingError(503, "Configured Stripe price does not match the published plan.")
    return price


def catalog(config: BillingConfig | None = None, provider: Provider | None = None):
    config = config or BillingConfig.from_settings()
    # Cache only the public catalog, never customer state or provider objects.
    key = sha256(repr(config).encode()).hexdigest()
    cached = provider is None
    if cached:
        with _catalog_lock:
            entry = _catalog_cache.get(key)
            if entry and entry[0] > time.monotonic():
                return json.loads(json.dumps(entry[1]))
    available, reason = False, None
    try:
        config.require_ready()
        provider = provider or StripeProvider(config)
        for cadence in CADENCES:
            validate_price(provider, config, cadence)
        available = True
    except BillingError as exc:
        reason = exc.public_message
    result = {
        "provider": "stripe", "enabled": config.enabled, "mode": config.mode,
        "checkout_available": available, "reason": reason,
        "plans": [{"id": "pro", "name": "EdgeLab Pro", "currency": "usd", "monthly_amount": 2900, "annual_amount": 29000}],
    }
    if cached:
        with _catalog_lock:
            if len(_catalog_cache) >= 4:
                _catalog_cache.clear()
            _catalog_cache[key] = (time.monotonic() + (60 if available else 10), result)
    return json.loads(json.dumps(result))


def _lock_user(db: Session, user_id: int):
    # Both API processes use the same database. PostgreSQL locks this owner row;
    # SQLite obtains its writer lock before provider I/O instead of racing readers.
    if db.get_bind().dialect.name == "sqlite":
        db.execute(text("UPDATE beta_users SET id = id WHERE id = :id"), {"id": user_id})
    user = db.scalar(select(BetaUser).where(BetaUser.id == user_id).with_for_update())
    if user is None:
        raise BillingError(401, "Authenticated account no longer exists.")
    return user


def _customer(db: Session, user_id: int, config: BillingConfig):
    return db.scalar(select(BillingCustomer).where(BillingCustomer.user_id == user_id, BillingCustomer.livemode == config.livemode))


def _normalize_subscription(raw: dict, customer: BillingCustomer, config: BillingConfig):
    if not _id(raw.get("id"), "sub") or raw.get("customer") != customer.stripe_customer_id or raw.get("livemode") is not config.livemode:
        raise BillingError(503, "Subscription ownership or environment could not be verified.")
    status = raw.get("status")
    if not isinstance(status, str) or status not in {"active", "trialing", "past_due", "unpaid", "incomplete", "incomplete_expired", "canceled", "paused"}:
        raise BillingError(503, "Payment provider returned an invalid subscription state.")
    items = raw.get("items")
    items = items.get("data") if isinstance(items, dict) and items.get("has_more", False) is False else None
    eligible, cadence, price_id, end = False, None, None, None
    if isinstance(items, list) and len(items) == 1 and isinstance(items[0], dict):
        item = items[0]
        price = item.get("price")
        if isinstance(price, dict):
            price_id = price.get("id") if _id(price.get("id"), "price") else None
            cadence = next((name for name in CADENCES if _price_matches(price, config, name, active=False)), None)
        eligible = cadence is not None and type(item.get("quantity")) is int and item["quantity"] == 1
        end = _timestamp(item.get("current_period_end"))
    invoice = raw.get("latest_invoice")
    paid = isinstance(invoice, dict) and _id(invoice.get("id"), "in") and invoice.get("status") == "paid"
    if isinstance(invoice, dict):
        parent = invoice.get("parent")
        details = parent.get("subscription_details") if isinstance(parent, dict) and parent.get("type") == "subscription_details" else None
        if (invoice.get("customer") != customer.stripe_customer_id
                or invoice.get("livemode") is not config.livemode
                or not isinstance(details, dict) or details.get("subscription") != raw["id"]):
            raise BillingError(503, "Invoice ownership or environment could not be verified.")
    cancel = raw.get("cancel_at_period_end", False)
    if type(cancel) is not bool:
        raise BillingError(503, "Payment provider returned invalid cancellation settings.")
    return {
        "stripe_subscription_id": raw["id"], "price_id": price_id, "cadence": cadence,
        "status": status, "eligible": eligible and not raw.get("pause_collection"),
        "invoice_paid": paid, "current_period_end": end, "cancel_at_period_end": cancel,
    }


def reconcile(db: Session, customer: BillingCustomer, config: BillingConfig, provider: Provider):
    _lock_user(db, customer.user_id)
    if customer.livemode != config.livemode:
        raise BillingError(503, "Billing environment could not be verified.")
    snapshot = provider.list_subscriptions(customer.stripe_customer_id)
    data = snapshot.get("data")
    if not isinstance(data, list) or len(data) > 100 or snapshot.get("has_more") is not False:
        raise BillingError(503, "Subscription reconciliation requires a complete provider snapshot.")
    values = [_normalize_subscription(raw, customer, config) for raw in data if isinstance(raw, dict)]
    if len(values) != len(data) or len({value["stripe_subscription_id"] for value in values}) != len(values):
        raise BillingError(503, "Payment provider returned invalid subscription records.")
    existing = db.scalars(select(BillingSubscription).where(BillingSubscription.billing_customer_id == customer.id)).all()
    by_id = {row.stripe_subscription_id: row for row in existing}
    now = utcnow()
    for value in values:
        row = by_id.get(value["stripe_subscription_id"])
        if row is None:
            # A provider subscription ID must never be rebound to another user.
            foreign = db.scalar(select(BillingSubscription).where(BillingSubscription.stripe_subscription_id == value["stripe_subscription_id"], BillingSubscription.livemode == config.livemode))
            if foreign is not None:
                raise BillingError(503, "Subscription ownership could not be verified.")
            row = BillingSubscription(user_id=customer.user_id, billing_customer_id=customer.id, livemode=config.livemode, **value)
            db.add(row)
        else:
            for key, val in value.items():
                setattr(row, key, val)
        row.updated_at = now
    seen = {value["stripe_subscription_id"] for value in values}
    for row in existing:
        if row.stripe_subscription_id not in seen:
            row.status, row.eligible, row.invoice_paid, row.updated_at = "canceled", False, False, now
    customer.verified_at = now
    db.flush()
    return seen


def _has_access(row: BillingSubscription, now: datetime):
    return row.eligible and row.invoice_paid and row.status == "active" and row.current_period_end is not None and _utc(row.current_period_end) > now


def workspace_access(db: Session, user_id: int, config: BillingConfig | None = None, *, now: datetime | None = None):
    config = config or BillingConfig.from_settings()
    if not config.enabled or not config.livemode:
        return False
    try:
        config.require_ready()
    except BillingError:
        return False
    current = _utc(now or utcnow())
    customer = _customer(db, user_id, config)
    if customer is None or not _lease_fresh(customer, current):
        return False
    return any(_has_access(row, current) for row in db.scalars(select(BillingSubscription).where(BillingSubscription.billing_customer_id == customer.id)))


def _lease_fresh(customer: BillingCustomer, now: datetime):
    return customer.verified_at is not None and now - timedelta(seconds=ACCESS_LEASE_SECONDS) < _utc(customer.verified_at) <= now


def refresh_workspace_access(db: Session, user_id: int, config: BillingConfig | None = None, provider: Provider | None = None):
    config = config or BillingConfig.from_settings()
    config.require_ready()
    _lock_user(db, user_id)
    customer = _customer(db, user_id, config)
    if customer is not None:
        reconcile(db, customer, config, provider or StripeProvider(config))
    return workspace_access(db, user_id, config)


def status(db: Session, user_id: int, config: BillingConfig | None = None, provider: Provider | None = None, *, refresh=True):
    config = config or BillingConfig.from_settings()
    response = {"provider": "stripe", "mode": config.mode, "configured": False, "workspace_access": False, "subscription_access": False, "plan": None, "status": "inactive", "cadence": None, "current_period_end": None, "cancel_at_period_end": False, "verified_at": None, "refresh_required": False}
    try:
        config.require_ready()
    except BillingError:
        return response
    response["configured"] = True
    if refresh:
        _lock_user(db, user_id)
    customer = _customer(db, user_id, config)
    if customer is None:
        return response
    if refresh:
        reconcile(db, customer, config, provider or StripeProvider(config))
    rows = db.scalars(select(BillingSubscription).where(BillingSubscription.billing_customer_id == customer.id)).all()
    now = utcnow()
    response["verified_at"] = _utc(customer.verified_at).isoformat() if customer.verified_at else None
    response["refresh_required"] = not _lease_fresh(customer, now)
    rows.sort(key=lambda row: (_has_access(row, now), _utc(row.updated_at), row.id), reverse=True)
    if rows:
        row = rows[0]
        access = bool(_has_access(row, now) and _lease_fresh(customer, now))
        response.update(subscription_access=access, workspace_access=access and config.livemode, plan="pro" if access else None, status=row.status, cadence=row.cadence, current_period_end=_utc(row.current_period_end).isoformat() if row.current_period_end else None, cancel_at_period_end=row.cancel_at_period_end)
    return response


def _checkout_response(session: dict, customer: BillingCustomer, config: BillingConfig):
    if not _id(session.get("id"), "cs") or session.get("customer") != customer.stripe_customer_id or session.get("livemode") is not config.livemode or session.get("mode") != "subscription":
        raise BillingError(503, "Checkout ownership or environment could not be verified.")
    return session


def _hosted_url(value, host):
    if not isinstance(value, str) or len(value) > 4096 or any(ord(char) < 32 for char in value):
        raise BillingError(503, "Payment provider returned an invalid redirect.")
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        raise BillingError(503, "Payment provider returned an invalid redirect.") from None
    if parsed.scheme != "https" or parsed.hostname != host or parsed.username or parsed.password or port is not None:
        raise BillingError(503, "Payment provider returned an invalid redirect.")
    return value


def _reject_existing_subscription(db: Session, customer: BillingCustomer):
    if any(row.status in OPEN_SUBSCRIPTIONS for row in db.scalars(select(BillingSubscription).where(BillingSubscription.billing_customer_id == customer.id))):
        raise BillingError(409, "An existing subscription needs to be managed in the billing portal.")


def _resolve_pending_checkout(db: Session, customer: BillingCustomer, config: BillingConfig, provider: Provider, seen: set[str], *, consume_terminal=True):
    if not customer.checkout_session_id:
        return None
    session = _checkout_response(provider.retrieve_checkout(customer.checkout_session_id), customer, config)
    state = session.get("status")
    if state == "complete":
        subscription_id = session.get("subscription")
        terminal = db.scalar(select(BillingSubscription).where(
            BillingSubscription.billing_customer_id == customer.id,
            BillingSubscription.stripe_subscription_id == subscription_id,
            BillingSubscription.status.in_({"canceled", "incomplete_expired"}),
        )) if _id(subscription_id, "sub") and subscription_id in seen else None
        if not consume_terminal or terminal is None:
            raise BillingError(409, "Checkout is completed. Refresh billing status before starting another purchase.")
    elif state == "open":
        return {"url": _hosted_url(session.get("url"), "checkout.stripe.com")}
    elif state != "expired":
        raise BillingError(503, "Payment provider returned an invalid checkout state.")
    customer.pending_nonce = customer.checkout_session_id = None
    return None


def create_checkout(db: Session, user_id: int, plan: str, cadence: str, config: BillingConfig | None = None, provider: Provider | None = None):
    config = config or BillingConfig.from_settings()
    config.require_ready()
    if plan != "pro":
        raise BillingError(400, "Unknown billing plan.")
    config.price_id(cadence)
    provider = provider or StripeProvider(config)
    validate_price(provider, config, cadence)
    user = _lock_user(db, user_id)
    customer = _customer(db, user_id, config)
    if customer is None:
        raw = provider.create_customer({"email": user.email, "name": user.name, "metadata": {"edgelab_user_id": str(user_id)}}, f"edgelab:customer:{config.mode}:{user_id}")
        if not _id(raw.get("id"), "cus") or raw.get("livemode") is not config.livemode:
            raise BillingError(503, "Customer environment could not be verified.")
        customer = BillingCustomer(user_id=user_id, livemode=config.livemode, stripe_customer_id=raw["id"])
        db.add(customer)
        db.flush()
    seen = reconcile(db, customer, config, provider)
    _reject_existing_subscription(db, customer)
    if customer.checkout_session_id and (customer.pending_cadence != cadence or customer.pending_price_id != config.price_id(cadence)):
        current = _checkout_response(provider.retrieve_checkout(customer.checkout_session_id), customer, config)
        if current.get("status") == "open":
            expired = _checkout_response(provider.expire_checkout(current["id"]), customer, config)
            if expired.get("status") != "expired":
                raise BillingError(503, "Previous checkout could not be expired safely.")
    pending = _resolve_pending_checkout(db, customer, config, provider, seen)
    if pending is not None:
        return pending
    if customer.pending_nonce and customer.pending_since and _utc(customer.pending_since) + timedelta(hours=24, minutes=5) <= utcnow():
        customer.pending_nonce = None
    if customer.pending_nonce and (customer.pending_cadence != cadence or customer.pending_price_id != config.price_id(cadence)):
        raise BillingError(409, "A checkout attempt is awaiting confirmation. Retry the original billing choice.")
    if not customer.pending_nonce:
        customer.pending_nonce, customer.pending_cadence, customer.pending_price_id, customer.pending_since = token_hex(16), cadence, config.price_id(cadence), utcnow()
    # Persist the customer binding and idempotency token before any checkout can
    # complete. On transport failure, retry uses precisely the same purchase.
    attempt = (customer.stripe_customer_id, customer.pending_nonce, customer.pending_cadence, customer.pending_price_id)
    db.commit()
    _lock_user(db, user_id)
    customer = db.scalar(select(BillingCustomer).where(BillingCustomer.user_id == user_id, BillingCustomer.livemode == config.livemode).execution_options(populate_existing=True))
    if customer is None or attempt != (customer.stripe_customer_id, customer.pending_nonce, customer.pending_cadence, customer.pending_price_id):
        raise BillingError(409, "Checkout attempt changed. Retry your billing choice.")
    seen = reconcile(db, customer, config, provider)
    _reject_existing_subscription(db, customer)
    pending = _resolve_pending_checkout(db, customer, config, provider, seen, consume_terminal=False)
    if pending is not None:
        return pending
    params = {
        "mode": "subscription", "customer": customer.stripe_customer_id,
        "client_reference_id": str(user_id), "line_items": [{"price": attempt[3], "quantity": 1}],
        "success_url": config.public_origin + "/pricing?billing=success",
        "cancel_url": config.public_origin + "/pricing?billing=cancel",
        "subscription_data": {"metadata": {"edgelab_user_id": str(user_id), "edgelab_plan": "pro", "edgelab_cadence": attempt[2]}},
    }
    session = _checkout_response(provider.create_checkout(params, f"edgelab:checkout:{config.mode}:{user_id}:{attempt[1]}"), customer, config)
    if session.get("status") != "open":
        raise BillingError(503, "Payment provider did not create an open checkout.")
    customer.checkout_session_id = session["id"]
    return {"url": _hosted_url(session.get("url"), "checkout.stripe.com")}


def create_portal(db: Session, user_id: int, config: BillingConfig | None = None, provider: Provider | None = None):
    config = config or BillingConfig.from_settings()
    config.require_ready()
    _lock_user(db, user_id)
    customer = _customer(db, user_id, config)
    if customer is None:
        raise BillingError(409, "No billing account exists for this user.")
    response = (provider or StripeProvider(config)).create_portal({"customer": customer.stripe_customer_id, "return_url": config.public_origin + "/pricing"})
    return {"url": _hosted_url(response.get("url"), "billing.stripe.com")}


def verify_event(payload: bytes, signature: str | None, config: BillingConfig, *, now: int | None = None):
    config.require_ready()
    if len(payload) > WEBHOOK_BYTES:
        raise BillingError(413, "Webhook body is too large.")
    if not isinstance(signature, str) or len(signature) > 8192:
        raise BillingError(400, "Invalid webhook signature.")
    timestamps, signatures = [], []
    for part in signature.split(","):
        key, sep, value = part.strip().partition("=")
        if sep and key == "t":
            timestamps.append(value)
        elif sep and key == "v1":
            signatures.append(value)
    if len(timestamps) != 1 or not re.fullmatch(r"[0-9]{1,12}", timestamps[0]) or not signatures:
        raise BillingError(400, "Invalid webhook signature.")
    timestamp = int(timestamps[0])
    if abs((int(time.time()) if now is None else now) - timestamp) > 300:
        raise BillingError(400, "Webhook signature has expired.")
    try:
        import stripe
    except ImportError:
        raise BillingError(503, "Payment provider is unavailable.") from None
    try:
        stripe.Webhook.construct_event(payload, signature, config.webhook_secret, tolerance=300)
    except (ValueError, UnicodeError, AttributeError, TypeError, RecursionError, stripe.SignatureVerificationError):
        raise BillingError(400, "Invalid webhook signature or body.") from None
    try:
        event = json.loads(payload, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, UnicodeError, RecursionError):
        raise BillingError(400, "Invalid webhook body.") from None
    if not isinstance(event, dict) or not _id(event.get("id"), "evt") or type(event.get("livemode")) is not bool or event["livemode"] != config.livemode or not isinstance(event.get("type"), str) or len(event["type"]) > 128 or event.get("account"):
        raise BillingError(400, "Webhook identity or environment is invalid.")
    # Require a matching snapshot endpoint version. Thin/connected-account events
    # are deliberately outside this application's integration contract.
    if event.get("api_version") != API_VERSION:
        raise BillingError(400, "Webhook API version does not match the billing integration.")
    return event


def process_webhook(db: Session, payload: bytes, signature: str | None, config: BillingConfig | None = None, provider: Provider | None = None, *, now: int | None = None):
    config = config or BillingConfig.from_settings()
    event = verify_event(payload, signature, config, now=now)
    # Delivery counts change between legitimate retries; event data/identity do not.
    stable_event = {key: value for key, value in event.items() if key != "pending_webhooks"}
    fingerprint = sha256(json.dumps(stable_event, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    previous = db.get(BillingWebhookEvent, (event["id"], config.livemode))
    if previous:
        if previous.payload_sha256 != fingerprint:
            raise BillingError(409, "Webhook event ID was reused with different content.")
        return {"received": True, "duplicate": True}
    data = event.get("data")
    obj = data.get("object") if isinstance(data, dict) else None
    customer_id = obj.get("customer") if isinstance(obj, dict) else None
    customer = db.scalar(select(BillingCustomer).where(BillingCustomer.stripe_customer_id == customer_id, BillingCustomer.livemode == config.livemode)) if _id(customer_id, "cus") else None
    processed = event["type"] in EVENT_TYPES and customer is not None
    if processed:
        _lock_user(db, customer.user_id)
        previous = db.get(BillingWebhookEvent, (event["id"], config.livemode), populate_existing=True)
        if previous:
            if previous.payload_sha256 != fingerprint:
                raise BillingError(409, "Webhook event ID was reused with different content.")
            return {"received": True, "duplicate": True}
        reconcile(db, customer, config, provider or StripeProvider(config))
    row = BillingWebhookEvent(event_id=event["id"], livemode=config.livemode, payload_sha256=fingerprint, event_type=event["type"], status="processed" if processed else "ignored")
    try:
        with db.begin_nested():
            db.add(row)
            db.flush()
    except IntegrityError:
        previous = db.get(BillingWebhookEvent, (event["id"], config.livemode), populate_existing=True)
        if previous is None or previous.payload_sha256 != fingerprint:
            raise BillingError(409, "Webhook event ID conflicts with an existing receipt.") from None
        return {"received": True, "duplicate": True}
    return {"received": True, "duplicate": False}
