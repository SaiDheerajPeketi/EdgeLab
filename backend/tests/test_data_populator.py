import io
import json
import threading
import warnings
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse
from zipfile import ZipFile

import pandas as pd

from app.services import data_populator as data_populator_module
from app.services.data_populator import (
    MANIFEST_FILENAME,
    MarketCandle,
    MarketSpec,
    ScheduledDataPopulator,
    binance_kline_to_candle,
    crypto_spec,
    dukascopy_row_to_candle,
    fetch_json_url,
    forex_spec,
    normalize_frame,
)


def binance_zip(*rows: str) -> bytes:
    payload = io.BytesIO()
    with ZipFile(payload, "w") as archive:
        archive.writestr("BTCUSDT-1m-2024-01.csv", "\n".join(rows) + "\n")
    return payload.getvalue()


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
    assert timeframes["M1"]["file_size"] > 0
    assert timeframes["M1"]["file_mtime_ns"] > 0
    assert timeframes["M5"]["rows"] == 2
    assert timeframes["M5"]["last_timestamp"] == "2024-01-01T00:05:00Z"
    assert timeframes["M5"]["file_size"] > 0
    assert timeframes["M5"]["file_mtime_ns"] > 0


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
        crypto_start_date="2024-01-01",
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
        crypto_start_date="2024-01-01",
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


def test_data_populator_max_mode_backfills_before_first_local_timestamp(tmp_path):
    spec = crypto_spec("BTCUSDT")
    populator = ScheduledDataPopulator(
        tmp_path,
        forex_symbols=(),
        crypto_symbols=("BTCUSDT",),
        crypto_start_date="2020-01-01",
        derived_timeframes=(),
    )
    populator.write_candles(
        spec,
        [
            candle("2024-01-01T00:00:00", 100.0),
            candle("2024-01-01T00:01:00", 101.0),
        ],
    )

    fetch_range = populator.next_fetch_range(
        spec,
        tmp_path / "BTC_USDT" / "BTCUSDT_M1.csv",
        datetime(2024, 1, 1, 1, tzinfo=timezone.utc),
    )

    assert fetch_range is not None
    assert fetch_range.reason == "historical-backfill"
    assert fetch_range.start_at == datetime(2020, 1, 1, tzinfo=timezone.utc)
    assert fetch_range.end_at == datetime(2023, 12, 31, 23, 59, tzinfo=timezone.utc)


def test_data_populator_records_empty_historical_ranges(tmp_path):
    class EmptyPagePopulator(ScheduledDataPopulator):
        def fetch_candle_pages(
            self,
            spec: MarketSpec,
            start_at: datetime,
            end_at: datetime,
        ):
            return iter(())

    spec = crypto_spec("BTCUSDT")
    populator = EmptyPagePopulator(
        tmp_path,
        forex_symbols=(),
        crypto_symbols=("BTCUSDT",),
        crypto_start_date="2020-01-01",
        derived_timeframes=(),
    )
    populator.write_candles(
        spec,
        [
            candle("2024-01-01T00:00:00", 100.0),
            candle("2024-01-01T00:01:00", 101.0),
        ],
    )

    summary = populator.populate_once(now=datetime(2024, 1, 1, 1, tzinfo=timezone.utc))
    fetch_range = populator.next_fetch_range(
        spec,
        tmp_path / "BTC_USDT" / "BTCUSDT_M1.csv",
        datetime(2024, 1, 1, 2, tzinfo=timezone.utc),
    )
    manifest = json.loads((tmp_path / MANIFEST_FILENAME).read_text(encoding="utf-8"))
    timeframe = manifest["markets"]["BTC_USDT"]["timeframes"]["M1"]

    assert summary.results[0].fetched == 0
    assert timeframe["no_data_before"] == "2023-12-31T23:59:00Z"
    assert fetch_range is not None
    assert fetch_range.reason == "append-latest"
    assert fetch_range.start_at == datetime(2024, 1, 1, 0, 2, tzinfo=timezone.utc)


