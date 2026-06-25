"""add persisted replay readiness to backtest sessions

Revision ID: 20260625_0003
Revises: 20260625_0002
Create Date: 2026-06-25 02:00:00.000000
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260625_0003"
down_revision = "20260625_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    backtest_sessions = sa.table(
        "backtest_sessions",
        sa.column("csv_path", sa.Text()),
        sa.column("timeframe", sa.String()),
        sa.column("replay_ready", sa.Boolean()),
    )
    op.add_column(
        "backtest_sessions",
        sa.Column(
            "replay_ready",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.execute(
        backtest_sessions.update().values(
            replay_ready=sa.case(
                (
                    sa.and_(
                        backtest_sessions.c.csv_path.is_not(None),
                        sa.or_(
                            backtest_sessions.c.timeframe.is_(None),
                            backtest_sessions.c.timeframe != "Imported",
                        ),
                    ),
                    sa.true(),
                ),
                else_=sa.false(),
            )
        )
    )


def downgrade() -> None:
    op.drop_column("backtest_sessions", "replay_ready")
