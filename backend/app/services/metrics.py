import math
import os
from collections import defaultdict
from pathlib import Path

import pandas as pd
from sqlalchemy import asc, select
from sqlalchemy.orm import Session

from app.models import Trade
from app.schemas import (
    CalendarPoint,
    EquityPoint,
    MetricsResponse,
    SideBreakdown,
    StrategyPerformance,
)


def get_metrics(db: Session, session_id: int | None = None) -> MetricsResponse:
    query = select(Trade).where(Trade.status == "CLOSED").order_by(asc(Trade.exit_time))
    if session_id is not None:
        query = query.where(Trade.session_id == session_id)
    closed_trades = list(db.scalars(query).all())

    total_trades = len(closed_trades)
    pnl_values = [trade.realized_pnl for trade in closed_trades]
    net_pnl = float(sum(pnl_values))
    wins = [pnl for pnl in pnl_values if pnl > 0]
    losses = [pnl for pnl in pnl_values if pnl < 0]
    win_rate = len(wins) / total_trades if total_trades else 0.0
    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    profit_factor = gross_profit / gross_loss if gross_loss else None

    equity_curve = _equity_curve(closed_trades)
    r_values = [
        trade.r_multiple
        for trade in closed_trades
        if trade.r_multiple is not None and math.isfinite(trade.r_multiple)
    ]

    return MetricsResponse(
        net_pnl=net_pnl,
        win_rate=win_rate,
        total_trades=total_trades,
        profit_factor=profit_factor,
        max_drawdown=_max_drawdown([point.equity for point in equity_curve]),
        sharpe_ratio=_sharpe_ratio(closed_trades),
        average_r=(sum(r_values) / len(r_values) if r_values else None),
        best_trade=max(pnl_values) if pnl_values else None,
        worst_trade=min(pnl_values) if pnl_values else None,
        longest_win_streak=_longest_streak(pnl_values, winning=True),
        longest_loss_streak=_longest_streak(pnl_values, winning=False),
        equity_curve=equity_curve,
        strategy_performance=_strategy_performance(closed_trades),
        side_breakdown=_side_breakdown(closed_trades),
        calendar=_calendar(closed_trades),
    )


def _equity_curve(trades: list[Trade]) -> list[EquityPoint]:
    equity = []
    running = 0.0
    for trade in trades:
        running += trade.realized_pnl
        if trade.exit_time is not None:
            equity.append(EquityPoint(timestamp=trade.exit_time, equity=running))
    return equity


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


def _strategy_performance(trades: list[Trade]) -> list[StrategyPerformance]:
    groups: dict[str, list[Trade]] = defaultdict(list)
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


def _side_breakdown(trades: list[Trade]) -> list[SideBreakdown]:
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


def _calendar(trades: list[Trade]) -> list[CalendarPoint]:
    daily: dict[str, list[float]] = defaultdict(list)
    for trade in trades:
        if trade.exit_time is None:
            continue
        daily[trade.exit_time.date().isoformat()].append(trade.realized_pnl)
    return [
        CalendarPoint(date=date, pnl=sum(values), trades=len(values))
        for date, values in sorted(daily.items())
    ]


def _sharpe_ratio(trades: list[Trade]) -> float | None:
    returns = []
    timestamps = []
    for trade in trades:
        notional = trade.entry_price * trade.quantity
        if notional <= 0 or trade.exit_time is None:
            continue
        returns.append(trade.realized_pnl / notional)
        timestamps.append(trade.exit_time)

    if len(returns) < 2:
        return None

    series = pd.Series(returns, index=pd.to_datetime(timestamps)).dropna()
    series = series[series.map(math.isfinite)]
    if len(series) < 2:
        return None

    try:
        _prepare_quantstats_cache()
        import quantstats as qs

        value = qs.stats.sharpe(series, periods=252)
        return float(value) if pd.notna(value) else None
    except Exception:
        std = float(series.std())
        if std == 0:
            return None
        return float(series.mean() / std * math.sqrt(252))


def _prepare_quantstats_cache() -> None:
    cache_root = Path("/private/tmp/edgelab-cache")
    mpl_root = cache_root / "matplotlib"
    cache_root.mkdir(parents=True, exist_ok=True)
    mpl_root.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("XDG_CACHE_HOME", str(cache_root))
    os.environ.setdefault("MPLCONFIGDIR", str(mpl_root))
