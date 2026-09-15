"""add encrypted integration secrets

Revision ID: 20260915_0010
Revises: 20260626_0009
Create Date: 2026-09-15 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260915_0010"
down_revision: str | None = "20260626_0009"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "integration_secrets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("beta_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("provider", sa.String(length=64), nullable=False),
        sa.Column("purpose", sa.String(length=64), nullable=False),
        sa.Column("key_id", sa.String(length=64), nullable=False),
        sa.Column("cipher_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("nonce", sa.LargeBinary(length=12), nullable=False),
        sa.Column("ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("rotated_at", sa.DateTime(), nullable=True),
        sa.Column("last_connected_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint(
            "user_id",
            "provider",
            "purpose",
            name="uq_integration_secrets_user_provider_purpose",
        ),
    )
    op.create_index(
        op.f("ix_integration_secrets_id"),
        "integration_secrets",
        ["id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_integration_secrets_user_id"),
        "integration_secrets",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_integration_secrets_provider"),
        "integration_secrets",
        ["provider"],
        unique=False,
    )
    op.create_index(
        op.f("ix_integration_secrets_purpose"),
        "integration_secrets",
        ["purpose"],
        unique=False,
    )
    op.create_index(
        op.f("ix_integration_secrets_key_id"),
        "integration_secrets",
        ["key_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_integration_secrets_revoked_at"),
        "integration_secrets",
        ["revoked_at"],
        unique=False,
    )
    op.create_index(
        "ix_integration_secrets_user_updated_id",
        "integration_secrets",
        ["user_id", "updated_at", "id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_integration_secrets_user_updated_id",
        table_name="integration_secrets",
    )
    op.drop_index(
        op.f("ix_integration_secrets_revoked_at"),
        table_name="integration_secrets",
    )
    op.drop_index(
        op.f("ix_integration_secrets_key_id"),
        table_name="integration_secrets",
    )
    op.drop_index(
        op.f("ix_integration_secrets_purpose"),
        table_name="integration_secrets",
    )
    op.drop_index(
        op.f("ix_integration_secrets_provider"),
        table_name="integration_secrets",
    )
    op.drop_index(
        op.f("ix_integration_secrets_user_id"),
        table_name="integration_secrets",
    )
    op.drop_index(op.f("ix_integration_secrets_id"), table_name="integration_secrets")
    op.drop_table("integration_secrets")
