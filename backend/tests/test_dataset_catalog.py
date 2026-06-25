import pytest
from sqlalchemy import BigInteger
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import BacktestSession, BetaUser, DatasetAsset, DatasetTimeframe, MarketCandle
from app.schemas import DatasetAssetUpdate
from app.schemas import DatasetSettingsUpdate
from app.services.datasets import DatasetCatalogService, DatasetRefreshInProgress


def seed_user(db) -> int:
    user = BetaUser(
        email="catalog@edgelab.local",
        name="Catalog Tester",
        provider="google",
        status="APPROVED",
    )
    db.add(user)
    db.commit()
    return user.id


def test_refresh_indexes_asset_timeframe_and_allows_metadata_updates(tmp_path):
    root = tmp_path / "datasets"
    asset_dir = root / "EUR_USD"
    asset_dir.mkdir(parents=True)
    (asset_dir / "EUR_USD_M1.csv").write_text(
        "Timestamp,Open,High,Low,Close,Volume\n"
        "2024-01-01 09:30:00,1.1,1.2,1.0,1.15,100\n"
        "2024-01-01 09:31:00,1.15,1.25,1.05,1.2,125\n",
        encoding="utf-8",
    )

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    service = DatasetCatalogService(root, session_factory)

    with session_factory() as db:
        user_id = seed_user(db)
        response = service.refresh_catalog(db, user_id)

        assert response.summary.assets == 1
        assert response.summary.timeframes == 1
        assert response.summary.candles == 0
        assert response.catalog.instruments[0].id == "EUR_USD"
        assert response.catalog.instruments[0].currency == "USD"
        assert response.catalog.instruments[0].timezone == "UTC"
        assert response.catalog.instruments[0].pnl_multiplier == 1
        assert response.catalog.instruments[0].timeframes[0].timeframe == "M1"
        assert response.catalog.instruments[0].timeframes[0].rows == 2
        assert response.catalog.instruments[0].timeframes[0].imported is False
        assert response.catalog.instruments[0].timeframes[0].database_imported is False
        assert db.query(DatasetAsset).count() == 1
        assert db.query(DatasetTimeframe).count() == 1

        updated = service.update_asset(
            db,
            user_id,
            "EUR_USD",
            DatasetAssetUpdate(currency="eur", timezone="Europe/London", pnl_multiplier=100),
        )

        assert updated.instruments[0].currency == "EUR"
        assert updated.instruments[0].timezone == "Europe/London"
        assert updated.instruments[0].pnl_multiplier == 100


def test_refresh_skips_unchanged_files_after_initial_index(tmp_path):
    root = tmp_path / "datasets"
    asset_dir = root / "NQ"
    asset_dir.mkdir(parents=True)
    (asset_dir / "NQ_M5.csv").write_text(
        "Timestamp,Open,High,Low,Close,Volume\n"
        "2024-01-01 09:30:00,100,101,99,100.5,10\n",
        encoding="utf-8",
    )

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    service = DatasetCatalogService(root, session_factory)

    with session_factory() as db:
        user_id = seed_user(db)
        first = service.refresh_catalog(db, user_id)
        second = service.refresh_catalog(db, user_id)

        assert first.summary.candles == 0
        assert second.summary.candles == 0


def test_refresh_catalog_imports_market_data_when_enabled(tmp_path):
    root = tmp_path / "datasets"
    asset_dir = root / "NQ"
    asset_dir.mkdir(parents=True)
    (asset_dir / "NQ_M5.csv").write_text(
        "Timestamp,Open,High,Low,Close,Volume\n"
        "2024-01-01 09:30:00,100,101,99,100.5,10\n"
        "2024-01-01 09:35:00,100.5,101.5,99.5,101,11\n",
        encoding="utf-8",
    )

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    service = DatasetCatalogService(root, session_factory, market_data_import_enabled=True)

    with session_factory() as db:
        user_id = seed_user(db)
        first = service.refresh_catalog(db, user_id)
        second = service.refresh_catalog(db, user_id)
        timeframe = db.query(DatasetTimeframe).one()

        assert first.summary.candles == 2
        assert second.summary.candles == 0
        assert timeframe.database_imported is True
        assert timeframe.database_imported_at is not None
        assert db.query(MarketCandle).count() == 2


