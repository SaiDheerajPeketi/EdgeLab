from collections.abc import Generator

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


connect_args = (
    {"check_same_thread": False, "timeout": 60}
    if settings.database_url.startswith("sqlite")
    else {}
)

engine = create_engine(settings.database_url, connect_args=connect_args)


if settings.database_url.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragmas(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA busy_timeout = 60000")
        cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _migrate_sqlite_columns()


def _migrate_sqlite_columns() -> None:
    if not settings.database_url.startswith("sqlite"):
        return

    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    with engine.begin() as connection:
        if "backtest_sessions" in tables:
            _add_missing_columns(
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
                },
            )
        if "dataset_assets" in tables:
            _add_missing_columns(
                connection,
                inspector,
                "dataset_assets",
                {
                    "pnl_multiplier": "FLOAT DEFAULT 1.0 NOT NULL",
                },
            )
        if "dataset_timeframes" in tables:
            _add_missing_columns(
                connection,
                inspector,
                "dataset_timeframes",
                {
                    "imported": "BOOLEAN DEFAULT 1 NOT NULL",
                },
            )


def _add_missing_columns(connection, inspector, table_name: str, additions: dict[str, str]) -> None:
    existing = {column["name"] for column in inspector.get_columns(table_name)}
    for column, definition in additions.items():
        if column not in existing:
            connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column} {definition}"))
