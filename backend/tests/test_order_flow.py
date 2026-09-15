from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from app.services.order_flow import (
    AggregationConfigError,
    AggressorSide,
    DuplicateTradeError,
    IngestStatus,
    OrderFlowAggregator,
    OrderFlowTrade,
    RetentionError,
    TradeValidationError,
    aggregate_order_flow,
)


@pytest.fixture
def bar_start() -> datetime:
    return datetime(2026, 9, 15, 10, 0, tzinfo=timezone.utc)


@pytest.fixture
def make_trade(bar_start):
    def factory(
        trade_id: str,
        *,
        seconds: int = 0,
        price: str = "100.00",
        size: str = "1",
        side: str | None = "ask",
    ) -> OrderFlowTrade:
        return OrderFlowTrade(
            trade_id=trade_id,
            timestamp=bar_start + timedelta(seconds=seconds),
            price=price,
            size=size,
            aggressor_side=side,
        )

    return factory


@pytest.fixture
def imbalance_ready_trades(make_trade) -> tuple[OrderFlowTrade, ...]:
    """Adjacent ticks with deliberate 3x+ diagonal ask/bid relationships."""

    return (
        make_trade("bid-100", price="100.00", size="4", side="bid"),
        make_trade("ask-100", price="100.00", size="1", side="ask"),
        make_trade("bid-10025", price="100.25", size="2", side="bid"),
        make_trade("ask-10025", price="100.25", size="12", side="ask"),
        make_trade("bid-10050", price="100.50", size="1", side="bid"),
        make_trade("ask-10050", price="100.50", size="15", side="ask"),
    )


def test_trade_contract_normalizes_utc_decimals_and_side_aliases():
    trade = OrderFlowTrade(
        trade_id=42,
        timestamp="2026-09-15T15:30:00+05:30",
        price=100.25,
        size="2.500",
        aggressor_side="buy",
    )

    assert trade.trade_id == "42"
    assert trade.timestamp == datetime(2026, 9, 15, 10, 0, tzinfo=timezone.utc)
    assert trade.price == Decimal("100.25")
    assert trade.size == Decimal("2.500")
    assert trade.side is AggressorSide.ASK

    unknown = OrderFlowTrade(
        "unknown",
        datetime(2026, 9, 15),  # noqa: DTZ001 - verifies documented UTC default.
        "1",
        "1",
        None,
    )
    assert unknown.timestamp.tzinfo is timezone.utc
    assert unknown.side is AggressorSide.UNKNOWN


def test_batch_aggregation_is_decimal_safe_and_preserves_unknown_volume(
    make_trade,
):
    ask = make_trade("ask", seconds=40, price="100.24", size="2.0", side="ask")
    trades = (
        ask,
        make_trade("unknown", seconds=20, price="100.50", size="3", side=None),
        make_trade("bid", seconds=5, price="100.26", size="1.0", side="bid"),
        ask,
    )

    bars = aggregate_order_flow(trades, interval=60, tick_size="0.25")

    assert len(bars) == 1
    bar = bars[0]
    assert tuple(level.price for level in bar.levels) == (
        Decimal("100.25"),
        Decimal("100.50"),
    )
    first = bar.level_at("100.25")
    assert first is not None
    assert first.bid_volume == Decimal("1.0")
    assert first.ask_volume == Decimal("2.0")
    assert first.unknown_volume == 0
    assert first.total_volume == Decimal("3.0")
    assert first.delta == Decimal("1.0")
    assert first.trade_count == 2
    assert first.average_trade_size == Decimal("1.5")

    assert bar.bid_volume == Decimal("1.0")
    assert bar.ask_volume == Decimal("2.0")
    assert bar.unknown_volume == Decimal(3)
    assert bar.total_volume == Decimal("6.0")
    assert bar.delta == Decimal("1.0")
    assert bar.trade_count == 3
    assert bar.average_trade_size == Decimal("2.0")


