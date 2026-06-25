"""baseline schema

Revision ID: 20260625_0001
Revises:
Create Date: 2026-06-25 00:00:00.000000
"""
from __future__ import annotations

from alembic import op

from app import models  # noqa: F401
from app.db import Base


revision = "20260625_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    Base.metadata.create_all(bind=op.get_bind())


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind())
