from types import SimpleNamespace
from datetime import datetime, timezone

import pytest
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.exc import DataError
from sqlalchemy.orm import sessionmaker

from app.api import routes
from app.auth import AuthenticatedUser
from app.db import Base
from app.models import BacktestSession, BetaUser, DatasetAsset, DatasetTimeframe, Position, Trade
from app.services.backtester import BacktestService
from app.services.datasets import DatasetCatalogService
from app.services.rate_limits import RateLimitDecision


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


def test_dataset_catalog_stream_payload_hides_internal_errors(monkeypatch):
    db = make_model_session()
    user_id = seed_user(db)
    db.close()

    def fail_catalog(*_args, **_kwargs):
        raise DataError("insert", {}, OverflowError("integer out of range"))

    monkeypatch.setattr(routes, "cached_dataset_catalog_response", fail_catalog)

    payload = routes.dataset_catalog_stream_payload(user_id)

    assert payload == {"type": "error", "message": "Dataset operation failed"}


def test_datasets_route_maps_sqlalchemy_failures_to_dataset_error(monkeypatch):
    db = make_model_session()
    user_id = seed_user(db)

    def fail_catalog(*_args, **_kwargs):
        raise DataError("insert", {}, OverflowError("integer out of range"))

    monkeypatch.setattr(routes, "cached_dataset_catalog_response", fail_catalog)

    try:
        with pytest.raises(HTTPException) as exc_info:
            routes.datasets(db=db, current_user=current_user(user_id))
    finally:
        db.close()

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == "Dataset operation failed"


def test_refresh_datasets_returns_429_when_rate_limited(monkeypatch):
    class RejectLimiter:
        def consume(self, *_args, **_kwargs):
            return RateLimitDecision(allowed=False, retry_after_seconds=17)

    class Catalog:
        def start_refresh(self, *_args, **_kwargs):
            raise AssertionError("refresh should be blocked before catalog call")

    db = make_model_session()
    user_id = seed_user(db)
    monkeypatch.setattr(routes, "rate_limiter", RejectLimiter())
    monkeypatch.setattr(routes, "dataset_catalog", Catalog())

    try:
        with pytest.raises(HTTPException) as exc_info:
            routes.refresh_datasets(db=db, current_user=current_user(user_id))
    finally:
        db.close()

    assert exc_info.value.status_code == 429
    assert exc_info.value.headers == {"Retry-After": "17"}


def test_market_data_bars_returns_429_when_rate_limited(monkeypatch):
    class RejectLimiter:
        def consume(self, *_args, **_kwargs):
            return RateLimitDecision(allowed=False, retry_after_seconds=9)

    db = make_model_session()
    user_id = seed_user(db)
    monkeypatch.setattr(routes, "rate_limiter", RejectLimiter())

    try:
        with pytest.raises(HTTPException) as exc_info:
            routes.market_data_bars(db=db, current_user=current_user(user_id))
    finally:
        db.close()

    assert exc_info.value.status_code == 429
    assert exc_info.value.headers == {"Retry-After": "9"}


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
        replay_ready=True,
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
        replay_ready=True,
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
    valid_session_id = valid_session.id
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
    assert payload.recent_sessions_next_offset >= len(payload.recent_sessions)
    assert payload.recent_sessions_has_more is False
    assert payload.active_session_id == valid_session_id
    assert payload.dashboard_summary is not None
    assert payload.dashboard_summary.total_trades == 1
    assert [session.csv_path for session in payload.recent_sessions] == [str(csv_path)]
    assert [trade.session_id for trade in payload.recent_trades] == [valid_session_id]
    assert payload.recent_trades[0].realized_pnl == 10.0


