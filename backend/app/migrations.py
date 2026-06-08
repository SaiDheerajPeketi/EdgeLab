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


MIGRATIONS = [
    Migration(1, "sqlite_compat_columns", migrate_sqlite_compat_columns),
]
