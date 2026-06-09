from datetime import datetime, timezone

import pandas as pd

from app.services.data_populator import (
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


def test_data_populator_interpolates_short_minute_gaps(tmp_path):
    populator = ScheduledDataPopulator(
        tmp_path,
        forex_symbols=(),
        crypto_symbols=("BTCUSDT",),
        max_interpolation_gap_minutes=3,
    )
    result = populator.write_candles(
        crypto_spec("BTCUSDT"),
        [
            candle("2024-01-01T00:00:00", 100.0),
            candle("2024-01-01T00:02:00", 102.0),
        ],
    )

    frame = pd.read_csv(result.csv_path)

    assert result.rows == 3
    assert frame["Timestamp"].tolist() == [
        "2024-01-01 00:00:00",
        "2024-01-01 00:01:00",
        "2024-01-01 00:02:00",
    ]
    assert frame.loc[1, "Open"] == 100.0
    assert frame.loc[1, "Close"] == 101.0
    assert frame.loc[1, "High"] == 101.0
    assert frame.loc[1, "Low"] == 100.0
    assert frame.loc[1, "Volume"] == 0.0


def test_data_populator_does_not_interpolate_large_gaps(tmp_path):
    populator = ScheduledDataPopulator(
        tmp_path,
        forex_symbols=(),
        crypto_symbols=("ETHUSDT",),
        max_interpolation_gap_minutes=2,
    )
    result = populator.write_candles(
        crypto_spec("ETHUSDT"),
        [
            candle("2024-01-01T00:00:00", 100.0),
            candle("2024-01-01T00:05:00", 105.0),
        ],
    )

    frame = pd.read_csv(result.csv_path)

    assert result.rows == 2
    assert frame["Timestamp"].tolist() == [
        "2024-01-01 00:00:00",
        "2024-01-01 00:05:00",
    ]


def test_data_populator_parses_provider_rows():
    binance = binance_kline_to_candle([1704067200000, "1", "2", "0.5", "1.5", "99"])
    dukascopy = dukascopy_row_to_candle([1704067200000, 1, 2, 0.5, 1.5, 99])

    assert binance.timestamp == datetime(2024, 1, 1, tzinfo=timezone.utc)
    assert binance.close == 1.5
    assert dukascopy is not None
    assert dukascopy.timestamp == datetime(2024, 1, 1, tzinfo=timezone.utc)
    assert dukascopy.close == 1.5