def test_bootstrap_shell_returns_recent_payload_without_heavy_sections(monkeypatch, tmp_path):
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
    db.commit()
    catalog = DatasetCatalogService(datasets_root, sessionmaker(bind=db.get_bind()))
    monkeypatch.setattr(routes, "dataset_catalog", catalog)
    monkeypatch.setattr(routes, "backtester", BacktestService(dataset_catalog=catalog))

    try:
        payload = routes.bootstrap_shell(db, current_user(user_id))
    finally:
        db.close()

    assert payload.playbooks == []
    assert payload.recent_session_limit == routes.BOOTSTRAP_SHELL_SESSION_LIMIT
    assert payload.recent_sessions_has_more is False
    assert payload.active_session_id == valid_session.id
    assert payload.dashboard_summary is not None
    assert payload.dashboard_summary.total_trades == 0
    assert [session.csv_path for session in payload.recent_sessions] == [str(csv_path)]
    assert len(payload.strategy_summaries) == 1
    assert payload.strategy_summaries[0].sessions[0].session.id == valid_session.id
    assert payload.strategy_summaries[0].aggregate.closed_trades == 0


def test_bootstrap_shell_returns_strategy_summaries(monkeypatch, tmp_path):
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
    first_session = BacktestSession(
        user_id=user_id,
        name="London Continuation / GBPUSD M1",
        symbol="GBPUSD",
        strategy_name="London Continuation",
        csv_path=str(csv_path),
        current_offset=0,
    )
    second_session = BacktestSession(
        user_id=user_id,
        name="Breakout / GBPUSD M1",
        symbol="GBPUSD",
        strategy_name="Breakout",
        csv_path=str(csv_path),
        current_offset=0,
    )
    db.add_all([first_session, second_session])
    db.flush()
    db.add_all(
        [
            Trade(
                user_id=user_id,
                session_id=first_session.id,
                status="CLOSED",
                side="LONG",
                entry_time=datetime(2024, 1, 1, 9, 30, tzinfo=timezone.utc),
                entry_price=1.2,
                quantity=1.0,
                remaining_quantity=0.0,
                exit_time=datetime(2024, 1, 1, 10, 0, tzinfo=timezone.utc),
                exit_price=1.3,
                realized_pnl=10.0,
                r_multiple=2.0,
            ),
            Trade(
                user_id=user_id,
                session_id=first_session.id,
                status="CLOSED",
                side="LONG",
                entry_time=datetime(2024, 1, 1, 10, 30, tzinfo=timezone.utc),
                entry_price=1.2,
                quantity=1.0,
                remaining_quantity=0.0,
                exit_time=datetime(2024, 1, 1, 11, 0, tzinfo=timezone.utc),
                exit_price=1.1,
                realized_pnl=-4.0,
                r_multiple=-1.0,
            ),
            Trade(
                user_id=user_id,
                session_id=second_session.id,
                status="CLOSED",
                side="SHORT",
                entry_time=datetime(2024, 1, 1, 11, 30, tzinfo=timezone.utc),
                entry_price=1.3,
                quantity=1.0,
                remaining_quantity=0.0,
                exit_time=datetime(2024, 1, 1, 12, 0, tzinfo=timezone.utc),
                exit_price=1.2,
                realized_pnl=6.0,
                r_multiple=1.5,
            ),
        ]
    )
    db.commit()
    catalog = DatasetCatalogService(datasets_root, sessionmaker(bind=db.get_bind()))
    monkeypatch.setattr(routes, "dataset_catalog", catalog)
    monkeypatch.setattr(routes, "backtester", BacktestService(dataset_catalog=catalog))

    try:
        payload = routes.bootstrap_shell(db=db, current_user=current_user(user_id), limit=10)
    finally:
        db.close()

    assert [summary.name for summary in payload.strategy_summaries] == [
        "London Continuation",
        "Breakout",
    ]
    assert payload.strategy_summaries[0].aggregate.closed_trades == 2
    assert payload.strategy_summaries[0].aggregate.winning_trades == 1
    assert payload.strategy_summaries[0].aggregate.net_pnl == pytest.approx(6.0)
    assert payload.strategy_summaries[0].aggregate.profit_factor == pytest.approx(2.5)
    assert payload.strategy_summaries[0].aggregate.average_r == pytest.approx(0.5)
    assert payload.strategy_summaries[0].sessions[0].session.id == first_session.id


