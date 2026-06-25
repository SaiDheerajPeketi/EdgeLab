"""add dataset asset identity to backtest sessions

Revision ID: 20260625_0008
Revises: 20260625_0007
Create Date: 2026-06-25 22:10:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260625_0008"
down_revision: str | None = "20260625_0007"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


backtest_sessions = sa.table(
    "backtest_sessions",
    sa.column("id", sa.Integer()),
    sa.column("user_id", sa.Integer()),
    sa.column("instrument", sa.String()),
    sa.column("timeframe", sa.String()),
    sa.column("csv_path", sa.Text()),
    sa.column("dataset_asset_id", sa.Integer()),
)

dataset_assets = sa.table(
    "dataset_assets",
    sa.column("id", sa.Integer()),
    sa.column("user_id", sa.Integer()),
    sa.column("asset_key", sa.String()),
)

dataset_timeframes = sa.table(
    "dataset_timeframes",
    sa.column("user_id", sa.Integer()),
    sa.column("asset_id", sa.Integer()),
    sa.column("timeframe", sa.String()),
    sa.column("csv_path", sa.Text()),
)


def upgrade() -> None:
    with op.batch_alter_table("backtest_sessions") as batch_op:
        batch_op.add_column(sa.Column("dataset_asset_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_backtest_sessions_dataset_asset_id",
            "dataset_assets",
            ["dataset_asset_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index(
            op.f("ix_backtest_sessions_dataset_asset_id"),
            ["dataset_asset_id"],
            unique=False,
        )
        batch_op.create_index(
            "ix_backtest_sessions_user_dataset_asset_timeframe",
            ["user_id", "dataset_asset_id", "timeframe"],
            unique=False,
        )

    bind = op.get_bind()
    session_rows = bind.execute(
        sa.select(
            backtest_sessions.c.id,
            backtest_sessions.c.user_id,
            backtest_sessions.c.instrument,
            backtest_sessions.c.timeframe,
            backtest_sessions.c.csv_path,
        )
    ).mappings()
    timeframe_rows = bind.execute(
        sa.select(
            dataset_timeframes.c.user_id,
            dataset_timeframes.c.asset_id,
            dataset_timeframes.c.timeframe,
            dataset_timeframes.c.csv_path,
        )
    ).mappings()
    asset_rows = bind.execute(
        sa.select(
            dataset_assets.c.user_id,
            dataset_assets.c.id,
            dataset_assets.c.asset_key,
        )
    ).mappings()

    timeframe_by_csv_path = {
        (row["user_id"], row["csv_path"]): row["asset_id"]
        for row in timeframe_rows
        if row["csv_path"]
    }
    timeframe_by_asset_timeframe = {
        (row["user_id"], row["asset_id"], row["timeframe"]): row["asset_id"]
        for row in timeframe_rows
        if row["timeframe"]
    }
    asset_id_by_key = {
        (row["user_id"], row["asset_key"]): row["id"]
        for row in asset_rows
        if row["asset_key"]
    }

    for row in session_rows:
        dataset_asset_id = None
        if row["csv_path"]:
            dataset_asset_id = timeframe_by_csv_path.get((row["user_id"], row["csv_path"]))
        if dataset_asset_id is None and row["instrument"]:
            dataset_asset_id = asset_id_by_key.get((row["user_id"], row["instrument"]))
        if (
            dataset_asset_id is not None
            and row["timeframe"]
            and (row["user_id"], dataset_asset_id, row["timeframe"]) not in timeframe_by_asset_timeframe
        ):
            dataset_asset_id = None
        if dataset_asset_id is None:
            continue
        bind.execute(
            backtest_sessions.update()
            .where(backtest_sessions.c.id == row["id"])
            .values(dataset_asset_id=dataset_asset_id)
        )


def downgrade() -> None:
    with op.batch_alter_table("backtest_sessions") as batch_op:
        batch_op.drop_index("ix_backtest_sessions_user_dataset_asset_timeframe")
        batch_op.drop_index(op.f("ix_backtest_sessions_dataset_asset_id"))
        batch_op.drop_constraint("fk_backtest_sessions_dataset_asset_id", type_="foreignkey")
        batch_op.drop_column("dataset_asset_id")
