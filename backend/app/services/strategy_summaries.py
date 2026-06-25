from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence

from sqlalchemy.orm import Session
from app.schemas import (
    BacktestSessionRead,
    StrategySummary,
    StrategySummaryAggregate,
    StrategySummarySession,
)
from app.services.session_summaries import load_session_summary_aggregates

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
    return load_session_summary_aggregates(db, user_id, session_ids)


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