def test_bootstrap_shell_strategy_summaries_are_json_safe_without_losses(monkeypatch, tmp_path):
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
    session = BacktestSession(
        user_id=user_id,
        name="Breakout / GBPUSD M1",
        symbol="GBPUSD",
        strategy_name="Breakout",
        csv_path=str(csv_path),
        current_offset=0,
    )
    db.add(session)
    db.flush()
    db.add(
        Trade(
            user_id=user_id,
            session_id=session.id,
            status="CLOSED",
            side="LONG",
            entry_time=datetime(2024, 1, 1, 9, 30, tzinfo=timezone.utc),
            entry_price=1.2,
            quantity=1.0,
            remaining_quantity=0.0,
            exit_time=datetime(2024, 1, 1, 10, 0, tzinfo=timezone.utc),
            exit_price=1.3,
            realized_pnl=10.0,
            r_multiple=2.0,
        )
    )
    db.commit()
    catalog = DatasetCatalogService(datasets_root, sessionmaker(bind=db.get_bind()))
    monkeypatch.setattr(routes, "dataset_catalog", catalog)
    monkeypatch.setattr(routes, "backtester", BacktestService(dataset_catalog=catalog))

    try:
        payload = routes.build_bootstrap_shell_response(db=db, user_id=user_id, limit=10)
        JSONResponse(content=jsonable_encoder(payload))
    finally:
        db.close()

    assert payload.strategy_summaries[0].aggregate.profit_factor is None


def test_backtest_summaries_paginate_listable_sessions(monkeypatch, tmp_path):
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
    sessions = [
        BacktestSession(
            user_id=user_id,
            name=f"Session {index}",
            symbol="GBPUSD",
            csv_path=str(csv_path),
            current_offset=0,
            replay_ready=True,
        )
        for index in range(3)
    ]
    sessions.insert(
        1,
        BacktestSession(
            user_id=user_id,
            name="Stale legacy session",
            symbol="EURUSD",
            csv_path="/data/EURUSD_M1.csv",
            current_offset=0,
        ),
    )
    db.add_all(sessions)
    db.commit()
    monkeypatch.setattr(routes, "backtester", BacktestService())

    try:
        page = routes.list_backtest_summaries(offset=0, limit=2, db=db, current_user=current_user(user_id))
        next_page = routes.list_backtest_summaries(
            offset=page.next_offset,
            limit=2,
            db=db,
            current_user=current_user(user_id),
        )
    finally:
        db.close()

    assert [session.name for session in page.items] == ["Session 2", "Session 1"]
    assert page.has_more is True
    assert next_page.has_more is False
    assert [session.name for session in next_page.items] == ["Session 0"]


def test_backtest_summaries_use_catalog_index_without_filesystem_checks(monkeypatch):
    db = make_model_session()
    user_id = seed_user(db)
    asset = DatasetAsset(
        user_id=user_id,
        asset_key="GBP_USD",
        name="GBP/USD",
        symbol="GBPUSD",
        folder_path="/datasets/GBP_USD",
    )
    db.add(asset)
    db.flush()
    csv_path = "/datasets/GBP_USD/GBPUSD_M1.csv"
    db.add(
        DatasetTimeframe(
            user_id=user_id,
            asset_id=asset.id,
            timeframe="M1",
            csv_path=csv_path,
            rows=1,
            file_size=0,
            file_mtime_ns=0,
        )
    )
    db.add_all(
        [
            BacktestSession(
                user_id=user_id,
                name="Catalog session",
                symbol="GBPUSD",
                timeframe="M1",
                csv_path=csv_path,
                current_offset=0,
                replay_ready=True,
            ),
            BacktestSession(
                user_id=user_id,
                name="Stale legacy session",
                symbol="EURUSD",
                timeframe="M1",
                csv_path="/data/EURUSD_M1.csv",
                current_offset=0,
            ),
        ]
    )
    db.commit()

    class NoopCatalog:
        def discover_catalog(self, db, user_id, *, force=False):
            return None

    service = BacktestService(dataset_catalog=NoopCatalog())

    def fail_session_check(_session):
        raise AssertionError("session_has_replay_data should not run for summary queries")

    monkeypatch.setattr(service, "session_has_replay_data", fail_session_check)
    monkeypatch.setattr(routes, "backtester", service)

    try:
        page = routes.list_backtest_summaries(offset=0, limit=10, db=db, current_user=current_user(user_id))
    finally:
        db.close()

    assert [session.name for session in page.items] == ["Catalog session"]


