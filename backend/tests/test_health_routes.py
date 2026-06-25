from types import SimpleNamespace
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api import routes
from app.auth import AuthenticatedUser
from app.db import Base
from app.models import BacktestSession, BetaUser, Position, Trade
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


def seed_user(db):
    user = BetaUser(
        email="health@edgelab.local",
        name="Health Tester",
        provider="google",
        status="APPROVED",
    )
    db.add(user)
    db.commit()
    return user.id


def current_user(user_id: int) -> AuthenticatedUser:
    return AuthenticatedUser(
        id=user_id,
        email="health@edgelab.local",
        name="Health Tester",
        provider="google",
        approved=True,
        beta_position=1,
        session_id="test-session",
        session_created_at=None,
        session_expires_at=None,
    )


def test_health_does_not_require_dataset_catalog(monkeypatch):
    monkeypatch.setattr(routes, "dataset_catalog", object())
    db = make_session()
    try:
        assert routes.health(db) == {"status": "ok", "database": "ok"}
    finally:
        db.close()


def test_ready_reports_dataset_catalog_counts(monkeypatch, tmp_path):
    datasets_root = tmp_path / "datasets"
    (datasets_root / "EUR_USD").mkdir(parents=True)
    (datasets_root / "EUR_USD" / "EUR_USD_M1.csv").write_text("Timestamp,Open,High,Low,Close,Volume\n", encoding="utf-8")
    (datasets_root / "GBP_USD").mkdir(parents=True)
    (datasets_root / "GBP_USD" / "GBP_USD_H1.csv").write_text("Timestamp,Open,High,Low,Close,Volume\n", encoding="utf-8")
    monkeypatch.setattr(routes, "settings", SimpleNamespace(datasets_root=datasets_root))
    db = make_session()
    try:
        assert routes.ready(db) == {
            "status": "ok",
            "database": "ok",
            "datasets_root": str(datasets_root),
            "dataset_assets": "2",
            "dataset_timeframes": "2",
        }
    finally:
        db.close()


def test_dataset_catalog_stream_payload_serializes_catalog(monkeypatch, tmp_path):
    datasets_root = tmp_path / "datasets"
    asset_dir = datasets_root / "GBP_USD"
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
    catalog = DatasetCatalogService(datasets_root, session_factory)
    monkeypatch.setattr(routes, "dataset_catalog", catalog)
    monkeypatch.setattr(routes, "SessionLocal", session_factory)

    with session_factory() as db:
        user_id = seed_user(db)
    payload = routes.dataset_catalog_stream_payload(user_id)

    assert payload["type"] == "catalog"
    assert payload["catalog"]["root"] == str(datasets_root)
    assert payload["catalog"]["instruments"][0]["id"] == "GBP_USD"


def test_latest_backtest_skips_stale_legacy_csv_session_without_creating_default(monkeypatch, tmp_path):
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
    user_id = seed_user(db)
    stale_session = BacktestSession(
        user_id=user_id,
        name="Stale legacy session",
        symbol="EURUSD",
        csv_path="/data/EURUSD_M1.csv",
        current_offset=0,
    )
    db.add(stale_session)
    db.flush()
    db.add(Position(user_id=user_id, session_id=stale_session.id))
    db.commit()
    catalog = DatasetCatalogService(datasets_root, sessionmaker(bind=db.get_bind()))
    monkeypatch.setattr(routes, "dataset_catalog", catalog)
    monkeypatch.setattr(routes, "backtester", BacktestService(dataset_catalog=catalog))

    try:
        with pytest.raises(HTTPException) as exc_info:
            routes.latest_backtest(db, current_user(user_id))
        session_count = len(db.query(BacktestSession).all())
    finally:
        db.close()

    assert exc_info.value.status_code == 404
    assert session_count == 1