def test_dataset_root_can_be_persisted_and_used_for_refresh(tmp_path):
    first_root = tmp_path / "first"
    second_root = tmp_path / "second"
    first_root.mkdir()
    asset_dir = second_root / "ES"
    asset_dir.mkdir(parents=True)
    (asset_dir / "ES_M1.csv").write_text(
        "Timestamp,Open,High,Low,Close,Volume\n"
        "2024-01-01 09:30:00,4800,4801,4799,4800.5,50\n",
        encoding="utf-8",
    )

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    service = DatasetCatalogService(first_root, session_factory)

    with session_factory() as db:
        user_id = seed_user(db)
        assert service.get_settings(db, user_id).root_path == str(first_root)

        catalog = service.update_settings(
            db,
            user_id,
            DatasetSettingsUpdate(root_path=str(second_root)),
        )
        assert catalog.root == str(second_root)
        assert service.get_settings(db, user_id).root_path == str(second_root)

        refreshed = service.refresh_catalog(db, user_id)
        assert refreshed.summary.assets == 1
        assert refreshed.catalog.root == str(second_root)
        assert refreshed.catalog.instruments[0].id == "ES"


def test_list_catalog_discovers_files_without_importing_candles(tmp_path):
    root = tmp_path / "datasets"
    asset_dir = root / "GBP_USD"
    asset_dir.mkdir(parents=True)
    csv_path = asset_dir / "GBPUSD_M5.csv"
    csv_path.write_text(
        "Timestamp,Open,High,Low,Close,Volume\n"
        "2024-01-01 09:30:00,1.2,1.3,1.1,1.25,100\n"
        "2024-01-01 09:35:00,1.25,1.35,1.15,1.3,150\n",
        encoding="utf-8",
    )

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    service = DatasetCatalogService(root, session_factory)

    with session_factory() as db:
        user_id = seed_user(db)
        catalog = service.list_catalog(db, user_id)
        timeframe = catalog.instruments[0].timeframes[0]
        resolution = service.resolve_dataset(db, user_id, instrument="GBP_USD", timeframe="M5")

        assert catalog.instruments[0].id == "GBP_USD"
        assert timeframe.csv_path == str(csv_path)
        assert timeframe.rows == 2
        assert timeframe.imported is False
        assert timeframe.database_imported is False
        assert resolution.stored is True


def test_list_catalog_uses_stored_catalog_when_auto_discovery_fails(tmp_path, monkeypatch):
    root = tmp_path / "datasets"
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    service = DatasetCatalogService(root, session_factory)

    with session_factory() as db:
        user_id = seed_user(db)
        asset = DatasetAsset(
            user_id=user_id,
            asset_key="GBP_USD",
            name="GBP/USD",
            symbol="GBPUSD",
            folder_path=str(root / "GBP_USD"),
        )
        db.add(asset)
        db.flush()
        db.add(
            DatasetTimeframe(
                user_id=user_id,
                asset_id=asset.id,
                timeframe="M1",
                csv_path=str(root / "GBP_USD" / "GBPUSD_M1.csv"),
                rows=42,
                file_size=100,
                file_mtime_ns=1,
            )
        )
        db.commit()

        def fail_scan(*_args, **_kwargs):
            raise PermissionError("dataset root is temporarily unavailable")

        monkeypatch.setattr(service, "_scan_filesystem_index", fail_scan)

        catalog = service.list_catalog(db, user_id)

        assert catalog.instruments[0].id == "GBP_USD"
        assert catalog.instruments[0].timeframes[0].rows == 42


def test_refresh_catalog_syncs_session_replay_readiness(tmp_path):
    root = tmp_path / "datasets"
    asset_dir = root / "GBP_USD"
    asset_dir.mkdir(parents=True)
    csv_path = asset_dir / "GBPUSD_M1.csv"
    csv_path.write_text(
        "Timestamp,Open,High,Low,Close,Volume\n"
        "2024-01-01 09:30:00,1.2,1.3,1.1,1.25,100\n",
        encoding="utf-8",
    )

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    service = DatasetCatalogService(root, session_factory)

    with session_factory() as db:
        user_id = seed_user(db)
        db.add_all(
            [
                BacktestSession(
                    user_id=user_id,
                    name="Valid dataset session",
                    symbol="GBPUSD",
                    timeframe="M1",
                    csv_path=str(csv_path),
                    replay_ready=False,
                    current_offset=0,
                ),
                BacktestSession(
                    user_id=user_id,
                    name="Stale legacy session",
                    symbol="EURUSD",
                    timeframe="M1",
                    csv_path="/data/EURUSD_M1.csv",
                    replay_ready=True,
                    current_offset=0,
                ),
            ]
        )
        db.commit()

        service.refresh_catalog(db, user_id)

        sessions = db.query(BacktestSession).order_by(BacktestSession.name.asc()).all()
        assert [(session.name, session.replay_ready) for session in sessions] == [
            ("Stale legacy session", False),
            ("Valid dataset session", True),
        ]


