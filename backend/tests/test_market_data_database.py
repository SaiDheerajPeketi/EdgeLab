from datetime import datetime, timezone

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.api import routes
from app.models import BacktestSession, DatasetAsset, DatasetTimeframe, MarketCandle
from app.services.backtester import BacktestService
from app.services.database_market_data import DatabaseMarketDataService
from app.services.datasets import DatasetCatalogService
from backend.scripts.import_market_data_to_db import import_market_data_to_db
from tests.test_health_routes import current_user, seed_user
from app.db import Base


def test_imported_market_data_serves_bars_without_csv_file(tmp_path, monkeypatch):
    datasets_root = tmp_path / "datasets"
    asset_dir = datasets_root / "EUR_USD"
    asset_dir.mkdir(parents=True)
    csv_path = asset_dir / "EURUSD_M1.csv"
    csv_path.write_text(
        "Timestamp,Open,High,Low,Close,Volume\n"
        "2024-01-01 09:30:00,1.1000,1.1010,1.0990,1.1005,100\n"
        "2024-01-01 09:31:00,1.1005,1.1015,1.0995,1.1010,105\n"
        "2024-01-01 09:32:00,1.1010,1.1020,1.1000,1.1015,110\n",
        encoding="utf-8",
    )

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)

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
        timeframe = DatasetTimeframe(
            user_id=user_id,
            asset_id=asset.id,
            timeframe="M1",
            csv_path=str(csv_path),
            rows=3,
            first_timestamp="2024-01-01 09:30:00",
            last_timestamp="2024-01-01 09:32:00",
            file_size=csv_path.stat().st_size,
            file_mtime_ns=csv_path.stat().st_mtime_ns,
        )
        db.add(timeframe)
        db.flush()
        session = BacktestSession(
            user_id=user_id,
            name="Imported DB replay",
            symbol="EURUSD",
            instrument="EUR_USD",
            timeframe="M1",
            csv_path=str(csv_path),
            timezone="UTC",
            replay_ready=True,
            current_offset=0,
        )
        db.add(session)
        db.commit()
        session_id = session.id
        asset_id = asset.id

    summary = import_market_data_to_db(
        session_factory,
        user_id=user_id,
        csv_path=str(csv_path),
    )
    assert summary["ok"] is True

    with session_factory() as db:
        timeframe_row = db.scalar(
            select(DatasetTimeframe).where(DatasetTimeframe.user_id == user_id)
        )
        assert timeframe_row is not None
        assert timeframe_row.database_imported is True
        assert timeframe_row.database_imported_at is not None
        assert db.scalar(select(MarketCandle).limit(1)) is not None

    csv_path.unlink()

    catalog = DatasetCatalogService(datasets_root, session_factory)
    monkeypatch.setattr(routes, "dataset_catalog", catalog)
    monkeypatch.setattr(routes, "backtester", BacktestService(dataset_catalog=catalog))

    with session_factory() as db:
        refreshed = catalog.refresh_catalog(db, user_id)
        session_row = db.scalar(select(BacktestSession).where(BacktestSession.id == session_id))
        assert session_row is not None
        assert session_row.replay_ready is True
        assert refreshed.catalog.instruments[0].timeframes[0].database_imported is True
        response = routes.market_data_bars(
            offset=0,
            limit=2,
            warmup=0,
            session_id=session_id,
            db=db,
            current_user=current_user(user_id),
        )
        metadata = routes.market_data_meta(
            session_id=session_id,
            db=db,
            current_user=current_user(user_id),
        )
        direct_response = routes.market_data_bars(
            offset=1,
            limit=1,
            warmup=0,
            dataset_asset_id=asset_id,
            timeframe="M1",
            db=db,
            current_user=current_user(user_id),
        )
        direct_metadata = routes.market_data_meta(
            dataset_asset_id=asset_id,
            timeframe="M1",
            db=db,
            current_user=current_user(user_id),
        )

    assert len(response.bars) == 2
    assert response.bars[0].open == 1.1
    assert response.bars[1].close == 1.101
    assert metadata.rows == 3
    assert metadata.first_timestamp == datetime(2024, 1, 1, 9, 30, tzinfo=timezone.utc)
    assert len(direct_response.bars) == 1
    assert direct_response.bars[0].close == 1.101
    assert direct_metadata.rows == 3


