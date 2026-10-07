from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app import auth
from app.api import routes
from app.db import Base
from app.models import BetaSession, BetaUser, BillingCustomer, BillingSubscription, utcnow
from app.schemas import GoogleAuthExchangeRequest
from app.services import access_policy, billing
from test_billing import FakeProvider, config, customer, db, subscription


def mode(value="production", cap=500):
    return SimpleNamespace(deployment_mode=value, beta_seats_total=cap, jwt_secret="fixture", beta_manual_access_enabled=True, dev_auth_bypass_enabled=True)


def use_settings(monkeypatch, value):
    monkeypatch.setattr(routes, "settings", value)
    monkeypatch.setattr(auth, "settings", value)


def test_mode_default_unknown_and_production_approved_are_fail_closed(db):
    assert access_policy.deployment_mode(SimpleNamespace()) == "production"
    for invalid in ["", "prod", "BETA", None]:
        with pytest.raises(HTTPException) as error:
            access_policy.access_snapshot(db, 1, mode(invalid))
        assert error.value.status_code == 503
    result = access_policy.access_snapshot(db, 1, mode())
    assert not result["workspace_access"] and result["plan"] == "none"
    assert db.get(BetaUser, 1).status == "APPROVED"
    with pytest.raises(HTTPException) as error:
        access_policy.require_workspace_user(db, 1, mode())
    assert error.value.status_code == 403


def test_production_disables_manual_and_development_auth_even_enabled(db, monkeypatch):
    settings = mode()
    settings.public_origin, settings.cors_origins = "http://localhost:5173", ("http://localhost:5173",)
    use_settings(monkeypatch, settings)
    assert routes.beta_manual_access_enabled() is False
    assert routes.dev_auth_bypass_enabled() is False


def test_historical_approved_cap_preserves_records_but_bounds_free_access(db):
    for i in range(3, 504):
        db.add(BetaUser(id=i, email=f"{i}@example.com", provider="google", status="APPROVED", beta_position=i))
    db.commit()
    report = access_policy.sync_beta(db, mode("beta", 700))
    assert report["seats_taken"] == 500
    assert access_policy.access_snapshot(db, 503, mode("beta", 700))["workspace_access"] is False
    assert db.get(BetaUser, 503).status == "APPROVED"
    assert access_policy.access_snapshot(db, 1, mode("beta"))["workspace_access"] is True


def test_public_mode_never_enrolls_or_renumbers_beta_history(db, monkeypatch):
    use_settings(monkeypatch, mode())
    db.get(BetaUser, 1).beta_position = 92
    db.commit()
    program = routes.sync_beta_program(db)
    assert program.mode == "production" and program.seats_total == 0
    assert db.get(BetaUser, 1).beta_position == 92
    assert db.get(BetaUser, 2).status == "WAITLISTED"


def test_beta_public_user_enrolls_within_cap_and_effective_session_expiry(db, monkeypatch):
    use_settings(monkeypatch, mode("beta", 1))
    db.get(BetaUser, 1).status = "PUBLIC"
    db.get(BetaUser, 2).status = "PUBLIC"
    db.commit()
    first = routes.issue_beta_session(db, db.get(BetaUser, 1))
    db.commit()
    assert first.user.workspace_access and first.user.plan == "beta"
    assert first.user.access_expires_at == first.expires_at
    assert db.get(BetaUser, 2).status == "WAITLISTED"
    second = routes.issue_beta_session(db, db.get(BetaUser, 2))
    assert second.user.workspace_access is False


