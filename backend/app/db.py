from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


connect_args = (
    {"check_same_thread": False}
    if settings.database_url.startswith("sqlite")
    else {}
)

engine = create_engine(settings.database_url, connect_args=connect_args)
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
    if "backtest_sessions" not in inspector.get_table_names():
        return

    existing = {column["name"] for column in inspector.get_columns("backtest_sessions")}
    additions = {
        "instrument": "VARCHAR(80)",
        "timeframe": "VARCHAR(20)",
        "csv_path": "TEXT",
        "currency": "VARCHAR(12)",
        "timezone": "VARCHAR(80)",
        "strategy_name": "VARCHAR(120)",
        "playbook_id": "INTEGER",
        "start_at": "DATETIME",
        "end_at": "DATETIME",
        "start_offset": "INTEGER DEFAULT 0 NOT NULL",
        "end_offset": "INTEGER",
    }
    with engine.begin() as connection:
        for column, definition in additions.items():
            if column not in existing:
                connection.execute(
                    text(f"ALTER TABLE backtest_sessions ADD COLUMN {column} {definition}")
                )
