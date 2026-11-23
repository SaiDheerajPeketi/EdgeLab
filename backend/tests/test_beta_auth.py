from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api import routes
from app import auth
from app.db import Base
from app.models import Playbook
from app.schemas import BetaAccessRequest


def make_model_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    return session_factory()


def test_beta_access_waitlists_after_seats_fill(monkeypatch):
    settings = SimpleNamespace(
        deployment_mode="beta",
        beta_seats_total=1,
        beta_manual_access_enabled=True,
        jwt_secret="test-jwt-secret",
    )
    monkeypatch.setattr(routes, "settings", settings)
    monkeypatch.setattr(auth, "settings", settings)
    db = make_model_session()

    try:
      first = routes.beta_access(
          BetaAccessRequest(email="alpha@desk.com", name="Alpha Trader", provider="email"),
          db,
      )
      second = routes.beta_access(
          BetaAccessRequest(email="beta@desk.com", name="Beta Trader", provider="google"),
          db,
      )
      first_playbooks = db.query(Playbook).filter(Playbook.user_id == first.session.user.id).count()
      second_playbooks = db.query(Playbook).filter(Playbook.user_id == second.session.user.id).count()
    finally:
      db.close()

    assert first.session.user.approved is True
    assert first.session.user.beta_position == 1
    assert first.program.seats_taken == 1
    assert first.program.seats_remaining == 0

    assert second.session.user.approved is False
    assert second.session.user.beta_position == 1
    assert second.program.seats_taken == 1
    assert second.program.waitlist_count == 1
    assert first_playbooks == 0
    assert second_playbooks == 0


def test_beta_session_can_be_read_and_deleted(monkeypatch):
    settings = SimpleNamespace(
        deployment_mode="beta",
        beta_seats_total=2,
        beta_manual_access_enabled=True,
        jwt_secret="test-jwt-secret",
    )
    monkeypatch.setattr(routes, "settings", settings)
    monkeypatch.setattr(auth, "settings", settings)
    db = make_model_session()

    try:
      access = routes.beta_access(
          BetaAccessRequest(email="gamma@desk.com", name="Gamma Trader", provider="google"),
          db,
      )
      authorization = f"Bearer {access.session.token}"

      current_user = auth.require_auth(authorization=authorization, db=db)
      hydrated = routes.read_beta_session(db=db, current_user=current_user)
      cleared = routes.delete_beta_session(db=db, current_user=current_user)

      with pytest.raises(HTTPException) as exc_info:
          auth.require_auth(authorization=authorization, db=db)
    finally:
      db.close()

    assert hydrated.user.email == "gamma@desk.com"
    assert hydrated.user.approved is True
    assert cleared == {"ok": True}
    assert exc_info.value.status_code == 401


def test_beta_access_requires_google_auth_by_default(monkeypatch):
    settings = SimpleNamespace(
        deployment_mode="beta",
        beta_seats_total=2,
        beta_manual_access_enabled=False,
        jwt_secret="test-jwt-secret",
    )
    monkeypatch.setattr(routes, "settings", settings)
    monkeypatch.setattr(auth, "settings", settings)
    db = make_model_session()

    try:
        with pytest.raises(HTTPException) as exc_info:
            routes.beta_access(
                BetaAccessRequest(email="delta@desk.com", name="Delta Trader", provider="email"),
                db,
            )
    finally:
        db.close()

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Manual beta access disabled. Use Google sign-in."


def test_beta_auth_config_returns_google_redirect_uri(monkeypatch):
    monkeypatch.setattr(
        routes,
        "settings",
        SimpleNamespace(
        deployment_mode="beta",
            beta_manual_access_enabled=False,
            dev_auth_bypass_enabled=False,
            google_client_id="client-id",
            google_client_secret="client-secret",
            google_redirect_uri="https://auth.example.com/callback/google",
        ),
    )

    response = routes.beta_auth_config()

    assert response.google_enabled is True
    assert response.google_client_id == "client-id"
    assert response.google_redirect_uri == "https://auth.example.com/callback/google"
    assert response.manual_access_enabled is False
    assert response.dev_auth_bypass_enabled is False


def test_google_token_exchange_rejects_unconfigured_redirect_uri(monkeypatch):
    monkeypatch.setattr(
        routes,
        "settings",
        SimpleNamespace(
        deployment_mode="beta",
            google_client_id="client-id",
            google_client_secret="client-secret",
            google_redirect_uri="https://auth.example.com/callback/google",
        ),
    )

    with pytest.raises(HTTPException) as exc_info:
        routes.fetch_google_token_payload(
            "authorization-code",
            "https://attacker.example/callback",
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Invalid OAuth redirect URI"


def test_fetch_google_userinfo_builds_urllib_request(monkeypatch):
    captured = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self):
            return b'{"email":"alpha@desk.com","name":"Alpha Trader","email_verified":true,"sub":"google_alpha"}'

    def fake_urlopen(request, timeout):
        captured["request"] = request
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr(routes, "urlopen", fake_urlopen)

    response = routes.fetch_google_userinfo("access-token")

    assert response["email"] == "alpha@desk.com"
    assert captured["request"].get_full_url() == "https://openidconnect.googleapis.com/v1/userinfo"
    assert captured["request"].get_header("Authorization") == "Bearer access-token"
    assert captured["timeout"] == 20


def test_dev_auth_bypass_is_only_advertised_for_local_origins(monkeypatch):
    monkeypatch.setattr(
        routes,
        "settings",
        SimpleNamespace(
        deployment_mode="beta",
            beta_manual_access_enabled=False,
            dev_auth_bypass_enabled=True,
            google_client_id="",
            google_client_secret="",
            google_redirect_uri="",
            public_origin="https://example.com",
            cors_origins=("http://localhost:5173",),
        ),
    )

    assert routes.beta_auth_config().dev_auth_bypass_enabled is False

    monkeypatch.setattr(
        routes,
        "settings",
        SimpleNamespace(
        deployment_mode="beta",
            beta_manual_access_enabled=False,
            dev_auth_bypass_enabled=True,
            google_client_id="",
            google_client_secret="",
            google_redirect_uri="",
            public_origin="http://localhost:5173",
            cors_origins=("http://localhost:5173", "http://127.0.0.1:5173"),
        ),
    )

    assert routes.beta_auth_config().dev_auth_bypass_enabled is True


def test_dev_auth_bypass_issues_session_only_for_loopback_request(monkeypatch):
    settings = SimpleNamespace(
        deployment_mode="beta",
        beta_seats_total=2,
        beta_manual_access_enabled=False,
        dev_auth_bypass_enabled=True,
        jwt_secret="test-jwt-secret",
        public_origin="http://localhost:5173",
        cors_origins=("http://localhost:5173",),
    )
    monkeypatch.setattr(routes, "settings", settings)
    monkeypatch.setattr(auth, "settings", settings)
    db = make_model_session()

    try:
        blocked_request = SimpleNamespace(
        deployment_mode="beta",
            url=SimpleNamespace(hostname="example.com"),
            client=SimpleNamespace(host="203.0.113.10"),
        )
        with pytest.raises(HTTPException) as exc_info:
            routes.dev_auth_bypass(blocked_request, db)

        local_request = SimpleNamespace(
        deployment_mode="beta",
            url=SimpleNamespace(hostname="localhost"),
            client=SimpleNamespace(host="127.0.0.1"),
        )
        response = routes.dev_auth_bypass(local_request, db)
    finally:
        db.close()

    assert exc_info.value.status_code == 404
    assert response.session.user.email == "developer@localhost.edgelab"
    assert response.session.user.approved is True
