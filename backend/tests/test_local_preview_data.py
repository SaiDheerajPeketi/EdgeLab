"""Disposable preview safety and genuine schema/data invariants."""
import csv
import importlib.util
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[1] / "scripts" / "local_preview_data.py"
spec = importlib.util.spec_from_file_location("local_preview_data", SCRIPT)
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)


def test_existing_directory_is_never_opened_or_changed(tmp_path):
    directory = tmp_path / "existing"
    directory.mkdir()
    original = directory / "preview.db"
    original.write_bytes(b"existing records must remain untouched")
    with pytest.raises(FileExistsError):
        preview.create_preview(directory)
    assert original.read_bytes() == b"existing records must remain untouched"
    assert sorted(path.name for path in directory.iterdir()) == ["preview.db"]


def test_real_models_populate_only_the_new_database_and_derived_csvs(tmp_path, monkeypatch):
    from app.db import engine as default_engine

    def forbid_default_database(*_args, **_kwargs):
        raise AssertionError("The configured application database must never be opened")

    monkeypatch.setattr(default_engine, "connect", forbid_default_database)
    directory = tmp_path / "fresh"
    result = preview.create_preview(directory, as_of=datetime(2026, 10, 10, 12, tzinfo=timezone.utc))
    with sqlite3.connect(result["database"]) as db:
        count = lambda table: db.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        assert count("beta_users") == 1
        assert db.execute("SELECT email,name,status FROM beta_users").fetchone() == (
            "developer@localhost.edgelab", "Demo data", "APPROVED")
        assert count("journal_accounts") == 2
        assert count("canonical_trades") == 80
        assert count("canonical_executions") == 156
        assert count("canonical_trade_notes") == 80
        assert count("journal_daily_notes") == 16
        assert db.execute("SELECT count(*) FROM journal_daily_notes WHERE note_date='2026-10-10'").fetchone()[0] == 2
        assert db.execute("SELECT count(*) FROM canonical_trades WHERE entry_time >= '2026-10-10'").fetchone()[0] == 4
        assert db.execute("SELECT count(*) FROM canonical_trade_tags JOIN journal_tags ON tag_id=journal_tags.id WHERE journal_tags.name='Demo data'").fetchone()[0] == 80
        assert count("backtest_sessions") == count("backtest_session_summaries") == 3
        assert db.execute("SELECT session_id,side,quantity FROM positions ORDER BY session_id").fetchall() == [
            (1, "FLAT", 0), (2, "FLAT", 0), (3, "FLAT", 0)]
        assert count("trades") == 24
        assert count("dataset_assets") == 3
        assert count("dataset_timeframes") == 12
        assert count("app_storage") == 12
        layout = json.loads(db.execute("SELECT value FROM app_storage WHERE key='chart-layout.v1'").fetchone()[0])
        assert layout["watchlistSelection"] == {"id": None, "symbol": "ES"}
        assert count("orders") == count("executions") == count("beta_sessions") == 0
        assert count("billing_customers") == count("billing_subscriptions") == count("broker_orders") == 0
        assert count("market_instruments") == count("market_instrument_identifiers") == 1
        assert count("market_trade_ticks") == 720
        assert count("persisted_footprints") == 154
        assert count("market_data_entitlements") == 0
        assert db.execute("SELECT canonical_symbol,display_name FROM market_instruments").fetchone() == (
            "BTCUSDT", "Demo BTCUSDT · synthetic offline trades")
        assert db.execute("SELECT DISTINCT provider FROM market_trade_ticks").fetchall() == [("offline-fixture",)]
        assert db.execute("SELECT DISTINCT availability,licensed FROM market_provider_states").fetchall() == [
            ("AVAILABLE_OFFLINE", 0)]
        assert db.execute("SELECT min(sequence),max(sequence),count(DISTINCT sequence) FROM market_trade_ticks").fetchone() == (0, 719, 720)
        assert db.execute("SELECT interval_seconds,count(*) FROM persisted_footprints GROUP BY interval_seconds ORDER BY interval_seconds").fetchall() == [(60, 120), (300, 24), (900, 8), (3600, 2)]
        for footprint_id, start, end, bid, ask, total, delta, trades, complete in db.execute(
                "SELECT id,start_at,end_at,bid_volume,ask_volume,total_volume,delta,trade_count,complete FROM persisted_footprints"):
            source = db.execute("SELECT sum(CASE WHEN aggressor_side='BID' THEN size ELSE 0 END),sum(CASE WHEN aggressor_side='ASK' THEN size ELSE 0 END),count(*) FROM market_trade_ticks WHERE exchange_timestamp>=? AND exchange_timestamp<?", (start, end)).fetchone()
            assert (bid, ask, trades) == pytest.approx(source)
            assert total == pytest.approx(bid + ask)
            assert delta == pytest.approx(ask - bid)
            assert complete == 1
            assert datetime.fromisoformat(end) <= datetime(2026, 10, 10, 12)
            level_total = db.execute("SELECT sum(total_volume) FROM persisted_footprint_levels WHERE footprint_id=?", (footprint_id,)).fetchone()[0]
            assert level_total == pytest.approx(total)
        assert db.execute("SELECT status,count(*) FROM canonical_trades GROUP BY status ORDER BY status").fetchall() == [("CLOSED", 76), ("OPEN", 4)]
        assert db.execute("SELECT sum(closed_trades) FROM backtest_session_summaries").fetchone()[0] == 24
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
        trade_prices = db.execute("SELECT entry_time,entry_price,exit_time,exit_price FROM canonical_trades").fetchall()
    assert result["environment"]["EDGELAB_BILLING_ENABLED"] == "0"
    assert result["environment"]["DATABASE_URL"].endswith(str(directory / "preview.db"))
    assert result["order_flow"] == {"instrument_id": 1, "provider": "offline-fixture", "synthetic": True,
        "trade_ticks": 720, "footprints": {"60": 120, "300": 24, "900": 8, "3600": 2}}
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session, sessionmaker
    from app.models import AppDataOperation, BacktestSession
    from app.services import app_data_operations
    from app.services.backtester import BacktestService
    from app.services.datasets import DatasetCatalogService
    from app.services.market_data import MarketDataService
    from app.services.market_infrastructure import list_footprints
    isolated_engine = create_engine(result["environment"]["DATABASE_URL"], connect_args={"timeout": .2})
    factory = sessionmaker(bind=isolated_engine)
    monkeypatch.setattr(app_data_operations, "SessionLocal", factory)
    try:
        with Session(isolated_engine) as db:
            key = "ea893a81-ded2-4c1e-91cc-5974c0b5a287"
            db.add(AppDataOperation(user_id=1, operation_id=key, method="GET", path="/backtests/3", status="running"))
            db.commit()
            catalog = DatasetCatalogService(directory / "datasets", factory)
            backtester = BacktestService(None, catalog)
            state = backtester.get_state(db, 1, 3)
            assert state.session.symbol == "ES" and state.session.current_offset == 3000
            assert state.current_candle.timestamp == datetime(2026, 10, 5, 2)
            assert len(state.trades) == 8 and state.metrics.total_trades == 8
            assert not db.new and not db.dirty
            # Genuine receipt completion on its separate connection must finish
            # while the replay request's read session is still open.
            app_data_operations.complete(1, key, 200)
            with factory() as receipt_db:
                receipt = receipt_db.query(AppDataOperation).filter_by(operation_id=key).one()
                assert receipt.status == "completed" and receipt.http_status == 200
            service = backtester.market_data_for_session(db.get(BacktestSession, 3))
            assert isinstance(service, MarketDataService) and service.cache is False
            metadata = service.get_metadata()
            assert metadata.rows == 10800
            assert metadata.first_timestamp == datetime(2026, 10, 3)
            assert metadata.last_timestamp == datetime(2026, 10, 10, 11, 59)
            assert len(service.get_bars(offset=3000, limit=600).bars) == 600
            rows = list_footprints(db, 1, 1, from_at=datetime(2026, 10, 10, 10, tzinfo=timezone.utc),
                to_at=datetime(2026, 10, 10, 12, tzinfo=timezone.utc), interval_seconds=300)
            assert len(rows) == 24 and all(row.provider == "offline-fixture" for row in rows)
            assert rows[-1].end_at == datetime(2026, 10, 10, 12)
            with pytest.raises(ValueError, match="timezone-aware"):
                preview.seed_preview_order_flow(db, 1, datetime(2026, 10, 10, 12))
            with pytest.raises(ValueError, match="Demo data user"):
                preview.seed_preview_order_flow(db, 999, datetime(2026, 10, 10, 12, tzinfo=timezone.utc))
            with pytest.raises(ValueError, match="existing BTCUSDT"):
                preview.seed_preview_order_flow(db, 1, datetime(2026, 10, 10, 12, tzinfo=timezone.utc))
    finally:
        isolated_engine.dispose()
    for symbol in ("BTCUSDT", "EURUSD", "ES"):
        def read(timeframe):
            with (directory / "datasets" / symbol / f"{symbol}_{timeframe}.csv").open() as handle:
                return list(csv.DictReader(handle))
        minute = read("M1")
        assert len(minute) == 10800
        timestamps = [datetime.fromisoformat(row["Timestamp"]) for row in minute]
        assert all((b - a).total_seconds() == 60 for a, b in zip(timestamps, timestamps[1:]))
        assert all(0 < float(row["Low"]) <= min(float(row["Open"]), float(row["Close"]))
                   <= max(float(row["Open"]), float(row["Close"])) <= float(row["High"])
                   and float(row["Volume"]) > 0 for row in minute)
        if symbol == "ES":
            closes = {datetime.fromisoformat(row["Timestamp"]).replace(tzinfo=None): float(row["Close"]) for row in minute}
            for entry, entry_price, exit_time, exit_price in trade_prices:
                assert float(entry_price) == pytest.approx(closes[datetime.fromisoformat(entry)])
                if exit_time is not None:
                    assert float(exit_price) == pytest.approx(closes[datetime.fromisoformat(exit_time)])
        for timeframe, size in (("M5", 5), ("M15", 15), ("H1", 60)):
            derived = read(timeframe)
            assert len(derived) == 10800 // size
            for group_index in (0, 19, len(derived) - 1):
                children = minute[group_index * size:(group_index + 1) * size]
                row = derived[group_index]
                assert row["Timestamp"] == children[0]["Timestamp"]
                assert row["Open"] == children[0]["Open"]
                assert float(row["High"]) == max(float(child["High"]) for child in children)
                assert float(row["Low"]) == min(float(child["Low"]) for child in children)
                assert row["Close"] == children[-1]["Close"]
                assert float(row["Volume"]) == pytest.approx(sum(float(child["Volume"]) for child in children))
    with pytest.raises(FileExistsError):
        preview.create_preview(directory)
