from datetime import datetime, timezone

from sqlalchemy import asc, create_engine, event, select
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import BacktestSession, BetaUser, Trade
from app.services.metrics import get_metrics, get_metrics_curves, get_metrics_summary


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


def test_metrics_summary_and_curves_split_payload():
    db = make_model_session()
    user_id = seed_user(db)
    session = BacktestSession(
        user_id=user_id,
        name="Metrics Split Session",
        symbol="GBPUSD",
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
                entry_time=datetime(2024, 1, 2, 9, 0, tzinfo=timezone.utc),
                entry_price=100.0,
                quantity=1.0,
                remaining_quantity=0.0,
                exit_time=datetime(2024, 1, 2, 9, 30, tzinfo=timezone.utc),
                exit_price=105.0,
                realized_pnl=5.0,
                r_multiple=1.0,
                strategy_name="Breakout",
            ),
            Trade(
                user_id=user_id,
                session_id=session.id,
                status="CLOSED",
                side="SHORT",
                entry_time=datetime(2024, 1, 2, 10, 0, tzinfo=timezone.utc),
                entry_price=105.0,
                quantity=1.0,
                remaining_quantity=0.0,
                exit_time=datetime(2024, 1, 2, 10, 20, tzinfo=timezone.utc),
                exit_price=107.0,
                realized_pnl=-2.0,
                r_multiple=-0.5,
                strategy_name="Fade",
            ),
        ]
    )
    db.commit()

    try:
        summary = get_metrics_summary(db, user_id, session.id)
        curves = get_metrics_curves(db, user_id, session.id)
        metrics = get_metrics(db, user_id, session.id)
    finally:
        db.close()

    assert summary.total_trades == 2
    assert summary.net_pnl == 3.0
    assert len(curves.equity_curve) == 2
    assert [row.strategy_name for row in curves.strategy_performance] == ["Breakout", "Fade"]
    assert metrics.model_dump() == {**summary.model_dump(), **curves.model_dump()}


def test_metric_projection_matches_owned_results_without_loading_trade_notes():
    from app.services.metrics import _build_metrics_curves, _build_metrics_summary

    db = make_model_session()
    user_id = seed_user(db)
    other = BetaUser(email="other-metrics@edgelab.local", name="Other", provider="google", status="APPROVED")
    db.add(other)
    db.flush()
    sessions = [
        BacktestSession(user_id=owner, name=f"Metrics {index}", symbol="ES", current_offset=0)
        for index, owner in enumerate([user_id, user_id, other.id])
    ]
    db.add_all(sessions)
    db.flush()
    session_id = sessions[0].id
    for index, session in enumerate(sessions):
        for offset, pnl in enumerate([30.0, -15.0, 0.0, 20.0]):
            db.add(Trade(
                user_id=session.user_id, session_id=session.id, status="CLOSED",
                side="LONG" if offset % 2 else "SHORT",
                entry_time=datetime(2026, 1, offset + 1, 9),
                exit_time=datetime(2026, 1, offset + 1, 10),
                entry_price=100, quantity=2, remaining_quantity=0,
                realized_pnl=pnl + index * 1000, gross_pnl=None,
                commission_amount=1.25, fee_amount=0.75, r_multiple=pnl / 10,
                strategy_name="Range" if offset % 2 else None,
                notes="Private notes " * 4000, screenshot_url="https://example.test/private.png",
            ))
        db.add(Trade(
            user_id=session.user_id, session_id=session.id, status="OPEN", side="LONG",
            entry_time=datetime(2026, 1, 5, 9), entry_price=100, quantity=1,
            remaining_quantity=1, realized_pnl=0,
        ))
    db.commit()
    references = {}
    for scope in (None, session_id):
        query = select(Trade).where(Trade.user_id == user_id, Trade.status == "CLOSED").order_by(asc(Trade.exit_time))
        if scope is not None:
            query = query.where(Trade.session_id == scope)
        trades = list(db.scalars(query))
        references[scope] = (
            _build_metrics_summary(trades, 2 if scope is None else 1),
            _build_metrics_curves(trades),
        )
    db.expunge_all()
    statements = []
    def capture(_connection, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)
    event.listen(db.get_bind(), "before_cursor_execute", capture)
    try:
        for scope, (summary, curves) in references.items():
            assert get_metrics_summary(db, user_id, scope) == summary
            assert get_metrics_curves(db, user_id, scope) == curves
            assert get_metrics(db, user_id, scope).model_dump() == {**summary.model_dump(), **curves.model_dump()}
        assert not any(isinstance(row, Trade) for row in db.identity_map.values())
        assert statements and all("trades.notes" not in query and "trades.screenshot_url" not in query for query in statements)
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", capture)
        db.close()


def test_summary_drawdown_preserves_missing_exit_and_loss_from_zero_semantics():
    from app.services.metrics import MetricsTradeRow, _build_metrics_summary, _equity_curve, _max_drawdown

    timestamp = datetime(2026, 1, 1, 10)
    for values in (
        [(30, None), (-10, timestamp), (-30, timestamp)],
        [(-10, timestamp), (20, timestamp), (-5, timestamp)],
        [(100, None)],
        [],
    ):
        rows = [MetricsTradeRow(pnl, datetime(2026, 1, 1, 9), exit_time, 100, 1, None, None, 0, 0, None, "LONG") for pnl, exit_time in values]
        expected = _max_drawdown([point.equity for point in _equity_curve(rows)])
        assert _build_metrics_summary(rows, 0).max_drawdown == expected
