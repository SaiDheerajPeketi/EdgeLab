from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import (
    BacktestSession,
    BacktestSessionSummary,
    BetaUser,
    Trade,
    UserDashboardSummary,
)
from app.services.dashboard_summaries import (
    load_user_dashboard_summary,
    refresh_user_dashboard_summary,
)
from app.services.session_summaries import (
    load_session_summary_aggregates,
    refresh_session_summary,
    refresh_user_session_summaries,
)


def _session_factory():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def _seed_user(db, email: str = "trader@example.com") -> BetaUser:
    user = BetaUser(email=email, status="ACTIVE")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _seed_session(
    db,
    user_id: int,
    *,
    name: str,
    current_offset: int = 10,
) -> BacktestSession:
    session = BacktestSession(
        user_id=user_id,
        name=name,
        symbol="EURUSD",
        instrument="EUR/USD",
        timeframe="M1",
        csv_path="/tmp/EURUSD_M1.csv",
        current_offset=current_offset,
        end_offset=current_offset,
        replay_ready=True,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def _seed_closed_trade(
    db,
    user_id: int,
    session_id: int,
    *,
    realized_pnl: float,
    r_multiple: float | None,
    entry_time: datetime,
) -> Trade:
    trade = Trade(
        user_id=user_id,
        session_id=session_id,
        status="CLOSED",
        side="LONG",
        entry_time=entry_time,
        entry_offset=0,
        entry_price=100.0,
        quantity=1.0,
        remaining_quantity=0.0,
        exit_time=entry_time + timedelta(minutes=5),
        exit_offset=5,
        exit_price=101.0,
        gross_pnl=realized_pnl,
        realized_pnl=realized_pnl,
        r_multiple=r_multiple,
    )
    db.add(trade)
    db.commit()
    db.refresh(trade)
    return trade


def test_refresh_session_summary_persists_trade_aggregate():
    session_factory = _session_factory()
    with session_factory() as db:
        user = _seed_user(db)
        session = _seed_session(db, user.id, name="Replay A")
        now = datetime.now(UTC)
        _seed_closed_trade(
            db,
            user.id,
            session.id,
            realized_pnl=120.0,
            r_multiple=1.2,
            entry_time=now,
        )
        _seed_closed_trade(
            db,
            user.id,
            session.id,
            realized_pnl=-45.0,
            r_multiple=-0.45,
            entry_time=now + timedelta(hours=1),
        )
        _seed_closed_trade(
            db,
            user.id,
            session.id,
            realized_pnl=0.0,
            r_multiple=None,
            entry_time=now + timedelta(hours=2),
        )

        summary = refresh_session_summary(db, user.id, session.id)
        db.commit()
        db.refresh(summary)

        assert summary.closed_trades == 3
        assert summary.winning_trades == 1
        assert summary.breakeven_trades == 1
        assert summary.net_pnl == 75.0
        assert summary.gross_profit == 120.0
        assert summary.gross_loss == 45.0
        assert summary.r_sum == 0.75
        assert summary.r_samples == 2


def test_load_session_summary_aggregates_falls_back_for_missing_rows():
    session_factory = _session_factory()
    with session_factory() as db:
        user = _seed_user(db)
        refreshed_session = _seed_session(db, user.id, name="Replay A")
        fallback_session = _seed_session(db, user.id, name="Replay B")
        now = datetime.now(UTC)

        _seed_closed_trade(
            db,
            user.id,
            refreshed_session.id,
            realized_pnl=80.0,
            r_multiple=0.8,
            entry_time=now,
        )
        _seed_closed_trade(
            db,
            user.id,
            fallback_session.id,
            realized_pnl=55.0,
            r_multiple=0.55,
            entry_time=now + timedelta(hours=1),
        )
        refresh_session_summary(db, user.id, refreshed_session.id)
        db.commit()

        aggregates = load_session_summary_aggregates(
            db,
            user.id,
            [refreshed_session.id, fallback_session.id],
        )

        assert aggregates[refreshed_session.id].closed_trades == 1
        assert aggregates[refreshed_session.id].net_pnl == 80.0
        assert aggregates[fallback_session.id].closed_trades == 1
        assert aggregates[fallback_session.id].net_pnl == 55.0
        assert aggregates[fallback_session.id].average_r == 0.55


def test_refresh_user_session_summaries_backfills_empty_sessions():
    session_factory = _session_factory()
    with session_factory() as db:
        user = _seed_user(db)
        populated_session = _seed_session(db, user.id, name="Replay A")
        empty_session = _seed_session(db, user.id, name="Replay B")
        _seed_closed_trade(
            db,
            user.id,
            populated_session.id,
            realized_pnl=25.0,
            r_multiple=0.25,
            entry_time=datetime.now(UTC),
        )

        touched = refresh_user_session_summaries(db, user.id)
        db.commit()

        summaries = db.scalars(
            select(BacktestSessionSummary)
            .where(BacktestSessionSummary.user_id == user.id)
            .order_by(BacktestSessionSummary.session_id)
        ).all()

        assert touched == 2
        assert [summary.session_id for summary in summaries] == [
            populated_session.id,
            empty_session.id,
        ]
        assert summaries[0].closed_trades == 1
        assert summaries[0].net_pnl == 25.0
        assert summaries[1].closed_trades == 0
        assert summaries[1].net_pnl == 0.0


def test_refresh_user_dashboard_summary_persists_metrics_summary():
    session_factory = _session_factory()
    with session_factory() as db:
        user = _seed_user(db)
        session = _seed_session(db, user.id, name="Replay A")
        now = datetime.now(UTC)
        _seed_closed_trade(
            db,
            user.id,
            session.id,
            realized_pnl=30.0,
            r_multiple=1.5,
            entry_time=now,
        )
        _seed_closed_trade(
            db,
            user.id,
            session.id,
            realized_pnl=-10.0,
            r_multiple=-0.5,
            entry_time=now + timedelta(hours=1),
        )

        refresh_user_dashboard_summary(db, user.id)
        db.commit()

        stored = db.scalar(
            select(UserDashboardSummary).where(UserDashboardSummary.user_id == user.id)
        )
        assert stored is not None
        assert stored.total_trades == 2
        assert stored.net_pnl == 20.0
        assert stored.winning_trades == 1

        loaded = load_user_dashboard_summary(db, user.id)
        assert loaded.total_trades == 2
        assert loaded.net_pnl == 20.0
        assert loaded.average_r == 0.5
