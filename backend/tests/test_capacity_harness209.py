from __future__ import annotations

import io
import json
import time
from pathlib import Path
from types import SimpleNamespace
from urllib.error import HTTPError

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import BacktestSession, BetaSession, BetaUser, DatasetAsset, DatasetTimeframe, Trade
from app.services.market_data import MarketDataService
from backend.scripts import load_test_services as load
from backend.scripts import seed_benchmark_data as seed


def mixed_args(tmp_path, **changes):
    manifest = tmp_path / "users.json"
    manifest.write_text(json.dumps({"auth_tokens": [
        {"user_id": 1, "token": "owner-1", "latest_backtest_session_id": 101},
        {"user_id": 2, "token": "owner-2", "latest_backtest_session_id": 202},
    ]}))
    values = dict(benchmark_users_file=str(manifest), auth_tokens="", auth_token="", session_ids="", session_id=None,
        concurrency=2, api_url="http://benchmark.invalid/api", frontend_url="", summaries_limit=50, bars_limit=300,
        no_analytics=False, no_market_data=False, duration_seconds=0.12, think_time=0,
        timeout=1, network_rtt_ms=0, p95_ms=750, p99_ms=1500, max_error_rate=0.01)
    return SimpleNamespace(**{**values, **changes})


def test_seed_has_real_market_files_distinct_owners_and_complete_reset(tmp_path, monkeypatch):
    monkeypatch.setattr(seed, "create_session_token", lambda user_id, *_: f"owner-{user_id}")
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    blueprint = seed.build_catalog_blueprint(tmp_path / "datasets", 1, ["M1", "M5"], 20)
    # Repeating the same fixture generation preserves its files and metadata.
    assert seed.build_catalog_blueprint(tmp_path / "datasets", 1, ["M1", "M5"], 20) == blueprint
    with sessionmaker(bind=engine)() as db:
        seeded = [seed.seed_user_workload(db, user_index=index, email_prefix="benchmark_user", timeframe_names=["M1", "M5"],
            catalog_blueprint=blueprint, sessions_per_user=2, trades_per_session=2, session_ttl_days=1) for index in range(2)]
        db.commit()
        assert len({row["user_id"] for row in seeded}) == 2
        for row in seeded:
            replay = db.get(BacktestSession, row["latest_backtest_session_id"])
            assert replay.user_id == row["user_id"]
            assert replay.dataset_asset_id is not None
            assert replay.realized_pnl == 7.5
            service = MarketDataService(Path(replay.csv_path))
            assert service.get_metadata().rows == 20
            assert len(service.get_bars(limit=10).bars) == 10
        frame = db.scalar(select(DatasetTimeframe).limit(1))
        assert frame.rows == 20 and frame.file_size > 0
        seed.reset_seeded_users(db, "benchmark_user")
        db.commit()
        for model in (BetaUser, BetaSession, BacktestSession, Trade, DatasetAsset, DatasetTimeframe):
            assert db.scalar(select(func.count()).select_from(model)) == 0


def test_reset_refuses_nonbenchmark_users_without_touching_them():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as db:
        db.add_all([BetaUser(email="benchmark_user+000@edgelab.local"), BetaUser(email="benchmarkXuser+000@edgelab.local")])
        db.commit()
        with pytest.raises(ValueError, match="non-benchmark"):
            seed.reset_seeded_users(db, "benchmark_user")
        assert db.scalar(select(func.count()).select_from(BetaUser)) == 2
    with pytest.raises(ValueError, match="prefix"):
        seed.validate_email_prefix("%")


def test_percentile_uses_nearest_rank_and_histogram_storage_is_bounded():
    assert load.percentile(list(range(1, 11)), 0.95) == 10
    stats = load.RequestStats()
    for _ in range(20000):
        stats.record(load.RequestResult(True, 200, 15.0, 12, observed_latency_ms=10.0))
    assert len(stats.wall_bins) == len(stats.observed_bins) == 1
    assert 15 <= stats.quantile(0.99) <= 15 * 1.01
    assert stats.response_bytes == 240000
    assert stats.report(10, 750, 1500, 0.01)["passed"]


def test_fetch_preserves_error_body_and_separates_modeled_delay(monkeypatch):
    times = iter([0.0, 0.01, 0.03])
    sleeps = []
    monkeypatch.setattr(load.time, "perf_counter", lambda: next(times))
    monkeypatch.setattr(load.time, "sleep", sleeps.append)
    def failed(*_args, **_kwargs):
        raise HTTPError("http://benchmark.invalid", 429, "limited", {}, io.BytesIO(b'{"detail":"limited"}'))
    monkeypatch.setattr(load, "urlopen", failed)
    result = load.fetch("http://benchmark.invalid", {}, 1, expect_json=True, network_rtt_ms=10)
    assert not result.ok and result.status == 429 and result.response_bytes == 20
    assert result.latency_ms == pytest.approx(30)
    assert result.observed_latency_ms == pytest.approx(20)
    assert sleeps == [0.01]


def test_invalid_json_fails_even_when_http_status_is_success(monkeypatch):
    class Response(io.BytesIO):
        status = 200
    monkeypatch.setattr(load, "urlopen", lambda *_args, **_kwargs: Response(b"not json"))
    result = load.fetch("http://benchmark.invalid", {}, 1, expect_json=True)
    assert not result.ok and result.error == "Invalid JSON response"


def test_mixed_workload_uses_aligned_owners_and_any_endpoint_slo_failure_fails(tmp_path, monkeypatch):
    seen = []
    def fetch(url, headers, _timeout, **_kwargs):
        time.sleep(0.002)
        seen.append((url, headers.get("Authorization")))
        slow = "trades/page" in url
        return load.RequestResult(True, 200, 1600 if slow else 1, 30, observed_latency_ms=1)
    monkeypatch.setattr(load, "fetch", fetch)
    report = load.exercise_mixed(mixed_args(tmp_path))
    assert not report["passed"]
    assert report["active_workers"] == report["distinct_manifest_users"] == 2
    assert report["endpoints"]["trades_page"]["passed"] is False
    assert report["endpoints"]["bootstrap_shell"]["passed"] is True
    assert report["aggregate"]["response_bytes"] == sum(report["worker_request_counts"]) * 30
    for url, header in seen:
        if "session_id=" in url:
            assert ("session_id=101" in url) == (header == "Bearer owner-1")
            assert ("session_id=202" in url) == (header == "Bearer owner-2")


def test_worker_failure_and_insufficient_distinct_credentials_never_claim_capacity(tmp_path, monkeypatch):
    args = mixed_args(tmp_path, concurrency=3)
    with pytest.raises(ValueError, match="distinct user credential"):
        load.exercise_mixed(args)
    def failed(*_args, **_kwargs):
        raise RuntimeError("generator failed")
    monkeypatch.setattr(load, "fetch", failed)
    report = load.exercise_mixed(mixed_args(tmp_path))
    assert report["passed"] is False and len(report["worker_errors"]) == 2
    assert report["active_workers"] == 0
    assert report["missing_endpoints"]
    assert report["aggregate"]["p99_wall_ms"] is None
    json.dumps(report, allow_nan=False)
