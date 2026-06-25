"""add user dashboard summary read model

Revision ID: 20260625_0006
Revises: 20260625_0005
Create Date: 2026-06-25 23:35:00.000000
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260625_0006"
down_revision = "20260625_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_dashboard_summaries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("net_pnl", sa.Float(), nullable=False, server_default="0"),
        sa.Column("win_rate", sa.Float(), nullable=False, server_default="0"),
        sa.Column("total_trades", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("winning_trades", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("breakeven_trades", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("open_trades", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("profit_factor", sa.Float(), nullable=True),
        sa.Column("gross_pnl", sa.Float(), nullable=False, server_default="0"),
        sa.Column("total_commissions", sa.Float(), nullable=False, server_default="0"),
        sa.Column("total_fees", sa.Float(), nullable=False, server_default="0"),
        sa.Column("max_drawdown", sa.Float(), nullable=False, server_default="0"),
        sa.Column("recovery_factor", sa.Float(), nullable=True),
        sa.Column("sharpe_ratio", sa.Float(), nullable=True),
        sa.Column("average_r", sa.Float(), nullable=True),
        sa.Column("average_hold_minutes", sa.Float(), nullable=True),
        sa.Column("average_win", sa.Float(), nullable=True),
        sa.Column("average_loss", sa.Float(), nullable=True),
        sa.Column("expectancy", sa.Float(), nullable=True),
        sa.Column("best_trade", sa.Float(), nullable=True),
        sa.Column("worst_trade", sa.Float(), nullable=True),
        sa.Column("longest_win_streak", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("longest_loss_streak", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["beta_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_user_dashboard_summaries_user"),
    )
    op.create_index(
        "ix_user_dashboard_summaries_user_updated_at",
        "user_dashboard_summaries",
        ["user_id", "updated_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_user_dashboard_summaries_user_updated_at", table_name="user_dashboard_summaries")
    op.drop_table("user_dashboard_summaries")
