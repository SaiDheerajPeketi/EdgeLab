from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api import routes
from app.db import Base
from app.schemas import BetaAccessRequest


def make_model_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    return session_factory()


def test_beta_access_waitlists_after_seats_fill(monkeypatch):
    monkeypatch.setattr(
        routes,
        "settings",
        SimpleNamespace(beta_seats_total=1, beta_manual_access_enabled=True),
    )
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


def test_beta_session_can_be_read_and_deleted(monkeypatch):
    monkeypatch.setattr(
        routes,
        "settings",
        SimpleNamespace(beta_seats_total=2, beta_manual_access_enabled=True),
    )
    db = make_model_session()

    try:
      access = routes.beta_access(
          BetaAccessRequest(email="gamma@desk.com", name="Gamma Trader", provider="google"),
          db,
      )
      authorization = f"Bearer {access.session.token}"

      hydrated = routes.read_beta_session(authorization=authorization, db=db)
      cleared = routes.delete_beta_session(authorization=authorization, db=db)

      with pytest.raises(HTTPException) as exc_info:
          routes.read_beta_session(authorization=authorization, db=db)
    finally:
      db.close()

    assert hydrated.user.email == "gamma@desk.com"
    assert hydrated.user.approved is True
    assert cleared == {"ok": True}
    assert exc_info.value.status_code == 401


def test_beta_access_requires_google_auth_by_default(monkeypatch):
    monkeypatch.setattr(
        routes,
        "settings",
        SimpleNamespace(beta_seats_total=2, beta_manual_access_enabled=False),
    )
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
