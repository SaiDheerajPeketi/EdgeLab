"""add feedback submissions

Revision ID: 20260626_0009
Revises: 20260625_0008
Create Date: 2026-06-26 22:40:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260626_0009"
down_revision: str | None = "20260625_0008"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "feedback_submissions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("beta_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("category", sa.String(length=24), nullable=False, server_default="OTHER"),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("context", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="NEW"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index(op.f("ix_feedback_submissions_id"), "feedback_submissions", ["id"], unique=False)
    op.create_index(
        "ix_feedback_submissions_user_created_id",
        "feedback_submissions",
        ["user_id", "created_at", "id"],
        unique=False,
    )
    op.create_index(
        "ix_feedback_submissions_status_created_id",
        "feedback_submissions",
        ["status", "created_at", "id"],
        unique=False,
    )
    op.create_index(op.f("ix_feedback_submissions_user_id"), "feedback_submissions", ["user_id"], unique=False)
    op.create_index(op.f("ix_feedback_submissions_category"), "feedback_submissions", ["category"], unique=False)
    op.create_index(op.f("ix_feedback_submissions_status"), "feedback_submissions", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_feedback_submissions_status"), table_name="feedback_submissions")
    op.drop_index(op.f("ix_feedback_submissions_category"), table_name="feedback_submissions")
    op.drop_index(op.f("ix_feedback_submissions_user_id"), table_name="feedback_submissions")
    op.drop_index("ix_feedback_submissions_status_created_id", table_name="feedback_submissions")
    op.drop_index("ix_feedback_submissions_user_created_id", table_name="feedback_submissions")
    op.drop_index(op.f("ix_feedback_submissions_id"), table_name="feedback_submissions")
    op.drop_table("feedback_submissions")
