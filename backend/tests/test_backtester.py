from pathlib import Path
from datetime import datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import BacktestSession, Execution, Order, Position, Trade
from app.schemas import (
    BacktestAdvanceRequest,
    BacktestCreate,
    BacktestSessionUpdate,
    OrderCreate,
    PositionUpdate,
)
from app.services.backtester import BacktestService
from app.services.datasets import DatasetCatalogService
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


def test_fixed_commission_is_deducted_from_closed_trade(tmp_path: Path):
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
            commission_mode="FIXED",
            commission_value=4,
        ),
    )
    state = service.advance(db, state.session.id, BacktestAdvanceRequest(steps=2))

    assert state.metrics.net_pnl == pytest.approx(36)
    assert state.trades[0].gross_pnl == pytest.approx(40)
    assert state.trades[0].commission_amount == pytest.approx(4)
    assert state.trades[0].realized_pnl == pytest.approx(36)
    assert state.trades[0].r_multiple == pytest.approx(1.8)


def test_percent_commission_is_deducted_from_closed_trade(tmp_path: Path):
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
            commission_mode="PERCENT",
            commission_value=0.1,
        ),
    )
    state = service.advance(db, state.session.id, BacktestAdvanceRequest(steps=2))

    assert state.trades[0].commission_amount == pytest.approx(2.04)
    assert state.trades[0].realized_pnl == pytest.approx(37.96)
    assert state.metrics.net_pnl == pytest.approx(37.96)


def test_commission_and_fee_are_deducted_separately(tmp_path: Path):
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
            commission_mode="FIXED",
            commission_value=4,
            fee_mode="FIXED",
            fee_value=1.5,
        ),
    )
    state = service.advance(db, state.session.id, BacktestAdvanceRequest(steps=2))

    assert state.trades[0].gross_pnl == pytest.approx(40)
    assert state.trades[0].commission_amount == pytest.approx(4)
    assert state.trades[0].fee_amount == pytest.approx(1.5)
    assert state.trades[0].realized_pnl == pytest.approx(34.5)
    assert state.metrics.net_pnl == pytest.approx(34.5)


def test_session_cost_defaults_apply_when_order_omits_costs(tmp_path: Path):
    service, db = make_service(tmp_path, DEFAULT_ROWS)
    state = service.create_session(
        db,
        BacktestCreate(
            initial_offset=0,
            default_commission_mode="FIXED",
            default_commission_value=3,
            default_fee_mode="PERCENT",
            default_fee_value=0.1,
        ),
    )
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

    assert state.orders[0].commission_mode == "FIXED"
    assert state.orders[0].commission_value == pytest.approx(3)
    assert state.orders[0].fee_mode == "PERCENT"
    assert state.orders[0].fee_value == pytest.approx(0.1)
    assert state.trades[0].commission_amount == pytest.approx(3)
    assert state.trades[0].fee_amount == pytest.approx(2.04)
    assert state.trades[0].realized_pnl == pytest.approx(34.96)


def test_pnl_multiplier_calibrates_session_pnl_without_changing_r(tmp_path: Path):
    service, db = make_service(tmp_path, DEFAULT_ROWS)
    state = service.create_session(
        db,
        BacktestCreate(initial_offset=0, currency="INR", pnl_multiplier=10),
    )
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

    assert state.session.currency == "INR"
    assert state.session.pnl_multiplier == pytest.approx(10)
    assert state.metrics.net_pnl == pytest.approx(400)
    assert state.trades[0].realized_pnl == pytest.approx(400)
    assert state.trades[0].r_multiple == pytest.approx(2)


def test_update_session_details(tmp_path: Path):
    service, db = make_service(tmp_path, DEFAULT_ROWS)
    state = service.create_session(db, BacktestCreate(name="Before", initial_offset=0))

    updated = service.update_session(
        db,
        state.session.id,
        BacktestSessionUpdate(
            name="After",
            strategy_name="Opening Range",
            currency="INR",
            timezone="Asia/Kolkata",
            pnl_multiplier=10,
            initial_balance=25000,
            status="COMPLETE",
        ),
    )

    assert updated.name == "After"
    assert updated.strategy_name == "Opening Range"
    assert updated.currency == "INR"
    assert updated.timezone == "Asia/Kolkata"
    assert updated.pnl_multiplier == pytest.approx(10)
    assert updated.initial_balance == pytest.approx(25000)
    assert updated.status == "COMPLETE"