def test_populate_once_continues_to_latest_after_empty_historical_range(tmp_path):
    calls: list[tuple[datetime, datetime]] = []

    class HistoricalGapPopulator(ScheduledDataPopulator):
        def fetch_candle_pages(
            self,
            spec: MarketSpec,
            start_at: datetime,
            end_at: datetime,
        ):
            calls.append((start_at, end_at))
            if start_at.year == 2020:
                return iter(())
            return iter(
                [
                    [
                        candle("2024-01-01T00:02:00", 102.0),
                        candle("2024-01-01T00:03:00", 103.0),
                        candle("2024-01-01T00:04:00", 104.0),
                    ]
                ]
            )

    spec = crypto_spec("BTCUSDT")
    populator = HistoricalGapPopulator(
        tmp_path,
        forex_symbols=(),
        crypto_symbols=("BTCUSDT",),
        crypto_start_date="2020-01-01",
        derived_timeframes=(),
    )
    populator.write_candles(
        spec,
        [
            candle("2024-01-01T00:00:00", 100.0),
            candle("2024-01-01T00:01:00", 101.0),
        ],
    )

    summary = populator.populate_once(now=datetime(2024, 1, 1, 0, 5, tzinfo=timezone.utc))
    m1 = pd.read_csv(tmp_path / "BTC_USDT" / "BTCUSDT_M1.csv")

    assert summary.results[0].fetched == 3
    assert calls == [
        (
            datetime(2020, 1, 1, tzinfo=timezone.utc),
            datetime(2023, 12, 31, 23, 59, tzinfo=timezone.utc),
        ),
        (
            datetime(2024, 1, 1, 0, 2, tzinfo=timezone.utc),
            datetime(2024, 1, 1, 0, 4, tzinfo=timezone.utc),
        ),
    ]
    assert m1["Timestamp"].tolist() == [
        "2024-01-01 00:00:00",
        "2024-01-01 00:01:00",
        "2024-01-01 00:02:00",
        "2024-01-01 00:03:00",
        "2024-01-01 00:04:00",
    ]


def test_populate_once_backfills_internal_crypto_gap(tmp_path):
    calls: list[tuple[datetime, datetime]] = []

    class InternalGapPopulator(ScheduledDataPopulator):
        def fetch_candle_pages(
            self,
            spec: MarketSpec,
            start_at: datetime,
            end_at: datetime,
        ):
            calls.append((start_at, end_at))
            yield [
                candle("2024-01-01T00:02:00", 102.0),
                candle("2024-01-01T00:03:00", 103.0),
                candle("2024-01-01T00:04:00", 104.0),
            ]

    spec = crypto_spec("BTCUSDT")
    populator = InternalGapPopulator(
        tmp_path,
        forex_symbols=(),
        crypto_symbols=("BTCUSDT",),
        crypto_start_date="2024-01-01",
        derived_timeframes=(),
    )
    populator.write_candles(
        spec,
        [
            candle("2024-01-01T00:00:00", 100.0),
            candle("2024-01-01T00:01:00", 101.0),
            candle("2024-01-01T00:05:00", 105.0),
            candle("2024-01-01T00:06:00", 106.0),
        ],
    )

    fetch_range = populator.next_fetch_range(
        spec,
        tmp_path / "BTC_USDT" / "BTCUSDT_M1.csv",
        datetime(2024, 1, 1, 0, 6, tzinfo=timezone.utc),
    )
    summary = populator.populate_once(now=datetime(2024, 1, 1, 0, 7, tzinfo=timezone.utc))
    m1 = pd.read_csv(tmp_path / "BTC_USDT" / "BTCUSDT_M1.csv")

    assert fetch_range is not None
    assert fetch_range.reason == "internal-gap"
    assert fetch_range.start_at == datetime(2024, 1, 1, 0, 2, tzinfo=timezone.utc)
    assert fetch_range.end_at == datetime(2024, 1, 1, 0, 4, tzinfo=timezone.utc)
    assert calls == [
        (
            datetime(2024, 1, 1, 0, 2, tzinfo=timezone.utc),
            datetime(2024, 1, 1, 0, 4, tzinfo=timezone.utc),
        )
    ]
    assert summary.results[0].fetched == 3
    assert m1["Timestamp"].tolist() == [
        "2024-01-01 00:00:00",
        "2024-01-01 00:01:00",
        "2024-01-01 00:02:00",
        "2024-01-01 00:03:00",
        "2024-01-01 00:04:00",
        "2024-01-01 00:05:00",
        "2024-01-01 00:06:00",
    ]


