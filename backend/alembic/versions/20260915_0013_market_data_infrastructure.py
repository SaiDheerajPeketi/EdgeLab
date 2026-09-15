"""add normalized market-data infrastructure

Revision ID: 20260915_0013
Revises: 20260915_0012
Create Date: 2026-09-15 01:30:00.000000
"""

from collections.abc import Sequence

from alembic import op

from app.models import (
    ContinuousContractRule,
    ExchangeCalendar,
    MarketAlertEvent,
    MarketAlertRule,
    MarketBackfillRun,
    MarketContract,
    MarketDataDiagnostic,
    MarketDataEntitlement,
    MarketInstrument,
    MarketInstrumentIdentifier,
    MarketProviderState,
    MarketTradeTick,
    NormalizedCandle,
    OrderBookLevel,
    OrderBookSnapshot,
    PersistedFootprint,
    PersistedFootprintLevel,
)


revision: str = "20260915_0013"
down_revision: str | None = "20260915_0012"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


MODELS = (
    ExchangeCalendar,
    MarketInstrument,
    MarketInstrumentIdentifier,
    MarketContract,
    ContinuousContractRule,
    MarketDataEntitlement,
    MarketProviderState,
    MarketDataDiagnostic,
    NormalizedCandle,
    MarketTradeTick,
    OrderBookSnapshot,
    OrderBookLevel,
    PersistedFootprint,
    PersistedFootprintLevel,
    MarketBackfillRun,
    MarketAlertRule,
    MarketAlertEvent,
)


def upgrade() -> None:
    bind = op.get_bind()
    for model in MODELS:
        model.__table__.create(bind=bind, checkfirst=False)


def downgrade() -> None:
    bind = op.get_bind()
    for model in reversed(MODELS):
        model.__table__.drop(bind=bind, checkfirst=False)
