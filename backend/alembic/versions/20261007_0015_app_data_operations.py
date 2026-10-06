"""add account operation receipts

Revision ID: 20261007_0015
Revises: 20260915_0014
Create Date: 2026-10-07
"""

from collections.abc import Sequence

from alembic import op

from app.models import AppDataOperation


revision: str = "20261007_0015"
down_revision: str | None = "20260915_0014"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    AppDataOperation.__table__.create(bind=op.get_bind(), checkfirst=False)


def downgrade() -> None:
    AppDataOperation.__table__.drop(bind=op.get_bind(), checkfirst=False)