def test_production_live_lease_expiry_term_and_retry_preserve_identity(db, monkeypatch):
    use_settings(monkeypatch, mode())
    conf = config()
    monkeypatch.setattr(billing.BillingConfig, "from_settings", classmethod(lambda cls: conf))
    provider = FakeProvider(conf)
    monkeypatch.setattr(billing, "StripeProvider", lambda _: provider)
    db.get(BetaUser, 1).provider = "google"
    db.get(BetaUser, 1).google_subject = "verified_one"
    db.commit()
    cust = customer(db, conf)
    provider.subscriptions = [subscription(conf, cust)]
    result = access_policy.access_snapshot(db, 1, mode())
    assert result["workspace_access"] and result["plan"] == "pro"
    assert result["access_expires_at"] <= utcnow() + timedelta(seconds=300)
    db.commit()
    cust.verified_at = utcnow() - timedelta(seconds=301)
    db.commit()
    old = cust.verified_at
    provider.fail_list = True
    session = routes.issue_beta_session(db, db.get(BetaUser, 1))
    db.commit()
    assert session.user.workspace_access is False
    assert db.get(BetaSession, auth._decode_jwt(session.token)["session_id"]) is not None
    assert cust.verified_at == old
    assert auth.authenticate_token(db, session.token).id == 1
    provider.fail_list = False
    assert access_policy.access_snapshot(db, 1, mode())["workspace_access"] is True
    provider.subscriptions[0]["items"]["data"][0]["current_period_end"] = int(utcnow().timestamp()) + 15
    cust.verified_at = utcnow() - timedelta(seconds=301)
    result = access_policy.access_snapshot(db, 1, mode())
    assert result["access_expires_at"] <= utcnow() + timedelta(seconds=15)


def test_production_sandbox_payment_never_grants_access(db, monkeypatch):
    conf = config("test")
    monkeypatch.setattr(billing.BillingConfig, "from_settings", classmethod(lambda cls: conf))
    cust = customer(db, conf)
    provider = FakeProvider(conf)
    provider.subscriptions = [subscription(conf, cust)]
    billing.reconcile(db, cust, conf, provider)
    assert access_policy.access_snapshot(db, 1, mode())["workspace_access"] is False


def google(monkeypatch, db, subject="google_one", email="one@example.com", verified=True):
    monkeypatch.setattr(routes, "fetch_google_token_payload", lambda *_: {"access_token": "networkfixture"})
    monkeypatch.setattr(routes, "fetch_google_userinfo", lambda _: {"sub": subject, "email": email, "email_verified": verified, "name": "Google One"})
    return routes.exchange_google_auth_code(GoogleAuthExchangeRequest(code="code", redirect_uri="https://example.com/callback"), db)


@pytest.mark.parametrize("subject,verified", [(None, True), ("", True), ("x"*256, True), ("bad sub", True), ("google_one", False), ("google_one", "true")])
def test_google_rejects_unverified_or_invalid_subject(db, monkeypatch, subject, verified):
    use_settings(monkeypatch, mode())
    with pytest.raises(HTTPException) as error:
        google(monkeypatch, db, subject, "new@example.com", verified)
    assert error.value.status_code == 502
    assert db.scalar(select(BetaUser).where(BetaUser.email == "new@example.com")) is None


def test_google_subject_legacy_binding_no_foreign_email_merge(db, monkeypatch):
    use_settings(monkeypatch, mode())
    with pytest.raises(HTTPException) as error:
        google(monkeypatch, db)
    assert error.value.status_code == 409  # existing email provider cannot be taken over
    db.get(BetaUser, 1).provider = "google"
    db.commit()
    response = google(monkeypatch, db)
    assert response.session.user.id == 1 and response.session.user.workspace_access is False
    assert db.get(BetaUser, 1).google_subject == "google_one"
    with pytest.raises(HTTPException):
        google(monkeypatch, db, "google_foreign")
    response = google(monkeypatch, db, email="changed@example.com")
    assert response.session.user.id == 1 and response.session.user.email == "changed@example.com"
    with pytest.raises(HTTPException):
        google(monkeypatch, db, email="two@example.com")
    assert db.get(BetaUser, 2).google_subject is None


def test_new_public_google_account_bypasses_cap_and_preserves_history(db, monkeypatch):
    use_settings(monkeypatch, mode(cap=1))
    response = google(monkeypatch, db, "new_subject", "new@example.com")
    user = db.get(BetaUser, response.session.user.id)
    assert user.status == "PUBLIC" and user.beta_position is None
    assert response.program.mode == "production" and response.session.user.plan == "none"
    assert db.get(BetaUser, 1).status == "APPROVED"
    assert db.get(BetaUser, 2).status == "WAITLISTED"


