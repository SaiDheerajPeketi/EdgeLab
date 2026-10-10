"""Bounded writes and transaction ownership for production background work."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
import os
import subprocess
import sys
from threading import Event
from uuid import uuid4

import pandas as pd
import pytest
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app import analytics_worker
from app.db import Base
from app.models import BetaUser, DatasetAsset, DatasetTimeframe, MarketCandle
from app.services import market_data_imports as imports


@pytest.fixture
def sessions(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'workers.db'}")
    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine)
    engine.dispose()


@pytest.fixture
def postgres_sessions():
    url = os.getenv("EDGELAB_TEST_POSTGRES_URL", "")
    if not url:
        pytest.skip("Set EDGELAB_TEST_POSTGRES_URL for real PostgreSQL contention tests")
    schema = f"worker209_{uuid4().hex}"
    engine = create_engine(url, connect_args={"prepare_threshold": None}, pool_size=4, max_overflow=0)
    with engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    isolated = engine.execution_options(schema_translate_map={None: schema})
    try:
        Base.metadata.create_all(isolated)
        yield sessionmaker(bind=isolated)
    finally:
        with engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        engine.dispose()


def seed_dataset(sessions, csv_path, rows):
    write_csv(csv_path, rows)
    with sessions() as db:
        user = BetaUser(email=f"{uuid4().hex}@worker.test", name="Worker", provider="google", status="APPROVED")
        db.add(user)
        db.flush()
        asset = DatasetAsset(user_id=user.id, asset_key="EUR_USD", name="EUR/USD", symbol="EURUSD", folder_path=str(csv_path.parent))
        db.add(asset)
        db.flush()
        timeframe = DatasetTimeframe(user_id=user.id, asset_id=asset.id, timeframe="M1", csv_path=str(csv_path), rows=len(rows))
        db.add(timeframe)
        db.commit()
        return user.id, asset.id


def write_csv(csv_path, minutes):
    epoch = datetime(2024, 1, 1)
    csv_path.write_text(
        "Timestamp,Open,High,Low,Close,Volume,Ignored\n" + "".join(
            f"{epoch + timedelta(minutes=minute)},1,3,0,2,{minute},extra\n"
            for minute in minutes
        ), encoding="utf-8",
    )


def run_import(sessions, user_id):
    with sessions() as db:
        result = imports.import_market_data_to_db(db, user_id=user_id)
        db.commit()
        return result


def test_bulk_import_preserves_csv_offsets_and_bounds_mapping_batches(sessions, tmp_path, monkeypatch):
    user_id, asset_id = seed_dataset(sessions, tmp_path / "bars.csv", [3, 1, 4, 0, 2])
    monkeypatch.setattr(imports, "IMPORT_BATCH_SIZE", 2)
    monkeypatch.setattr(pd.DataFrame, "to_dict", lambda *_a, **_kw: pytest.fail("Full-frame records must not be materialized"))
    batch_sizes = []
    with sessions() as db:
        original = db.execute

        def record(statement, parameters=None, **kwargs):
            if getattr(statement, "is_insert", False) and statement.table.name == "market_candles":
                batch_sizes.append(len(parameters))
            return original(statement, parameters, **kwargs)

        monkeypatch.setattr(db, "execute", record)
        result = imports.import_market_data_to_db(db, user_id=user_id)
        db.commit()
        rows = db.scalars(select(MarketCandle).where(MarketCandle.asset_id == asset_id).order_by(MarketCandle.offset)).all()
        assert batch_sizes == [2, 2, 1]
        assert [row.offset for row in rows] == [0, 1, 2, 3, 4]
        assert [row.timestamp.minute for row in rows] == [3, 1, 4, 0, 2]
        assert all(row.created_at is not None and row.close == 2 for row in rows)
        assert result["candles"] == 5


def test_failed_dedicated_import_rolls_back_earlier_batches(sessions, tmp_path, monkeypatch):
    user_id, _ = seed_dataset(sessions, tmp_path / "duplicates.csv", [0, 1, 1])
    market_engine = create_engine(f"sqlite:///{tmp_path / 'market.db'}")
    market_sessions = sessionmaker(bind=market_engine)
    monkeypatch.setattr(imports, "IMPORT_BATCH_SIZE", 2)
    try:
        with sessions() as db:
            with pytest.raises(IntegrityError):
                imports.import_market_data_to_db(db, user_id=user_id, market_data_session_factory=market_sessions)
            db.rollback()
        with market_sessions() as db:
            assert db.scalar(select(func.count()).select_from(MarketCandle)) == 0
        with sessions() as db:
            assert db.scalar(select(DatasetTimeframe.database_imported)) is False
    finally:
        market_engine.dispose()


def test_analytics_commits_accounts_separately_and_rolls_back_failed_account(sessions, monkeypatch):
    with sessions() as db:
        users = [BetaUser(email=f"{index}@worker.test", name="Original", provider="google", status="APPROVED") for index in range(3)]
        db.add_all(users)
        db.commit()
        ids = [user.id for user in users]
    monkeypatch.setattr(analytics_worker, "SessionLocal", sessions)

    def refresh(db, user_id):
        db.get(BetaUser, user_id).name = "Refreshed"
        return 1

    def dashboard(db, user_id):
        if user_id == ids[1]:
            db.flush()
            raise RuntimeError("Account refresh failed")

    monkeypatch.setattr(analytics_worker, "refresh_user_session_summaries", refresh)
    monkeypatch.setattr(analytics_worker, "refresh_user_dashboard_summary", dashboard)
    with pytest.raises(RuntimeError, match="Account refresh failed"):
        analytics_worker.run_once()
    with sessions() as db:
        assert [db.get(BetaUser, user_id).name for user_id in ids] == ["Refreshed", "Original", "Original"]


def test_sqlite_analytics_closes_page_reads_before_account_commits(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'analytics-pages.db'}", connect_args={"timeout": 0.05})
    factory = sessionmaker(bind=engine)
    total = analytics_worker.ANALYTICS_USER_BATCH_SIZE + 1
    try:
        Base.metadata.create_all(engine)
        with factory() as db:
            db.add_all([
                BetaUser(email=f"{index}@pages.test", name="Original", provider="google", status="APPROVED")
                for index in range(total)
            ])
            db.commit()
        monkeypatch.setattr(analytics_worker, "SessionLocal", factory)

        def refresh(db, user_id):
            db.get(BetaUser, user_id).name = "Refreshed"
            return 1

        monkeypatch.setattr(analytics_worker, "refresh_user_session_summaries", refresh)
        monkeypatch.setattr(analytics_worker, "refresh_user_dashboard_summary", lambda *_args: None)
        assert analytics_worker.run_once() == {
            "session_summaries_refreshed": total,
            "dashboard_summaries_refreshed": total,
        }
        with factory() as db:
            assert db.scalars(select(BetaUser.name)).all() == ["Refreshed"] * total
    finally:
        engine.dispose()


def test_postgres_importers_serialize_check_and_write(postgres_sessions, tmp_path, monkeypatch):
    user_id, asset_id = seed_dataset(postgres_sessions, tmp_path / "concurrent.csv", [0, 1, 2])
    first_checked, release_first, second_lock_attempted = Event(), Event(), Event()
    original_state = imports._existing_import_state
    original_lock = imports._lock_imports
    checks = []

    def read_state(db, **kwargs):
        state = original_state(db, **kwargs)
        checks.append(state.rows)
        if len(checks) == 1:
            first_checked.set()
            assert release_first.wait(10)
        return state

    def lock(db, owner, timeframes):
        if first_checked.is_set():
            second_lock_attempted.set()
        return original_lock(db, owner, timeframes)

    monkeypatch.setattr(imports, "_existing_import_state", read_state)
    monkeypatch.setattr(imports, "_lock_imports", lock)
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(run_import, postgres_sessions, user_id)
        try:
            assert first_checked.wait(10)
            second = executor.submit(run_import, postgres_sessions, user_id)
            assert second_lock_attempted.wait(10)
            assert not second.done()
            assert checks == [0]
        finally:
            release_first.set()
        assert first.result(timeout=10)["candles"] == 3
        assert second.result(timeout=10)["candles"] == 0
    assert checks == [0, 3]
    with postgres_sessions() as db:
        assert db.scalar(select(func.count()).select_from(MarketCandle).where(MarketCandle.asset_id == asset_id)) == 3


def test_same_database_runtime_reuses_catalog_engine():
    env = os.environ.copy()
    env["DATABASE_URL"] = env["EDGELAB_MARKET_DATA_DATABASE_URL"] = "postgresql+psycopg://fixture:fixture@127.0.0.1/fixture"
    result = subprocess.run(
        [sys.executable, "-c", "from app.db import engine; from app.market_data_db import market_data_engine; assert engine is market_data_engine"],
        env=env, capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr


def test_postgres_shared_import_sees_uncommitted_asset_and_rolls_back_together(postgres_sessions, tmp_path):
    csv_path = tmp_path / "new-asset.csv"
    write_csv(csv_path, [0, 1, 2])
    with postgres_sessions() as db:
        user = BetaUser(email="new-asset@worker.test", name="Worker", provider="google", status="APPROVED")
        db.add(user)
        db.flush()
        asset = DatasetAsset(user_id=user.id, asset_key="EUR_USD", name="EUR/USD", symbol="EURUSD", folder_path=str(tmp_path))
        db.add(asset)
        db.flush()
        db.add(DatasetTimeframe(user_id=user.id, asset_id=asset.id, timeframe="M1", csv_path=str(csv_path), rows=3))
        db.flush()
        result = imports.import_market_data_to_db(db, user_id=user.id, market_data_session_factory=postgres_sessions)
        assert result["candles"] == 3
        assert db.scalar(select(func.count()).select_from(MarketCandle)) == 3
        db.rollback()
    with postgres_sessions() as db:
        assert db.scalar(select(func.count()).select_from(MarketCandle)) == 0
        assert db.scalar(select(func.count()).select_from(DatasetAsset)) == 0


@pytest.mark.parametrize("fail", [False, True], ids=["commit", "rollback"])
def test_postgres_analytics_skips_duplicate_sweep_and_releases_lock(postgres_sessions, monkeypatch, fail):
    with postgres_sessions() as db:
        db.add(BetaUser(email="sweep@worker.test", name="Worker", provider="google", status="APPROVED"))
        db.commit()
    monkeypatch.setattr(analytics_worker, "SessionLocal", postgres_sessions)
    entered, release = Event(), Event()

    def refresh(_db, _user_id):
        entered.set()
        assert release.wait(10)
        if fail:
            raise RuntimeError("Refresh failed")
        return 1

    monkeypatch.setattr(analytics_worker, "refresh_user_session_summaries", refresh)
    monkeypatch.setattr(analytics_worker, "refresh_user_dashboard_summary", lambda *_args: None)
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(analytics_worker.run_once)
        try:
            assert entered.wait(10)
            second = executor.submit(analytics_worker.run_once)
            assert second.result(timeout=5) == {"session_summaries_refreshed": 0, "dashboard_summaries_refreshed": 0}
        finally:
            release.set()
        if fail:
            with pytest.raises(RuntimeError, match="Refresh failed"):
                first.result(timeout=10)
        else:
            assert first.result(timeout=10)["dashboard_summaries_refreshed"] == 1
    monkeypatch.setattr(analytics_worker, "refresh_user_session_summaries", lambda *_args: 1)
    assert analytics_worker.run_once()["dashboard_summaries_refreshed"] == 1
