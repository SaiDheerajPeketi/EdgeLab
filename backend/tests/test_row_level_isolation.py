from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.api import routes
from app.auth import AuthenticatedUser
from app.db import Base
from app.models import AppStorageItem, BacktestSession, BetaUser, FeedbackSubmission
from app.schemas import (
    AppStoragePayload,
    BacktestAdvanceRequest,
    BacktestCreate,
    BacktestSessionUpdate,
    FeedbackCreate,
    OrderCreate,
    PlaybookCreate,
)
from app.services.backtester import BacktestService
from app.services.datasets import DatasetCatalogService


def make_session_factory():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def seed_user(db, email: str, name: str) -> int:
    user = BetaUser(
        email=email,
        name=name,
        provider="google",
        status="APPROVED",
    )
    db.add(user)
    db.commit()
    return user.id


def auth_user(user_id: int, email: str, name: str) -> AuthenticatedUser:
    now = datetime.now(timezone.utc)
    return AuthenticatedUser(
        id=user_id,
        email=email,
        name=name,
        provider="google",
        approved=True,
        beta_position=1,
        session_id=f"session-{user_id}",
        session_created_at=now,
        session_expires_at=now,
    )


def build_services(tmp_path, session_factory):
    datasets_root = tmp_path / "datasets"
    asset_dir = datasets_root / "NQ"
    asset_dir.mkdir(parents=True)
    (asset_dir / "NQ_M1.csv").write_text(
        "Timestamp,Open,High,Low,Close,Volume\n"
        "2024-01-01 09:30:00,100,100,100,100,10\n"
        "2024-01-01 09:31:00,100,103,99,102,12\n"
        "2024-01-01 09:32:00,102,104,101,103,15\n",
        encoding="utf-8",
    )
    catalog = DatasetCatalogService(datasets_root, session_factory)
    backtester = BacktestService(dataset_catalog=catalog)
    return catalog, backtester


def test_backtest_routes_return_404_for_other_users(tmp_path, monkeypatch):
    session_factory = make_session_factory()
    catalog, backtester = build_services(tmp_path, session_factory)
    monkeypatch.setattr(routes, "dataset_catalog", catalog)
    monkeypatch.setattr(routes, "backtester", backtester)

    with session_factory() as db:
        owner_id = seed_user(db, "owner@edgelab.local", "Owner")
        intruder_id = seed_user(db, "intruder@edgelab.local", "Intruder")
        catalog.refresh_catalog(db, owner_id)
        state = backtester.create_session(
            db,
            owner_id,
            BacktestCreate(instrument="NQ", timeframe="M1", name="Owner Session"),
        )

        with pytest.raises(HTTPException) as exc_info:
            routes.get_backtest(
                session_id=state.session.id,
                db=db,
                current_user=auth_user(intruder_id, "intruder@edgelab.local", "Intruder"),
            )
        assert exc_info.value.status_code == 404

        with pytest.raises(HTTPException) as exc_info:
            routes.patch_backtest_session(
                session_id=state.session.id,
                payload=BacktestSessionUpdate(name="Hijacked"),
                db=db,
                current_user=auth_user(intruder_id, "intruder@edgelab.local", "Intruder"),
            )
        assert exc_info.value.status_code == 404

        with pytest.raises(HTTPException) as exc_info:
            routes.delete_backtest_session(
                session_id=state.session.id,
                db=db,
                current_user=auth_user(intruder_id, "intruder@edgelab.local", "Intruder"),
            )
        assert exc_info.value.status_code == 404

        stored_session = db.scalar(
            select(BacktestSession).where(BacktestSession.id == state.session.id)
        )
        assert stored_session is not None
        assert stored_session.user_id == owner_id
        assert stored_session.name == "Owner Session"


def test_playbooks_storage_and_metrics_are_user_scoped(tmp_path, monkeypatch):
    session_factory = make_session_factory()
    catalog, backtester = build_services(tmp_path, session_factory)
    monkeypatch.setattr(routes, "dataset_catalog", catalog)
    monkeypatch.setattr(routes, "backtester", backtester)

    with session_factory() as db:
        owner_id = seed_user(db, "owner@edgelab.local", "Owner")
        intruder_id = seed_user(db, "intruder@edgelab.local", "Intruder")
        owner = auth_user(owner_id, "owner@edgelab.local", "Owner")
        intruder = auth_user(intruder_id, "intruder@edgelab.local", "Intruder")

        catalog.refresh_catalog(db, owner_id)
        catalog.refresh_catalog(db, intruder_id)

        playbook = routes.create_playbook(
            payload=PlaybookCreate(name="Owner Playbook"),
            db=db,
            current_user=owner,
        )

        state = backtester.create_session(
            db,
            owner_id,
            BacktestCreate(instrument="NQ", timeframe="M1"),
        )
        state = backtester.place_order(
            db,
            owner_id,
            state.session.id,
            OrderCreate(
                side="BUY",
                order_type="MARKET",
                quantity=1,
                stop_loss=99,
                take_profit=103,
            ),
        )
        backtester.advance(
            db,
            owner_id,
            state.session.id,
            BacktestAdvanceRequest(steps=1),
        )

        intruder_metrics = routes.metrics(
            session_id=state.session.id,
            db=db,
            current_user=intruder,
        )
        assert intruder_metrics.total_trades == 0
        assert intruder_metrics.net_pnl == 0

        routes.put_app_storage_item(
            namespace="prefs",
            key="theme",
            payload=AppStoragePayload(value={"mode": "dark"}),
            db=db,
            current_user=owner,
        )
        intruder_item = routes.get_app_storage_item(
            namespace="prefs",
            key="theme",
            db=db,
            current_user=intruder,
        )
        assert intruder_item.value is None

        routes.delete_app_storage_item(
            namespace="prefs",
            key="theme",
            db=db,
            current_user=intruder,
        )
        owner_item = db.scalar(
            select(AppStorageItem).where(
                AppStorageItem.user_id == owner_id,
                AppStorageItem.namespace == "prefs",
                AppStorageItem.key == "theme",
            )
        )
        assert owner_item is not None

        with pytest.raises(HTTPException) as exc_info:
            routes.create_backtest(
                payload=BacktestCreate(
                    instrument="NQ",
                    timeframe="M1",
                    playbook_id=playbook.id,
                ),
                db=db,
                current_user=intruder,
            )
        assert exc_info.value.status_code == 404


def test_feedback_submission_is_stored_for_authenticated_user():
    session_factory = make_session_factory()

    with session_factory() as db:
        owner_id = seed_user(db, "owner@edgelab.local", "Owner")
        intruder_id = seed_user(db, "intruder@edgelab.local", "Intruder")

        submission = routes.create_feedback(
            payload=FeedbackCreate(
                category="FEATURE",
                message="Please add richer replay analytics to the trade review screens.",
                context={"source_view": "feedback"},
            ),
            db=db,
            current_user=auth_user(owner_id, "owner@edgelab.local", "Owner"),
        )

        assert submission.category == "FEATURE"
        stored_submission = db.scalar(
            select(FeedbackSubmission).where(FeedbackSubmission.id == submission.id)
        )
        assert stored_submission is not None
        assert stored_submission.user_id == owner_id
        assert stored_submission.context == {"source_view": "feedback"}

        intruder_rows = db.scalars(
            select(FeedbackSubmission).where(FeedbackSubmission.user_id == intruder_id)
        ).all()
        assert intruder_rows == []