def test_fractional_tick_quantization_uses_half_up_without_float_drift(
    bar_start,
):
    trades = (
        OrderFlowTrade("low", bar_start, "1.23474", "0.1", "sell"),
        OrderFlowTrade("tie", bar_start, "1.23475", "0.2", "buyer"),
        OrderFlowTrade("high", bar_start, "1.23501", "0.3", "ask"),
    )

    bar = aggregate_order_flow(trades, interval=60, tick_size="0.0005")[0]

    assert tuple(level.price for level in bar.levels) == (
        Decimal("1.2345"),
        Decimal("1.2350"),
    )
    assert bar.levels[0].total_volume == Decimal("0.1")
    assert bar.levels[1].total_volume == Decimal("0.5")
    assert bar.total_volume == Decimal("0.6")


def test_exact_bar_boundaries_and_explicit_empty_bars(bar_start, make_trade):
    bars = aggregate_order_flow(
        (
            make_trade("end-minus", seconds=59, size="2"),
            make_trade("boundary", seconds=60, size="3", side="bid"),
        ),
        interval=timedelta(minutes=1),
        tick_size="0.25",
        start=bar_start,
        end=bar_start + timedelta(minutes=3),
        include_empty=True,
    )

    assert [bar.start for bar in bars] == [
        bar_start,
        bar_start + timedelta(minutes=1),
        bar_start + timedelta(minutes=2),
    ]
    assert [bar.total_volume for bar in bars] == [
        Decimal(2),
        Decimal(3),
        Decimal(0),
    ]
    assert bars[-1].is_empty

    empty = aggregate_order_flow(
        (),
        interval=60,
        tick_size="0.25",
        start=bar_start,
        end=bar_start + timedelta(minutes=2),
        include_empty=True,
    )
    assert len(empty) == 2
    assert all(bar.is_empty for bar in empty)


def test_batch_and_incremental_results_match_for_out_of_order_input(make_trade):
    chronological = (
        make_trade("a", seconds=2, price="99.99", size="0.1", side="bid"),
        make_trade("b", seconds=61, price="100.24", size="0.2", side="ask"),
        make_trade("c", seconds=119, price="100.26", size="0.3", side=None),
        make_trade("d", seconds=121, price="100.51", size="0.4", side="sell"),
    )
    expected = aggregate_order_flow(
        chronological,
        interval=60,
        tick_size="0.25",
    )
    aggregator = OrderFlowAggregator(interval=60, tick_size="0.25")

    outcomes = aggregator.ingest_many(
        (chronological[3], chronological[1], chronological[0], chronological[2])
    )

    assert all(outcome.status is IngestStatus.ACCEPTED for outcome in outcomes)
    assert aggregator.snapshot() == expected


def test_duplicate_ids_are_idempotent_but_conflicts_are_rejected(make_trade):
    aggregator = OrderFlowAggregator(interval=60, tick_size="0.25")
    original = make_trade("same", price="100", size="2")

    assert aggregator.ingest(original).status is IngestStatus.ACCEPTED
    assert aggregator.ingest(original).status is IngestStatus.DUPLICATE
    assert aggregator.snapshot()[0].trade_count == 1

    with pytest.raises(DuplicateTradeError, match="already ingested with different"):
        aggregator.ingest(make_trade("same", price="100", size="3"))


def test_allowed_lateness_accepts_open_bar_then_rejects_finalized_bar(
    bar_start,
    make_trade,
):
    aggregator = OrderFlowAggregator(
        interval=60,
        tick_size="0.25",
        allowed_lateness=30,
        emit_empty_bars=True,
        start_time=bar_start,
    )
    aggregator.ingest(make_trade("first", seconds=10, size="1"))

    assert aggregator.advance_watermark(bar_start + timedelta(seconds=89)) == ()
    assert (
        aggregator.ingest(
            make_trade("out-of-order", seconds=5, size="2", side="bid")
        ).status
        is IngestStatus.ACCEPTED
    )

    completed = aggregator.advance_watermark(bar_start + timedelta(seconds=90))
    assert len(completed) == 1
    assert completed[0].total_volume == Decimal(3)

    late = aggregator.ingest(make_trade("too-late", seconds=59, size="10"))
    assert late.status is IngestStatus.LATE
    assert aggregator.finalized_bars[0].total_volume == Decimal(3)
    assert aggregator.stats.late_trades == 1


