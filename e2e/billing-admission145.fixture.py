"""Isolated joined browser fixture: production ASGI/auth/DB, Stripe transport only.

This executable is never imported by the application. Its loopback-only control
surface mutates temporary test records and resets actual limiter instances.
"""
from contextvars import ContextVar
from datetime import timedelta
import os
from pathlib import Path
import shutil
import sys
import tempfile
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
TEMP = Path(tempfile.mkdtemp(prefix="edgelab-billing145-"))
os.environ.update({
    "DATABASE_URL": f"sqlite:///{TEMP / 'app.sqlite'}",
    "EDGELAB_MARKET_DATA_DATABASE_URL": f"sqlite:///{TEMP / 'market.sqlite'}",
    "EDGELAB_ENVIRONMENT": "development", "EDGELAB_DEPLOYMENT_MODE": "production",
    "EDGELAB_JWT_SECRET": "billing145-isolated-session-signature",
    "EDGELAB_API_TOKEN": "", "GOOGLE_CLIENT_ID": "billing145-fixture.apps.googleusercontent.com",
    "GOOGLE_CLIENT_SECRET": "billing145-fixture-only",
    "EDGELAB_BILLING_ENABLED": "true", "EDGELAB_STRIPE_MODE": "live",
    "STRIPE_SECRET_KEY": "sk_live_billing145_fixture", "STRIPE_WEBHOOK_SECRET": "whsec_billing145_fixture",
    "STRIPE_PRO_MONTHLY_PRICE_ID": "price_ProMonthly", "STRIPE_PRO_ANNUAL_PRICE_ID": "price_ProAnnual",
    "EDGELAB_PUBLIC_ORIGIN": "https://edgelab-fixture.example", "EDGELAB_REDIS_URL": "",
    "EDGELAB_DATASETS_ROOT": str(TEMP / "datasets"), "EDGELAB_CSV_PATH": "",
    "EDGELAB_OBSERVABILITY_JSON_LOGS": "false",
})
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend/tests"))

from fastapi import FastAPI
from sqlalchemy import event, select
from starlette.responses import FileResponse
import uvicorn
from app import auth, models
from app.config import settings
from app.db import Base, engine, init_db, SessionLocal
from app.main import app as production
from app.market_data_db import market_data_engine
from app.services import billing
from test_billing_routes import Provider, snapshot

fixture_work = ContextVar("billing145_fixture_work", default=False)
state = SimpleNamespace(config=billing.BillingConfig.from_settings(), headers=[], owners=[], tokens=[],
                        billing_sql=[], requests=[])
state.provider = Provider(state)
# Provider-state fixture only. Both routes and access_policy use the production
# billing services, including their normal config, lease and transaction logic.
billing.StripeProvider = lambda config: state.provider
control = FastAPI()


@event.listens_for(engine, "before_cursor_execute")
def observe_sql(_connection, _cursor, statement, _parameters, _context, _many):
    text = statement.lower()
    if not fixture_work.get() and ("billing_customers" in text or "billing_subscriptions" in text
                                  or "update beta_users" in text):
        state.billing_sql.append(statement)


def reset_admission():
    # Reset the actual service instance shared by routes and access refresh.
    # No auth or admission decision is replaced by this fixture.
    from app.services.billing_rate_limits import build_billing_admission_limiter
    billing.billing_limiter = build_billing_admission_limiter(settings.redis_url)


