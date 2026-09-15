"""Deterministic trade-to-footprint aggregation.

The normalized input contract is :class:`OrderFlowTrade`: a stable trade ID,
UTC-normalized exchange timestamp, positive finite price and size, and an
aggressor side.  ``ASK`` means a buyer-aggressor trade and ``BID`` means a
seller-aggressor trade.  Missing sides are retained as unknown volume instead
of being guessed.

Bars use epoch-aligned, half-open intervals (``[start, end)``).  Prices are
rounded to the nearest configured tick with ties rounded up.  Decimal values
are accumulated exactly; binary floating-point arithmetic is never used for
price levels or volume.
"""

from __future__ import annotations

from collections import OrderedDict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, localcontext
from enum import Enum
from threading import RLock
from typing import Any

_UTC = timezone.utc
_EPOCH = datetime(1970, 1, 1, tzinfo=_UTC)
_MICROSECONDS_PER_SECOND = 1_000_000
_MAX_DECIMAL_DIGITS = 38
_MIN_DECIMAL_ADJUSTED_EXPONENT = -18
_MAX_DECIMAL_ADJUSTED_EXPONENT = 18
_MAX_DURATION_MICROSECONDS = (
    timedelta.max.days * 86_400 * _MICROSECONDS_PER_SECOND
    + timedelta.max.seconds * _MICROSECONDS_PER_SECOND
    + timedelta.max.microseconds
)


class OrderFlowError(ValueError):
    """Base class for actionable order-flow input errors."""


class TradeValidationError(OrderFlowError):
    """A trade does not satisfy the normalized trade contract."""


class AggregationConfigError(OrderFlowError):
    """The requested bar aggregation configuration is invalid."""


class DuplicateTradeError(OrderFlowError):
    """The same trade ID was reused for different trade data."""


class RetentionError(OrderFlowError):
    """Requested data has already left the in-memory retention window."""


class AggressorSide(str, Enum):
    """The resting book side consumed by a trade."""

    BID = "bid"
    ASK = "ask"
    UNKNOWN = "unknown"


_SIDE_ALIASES = {
    "ask": AggressorSide.ASK,
    "buy": AggressorSide.ASK,
    "buyer": AggressorSide.ASK,
    "bid": AggressorSide.BID,
    "sell": AggressorSide.BID,
    "seller": AggressorSide.BID,
    "unknown": AggressorSide.UNKNOWN,
}


@dataclass(frozen=True, slots=True)
class OrderFlowTrade:
    """A normalized exchange trade accepted by the aggregation engine.

    ``timestamp`` accepts a :class:`datetime` or ISO-8601 string.  Naive
    datetimes are interpreted as UTC to match the application's UTC database
    convention.  ``price`` and ``size`` accept ``Decimal``, integer, float, or
    decimal string inputs and are normalized through their decimal text form.
    """

    trade_id: str
    timestamp: datetime
    price: Decimal
    size: Decimal
    aggressor_side: AggressorSide = AggressorSide.UNKNOWN

    def __post_init__(self) -> None:
        object.__setattr__(self, "trade_id", _normalize_trade_id(self.trade_id))
        object.__setattr__(
            self,
            "timestamp",
            _normalize_timestamp(self.timestamp, field_name="trade timestamp"),
        )
        object.__setattr__(
            self,
            "price",
            _normalize_positive_decimal(self.price, field_name="trade price"),
        )
        object.__setattr__(
            self,
            "size",
            _normalize_positive_decimal(self.size, field_name="trade size"),
        )
        object.__setattr__(
            self,
            "aggressor_side",
            _normalize_aggressor_side(self.aggressor_side),
        )

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> OrderFlowTrade:
        """Build a normalized trade from a transport/database mapping."""

        missing = [
            key
            for key in ("trade_id", "timestamp", "price", "size")
            if key not in value
        ]
        if missing:
            raise TradeValidationError(
                "trade mapping is missing required field(s): " + ", ".join(missing)
            )
        side = value.get("aggressor_side", value.get("side"))
        return cls(
            trade_id=value["trade_id"],
            timestamp=value["timestamp"],
            price=value["price"],
            size=value["size"],
            aggressor_side=side,
        )

    @property
    def side(self) -> AggressorSide:
        """Short alias useful at stream and persistence boundaries."""

        return self.aggressor_side


NormalizedTrade = OrderFlowTrade