def test_delete_session_cascades_replay_data(tmp_path: Path):
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
    session_id = state.session.id

    service.delete_session(db, session_id)

    assert db.get(BacktestSession, session_id) is None
    assert db.query(Position).filter(Position.session_id == session_id).count() == 0
    assert db.query(Order).filter(Order.session_id == session_id).count() == 0
    assert db.query(Execution).filter(Execution.session_id == session_id).count() == 0
    assert db.query(Trade).filter(Trade.session_id == session_id).count() == 0


def test_open_position_brackets_can_be_amended(tmp_path: Path):
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

    state = service.update_position(
        db,
        state.session.id,
        PositionUpdate(stop_loss=99, take_profit=105),
    )

    assert state.position is not None
    assert state.position.stop_loss == pytest.approx(99)
    assert state.position.take_profit == pytest.approx(105)
    assert state.trades[0].stop_loss == pytest.approx(99)
    assert state.trades[0].take_profit == pytest.approx(105)

    state = service.advance(db, state.session.id, BacktestAdvanceRequest(steps=2))

    assert state.position is not None
    assert state.position.side == "FLAT"
    assert state.metrics.net_pnl == pytest.approx(50)


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


def test_pending_entry_processes_bracket_on_fill_candle(tmp_path: Path):
    service, db = make_service(
        tmp_path,
        [
            ("2024-01-01 00:00:00", 100, 100, 100, 100, 1),
            ("2024-01-01 00:01:00", 100, 105, 97, 102, 1),
        ],
    )
    state = service.create_session(db, BacktestCreate(initial_offset=0))
    state = service.place_order(
        db,
        state.session.id,
        OrderCreate(
            side="BUY",
            order_type="STOP",
            quantity=10,
            stop_price=101,
            stop_loss=98,
            take_profit=102,
        ),
    )
    state = service.advance(db, state.session.id, BacktestAdvanceRequest(steps=1))

    assert state.position is not None
    assert state.position.side == "FLAT"
    assert state.orders[0].status == "FILLED"
    assert state.trades[0].status == "CLOSED"
    assert state.trades[0].exit_price == pytest.approx(98)
    assert state.metrics.net_pnl == pytest.approx(-30)


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


def test_risk_percent_sizing_uses_pnl_multiplier(tmp_path: Path):
    service, db = make_service(tmp_path, DEFAULT_ROWS)
    state = service.create_session(
        db,
        BacktestCreate(initial_offset=0, initial_balance=100_000, pnl_multiplier=10),
    )
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
    assert state.position.quantity == pytest.approx(50)


def test_risk_percent_base_can_use_initial_or_current_balance(tmp_path: Path):
    service, db = make_service(tmp_path, DEFAULT_ROWS)
    current_state = service.create_session(
        db,
        BacktestCreate(name="Current", initial_offset=0, initial_balance=100_000),
    )
    current_session = db.get(BacktestSession, current_state.session.id)
    assert current_session is not None
    current_session.realized_pnl = -50_000
    db.commit()

    current_state = service.place_order(
        db,
        current_state.session.id,
        OrderCreate(
            side="BUY",
            order_type="MARKET",
            risk_percent=1,
            risk_base="CURRENT_BALANCE",
            stop_loss=98,
        ),
    )

    initial_state = service.create_session(
        db,
        BacktestCreate(name="Initial", initial_offset=0, initial_balance=100_000),
    )
    initial_session = db.get(BacktestSession, initial_state.session.id)
    assert initial_session is not None
    initial_session.realized_pnl = -50_000
    db.commit()

    initial_state = service.place_order(
        db,
        initial_state.session.id,
        OrderCreate(
            side="BUY",
            order_type="MARKET",
            risk_percent=1,
            risk_base="INITIAL_BALANCE",
            stop_loss=98,
        ),
    )

    assert current_state.position is not None
    assert current_state.position.quantity == pytest.approx(250)
    assert initial_state.position is not None
    assert initial_state.position.quantity == pytest.approx(500)


def test_risk_percent_never_creates_negative_quantity(tmp_path: Path):
    service, db = make_service(tmp_path, DEFAULT_ROWS)
    state = service.create_session(db, BacktestCreate(initial_offset=0, initial_balance=100_000))
    session = db.get(BacktestSession, state.session.id)
    assert session is not None
    session.realized_pnl = -200_000
    db.commit()

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


