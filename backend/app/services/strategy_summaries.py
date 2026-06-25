from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.models import Trade
from app.schemas import (
    BacktestSessionRead,
    StrategySummary,
    StrategySummaryAggregate,
    StrategySummarySession,
)

DEFAULT_STRATEGY_NAME = "London Continuation"


def build_strategy_summaries(
    db: Session,
    user_id: int,
    sessions: Sequence[BacktestSessionRead],
) -> list[StrategySummary]:
    if not sessions:
        return []

    aggregates_by_session = _load_session_aggregates(
        db,
        user_id,
        [session.id for session in sessions],
    )
    groups: dict[str, list[StrategySummarySession]] = defaultdict(list)

    for session in sessions:
        groups[_session_strategy_name(session)].append(
            StrategySummarySession(
                session=session,
                aggregate=aggregates_by_session.get(session.id, StrategySummaryAggregate()),
            )
        )

    summaries = []
    for name, strategy_sessions in groups.items():
        strategy_sessions.sort(
            key=lambda row: (row.session.created_at, row.session.id),
            reverse=True,
        )
        summaries.append(
            StrategySummary(
                name=name,
                aggregate=_combine_aggregates(
                    [row.aggregate for row in strategy_sessions]
                ),
                sessions=strategy_sessions,
            )
        )

    summaries.sort(key=lambda row: (-row.aggregate.closed_trades, row.name.lower()))
    return summaries


def _load_session_aggregates(
    db: Session,
    user_id: int,
    session_ids: list[int],
) -> dict[int, StrategySummaryAggregate]:
    if not session_ids:
        return {}

    query = (
        select(
            Trade.session_id.label("session_id"),
            func.count(Trade.id).label("closed_trades"),
            func.sum(case((Trade.realized_pnl > 0, 1), else_=0)).label("winning_trades"),
            func.coalesce(func.sum(Trade.realized_pnl), 0.0).label("net_pnl"),
            func.coalesce(
                func.sum(case((Trade.realized_pnl > 0, Trade.realized_pnl), else_=0.0)),
                0.0,
            ).label("gross_profit"),
            func.coalesce(
                func.sum(case((Trade.realized_pnl < 0, -Trade.realized_pnl), else_=0.0)),
                0.0,
            ).label("gross_loss"),
            func.coalesce(
                func.sum(case((Trade.r_multiple.is_not(None), Trade.r_multiple), else_=0.0)),
                0.0,
            ).label("r_sum"),
            func.sum(case((Trade.r_multiple.is_not(None), 1), else_=0)).label("r_samples"),
        )
        .where(
            Trade.user_id == user_id,
            Trade.status == "CLOSED",
            Trade.session_id.in_(session_ids),
        )
        .group_by(Trade.session_id)
    )

    aggregates: dict[int, StrategySummaryAggregate] = {}
    for row in db.execute(query):
        aggregates[int(row.session_id)] = _aggregate_from_row(row)
    return aggregates


def _aggregate_from_row(row: object) -> StrategySummaryAggregate:
    closed_trades = int(getattr(row, "closed_trades", 0) or 0)
    winning_trades = int(getattr(row, "winning_trades", 0) or 0)
    gross_profit = float(getattr(row, "gross_profit", 0.0) or 0.0)
    gross_loss = float(getattr(row, "gross_loss", 0.0) or 0.0)
    r_sum = float(getattr(row, "r_sum", 0.0) or 0.0)
    r_samples = int(getattr(row, "r_samples", 0) or 0)

    return StrategySummaryAggregate(
        closed_trades=closed_trades,
        winning_trades=winning_trades,
        net_pnl=float(getattr(row, "net_pnl", 0.0) or 0.0),
        gross_profit=gross_profit,
        gross_loss=gross_loss,
        win_rate=(winning_trades / closed_trades if closed_trades else 0.0),
        average_r=(r_sum / r_samples if r_samples else None),
        profit_factor=(gross_profit / gross_loss if gross_loss > 0 else None),
        r_sum=r_sum,
        r_samples=r_samples,
    )


def _combine_aggregates(aggregates: Sequence[StrategySummaryAggregate]) -> StrategySummaryAggregate:
    closed_trades = sum(aggregate.closed_trades for aggregate in aggregates)
    winning_trades = sum(aggregate.winning_trades for aggregate in aggregates)
    net_pnl = sum(aggregate.net_pnl for aggregate in aggregates)
    gross_profit = sum(aggregate.gross_profit for aggregate in aggregates)
    gross_loss = sum(aggregate.gross_loss for aggregate in aggregates)
    r_sum = sum(aggregate.r_sum for aggregate in aggregates)
    r_samples = sum(aggregate.r_samples for aggregate in aggregates)

    return StrategySummaryAggregate(
        closed_trades=closed_trades,
        winning_trades=winning_trades,
        net_pnl=net_pnl,
        gross_profit=gross_profit,
        gross_loss=gross_loss,
        win_rate=(winning_trades / closed_trades if closed_trades else 0.0),
        average_r=(r_sum / r_samples if r_samples else None),
        profit_factor=(gross_profit / gross_loss if gross_loss > 0 else None),
        r_sum=r_sum,
        r_samples=r_samples,
    )


def _normalize_strategy_name(value: str | None) -> str:
    trimmed = (value or "").strip()
    return trimmed if trimmed else "Unassigned"


def _strategy_from_session_name(value: str | None) -> str | None:
    prefix = (value or "").split(" / ")[0].strip()
    if not prefix or prefix.lower().endswith("replay"):
        return None
    return prefix


def _session_strategy_name(session: BacktestSessionRead) -> str:
    raw_strategy = (session.strategy_name or "").strip()
    if raw_strategy.lower() == "unassigned":
        return "Unassigned"

    saved_strategy = _normalize_strategy_name(raw_strategy)
    name_strategy = _strategy_from_session_name(session.name)
    if name_strategy and (not raw_strategy or saved_strategy == DEFAULT_STRATEGY_NAME):
        return name_strategy
    return saved_strategy