@dataclass(frozen=True, slots=True)
class FootprintLevel:
    """Aggregated trade metrics for one tick-quantized price in a bar."""

    price: Decimal
    bid_volume: Decimal
    ask_volume: Decimal
    unknown_volume: Decimal
    total_volume: Decimal
    delta: Decimal
    trade_count: int
    average_trade_size: Decimal


PriceLevel = FootprintLevel


@dataclass(frozen=True, slots=True)
class FootprintBar:
    """One deterministic footprint bar with ascending price levels."""

    start: datetime
    end: datetime
    tick_size: Decimal
    levels: tuple[FootprintLevel, ...]
    bid_volume: Decimal
    ask_volume: Decimal
    unknown_volume: Decimal
    total_volume: Decimal
    delta: Decimal
    trade_count: int
    average_trade_size: Decimal

    @property
    def start_time(self) -> datetime:
        return self.start

    @property
    def end_time(self) -> datetime:
        return self.end

    @property
    def is_empty(self) -> bool:
        return self.trade_count == 0

    def level_at(self, price: Decimal | float | str) -> FootprintLevel | None:
        """Return the level containing ``price``, using this bar's tick rule."""

        normalized = _normalize_positive_decimal(price, field_name="level price")
        target = _quantize_price(normalized, self.tick_size)
        return next((level for level in self.levels if level.price == target), None)


class IngestStatus(str, Enum):
    ACCEPTED = "accepted"
    DUPLICATE = "duplicate"
    LATE = "late"


@dataclass(frozen=True, slots=True)
class IngestResult:
    """Outcome of one idempotent incremental ingestion attempt."""

    status: IngestStatus
    trade_id: str
    bar_start: datetime
    detail: str | None = None

    @property
    def accepted(self) -> bool:
        return self.status is IngestStatus.ACCEPTED


@dataclass(frozen=True, slots=True)
class AggregationStats:
    accepted_trades: int
    duplicate_trades: int
    late_trades: int
    active_bars: int
    retained_finalized_bars: int


@dataclass(slots=True)
class _ExactDecimalSum:
    """Context-independent sum for finite Decimal values."""

    coefficient: int = 0
    exponent: int = 0
    initialized: bool = False

    def add(self, value: Decimal) -> None:
        parts = value.as_tuple()
        coefficient = _digits_to_int(parts.digits)
        if parts.sign:
            coefficient = -coefficient
        exponent = int(parts.exponent)

        if not self.initialized:
            self.coefficient = coefficient
            self.exponent = exponent
            self.initialized = True
            return
        if exponent < self.exponent:
            self.coefficient *= 10 ** (self.exponent - exponent)
            self.exponent = exponent
        elif exponent > self.exponent:
            coefficient *= 10 ** (exponent - self.exponent)
        self.coefficient += coefficient

    def value(self) -> Decimal:
        if not self.initialized:
            return Decimal(0)
        return _decimal_from_coefficient(self.coefficient, self.exponent)


@dataclass(slots=True)
class _MutableLevel:
    bid_volume: _ExactDecimalSum = field(default_factory=_ExactDecimalSum)
    ask_volume: _ExactDecimalSum = field(default_factory=_ExactDecimalSum)
    unknown_volume: _ExactDecimalSum = field(default_factory=_ExactDecimalSum)
    total_volume: _ExactDecimalSum = field(default_factory=_ExactDecimalSum)
    trade_count: int = 0

    def add(self, trade: OrderFlowTrade) -> None:
        self.total_volume.add(trade.size)
        self.trade_count += 1
        if trade.aggressor_side is AggressorSide.ASK:
            self.ask_volume.add(trade.size)
        elif trade.aggressor_side is AggressorSide.BID:
            self.bid_volume.add(trade.size)
        else:
            self.unknown_volume.add(trade.size)

    def snapshot(self, price: Decimal) -> FootprintLevel:
        bid = self.bid_volume.value()
        ask = self.ask_volume.value()
        unknown = self.unknown_volume.value()
        total = self.total_volume.value()
        return FootprintLevel(
            price=price,
            bid_volume=bid,
            ask_volume=ask,
            unknown_volume=unknown,
            total_volume=total,
            delta=_exact_difference(ask, bid),
            trade_count=self.trade_count,
            average_trade_size=_average(total, self.trade_count),
        )