def test_market_data_error_response_does_not_expose_legacy_csv_path():
    response = routes.market_data_error_response(
        FileNotFoundError("CSV file not found: /data/EURUSD_M1.csv"),
    )

    assert response.status_code == 503
    assert "/data/EURUSD_M1.csv" not in response.detail


def test_metrics_summary_and_curves_routes_split_payloads():
    db = make_model_session()
    user_id = seed_user(db)
    session = BacktestSession(
        user_id=user_id,
        name="Metrics route session",
        symbol="GBPUSD",
        current_offset=0,
    )
    db.add(session)
    db.flush()
    db.add(
        Trade(
            user_id=user_id,
            session_id=session.id,
            status="CLOSED",
            side="LONG",
            entry_time=datetime(2024, 1, 3, 9, 0, tzinfo=timezone.utc),
            entry_price=100.0,
            quantity=1.0,
            remaining_quantity=0.0,
            exit_time=datetime(2024, 1, 3, 9, 30, tzinfo=timezone.utc),
            exit_price=103.0,
            realized_pnl=3.0,
            strategy_name="Breakout",
        )
    )
    db.commit()

    try:
        summary = routes.metrics_summary(db=db, current_user=current_user(user_id), session_id=session.id)
        curves = routes.metrics_curves(db=db, current_user=current_user(user_id), session_id=session.id)
        combined = routes.metrics(db=db, current_user=current_user(user_id), session_id=session.id)
    finally:
        db.close()

    assert summary.total_trades == 1
    assert len(curves.equity_curve) == 1
    assert curves.strategy_performance[0].strategy_name == "Breakout"
    assert combined.model_dump() == {**summary.model_dump(), **curves.model_dump()}


def test_trades_page_paginates_recent_trades():
    db = make_model_session()
    user_id = seed_user(db)
    session = BacktestSession(
        user_id=user_id,
        name="Trade page session",
        symbol="GBPUSD",
        current_offset=0,
    )
    db.add(session)
    db.flush()
    for index in range(3):
        db.add(
            Trade(
                user_id=user_id,
                session_id=session.id,
                status="CLOSED",
                side="LONG",
                entry_time=datetime(2024, 1, 4, 9, index, tzinfo=timezone.utc),
                entry_price=100.0,
                quantity=1.0,
                remaining_quantity=0.0,
                exit_time=datetime(2024, 1, 4, 10, index, tzinfo=timezone.utc),
                exit_price=101.0,
                realized_pnl=float(index + 1),
            )
        )
    db.commit()

    try:
        first = routes.get_trades_page(
            db=db,
            current_user=current_user(user_id),
            session_id=session.id,
            offset=0,
            limit=2,
        )
        second = routes.get_trades_page(
            db=db,
            current_user=current_user(user_id),
            session_id=session.id,
            offset=first.next_offset,
            limit=2,
        )
    finally:
        db.close()

    assert len(first.items) == 2
    assert first.has_more is True
    assert first.items[0].realized_pnl == 3.0
    assert len(second.items) == 1
    assert second.has_more is False
