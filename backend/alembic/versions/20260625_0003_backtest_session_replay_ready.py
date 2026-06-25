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
        """
        UPDATE backtest_sessions
        SET replay_ready = CASE
            WHEN csv_path IS NOT NULL AND (timeframe IS NULL OR timeframe != 'Imported') THEN 1
            ELSE 0
        END
        """
    )


def downgrade() -> None:
    op.drop_column("backtest_sessions", "replay_ready")
