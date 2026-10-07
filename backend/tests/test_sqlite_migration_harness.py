from pathlib import Path

from alembic import command
from alembic.config import Config
import sqlalchemy as sa
import pytest
from sqlalchemy import inspect
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import AppDataOperation, AppStorageItem, BacktestSession, BetaUser, Trade
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
        assert connection.execute(sa.text("SELECT version_num FROM alembic_version")).scalar_one() == "20261007_0017"
    assert "google_subject" in {column["name"] for column in inspector.get_columns("beta_users")}
    assert "backtest_session_summaries" in inspector.get_table_names()
    assert "ai_generation_jobs" in inspector.get_table_names()
    assert "app_data_operations" in inspector.get_table_names()
    billing_tables = {"billing_customers", "billing_subscriptions", "billing_webhook_events"}
    assert billing_tables <= set(inspector.get_table_names())
    assert "verified_at" in {column["name"] for column in inspector.get_columns("billing_customers")}

    command.downgrade(config, "20261007_0015")
    assert billing_tables.isdisjoint(inspect(engine).get_table_names())
    assert "beta_users" in inspect(engine).get_table_names()
    command.upgrade(config, "head")
    assert billing_tables <= set(inspect(engine).get_table_names())


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
        source_db.add(AppDataOperation(
            user_id=user.id, operation_id="00000000-0000-4000-8000-000000000001",
            status="canceled", completed_at=user.created_at,
        ))
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
    assert summary["migrated_rows"]["app_data_operations"] == 1
    assert summary["tables"]["app_storage"]["counts_match"] is True
    assert summary["tables"]["app_storage"]["sample_rows_match"] is True

    with target_session_factory() as target_db:
        assert target_db.scalar(select(BetaUser.email)) == "trader@example.com"
        stored_value = target_db.scalar(select(AppStorageItem.value))
        assert stored_value == {"panes": ["results", "journal"]}
        receipt = target_db.scalar(select(AppDataOperation))
        assert receipt.operation_id == "00000000-0000-4000-8000-000000000001"
        assert receipt.status == "canceled"
        assert receipt.completed_at is not None


def test_google_subject_additive_upgrade_downgrade_reupgrade_preserves_existing_identity(tmp_path, monkeypatch):
    database_url = f"sqlite:///{tmp_path / 'google-subject.db'}"
    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "alembic"))
    monkeypatch.setenv("DATABASE_URL", database_url)
    command.upgrade(config, "20261007_0016")
    engine = _sqlite_engine(database_url)
    assert "google_subject" not in {c["name"] for c in inspect(engine).get_columns("beta_users")}
    with engine.begin() as connection:
        connection.execute(sa.text("""INSERT INTO beta_users
            (id,email,name,provider,status,beta_position,created_at,updated_at)
            VALUES (37,'legacy-google@example.test','Existing Trader','google','APPROVED',4,
                    '2026-01-01 00:00:00','2026-01-02 00:00:00')"""))
        connection.execute(sa.text("""INSERT INTO app_storage
            (id,user_id,namespace,key,value,created_at,updated_at)
            VALUES (91,37,'workspace','native-source','{"original":"saved"}',
                    '2026-01-01 00:00:00','2026-01-02 00:00:00')"""))
        original = connection.execute(sa.text("SELECT id,email,name,provider,status,beta_position,created_at,updated_at FROM beta_users WHERE id=37")).one()
    def preserved():
        with engine.connect() as connection:
            assert connection.execute(sa.text("SELECT id,email,name,provider,status,beta_position,created_at,updated_at FROM beta_users WHERE id=37")).one() == original
            assert connection.execute(sa.text("SELECT user_id,value FROM app_storage WHERE id=91")).one() == (37, '{"original":"saved"}')
    command.upgrade(config, "20261007_0017")
    preserved()
    with engine.begin() as connection:
        assert connection.execute(sa.text("SELECT google_subject FROM beta_users WHERE id=37")).scalar_one() is None
        connection.execute(sa.text("UPDATE beta_users SET google_subject='verified-subject' WHERE id=37"))
    with pytest.raises(sa.exc.IntegrityError), engine.begin() as connection:
        connection.execute(sa.text("""INSERT INTO beta_users
            (id,email,name,provider,status,google_subject,created_at,updated_at)
            VALUES (38,'collision@example.test','Collision','google','PUBLIC','verified-subject',
                    '2026-01-01 00:00:00','2026-01-02 00:00:00')"""))
    command.downgrade(config, "20261007_0016")
    assert "google_subject" not in {c["name"] for c in inspect(engine).get_columns("beta_users")}
    preserved()
    command.upgrade(config, "head")
    preserved()
    with engine.connect() as connection:
        assert connection.execute(sa.text("SELECT google_subject FROM beta_users WHERE id=37")).scalar_one() is None
        assert connection.execute(sa.text("SELECT version_num FROM alembic_version")).scalar_one() == "20261007_0017"
    engine.dispose()
