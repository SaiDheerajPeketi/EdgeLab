from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import database_connect_args, database_engine_options, settings


engine_kwargs = database_engine_options(settings.database_url)
connect_args = database_connect_args(settings.database_url)

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
    if engine.dialect.name == "sqlite":
        from app.migrations import migrate_google_subject
        migrate_google_subject(engine)
