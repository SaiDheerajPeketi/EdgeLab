"""add market candles storage

Revision ID: 20260625_0007
Revises: 20260625_0006
Create Date: 2026-06-25 20:30:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260625_0007"
down_revision: str | None = "20260625_0006"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "dataset_timeframes",
        sa.Column("database_imported", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "dataset_timeframes",
        sa.Column("database_imported_at", sa.DateTime(), nullable=True),
    )
    op.create_table(
        "market_candles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("asset_id", sa.Integer(), nullable=False),
        sa.Column("timeframe", sa.String(length=20), nullable=False),
        sa.Column("offset", sa.Integer(), nullable=False),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.Column("open", sa.Float(), nullable=False),
        sa.Column("high", sa.Float(), nullable=False),
        sa.Column("low", sa.Float(), nullable=False),
        sa.Column("close", sa.Float(), nullable=False),
        sa.Column("volume", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["asset_id"], ["dataset_assets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["beta_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "asset_id",
            "timeframe",
            "offset",
            name="uq_market_candles_user_asset_timeframe_offset",
        ),
        sa.UniqueConstraint(
            "user_id",
            "asset_id",
            "timeframe",
            "timestamp",
            name="uq_market_candles_user_asset_timeframe_timestamp",
        ),
    )
    op.create_index(op.f("ix_market_candles_asset_id"), "market_candles", ["asset_id"], unique=False)
    op.create_index(op.f("ix_market_candles_id"), "market_candles", ["id"], unique=False)
    op.create_index(op.f("ix_market_candles_offset"), "market_candles", ["offset"], unique=False)
    op.create_index(op.f("ix_market_candles_timeframe"), "market_candles", ["timeframe"], unique=False)
    op.create_index(op.f("ix_market_candles_timestamp"), "market_candles", ["timestamp"], unique=False)
    op.create_index(op.f("ix_market_candles_user_id"), "market_candles", ["user_id"], unique=False)
    op.create_index(
        "ix_market_candles_user_asset_timeframe_offset",
        "market_candles",
        ["user_id", "asset_id", "timeframe", "offset"],
        unique=False,
    )
    op.create_index(
        "ix_market_candles_user_asset_timeframe_timestamp",
        "market_candles",
        ["user_id", "asset_id", "timeframe", "timestamp"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_market_candles_user_asset_timeframe_timestamp", table_name="market_candles")
    op.drop_index("ix_market_candles_user_asset_timeframe_offset", table_name="market_candles")
    op.drop_index(op.f("ix_market_candles_user_id"), table_name="market_candles")
    op.drop_index(op.f("ix_market_candles_timestamp"), table_name="market_candles")
    op.drop_index(op.f("ix_market_candles_timeframe"), table_name="market_candles")
    op.drop_index(op.f("ix_market_candles_offset"), table_name="market_candles")
    op.drop_index(op.f("ix_market_candles_id"), table_name="market_candles")
    op.drop_index(op.f("ix_market_candles_asset_id"), table_name="market_candles")
    op.drop_table("market_candles")
    op.drop_column("dataset_timeframes", "database_imported_at")
    op.drop_column("dataset_timeframes", "database_imported")