def test_data_populator_ignores_forex_weekend_internal_gap(tmp_path):
    spec = forex_spec("EUR/USD")
    populator = ScheduledDataPopulator(
        tmp_path,
        forex_symbols=("EUR/USD",),
        crypto_symbols=(),
        forex_start_date="2024-01-05",
        derived_timeframes=(),
    )
    csv_path = tmp_path / "EUR_USD" / "EURUSD_M1.csv"
    populator.write_candles(
        spec,
        [
            candle("2024-01-05T21:59:00", 1.1),
            candle("2024-01-07T22:00:00", 1.2),
        ],
    )

    fetch_range = populator.next_internal_gap_range(spec, csv_path)

    assert fetch_range is None


def test_data_populator_records_empty_internal_gap_ranges(tmp_path):
    class EmptyInternalGapPopulator(ScheduledDataPopulator):
        def fetch_candle_pages(
            self,
            spec: MarketSpec,
            start_at: datetime,
            end_at: datetime,
        ):
            return iter(())

    spec = crypto_spec("BTCUSDT")
    populator = EmptyInternalGapPopulator(
        tmp_path,
        forex_symbols=(),
        crypto_symbols=("BTCUSDT",),
        crypto_start_date="2024-01-01",
        derived_timeframes=(),
    )
    csv_path = tmp_path / "BTC_USDT" / "BTCUSDT_M1.csv"
    populator.write_candles(
        spec,
        [
            candle("2024-01-01T00:00:00", 100.0),
            candle("2024-01-01T00:03:00", 103.0),
        ],
    )

    summary = populator.populate_once(now=datetime(2024, 1, 1, 0, 4, tzinfo=timezone.utc))
    manifest = json.loads((tmp_path / MANIFEST_FILENAME).read_text(encoding="utf-8"))
    timeframe = manifest["markets"]["BTC_USDT"]["timeframes"]["M1"]

    assert summary.results[0].fetched == 0
    assert timeframe["empty_ranges"][0]["start_timestamp"] == "2024-01-01T00:01:00Z"
    assert timeframe["empty_ranges"][0]["end_timestamp"] == "2024-01-01T00:02:00Z"
    assert timeframe["empty_ranges"][0]["reason"] == "internal-gap"
    assert "no_data_before" not in timeframe
    assert populator.next_internal_gap_range(spec, csv_path) is None


def test_populate_once_buffers_provider_pages_until_batch_or_end(tmp_path):
    class TwoPagePopulator(ScheduledDataPopulator):
        def fetch_candle_pages(
            self,
            spec: MarketSpec,
            start_at: datetime,
            end_at: datetime,
        ):
            yield [candle("2024-01-01T00:00:00", 100.0)]
            assert not self.csv_path_for_spec(spec).exists()
            assert not (self.root / MANIFEST_FILENAME).exists()
            yield [candle("2024-01-01T00:01:00", 101.0)]

    populator = TwoPagePopulator(
        tmp_path,
        forex_symbols=(),
        crypto_symbols=("BTCUSDT",),
        backfill_mode="lookback",
        derived_timeframes=(),
    )

    summary = populator.populate_once(now=datetime(2024, 1, 1, 0, 3, tzinfo=timezone.utc))
    m1 = pd.read_csv(tmp_path / "BTC_USDT" / "BTCUSDT_M1.csv")

    assert summary.results[0].fetched == 2
    assert m1["Timestamp"].tolist() == [
        "2024-01-01 00:00:00",
        "2024-01-01 00:01:00",
    ]


