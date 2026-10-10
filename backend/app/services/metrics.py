import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from typing import NamedTuple

from sqlalchemy import asc, func, select
from sqlalchemy.orm import Session

from app.models import Trade
from app.schemas import (
    CalendarPoint,
    EquityPoint,
    MetricsCurvesResponse,
    MetricsResponse,
    MetricsSummaryResponse,
    SideBreakdown,
    StrategyPerformance,
)


class MetricsTradeRow(NamedTuple):
    realized_pnl: float
    entry_time: datetime
    exit_time: datetime | None
    entry_price: float
    quantity: float
    r_multiple: float | None
    gross_pnl: float | None
    commission_amount: float | None
    fee_amount: float | None
    strategy_name: str | None
    side: str


@dataclass(frozen=True)
class MetricsTradeSet:
    closed_trades: list[MetricsTradeRow | Trade]
    open_trades: int


def get_metrics_summary(
    db: Session,
    user_id: int,
    session_id: int | None = None,
) -> MetricsSummaryResponse:
    trade_set = _load_metrics_trade_set(db, user_id, session_id)
    return _build_metrics_summary(trade_set.closed_trades, trade_set.open_trades)


def get_metrics_curves(
    db: Session,
    user_id: int,
    session_id: int | None = None,
) -> MetricsCurvesResponse:
    trade_set = _load_metrics_trade_set(db, user_id, session_id)
    return _build_metrics_curves(trade_set.closed_trades)


def get_metrics(db: Session, user_id: int, session_id: int | None = None) -> MetricsResponse:
    trade_set = _load_metrics_trade_set(db, user_id, session_id)
    summary = _build_metrics_summary(trade_set.closed_trades, trade_set.open_trades)
    curves = _build_metrics_curves(trade_set.closed_trades)
    return MetricsResponse(**summary.model_dump(), **curves.model_dump())


def _load_metrics_trade_set(
    db: Session,
    user_id: int,
    session_id: int | None = None,
) -> MetricsTradeSet:
    query = (
        select(
            Trade.realized_pnl, Trade.entry_time, Trade.exit_time,
            Trade.entry_price, Trade.quantity, Trade.r_multiple, Trade.gross_pnl,
            Trade.commission_amount, Trade.fee_amount, Trade.strategy_name, Trade.side,
        )
        .where(
            Trade.user_id == user_id,
            Trade.status == "CLOSED",
        )
        .order_by(asc(Trade.exit_time))
    )
    open_trade_query = select(func.count()).select_from(Trade).where(
        Trade.user_id == user_id,
        Trade.status == "OPEN",
    )
    if session_id is not None:
        query = query.where(Trade.session_id == session_id)
        open_trade_query = open_trade_query.where(Trade.session_id == session_id)
    # Metrics never need notes, screenshots, order settings or ORM identity tracking.
    closed_trades = [MetricsTradeRow(*row) for row in db.execute(query)]
    open_trades = int(db.scalar(open_trade_query) or 0)
    return MetricsTradeSet(closed_trades=closed_trades, open_trades=open_trades)


def _build_metrics_summary(
    closed_trades: list[MetricsTradeRow | Trade],
    open_trades: int,
) -> MetricsSummaryResponse:
    total_trades = len(closed_trades)
    pnl_values = [trade.realized_pnl for trade in closed_trades]
    net_pnl = float(sum(pnl_values))
    wins = [pnl for pnl in pnl_values if pnl > 0]
    losses = [pnl for pnl in pnl_values if pnl < 0]
    breakeven_trades = sum(1 for pnl in pnl_values if pnl == 0)
    win_rate = len(wins) / total_trades if total_trades else 0.0
    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    profit_factor = gross_profit / gross_loss if gross_loss else None
    gross_pnl = sum(_trade_gross_pnl(trade) for trade in closed_trades)
    total_commissions = sum(float(trade.commission_amount or 0.0) for trade in closed_trades)
    total_fees = sum(float(trade.fee_amount or 0.0) for trade in closed_trades)

    # Summary consumers need only the drawdown scalar, not one Pydantic
    # EquityPoint per trade (the curves endpoint constructs those separately).
    running_equity = 0.0
    peak_equity = 0.0
    max_drawdown = 0.0
    for trade in closed_trades:
        running_equity += trade.realized_pnl
        if trade.exit_time is not None:
            peak_equity = max(peak_equity, running_equity)
            max_drawdown = max(max_drawdown, peak_equity - running_equity)
    r_values = [
        trade.r_multiple
        for trade in closed_trades
        if trade.r_multiple is not None and math.isfinite(trade.r_multiple)
    ]
    hold_values = [
        hold_minutes
        for hold_minutes in (_hold_minutes(trade) for trade in closed_trades)
        if hold_minutes is not None and math.isfinite(hold_minutes)
    ]

    return MetricsSummaryResponse(
        net_pnl=net_pnl,
        win_rate=win_rate,
        total_trades=total_trades,
        winning_trades=len(wins),
        breakeven_trades=breakeven_trades,
        open_trades=open_trades,
        profit_factor=profit_factor,
        gross_pnl=gross_pnl,
        total_commissions=total_commissions,
        total_fees=total_fees,
        max_drawdown=max_drawdown,
        recovery_factor=(net_pnl / max_drawdown if max_drawdown > 0 else None),
        sharpe_ratio=_sharpe_ratio(closed_trades),
        average_r=(sum(r_values) / len(r_values) if r_values else None),
        average_hold_minutes=_average(hold_values),
        average_win=_average(wins),
        average_loss=_average(losses),
        expectancy=(net_pnl / total_trades if total_trades else None),
        best_trade=max(pnl_values) if pnl_values else None,
        worst_trade=min(pnl_values) if pnl_values else None,
        longest_win_streak=_longest_streak(pnl_values, winning=True),
        longest_loss_streak=_longest_streak(pnl_values, winning=False),
    )


