from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import database_connect_args, database_engine_options, settings


engine_kwargs = database_engine_options(settings.database_url)
connect_args = database_connect_args(settings.database_url)

engine = create_engine(settings.database_url, connect_args=connect_args, **engine_kwargs)


# sqlite connect(timeout=...) already sets PRAGMA busy_timeout; do not override
# the operator-selected lock deadline after the driver opens a connection.
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
