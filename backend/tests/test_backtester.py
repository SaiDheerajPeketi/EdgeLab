from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.schemas import BacktestAdvanceRequest, BacktestCreate, OrderCreate
from app.services.backtester import BacktestService
from app.services.market_data import MarketDataService


def make_service(tmp_path: Path, rows: list[tuple[str, float, float, float, float, int]]):
    csv_path = tmp_path / "sample.csv"
    csv_path.write_text(
        "Timestamp,Open,High,Low,Close,Volume\n"
        + "\n".join(
            f"{timestamp},{open_},{high},{low},{close},{volume}"
            for timestamp, open_, high, low, close, volume in rows
        )
        + "\n",
        encoding="utf-8",
    )
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    return BacktestService(MarketDataService(csv_path, cache=True)), session_factory()


DEFAULT_ROWS = [
    ("2024-01-01 00:00:00", 100, 100, 100, 100, 1),
    ("2024-01-01 00:01:00", 100, 103, 101, 102, 1),
    ("2024-01-01 00:02:00", 102, 106, 101, 105, 1),
    ("2024-01-01 00:03:00", 105, 105, 96, 97, 1),
    ("2024-01-01 00:04:00", 97, 99, 94, 95, 1),
    ("2024-01-01 00:05:00", 95, 99, 93, 96, 1),
]


def test_long_market_order_closes_at_take_profit(tmp_path: Path):
    service, db = make_service(tmp_path, DEFAULT_ROWS)
    state = service.create_session(db, BacktestCreate(initial_offset=0))
    state = service.place_order(
        db,
        state.session.id,
        OrderCreate(
            side="BUY",
            order_type="MARKET",
            quantity=10,
            stop_loss=98,
            take_profit=104,
        ),
    )
    state = service.advance(db, state.session.id, BacktestAdvanceRequest(steps=2))

    assert state.position is not None
    assert state.position.side == "FLAT"
    assert state.metrics.total_trades == 1
    assert state.metrics.net_pnl == pytest.approx(40)
    assert state.trades[0].r_multiple == pytest.approx(2)


def test_short_market_order_uses_short_pnl(tmp_path: Path):
    service, db = make_service(tmp_path, DEFAULT_ROWS)
    state = service.create_session(db, BacktestCreate(initial_offset=0))
    state = service.place_order(
        db,
        state.session.id,
        OrderCreate(
            side="SELL",
            order_type="MARKET",
            quantity=10,
            stop_loss=102,
            take_profit=96,
        ),
    )
    state = service.advance(db, state.session.id, BacktestAdvanceRequest(steps=1))

    assert state.position is not None
    assert state.position.side == "FLAT"
    assert state.metrics.net_pnl == pytest.approx(-20)


def test_same_candle_stop_and_target_fills_stop_first(tmp_path: Path):
    service, db = make_service(tmp_path, DEFAULT_ROWS)
    state = service.create_session(db, BacktestCreate(initial_offset=4))
    state = service.place_order(
        db,
        state.session.id,
        OrderCreate(
            side="BUY",
            order_type="MARKET",
            quantity=10,
            stop_loss=94,
            take_profit=98,
        ),
    )
    state = service.advance(db, state.session.id, BacktestAdvanceRequest(steps=1))

    assert state.metrics.net_pnl == pytest.approx(-10)
    assert state.trades[0].exit_price == pytest.approx(94)


def test_limit_and_stop_orders_fill_on_advanced_candle(tmp_path: Path):
    service, db = make_service(tmp_path, DEFAULT_ROWS)
    state = service.create_session(db, BacktestCreate(initial_offset=0))
    state = service.place_order(
        db,
        state.session.id,
        OrderCreate(side="BUY", order_type="LIMIT", quantity=5, limit_price=99),
    )
    assert state.orders[0].status == "PENDING"

    state = service.advance(db, state.session.id, BacktestAdvanceRequest(steps=3))

    assert state.orders[0].status == "FILLED"
    assert state.orders[0].filled_price == pytest.approx(99)
    assert state.position is not None
    assert state.position.side == "LONG"


def test_partial_exit_reduces_position(tmp_path: Path):
    service, db = make_service(tmp_path, DEFAULT_ROWS)
    state = service.create_session(db, BacktestCreate(initial_offset=0))
    state = service.place_order(
        db,
        state.session.id,
        OrderCreate(side="BUY", order_type="MARKET", quantity=10),
    )
    state = service.advance(db, state.session.id, BacktestAdvanceRequest(steps=1))
    state = service.place_order(
        db,
        state.session.id,
        OrderCreate(side="SELL", order_type="MARKET", quantity=4, reduce_only=True),
    )

    assert state.position is not None
    assert state.position.quantity == pytest.approx(6)
    assert state.trades[0].remaining_quantity == pytest.approx(6)
    assert state.trades[0].realized_pnl == pytest.approx(8)


def test_risk_percent_sizes_order_from_stop_distance(tmp_path: Path):
    service, db = make_service(tmp_path, DEFAULT_ROWS)
    state = service.create_session(db, BacktestCreate(initial_offset=0, initial_balance=100_000))
    state = service.place_order(
        db,
        state.session.id,
        OrderCreate(
            side="BUY",
            order_type="MARKET",
            risk_percent=1,
            stop_loss=98,
        ),
    )

    assert state.position is not None
    assert state.position.quantity == pytest.approx(500)


def test_breakeven_trigger_moves_stop_and_exits_flat(tmp_path: Path):
    service, db = make_service(tmp_path, DEFAULT_ROWS)
    state = service.create_session(db, BacktestCreate(initial_offset=0))
    state = service.place_order(
        db,
        state.session.id,
        OrderCreate(
            side="BUY",
            order_type="MARKET",
            quantity=10,
            stop_loss=98,
            breakeven_trigger_r=1,
        ),
    )
    state = service.advance(db, state.session.id, BacktestAdvanceRequest(steps=1))
    assert state.position is not None
    assert state.position.stop_loss == pytest.approx(100)
    state = service.advance(db, state.session.id, BacktestAdvanceRequest(steps=2))

    assert state.position is not None
    assert state.position.side == "FLAT"
    assert state.metrics.net_pnl == pytest.approx(0)