def test_concurrent_beta_enrollment_cannot_overfill(tmp_path, monkeypatch):
    settings = mode("beta", 1)
    use_settings(monkeypatch, settings)
    engine = create_engine(f"sqlite:///{tmp_path / 'enrollment.sqlite'}", connect_args={"check_same_thread": False, "timeout": 10})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    barrier = Barrier(2)
    def enroll(index):
        with factory() as session:
            barrier.wait(timeout=5)
            response = routes.grant_beta_access_response(session, email=f"{index}@example.com", name="One", provider="email")
            session.commit()
            return response.session.user.workspace_access
    with ThreadPoolExecutor(max_workers=2) as pool:
        grants = list(pool.map(enroll, [1, 2]))
    assert sorted(grants) == [False, True]
    with factory() as check:
        assert len(check.scalars(select(BetaUser).where(BetaUser.status == "APPROVED")).all()) == 1
    engine.dispose()


@pytest.mark.parametrize("deployment", ["beta", "production"])
def test_export_requires_live_paid_subscription_even_for_free_beta(db, monkeypatch, deployment):
    use_settings(monkeypatch, mode(deployment))
    current = auth.AuthenticatedUser(1, "one@example.com", "One", "email", True, 1, "session", utcnow(), utcnow()+timedelta(hours=1))
    monkeypatch.setattr(billing.BillingConfig, "from_settings", classmethod(lambda cls: billing.BillingConfig()))
    with pytest.raises(HTTPException) as error:
        auth.require_subscription(current, db)
    assert error.value.status_code == 403
    db.get(BetaUser, 1).provider = "google"
    db.get(BetaUser, 1).google_subject = "verified_one"
    db.commit()
    conf = config()
    monkeypatch.setattr(billing.BillingConfig, "from_settings", classmethod(lambda cls: conf))
    provider = FakeProvider(conf)
    monkeypatch.setattr(billing, "StripeProvider", lambda _: provider)
    cust = customer(db, conf)
    provider.subscriptions = [subscription(conf, cust)]
    assert auth.require_subscription(current, db).id == 1
    assert db.get(BetaUser, 1).status == "APPROVED"


def test_provider_refresh_cannot_grant_a_term_expired_during_network_delay(db, monkeypatch):
    conf = config()
    monkeypatch.setattr(billing.BillingConfig, "from_settings", classmethod(lambda cls: conf))
    provider = FakeProvider(conf)
    monkeypatch.setattr(billing, "StripeProvider", lambda _: provider)
    cust = customer(db, conf)
    before = utcnow()
    clock = [before]
    monkeypatch.setattr(access_policy, "utcnow", lambda: clock[0])
    provider.subscriptions = [subscription(conf, cust, period=int(before.timestamp())+1)]
    original = provider.list_subscriptions
    def slow_snapshot(identifier):
        result = original(identifier)
        clock[0] = before+timedelta(seconds=10)
        return result
    provider.list_subscriptions = slow_snapshot
    result = access_policy.access_snapshot(db, 1, mode())
    assert result["workspace_access"] is False and result["access_expires_at"] is None
    with pytest.raises(HTTPException) as error:
        access_policy.require_workspace_user(db, 1, mode())
    assert error.value.status_code == 403



