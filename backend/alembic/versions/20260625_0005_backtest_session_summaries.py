"""add backtest session summary read model

Revision ID: 20260625_0005
Revises: 20260625_0004
Create Date: 2026-06-25 22:15:00.000000
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260625_0005"
down_revision = "20260625_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "backtest_session_summaries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("closed_trades", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("winning_trades", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("breakeven_trades", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("net_pnl", sa.Float(), nullable=False, server_default="0"),
        sa.Column("gross_profit", sa.Float(), nullable=False, server_default="0"),
        sa.Column("gross_loss", sa.Float(), nullable=False, server_default="0"),
        sa.Column("r_sum", sa.Float(), nullable=False, server_default="0"),
        sa.Column("r_samples", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["backtest_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["beta_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "session_id", name="uq_backtest_session_summaries_user_session"),
    )
    op.create_index(
        "ix_backtest_session_summaries_user_updated_id",
        "backtest_session_summaries",
        ["user_id", "updated_at", "session_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_backtest_session_summaries_session_id"),
        "backtest_session_summaries",
        ["session_id"],
        unique=False,
    )
    op.execute(
        sa.text(
            """
            INSERT INTO backtest_session_summaries (
                session_id,
                user_id,
                closed_trades,
                winning_trades,
                breakeven_trades,
                net_pnl,
                gross_profit,
                gross_loss,
                r_sum,
                r_samples,
                created_at,
                updated_at
            )
            SELECT
                sessions.id AS session_id,
                sessions.user_id AS user_id,
                COALESCE(metrics.closed_trades, 0) AS closed_trades,
                COALESCE(metrics.winning_trades, 0) AS winning_trades,
                COALESCE(metrics.breakeven_trades, 0) AS breakeven_trades,
                COALESCE(metrics.net_pnl, 0) AS net_pnl,
                COALESCE(metrics.gross_profit, 0) AS gross_profit,
                COALESCE(metrics.gross_loss, 0) AS gross_loss,
                COALESCE(metrics.r_sum, 0) AS r_sum,
                COALESCE(metrics.r_samples, 0) AS r_samples,
                CURRENT_TIMESTAMP AS created_at,
                CURRENT_TIMESTAMP AS updated_at
            FROM backtest_sessions AS sessions
            LEFT JOIN (
                SELECT
                    trades.user_id AS user_id,
                    trades.session_id AS session_id,
                    COUNT(trades.id) AS closed_trades,
                    SUM(CASE WHEN trades.realized_pnl > 0 THEN 1 ELSE 0 END) AS winning_trades,
                    SUM(CASE WHEN trades.realized_pnl = 0 THEN 1 ELSE 0 END) AS breakeven_trades,
                    COALESCE(SUM(trades.realized_pnl), 0) AS net_pnl,
                    COALESCE(SUM(CASE WHEN trades.realized_pnl > 0 THEN trades.realized_pnl ELSE 0 END), 0) AS gross_profit,
                    COALESCE(SUM(CASE WHEN trades.realized_pnl < 0 THEN -trades.realized_pnl ELSE 0 END), 0) AS gross_loss,
                    COALESCE(SUM(CASE WHEN trades.r_multiple IS NOT NULL THEN trades.r_multiple ELSE 0 END), 0) AS r_sum,
                    SUM(CASE WHEN trades.r_multiple IS NOT NULL THEN 1 ELSE 0 END) AS r_samples
                FROM trades
                WHERE trades.status = 'CLOSED'
                GROUP BY trades.user_id, trades.session_id
            ) AS metrics
                ON metrics.user_id = sessions.user_id
               AND metrics.session_id = sessions.id
            """
        )
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_backtest_session_summaries_session_id"), table_name="backtest_session_summaries")
    op.drop_index("ix_backtest_session_summaries_user_updated_id", table_name="backtest_session_summaries")
    op.drop_table("backtest_session_summaries")
