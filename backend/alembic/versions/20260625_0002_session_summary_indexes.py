"""add session summary indexes

Revision ID: 20260625_0002
Revises: 20260625_0001
Create Date: 2026-06-25 00:15:00.000000
"""
from __future__ import annotations

from alembic import op


revision = "20260625_0002"
down_revision = "20260625_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_backtest_sessions_user_created_id",
        "backtest_sessions",
        ["user_id", "created_at", "id"],
        unique=False,
    )
    op.create_index(
        "ix_dataset_timeframes_user_csv_path",
        "dataset_timeframes",
        ["user_id", "csv_path"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_dataset_timeframes_user_csv_path", table_name="dataset_timeframes")
    op.drop_index("ix_backtest_sessions_user_created_id", table_name="backtest_sessions")
