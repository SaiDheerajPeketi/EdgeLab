"""Billing admission through actual ASGI/auth/ORM; only Stripe transport is a seam."""
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import timedelta
from threading import Event
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from app import auth, models
from app.api import billing as routes
from app.db import Base
from app.main import app
from app.services import billing
from app.services.billing_rate_limits import BillingAdmissionLimiter
from test_billing_routes import context, checkout, customer, snapshot, status, Provider


def persisted(context):
    with context.factory() as db:
        return tuple(tuple(tuple(getattr(row, column.name) for column in model.__table__.columns)
                           for row in db.scalars(select(model).order_by(model.id)).all())
                     for model in (models.BillingCustomer, models.BillingSubscription))


def watch_writes(context):
    statements = []
    engine = context.factory.kw["bind"]
    def capture(_connection, _cursor, statement, _parameters, _execution_context, _many):
        if statement.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE")):
            statements.append(statement)
    event.listen(engine, "before_cursor_execute", capture)
    return statements, lambda: event.remove(engine, "before_cursor_execute", capture)


def assert_denied_without_work(context, request, code, retry):
    before = persisted(context)
    calls = list(context.provider.calls)
    writes, cleanup = watch_writes(context)
    try:
        response = request()
    finally:
        cleanup()
    assert response.status_code == code
    assert response.headers["cache-control"] == "no-store"
    assert 1 <= int(response.headers["retry-after"]) <= retry
    assert context.provider.calls == calls
    assert persisted(context) == before
    assert writes == []
    return response


def test_exact_status_budget_and_separate_owner(context):
    assert checkout(context).status_code == 200
    for _ in range(30):
        assert status(context).status_code == 200
    assert_denied_without_work(context, lambda: status(context), 429, 60)
    assert status(context, owner=1).status_code == 200
    # The action family remains available after exhausting status.
    assert context.client.post("/api/billing/portal", headers=context.headers[0], json_body={}).status_code == 200


def test_checkout_and_portal_share_exact_six_action_budget(context):
    assert checkout(context).status_code == 200
    for _ in range(5):
        assert context.client.post("/api/billing/portal", headers=context.headers[0], json_body={}).status_code == 200
    for request in (lambda: checkout(context), lambda: context.client.post(
            "/api/billing/portal", headers=context.headers[0], json_body={})):
        assert_denied_without_work(context, request, 429, 60)
    assert checkout(context, owner=1).status_code == 200
    assert status(context).status_code == 200


def test_global_budget_is_shared_between_verified_owners_and_route_families(context, monkeypatch):
    monkeypatch.setattr(billing, "billing_limiter", BillingAdmissionLimiter(global_limit=2))
    assert status(context, owner=0).status_code == 200
    assert status(context, owner=1).status_code == 200
    assert_denied_without_work(context, lambda: status(context, owner=2), 429, 60)
    assert_denied_without_work(context, lambda: checkout(context), 429, 60)


class UnavailableRedis:
    def __init__(self):
        self.calls = []
    def eval(self, *args):
        self.calls.append(args)
        raise OSError("Redis transport is unavailable")


def test_configured_redis_failure_never_falls_back_or_reaches_billing_sql(context, monkeypatch):
    wire = UnavailableRedis()
    monkeypatch.setattr(billing, "billing_limiter", BillingAdmissionLimiter(client=wire, max_concurrent=1))
    for request in (lambda: status(context), lambda: checkout(context), lambda: context.client.post(
            "/api/billing/portal", headers=context.headers[0], json_body={})):
        assert_denied_without_work(context, request, 503, 5)
    assert len(wire.calls) == 3  # Every failure releases the one local slot.
    assert all(call[1:3] == (2, "rate-limit:{billing}:global:v1") for call in wire.calls)
    assert [call[3] for call in wire.calls] == [
        f"rate-limit:{{billing}}:owner:{context.owners[0]}:status:v1",
        f"rate-limit:{{billing}}:owner:{context.owners[0]}:actions:v1",
        f"rate-limit:{{billing}}:owner:{context.owners[0]}:actions:v1",
    ]


