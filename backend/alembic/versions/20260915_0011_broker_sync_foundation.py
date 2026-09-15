"""add broker sync foundation

Revision ID: 20260915_0011
Revises: 20260915_0010
Create Date: 2026-09-15 00:10:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260915_0011"
down_revision: str | None = "20260915_0010"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "broker_connections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("beta_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(length=64), nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=False),
        sa.Column("secret_id", sa.Integer(), sa.ForeignKey("integration_secrets.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="READY"),
        sa.Column("health", sa.String(length=24), nullable=False, server_default="UNKNOWN"),
        sa.Column("last_error_code", sa.String(length=64), nullable=True),
        sa.Column("last_error_message", sa.String(length=240), nullable=True),
        sa.Column("last_sync_started_at", sa.DateTime(), nullable=True),
        sa.Column("last_sync_completed_at", sa.DateTime(), nullable=True),
        sa.Column("next_retry_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("user_id", "provider", "display_name", name="uq_broker_connections_user_provider_name"),
    )
    create_indexes(
        "broker_connections",
        (("user_id",), ("provider",), ("secret_id",), ("status",), ("health",), ("revoked_at",)),
    )
    op.create_index("ix_broker_connections_user_updated_id", "broker_connections", ["user_id", "updated_at", "id"])

    op.create_table(
        "broker_accounts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("beta_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("connection_id", sa.Integer(), sa.ForeignKey("broker_connections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("external_account_id", sa.String(length=160), nullable=False),
        sa.Column("display_name", sa.String(length=160), nullable=False),
        sa.Column("currency", sa.String(length=12), nullable=False, server_default="USD"),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="ACTIVE"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("connection_id", "external_account_id", name="uq_broker_accounts_connection_external"),
    )
    create_indexes("broker_accounts", (("user_id",), ("connection_id",), ("status",)))
    op.create_index("ix_broker_accounts_user_connection", "broker_accounts", ["user_id", "connection_id", "id"])

    op.create_table(
        "broker_sync_cursors",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("beta_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("connection_id", sa.Integer(), sa.ForeignKey("broker_connections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("broker_accounts.id", ondelete="CASCADE"), nullable=True),
        sa.Column("stream", sa.String(length=32), nullable=False),
        sa.Column("scope_key", sa.String(length=160), nullable=False, server_default="*"),
        sa.Column("cursor", sa.String(length=512), nullable=True),
        sa.Column("high_watermark", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("connection_id", "stream", "scope_key", name="uq_broker_sync_cursors_connection_stream_scope"),
    )
    create_indexes("broker_sync_cursors", (("user_id",), ("connection_id",), ("account_id",)))

    op.create_table(
        "broker_orders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("beta_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("connection_id", sa.Integer(), sa.ForeignKey("broker_connections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("broker_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("external_order_id", sa.String(length=160), nullable=False),
        sa.Column("symbol", sa.String(length=80), nullable=False),
        sa.Column("side", sa.String(length=8), nullable=False),
        sa.Column("order_type", sa.String(length=24), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("quantity", sa.Numeric(28, 10), nullable=False),
        sa.Column("filled_quantity", sa.Numeric(28, 10), nullable=False),
        sa.Column("average_fill_price", sa.Numeric(28, 10), nullable=True),
        sa.Column("commission_total", sa.Numeric(28, 10), nullable=False, server_default="0"),
        sa.Column("fees_total", sa.Numeric(28, 10), nullable=False, server_default="0"),
        sa.Column("source_revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("placed_at", sa.DateTime(), nullable=False),
        sa.Column("provider_updated_at", sa.DateTime(), nullable=False),
        sa.Column("cancelled_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("connection_id", "external_order_id", name="uq_broker_orders_connection_external"),
    )
    create_indexes("broker_orders", (("user_id",), ("connection_id",), ("account_id",), ("symbol",), ("status",), ("placed_at",)))
    op.create_index("ix_broker_orders_user_account_updated", "broker_orders", ["user_id", "account_id", "updated_at"])

    op.create_table(
        "broker_fills",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("beta_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("connection_id", sa.Integer(), sa.ForeignKey("broker_connections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("broker_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("broker_orders.id", ondelete="SET NULL"), nullable=True),
        sa.Column("external_fill_id", sa.String(length=160), nullable=False),
        sa.Column("external_order_id", sa.String(length=160), nullable=False),
        sa.Column("symbol", sa.String(length=80), nullable=False),
        sa.Column("side", sa.String(length=8), nullable=False),
        sa.Column("quantity", sa.Numeric(28, 10), nullable=False),
        sa.Column("price", sa.Numeric(28, 10), nullable=False),
        sa.Column("commission", sa.Numeric(28, 10), nullable=False, server_default="0"),
        sa.Column("fees", sa.Numeric(28, 10), nullable=False, server_default="0"),
        sa.Column("source_revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("cancelled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("executed_at", sa.DateTime(), nullable=False),
        sa.Column("provider_updated_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("connection_id", "external_fill_id", name="uq_broker_fills_connection_external"),
    )
    create_indexes("broker_fills", (("user_id",), ("connection_id",), ("account_id",), ("order_id",), ("symbol",), ("executed_at",)))
    op.create_index("ix_broker_fills_user_account_executed", "broker_fills", ["user_id", "account_id", "executed_at", "id"])

    op.create_table(
        "broker_position_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("beta_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("connection_id", sa.Integer(), sa.ForeignKey("broker_connections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("broker_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("symbol", sa.String(length=80), nullable=False),
        sa.Column("signed_quantity", sa.Numeric(28, 10), nullable=False),
        sa.Column("average_entry_price", sa.Numeric(28, 10), nullable=True),
        sa.Column("open_costs", sa.Numeric(28, 10), nullable=False),
        sa.Column("realized_gross_pnl", sa.Numeric(28, 10), nullable=False),
        sa.Column("realized_costs", sa.Numeric(28, 10), nullable=False),
        sa.Column("realized_net_pnl", sa.Numeric(28, 10), nullable=False),
        sa.Column("fill_count", sa.Integer(), nullable=False),
        sa.Column("reconciliation_hash", sa.String(length=64), nullable=False),
        sa.Column("last_fill_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("connection_id", "account_id", "symbol", name="uq_broker_positions_connection_account_symbol"),
    )
    create_indexes("broker_position_snapshots", (("user_id",), ("connection_id",), ("account_id",)))
    op.create_index("ix_broker_positions_user_account", "broker_position_snapshots", ["user_id", "account_id", "symbol"])

    op.create_table(
        "broker_sync_jobs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("beta_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("connection_id", sa.Integer(), sa.ForeignKey("broker_connections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="QUEUED"),
        sa.Column("attempt", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("cursor_before", sa.String(length=512), nullable=True),
        sa.Column("cursor_after", sa.String(length=512), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("error_message", sa.String(length=240), nullable=True),
        sa.Column("stats", sa.JSON(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("next_retry_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    create_indexes("broker_sync_jobs", (("user_id",), ("connection_id",), ("status",)))
    op.create_index("ix_broker_sync_jobs_user_created_id", "broker_sync_jobs", ["user_id", "created_at", "id"])
    op.create_index("ix_broker_sync_jobs_status_retry", "broker_sync_jobs", ["status", "next_retry_at", "id"])

    op.create_table(
        "broker_audit_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("beta_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("connection_id", sa.Integer(), sa.ForeignKey("broker_connections.id", ondelete="CASCADE"), nullable=True),
        sa.Column("job_id", sa.Integer(), sa.ForeignKey("broker_sync_jobs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("provider", sa.String(length=64), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("outcome", sa.String(length=24), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    create_indexes("broker_audit_logs", (("user_id",), ("connection_id",), ("job_id",), ("provider",), ("action",), ("outcome",)))
    op.create_index("ix_broker_audit_logs_user_created_id", "broker_audit_logs", ["user_id", "created_at", "id"])
    op.create_index("ix_broker_audit_logs_connection_created", "broker_audit_logs", ["connection_id", "created_at", "id"])


def downgrade() -> None:
    for table_name in (
        "broker_audit_logs",
        "broker_sync_jobs",
        "broker_position_snapshots",
        "broker_fills",
        "broker_orders",
        "broker_sync_cursors",
        "broker_accounts",
        "broker_connections",
    ):
        op.drop_table(table_name)


def create_indexes(table_name: str, columns: Sequence[tuple[str, ...]]) -> None:
    for column_names in columns:
        op.create_index(
            op.f(f"ix_{table_name}_{'_'.join(column_names)}"),
            table_name,
            list(column_names),
            unique=False,
        )