def test_list_catalog_throttles_auto_discovery_within_ttl(tmp_path, monkeypatch):
    root = tmp_path / "datasets"
    asset_dir = root / "GBP_USD"
    asset_dir.mkdir(parents=True)
    (asset_dir / "GBPUSD_M5.csv").write_text(
        "Timestamp,Open,High,Low,Close,Volume\n"
        "2024-01-01 09:30:00,1.2,1.3,1.1,1.25,100\n",
        encoding="utf-8",
    )

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    service = DatasetCatalogService(root, session_factory, catalog_discovery_ttl_seconds=60)
    original_scan = service._scan_filesystem_index
    scan_count = 0

    def counted_scan(db, user_id, *, strict, prune_missing):
        nonlocal scan_count
        scan_count += 1
        return original_scan(db, user_id, strict=strict, prune_missing=prune_missing)

    monkeypatch.setattr(service, "_scan_filesystem_index", counted_scan)

    with session_factory() as db:
        user_id = seed_user(db)
        first = service.list_catalog(db, user_id)
        second = service.list_catalog(db, user_id)

        assert first.instruments[0].id == "GBP_USD"
        assert second.instruments[0].id == "GBP_USD"
        assert scan_count == 1


def test_refresh_catalog_forces_scan_during_auto_discovery_ttl(tmp_path):
    root = tmp_path / "datasets"
    asset_dir = root / "GBP_USD"
    asset_dir.mkdir(parents=True)
    (asset_dir / "GBPUSD_M5.csv").write_text(
        "Timestamp,Open,High,Low,Close,Volume\n"
        "2024-01-01 09:30:00,1.2,1.3,1.1,1.25,100\n",
        encoding="utf-8",
    )

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    service = DatasetCatalogService(root, session_factory, catalog_discovery_ttl_seconds=3600)

    with session_factory() as db:
        user_id = seed_user(db)
        first = service.list_catalog(db, user_id)

        second_asset_dir = root / "EUR_USD"
        second_asset_dir.mkdir()
        (second_asset_dir / "EURUSD_M1.csv").write_text(
            "Timestamp,Open,High,Low,Close,Volume\n"
            "2024-01-01 09:30:00,1.1,1.2,1.0,1.15,100\n",
            encoding="utf-8",
        )

        throttled = service.list_catalog(db, user_id)
        refreshed = service.refresh_catalog(db, user_id)

        assert [instrument.id for instrument in first.instruments] == ["GBP_USD"]
        assert [instrument.id for instrument in throttled.instruments] == ["GBP_USD"]
        assert [instrument.id for instrument in refreshed.catalog.instruments] == [
            "EUR_USD",
            "GBP_USD",
        ]


def test_list_catalog_does_not_count_rows_for_large_files(tmp_path, monkeypatch):
    root = tmp_path / "datasets"
    asset_dir = root / "XAU_USD"
    asset_dir.mkdir(parents=True)
    csv_path = asset_dir / "XAUUSD_M1.csv"
    csv_path.write_text(
        "Timestamp,Open,High,Low,Close,Volume\n"
        "2024-01-01 09:30:00,2000,2001,1999,2000.5,100\n"
        "2024-01-01 09:31:00,2001,2002,2000,2001.5,150\n",
        encoding="utf-8",
    )

    import app.services.datasets as datasets_module

    monkeypatch.setattr(datasets_module, "CATALOG_ROW_COUNT_MAX_BYTES", 1)
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    service = DatasetCatalogService(root, session_factory)

    with session_factory() as db:
        user_id = seed_user(db)
        catalog = service.list_catalog(db, user_id)
        timeframe = catalog.instruments[0].timeframes[0]

        assert timeframe.rows == 0
        assert timeframe.first_timestamp is not None
        assert timeframe.last_timestamp is not None
        assert timeframe.imported is False
        assert timeframe.database_imported is False


def test_dataset_timeframe_file_mtime_uses_bigint_and_stores_nanoseconds(tmp_path):
    root = tmp_path / "datasets"
    asset_dir = root / "BTCUSDT"
    asset_dir.mkdir(parents=True)
    csv_path = asset_dir / "BTCUSDT_M1.csv"
    csv_path.write_text(
        "Timestamp,Open,High,Low,Close,Volume\n"
        "2024-01-01 09:30:00,43000,43010,42990,43005,100\n",
        encoding="utf-8",
    )

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    service = DatasetCatalogService(root, session_factory)

    assert isinstance(DatasetTimeframe.__table__.c.file_mtime_ns.type, BigInteger)

    with session_factory() as db:
        user_id = seed_user(db)
        catalog = service.list_catalog(db, user_id)
        stored = db.query(DatasetTimeframe).one()

        assert catalog.instruments[0].id == "BTCUSDT"
        assert stored.file_mtime_ns == csv_path.stat().st_mtime_ns
        assert stored.file_mtime_ns > 2_147_483_647


