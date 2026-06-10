from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import DatasetAsset, DatasetTimeframe
from app.schemas import DatasetAssetUpdate
from app.schemas import DatasetSettingsUpdate
from app.services.datasets import DatasetCatalogService, DatasetRefreshInProgress


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
        response = service.refresh_catalog(db)

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
        assert db.query(DatasetAsset).count() == 1
        assert db.query(DatasetTimeframe).count() == 1

        updated = service.update_asset(
            db,
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
        first = service.refresh_catalog(db)
        second = service.refresh_catalog(db)

        assert first.summary.candles == 0
        assert second.summary.candles == 0


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
        assert service.get_settings(db).root_path == str(first_root)

        catalog = service.update_settings(
            db,
            DatasetSettingsUpdate(root_path=str(second_root)),
        )
        assert catalog.root == str(second_root)
        assert service.get_settings(db).root_path == str(second_root)

        refreshed = service.refresh_catalog(db)
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
        catalog = service.list_catalog(db)
        timeframe = catalog.instruments[0].timeframes[0]
        resolution = service.resolve_dataset(db, instrument="GBP_USD", timeframe="M5")

        assert catalog.instruments[0].id == "GBP_USD"
        assert timeframe.csv_path == str(csv_path)
        assert timeframe.rows == 2
        assert timeframe.imported is False
        assert resolution.stored is False


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

    def counted_scan(db, *, strict, prune_missing):
        nonlocal scan_count
        scan_count += 1
        return original_scan(db, strict=strict, prune_missing=prune_missing)

    monkeypatch.setattr(service, "_scan_filesystem_index", counted_scan)

    with session_factory() as db:
        first = service.list_catalog(db)
        second = service.list_catalog(db)

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
        first = service.list_catalog(db)

        second_asset_dir = root / "EUR_USD"
        second_asset_dir.mkdir()
        (second_asset_dir / "EURUSD_M1.csv").write_text(
            "Timestamp,Open,High,Low,Close,Volume\n"
            "2024-01-01 09:30:00,1.1,1.2,1.0,1.15,100\n",
            encoding="utf-8",
        )

        throttled = service.list_catalog(db)
        refreshed = service.refresh_catalog(db)

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
        catalog = service.list_catalog(db)
        timeframe = catalog.instruments[0].timeframes[0]

        assert timeframe.rows == 0
        assert timeframe.first_timestamp is not None
        assert timeframe.last_timestamp is not None
        assert timeframe.imported is False


def test_dataset_refresh_rejects_concurrent_runs(tmp_path):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    service = DatasetCatalogService(tmp_path, session_factory)

    with session_factory() as db:
        service._lock.acquire()
        try:
            try:
                service.refresh_catalog(db)
            except DatasetRefreshInProgress as exc:
                assert "already running" in str(exc)
            else:
                raise AssertionError("Expected DatasetRefreshInProgress")
        finally:
            service._lock.release()