def test_populate_once_batches_provider_pages_by_threshold(tmp_path):
    write_calls: list[list[datetime]] = []

    class ThreePagePopulator(ScheduledDataPopulator):
        def fetch_candle_pages(
            self,
            spec: MarketSpec,
            start_at: datetime,
            end_at: datetime,
        ):
            yield [candle("2024-01-01T00:00:00", 100.0)]
            yield [candle("2024-01-01T00:01:00", 101.0)]
            yield [candle("2024-01-01T00:02:00", 102.0)]

        def write_candles(
            self,
            spec: MarketSpec,
            candles: list[MarketCandle],
            csv_path=None,
            *,
            write_derived=True,
        ):
            write_calls.append([item.timestamp for item in candles])
            return super().write_candles(spec, candles, csv_path, write_derived=write_derived)

    populator = ThreePagePopulator(
        tmp_path,
        forex_symbols=(),
        crypto_symbols=("BTCUSDT",),
        backfill_mode="lookback",
        derived_timeframes=(),
        write_batch_candles=2,
    )

    summary = populator.populate_once(now=datetime(2024, 1, 1, 0, 4, tzinfo=timezone.utc))

    assert summary.results[0].fetched == 3
    assert write_calls == [
        [
            datetime(2024, 1, 1, 0, 0, tzinfo=timezone.utc),
            datetime(2024, 1, 1, 0, 1, tzinfo=timezone.utc),
        ],
        [datetime(2024, 1, 1, 0, 2, tzinfo=timezone.utc)],
    ]


def test_populate_once_records_unfinished_retry_range_after_timeout(tmp_path):
    class TimeoutAfterPagePopulator(ScheduledDataPopulator):
        def fetch_candle_pages(
            self,
            spec: MarketSpec,
            start_at: datetime,
            end_at: datetime,
        ):
            yield [
                candle("2024-01-01T00:04:00", 104.0),
                candle("2024-01-01T00:05:00", 105.0),
            ]
            raise TimeoutError("The read operation timed out")

    spec = forex_spec("USD/JPY")
    populator = TimeoutAfterPagePopulator(
        tmp_path,
        forex_symbols=("USD/JPY",),
        crypto_symbols=(),
        forex_start_date="2024-01-01",
        derived_timeframes=(),
    )

    summary = populator.populate_once(now=datetime(2024, 1, 1, 0, 6, tzinfo=timezone.utc))
    retry_range = populator.next_fetch_range(
        spec,
        tmp_path / "USD_JPY" / "USDJPY_M1.csv",
        datetime(2024, 1, 1, 0, 5, tzinfo=timezone.utc),
    )
    manifest = json.loads((tmp_path / MANIFEST_FILENAME).read_text(encoding="utf-8"))
    timeframe = manifest["markets"]["USD_JPY"]["timeframes"]["M1"]

    assert summary.results[0].fetched == 2
    assert summary.results[0].rows == 2
    assert "timed out" in (summary.results[0].error or "")
    assert timeframe["retry_ranges"][0]["start_timestamp"] == "2024-01-01T00:00:00Z"
    assert timeframe["retry_ranges"][0]["end_timestamp"] == "2024-01-01T00:03:00Z"
    assert timeframe["retry_ranges"][0]["reason"] == "initial-backfill"
    assert retry_range is not None
    assert retry_range.retry is True
    assert retry_range.reason == "initial-backfill"
    assert retry_range.start_at == datetime(2024, 1, 1, 0, 0, tzinfo=timezone.utc)
    assert retry_range.end_at == datetime(2024, 1, 1, 0, 3, tzinfo=timezone.utc)


