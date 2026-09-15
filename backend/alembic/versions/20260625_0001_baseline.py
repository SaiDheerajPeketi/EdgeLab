"""baseline schema

Revision ID: 20260625_0001
Revises:
Create Date: 2026-06-25 00:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from app import models  # noqa: F401
from app.db import Base


revision = "20260625_0001"
down_revision = None
branch_labels = None
depends_on = None


# Keep the root revision frozen at the schema that existed when it shipped.
# Importing the live model metadata here is convenient, but creating all of it
# makes every later revision collide with tables, columns, and indexes that the
# baseline has already created.
BASELINE_TABLES = (
    "beta_users",
    "beta_sessions",
    "dataset_assets",
    "dataset_timeframes",
    "dataset_settings",
    "app_storage",
    "backtest_sessions",
    "playbooks",
    "positions",
    "orders",
    "executions",
    "trades",
    "trade_notes",
)

POST_BASELINE_COLUMNS = {
    "backtest_sessions": {"dataset_asset_id", "replay_ready"},
    "dataset_timeframes": {"database_imported", "database_imported_at"},
}

POST_BASELINE_INDEXES = {
    "ix_backtest_sessions_user_created_id",
    "ix_dataset_timeframes_user_csv_path",
}


def _baseline_metadata() -> sa.MetaData:
    metadata = sa.MetaData()
    for table_name in BASELINE_TABLES:
        Base.metadata.tables[table_name].to_metadata(metadata)

    for table_name, column_names in POST_BASELINE_COLUMNS.items():
        table = metadata.tables[table_name]
        table.indexes.difference_update(
            [index for index in table.indexes if column_names.intersection(index.columns.keys())]
        )
        table.constraints.difference_update(
            [
                constraint
                for constraint in table.constraints
                if column_names.intersection(constraint.columns.keys())
            ]
        )
        for column_name in column_names:
            table._columns.remove(table.c[column_name])

    for table in metadata.tables.values():
        table.indexes.difference_update(
            [index for index in table.indexes if index.name in POST_BASELINE_INDEXES]
        )

    # Revision 0004 owns this widening operation.
    metadata.tables["dataset_timeframes"].c.file_mtime_ns.type = sa.Integer()
    return metadata


def upgrade() -> None:
    _baseline_metadata().create_all(bind=op.get_bind())


def downgrade() -> None:
    _baseline_metadata().drop_all(bind=op.get_bind())
