from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import case, delete, func, select
from sqlalchemy.orm import Session

from app.models import BacktestSession, BacktestSessionSummary, Trade, utcnow
from app.schemas import StrategySummaryAggregate


@dataclass(frozen=True)
class SessionSummarySnapshot:
    aggregate: StrategySummaryAggregate
    breakeven_trades: int = 0


def refresh_session_summary(
    db: Session,
    user_id: int,
    session_id: int,
) -> BacktestSessionSummary:
    session = db.scalar(
        select(BacktestSession).where(
            BacktestSession.user_id == user_id,
            BacktestSession.id == session_id,
        )
    )
    if session is None:
        raise LookupError(f"Backtest session {session_id} not found for user {user_id}")

    summary = db.scalar(
        select(BacktestSessionSummary).where(
            BacktestSessionSummary.user_id == user_id,
            BacktestSessionSummary.session_id == session_id,
        )
    )
    if summary is None:
        summary = BacktestSessionSummary(user_id=user_id, session_id=session_id)
        db.add(summary)
        db.flush()

    snapshot = _aggregate_trade_metrics(db, user_id, [session_id]).get(
        session_id,
        SessionSummarySnapshot(aggregate=StrategySummaryAggregate()),
    )
    _apply_snapshot(summary, snapshot)
    return summary


def refresh_user_session_summaries(db: Session, user_id: int) -> int:
    session_ids = db.scalars(
        select(BacktestSession.id).where(BacktestSession.user_id == user_id)
    ).all()
    session_id_set = set(session_ids)

    if not session_id_set:
        db.execute(delete(BacktestSessionSummary).where(BacktestSessionSummary.user_id == user_id))
        return 0

    aggregates = _aggregate_trade_metrics(db, user_id, session_id_set)
    existing = {
        row.session_id: row
        for row in db.scalars(
            select(BacktestSessionSummary).where(BacktestSessionSummary.user_id == user_id)
        ).all()
    }
    touched = 0
    for session_id in session_id_set:
        summary = existing.get(session_id)
        if summary is None:
            summary = BacktestSessionSummary(user_id=user_id, session_id=session_id)
            db.add(summary)
            db.flush()
        _apply_snapshot(
            summary,
            aggregates.get(session_id, SessionSummarySnapshot(aggregate=StrategySummaryAggregate())),
        )
        touched += 1

    for session_id, summary in existing.items():
        if session_id not in session_id_set:
            db.delete(summary)

    return touched


def load_session_summary_aggregates(
    db: Session,
    user_id: int,
    session_ids: Iterable[int],
) -> dict[int, StrategySummaryAggregate]:
    wanted_ids = [int(session_id) for session_id in session_ids]
    if not wanted_ids:
        return {}

    stored = {
        row.session_id: _snapshot_from_values(
            closed_trades=row.closed_trades,
            winning_trades=row.winning_trades,
            breakeven_trades=row.breakeven_trades,
            net_pnl=row.net_pnl,
            gross_profit=row.gross_profit,
            gross_loss=row.gross_loss,
            r_sum=row.r_sum,
            r_samples=row.r_samples,
        ).aggregate
        for row in db.scalars(
            select(BacktestSessionSummary).where(
                BacktestSessionSummary.user_id == user_id,
                BacktestSessionSummary.session_id.in_(wanted_ids),
            )
        ).all()
    }

    missing_ids = [session_id for session_id in wanted_ids if session_id not in stored]
    if missing_ids:
        stored.update(
            {
                session_id: snapshot.aggregate
                for session_id, snapshot in _aggregate_trade_metrics(
                    db,
                    user_id,
                    missing_ids,
                ).items()
            }
        )
    return stored


def _aggregate_trade_metrics(
    db: Session,
    user_id: int,
    session_ids: Iterable[int],
) -> dict[int, SessionSummarySnapshot]:
    wanted_ids = [int(session_id) for session_id in session_ids]
    if not wanted_ids:
        return {}

    query = (
        select(
            Trade.session_id.label("session_id"),
            func.count(Trade.id).label("closed_trades"),
            func.sum(case((Trade.realized_pnl > 0, 1), else_=0)).label("winning_trades"),
            func.sum(case((Trade.realized_pnl == 0, 1), else_=0)).label("breakeven_trades"),
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
            Trade.session_id.in_(wanted_ids),
        )
        .group_by(Trade.session_id)
    )

    aggregates: dict[int, SessionSummarySnapshot] = {}
    for row in db.execute(query):
        aggregates[int(row.session_id)] = _snapshot_from_values(
            closed_trades=row.closed_trades,
            winning_trades=row.winning_trades,
            breakeven_trades=row.breakeven_trades,
            net_pnl=row.net_pnl,
            gross_profit=row.gross_profit,
            gross_loss=row.gross_loss,
            r_sum=row.r_sum,
            r_samples=row.r_samples,
        )
    return aggregates


def _apply_snapshot(summary: BacktestSessionSummary, snapshot: SessionSummarySnapshot) -> None:
    aggregate = snapshot.aggregate
    summary.closed_trades = aggregate.closed_trades
    summary.winning_trades = aggregate.winning_trades
    summary.breakeven_trades = snapshot.breakeven_trades
    summary.net_pnl = aggregate.net_pnl
    summary.gross_profit = aggregate.gross_profit
    summary.gross_loss = aggregate.gross_loss
    summary.r_sum = aggregate.r_sum
    summary.r_samples = aggregate.r_samples
    summary.updated_at = utcnow()


def _snapshot_from_values(
    *,
    closed_trades: object,
    winning_trades: object,
    breakeven_trades: object,
    net_pnl: object,
    gross_profit: object,
    gross_loss: object,
    r_sum: object,
    r_samples: object,
) -> SessionSummarySnapshot:
    closed_trades_int = int(closed_trades or 0)
    winning_trades_int = int(winning_trades or 0)
    breakeven_trades_int = int(breakeven_trades or 0)
    gross_profit_float = float(gross_profit or 0.0)
    gross_loss_float = float(gross_loss or 0.0)
    r_sum_float = float(r_sum or 0.0)
    r_samples_int = int(r_samples or 0)
    return SessionSummarySnapshot(
        aggregate=StrategySummaryAggregate(
            closed_trades=closed_trades_int,
            winning_trades=winning_trades_int,
            net_pnl=float(net_pnl or 0.0),
            gross_profit=gross_profit_float,
            gross_loss=gross_loss_float,
            win_rate=(winning_trades_int / closed_trades_int if closed_trades_int else 0.0),
            average_r=(r_sum_float / r_samples_int if r_samples_int else None),
            profit_factor=(
                gross_profit_float / gross_loss_float if gross_loss_float > 0 else None
            ),
            r_sum=r_sum_float,
            r_samples=r_samples_int,
        ),
        breakeven_trades=breakeven_trades_int,
    )