def _build_metrics_curves(closed_trades: list[MetricsTradeRow | Trade]) -> MetricsCurvesResponse:
    return MetricsCurvesResponse(
        equity_curve=_equity_curve(closed_trades),
        strategy_performance=_strategy_performance(closed_trades),
        side_breakdown=_side_breakdown(closed_trades),
        calendar=_calendar(closed_trades),
    )


def _equity_curve(trades: list[MetricsTradeRow | Trade]) -> list[EquityPoint]:
    equity = []
    running = 0.0
    for trade in trades:
        running += trade.realized_pnl
        if trade.exit_time is not None:
            equity.append(EquityPoint(timestamp=trade.exit_time, equity=running))
    return equity


def _average(values: list[float]) -> float | None:
    if not values:
        return None
    return float(sum(values) / len(values))


def _hold_minutes(trade: Trade) -> float | None:
    if trade.exit_time is None:
        return None
    hold_minutes = (trade.exit_time - trade.entry_time).total_seconds() / 60
    if not math.isfinite(hold_minutes) or hold_minutes < 0:
        return None
    return float(hold_minutes)


def _max_drawdown(equity_values: list[float]) -> float:
    peak = 0.0
    worst = 0.0
    for value in equity_values:
        peak = max(peak, value)
        worst = min(worst, value - peak)
    return abs(worst)


def _longest_streak(pnl_values: list[float], winning: bool) -> int:
    longest = 0
    current = 0
    for pnl in pnl_values:
        hit = pnl > 0 if winning else pnl < 0
        current = current + 1 if hit else 0
        longest = max(longest, current)
    return longest


def _trade_gross_pnl(trade: Trade) -> float:
    gross_pnl = trade.gross_pnl
    if gross_pnl is not None and math.isfinite(gross_pnl):
        return float(gross_pnl)
    return float(trade.realized_pnl + (trade.commission_amount or 0.0) + (trade.fee_amount or 0.0))


def _strategy_performance(trades: list[MetricsTradeRow | Trade]) -> list[StrategyPerformance]:
    groups: dict[str, list[MetricsTradeRow | Trade]] = defaultdict(list)
    for trade in trades:
        groups[trade.strategy_name or "Unassigned"].append(trade)

    rows = []
    for strategy_name, strategy_trades in sorted(groups.items()):
        pnl_values = [trade.realized_pnl for trade in strategy_trades]
        r_values = [
            trade.r_multiple
            for trade in strategy_trades
            if trade.r_multiple is not None and math.isfinite(trade.r_multiple)
        ]
        rows.append(
            StrategyPerformance(
                strategy_name=strategy_name,
                trades=len(strategy_trades),
                net_pnl=sum(pnl_values),
                win_rate=sum(1 for pnl in pnl_values if pnl > 0) / len(strategy_trades),
                average_r=(sum(r_values) / len(r_values) if r_values else None),
            )
        )
    return rows


def _side_breakdown(trades: list[MetricsTradeRow | Trade]) -> list[SideBreakdown]:
    rows = []
    for side in ("LONG", "SHORT"):
        side_trades = [trade for trade in trades if trade.side == side]
        if not side_trades:
            rows.append(SideBreakdown(side=side, trades=0, net_pnl=0.0, win_rate=0.0))
            continue
        pnl_values = [trade.realized_pnl for trade in side_trades]
        rows.append(
            SideBreakdown(
                side=side,
                trades=len(side_trades),
                net_pnl=sum(pnl_values),
                win_rate=sum(1 for pnl in pnl_values if pnl > 0) / len(side_trades),
            )
        )
    return rows


def _calendar(trades: list[MetricsTradeRow | Trade]) -> list[CalendarPoint]:
    daily: dict[str, list[float]] = defaultdict(list)
    for trade in trades:
        if trade.exit_time is None:
            continue
        daily[trade.exit_time.date().isoformat()].append(trade.realized_pnl)
    return [
        CalendarPoint(date=date, pnl=sum(values), trades=len(values))
        for date, values in sorted(daily.items())
    ]


def _sharpe_ratio(trades: list[MetricsTradeRow | Trade]) -> float | None:
    returns = []
    for trade in trades:
        notional = trade.entry_price * trade.quantity
        if notional <= 0 or trade.exit_time is None:
            continue
        trade_return = trade.realized_pnl / notional
        if math.isfinite(trade_return):
            returns.append(trade_return)

    if len(returns) < 2:
        return None

    average_return = sum(returns) / len(returns)
    variance = sum((value - average_return) ** 2 for value in returns) / (len(returns) - 1)
    if variance <= 0:
        return None

    standard_deviation = math.sqrt(variance)
    if standard_deviation == 0:
        return None

    return float(average_return / standard_deviation * math.sqrt(252))
