"""add durable Quant and AI infrastructure

Revision ID: 20260915_0014
Revises: 20260915_0013
Create Date: 2026-09-15 02:30:00.000000
"""

from collections.abc import Sequence

from alembic import op

from app.models import (
    AIBacktestRun,
    AIConversation,
    AIGeneratedArtifact,
    AIGenerationJob,
    AIJobEvent,
    AIMessage,
    AIAuditLog,
    AIUsageLedger,
    QuantScript,
    QuantScriptPermission,
    QuantScriptVersion,
)


revision: str = "20260915_0014"
down_revision: str | None = "20260915_0013"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


MODELS = (
    QuantScript,
    AIConversation,
    AIMessage,
    AIGenerationJob,
    QuantScriptVersion,
    QuantScriptPermission,
    AIJobEvent,
    AIGeneratedArtifact,
    AIBacktestRun,
    AIUsageLedger,
    AIAuditLog,
)


def upgrade() -> None:
    bind = op.get_bind()
    for model in MODELS:
        model.__table__.create(bind=bind, checkfirst=False)


def downgrade() -> None:
    bind = op.get_bind()
    for model in reversed(MODELS):
        model.__table__.drop(bind=bind, checkfirst=False)