def test_empty_watermark_never_emits_before_configured_origin(bar_start):
    aggregator = OrderFlowAggregator(
        interval=60,
        tick_size="0.25",
        emit_empty_bars=True,
        start_time=bar_start,
    )

    assert aggregator.advance_watermark(bar_start - timedelta(hours=1)) == ()
    completed = aggregator.advance_watermark(bar_start + timedelta(minutes=2))

    assert [bar.start for bar in completed] == [
        bar_start,
        bar_start + timedelta(minutes=1),
    ]


def test_empty_watermark_materialization_budget_is_enforced(bar_start):
    aggregator = OrderFlowAggregator(
        interval=60,
        tick_size="0.25",
        emit_empty_bars=True,
        start_time=bar_start,
        max_materialized_bars=2,
    )

    assert len(aggregator.advance_watermark(bar_start + timedelta(minutes=2))) == 2
    with pytest.raises(AggregationConfigError, match="max_materialized_bars=2"):
        OrderFlowAggregator(
            interval=60,
            tick_size="0.25",
            emit_empty_bars=True,
            start_time=bar_start,
            max_materialized_bars=2,
        ).advance_watermark(bar_start + timedelta(minutes=3))


def test_empty_snapshot_materialization_budget_is_enforced(bar_start):
    aggregator = OrderFlowAggregator(
        interval=60,
        tick_size="0.25",
        max_materialized_bars=2,
    )

    assert len(
        aggregator.snapshot(
            start=bar_start,
            end=bar_start + timedelta(minutes=2),
            include_empty=True,
        )
    ) == 2
    with pytest.raises(AggregationConfigError, match="max_materialized_bars=2"):
        aggregator.snapshot(
            start=bar_start,
            end=bar_start + timedelta(minutes=3),
            include_empty=True,
        )


def test_finalized_retention_is_bounded_and_old_ranges_are_not_fabricated(
    bar_start,
    make_trade,
):
    aggregator = OrderFlowAggregator(
        interval=60,
        tick_size="0.25",
        emit_empty_bars=True,
        start_time=bar_start,
        max_finalized_bars=2,
    )
    aggregator.ingest(make_trade("first", seconds=1))

    completed = aggregator.advance_watermark(bar_start + timedelta(minutes=5))

    assert len(completed) == 5
    assert [bar.start for bar in aggregator.finalized_bars] == [
        bar_start + timedelta(minutes=3),
        bar_start + timedelta(minutes=4),
    ]
    assert aggregator.retention_floor == bar_start + timedelta(minutes=3)
    assert aggregator.stats.retained_finalized_bars == 2
    assert aggregator.ingest(make_trade("old", seconds=1)).status is IngestStatus.LATE
    with pytest.raises(RetentionError, match="retention window"):
        aggregator.snapshot(
            start=bar_start,
            end=bar_start + timedelta(minutes=5),
            include_empty=True,
        )


def test_imbalance_fixture_exposes_adjacent_bid_ask_metrics(
    imbalance_ready_trades,
):
    bar = aggregate_order_flow(
        imbalance_ready_trades,
        interval=60,
        tick_size="0.25",
    )[0]

    assert tuple(level.price for level in bar.levels) == (
        Decimal("100.00"),
        Decimal("100.25"),
        Decimal("100.50"),
    )
    low, middle, high = bar.levels
    assert middle.ask_volume / low.bid_volume == Decimal(3)
    assert high.ask_volume > middle.bid_volume * 7
    assert (low.bid_volume, low.ask_volume) == (Decimal(4), Decimal(1))
    assert (middle.bid_volume, middle.ask_volume) == (
        Decimal(2),
        Decimal(12),
    )