@dataclass(slots=True)
class _MutableBar:
    levels: dict[Decimal, _MutableLevel] = field(default_factory=dict)
    bid_volume: _ExactDecimalSum = field(default_factory=_ExactDecimalSum)
    ask_volume: _ExactDecimalSum = field(default_factory=_ExactDecimalSum)
    unknown_volume: _ExactDecimalSum = field(default_factory=_ExactDecimalSum)
    total_volume: _ExactDecimalSum = field(default_factory=_ExactDecimalSum)
    trade_count: int = 0

    def add(self, price: Decimal, trade: OrderFlowTrade) -> None:
        self.levels.setdefault(price, _MutableLevel()).add(trade)
        self.total_volume.add(trade.size)
        self.trade_count += 1
        if trade.aggressor_side is AggressorSide.ASK:
            self.ask_volume.add(trade.size)
        elif trade.aggressor_side is AggressorSide.BID:
            self.bid_volume.add(trade.size)
        else:
            self.unknown_volume.add(trade.size)

    def snapshot(
        self,
        *,
        start_microseconds: int,
        interval_microseconds: int,
        tick_size: Decimal,
    ) -> FootprintBar:
        start = _datetime_from_epoch_microseconds(start_microseconds)
        bid = self.bid_volume.value()
        ask = self.ask_volume.value()
        unknown = self.unknown_volume.value()
        total = self.total_volume.value()
        levels = tuple(
            self.levels[price].snapshot(price) for price in sorted(self.levels)
        )
        return FootprintBar(
            start=start,
            end=_datetime_from_epoch_microseconds(
                start_microseconds + interval_microseconds
            ),
            tick_size=tick_size,
            levels=levels,
            bid_volume=bid,
            ask_volume=ask,
            unknown_volume=unknown,
            total_volume=total,
            delta=_exact_difference(ask, bid),
            trade_count=self.trade_count,
            average_trade_size=_average(total, self.trade_count),
        )


