"""add relational journal and canonical trades

Revision ID: 20260915_0012
Revises: 20260915_0011
Create Date: 2026-09-15 00:20:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260915_0012"
down_revision: str | None = "20260915_0011"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def user_id_column() -> sa.Column:
    return sa.Column(
        "user_id",
        sa.Integer(),
        sa.ForeignKey("beta_users.id", ondelete="CASCADE"),
        nullable=False,
    )


def upgrade() -> None:
    op.create_table(
        "journal_accounts",
        sa.Column("id", sa.Integer(), primary_key=True),
        user_id_column(),
        sa.Column("broker_account_id", sa.Integer(), sa.ForeignKey("broker_accounts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("source_type", sa.String(length=24), nullable=False),
        sa.Column("source_key", sa.String(length=240), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("provider", sa.String(length=80), nullable=False),
        sa.Column("currency", sa.String(length=12), nullable=False),
        sa.Column("timezone", sa.String(length=80), nullable=False),
        sa.Column("initial_balance", sa.Numeric(28, 10), nullable=False),
        sa.Column("color", sa.String(length=32), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("user_id", "source_key", name="uq_journal_accounts_user_source"),
        sa.UniqueConstraint("user_id", "broker_account_id", name="uq_journal_accounts_user_broker_account"),
    )
    op.create_index("ix_journal_accounts_user_id", "journal_accounts", ["user_id"])
    op.create_index("ix_journal_accounts_broker_account_id", "journal_accounts", ["broker_account_id"])
    op.create_index("ix_journal_accounts_status", "journal_accounts", ["status"])
    op.create_index("ix_journal_accounts_user_status_name", "journal_accounts", ["user_id", "status", "name"])

    op.create_table(
        "journal_import_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        user_id_column(),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("journal_accounts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("source_name", sa.String(length=160), nullable=False),
        sa.Column("source_digest", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("source_timezone", sa.String(length=80), nullable=False),
        sa.Column("currency", sa.String(length=12), nullable=False),
        sa.Column("default_symbol", sa.String(length=80), nullable=True),
        sa.Column("column_mapping", sa.JSON(), nullable=False),
        sa.Column("grouping", sa.JSON(), nullable=False),
        sa.Column("detected_columns", sa.JSON(), nullable=False),
        sa.Column("total_rows", sa.Integer(), nullable=False),
        sa.Column("imported_rows", sa.Integer(), nullable=False),
        sa.Column("skipped_rows", sa.Integer(), nullable=False),
        sa.Column("duplicate_rows", sa.Integer(), nullable=False),
        sa.Column("error_rows", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("rolled_back_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_journal_import_runs_user_id", "journal_import_runs", ["user_id"])
    op.create_index("ix_journal_import_runs_account_id", "journal_import_runs", ["account_id"])
    op.create_index("ix_journal_import_runs_source_digest", "journal_import_runs", ["source_digest"])
    op.create_index("ix_journal_import_runs_status", "journal_import_runs", ["status"])
    op.create_index("ix_journal_import_runs_user_created_id", "journal_import_runs", ["user_id", "created_at", "id"])
    op.create_index("ix_journal_import_runs_user_account", "journal_import_runs", ["user_id", "account_id", "id"])

    op.create_table(
        "canonical_trades",
        sa.Column("id", sa.Integer(), primary_key=True),
        user_id_column(),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("journal_accounts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("import_run_id", sa.Integer(), sa.ForeignKey("journal_import_runs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("source_type", sa.String(length=24), nullable=False),
        sa.Column("source_ref", sa.String(length=240), nullable=False),
        sa.Column("duplicate_key", sa.String(length=64), nullable=False),
        sa.Column("entry_type", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("symbol", sa.String(length=80), nullable=False),
        sa.Column("source_symbol", sa.String(length=120), nullable=True),
        sa.Column("currency", sa.String(length=12), nullable=False),
        sa.Column("source_timezone", sa.String(length=80), nullable=False),
        sa.Column("side", sa.String(length=12), nullable=False),
        sa.Column("entry_time", sa.DateTime(), nullable=False),
        sa.Column("exit_time", sa.DateTime(), nullable=True),
        sa.Column("entry_price", sa.Numeric(28, 10), nullable=False),
        sa.Column("exit_price", sa.Numeric(28, 10), nullable=True),
        sa.Column("quantity", sa.Numeric(28, 10), nullable=False),
        sa.Column("remaining_quantity", sa.Numeric(28, 10), nullable=False),
        sa.Column("gross_pnl", sa.Numeric(28, 10), nullable=False),
        sa.Column("net_pnl", sa.Numeric(28, 10), nullable=False),
        sa.Column("commission", sa.Numeric(28, 10), nullable=False),
        sa.Column("fees", sa.Numeric(28, 10), nullable=False),
        sa.Column("stop_loss", sa.Numeric(28, 10), nullable=True),
        sa.Column("take_profit", sa.Numeric(28, 10), nullable=True),
        sa.Column("planned_entry_price", sa.Numeric(28, 10), nullable=True),
        sa.Column("planned_exit_price", sa.Numeric(28, 10), nullable=True),
        sa.Column("planned_stop_loss", sa.Numeric(28, 10), nullable=True),
        sa.Column("planned_take_profit", sa.Numeric(28, 10), nullable=True),
        sa.Column("r_multiple", sa.Numeric(18, 8), nullable=True),
        sa.Column("strategy_name", sa.String(length=120), nullable=True),
        sa.Column("emotional_state", sa.String(length=80), nullable=True),
        sa.Column("missed_reason", sa.Text(), nullable=True),
        sa.Column("rating", sa.Integer(), nullable=True),
        sa.Column("setup_grade", sa.String(length=8), nullable=True),
        sa.Column("reviewed", sa.Boolean(), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("user_id", "source_type", "source_ref", name="uq_canonical_trades_user_source"),
        sa.UniqueConstraint("user_id", "account_id", "duplicate_key", name="uq_canonical_trades_user_account_duplicate"),
        sa.CheckConstraint("rating IS NULL OR (rating >= 1 AND rating <= 5)", name="ck_canonical_trades_rating"),
    )
    for column in ("user_id", "account_id", "import_run_id", "source_type", "entry_type", "status", "symbol", "side", "entry_time", "exit_time", "strategy_name", "rating", "setup_grade", "reviewed"):
        op.create_index(f"ix_canonical_trades_{column}", "canonical_trades", [column])
    op.create_index("ix_canonical_trades_user_account_entry", "canonical_trades", ["user_id", "account_id", "entry_time", "id"])
    op.create_index("ix_canonical_trades_user_review_queue", "canonical_trades", ["user_id", "reviewed", "entry_time", "id"])
    op.create_index("ix_canonical_trades_user_symbol_entry", "canonical_trades", ["user_id", "symbol", "entry_time", "id"])

    op.create_table(
        "canonical_executions",
        sa.Column("id", sa.Integer(), primary_key=True),
        user_id_column(),
        sa.Column("trade_id", sa.Integer(), sa.ForeignKey("canonical_trades.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_type", sa.String(length=24), nullable=False),
        sa.Column("source_ref", sa.String(length=240), nullable=False),
        sa.Column("execution_type", sa.String(length=16), nullable=False),
        sa.Column("side", sa.String(length=8), nullable=False),
        sa.Column("occurred_at", sa.DateTime(), nullable=False),
        sa.Column("price", sa.Numeric(28, 10), nullable=False),
        sa.Column("quantity", sa.Numeric(28, 10), nullable=False),
        sa.Column("commission", sa.Numeric(28, 10), nullable=False),
        sa.Column("fees", sa.Numeric(28, 10), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("source_revision", sa.Integer(), nullable=False),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("raw_payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("trade_id", "fingerprint", name="uq_canonical_executions_trade_fingerprint"),
    )
    op.create_index("ix_canonical_executions_user_id", "canonical_executions", ["user_id"])
    op.create_index("ix_canonical_executions_trade_id", "canonical_executions", ["trade_id"])
    op.create_index("ix_canonical_executions_occurred_at", "canonical_executions", ["occurred_at"])
    op.create_index("ix_canonical_executions_user_trade_time", "canonical_executions", ["user_id", "trade_id", "occurred_at", "id"])

    op.create_table(
        "journal_tags",
        sa.Column("id", sa.Integer(), primary_key=True),
        user_id_column(),
        sa.Column("category", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("normalized_name", sa.String(length=80), nullable=False),
        sa.Column("color", sa.String(length=32), nullable=True),
        sa.Column("archived_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("user_id", "category", "normalized_name", name="uq_journal_tags_user_category_name"),
        sa.CheckConstraint("category IN ('SETUP', 'POSITIVE', 'MISTAKE', 'PROCESS')", name="ck_journal_tags_category"),
    )
    op.create_index("ix_journal_tags_user_id", "journal_tags", ["user_id"])
    op.create_index("ix_journal_tags_category", "journal_tags", ["category"])
    op.create_index("ix_journal_tags_user_category_name", "journal_tags", ["user_id", "category", "name"])

    op.create_table(
        "canonical_trade_tags",
        sa.Column("id", sa.Integer(), primary_key=True),
        user_id_column(),
        sa.Column("trade_id", sa.Integer(), sa.ForeignKey("canonical_trades.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tag_id", sa.Integer(), sa.ForeignKey("journal_tags.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("trade_id", "tag_id", name="uq_canonical_trade_tags_trade_tag"),
    )
    op.create_index("ix_canonical_trade_tags_user_id", "canonical_trade_tags", ["user_id"])
    op.create_index("ix_canonical_trade_tags_trade_id", "canonical_trade_tags", ["trade_id"])
    op.create_index("ix_canonical_trade_tags_tag_id", "canonical_trade_tags", ["tag_id"])
    op.create_index("ix_canonical_trade_tags_user_tag_trade", "canonical_trade_tags", ["user_id", "tag_id", "trade_id"])

    op.create_table(
        "canonical_trade_notes",
        sa.Column("id", sa.Integer(), primary_key=True),
        user_id_column(),
        sa.Column("trade_id", sa.Integer(), sa.ForeignKey("canonical_trades.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_canonical_trade_notes_user_id", "canonical_trade_notes", ["user_id"])
    op.create_index("ix_canonical_trade_notes_trade_id", "canonical_trade_notes", ["trade_id"])
    op.create_index("ix_canonical_trade_notes_user_trade", "canonical_trade_notes", ["user_id", "trade_id", "created_at"])

    op.create_table(
        "canonical_trade_screenshots",
        sa.Column("id", sa.Integer(), primary_key=True),
        user_id_column(),
        sa.Column("trade_id", sa.Integer(), sa.ForeignKey("canonical_trades.id", ondelete="CASCADE"), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("caption", sa.String(length=240), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_canonical_trade_screenshots_user_id", "canonical_trade_screenshots", ["user_id"])
    op.create_index("ix_canonical_trade_screenshots_trade_id", "canonical_trade_screenshots", ["trade_id"])
    op.create_index("ix_canonical_trade_screenshots_user_trade", "canonical_trade_screenshots", ["user_id", "trade_id", "created_at"])

    op.create_table(
        "journal_daily_notes",
        sa.Column("id", sa.Integer(), primary_key=True),
        user_id_column(),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("journal_accounts.id", ondelete="CASCADE"), nullable=True),
        sa.Column("account_scope_key", sa.String(length=32), nullable=False),
        sa.Column("note_date", sa.Date(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("user_id", "note_date", "account_scope_key", name="uq_journal_daily_notes_user_date_scope"),
    )
    op.create_index("ix_journal_daily_notes_user_id", "journal_daily_notes", ["user_id"])
    op.create_index("ix_journal_daily_notes_account_id", "journal_daily_notes", ["account_id"])
    op.create_index("ix_journal_daily_notes_note_date", "journal_daily_notes", ["note_date"])
    op.create_index("ix_journal_daily_notes_user_date", "journal_daily_notes", ["user_id", "note_date", "id"])

    op.create_table(
        "journal_import_rows",
        sa.Column("id", sa.Integer(), primary_key=True),
        user_id_column(),
        sa.Column("run_id", sa.Integer(), sa.ForeignKey("journal_import_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("trade_id", sa.Integer(), sa.ForeignKey("canonical_trades.id", ondelete="SET NULL"), nullable=True),
        sa.Column("row_number", sa.Integer(), nullable=False),
        sa.Column("group_key", sa.String(length=240), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("duplicate_key", sa.String(length=64), nullable=True),
        sa.Column("source_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("normalized_payload", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("run_id", "row_number", name="uq_journal_import_rows_run_row"),
    )
    op.create_index("ix_journal_import_rows_user_id", "journal_import_rows", ["user_id"])
    op.create_index("ix_journal_import_rows_run_id", "journal_import_rows", ["run_id"])
    op.create_index("ix_journal_import_rows_trade_id", "journal_import_rows", ["trade_id"])
    op.create_index("ix_journal_import_rows_status", "journal_import_rows", ["status"])
    op.create_index("ix_journal_import_rows_duplicate_key", "journal_import_rows", ["duplicate_key"])
    op.create_index("ix_journal_import_rows_user_run_status", "journal_import_rows", ["user_id", "run_id", "status"])

    op.create_table(
        "journal_import_diagnostics",
        sa.Column("id", sa.Integer(), primary_key=True),
        user_id_column(),
        sa.Column("run_id", sa.Integer(), sa.ForeignKey("journal_import_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("row_number", sa.Integer(), nullable=True),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("field", sa.String(length=80), nullable=True),
        sa.Column("message", sa.String(length=500), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_journal_import_diagnostics_user_id", "journal_import_diagnostics", ["user_id"])
    op.create_index("ix_journal_import_diagnostics_run_id", "journal_import_diagnostics", ["run_id"])
    op.create_index("ix_journal_import_diagnostics_user_run", "journal_import_diagnostics", ["user_id", "run_id", "id"])

    op.create_table(
        "journal_backfill_checkpoints",
        sa.Column("id", sa.Integer(), primary_key=True),
        user_id_column(),
        sa.Column("source_key", sa.String(length=240), nullable=False),
        sa.Column("source_digest", sa.String(length=64), nullable=False),
        sa.Column("accounts_created", sa.Integer(), nullable=False),
        sa.Column("trades_created", sa.Integer(), nullable=False),
        sa.Column("diagnostics", sa.JSON(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("user_id", "source_key", name="uq_journal_backfill_user_source"),
    )
    op.create_index("ix_journal_backfill_checkpoints_user_id", "journal_backfill_checkpoints", ["user_id"])


def downgrade() -> None:
    for table_name in (
        "journal_backfill_checkpoints",
        "journal_import_diagnostics",
        "journal_import_rows",
        "journal_daily_notes",
        "canonical_trade_screenshots",
        "canonical_trade_notes",
        "canonical_trade_tags",
        "journal_tags",
        "canonical_executions",
        "canonical_trades",
        "journal_import_runs",
        "journal_accounts",
    ):
        op.drop_table(table_name)