def test_populate_once_prioritizes_and_clears_timeout_retry_ranges(tmp_path):
    class TimeoutAfterPagePopulator(ScheduledDataPopulator):
        def fetch_candle_pages(
            self,
            spec: MarketSpec,
            start_at: datetime,
            end_at: datetime,
        ):
            yield [
                candle("2024-01-01T00:04:00", 104.0),
                candle("2024-01-01T00:05:00", 105.0),
            ]
            raise TimeoutError("The read operation timed out")

    calls: list[tuple[datetime, datetime]] = []

    class RetryFillPopulator(ScheduledDataPopulator):
        def fetch_candle_pages(
            self,
            spec: MarketSpec,
            start_at: datetime,
            end_at: datetime,
        ):
            calls.append((start_at, end_at))
            yield [
                candle("2024-01-01T00:00:00", 100.0),
                candle("2024-01-01T00:01:00", 101.0),
                candle("2024-01-01T00:02:00", 102.0),
                candle("2024-01-01T00:03:00", 103.0),
            ]

    spec = forex_spec("USD/JPY")
    failing = TimeoutAfterPagePopulator(
        tmp_path,
        forex_symbols=("USD/JPY",),
        crypto_symbols=(),
        forex_start_date="2024-01-01",
        derived_timeframes=(),
    )
    failing.populate_once(now=datetime(2024, 1, 1, 0, 6, tzinfo=timezone.utc))

    retrying = RetryFillPopulator(
        tmp_path,
        forex_symbols=("USD/JPY",),
        crypto_symbols=(),
        forex_start_date="2024-01-01",
        derived_timeframes=(),
    )
    summary = retrying.populate_once(now=datetime(2024, 1, 1, 0, 6, tzinfo=timezone.utc))
    m1 = pd.read_csv(tmp_path / "USD_JPY" / "USDJPY_M1.csv")
    manifest = json.loads((tmp_path / MANIFEST_FILENAME).read_text(encoding="utf-8"))
    timeframe = manifest["markets"]["USD_JPY"]["timeframes"]["M1"]

    assert calls == [
        (
            datetime(2024, 1, 1, 0, 0, tzinfo=timezone.utc),
            datetime(2024, 1, 1, 0, 3, tzinfo=timezone.utc),
        )
    ]
    assert summary.results[0].fetched == 4
    assert "retry_ranges" not in timeframe
    assert retrying.next_fetch_range(
        spec,
        tmp_path / "USD_JPY" / "USDJPY_M1.csv",
        datetime(2024, 1, 1, 0, 5, tzinfo=timezone.utc),
    ) is None
    assert m1["Timestamp"].tolist() == [
        "2024-01-01 00:00:00",
        "2024-01-01 00:01:00",
        "2024-01-01 00:02:00",
        "2024-01-01 00:03:00",
        "2024-01-01 00:04:00",
        "2024-01-01 00:05:00",
    ]


def test_populate_once_runs_dukascopy_and_binance_groups_in_parallel(tmp_path):
    started = {
        "binance": threading.Event(),
        "dukascopy": threading.Event(),
    }

    class ParallelProviderPopulator(ScheduledDataPopulator):
        def fetch_candle_pages(
            self,
            spec: MarketSpec,
            start_at: datetime,
            end_at: datetime,
        ):
            started[spec.provider].set()
            other_provider = "binance" if spec.provider == "dukascopy" else "dukascopy"
            assert started[other_provider].wait(timeout=1)
            yield [candle("2024-01-01T00:00:00", 100.0)]

    populator = ParallelProviderPopulator(
        tmp_path,
        forex_symbols=("EUR/USD",),
        crypto_symbols=("BTCUSDT",),
        backfill_mode="lookback",
        derived_timeframes=(),
    )

    summary = populator.populate_once(now=datetime(2024, 1, 1, 0, 3, tzinfo=timezone.utc))

    assert sorted(result.asset_id for result in summary.results) == ["BTC_USDT", "EUR_USD"]
    assert (tmp_path / "EUR_USD" / "EURUSD_M1.csv").is_file()
    assert (tmp_path / "BTC_USDT" / "BTCUSDT_M1.csv").is_file()