def test_pending_risk_order_recalculates_corrupt_negative_quantity(tmp_path: Path):
    service, db = make_service(tmp_path, DEFAULT_ROWS)
    state = service.create_session(db, BacktestCreate(initial_offset=0, initial_balance=100_000))
    state = service.place_order(
        db,
        state.session.id,
        OrderCreate(
            side="BUY",
            order_type="STOP",
            risk_percent=1,
            stop_price=101,
            stop_loss=98,
        ),
    )
    order = db.query(Order).filter(Order.session_id == state.session.id).one()
    order.quantity = -abs(order.quantity or 0)
    db.commit()

    state = service.advance(db, state.session.id, BacktestAdvanceRequest(steps=1))

    assert state.position is not None
    assert state.position.side == "LONG"
    assert state.position.quantity == pytest.approx(1000 / 3)
    assert state.orders[0].quantity == pytest.approx(1000 / 3)


def test_negative_open_position_is_repaired_and_bracketed(tmp_path: Path):
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
            take_profit=110,
        ),
    )

    session_id = state.session.id
    position = db.query(Position).filter(Position.session_id == session_id).one()
    position.quantity = -10
    for order in db.query(Order).filter(Order.session_id == session_id).all():
        order.quantity = -abs(order.quantity or 0)
    for execution in db.query(Execution).filter(Execution.session_id == session_id).all():
        execution.quantity = -abs(execution.quantity)
        execution.position_quantity_after = -abs(execution.position_quantity_after)
    trade = db.query(Trade).filter(Trade.session_id == session_id, Trade.status == "OPEN").one()
    trade.quantity = -10
    trade.remaining_quantity = -10
    db.commit()

    state = service.advance(db, session_id, BacktestAdvanceRequest(steps=3))

    assert state.position is not None
    assert state.position.side == "FLAT"
    assert state.trades[0].status == "CLOSED"
    assert state.trades[0].exit_price == pytest.approx(98)


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


def test_session_respects_selected_date_window(tmp_path: Path):
    service, db = make_service(tmp_path, DEFAULT_ROWS)
    state = service.create_session(
        db,
        BacktestCreate(
            initial_offset=0,
            start_timestamp=datetime(2024, 1, 1, 0, 2),
            end_timestamp=datetime(2024, 1, 1, 0, 3),
        ),
    )

    assert state.session.start_offset == 2
    assert state.session.end_offset == 3
    assert state.session.current_offset == 2

    state = service.advance(db, state.session.id, BacktestAdvanceRequest(steps=5))

    assert state.session.current_offset == 3
    assert state.session.status == "COMPLETE"


def test_market_data_accepts_daily_date_only_csv(tmp_path: Path):
    csv_path = tmp_path / "daily.csv"
    csv_path.write_text(
        "Timestamp,Open,High,Low,Close,Volume\n"
        "2024-01-01,100,101,99,100.5,10\n",
        encoding="utf-8",
    )
    metadata = MarketDataService(csv_path, cache=False).get_metadata()

    assert metadata.rows == 1
    assert metadata.first_timestamp == datetime(2024, 1, 1)


def test_market_data_rejects_directory_csv_path(tmp_path: Path):
    csv_path = tmp_path / "EURUSD_M1.csv"
    csv_path.mkdir()
    service = MarketDataService(csv_path, cache=False)

    with pytest.raises(FileNotFoundError, match="CSV path is not a file"):
        service.validate_source()


def test_market_data_validate_source_rejects_missing_columns(tmp_path: Path):
    csv_path = tmp_path / "bad.csv"
    csv_path.write_text("Timestamp,Open,High,Low,Close\n2024-01-01,1,2,1,2\n", encoding="utf-8")
    service = MarketDataService(csv_path, cache=False)

    with pytest.raises(ValueError, match="Volume"):
        service.validate_source()


def test_default_session_uses_first_discovered_dataset(tmp_path: Path):
    datasets_root = tmp_path / "datasets"
    asset_dir = datasets_root / "GBP_USD"
    asset_dir.mkdir(parents=True)
    csv_path = asset_dir / "GBPUSD_M1.csv"
    csv_path.write_text(
        "Timestamp,Open,High,Low,Close,Volume\n"
        "2024-01-01 09:30:00,1.2,1.3,1.1,1.25,100\n",
        encoding="utf-8",
    )
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    catalog = DatasetCatalogService(datasets_root, session_factory)

    db = session_factory()
    service = BacktestService(dataset_catalog=catalog)
    try:
        state = service.create_session(db, BacktestCreate())
    finally:
        db.close()

    assert state.session.csv_path == str(csv_path)
    assert state.session.instrument == "GBP_USD"
    assert state.session.timeframe == "M1"
    assert state.session.symbol == "GBPUSD"
    assert state.session.name == "GBPUSD M1"
