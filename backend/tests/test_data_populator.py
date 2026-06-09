import json
from datetime import datetime, timezone

import pandas as pd

from app.services.data_populator import (
    MANIFEST_FILENAME,
    MarketCandle,
    ScheduledDataPopulator,
    binance_kline_to_candle,
    crypto_spec,
    dukascopy_row_to_candle,
)


def candle(timestamp: str, close: float) -> MarketCandle:
    return MarketCandle(
        timestamp=datetime.fromisoformat(timestamp).replace(tzinfo=timezone.utc),
        open=close,
        high=close,
        low=close,
        close=close,
        volume=10.0,
    )


def test_data_populator_derives_higher_timeframes_from_m1(tmp_path):
    populator = ScheduledDataPopulator(
        tmp_path,
        forex_symbols=(),
        crypto_symbols=("BTCUSDT",),
        derived_timeframes=("M5", "H1"),
    )
    result = populator.write_candles(
        crypto_spec("BTCUSDT"),
        [
            candle("2024-01-01T00:00:00", 100.0),
            candle("2024-01-01T00:01:00", 101.0),
            candle("2024-01-01T00:02:00", 102.0),
            candle("2024-01-01T00:03:00", 103.0),
            candle("2024-01-01T00:04:00", 104.0),
            candle("2024-01-01T00:05:00", 105.0),
            candle("2024-01-01T00:06:00", 106.0),
            candle("2024-01-01T00:07:00", 107.0),
            candle("2024-01-01T00:08:00", 108.0),
            candle("2024-01-01T00:09:00", 109.0),
        ],
    )

    m1 = pd.read_csv(result.csv_path)
    m5 = pd.read_csv(tmp_path / "BTC_USDT" / "BTCUSDT_M5.csv")
    h1 = pd.read_csv(tmp_path / "BTC_USDT" / "BTCUSDT_H1.csv")

    assert result.rows == 10
    assert m1["Timestamp"].tolist()[:3] == [
        "2024-01-01 00:00:00",
        "2024-01-01 00:01:00",
        "2024-01-01 00:02:00",
    ]
    assert m5["Timestamp"].tolist() == ["2024-01-01 00:00:00", "2024-01-01 00:05:00"]
    assert m5.loc[0, "Open"] == 100.0
    assert m5.loc[0, "High"] == 104.0
    assert m5.loc[0, "Low"] == 100.0
    assert m5.loc[0, "Close"] == 104.0
    assert m5.loc[0, "Volume"] == 50.0
    assert h1.loc[0, "Open"] == 100.0
    assert h1.loc[0, "Close"] == 109.0
    assert h1.loc[0, "Volume"] == 100.0
    manifest = json.loads((tmp_path / MANIFEST_FILENAME).read_text(encoding="utf-8"))
    timeframes = manifest["markets"]["BTC_USDT"]["timeframes"]
    assert timeframes["M1"]["rows"] == 10
    assert timeframes["M1"]["last_timestamp"] == "2024-01-01T00:09:00Z"
    assert timeframes["M5"]["rows"] == 2
    assert timeframes["M5"]["last_timestamp"] == "2024-01-01T00:05:00Z"


def test_data_populator_does_not_synthesize_missing_m1_minutes(tmp_path):
    populator = ScheduledDataPopulator(
        tmp_path,
        forex_symbols=(),
        crypto_symbols=("ETHUSDT",),
        derived_timeframes=("M5",),
    )
    result = populator.write_candles(
        crypto_spec("ETHUSDT"),
        [
            candle("2024-01-01T00:00:00", 100.0),
            candle("2024-01-01T00:02:00", 102.0),
        ],
    )

    m1 = pd.read_csv(result.csv_path)
    m5 = pd.read_csv(tmp_path / "ETH_USDT" / "ETHUSDT_M5.csv")

    assert result.rows == 2
    assert m1["Timestamp"].tolist() == [
        "2024-01-01 00:00:00",
        "2024-01-01 00:02:00",
    ]
    assert m5.loc[0, "Open"] == 100.0
    assert m5.loc[0, "Close"] == 102.0
    assert m5.loc[0, "Volume"] == 20.0


