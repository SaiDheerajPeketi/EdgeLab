from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


engine_kwargs = {"pool_pre_ping": True}
connect_args = (
    {"check_same_thread": False, "timeout": 60}
    if settings.database_url.startswith("sqlite")
    else {}
)

if not settings.database_url.startswith("sqlite"):
    engine_kwargs["pool_recycle"] = 1800

engine = create_engine(settings.database_url, connect_args=connect_args, **engine_kwargs)


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