def test_dataset_refresh_rejects_concurrent_runs(tmp_path):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    service = DatasetCatalogService(tmp_path, session_factory)

    with session_factory() as db:
        user_id = seed_user(db)
        service._lock_for_user(user_id).acquire()
        try:
            try:
                service.refresh_catalog(db, user_id)
            except DatasetRefreshInProgress as exc:
                assert "already running" in str(exc)
            else:
                raise AssertionError("Expected DatasetRefreshInProgress")
        finally:
            service._lock_for_user(user_id).release()


def test_resolve_dataset_rejects_csv_path_outside_catalog(tmp_path):
    root = tmp_path / "datasets"
    root.mkdir()
    rogue_csv = tmp_path / "rogue.csv"
    rogue_csv.write_text(
        "Timestamp,Open,High,Low,Close,Volume\n"
        "2024-01-01 09:30:00,100,101,99,100.5,10\n",
        encoding="utf-8",
    )

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    service = DatasetCatalogService(root, session_factory)

    with session_factory() as db:
        user_id = seed_user(db)
        with pytest.raises(FileNotFoundError, match="catalog"):
            service.resolve_dataset(db, user_id, csv_path=str(rogue_csv))


def test_refresh_catalog_keeps_database_imported_timeframe_without_csv_file(tmp_path):
    root = tmp_path / "datasets"
    asset_dir = root / "EUR_USD"
    asset_dir.mkdir(parents=True)
    csv_path = asset_dir / "EURUSD_M1.csv"
    csv_path.write_text(
        "Timestamp,Open,High,Low,Close,Volume\n"
        "2024-01-01 09:30:00,1.1,1.2,1.0,1.15,100\n",
        encoding="utf-8",
    )

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    service = DatasetCatalogService(root, session_factory)

    with session_factory() as db:
        user_id = seed_user(db)
        asset = DatasetAsset(
            user_id=user_id,
            asset_key="EUR_USD",
            name="EUR/USD",
            symbol="EURUSD",
            folder_path=str(asset_dir),
        )
        db.add(asset)
        db.flush()
        db.add(
            DatasetTimeframe(
                user_id=user_id,
                asset_id=asset.id,
                timeframe="M1",
                csv_path=str(csv_path),
                rows=1,
                first_timestamp="2024-01-01 09:30:00",
                last_timestamp="2024-01-01 09:30:00",
                file_size=csv_path.stat().st_size,
                file_mtime_ns=csv_path.stat().st_mtime_ns,
                database_imported=True,
            )
        )
        db.commit()

        csv_path.unlink()
        refreshed = service.refresh_catalog(db, user_id)

        assert refreshed.catalog.instruments[0].timeframes[0].csv_path == str(csv_path)
        assert refreshed.catalog.instruments[0].timeframes[0].database_imported is True
        assert db.query(DatasetAsset).count() == 1
        assert db.query(DatasetTimeframe).count() == 1


def test_refresh_catalog_marks_dataset_asset_session_ready_without_session_csv_path(tmp_path):
    root = tmp_path / "datasets"
    asset_dir = root / "EUR_USD"
    asset_dir.mkdir(parents=True)
    csv_path = asset_dir / "EURUSD_M1.csv"
    csv_path.write_text(
        "Timestamp,Open,High,Low,Close,Volume\n"
        "2024-01-01 09:30:00,1.1,1.2,1.0,1.15,100\n",
        encoding="utf-8",
    )

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    service = DatasetCatalogService(root, session_factory, market_data_import_enabled=True)

    with session_factory() as db:
        user_id = seed_user(db)
        refreshed = service.refresh_catalog(db, user_id)
        asset = db.query(DatasetAsset).one()
        session = BacktestSession(
            user_id=user_id,
            name="DB identity replay",
            symbol="EURUSD",
            instrument=refreshed.catalog.instruments[0].id,
            timeframe="M1",
            dataset_asset_id=asset.id,
            csv_path=None,
            replay_ready=False,
            current_offset=0,
        )
        db.add(session)
        db.commit()

        csv_path.unlink()
        service.refresh_catalog(db, user_id)
        db.refresh(session)

        assert session.replay_ready is True
