from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.routes import list_listable_backtest_sessions_page
from app.db import Base
from app.models import BacktestSession, BetaUser


def _session_factory():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def _seed_user(db) -> BetaUser:
    user = BetaUser(email="cursor@example.com", status="ACTIVE")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _seed_session(
    db,
    user_id: int,
    *,
    name: str,
    created_at: datetime,
    status: str = "COMPLETE",
) -> BacktestSession:
    session = BacktestSession(
        user_id=user_id,
        name=name,
        symbol="EURUSD",
        instrument="EUR/USD",
        timeframe="Imported",
        csv_path="/tmp/EURUSD_M1.csv",
        replay_ready=True,
        current_offset=10,
        end_offset=10,
        status=status,
        created_at=created_at,
        updated_at=created_at,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def test_session_summaries_page_supports_cursor_pagination():
    session_factory = _session_factory()
    with session_factory() as db:
        user = _seed_user(db)
        now = datetime.now(UTC)
        newest = _seed_session(db, user.id, name="Newest", created_at=now)
        middle = _seed_session(db, user.id, name="Middle", created_at=now - timedelta(minutes=1))
        oldest = _seed_session(db, user.id, name="Oldest", created_at=now - timedelta(minutes=2))

        first_page = list_listable_backtest_sessions_page(db, user.id, limit=2)

        assert [item.id for item in first_page.items] == [newest.id, middle.id]
        assert first_page.has_more is True
        assert first_page.next_cursor is not None

        second_page = list_listable_backtest_sessions_page(
            db,
            user.id,
            limit=2,
            cursor=first_page.next_cursor,
        )

        assert [item.id for item in second_page.items] == [oldest.id]
        assert second_page.has_more is False
        assert second_page.next_cursor is None


def test_session_summaries_page_filters_by_status():
    session_factory = _session_factory()
    with session_factory() as db:
        user = _seed_user(db)
        now = datetime.now(UTC)
        complete_session = _seed_session(
            db,
            user.id,
            name="Complete",
            created_at=now,
            status="COMPLETE",
        )
        _seed_session(
            db,
            user.id,
            name="Active",
            created_at=now - timedelta(minutes=1),
            status="ACTIVE",
        )

        page = list_listable_backtest_sessions_page(
            db,
            user.id,
            limit=10,
            status="COMPLETE",
        )

        assert [item.id for item in page.items] == [complete_session.id]