def test_database_market_data_cache_invalidates_after_reimport(tmp_path):
    datasets_root = tmp_path / "datasets"
    asset_dir = datasets_root / "EUR_USD"
    asset_dir.mkdir(parents=True)
    csv_path = asset_dir / "EURUSD_M1.csv"
    csv_path.write_text(
        "Timestamp,Open,High,Low,Close,Volume\n"
        "2024-01-01 09:30:00,1.1000,1.1010,1.0990,1.1005,100\n"
        "2024-01-01 09:31:00,1.1005,1.1015,1.0995,1.1010,105\n"
        "2024-01-01 09:32:00,1.1010,1.1020,1.1000,1.1015,110\n",
        encoding="utf-8",
    )

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    catalog = DatasetCatalogService(datasets_root, session_factory, market_data_import_enabled=True)
    backtester = BacktestService(dataset_catalog=catalog)

    with session_factory() as db:
        user_id = seed_user(db)
        catalog.refresh_catalog(db, user_id)
        first_service = backtester.market_data_for_path(
            str(csv_path),
            "UTC",
            db=db,
            user_id=user_id,
        )
        assert isinstance(first_service, DatabaseMarketDataService)
        assert first_service.get_metadata().rows == 3
        assert first_service.get_candle(2).close == 1.1015

    csv_path.write_text(
        "Timestamp,Open,High,Low,Close,Volume\n"
        "2024-01-01 09:30:00,1.1000,1.1010,1.0990,1.1005,100\n"
        "2024-01-01 09:31:00,1.1005,1.1015,1.0995,1.1010,105\n"
        "2024-01-01 09:32:00,1.1010,1.1020,1.1000,1.1015,110\n"
        "2024-01-01 09:33:00,1.1015,1.1025,1.1005,1.1020,115\n",
        encoding="utf-8",
    )

    with session_factory() as db:
        catalog.refresh_catalog(db, user_id)
        second_service = backtester.market_data_for_path(
            str(csv_path),
            "UTC",
            db=db,
            user_id=user_id,
        )
        assert isinstance(second_service, DatabaseMarketDataService)
        assert second_service.get_metadata().rows == 4
        assert second_service.get_candle(3).close == 1.102
        assert first_service.source_has_changed() is True
        assert second_service is not first_service


def test_imported_market_data_session_works_without_session_csv_path(tmp_path):
    datasets_root = tmp_path / "datasets"
    asset_dir = datasets_root / "EUR_USD"
    asset_dir.mkdir(parents=True)
    csv_path = asset_dir / "EURUSD_M1.csv"
    csv_path.write_text(
        "Timestamp,Open,High,Low,Close,Volume\n"
        "2024-01-01 09:30:00,1.1000,1.1010,1.0990,1.1005,100\n"
        "2024-01-01 09:31:00,1.1005,1.1015,1.0995,1.1010,105\n",
        encoding="utf-8",
    )

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    catalog = DatasetCatalogService(datasets_root, session_factory, market_data_import_enabled=True)
    backtester = BacktestService(dataset_catalog=catalog)

    with session_factory() as db:
        user_id = seed_user(db)
        refreshed = catalog.refresh_catalog(db, user_id)
        dataset_asset = refreshed.catalog.instruments[0]
        asset = db.scalar(select(DatasetAsset).where(DatasetAsset.user_id == user_id))
        assert asset is not None
        session = BacktestSession(
            user_id=user_id,
            name="DB identity replay",
            symbol=dataset_asset.symbol,
            instrument=dataset_asset.id,
            timeframe="M1",
            dataset_asset_id=asset.id,
            csv_path=None,
            timezone="UTC",
            replay_ready=True,
            current_offset=1,
        )
        db.add(session)
        db.commit()
        session_id = session.id

    csv_path.unlink()

    with session_factory() as db:
        catalog.refresh_catalog(db, user_id)
        state = backtester.get_state(db, user_id, session_id)

    assert state.current_candle is not None
    assert state.current_candle.close == 1.101
    assert state.session.csv_path is None


