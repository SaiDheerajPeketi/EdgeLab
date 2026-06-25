from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import BetaUser, UserDashboardSummary, utcnow
from app.schemas import MetricsSummaryResponse
from app.services.metrics import get_metrics_summary


def refresh_user_dashboard_summary(db: Session, user_id: int) -> UserDashboardSummary:
    user = db.scalar(select(BetaUser.id).where(BetaUser.id == user_id))
    if user is None:
        raise LookupError(f"Beta user {user_id} not found")

    summary = db.scalar(
        select(UserDashboardSummary).where(UserDashboardSummary.user_id == user_id)
    )
    if summary is None:
        summary = UserDashboardSummary(user_id=user_id)
        db.add(summary)
        db.flush()

    payload = get_metrics_summary(db, user_id)
    _apply_metrics_summary(summary, payload)
    return summary


def load_user_dashboard_summary(db: Session, user_id: int) -> MetricsSummaryResponse:
    summary = db.scalar(
        select(UserDashboardSummary).where(UserDashboardSummary.user_id == user_id)
    )
    if summary is None:
        return get_metrics_summary(db, user_id)
    return _to_metrics_summary(summary)


def _apply_metrics_summary(summary: UserDashboardSummary, payload: MetricsSummaryResponse) -> None:
    for field, value in payload.model_dump().items():
        setattr(summary, field, value)
    summary.updated_at = utcnow()


def _to_metrics_summary(summary: UserDashboardSummary) -> MetricsSummaryResponse:
    return MetricsSummaryResponse(
        net_pnl=summary.net_pnl,
        win_rate=summary.win_rate,
        total_trades=summary.total_trades,
        winning_trades=summary.winning_trades,
        breakeven_trades=summary.breakeven_trades,
        open_trades=summary.open_trades,
        profit_factor=summary.profit_factor,
        gross_pnl=summary.gross_pnl,
        total_commissions=summary.total_commissions,
        total_fees=summary.total_fees,
        max_drawdown=summary.max_drawdown,
        recovery_factor=summary.recovery_factor,
        sharpe_ratio=summary.sharpe_ratio,
        average_r=summary.average_r,
        average_hold_minutes=summary.average_hold_minutes,
        average_win=summary.average_win,
        average_loss=summary.average_loss,
        expectancy=summary.expectancy,
        best_trade=summary.best_trade,
        worst_trade=summary.worst_trade,
        longest_win_streak=summary.longest_win_streak,
        longest_loss_streak=summary.longest_loss_streak,
    )