def test_existing_sqlite_google_column_migration_preserves_accounts_and_enforces_unique(tmp_path):
    from sqlalchemy import inspect, text
    from sqlalchemy.exc import IntegrityError
    from app.migrations import migrate_google_subject
    engine = create_engine(f"sqlite:///{tmp_path / 'existing.sqlite'}")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE beta_users (id INTEGER PRIMARY KEY, email VARCHAR(320), provider VARCHAR(16), status VARCHAR(16), beta_position INTEGER)"))
        connection.execute(text("INSERT INTO beta_users VALUES (1,'one@example.com','google','APPROVED',42),(2,'two@example.com','google','WAITLISTED',7)"))
    migrate_google_subject(engine)
    migrate_google_subject(engine)
    assert "google_subject" in {column["name"] for column in inspect(engine).get_columns("beta_users")}
    with engine.begin() as connection:
        assert connection.execute(text("SELECT id,status,beta_position,google_subject FROM beta_users ORDER BY id")).all() == [(1,"APPROVED",42,None),(2,"WAITLISTED",7,None)]
        connection.execute(text("UPDATE beta_users SET google_subject='stable_subject' WHERE id=1"))
    with pytest.raises(IntegrityError):
        with engine.begin() as connection:
            connection.execute(text("UPDATE beta_users SET google_subject='stable_subject' WHERE id=2"))
    engine.dispose()



def test_actual_existing_sqlite_startup_adds_subject_without_changing_records(tmp_path, monkeypatch):
    from sqlalchemy import inspect, text
    from app import db as database
    engine = create_engine(f"sqlite:///{tmp_path / 'startup.sqlite'}")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE beta_users (id INTEGER PRIMARY KEY, email VARCHAR(320) UNIQUE, name VARCHAR(160), provider VARCHAR(16), status VARCHAR(16), beta_position INTEGER, created_at DATETIME, updated_at DATETIME, last_login_at DATETIME)"))
        connection.execute(text("INSERT INTO beta_users VALUES (74,'existing@example.com','Existing','google','APPROVED',42,'2026-01-01','2026-01-01',NULL)"))
        connection.execute(text("CREATE TABLE beta_sessions (id VARCHAR(128) PRIMARY KEY, user_id INTEGER, created_at DATETIME, expires_at DATETIME)"))
        connection.execute(text("INSERT INTO beta_sessions VALUES ('existing_session',74,'2026-01-01','2027-01-01')"))
    monkeypatch.setattr(database, "engine", engine)
    database.init_db()
    database.init_db()
    assert "google_subject" in {column["name"] for column in inspect(engine).get_columns("beta_users")}
    with sessionmaker(bind=engine)() as session:
        user = session.get(BetaUser, 74)
        assert (user.email,user.status,user.beta_position,user.google_subject) == ("existing@example.com","APPROVED",42,None)
        assert session.get(BetaSession,"existing_session").user_id == 74
    engine.dispose()



def test_legacy_google_looking_manual_token_is_revoked_when_verified_owner_binds(db, monkeypatch):
    use_settings(monkeypatch, mode("beta"))
    user = db.get(BetaUser, 1)
    user.provider = "google"  # Persisted pre-47 caller-supplied provider label.
    old = routes.issue_beta_session(db, user)
    db.commit()
    old_id = auth._decode_jwt(old.token)["session_id"]
    use_settings(monkeypatch, mode())
    with pytest.raises(HTTPException) as error:
        auth.authenticate_token(db, old.token)
    assert error.value.status_code == 401
    verified = google(monkeypatch, db)
    assert verified.session.user.id == user.id
    assert db.get(BetaSession, old_id) is None
    assert auth.authenticate_token(db, verified.session.token).id == user.id
    with pytest.raises(HTTPException) as error:
        auth.authenticate_token(db, old.token)
    assert error.value.status_code == 401
    assert (user.status,user.email) == ("APPROVED","one@example.com")


def test_manual_beta_identity_cannot_manage_live_billing_or_paid_export(db, monkeypatch):
    use_settings(monkeypatch, mode("beta"))
    manual = routes.issue_beta_session(db, db.get(BetaUser, 1))
    db.commit()
    identity = auth.authenticate_token(db, manual.token)
    assert access_policy.access_snapshot(db, identity.id, mode("beta"))["workspace_access"] is True
    for guard in [auth.require_billing_identity, auth.require_subscription]:
        with pytest.raises(HTTPException) as error:
            guard(identity, db)
        assert error.value.status_code == 403