def test_market_data_import_appends_only_new_tail_rows(tmp_path):
    datasets_root = tmp_path / "datasets"
    asset_dir = datasets_root / "EUR_USD"
    asset_dir.mkdir(parents=True)
    csv_path = asset_dir / "EURUSD_M1.csv"
    csv_path.write_text(
        "Timestamp,Open,High,Low,Close,Volume\n"
        "2024-01-01 09:30:00,1.1000,1.1010,1.0990,1.1005,100\n"
        "2024-01-01 09:31:00,1.1005,1.1015,1.0995,1.1010,105\n",
        encoding="utf-8",
    )

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)

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
                rows=2,
                first_timestamp="2024-01-01 09:30:00",
                last_timestamp="2024-01-01 09:31:00",
                file_size=csv_path.stat().st_size,
                file_mtime_ns=csv_path.stat().st_mtime_ns,
            )
        )
        db.commit()
        asset_id = asset.id

    first_summary = import_market_data_to_db(
        session_factory,
        user_id=user_id,
        csv_path=str(csv_path),
    )
    assert first_summary["candles"] == 2

    with session_factory() as db:
        original = db.scalars(
            select(MarketCandle)
            .where(
                MarketCandle.user_id == user_id,
                MarketCandle.asset_id == asset_id,
                MarketCandle.timeframe == "M1",
            )
            .order_by(MarketCandle.offset)
        ).all()
        original_ids = [row.id for row in original]

    csv_path.write_text(
        "Timestamp,Open,High,Low,Close,Volume\n"
        "2024-01-01 09:30:00,1.1000,1.1010,1.0990,1.1005,100\n"
        "2024-01-01 09:31:00,1.1005,1.1015,1.0995,1.1010,105\n"
        "2024-01-01 09:32:00,1.1010,1.1020,1.1000,1.1015,110\n",
        encoding="utf-8",
    )

    second_summary = import_market_data_to_db(
        session_factory,
        user_id=user_id,
        csv_path=str(csv_path),
    )
    assert second_summary["candles"] == 1
    assert second_summary["imported"][0]["imported_rows"] == 1
    assert second_summary["imported"][0]["mode"] == "append"

    with session_factory() as db:
        stored = db.scalars(
            select(MarketCandle)
            .where(
                MarketCandle.user_id == user_id,
                MarketCandle.asset_id == asset_id,
                MarketCandle.timeframe == "M1",
            )
            .order_by(MarketCandle.offset)
        ).all()
        assert [row.id for row in stored[:2]] == original_ids
        assert len(stored) == 3
        assert stored[-1].close == 1.1015


def test_market_data_import_replaces_rows_when_prefix_changes(tmp_path):
    datasets_root = tmp_path / "datasets"
    asset_dir = datasets_root / "EUR_USD"
    asset_dir.mkdir(parents=True)
    csv_path = asset_dir / "EURUSD_M1.csv"
    csv_path.write_text(
        "Timestamp,Open,High,Low,Close,Volume\n"
        "2024-01-01 09:30:00,1.1000,1.1010,1.0990,1.1005,100\n"
        "2024-01-01 09:31:00,1.1005,1.1015,1.0995,1.1010,105\n",
        encoding="utf-8",
    )

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)

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
                rows=2,
                first_timestamp="2024-01-01 09:30:00",
                last_timestamp="2024-01-01 09:31:00",
                file_size=csv_path.stat().st_size,
                file_mtime_ns=csv_path.stat().st_mtime_ns,
            )
        )
        db.commit()
        asset_id = asset.id

    import_market_data_to_db(
        session_factory,
        user_id=user_id,
        csv_path=str(csv_path),
    )

    with session_factory() as db:
        assert db.scalar(select(MarketCandle).where(MarketCandle.asset_id == asset_id)) is not None

    csv_path.write_text(
        "Timestamp,Open,High,Low,Close,Volume\n"
        "2024-01-01 09:29:00,1.0995,1.1005,1.0985,1.1000,95\n"
        "2024-01-01 09:30:00,1.1000,1.1010,1.0990,1.1005,100\n"
        "2024-01-01 09:31:00,1.1005,1.1015,1.0995,1.1010,105\n",
        encoding="utf-8",
    )

    summary = import_market_data_to_db(
        session_factory,
        user_id=user_id,
        csv_path=str(csv_path),
    )
    assert summary["candles"] == 3
    assert summary["imported"][0]["imported_rows"] == 3
    assert summary["imported"][0]["mode"] == "replace"

    with session_factory() as db:
        stored = db.scalars(
            select(MarketCandle)
            .where(
                MarketCandle.user_id == user_id,
                MarketCandle.asset_id == asset_id,
                MarketCandle.timeframe == "M1",
            )
            .order_by(MarketCandle.offset)
        ).all()
        assert len(stored) == 3
        assert [row.timestamp for row in stored] == [
            datetime(2024, 1, 1, 9, 29),
            datetime(2024, 1, 1, 9, 30),
            datetime(2024, 1, 1, 9, 31),
        ]