def test_real_identity_verification_precedes_all_billing_admission(context, monkeypatch):
    # Beta accepts manual identities at authentication, but billing still rejects them.
    monkeypatch.setattr(auth.settings, "deployment_mode", "beta")
    with context.factory() as db:
        manual = db.get(models.BetaUser, context.owners[1])
        manual.provider, manual.google_subject = "email", None
        db.delete(db.get(models.BetaSession, context.sessions[2]))
        db.commit()
    wire = UnavailableRedis()
    monkeypatch.setattr(billing, "billing_limiter", BillingAdmissionLimiter(client=wire))
    for path, method, payload in (("/api/billing/status", "GET", None),
                                  ("/api/billing/checkout", "POST", {"plan": "pro", "cadence": "monthly"}),
                                  ("/api/billing/portal", "POST", {})):
        for headers, expected in (({}, 401), ({"Authorization": "Bearer invalid"}, 401),
                                  (context.headers[1], 403), (context.headers[2], 401)):
            response = context.client.request(method, path, headers=headers, json_body=payload)
            assert response.status_code == expected
    assert wire.calls == [] and context.provider.calls == []
    assert persisted(context) == ((), ())
    assert status(context).status_code == 503  # The real verified owner reaches admission.
    assert len(wire.calls) == 1


def paid_account(context, monkeypatch):
    assert checkout(context).status_code == 200
    identifier = customer(context)
    context.provider.snapshots[identifier] = snapshot(context, identifier)
    assert status(context).json()["workspace_access"] is True
    monkeypatch.setattr(billing.BillingConfig, "from_settings", classmethod(lambda cls: context.config))
    monkeypatch.setattr(billing, "StripeProvider", lambda _config: context.provider)
    return identifier


def expire_lease(context):
    with context.factory() as db:
        row = db.scalar(select(models.BillingCustomer).where(models.BillingCustomer.user_id == context.owners[0]))
        row.verified_at = models.utcnow() - timedelta(seconds=billing.ACCESS_LEASE_SECONDS + 1)
        db.commit()


def export(context):
    return context.client.get("/api/app-data/export", headers=context.headers[0])


def test_fresh_exports_are_quota_free_stale_exports_share_status_and_recover(context, monkeypatch):
    identifier = paid_account(context, monkeypatch)
    clock = [10.0]
    limiter = BillingAdmissionLimiter(status_limit=1, clock=lambda: clock[0])
    monkeypatch.setattr(billing, "billing_limiter", limiter)
    with limiter.admit(context.owners[0], "status"):
        pass
    calls = list(context.provider.calls)
    assert export(context).status_code == 200
    assert context.provider.calls == calls
    expire_lease(context)
    before = persisted(context)
    assert export(context).status_code == 403
    assert persisted(context) == before and context.provider.calls == calls
    assert_denied_without_work(context, lambda: status(context), 429, 60)
    clock[0] += 60
    assert export(context).status_code == 200
    assert context.provider.calls[len(calls):] == [("subscriptions", identifier)]
    assert persisted(context) != before
    assert_denied_without_work(context, lambda: status(context), 429, 60)


@pytest.mark.parametrize("fault", ["redis", "provider"])
def test_stale_paid_export_fails_closed_without_extending_lease_and_recovers(context, monkeypatch, fault):
    paid_account(context, monkeypatch)
    expire_lease(context)
    before, calls = persisted(context), list(context.provider.calls)
    if fault == "redis":
        wire = UnavailableRedis()
        monkeypatch.setattr(billing, "billing_limiter", BillingAdmissionLimiter(client=wire, max_concurrent=1))
    else:
        context.provider.failure = billing.BillingError(503, "Provider unavailable")
    assert export(context).status_code == 403
    assert persisted(context) == before
    if fault == "redis":
        assert context.provider.calls == calls and len(wire.calls) == 1
        monkeypatch.setattr(billing, "billing_limiter", BillingAdmissionLimiter())
    else:
        assert len(context.provider.calls) == len(calls) + 1
        context.provider.failure = None
    assert export(context).status_code == 200
    assert persisted(context) != before


