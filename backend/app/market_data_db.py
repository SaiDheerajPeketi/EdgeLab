from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings


def _engine_for_url(database_url: str):
    engine_kwargs = {"pool_pre_ping": True}
    connect_args = (
        {"check_same_thread": False, "timeout": 60}
        if database_url.startswith("sqlite")
        else {}
    )
    if not database_url.startswith("sqlite"):
        engine_kwargs["pool_recycle"] = 1800
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


def get_market_data_db() -> Generator[Session, None, None]:
    db = MarketDataSessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_market_data_db() -> None:
    from app.models import MarketCandle

    MarketCandle.__table__.create(bind=market_data_engine, checkfirst=True)