class OrderFlowAggregator:
    """Incremental, event-time footprint aggregator.

    Out-of-order trades remain valid until :meth:`advance_watermark` finalizes
    their bar.  ``allowed_lateness`` delays that finalization.  Trades for an
    already finalized bar are returned with ``LATE`` status and never mutate
    aggregates.  Identical duplicate IDs are idempotent; conflicting duplicate
    IDs raise :class:`DuplicateTradeError`.

    Only ``max_finalized_bars`` completed bars are kept in memory.  Active bars
    are not evicted because doing so would change future aggregation results.
    Callers should advance the watermark as their source makes progress.
    """

    def __init__(
        self,
        *,
        interval: timedelta | Decimal | float | str,
        tick_size: Decimal | float | str,
        allowed_lateness: timedelta | Decimal | float | str = timedelta(0),
        max_finalized_bars: int = 1_024,
        max_materialized_bars: int = 100_000,
        emit_empty_bars: bool = False,
        start_time: datetime | str | None = None,
    ) -> None:
        self._interval_microseconds = _duration_microseconds(
            interval,
            field_name="bar interval",
            allow_zero=False,
        )
        self.interval = timedelta(microseconds=self._interval_microseconds)
        self.tick_size = _normalize_positive_decimal(
            tick_size,
            field_name="tick size",
            error_type=AggregationConfigError,
        )
        self._allowed_lateness_microseconds = _duration_microseconds(
            allowed_lateness,
            field_name="allowed lateness",
            allow_zero=True,
        )
        self.allowed_lateness = timedelta(
            microseconds=self._allowed_lateness_microseconds
        )
        if (
            isinstance(max_finalized_bars, bool)
            or not isinstance(max_finalized_bars, int)
            or max_finalized_bars < 0
        ):
            raise AggregationConfigError(
                "max_finalized_bars must be a non-negative integer"
            )
        if not isinstance(emit_empty_bars, bool):
            raise AggregationConfigError("emit_empty_bars must be a boolean")
        if (
            isinstance(max_materialized_bars, bool)
            or not isinstance(max_materialized_bars, int)
            or max_materialized_bars < 1
        ):
            raise AggregationConfigError(
                "max_materialized_bars must be a positive integer"
            )

        self.max_finalized_bars = max_finalized_bars
        self.max_materialized_bars = max_materialized_bars
        self.emit_empty_bars = emit_empty_bars
        self._empty_origin_microseconds: int | None = None
        if start_time is not None:
            normalized_start = _normalize_timestamp(
                start_time,
                field_name="start time",
                error_type=AggregationConfigError,
            )
            start_microseconds = _datetime_to_epoch_microseconds(normalized_start)
            if self._bar_start_microseconds(start_microseconds) != start_microseconds:
                raise AggregationConfigError(
                    "start time must fall exactly on a bar boundary"
                )
            self._empty_origin_microseconds = start_microseconds

        self._active: dict[int, _MutableBar] = {}
        self._finalized: OrderedDict[int, FootprintBar] = OrderedDict()
        self._trade_index: dict[str, tuple[OrderFlowTrade, int]] = {}
        self._trade_ids_by_bar: dict[int, set[str]] = {}
        self._watermark: datetime | None = None
        self._finalized_through_microseconds: int | None = None
        self._evicted_through_microseconds: int | None = None
        self._accepted_trades = 0
        self._duplicate_trades = 0
        self._late_trades = 0
        self._lock = RLock()

    @property
    def watermark(self) -> datetime | None:
        with self._lock:
            return self._watermark

    @property
    def retention_floor(self) -> datetime | None:
        """Earliest boundary that may still be queried, after an eviction."""

        with self._lock:
            if self._evicted_through_microseconds is None:
                return None
            return _datetime_from_epoch_microseconds(
                self._evicted_through_microseconds + self._interval_microseconds
            )

    @property
    def stats(self) -> AggregationStats:
        with self._lock:
            return AggregationStats(
                accepted_trades=self._accepted_trades,
                duplicate_trades=self._duplicate_trades,
                late_trades=self._late_trades,
                active_bars=len(self._active),
                retained_finalized_bars=len(self._finalized),
            )

    def ingest(self, trade: OrderFlowTrade | Mapping[str, Any]) -> IngestResult:
        """Normalize and aggregate one trade atomically."""

        normalized = normalize_trade(trade)
        timestamp_microseconds = _datetime_to_epoch_microseconds(normalized.timestamp)
        bar_start_microseconds = self._bar_start_microseconds(timestamp_microseconds)

        with self._lock:
            existing = self._trade_index.get(normalized.trade_id)
            if existing is not None:
                existing_trade, existing_bar = existing
                if existing_trade != normalized:
                    raise DuplicateTradeError(
                        f"trade_id {normalized.trade_id!r} was already ingested with "
                        "different timestamp, price, size, or aggressor side"
                    )
                self._duplicate_trades += 1
                return IngestResult(
                    status=IngestStatus.DUPLICATE,
                    trade_id=normalized.trade_id,
                    bar_start=_datetime_from_epoch_microseconds(existing_bar),
                    detail="identical trade_id already ingested",
                )

            if (
                self._finalized_through_microseconds is not None
                and bar_start_microseconds <= self._finalized_through_microseconds
            ):
                self._late_trades += 1
                return IngestResult(
                    status=IngestStatus.LATE,
                    trade_id=normalized.trade_id,
                    bar_start=_datetime_from_epoch_microseconds(bar_start_microseconds),
                    detail="trade belongs to a finalized bar",
                )

            price = _quantize_price(normalized.price, self.tick_size)
            self._active.setdefault(bar_start_microseconds, _MutableBar()).add(
                price,
                normalized,
            )
            self._trade_index[normalized.trade_id] = (
                normalized,
                bar_start_microseconds,
            )
            self._trade_ids_by_bar.setdefault(bar_start_microseconds, set()).add(
                normalized.trade_id
            )
            if self.emit_empty_bars:
                if self._empty_origin_microseconds is None:
                    self._empty_origin_microseconds = bar_start_microseconds
                else:
                    self._empty_origin_microseconds = min(
                        self._empty_origin_microseconds,
                        bar_start_microseconds,
                    )
            self._accepted_trades += 1
            return IngestResult(
                status=IngestStatus.ACCEPTED,
                trade_id=normalized.trade_id,
                bar_start=_datetime_from_epoch_microseconds(bar_start_microseconds),
            )

    def add_trade(self, trade: OrderFlowTrade | Mapping[str, Any]) -> IngestResult:
        """Alias for :meth:`ingest` used by batch and stream adapters."""

        return self.ingest(trade)

    def ingest_many(
        self,
        trades: Iterable[OrderFlowTrade | Mapping[str, Any]],
    ) -> tuple[IngestResult, ...]:
        return tuple(self.ingest(trade) for trade in trades)

    def advance_watermark(self, watermark: datetime | str) -> tuple[FootprintBar, ...]:
        """Finalize bars whose end plus allowed lateness is at the watermark.

        The watermark is monotonic.  Returned bars are chronological and may be
        persisted immediately; only the configured trailing subset remains in
        this object's finalized-bar retention window.
        """

        normalized_watermark = _normalize_timestamp(
            watermark,
            field_name="watermark",
            error_type=AggregationConfigError,
        )
        watermark_microseconds = _datetime_to_epoch_microseconds(normalized_watermark)

        with self._lock:
            if self._watermark is not None and normalized_watermark < self._watermark:
                raise AggregationConfigError(
                    "watermark cannot move backwards; pass a timestamp at or after "
                    f"{self._watermark.isoformat()}"
                )
            cutoff_microseconds = (
                watermark_microseconds - self._allowed_lateness_microseconds
            )
            last_finalizable = self._bar_start_microseconds(
                cutoff_microseconds - self._interval_microseconds
            )
            previous = self._finalized_through_microseconds
            if previous is not None and last_finalizable <= previous:
                self._watermark = normalized_watermark
                return ()

            if self.emit_empty_bars:
                if previous is None:
                    first = self._empty_origin_microseconds
                elif self._empty_origin_microseconds is None:
                    first = previous + self._interval_microseconds
                else:
                    first = max(
                        self._empty_origin_microseconds,
                        previous + self._interval_microseconds,
                    )
                if first is not None and previous is None:
                    first = self._bar_start_microseconds(first)
                if first is not None and first <= last_finalizable:
                    self._validate_materialized_bar_count(
                        first,
                        last_finalizable + self._interval_microseconds,
                        operation="watermark advance",
                    )
                starts = (
                    range(
                        first,
                        last_finalizable + self._interval_microseconds,
                        self._interval_microseconds,
                    )
                    if first is not None and first <= last_finalizable
                    else ()
                )
            else:
                starts = (
                    start
                    for start in sorted(self._active)
                    if (previous is None or start > previous)
                    and start <= last_finalizable
                )

            self._watermark = normalized_watermark
            completed: list[FootprintBar] = []
            for start in starts:
                mutable = self._active.pop(start, None)
                bar = (
                    self._empty_bar(start)
                    if mutable is None
                    else mutable.snapshot(
                        start_microseconds=start,
                        interval_microseconds=self._interval_microseconds,
                        tick_size=self.tick_size,
                    )
                )
                completed.append(bar)
                self._retain_finalized(start, bar)

            self._finalized_through_microseconds = last_finalizable
            return tuple(completed)

    def snapshot(
        self,
        *,
        start: datetime | str | None = None,
        end: datetime | str | None = None,
        include_empty: bool | None = None,
    ) -> tuple[FootprintBar, ...]:
        """Return retained finalized and active bars in chronological order.

        ``start`` and ``end`` are optional exact bar boundaries describing a
        half-open range.  Supplying both with ``include_empty=True`` also makes
        a no-trade range observable as empty footprint bars.
        """

        include_gaps = self.emit_empty_bars if include_empty is None else include_empty
        if not isinstance(include_gaps, bool):
            raise AggregationConfigError("include_empty must be a boolean")

        with self._lock:
            bars: dict[int, FootprintBar] = dict(self._finalized)
            bars.update(
                {
                    bar_start: mutable.snapshot(
                        start_microseconds=bar_start,
                        interval_microseconds=self._interval_microseconds,
                        tick_size=self.tick_size,
                    )
                    for bar_start, mutable in self._active.items()
                }
            )
            start_microseconds = self._range_boundary(start, "snapshot start")
            end_microseconds = self._range_boundary(end, "snapshot end")

            if start_microseconds is None:
                if not bars:
                    return ()
                start_microseconds = min(bars)
            if end_microseconds is None:
                if not bars:
                    return ()
                end_microseconds = max(bars) + self._interval_microseconds
            if end_microseconds < start_microseconds:
                raise AggregationConfigError(
                    "snapshot end must be at or after snapshot start"
                )
            if end_microseconds == start_microseconds:
                return ()
            if (
                self._evicted_through_microseconds is not None
                and start_microseconds <= self._evicted_through_microseconds
            ):
                raise RetentionError(
                    "snapshot start precedes the finalized-bar retention window; "
                    f"earliest available boundary is {self.retention_floor.isoformat()}"
                )

            if include_gaps:
                self._validate_materialized_bar_count(
                    start_microseconds,
                    end_microseconds,
                    operation="snapshot",
                )
                starts: Iterable[int] = range(
                    start_microseconds,
                    end_microseconds,
                    self._interval_microseconds,
                )
            else:
                starts = (
                    bar_start
                    for bar_start in sorted(bars)
                    if start_microseconds <= bar_start < end_microseconds
                )
            return tuple(
                bars[bar_start] if bar_start in bars else self._empty_bar(bar_start)
                for bar_start in starts
            )

    def _validate_materialized_bar_count(
        self,
        start_microseconds: int,
        end_microseconds: int,
        *,
        operation: str,
    ) -> None:
        count = max(
            0,
            (end_microseconds - start_microseconds) // self._interval_microseconds,
        )
        if count > self.max_materialized_bars:
            raise AggregationConfigError(
                f"{operation} would materialize {count} bars, exceeding "
                f"max_materialized_bars={self.max_materialized_bars}; request a "
                "smaller range or page the operation"
            )

    def bars(
        self,
        *,
        start: datetime | str | None = None,
        end: datetime | str | None = None,
        include_empty: bool | None = None,
    ) -> tuple[FootprintBar, ...]:
        """Alias for :meth:`snapshot`."""

        return self.snapshot(start=start, end=end, include_empty=include_empty)

    @property
    def finalized_bars(self) -> tuple[FootprintBar, ...]:
        with self._lock:
            return tuple(self._finalized.values())

    @property
    def active_bars(self) -> tuple[FootprintBar, ...]:
        with self._lock:
            return tuple(
                self._active[start].snapshot(
                    start_microseconds=start,
                    interval_microseconds=self._interval_microseconds,
                    tick_size=self.tick_size,
                )
                for start in sorted(self._active)
            )

    def _bar_start_microseconds(self, timestamp_microseconds: int) -> int:
        return (
            timestamp_microseconds // self._interval_microseconds
        ) * self._interval_microseconds

    def _range_boundary(
        self,
        value: datetime | str | None,
        field_name: str,
    ) -> int | None:
        if value is None:
            return None
        normalized = _normalize_timestamp(
            value,
            field_name=field_name,
            error_type=AggregationConfigError,
        )
        microseconds = _datetime_to_epoch_microseconds(normalized)
        if self._bar_start_microseconds(microseconds) != microseconds:
            raise AggregationConfigError(
                f"{field_name} must fall exactly on a bar boundary"
            )
        return microseconds

    def _empty_bar(self, start_microseconds: int) -> FootprintBar:
        start = _datetime_from_epoch_microseconds(start_microseconds)
        zero = Decimal(0)
        return FootprintBar(
            start=start,
            end=_datetime_from_epoch_microseconds(
                start_microseconds + self._interval_microseconds
            ),
            tick_size=self.tick_size,
            levels=(),
            bid_volume=zero,
            ask_volume=zero,
            unknown_volume=zero,
            total_volume=zero,
            delta=zero,
            trade_count=0,
            average_trade_size=zero,
        )

    def _retain_finalized(self, start: int, bar: FootprintBar) -> None:
        self._finalized[start] = bar
        while len(self._finalized) > self.max_finalized_bars:
            evicted_start, _ = self._finalized.popitem(last=False)
            self._evicted_through_microseconds = max(
                evicted_start,
                self._evicted_through_microseconds
                if self._evicted_through_microseconds is not None
                else evicted_start,
            )
            for trade_id in self._trade_ids_by_bar.pop(evicted_start, ()):
                indexed = self._trade_index.get(trade_id)
                if indexed is not None and indexed[1] == evicted_start:
                    del self._trade_index[trade_id]


