from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import Engine, inspect, text


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    apply: Callable[[Engine], None]


def run_migrations(engine: Engine, database_url: str) -> None:
    if not database_url.startswith("sqlite"):
        return

    with engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    applied_at TEXT NOT NULL
                )
                """
            )
        )
        applied_versions = {
            row[0]
            for row in connection.execute(text("SELECT version FROM schema_migrations"))
        }

    for migration in MIGRATIONS:
        if migration.version in applied_versions:
            continue
        migration.apply(engine)
        with engine.begin() as connection:
            connection.execute(
                text(
                    """
                    INSERT INTO schema_migrations (version, name, applied_at)
                    VALUES (:version, :name, :applied_at)
                    """
                ),
                {
                    "version": migration.version,
                    "name": migration.name,
                    "applied_at": datetime.now(timezone.utc).isoformat(),
                },
            )


def migrate_sqlite_compat_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    with engine.begin() as connection:
        if "backtest_sessions" in tables:
            add_missing_columns(
                connection,
                inspector,
                "backtest_sessions",
                {
                    "instrument": "VARCHAR(80)",
                    "timeframe": "VARCHAR(20)",
                    "csv_path": "TEXT",
                    "currency": "VARCHAR(12)",
                    "timezone": "VARCHAR(80)",
                    "pnl_multiplier": "FLOAT DEFAULT 1.0 NOT NULL",
                    "strategy_name": "VARCHAR(120)",
                    "playbook_id": "INTEGER",
                    "start_at": "DATETIME",
                    "end_at": "DATETIME",
                    "start_offset": "INTEGER DEFAULT 0 NOT NULL",
                    "end_offset": "INTEGER",
                    "default_commission_mode": "VARCHAR(16) DEFAULT 'NONE' NOT NULL",
                    "default_commission_value": "FLOAT DEFAULT 0.0 NOT NULL",
                    "default_fee_mode": "VARCHAR(16) DEFAULT 'NONE' NOT NULL",
                    "default_fee_value": "FLOAT DEFAULT 0.0 NOT NULL",
                },
            )
        if "orders" in tables:
            add_missing_columns(
                connection,
                inspector,
                "orders",
                {
                    "commission_mode": "VARCHAR(16) DEFAULT 'NONE' NOT NULL",
                    "commission_value": "FLOAT DEFAULT 0.0 NOT NULL",
                    "fee_mode": "VARCHAR(16) DEFAULT 'NONE' NOT NULL",
                    "fee_value": "FLOAT DEFAULT 0.0 NOT NULL",
                },
            )
        if "trades" in tables:
            add_missing_columns(
                connection,
                inspector,
                "trades",
                {
                    "gross_pnl": "FLOAT",
                    "commission_mode": "VARCHAR(16) DEFAULT 'NONE' NOT NULL",
                    "commission_value": "FLOAT DEFAULT 0.0 NOT NULL",
                    "commission_amount": "FLOAT DEFAULT 0.0 NOT NULL",
                    "fee_mode": "VARCHAR(16) DEFAULT 'NONE' NOT NULL",
                    "fee_value": "FLOAT DEFAULT 0.0 NOT NULL",
                    "fee_amount": "FLOAT DEFAULT 0.0 NOT NULL",
                },
            )
        if "dataset_assets" in tables:
            add_missing_columns(
                connection,
                inspector,
                "dataset_assets",
                {
                    "pnl_multiplier": "FLOAT DEFAULT 1.0 NOT NULL",
                },
            )
        if "dataset_timeframes" in tables:
            add_missing_columns(
                connection,
                inspector,
                "dataset_timeframes",
                {
                    "imported": "BOOLEAN DEFAULT 1 NOT NULL",
                },
            )


def add_missing_columns(connection, inspector, table_name: str, additions: dict[str, str]) -> None:
    existing = {column["name"] for column in inspector.get_columns(table_name)}
    for column, definition in additions.items():
        if column not in existing:
            connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column} {definition}"))


def create_workspace_share_snapshots_table(engine: Engine) -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS workspace_share_snapshots (
                    id INTEGER PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    workspace_key VARCHAR(96) NOT NULL,
                    snapshot_version INTEGER NOT NULL,
                    schema_version INTEGER NOT NULL DEFAULT 1,
                    scope VARCHAR(32) NOT NULL,
                    title VARCHAR(160) NOT NULL,
                    recipient_user_id INTEGER,
                    recipient_email VARCHAR(320),
                    token_digest VARCHAR(64) NOT NULL UNIQUE,
                    payload JSON NOT NULL,
                    expires_at DATETIME,
                    revoked_at DATETIME,
                    created_at DATETIME NOT NULL,
                    CONSTRAINT uq_workspace_share_snapshots_user_workspace_version
                        UNIQUE (user_id, workspace_key, snapshot_version),
                    FOREIGN KEY(user_id) REFERENCES beta_users (id) ON DELETE CASCADE,
                    FOREIGN KEY(recipient_user_id) REFERENCES beta_users (id) ON DELETE SET NULL
                )
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS ix_workspace_share_snapshots_user_created_id
                ON workspace_share_snapshots (user_id, created_at, id)
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS ix_workspace_share_snapshots_token_digest
                ON workspace_share_snapshots (token_digest)
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS ix_workspace_share_snapshots_recipient_user_id
                ON workspace_share_snapshots (recipient_user_id)
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS ix_workspace_share_snapshots_recipient_email
                ON workspace_share_snapshots (recipient_email)
                """
            )
        )


def create_integration_secrets_table(engine: Engine) -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS integration_secrets (
                    id INTEGER PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    provider VARCHAR(64) NOT NULL,
                    purpose VARCHAR(64) NOT NULL,
                    key_id VARCHAR(64) NOT NULL,
                    cipher_version INTEGER NOT NULL DEFAULT 1,
                    version INTEGER NOT NULL DEFAULT 1,
                    nonce BLOB NOT NULL,
                    ciphertext BLOB NOT NULL,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    rotated_at DATETIME,
                    last_connected_at DATETIME,
                    revoked_at DATETIME,
                    CONSTRAINT uq_integration_secrets_user_provider_purpose
                        UNIQUE (user_id, provider, purpose),
                    FOREIGN KEY(user_id) REFERENCES beta_users (id) ON DELETE CASCADE
                )
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS ix_integration_secrets_user_updated_id
                ON integration_secrets (user_id, updated_at, id)
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS ix_integration_secrets_key_id
                ON integration_secrets (key_id)
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS ix_integration_secrets_revoked_at
                ON integration_secrets (revoked_at)
                """
            )
        )


def create_broker_sync_tables(engine: Engine) -> None:
    from app.models import (
        BrokerAccount,
        BrokerAuditLog,
        BrokerConnection,
        BrokerFill,
        BrokerOrder,
        BrokerPositionSnapshot,
        BrokerSyncCursor,
        BrokerSyncJob,
    )

    for model in (
        BrokerConnection,
        BrokerAccount,
        BrokerSyncCursor,
        BrokerOrder,
        BrokerFill,
        BrokerPositionSnapshot,
        BrokerSyncJob,
        BrokerAuditLog,
    ):
        model.__table__.create(bind=engine, checkfirst=True)


MIGRATIONS = [
    Migration(1, "sqlite_compat_columns", migrate_sqlite_compat_columns),
    Migration(2, "workspace_share_snapshots", create_workspace_share_snapshots_table),
    Migration(3, "integration_secrets", create_integration_secrets_table),
    Migration(4, "broker_sync_foundation", create_broker_sync_tables),
]