def seed():
    token = fixture_work.set(True)
    try:
        Base.metadata.drop_all(engine)
        Base.metadata.create_all(engine)
        state.headers, state.owners, state.tokens = [], [], []
        state.provider.calls.clear()
        state.provider.snapshots.clear()
        state.provider.failure = None
        state.billing_sql.clear()
        state.requests.clear()
        with SessionLocal() as db:
            for index in (1, 2):
                user = models.BetaUser(email=f"owner{index}@billing145.example", name=f"Billing owner {index}",
                    provider="google", google_subject=f"verified_billing145_{index}", status="APPROVED")
                db.add(user)
                db.flush()
                expires = models.utcnow() + timedelta(hours=1)
                session = models.BetaSession(id=f"billing145-session-{index}", user_id=user.id, expires_at=expires)
                db.add(session)
                db.flush()
                session_token = auth.create_session_token(user.id, session.id, expires)
                state.owners.append(user.id)
                state.tokens.append(session_token)
                state.headers.append({"Authorization": "Bearer " + session_token})
                customer = models.BillingCustomer(user_id=user.id, livemode=True,
                    stripe_customer_id=f"cus_billing145_{index}", verified_at=models.utcnow())
                db.add(customer)
                db.flush()
                db.add(models.BillingSubscription(user_id=user.id, billing_customer_id=customer.id,
                    livemode=True, stripe_subscription_id=f"sub_billing145_{index}", price_id=state.config.monthly_price_id,
                    cadence="monthly", status="active", eligible=True, invoice_paid=True,
                    current_period_end=models.utcnow() + timedelta(days=1)))
                db.add(models.AppStorageItem(user_id=user.id, namespace="edgelab", key="private-marker145",
                    value={"owner": index, "private": f"owner-{index}-only"}))
                state.provider.snapshots[customer.stripe_customer_id] = snapshot(state, customer.stripe_customer_id,
                    identifier=f"sub_billing145_{index}")
            db.commit()
        state.provider.calls.clear()
        reset_admission()
    finally:
        fixture_work.reset(token)


@control.post("/__fixture/reset")
def reset():
    seed()
    return {"tokens": state.tokens, "owners": state.owners, "temporaryDatabase": True,
            "serverNow": models.utcnow().isoformat()}


@control.get("/__fixture/ledger")
def ledger():
    with SessionLocal() as db:
        customers = [{"owner": row.user_id, "customer": row.stripe_customer_id,
                      "verifiedAt": row.verified_at.isoformat() if row.verified_at else None}
                     for row in db.scalars(select(models.BillingCustomer))]
    return {"providerCalls": state.provider.calls, "billingSqlCount": len(state.billing_sql),
            "requests": state.requests, "customers": customers}


@control.post("/__fixture/provider")
def provider(payload: dict):
    state.provider.failure = billing.BillingError(503, "Payment provider is unavailable. Try again.") if payload.get("outage") else None
    if payload.get("expireOwner"):
        with SessionLocal() as db:
            customer = db.scalar(select(models.BillingCustomer).where(models.BillingCustomer.user_id == payload["expireOwner"]))
            customer.verified_at = models.utcnow() - timedelta(seconds=billing.ACCESS_LEASE_SECONDS + 10)
            db.commit()
    return {"outage": state.provider.failure is not None}


class JoinedApp:
    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await production(scope, receive, send)
        pathname = scope["path"]
        if pathname.startswith("/__fixture/"):
            token = fixture_work.set(True)
            try:
                return await control(scope, receive, send)
            finally:
                fixture_work.reset(token)
        if pathname.startswith("/api/"):
            record = {"method": scope["method"], "path": pathname}
            async def observed_send(message):
                if message["type"] == "http.response.start":
                    record.update(status=message["status"], headers={key.decode(): value.decode() for key, value in message["headers"]})
                    state.requests.append(record)
                await send(message)
            return await production(scope, receive, observed_send)
        dist = ROOT / "frontend/dist"
        target = (dist / pathname.lstrip("/")).resolve()
        if not target.is_relative_to(dist.resolve()) or not target.is_file():
            target = dist / "index.html"
        return await FileResponse(target)(scope, receive, send)


if __name__ == "__main__":
    init_db()
    try:
        uvicorn.run(JoinedApp(), host="127.0.0.1", port=45345, access_log=False, log_level="warning")
    finally:
        engine.dispose()
        market_data_engine.dispose()
        shutil.rmtree(TEMP, ignore_errors=True)
