from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import pytest

from app.services import backtester
from app.services.backtester import BacktestService
from app.services.candle_frames import frame_to_candles
from app.services.market_data import MarketDataService


@pytest.mark.parametrize("cache", [False, True])
def test_csv_bars_keep_timezone_prices_volume_and_indicator_warmup(tmp_path, cache):
    path = tmp_path / "candles.csv"
    timestamps = pd.date_range("2026-01-01 09:30", periods=40, freq="min")
    closes = [100 + (index % 7) * 0.5 for index in range(40)]
    frame = pd.DataFrame({
        "Timestamp": timestamps, "Open": [value - 0.25 for value in closes],
        "High": [value + 1 for value in closes], "Low": [value - 1 for value in closes],
        "Close": closes, "Volume": [10 + index * 0.5 for index in range(40)],
    })
    frame.to_csv(path, index=False)
    service = MarketDataService(path, cache=cache, timestamp_timezone="Asia/Kolkata")
    response = service.get_bars(offset=10, limit=25, warmup=10)
    assert response.next_offset == 35
    assert len(response.bars) == 25
    first = response.bars[0]
    assert first.timestamp == datetime(2026, 1, 1, 9, 40)
    assert first.time == int(datetime(2026, 1, 1, 4, 10, tzinfo=timezone.utc).timestamp())
    assert (first.open, first.high, first.low, first.close, first.volume) == (101.25, 102.5, 100.5, 101.5, 15)
    assert first.rsi_14 is None
    expected = service._with_indicators(frame.copy())
    for index, bar in enumerate(response.bars, start=10):
        assert bar.ema_20 == pytest.approx(expected.iloc[index]["ema_20"])
        assert bar.ema_50 == pytest.approx(expected.iloc[index]["ema_50"])
        expected_rsi = expected.iloc[index]["rsi_14"]
        assert bar.rsi_14 is None if pd.isna(expected_rsi) else bar.rsi_14 == pytest.approx(expected_rsi)


def test_tuple_conversion_handles_reordered_columns_and_nullable_indicators():
    frame = pd.DataFrame({
        "Volume": [123.5], "rsi_14": [pd.NA], "High": [102],
        "Timestamp": [pd.Timestamp("2026-01-01T09:30:00Z")], "Close": [101],
        "ema_20": [float("nan")], "Low": [99], "Open": [100], "ema_50": [100.5],
    })
    bar = frame_to_candles(frame, lambda value: value.astimezone(timezone.utc))[0]
    assert bar.time == 1767259800
    assert (bar.open, bar.high, bar.low, bar.close, bar.volume) == (100, 102, 99, 101, 123.5)
    assert (bar.ema_20, bar.ema_50, bar.rsi_14) == (None, 100.5, None)
    assert frame_to_candles(pd.DataFrame(), lambda value: value) == []


def test_market_service_registry_is_bounded_and_reuses_recent_sources(monkeypatch):
    monkeypatch.setattr(backtester, "MARKET_DATA_CACHE_MAX_ENTRIES", 3)
    service = BacktestService()
    first = service.market_data_for_path("/not-read/first.csv")
    second = service.market_data_for_path("/not-read/second.csv")
    service.market_data_for_path("/not-read/third.csv")
    assert service.market_data_for_path("/not-read/first.csv") is first
    service.market_data_for_path("/not-read/fourth.csv")
    assert len(service._market_data_cache) == 3
    assert service.market_data_for_path("/not-read/second.csv") is not second


def test_active_service_survives_parallel_registry_eviction(monkeypatch, tmp_path):
    monkeypatch.setattr(backtester, "MARKET_DATA_CACHE_MAX_ENTRIES", 2)
    source = tmp_path / "active.csv"
    source.write_text("Timestamp,Open,High,Low,Close,Volume\n2026-01-01 00:00:00,1,2,0.5,1.5,10\n")
    registry = BacktestService()
    active = registry.market_data_for_path(str(source))
    with ThreadPoolExecutor(max_workers=8) as executor:
        services = list(executor.map(
            lambda index: registry.market_data_for_path(f"/not-read/{index}.csv"), range(100),
        ))
    assert len(services) == 100
    assert len(registry._market_data_cache) <= 2
    assert active.get_bars().bars[0].close == 1.5