FootprintAggregator = OrderFlowAggregator


def normalize_trade(
    trade: OrderFlowTrade | Mapping[str, Any],
) -> OrderFlowTrade:
    """Normalize an input trade while keeping the engine contract explicit."""

    if isinstance(trade, OrderFlowTrade):
        return trade
    if isinstance(trade, Mapping):
        return OrderFlowTrade.from_mapping(trade)
    raise TradeValidationError(
        "trade must be an OrderFlowTrade or a mapping containing trade_id, "
        "timestamp, price, and size"
    )


def aggregate_order_flow(
    trades: Iterable[OrderFlowTrade | Mapping[str, Any]],
    *,
    interval: timedelta | Decimal | float | str,
    tick_size: Decimal | float | str,
    start: datetime | str | None = None,
    end: datetime | str | None = None,
    include_empty: bool = False,
) -> tuple[FootprintBar, ...]:
    """Aggregate a finite trade collection with incremental-engine semantics."""

    aggregator = OrderFlowAggregator(interval=interval, tick_size=tick_size)
    aggregator.ingest_many(trades)
    return aggregator.snapshot(start=start, end=end, include_empty=include_empty)


aggregate_trades = aggregate_order_flow


def _normalize_trade_id(value: Any) -> str:
    if isinstance(value, bool) or value is None:
        raise TradeValidationError("trade_id must be a non-empty string or integer")
    if not isinstance(value, (str, int)):
        raise TradeValidationError("trade_id must be a non-empty string or integer")
    normalized = str(value).strip()
    if not normalized:
        raise TradeValidationError("trade_id must not be empty")
    return normalized