@pytest.mark.parametrize(
    ("kwargs", "message"),
    (
        ({"interval": 0, "tick_size": "0.25"}, "bar interval"),
        ({"interval": 60, "tick_size": "0"}, "tick size"),
        ({"interval": 60, "tick_size": "NaN"}, "tick size"),
        (
            {"interval": "0.0000001", "tick_size": "0.25"},
            "whole number of microseconds",
        ),
        (
            {"interval": "1e1000000", "tick_size": "0.25"},
            "bar interval is too large",
        ),
        (
            {"interval": "-1e1000000", "tick_size": "0.25"},
            "bar interval must be greater than zero",
        ),
        (
            {
                "interval": 60,
                "tick_size": "0.25",
                "allowed_lateness": "1e1000000",
            },
            "allowed lateness is too large",
        ),
        (
            {
                "interval": 60,
                "tick_size": "0.25",
                "allowed_lateness": "-1e1000000",
            },
            "allowed lateness must be non-negative",
        ),
        (
            {"interval": 60, "tick_size": "0.25", "max_finalized_bars": -1},
            "max_finalized_bars",
        ),
        (
            {"interval": 60, "tick_size": "0.25", "max_materialized_bars": 0},
            "max_materialized_bars",
        ),
    ),
)
def test_invalid_aggregation_configuration_has_actionable_errors(kwargs, message):
    with pytest.raises(AggregationConfigError, match=message):
        OrderFlowAggregator(**kwargs)


@pytest.mark.parametrize(
    ("kwargs", "message"),
    (
        (
            {
                "trade_id": "bad-time",
                "timestamp": "not-a-timestamp",
                "price": "1",
                "size": "1",
            },
            "valid ISO-8601",
        ),
        (
            {
                "trade_id": "bad-price",
                "timestamp": "2026-09-15T10:00:00Z",
                "price": "Infinity",
                "size": "1",
            },
            "trade price",
        ),
        (
            {
                "trade_id": "bad-size",
                "timestamp": "2026-09-15T10:00:00Z",
                "price": "1",
                "size": "0",
            },
            "trade size",
        ),
        (
            {
                "trade_id": "",
                "timestamp": "2026-09-15T10:00:00Z",
                "price": "1",
                "size": "1",
            },
            "trade_id",
        ),
        (
            {
                "trade_id": "bad-side",
                "timestamp": "2026-09-15T10:00:00Z",
                "price": "1",
                "size": "1",
                "aggressor_side": "middle",
            },
            "aggressor_side",
        ),
    ),
)
def test_invalid_trades_have_actionable_errors(kwargs, message):
    with pytest.raises(TradeValidationError, match=message):
        OrderFlowTrade(**kwargs)


@pytest.mark.parametrize(
    ("field", "value"),
    (
        ("price", "1e1000000"),
        ("price", "1e-1000000"),
        ("price", "123456789012345678901234567890123456789"),
        ("size", "1e1000000"),
        ("size", "1e-1000000"),
        ("size", "123456789012345678901234567890123456789"),
    ),
)
def test_trade_decimals_reject_unsafe_precision_and_exponents(
    bar_start,
    field,
    value,
):
    payload = {
        "trade_id": f"unsafe-{field}-{value}",
        "timestamp": bar_start,
        "price": "100.25",
        "size": "1",
        "aggressor_side": "ask",
    }
    payload[field] = value

    with pytest.raises(TradeValidationError, match="supported decimal domain"):
        OrderFlowTrade(**payload)


def test_watermark_must_be_monotonic(bar_start):
    aggregator = OrderFlowAggregator(interval=60, tick_size="0.25")
    aggregator.advance_watermark(bar_start)

    with pytest.raises(AggregationConfigError, match="cannot move backwards"):
        aggregator.advance_watermark(bar_start - timedelta(microseconds=1))


def test_representative_high_volume_batch_remains_exact(bar_start):
    trade_count = 50_000
    prices = ("100.00", "100.25", "100.50", "100.75")
    trades = (
        OrderFlowTrade(
            trade_id=f"bulk-{index}",
            timestamp=bar_start + timedelta(microseconds=index % 60_000_000),
            price=prices[index % len(prices)],
            size="0.01",
            aggressor_side="ask" if index % 2 == 0 else "bid",
        )
        for index in range(trade_count)
    )

    bar = aggregate_order_flow(trades, interval=60, tick_size="0.25")[0]

    assert bar.trade_count == trade_count
    assert bar.total_volume == Decimal("500.00")
    assert bar.ask_volume == Decimal("250.00")
    assert bar.bid_volume == Decimal("250.00")
    assert bar.delta == Decimal("0.00")
    assert bar.average_trade_size == Decimal("0.01")
    assert [level.trade_count for level in bar.levels] == [12_500] * 4
