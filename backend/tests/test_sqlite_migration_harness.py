from pathlib import Path

from alembic import command
from alembic.config import Config
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import AppStorageItem, BacktestSession, BetaUser, Trade
from backend.scripts.migrate_sqlite_to_database import migrate_sqlite_to_database


def _sqlite_engine(database_url: str):
    return create_engine(database_url, connect_args={"check_same_thread": False})


def test_empty_sqlite_database_upgrades_to_alembic_head(tmp_path, monkeypatch):
    database_url = f"sqlite:///{tmp_path / 'alembic-head.db'}"
    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "alembic"))
    monkeypatch.setenv("DATABASE_URL", database_url)

    command.upgrade(config, "head")

    engine = _sqlite_engine(database_url)
    inspector = inspect(engine)
    with engine.connect() as connection:
        assert connection.execute(sa.text("SELECT version_num FROM alembic_version")).scalar_one() == "20260915_0014"
    assert "backtest_session_summaries" in inspector.get_table_names()
    assert "ai_generation_jobs" in inspector.get_table_names()


def test_migrate_sqlite_to_database_copies_rows_and_verifies_samples(tmp_path):
    source_url = f"sqlite:///{tmp_path / 'source.db'}"
    target_url = f"sqlite:///{tmp_path / 'target.db'}"

    source_engine = _sqlite_engine(source_url)
    target_engine = _sqlite_engine(target_url)
    Base.metadata.create_all(source_engine)
    Base.metadata.create_all(target_engine)
    source_session_factory = sessionmaker(bind=source_engine)
    target_session_factory = sessionmaker(bind=target_engine)

    with source_session_factory() as source_db:
        user = BetaUser(
            email="trader@example.com",
            name="Trader",
            provider="email",
            status="APPROVED",
            beta_position=1,
        )
        source_db.add(user)
        source_db.flush()

        session = BacktestSession(
            user_id=user.id,
            name="Replay A",
            symbol="EURUSD",
            instrument="EURUSD",
            timeframe="M1",
            csv_path="/datasets/EURUSD_M1.csv",
            current_offset=10,
            replay_ready=True,
            end_offset=10,
        )
        source_db.add(session)
        source_db.flush()

        source_db.add(
            Trade(
                user_id=user.id,
                session_id=session.id,
                status="CLOSED",
                side="LONG",
                entry_time=session.created_at,
                entry_offset=1,
                entry_price=1.1,
                quantity=1.0,
                remaining_quantity=0.0,
                exit_time=session.created_at,
                exit_offset=2,
                exit_price=1.2,
                realized_pnl=12.5,
            )
        )
        source_db.add(
            AppStorageItem(
                user_id=user.id,
                namespace="workspace",
                key="layout",
                value={"panes": ["results", "journal"]},
            )
        )
        source_db.commit()

    with target_session_factory() as target_db:
        target_db.add(
            BetaUser(
                email="stale@example.com",
                name="Stale",
                provider="email",
                status="WAITLISTED",
            )
        )
        target_db.commit()

    summary = migrate_sqlite_to_database(
        source_url,
        target_url,
        batch_size=1,
        sample_size=2,
        reset_target=True,
    )

    assert summary["ok"] is True
    assert summary["migrated_rows"]["beta_users"] == 1
    assert summary["migrated_rows"]["backtest_sessions"] == 1
    assert summary["migrated_rows"]["trades"] == 1
    assert summary["tables"]["app_storage"]["counts_match"] is True
    assert summary["tables"]["app_storage"]["sample_rows_match"] is True

    with target_session_factory() as target_db:
        assert target_db.scalar(select(BetaUser.email)) == "trader@example.com"
        stored_value = target_db.scalar(select(AppStorageItem.value))
        assert stored_value == {"panes": ["results", "journal"]}