def _normalize_timestamp(
    value: datetime | str,
    *,
    field_name: str,
    error_type: type[OrderFlowError] = TradeValidationError,
) -> datetime:
    parsed: datetime
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            raise error_type(f"{field_name} must be a datetime or ISO-8601 string")
        if text.endswith(("Z", "z")):
            text = text[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError as exc:
            raise error_type(
                f"{field_name} must be a valid ISO-8601 timestamp; got {value!r}"
            ) from exc
    else:
        raise error_type(
            f"{field_name} must be a datetime or ISO-8601 string; "
            f"got {type(value).__name__}"
        )

    try:
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            return parsed.replace(tzinfo=_UTC)
        return parsed.astimezone(_UTC)
    except (OverflowError, ValueError) as exc:
        raise error_type(f"{field_name} cannot be normalized to UTC") from exc


def _normalize_aggressor_side(value: Any) -> AggressorSide:
    if value is None:
        return AggressorSide.UNKNOWN
    if isinstance(value, AggressorSide):
        return value
    if isinstance(value, str):
        normalized = _SIDE_ALIASES.get(value.strip().lower())
        if normalized is not None:
            return normalized
    raise TradeValidationError(
        "aggressor_side must be bid/sell, ask/buy, unknown, or None"
    )


def _normalize_positive_decimal(
    value: Any,
    *,
    field_name: str,
    error_type: type[OrderFlowError] = TradeValidationError,
) -> Decimal:
    if isinstance(value, bool) or value is None:
        raise error_type(f"{field_name} must be a positive finite decimal")
    try:
        normalized = (
            value if isinstance(value, Decimal) else Decimal(str(value).strip())
        )
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise error_type(
            f"{field_name} must be a positive finite decimal; got {value!r}"
        ) from exc
    if not normalized.is_finite() or normalized <= 0:
        raise error_type(
            f"{field_name} must be greater than zero and finite; got {value!r}"
        )
    digits = len(normalized.as_tuple().digits)
    adjusted_exponent = normalized.adjusted()
    if (
        digits > _MAX_DECIMAL_DIGITS
        or adjusted_exponent < _MIN_DECIMAL_ADJUSTED_EXPONENT
        or adjusted_exponent > _MAX_DECIMAL_ADJUSTED_EXPONENT
    ):
        raise error_type(
            f"{field_name} exceeds the supported decimal domain: at most "
            f"{_MAX_DECIMAL_DIGITS} significant digits and adjusted exponent "
            f"between {_MIN_DECIMAL_ADJUSTED_EXPONENT} and "
            f"{_MAX_DECIMAL_ADJUSTED_EXPONENT}; got {value!r}"
        )
    return normalized


def _duration_microseconds(
    value: timedelta | Decimal | float | str,
    *,
    field_name: str,
    allow_zero: bool,
) -> int:
    if isinstance(value, timedelta):
        microseconds = (
            value.days * 86_400 * _MICROSECONDS_PER_SECOND
            + value.seconds * _MICROSECONDS_PER_SECOND
            + value.microseconds
        )
    else:
        if isinstance(value, bool) or value is None:
            raise AggregationConfigError(
                f"{field_name} must be a finite number of seconds or timedelta"
            )
        try:
            seconds = (
                value if isinstance(value, Decimal) else Decimal(str(value).strip())
            )
        except (InvalidOperation, TypeError, ValueError) as exc:
            raise AggregationConfigError(
                f"{field_name} must be a finite number of seconds or timedelta"
            ) from exc
        if not seconds.is_finite():
            raise AggregationConfigError(f"{field_name} must be finite")
        invalid_sign = seconds < 0 if allow_zero else seconds <= 0
        if invalid_sign:
            qualifier = "non-negative" if allow_zero else "greater than zero"
            raise AggregationConfigError(f"{field_name} must be {qualifier}")
        max_seconds = Decimal(_MAX_DURATION_MICROSECONDS).scaleb(-6)
        if seconds > max_seconds:
            raise AggregationConfigError(f"{field_name} is too large")
        decimal_microseconds = seconds * _MICROSECONDS_PER_SECOND
        if decimal_microseconds != decimal_microseconds.to_integral_value():
            raise AggregationConfigError(
                f"{field_name} must resolve to a whole number of microseconds"
            )
        microseconds = int(decimal_microseconds)

    minimum = 0 if allow_zero else 1
    if microseconds < minimum:
        qualifier = "non-negative" if allow_zero else "greater than zero"
        raise AggregationConfigError(f"{field_name} must be {qualifier}")
    if microseconds > _MAX_DURATION_MICROSECONDS:
        raise AggregationConfigError(f"{field_name} is too large")
    return microseconds


def _datetime_to_epoch_microseconds(value: datetime) -> int:
    delta = value - _EPOCH
    return (
        delta.days * 86_400 * _MICROSECONDS_PER_SECOND
        + delta.seconds * _MICROSECONDS_PER_SECOND
        + delta.microseconds
    )


def _datetime_from_epoch_microseconds(value: int) -> datetime:
    try:
        return _EPOCH + timedelta(microseconds=value)
    except OverflowError as exc:
        raise AggregationConfigError(
            "timestamp and bar interval exceed Python's datetime range"
        ) from exc


def _quantize_price(price: Decimal, tick_size: Decimal) -> Decimal:
    price_numerator, price_denominator = price.as_integer_ratio()
    tick_numerator, tick_denominator = tick_size.as_integer_ratio()
    numerator = price_numerator * tick_denominator
    denominator = price_denominator * tick_numerator
    ticks, remainder = divmod(numerator, denominator)
    if remainder * 2 >= denominator:
        ticks += 1
    if ticks <= 0:
        raise TradeValidationError(
            f"trade price {price} quantizes to zero at tick size {tick_size}; "
            "provide a valid market price or smaller tick size"
        )

    tick_parts = tick_size.as_tuple()
    tick_coefficient = _digits_to_int(tick_parts.digits)
    return _decimal_from_coefficient(
        tick_coefficient * ticks,
        int(tick_parts.exponent),
    )


def _digits_to_int(digits: tuple[int, ...]) -> int:
    value = 0
    for digit in digits:
        value = value * 10 + digit
    return value


def _decimal_from_coefficient(coefficient: int, exponent: int) -> Decimal:
    sign = int(coefficient < 0)
    digits_text = str(abs(coefficient))
    digits = tuple(int(character) for character in digits_text)
    return Decimal((sign, digits, exponent))


def _exact_difference(left: Decimal, right: Decimal) -> Decimal:
    total = _ExactDecimalSum()
    total.add(left)
    total.add(right.copy_negate())
    return total.value()


def _average(total: Decimal, count: int) -> Decimal:
    if count == 0:
        return Decimal(0)
    with localcontext() as context:
        context.prec = max(34, len(total.as_tuple().digits) + 16)
        return total / Decimal(count)


__all__ = [
    "AggregationConfigError",
    "AggregationStats",
    "AggressorSide",
    "DuplicateTradeError",
    "FootprintAggregator",
    "FootprintBar",
    "FootprintLevel",
    "IngestResult",
    "IngestStatus",
    "NormalizedTrade",
    "OrderFlowAggregator",
    "OrderFlowError",
    "OrderFlowTrade",
    "PriceLevel",
    "RetentionError",
    "TradeValidationError",
    "aggregate_order_flow",
    "aggregate_trades",
    "normalize_trade",
]