def test_normalize_frame_parses_mixed_timestamps_without_inference_warning():
    frame = pd.DataFrame(
        [
            {
                "Timestamp": "2024-01-01 00:00:00",
                "Open": 1,
                "High": 1,
                "Low": 1,
                "Close": 1,
                "Volume": 1,
            },
            {
                "Timestamp": "2024-01-01T00:01:00Z",
                "Open": 2,
                "High": 2,
                "Low": 2,
                "Close": 2,
                "Volume": 2,
            },
        ]
    )

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        normalized = normalize_frame(frame)

    assert len(normalized) == 2
    assert not [
        item
        for item in caught
        if issubclass(item.category, UserWarning)
        and "Could not infer format" in str(item.message)
    ]


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


def test_binance_fetch_prefers_monthly_archives_for_bulk_history(tmp_path):
    requested_urls: list[str] = []

    def fetch_bytes(url: str, timeout: int) -> bytes:
        requested_urls.append(url)
        return binance_zip(
            "open_time,open,high,low,close,volume,close_time,quote_volume,count,taker_buy_volume,taker_buy_quote_volume,ignore",
            "1704067200000000,1,2,0.5,1.5,99,1704067259999,0,0,0,0,0",
            "1706745540000000,2,3,1.5,2.5,88,1706745599999,0,0,0,0,0",
        )

    def fetch_json(url: str, timeout: int) -> object:
        raise AssertionError("REST should not be used when the complete monthly archive is available")

    populator = ScheduledDataPopulator(
        tmp_path,
        forex_symbols=(),
        crypto_symbols=("BTCUSDT",),
        fetch_bytes=fetch_bytes,
        fetch_json=fetch_json,
    )

    pages = list(
        populator.fetch_binance_candle_pages(
            "BTCUSDT",
            datetime(2024, 1, 1, tzinfo=timezone.utc),
            datetime(2024, 1, 31, 23, 59, tzinfo=timezone.utc),
        )
    )

    assert requested_urls == [
        "https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/1m/BTCUSDT-1m-2024-01.zip"
    ]
    assert len(pages) == 1
    assert [item.timestamp for item in pages[0]] == [
        datetime(2024, 1, 1, tzinfo=timezone.utc),
        datetime(2024, 1, 31, 23, 59, tzinfo=timezone.utc),
    ]


def test_binance_fetch_downloads_monthly_archives_in_parallel(tmp_path):
    requested_urls: list[str] = []
    started_lock = threading.Lock()
    both_started = threading.Event()

    def fetch_bytes(url: str, timeout: int) -> bytes:
        with started_lock:
            requested_urls.append(url)
            if len(requested_urls) == 2:
                both_started.set()
        assert both_started.wait(timeout=1)
        if "2024-01" in url:
            return binance_zip(
                "open_time,open,high,low,close,volume,close_time,quote_volume,count,taker_buy_volume,taker_buy_quote_volume,ignore",
                "1704067200000000,1,2,0.5,1.5,99,1704067259999,0,0,0,0,0",
            )
        return binance_zip(
            "open_time,open,high,low,close,volume,close_time,quote_volume,count,taker_buy_volume,taker_buy_quote_volume,ignore",
            "1706745600000000,2,3,1.5,2.5,88,1706745659999,0,0,0,0,0",
            "1709251140000000,3,4,2.5,3.5,77,1709251199999,0,0,0,0,0",
        )

    def fetch_json(url: str, timeout: int) -> object:
        raise AssertionError("REST should not be used when monthly archives are available")

    populator = ScheduledDataPopulator(
        tmp_path,
        forex_symbols=(),
        crypto_symbols=("BTCUSDT",),
        fetch_bytes=fetch_bytes,
        fetch_json=fetch_json,
    )

    pages = list(
        populator.fetch_binance_candle_pages(
            "BTCUSDT",
            datetime(2024, 1, 1, tzinfo=timezone.utc),
            datetime(2024, 2, 29, 23, 59, tzinfo=timezone.utc),
        )
    )

    assert len(requested_urls) == 2
    assert len(pages) == 2
    assert [page[0].timestamp for page in pages] == [
        datetime(2024, 1, 1, tzinfo=timezone.utc),
        datetime(2024, 2, 1, tzinfo=timezone.utc),
    ]