@pytest.mark.parametrize("phase", ["commit", "rollback"])
def test_route_slot_covers_real_database_commit_or_failure_rollback(tmp_path, monkeypatch, phase):
    engine = create_engine(f"sqlite:///{tmp_path / 'held-billing.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(models.BetaUser(id=1, email="held@example.test", name="Original", provider="google", google_subject="held_subject"))
        db.commit()
    entered, release = Event(), Event()
    class HeldSession(Session):
        def commit(self):
            if phase == "commit":
                entered.set()
                assert release.wait(5), "Commit release was not signalled"
            return super().commit()
        def rollback(self):
            if phase == "rollback":
                entered.set()
                assert release.wait(5), "Rollback release was not signalled"
            return super().rollback()
    factory = sessionmaker(bind=engine, class_=HeldSession)
    monkeypatch.setattr(billing, "billing_limiter", BillingAdmissionLimiter(max_concurrent=1))
    def held_transaction():
        with factory() as db:
            def action():
                db.get(models.BetaUser, 1).name = "Committed"
                db.flush()
                if phase == "rollback":
                    db.add(models.BetaUser(email="held@example.test", name="Duplicate"))
                    db.flush()  # Actual unique-constraint error enters rollback.
                return {"ok": True}
            return routes._transaction(db, action, owner_id=1)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(held_transaction)
            try:
                assert entered.wait(5)
                with Session(engine) as db:
                    assert db.get(models.BetaUser, 1).name == "Original"
                    reached = []
                    with pytest.raises(HTTPException) as error:
                        routes._transaction(db, lambda: reached.append(True), owner_id=2)
                    assert error.value.status_code == 429 and error.value.headers["Retry-After"] == "1"
                    assert reached == []
            finally:
                release.set()
            if phase == "rollback":
                with pytest.raises(HTTPException) as error:
                    future.result(timeout=5)
                assert error.value.status_code == 503
            else:
                assert future.result(timeout=5) == {"ok": True}
        with Session(engine) as db:
            assert db.get(models.BetaUser, 1).name == ("Committed" if phase == "commit" else "Original")
            assert routes._transaction(db, lambda: {"available": True}, owner_id=2) == {"available": True}
    finally:
        release.set()
        engine.dispose()


def cached_catalog(context, monkeypatch):
    monkeypatch.setattr(billing, "_catalog_cache", {})
    app.dependency_overrides[routes.get_billing_provider] = lambda: None
    monkeypatch.setattr(billing, "StripeProvider", lambda _config: context.provider)


def test_public_catalog_cold_single_flight_busy_does_not_poison_warm_cache(context, monkeypatch):
    cached_catalog(context, monkeypatch)
    monkeypatch.setattr(billing, "billing_limiter", BillingAdmissionLimiter(client=UnavailableRedis()))
    entered, release = Event(), Event()
    original = context.provider.retrieve_price
    def held_price(identifier):
        price = original(identifier)
        if not entered.is_set():
            entered.set()
            assert release.wait(5), "Catalog release was not signalled"
        return price
    monkeypatch.setattr(context.provider, "retrieve_price", held_price)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(context.client.get, "/api/billing/catalog")
        try:
            assert entered.wait(5)
            for _ in range(12):
                busy = context.client.get("/api/billing/catalog")
                assert busy.status_code == 503 and busy.headers["retry-after"] == "1"
                assert busy.headers["cache-control"] == "no-store"
            assert len(context.provider.calls) == 1 and billing._catalog_cache == {}
        finally:
            release.set()
        assert future.result(timeout=5).json()["checkout_available"] is True
    assert len(context.provider.calls) == 2
    # A populated entry remains readable even while the separate refresh gate is held.
    assert billing._catalog_refresh_lock.acquire(blocking=False)
    try:
        for _ in range(20):
            response = context.client.get("/api/billing/catalog")
            assert response.status_code == 200 and response.json()["checkout_available"] is True
    finally:
        billing._catalog_refresh_lock.release()
    assert len(context.provider.calls) == 2


def test_catalog_distinct_configuration_keys_and_provider_exception_release(context, monkeypatch):
    cached_catalog(context, monkeypatch)
    configs = []
    def provider(config):
        configs.append(config)
        return Provider(SimpleNamespace(config=config))
    monkeypatch.setattr(billing, "StripeProvider", provider)
    assert context.client.get("/api/billing/catalog").json()["mode"] == "live"
    assert context.client.get("/api/billing/catalog").json()["mode"] == "live"
    assert len(configs) == 1
    context.config = replace(context.config, mode="test", secret_key="sk_test_routefixture")
    assert context.client.get("/api/billing/catalog").json()["mode"] == "test"
    assert len(configs) == 2 and len(billing._catalog_cache) == 2
    monkeypatch.setattr(billing, "_catalog_cache", {})
    class BrokenProvider:
        def retrieve_price(self, _identifier):
            raise RuntimeError("Unexpected provider transport failure")
    monkeypatch.setattr(billing, "StripeProvider", lambda _config: BrokenProvider())
    assert context.client.get("/api/billing/catalog").status_code == 500
    assert billing._catalog_cache == {}
    monkeypatch.setattr(billing, "StripeProvider", provider)
    assert context.client.get("/api/billing/catalog").json()["checkout_available"] is True
    assert len(billing._catalog_cache) == 1
