from __future__ import annotations

from collections.abc import Generator
import logging

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    UniqueConstraint,
    create_engine,
    event,
    inspect,
    text,
)
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import database_connect_args, database_engine_options, settings
from app.db import engine as application_engine


logger = logging.getLogger(__name__)
_MARKET_DATA_METADATA = MetaData()
_MARKET_CANDLES_TABLE = Table(
    "market_candles",
    _MARKET_DATA_METADATA,
    Column("id", Integer, primary_key=True),
    Column("user_id", Integer, nullable=False, index=True),
    Column("asset_id", Integer, nullable=False, index=True),
    Column("timeframe", String(20), nullable=False, index=True),
    Column("offset", Integer, nullable=False, index=True),
    Column("timestamp", DateTime, nullable=False, index=True),
    Column("open", Float, nullable=False),
    Column("high", Float, nullable=False),
    Column("low", Float, nullable=False),
    Column("close", Float, nullable=False),
    Column("volume", Float, nullable=False),
    Column("created_at", DateTime, nullable=False),
    UniqueConstraint(
        "user_id",
        "asset_id",
        "timeframe",
        "offset",
        name="uq_market_candles_user_asset_timeframe_offset",
    ),
    UniqueConstraint(
        "user_id",
        "asset_id",
        "timeframe",
        "timestamp",
        name="uq_market_candles_user_asset_timeframe_timestamp",
    ),
    Index(
        "ix_market_candles_user_asset_timeframe_offset",
        "user_id",
        "asset_id",
        "timeframe",
        "offset",
    ),
    Index(
        "ix_market_candles_user_asset_timeframe_timestamp",
        "user_id",
        "asset_id",
        "timeframe",
        "timestamp",
    ),
)


def _engine_for_url(database_url: str):
    # Share the caller transaction when candles and account rows use one store.
    # A second connection cannot see newly flushed assets or their foreign keys.
    if database_url == settings.database_url:
        return application_engine
    engine_kwargs = database_engine_options(database_url)
    connect_args = database_connect_args(database_url)
    engine = create_engine(database_url, connect_args=connect_args, **engine_kwargs)
    if database_url.startswith("sqlite"):

        @event.listens_for(engine, "connect")
        def _set_sqlite_pragmas(dbapi_connection, _connection_record) -> None:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA busy_timeout = 60000")
            cursor.close()

    return engine


market_data_engine = _engine_for_url(settings.market_data_database_url)
MarketDataSessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=market_data_engine,
)


def market_candles_table() -> Table:
    return _MARKET_CANDLES_TABLE


def get_market_data_db() -> Generator[Session, None, None]:
    db = MarketDataSessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_market_data_schema(bind: Engine | Connection) -> None:
    _MARKET_DATA_METADATA.create_all(bind=bind, checkfirst=True)
    _ensure_timescaledb_hypertable(bind)


def init_market_data_db() -> None:
    ensure_market_data_schema(market_data_engine)


def _ensure_timescaledb_hypertable(bind: Engine | Connection) -> None:
    dialect = bind.dialect.name
    if dialect != "postgresql":
        return

    inspector = inspect(bind)
    if "market_candles" not in inspector.get_table_names():
        return

    connection = bind.connect() if isinstance(bind, Engine) else bind
    owns_connection = isinstance(bind, Engine)
    try:
        try:
            available = connection.execute(
                text("SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb'")
            ).scalar()
            if not available:
                return
            connection.execute(text("CREATE EXTENSION IF NOT EXISTS timescaledb"))
            connection.execute(
                text(
                    "SELECT create_hypertable("
                    "'market_candles', "
                    "'timestamp', "
                    "if_not_exists => TRUE, "
                    "migrate_data => TRUE"
                    ")"
                )
            )
            if owns_connection:
                connection.commit()
        except Exception as exc:
            if owns_connection:
                connection.rollback()
            logger.warning("TimescaleDB hypertable setup skipped: %s", exc)
    finally:
        if owns_connection:
            connection.close()
