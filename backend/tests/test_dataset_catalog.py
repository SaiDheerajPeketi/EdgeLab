from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import DatasetAsset, DatasetCandle, DatasetTimeframe
from app.schemas import DatasetAssetUpdate
from app.schemas import DatasetSettingsUpdate
from app.services.datasets import DatasetCatalogService, DatasetRefreshInProgress


def test_refresh_imports_asset_timeframe_and_allows_metadata_updates(tmp_path):
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
        assert response.summary.candles == 2
        assert response.catalog.instruments[0].id == "EUR_USD"
        assert response.catalog.instruments[0].currency == "USD"
        assert response.catalog.instruments[0].timezone == "UTC"
        assert response.catalog.instruments[0].timeframes[0].timeframe == "M1"
        assert db.query(DatasetAsset).count() == 1
        assert db.query(DatasetTimeframe).count() == 1
        assert db.query(DatasetCandle).count() == 2

        updated = service.update_asset(
            db,
            "EUR_USD",
            DatasetAssetUpdate(currency="eur", timezone="Europe/London"),
        )

        assert updated.instruments[0].currency == "EUR"
        assert updated.instruments[0].timezone == "Europe/London"


def test_refresh_skips_unchanged_files_after_initial_import(tmp_path):
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

        assert first.summary.candles == 1
        assert second.summary.candles == 0
        assert db.query(DatasetCandle).count() == 1


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