def test_fetch_json_url_retries_invalid_json_response(monkeypatch):
    responses = [b"<html>rate limited</html>", b'{"ok": true}']
    sleep_calls: list[float] = []

    class FakeResponse:
        def __init__(self, body: bytes):
            self.body = body

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return None

        def read(self) -> bytes:
            return self.body

    def fake_urlopen(request, timeout):
        return FakeResponse(responses.pop(0))

    monkeypatch.setattr(data_populator_module, "urlopen", fake_urlopen)
    monkeypatch.setattr(data_populator_module.time, "sleep", sleep_calls.append)

    assert fetch_json_url("https://example.test/data", 1) == {"ok": True}
    assert sleep_calls == [0.75]
    assert responses == []


def test_dukascopy_fetch_uses_timestamp_jsonp_chart_query(tmp_path):
    requested_urls: list[str] = []

    def fetch_json(url: str, timeout: int) -> object:
        requested_urls.append(url)
        return [
            [1704067200000, 1, 2, 0.5, 1.5, 99],
            [1704067260000, 1.5, 2.5, 1, 2, 100],
        ]

    populator = ScheduledDataPopulator(
        tmp_path,
        forex_symbols=("EUR/USD",),
        crypto_symbols=(),
        fetch_json=fetch_json,
    )

    pages = list(
        populator.fetch_dukascopy_candle_pages(
            "EUR/USD",
            datetime(2024, 1, 1, tzinfo=timezone.utc),
            datetime(2024, 1, 1, 0, 1, tzinfo=timezone.utc),
        )
    )

    query = parse_qs(urlparse(requested_urls[0]).query)
    assert query["path"] == ["chart/json3"]
    assert query["init"] == ["true"]
    assert query["time_direction"] == ["N"]
    assert query["instrument"] == ["EUR/USD"]
    assert "timestamp" in query
    assert "last_update" not in query
    assert len(pages) == 1
    assert pages[0][-1].close == 2.0


def test_dukascopy_fetch_throttles_between_paged_requests(tmp_path, monkeypatch):
    requested_urls: list[str] = []
    sleep_calls: list[float] = []

    def fetch_json(url: str, timeout: int) -> object:
        requested_urls.append(url)
        if len(requested_urls) == 1:
            return [
                [1704067320000, 1, 2, 0.5, 1.5, 99],
                [1704067380000, 1.5, 2.5, 1, 2, 100],
            ]
        return [
            [1704067200000, 0.8, 1.8, 0.3, 1.1, 90],
            [1704067260000, 0.9, 1.9, 0.4, 1.2, 91],
        ]

    monkeypatch.setattr(data_populator_module.time, "sleep", sleep_calls.append)

    populator = ScheduledDataPopulator(
        tmp_path,
        forex_symbols=("EUR/USD",),
        crypto_symbols=(),
        fetch_json=fetch_json,
    )

    pages = list(
        populator.fetch_dukascopy_candle_pages(
            "EUR/USD",
            datetime(2024, 1, 1, tzinfo=timezone.utc),
            datetime(2024, 1, 1, 0, 3, tzinfo=timezone.utc),
        )
    )

    assert len(requested_urls) == 2
    assert len(pages) == 2
    assert sleep_calls == [0.05]