def test_data_populator_uses_max_backfill_mode_by_default(tmp_path):
    populator = ScheduledDataPopulator(
        tmp_path,
        forex_symbols=("EUR/USD",),
        crypto_symbols=("BTCUSDT",),
    )
    end_at = datetime(2024, 1, 1, tzinfo=timezone.utc)

    assert populator.next_fetch_start(
        crypto_spec("BTCUSDT"),
        tmp_path / "BTC_USDT" / "BTCUSDT_M1.csv",
        end_at,
    ) == datetime(2017, 8, 17, tzinfo=timezone.utc)


def test_data_populator_resumes_from_manifest(tmp_path):
    spec = crypto_spec("BTCUSDT")
    populator = ScheduledDataPopulator(
        tmp_path,
        forex_symbols=(),
        crypto_symbols=("BTCUSDT",),
        derived_timeframes=(),
    )
    result = populator.write_candles(
        spec,
        [
            candle("2024-01-01T00:00:00", 100.0),
            candle("2024-01-01T00:01:00", 101.0),
        ],
    )
    resumed = ScheduledDataPopulator(
        tmp_path,
        forex_symbols=(),
        crypto_symbols=("BTCUSDT",),
        derived_timeframes=(),
    )

    assert resumed.next_fetch_start(
        spec,
        tmp_path / "BTC_USDT" / "BTCUSDT_M1.csv",
        datetime(2024, 1, 1, 1, tzinfo=timezone.utc),
    ) == datetime(2024, 1, 1, 0, 2, tzinfo=timezone.utc)
    assert json.loads((tmp_path / MANIFEST_FILENAME).read_text(encoding="utf-8"))[
        "markets"
    ]["BTC_USDT"]["timeframes"]["M1"]["csv_path"] == "BTC_USDT/BTCUSDT_M1.csv"
    assert result.rows == 2


def test_data_populator_ignores_manifest_when_csv_is_missing(tmp_path):
    manifest_path = tmp_path / MANIFEST_FILENAME
    manifest_path.write_text(
        json.dumps(
            {
                "version": 1,
                "markets": {
                    "BTC_USDT": {
                        "provider": "binance",
                        "instrument": "BTCUSDT",
                        "symbol": "BTCUSDT",
                        "timeframes": {
                            "M1": {
                                "csv_path": "BTC_USDT/BTCUSDT_M1.csv",
                                "rows": 1,
                                "first_timestamp": "2024-01-01T00:00:00Z",
                                "last_timestamp": "2024-01-01T00:00:00Z",
                            }
                        },
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    populator = ScheduledDataPopulator(
        tmp_path,
        forex_symbols=(),
        crypto_symbols=("BTCUSDT",),
        derived_timeframes=(),
    )

    assert populator.next_fetch_start(
        crypto_spec("BTCUSDT"),
        tmp_path / "BTC_USDT" / "BTCUSDT_M1.csv",
        datetime(2024, 1, 1, tzinfo=timezone.utc),
    ) == datetime(2017, 8, 17, tzinfo=timezone.utc)


def test_data_populator_parses_provider_rows():
    binance = binance_kline_to_candle([1704067200000, "1", "2", "0.5", "1.5", "99"])
    dukascopy = dukascopy_row_to_candle([1704067200000, 1, 2, 0.5, 1.5, 99])

    assert binance.timestamp == datetime(2024, 1, 1, tzinfo=timezone.utc)
    assert binance.close == 1.5
    assert dukascopy is not None
    assert dukascopy.timestamp == datetime(2024, 1, 1, tzinfo=timezone.utc)
    assert dukascopy.close == 1.5
