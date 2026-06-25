from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.api import routes
from app.schemas import TradePage
from tests.test_health_routes import current_user, make_model_session, seed_user
from app.models import BacktestSession, Trade


def _seed_trade_fixture():
    db = make_model_session()
    user_id = seed_user(db)
    session = BacktestSession(
        user_id=user_id,
        name="Trade cursor session",
        symbol="EURUSD",
        timeframe="Imported",
        csv_path="/tmp/EURUSD_M1.csv",
        replay_ready=True,
        current_offset=0,
        end_offset=0,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    now = datetime.now(UTC)
    trades = []
    for index in range(3):
        trade = Trade(
            user_id=user_id,
            session_id=session.id,
            status="CLOSED",
            side="LONG",
            entry_time=now - timedelta(minutes=index),
            entry_offset=index,
            entry_price=100.0 + index,
            quantity=1.0,
            remaining_quantity=0.0,
            exit_time=now - timedelta(minutes=index) + timedelta(minutes=1),
            exit_offset=index + 1,
            exit_price=101.0 + index,
            gross_pnl=10.0,
            realized_pnl=10.0,
            r_multiple=1.0,
        )
        db.add(trade)
        trades.append(trade)
    db.commit()
    for trade in trades:
        db.refresh(trade)
    return db, user_id, trades


def test_trade_page_supports_cursor_pagination():
    db, user_id, trades = _seed_trade_fixture()
    try:
        first_page = routes.get_trades_page(
            session_id=None,
            offset=0,
            limit=2,
            db=db,
            current_user=current_user(user_id),
        )

        assert isinstance(first_page, TradePage)
        assert [item.id for item in first_page.items] == [trades[0].id, trades[1].id]
        assert first_page.has_more is True
        assert first_page.next_cursor is not None

        second_page = routes.get_trades_page(
            session_id=None,
            cursor=first_page.next_cursor,
            offset=0,
            limit=2,
            db=db,
            current_user=current_user(user_id),
        )

        assert [item.id for item in second_page.items] == [trades[2].id]
        assert second_page.has_more is False
        assert second_page.next_cursor is None
    finally:
        db.close()
