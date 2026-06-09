from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api import routes
from app.db import Base
from app.models import BacktestSession, Position
from app.services.backtester import BacktestService
from app.services.datasets import DatasetCatalogService


class FakeDatasetCatalog:
    def list_catalog(self, db):
        return SimpleNamespace(
            root="/datasets",
            instruments=[
                SimpleNamespace(timeframes=[SimpleNamespace(timeframe="M1")]),
                SimpleNamespace(timeframes=[SimpleNamespace(timeframe="H1")]),
            ],
        )


def make_session():
    engine = create_engine("sqlite:///:memory:")
    session_factory = sessionmaker(bind=engine)
    return session_factory()


def make_model_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    return session_factory()


def test_health_does_not_require_dataset_catalog(monkeypatch):
    monkeypatch.setattr(routes, "dataset_catalog", object())
    db = make_session()
    try:
        assert routes.health(db) == {"status": "ok", "database": "ok"}
    finally:
        db.close()


def test_ready_reports_dataset_catalog_counts(monkeypatch):
    monkeypatch.setattr(routes, "dataset_catalog", FakeDatasetCatalog())
    db = make_session()
    try:
        assert routes.ready(db) == {
            "status": "ok",
            "database": "ok",
            "datasets_root": "/datasets",
            "dataset_assets": "2",
            "dataset_timeframes": "2",
        }
    finally:
        db.close()


def test_latest_backtest_skips_stale_legacy_csv_session(monkeypatch, tmp_path):
    datasets_root = tmp_path / "datasets"
    asset_dir = datasets_root / "GBP_USD"
    asset_dir.mkdir(parents=True)
    csv_path = asset_dir / "GBPUSD_M1.csv"
    csv_path.write_text(
        "Timestamp,Open,High,Low,Close,Volume\n"
        "2024-01-01 09:30:00,1.2,1.3,1.1,1.25,100\n",
        encoding="utf-8",
    )
    db = make_model_session()
    stale_session = BacktestSession(
        name="Stale legacy session",
        symbol="EURUSD",
        csv_path="/data/EURUSD_M1.csv",
        current_offset=0,
    )
    db.add(stale_session)
    db.flush()
    db.add(Position(session_id=stale_session.id))
    db.commit()
    catalog = DatasetCatalogService(datasets_root, sessionmaker(bind=db.get_bind()))
    monkeypatch.setattr(routes, "dataset_catalog", catalog)
    monkeypatch.setattr(routes, "backtester", BacktestService(dataset_catalog=catalog))

    try:
        state = routes.latest_backtest(db)
    finally:
        db.close()

    assert state.session.csv_path == str(csv_path)
    assert state.session.symbol == "GBPUSD"


def test_list_backtests_hides_stale_replay_sessions(monkeypatch, tmp_path):
    datasets_root = tmp_path / "datasets"
    asset_dir = datasets_root / "GBP_USD"
    asset_dir.mkdir(parents=True)
    csv_path = asset_dir / "GBPUSD_M1.csv"
    csv_path.write_text(
        "Timestamp,Open,High,Low,Close,Volume\n"
        "2024-01-01 09:30:00,1.2,1.3,1.1,1.25,100\n",
        encoding="utf-8",
    )
    db = make_model_session()
    stale_session = BacktestSession(
        name="Stale legacy session",
        symbol="EURUSD",
        csv_path="/data/EURUSD_M1.csv",
        current_offset=0,
    )
    valid_session = BacktestSession(
        name="Valid dataset session",
        symbol="GBPUSD",
        csv_path=str(csv_path),
        current_offset=0,
    )
    db.add_all([stale_session, valid_session])
    db.flush()
    db.add_all([Position(session_id=stale_session.id), Position(session_id=valid_session.id)])
    db.commit()
    monkeypatch.setattr(routes, "backtester", BacktestService())

    try:
        sessions = routes.list_backtests(db)
    finally:
        db.close()

    assert [session.csv_path for session in sessions] == [str(csv_path)]


def test_market_data_error_response_does_not_expose_legacy_csv_path():
    response = routes.market_data_error_response(
        FileNotFoundError("CSV file not found: /data/EURUSD_M1.csv"),
    )

    assert response.status_code == 503
    assert "/data/EURUSD_M1.csv" not in response.detail
