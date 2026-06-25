"""widen dataset file mtimes for postgres

Revision ID: 20260625_0004
Revises: 20260625_0003
Create Date: 2026-06-25 18:00:00.000000
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260625_0004"
down_revision = "20260625_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "dataset_timeframes",
        "file_mtime_ns",
        existing_type=sa.Integer(),
        type_=sa.BigInteger(),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "dataset_timeframes",
        "file_mtime_ns",
        existing_type=sa.BigInteger(),
        type_=sa.Integer(),
        existing_nullable=False,
    )
