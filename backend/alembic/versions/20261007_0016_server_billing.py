"""add server-owned Stripe billing records

Revision ID: 20261007_0016
Revises: 20261007_0015
Create Date: 2026-10-07
"""

from collections.abc import Sequence

from alembic import op

from app.models import BillingCustomer, BillingSubscription, BillingWebhookEvent


revision: str = "20261007_0016"
down_revision: str | None = "20261007_0015"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    for model in (BillingCustomer, BillingSubscription, BillingWebhookEvent):
        model.__table__.create(bind=op.get_bind(), checkfirst=False)


def downgrade() -> None:
    for model in (BillingWebhookEvent, BillingSubscription, BillingCustomer):
        model.__table__.drop(bind=op.get_bind(), checkfirst=False)