def test_latest_backtest_returns_existing_valid_dataset_session(monkeypatch, tmp_path):
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
    user_id = seed_user(db)
    valid_session = BacktestSession(
        user_id=user_id,
        name="Valid dataset session",
        symbol="GBPUSD",
        csv_path=str(csv_path),
        current_offset=0,
    )
    db.add(valid_session)
    db.flush()
    db.add(Position(user_id=user_id, session_id=valid_session.id))
    db.commit()
    catalog = DatasetCatalogService(datasets_root, sessionmaker(bind=db.get_bind()))
    monkeypatch.setattr(routes, "dataset_catalog", catalog)
    monkeypatch.setattr(routes, "backtester", BacktestService(dataset_catalog=catalog))

    try:
        state = routes.latest_backtest(db, current_user(user_id))
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
    user_id = seed_user(db)
    stale_session = BacktestSession(
        user_id=user_id,
        name="Stale legacy session",
        symbol="EURUSD",
        csv_path="/data/EURUSD_M1.csv",
        current_offset=0,
    )
    valid_session = BacktestSession(
        user_id=user_id,
        name="Valid dataset session",
        symbol="GBPUSD",
        csv_path=str(csv_path),
        current_offset=0,
    )
    db.add_all([stale_session, valid_session])
    db.flush()
    db.add_all(
        [
            Position(user_id=user_id, session_id=stale_session.id),
            Position(user_id=user_id, session_id=valid_session.id),
        ]
    )
    db.commit()
    monkeypatch.setattr(routes, "backtester", BacktestService())

    try:
        sessions = routes.list_backtests(db, current_user(user_id))
    finally:
        db.close()

    assert [session.csv_path for session in sessions] == [str(csv_path)]


def test_bootstrap_returns_recent_payload(monkeypatch, tmp_path):
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
    user_id = seed_user(db)
    stale_session = BacktestSession(
        user_id=user_id,
        name="Stale legacy session",
        symbol="EURUSD",
        csv_path="/data/EURUSD_M1.csv",
        current_offset=0,
    )
    valid_session = BacktestSession(
        user_id=user_id,
        name="Valid dataset session",
        symbol="GBPUSD",
        csv_path=str(csv_path),
        current_offset=0,
    )
    db.add_all([stale_session, valid_session])
    db.flush()
    db.add(
        Trade(
            user_id=user_id,
            session_id=valid_session.id,
            status="CLOSED",
            side="LONG",
            entry_time=datetime(2024, 1, 1, 9, 30, tzinfo=timezone.utc),
            entry_price=1.2,
            quantity=1.0,
            remaining_quantity=0.0,
            exit_time=datetime(2024, 1, 1, 10, 0, tzinfo=timezone.utc),
            exit_price=1.3,
            realized_pnl=10.0,
        )
    )
    db.commit()
    catalog = DatasetCatalogService(datasets_root, sessionmaker(bind=db.get_bind()))
    monkeypatch.setattr(routes, "dataset_catalog", catalog)
    monkeypatch.setattr(routes, "backtester", BacktestService(dataset_catalog=catalog))

    try:
        payload = routes.bootstrap(db, current_user(user_id))
    finally:
        db.close()

    assert payload.datasets.root == str(datasets_root)
    assert payload.playbooks == []
    assert payload.recent_session_limit == routes.BOOTSTRAP_SESSION_LIMIT
    assert payload.recent_trade_limit == routes.BOOTSTRAP_TRADE_LIMIT
    assert [session.csv_path for session in payload.recent_sessions] == [str(csv_path)]
    assert [trade.session_id for trade in payload.recent_trades] == [valid_session.id]
    assert payload.recent_trades[0].realized_pnl == 10.0


def test_market_data_error_response_does_not_expose_legacy_csv_path():
    response = routes.market_data_error_response(
        FileNotFoundError("CSV file not found: /data/EURUSD_M1.csv"),
    )

    assert response.status_code == 503
    assert "/data/EURUSD_M1.csv" not in response.detail
