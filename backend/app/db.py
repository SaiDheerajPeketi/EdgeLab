from collections.abc import Generator

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


SCHEMA_VERSION = 2


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


def _sqlite_schema_version() -> int:
    with engine.connect() as connection:
        return int(connection.execute(text("PRAGMA user_version")).scalar_one())


def _set_sqlite_schema_version(version: int) -> None:
    with engine.begin() as connection:
        connection.execute(text(f"PRAGMA user_version = {int(version)}"))


def init_db() -> None:
    from app import models  # noqa: F401

    if settings.database_url.startswith("sqlite"):
        current_version = _sqlite_schema_version()
        if current_version != SCHEMA_VERSION:
            Base.metadata.drop_all(bind=engine)
            Base.metadata.create_all(bind=engine)
            _set_sqlite_schema_version(SCHEMA_VERSION)
            return

    Base.metadata.create_all(bind=engine)
