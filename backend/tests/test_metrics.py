from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import BacktestSession, BetaUser, Trade
from app.services.metrics import get_metrics


def make_model_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    return session_factory()


def seed_user(db) -> int:
    user = BetaUser(
        email="metrics@edgelab.local",
        name="Metrics Tester",
        provider="google",
        status="APPROVED",
    )
    db.add(user)
    db.commit()
    return user.id


def test_metrics_include_results_overview_aggregates():
    db = make_model_session()
    user_id = seed_user(db)
    session = BacktestSession(
        user_id=user_id,
        name="Metrics Session",
        symbol="EURUSD",
        current_offset=0,
    )
    db.add(session)
    db.flush()

    db.add_all(
        [
            Trade(
                user_id=user_id,
                session_id=session.id,
                status="CLOSED",
                side="LONG",
                entry_time=datetime(2024, 1, 1, 9, 0, tzinfo=timezone.utc),
                entry_price=100.0,
                quantity=1.0,
                remaining_quantity=0.0,
                exit_time=datetime(2024, 1, 1, 9, 30, tzinfo=timezone.utc),
                exit_price=125.0,
                gross_pnl=25.0,
                realized_pnl=20.0,
                r_multiple=2.0,
                commission_amount=3.0,
                fee_amount=2.0,
            ),
            Trade(
                user_id=user_id,
                session_id=session.id,
                status="CLOSED",
                side="LONG",
                entry_time=datetime(2024, 1, 1, 10, 0, tzinfo=timezone.utc),
                entry_price=110.0,
                quantity=1.0,
                remaining_quantity=0.0,
                exit_time=datetime(2024, 1, 1, 11, 0, tzinfo=timezone.utc),
                exit_price=110.0,
                gross_pnl=0.0,
                realized_pnl=0.0,
                r_multiple=0.0,
            ),
            Trade(
                user_id=user_id,
                session_id=session.id,
                status="CLOSED",
                side="SHORT",
                entry_time=datetime(2024, 1, 1, 12, 0, tzinfo=timezone.utc),
                entry_price=95.0,
                quantity=1.0,
                remaining_quantity=0.0,
                exit_time=datetime(2024, 1, 1, 13, 30, tzinfo=timezone.utc),
                exit_price=99.0,
                gross_pnl=-4.0,
                realized_pnl=-5.0,
                r_multiple=-0.5,
                commission_amount=0.5,
                fee_amount=0.5,
            ),
            Trade(
                user_id=user_id,
                session_id=session.id,
                status="OPEN",
                side="LONG",
                entry_time=datetime(2024, 1, 1, 14, 0, tzinfo=timezone.utc),
                entry_price=101.0,
                quantity=1.0,
                remaining_quantity=1.0,
                realized_pnl=0.0,
            ),
        ]
    )
    db.commit()

    try:
        metrics = get_metrics(db, user_id, session.id)
    finally:
        db.close()

    assert metrics.net_pnl == 15.0
    assert metrics.total_trades == 3
    assert metrics.winning_trades == 1
    assert metrics.breakeven_trades == 1
    assert metrics.open_trades == 1
    assert metrics.gross_pnl == 21.0
    assert metrics.total_commissions == 3.5
    assert metrics.total_fees == 2.5
    assert metrics.profit_factor == 4.0
    assert metrics.max_drawdown == 5.0
    assert metrics.recovery_factor == 3.0
    assert metrics.average_hold_minutes == 60.0
    assert metrics.average_win == 20.0
    assert metrics.average_loss == -5.0
    assert metrics.expectancy == 5.0
    assert metrics.average_r == 0.5
    assert metrics.best_trade == 20.0
    assert metrics.worst_trade == -5.0
    assert len(metrics.side_breakdown) == 2
    assert metrics.side_breakdown[0].side == "LONG"
    assert metrics.side_breakdown[0].trades == 2
    assert metrics.side_breakdown[0].net_pnl == 20.0
    assert metrics.side_breakdown[1].side == "SHORT"
    assert metrics.side_breakdown[1].trades == 1
    assert metrics.side_breakdown[1].net_pnl == -5.0
