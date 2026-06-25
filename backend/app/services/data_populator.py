import csv
import io
import json
import logging
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import RLock
from typing import Callable, Iterator, Literal
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings
from app.models import BacktestSession, BetaUser, DatasetAsset, DatasetSettings, DatasetTimeframe, utcnow
from app.services.market_data_imports import import_market_data_to_db

DATA_COLUMNS = ["Timestamp", "Open", "High", "Low", "Close", "Volume"]
MINUTE = timedelta(minutes=1)
MANIFEST_FILENAME = ".edgelab-data-populator-manifest.json"
MANIFEST_VERSION = 1
DEFAULT_DERIVED_TIMEFRAMES = ("M5", "M15", "M30", "H1", "H4", "Daily")
MAX_BACKFILL_START_DATES = {
    "binance": "2017-08-17",
    "dukascopy": "2003-01-01",
}
RESAMPLE_RULES = {
    "M5": "5min",
    "M15": "15min",
    "M30": "30min",
    "H1": "1h",
    "H4": "4h",
    "Daily": "1D",
}
BINANCE_REST_URLS = (
    "https://data-api.binance.vision/api/v3",
    "https://api.binance.com/api/v3",
)
BINANCE_ARCHIVE_BASE_URL = "https://data.binance.vision/data/spot"
DUKASCOPY_URL = "https://freeserv.dukascopy.com/2.0/index.php"
DUKASCOPY_HEADERS = {
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; EdgeLab/0.1; +https://github.com/SaiDheerajPeketi/EdgeLab)",
    "Referer": "https://freeserv.dukascopy.com/2.0/?path=chart/index&instrument=EUR/USD",
}
NETWORK_RETRY_COUNT = 5
NETWORK_RETRY_BASE_SECONDS = 0.75
WRITE_BATCH_CANDLES = 25_000
BACKFILL_WRITE_BATCH_CANDLES = 10_000_000
BINANCE_ARCHIVE_WORKERS = 8
DUKASCOPY_REQUEST_DELAY_SECONDS = 0.05

FetchJson = Callable[[str, int], object]
FetchBytes = Callable[[str, int], bytes]
Provider = Literal["binance", "dukascopy"]

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class MarketSpec:
    provider: Provider
    instrument: str
    asset_id: str
    symbol: str
    filename_symbol: str


@dataclass(frozen=True, slots=True)
class MarketCandle:
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass(frozen=True)
class PopulationResult:
    asset_id: str
    symbol: str
    csv_path: str
    fetched: int
    rows: int
    first_timestamp: datetime | None = None
    last_timestamp: datetime | None = None
    error: str | None = None


@dataclass(frozen=True)
class FetchRange:
    start_at: datetime
    end_at: datetime
    reason: str
    retry: bool = False


@dataclass(frozen=True)
class PopulationSummary:
    started_at: datetime
    finished_at: datetime
    results: list[PopulationResult]

    @property
    def fetched(self) -> int:
        return sum(item.fetched for item in self.results)

    @property
    def errors(self) -> list[PopulationResult]:
        return [item for item in self.results if item.error]


class DataPopulatorManifest:
    def __init__(self, root: Path):
        self.root = root
        self.path = root / MANIFEST_FILENAME
        self._payload: dict[str, object] | None = None
        self._lock = RLock()

    @property
    def payload(self) -> dict[str, object]:
        with self._lock:
            if self._payload is None:
                self._payload = self._load()
            return self._payload

    def last_timestamp(self, spec: MarketSpec, timeframe: str = "M1") -> datetime | None:
        timestamp_range = self.timestamp_range(spec, timeframe)
        return timestamp_range[1] if timestamp_range is not None else None

    def timestamp_range(
        self,
        spec: MarketSpec,
        timeframe: str = "M1",
    ) -> tuple[datetime, datetime] | None:
        with self._lock:
            entry = self.timeframe_entry(spec, timeframe)
            if entry is None:
                return None
            csv_path = self.path_from_entry(entry)
            if not csv_path.is_file():
                return None
            first_timestamp = entry.get("first_timestamp")
            last_timestamp = entry.get("last_timestamp")
            if not first_timestamp or not last_timestamp:
                return None
            try:
                first = parse_csv_timestamp(first_timestamp)
                last = parse_csv_timestamp(last_timestamp)
            except (TypeError, ValueError):
                return None
            if first > last:
                return None
            return first, last

    def timeframe_entry(self, spec: MarketSpec, timeframe: str) -> dict[str, object] | None:
        with self._lock:
            markets = self.payload.get("markets")
            if not isinstance(markets, dict):
                return None
            market = markets.get(spec.asset_id)
            if not isinstance(market, dict):
                return None
            timeframes = market.get("timeframes")
            if not isinstance(timeframes, dict):
                return None
            entry = timeframes.get(timeframe)
            return entry if isinstance(entry, dict) else None

    def no_data_before(self, spec: MarketSpec, timeframe: str = "M1") -> datetime | None:
        with self._lock:
            entry = self.timeframe_entry(spec, timeframe)
            if entry is None:
                return None
            timestamp = entry.get("no_data_before")
            if not timestamp:
                return None
            try:
                return parse_csv_timestamp(timestamp)
            except (TypeError, ValueError):
                return None

    def empty_ranges(self, spec: MarketSpec, timeframe: str = "M1") -> list[tuple[datetime, datetime]]:
        with self._lock:
            entry = self.timeframe_entry(spec, timeframe)
            if entry is None:
                return []
            raw_ranges = entry.get("empty_ranges")
            if not isinstance(raw_ranges, list):
                return []
            ranges: list[tuple[datetime, datetime]] = []
            for raw_range in raw_ranges:
                if not isinstance(raw_range, dict):
                    continue
                start_timestamp = raw_range.get("start_timestamp")
                end_timestamp = raw_range.get("end_timestamp")
                if not start_timestamp or not end_timestamp:
                    continue
                try:
                    start_at = parse_csv_timestamp(start_timestamp)
                    end_at = parse_csv_timestamp(end_timestamp)
                except (TypeError, ValueError):
                    continue
                if start_at <= end_at:
                    ranges.append((start_at, end_at))
            return sorted(ranges)

    def retry_ranges(self, spec: MarketSpec, timeframe: str = "M1") -> list[tuple[datetime, datetime, str]]:
        with self._lock:
            entry = self.timeframe_entry(spec, timeframe)
            if entry is None:
                return []
            raw_ranges = entry.get("retry_ranges")
            if not isinstance(raw_ranges, list):
                return []
            ranges: list[tuple[datetime, datetime, str]] = []
            for raw_range in raw_ranges:
                if not isinstance(raw_range, dict):
                    continue
                start_timestamp = raw_range.get("start_timestamp")
                end_timestamp = raw_range.get("end_timestamp")
                if not start_timestamp or not end_timestamp:
                    continue
                try:
                    start_at = parse_csv_timestamp(start_timestamp)
                    end_at = parse_csv_timestamp(end_timestamp)
                except (TypeError, ValueError):
                    continue
                if start_at <= end_at:
                    ranges.append((start_at, end_at, str(raw_range.get("reason") or "retry")))
            return sorted(ranges, key=lambda item: item[0])

    def path_from_entry(self, entry: dict[str, object]) -> Path:
        raw_path = str(entry.get("csv_path") or "")
        path = Path(raw_path)
        return path if path.is_absolute() else self.root / path

    def update_timeframe(
        self,
        spec: MarketSpec,
        timeframe: str,
        csv_path: Path,
        frame: pd.DataFrame,
    ) -> None:
        if frame.empty:
            return
        with self._lock:
            timeframes = self.timeframes_for_spec(spec)
            existing = timeframes.get(timeframe)
            no_data_before = existing.get("no_data_before") if isinstance(existing, dict) else None
            empty_ranges = existing.get("empty_ranges") if isinstance(existing, dict) else None
            retry_ranges = existing.get("retry_ranges") if isinstance(existing, dict) else None
            first_timestamp = parse_csv_timestamp(frame.iloc[0]["Timestamp"])
            timeframes[timeframe] = {
                "csv_path": self.relative_path(csv_path),
                "rows": int(len(frame)),
                "first_timestamp": utc_manifest_timestamp(first_timestamp),
                "last_timestamp": manifest_timestamp(frame.iloc[-1]["Timestamp"]),
                "file_size": csv_path.stat().st_size if csv_path.exists() else 0,
                "file_mtime_ns": csv_path.stat().st_mtime_ns if csv_path.exists() else 0,
                "updated_at": utc_manifest_timestamp(datetime.now(tz=timezone.utc)),
            }
            if no_data_before:
                try:
                    if first_timestamp > parse_csv_timestamp(no_data_before):
                        timeframes[timeframe]["no_data_before"] = no_data_before
                except (TypeError, ValueError):
                    pass
            if isinstance(empty_ranges, list) and empty_ranges:
                timeframes[timeframe]["empty_ranges"] = empty_ranges
            if isinstance(retry_ranges, list) and retry_ranges:
                timeframes[timeframe]["retry_ranges"] = retry_ranges
            self.payload["updated_at"] = utc_manifest_timestamp(datetime.now(tz=timezone.utc))

    def update_no_data_range(
        self,
        spec: MarketSpec,
        timeframe: str,
        start_at: datetime,
        end_at: datetime,
        reason: str,
    ) -> None:
        with self._lock:
            timeframes = self.timeframes_for_spec(spec)
            entry = timeframes.setdefault(timeframe, {})
            if not isinstance(entry, dict):
                entry = {}
                timeframes[timeframe] = entry
            existing = entry.get("no_data_before")
            no_data_before = end_at
            if existing:
                try:
                    no_data_before = max(parse_csv_timestamp(existing), end_at)
                except (TypeError, ValueError):
                    pass
            entry["no_data_before"] = utc_manifest_timestamp(no_data_before)
            entry["last_no_data_range"] = {
                "start_timestamp": utc_manifest_timestamp(start_at),
                "end_timestamp": utc_manifest_timestamp(end_at),
                "reason": reason,
                "updated_at": utc_manifest_timestamp(datetime.now(tz=timezone.utc)),
            }
            self.payload["updated_at"] = utc_manifest_timestamp(datetime.now(tz=timezone.utc))

    def update_empty_range(
        self,
        spec: MarketSpec,
        timeframe: str,
        start_at: datetime,
        end_at: datetime,
        reason: str,
    ) -> None:
        with self._lock:
            timeframes = self.timeframes_for_spec(spec)
            entry = timeframes.setdefault(timeframe, {})
            if not isinstance(entry, dict):
                entry = {}
                timeframes[timeframe] = entry
            raw_ranges = entry.setdefault("empty_ranges", [])
            if not isinstance(raw_ranges, list):
                raw_ranges = []
                entry["empty_ranges"] = raw_ranges

            ranges: list[tuple[datetime, datetime, str]] = []
            for raw_range in raw_ranges:
                if not isinstance(raw_range, dict):
                    continue
                raw_start = raw_range.get("start_timestamp")
                raw_end = raw_range.get("end_timestamp")
                if not raw_start or not raw_end:
                    continue
                try:
                    existing_start = parse_csv_timestamp(raw_start)
                    existing_end = parse_csv_timestamp(raw_end)
                except (TypeError, ValueError):
                    continue
                if existing_start <= existing_end:
                    ranges.append((existing_start, existing_end, str(raw_range.get("reason") or reason)))
            ranges.append((start_at, end_at, reason))
            ranges.sort(key=lambda item: item[0])

            merged: list[tuple[datetime, datetime, str]] = []
            for range_start, range_end, range_reason in ranges:
                if not merged:
                    merged.append((range_start, range_end, range_reason))
                    continue
                previous_start, previous_end, previous_reason = merged[-1]
                if range_start <= previous_end + MINUTE:
                    merged[-1] = (
                        previous_start,
                        max(previous_end, range_end),
                        previous_reason if previous_reason == range_reason else "provider-no-data",
                    )
                    continue
                merged.append((range_start, range_end, range_reason))

            updated_at = utc_manifest_timestamp(datetime.now(tz=timezone.utc))
            entry["empty_ranges"] = [
                {
                    "start_timestamp": utc_manifest_timestamp(range_start),
                    "end_timestamp": utc_manifest_timestamp(range_end),
                    "reason": range_reason,
                    "updated_at": updated_at,
                }
                for range_start, range_end, range_reason in merged
            ]
            entry["last_empty_range"] = {
                "start_timestamp": utc_manifest_timestamp(start_at),
                "end_timestamp": utc_manifest_timestamp(end_at),
                "reason": reason,
                "updated_at": updated_at,
            }
            self.payload["updated_at"] = updated_at

    def update_retry_range(
        self,
        spec: MarketSpec,
        timeframe: str,
        start_at: datetime,
        end_at: datetime,
        reason: str,
        error: str,
    ) -> None:
        if start_at > end_at:
            return
        with self._lock:
            timeframes = self.timeframes_for_spec(spec)
            entry = timeframes.setdefault(timeframe, {})
            if not isinstance(entry, dict):
                entry = {}
                timeframes[timeframe] = entry
            raw_ranges = entry.setdefault("retry_ranges", [])
            if not isinstance(raw_ranges, list):
                raw_ranges = []
                entry["retry_ranges"] = raw_ranges

            ranges: list[tuple[datetime, datetime, str]] = []
            for raw_range in raw_ranges:
                if not isinstance(raw_range, dict):
                    continue
                raw_start = raw_range.get("start_timestamp")
                raw_end = raw_range.get("end_timestamp")
                if not raw_start or not raw_end:
                    continue
                try:
                    existing_start = parse_csv_timestamp(raw_start)
                    existing_end = parse_csv_timestamp(raw_end)
                except (TypeError, ValueError):
                    continue
                if existing_start <= existing_end:
                    ranges.append((existing_start, existing_end, str(raw_range.get("reason") or reason)))
            ranges.append((start_at, end_at, reason))
            ranges.sort(key=lambda item: item[0])

            merged: list[tuple[datetime, datetime, str]] = []
            for range_start, range_end, range_reason in ranges:
                if not merged:
                    merged.append((range_start, range_end, range_reason))
                    continue
                previous_start, previous_end, previous_reason = merged[-1]
                if range_start <= previous_end + MINUTE:
                    merged[-1] = (
                        previous_start,
                        max(previous_end, range_end),
                        previous_reason if previous_reason == range_reason else "retry",
                    )
                    continue
                merged.append((range_start, range_end, range_reason))

            updated_at = utc_manifest_timestamp(datetime.now(tz=timezone.utc))
            entry["retry_ranges"] = [
                {
                    "start_timestamp": utc_manifest_timestamp(range_start),
                    "end_timestamp": utc_manifest_timestamp(range_end),
                    "reason": range_reason,
                    "updated_at": updated_at,
                }
                for range_start, range_end, range_reason in merged
            ]
            entry["last_retry_range"] = {
                "start_timestamp": utc_manifest_timestamp(start_at),
                "end_timestamp": utc_manifest_timestamp(end_at),
                "reason": reason,
                "error": error,
                "updated_at": updated_at,
            }
            self.payload["updated_at"] = updated_at

    def clear_retry_range(
        self,
        spec: MarketSpec,
        timeframe: str,
        start_at: datetime,
        end_at: datetime,
    ) -> None:
        with self._lock:
            entry = self.timeframe_entry(spec, timeframe)
            if entry is None:
                return
            raw_ranges = entry.get("retry_ranges")
            if not isinstance(raw_ranges, list):
                return

            remaining: list[dict[str, object]] = []
            for raw_range in raw_ranges:
                if not isinstance(raw_range, dict):
                    continue
                raw_start = raw_range.get("start_timestamp")
                raw_end = raw_range.get("end_timestamp")
                if not raw_start or not raw_end:
                    continue
                try:
                    range_start = parse_csv_timestamp(raw_start)
                    range_end = parse_csv_timestamp(raw_end)
                except (TypeError, ValueError):
                    continue
                reason = str(raw_range.get("reason") or "retry")
                if range_end < start_at or range_start > end_at:
                    remaining.append(raw_range)
                    continue
                if range_start < start_at:
                    remaining.append(
                        {
                            "start_timestamp": utc_manifest_timestamp(range_start),
                            "end_timestamp": utc_manifest_timestamp(start_at - MINUTE),
                            "reason": reason,
                            "updated_at": raw_range.get("updated_at")
                            or utc_manifest_timestamp(datetime.now(tz=timezone.utc)),
                        }
                    )
                if range_end > end_at:
                    remaining.append(
                        {
                            "start_timestamp": utc_manifest_timestamp(end_at + MINUTE),
                            "end_timestamp": utc_manifest_timestamp(range_end),
                            "reason": reason,
                            "updated_at": raw_range.get("updated_at")
                            or utc_manifest_timestamp(datetime.now(tz=timezone.utc)),
                        }
                    )

            if remaining:
                entry["retry_ranges"] = remaining
            else:
                entry.pop("retry_ranges", None)
            self.payload["updated_at"] = utc_manifest_timestamp(datetime.now(tz=timezone.utc))

    def timeframes_for_spec(self, spec: MarketSpec) -> dict[str, object]:
        with self._lock:
            payload = self.payload
            markets = payload.setdefault("markets", {})
            if not isinstance(markets, dict):
                markets = {}
                payload["markets"] = markets
            market = markets.setdefault(
                spec.asset_id,
                {
                    "provider": spec.provider,
                    "instrument": spec.instrument,
                    "symbol": spec.symbol,
                    "timeframes": {},
                },
            )
            if not isinstance(market, dict):
                market = {
                    "provider": spec.provider,
                    "instrument": spec.instrument,
                    "symbol": spec.symbol,
                    "timeframes": {},
                }
                markets[spec.asset_id] = market
            market["provider"] = spec.provider
            market["instrument"] = spec.instrument
            market["symbol"] = spec.symbol
            timeframes = market.setdefault("timeframes", {})
            if not isinstance(timeframes, dict):
                timeframes = {}
                market["timeframes"] = timeframes
            return timeframes

    def save(self) -> None:
        with self._lock:
            self.root.mkdir(parents=True, exist_ok=True)
            temp_path = self.path.with_name(f".{self.path.name}.tmp")
            with temp_path.open("w", encoding="utf-8") as handle:
                json.dump(self.payload, handle, indent=2, sort_keys=True)
                handle.write("\n")
            temp_path.replace(self.path)

    def relative_path(self, csv_path: Path) -> str:
        try:
            return str(csv_path.relative_to(self.root))
        except ValueError:
            return str(csv_path)

    def _load(self) -> dict[str, object]:
        if not self.path.exists():
            return {
                "version": MANIFEST_VERSION,
                "generated_by": "edgelab-data-populator",
                "markets": {},
            }
        try:
            with self.path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except (OSError, json.JSONDecodeError):
            logger.warning("Ignoring unreadable data populator manifest: %s", self.path)
            return {
                "version": MANIFEST_VERSION,
                "generated_by": "edgelab-data-populator",
                "markets": {},
            }
        return payload if isinstance(payload, dict) else {
            "version": MANIFEST_VERSION,
            "generated_by": "edgelab-data-populator",
            "markets": {},
        }


class ScheduledDataPopulator:
    def __init__(
        self,
        root: Path,
        *,
        forex_symbols: tuple[str, ...],
        crypto_symbols: tuple[str, ...],
        backfill_mode: str = "max",
        lookback_days: int = 30,
        derived_timeframes: tuple[str, ...] = DEFAULT_DERIVED_TIMEFRAMES,
        forex_start_date: str = MAX_BACKFILL_START_DATES["dukascopy"],
        crypto_start_date: str = MAX_BACKFILL_START_DATES["binance"],
        request_timeout_seconds: int = 20,
        write_batch_candles: int = WRITE_BATCH_CANDLES,
        backfill_write_batch_candles: int = BACKFILL_WRITE_BATCH_CANDLES,
        binance_archive_workers: int = BINANCE_ARCHIVE_WORKERS,
        dukascopy_request_delay_seconds: float = DUKASCOPY_REQUEST_DELAY_SECONDS,
        fetch_json: FetchJson | None = None,
        fetch_bytes: FetchBytes | None = None,
        catalog_session_factory: sessionmaker | None = None,
        market_data_session_factory: sessionmaker | None = None,
        catalog_import_enabled: bool = True,
    ):
        self.root = root
        self.forex_symbols = forex_symbols
        self.crypto_symbols = crypto_symbols
        self.backfill_mode = normalize_backfill_mode(backfill_mode)
        self.lookback_days = max(1, lookback_days)
        self.derived_timeframes = normalize_derived_timeframes(derived_timeframes)
        self.provider_start_dates = {
            "binance": parse_utc_date(crypto_start_date),
            "dukascopy": parse_utc_date(forex_start_date),
        }
        self.request_timeout_seconds = max(1, request_timeout_seconds)
        self.write_batch_candles = max(1, write_batch_candles)
        self.backfill_write_batch_candles = max(1, backfill_write_batch_candles)
        self.binance_archive_workers = max(1, binance_archive_workers)
        self.dukascopy_request_delay_seconds = max(0.0, dukascopy_request_delay_seconds)
        self.fetch_json = fetch_json or fetch_json_url
        self.fetch_bytes = fetch_bytes or fetch_bytes_url
        self.manifest = DataPopulatorManifest(root)
        self.catalog_session_factory = catalog_session_factory
        self.market_data_session_factory = market_data_session_factory
        self.catalog_import_enabled = bool(catalog_import_enabled)

    def specs(self) -> list[MarketSpec]:
        return [
            *[forex_spec(symbol) for symbol in self.forex_symbols],
            *[crypto_spec(symbol) for symbol in self.crypto_symbols],
        ]

    def populate_once(self, now: datetime | None = None) -> PopulationSummary:
        started_at = datetime.now(tz=timezone.utc)
        end_at = floor_minute(now or started_at) - MINUTE
        self.root.mkdir(parents=True, exist_ok=True)
        specs = self.specs()
        logger.info(
            "Data population run started: root=%s instruments=%s end_at=%s",
            self.root,
            len(specs),
            utc_manifest_timestamp(end_at),
        )

        groups = [
            (provider, [spec for spec in specs if spec.provider == provider])
            for provider in ("dukascopy", "binance")
        ]
        groups = [(provider, provider_specs) for provider, provider_specs in groups if provider_specs]
        if len(groups) <= 1:
            results = [
                result
                for provider, provider_specs in groups
                for result in self.populate_provider_specs(provider, provider_specs, end_at)
            ]
        else:
            logger.info(
                "Running provider groups in parallel: %s",
                ", ".join(f"{provider}={len(provider_specs)}" for provider, provider_specs in groups),
            )
            results = []
            with ThreadPoolExecutor(max_workers=len(groups), thread_name_prefix="edgelab-populator") as executor:
                futures = {
                    provider: executor.submit(
                        self.populate_provider_specs,
                        provider,
                        provider_specs,
                        end_at,
                    )
                    for provider, provider_specs in groups
                }
                for provider, _provider_specs in groups:
                    results.extend(futures[provider].result())

        return PopulationSummary(
            started_at=started_at,
            finished_at=datetime.now(tz=timezone.utc),
            results=results,
        )

    def populate_provider_specs(
        self,
        provider: Provider,
        specs: list[MarketSpec],
        end_at: datetime,
    ) -> list[PopulationResult]:
        results: list[PopulationResult] = []
        logger.info("Provider group started: provider=%s instruments=%s", provider, len(specs))
        for spec in specs:
            csv_path = self.csv_path_for_spec(spec)
            try:
                total_fetched = 0
                current_range_fetched = 0
                attempted_ranges: set[tuple[str, datetime, datetime, bool]] = set()
                while True:
                    fetch_range = self.next_fetch_range(spec, csv_path, end_at)
                    if fetch_range is None:
                        results.append(self.result_for_existing_file(spec, csv_path, total_fetched))
                        if total_fetched == 0:
                            logger.info(
                                "%s is already current through %s",
                                spec.instrument,
                                utc_manifest_timestamp(end_at),
                            )
                        break

                    range_key = (
                        fetch_range.reason,
                        fetch_range.start_at,
                        fetch_range.end_at,
                        fetch_range.retry,
                    )
                    if range_key in attempted_ranges:
                        logger.warning(
                            "Stopping repeated %s range for %s: %s..%s",
                            fetch_range.reason,
                            spec.instrument,
                            utc_manifest_timestamp(fetch_range.start_at),
                            utc_manifest_timestamp(fetch_range.end_at),
                        )
                        results.append(self.result_for_existing_file(spec, csv_path, total_fetched))
                        break
                    attempted_ranges.add(range_key)

                    logger.info(
                        "Fetching %s %s candles from %s to %s (%s)",
                        spec.provider,
                        spec.instrument,
                        utc_manifest_timestamp(fetch_range.start_at),
                        utc_manifest_timestamp(fetch_range.end_at),
                        fetch_range.reason,
                    )
                    fetched = 0
                    page_count = 0
                    last_page: list[MarketCandle] | None = None
                    pending_candles: list[MarketCandle] = []
                    current_range_fetched = 0
                    write_batch_limit = self.write_batch_limit_for_range(fetch_range)
                    defer_derived_timeframes = self.should_defer_derived_timeframes(fetch_range)
                    try:
                        for page_count, candles in enumerate(
                            self.fetch_candle_pages(spec, fetch_range.start_at, fetch_range.end_at),
                            start=1,
                        ):
                            if not candles:
                                continue
                            fetched += len(candles)
                            current_range_fetched = fetched
                            last_page = candles
                            pending_candles.extend(candles)
                            page_result: PopulationResult | None = None
                            if len(pending_candles) >= write_batch_limit:
                                page_result = self.write_candles(
                                    spec,
                                    pending_candles,
                                    csv_path,
                                    write_derived=not defer_derived_timeframes,
                                    sync_catalog=not defer_derived_timeframes,
                                )
                                pending_candles = []
                            if page_result is not None:
                                logger.info(
                                    "Wrote %s page %s: fetched=%s total_rows=%s page_range=%s..%s",
                                    spec.instrument,
                                    page_count,
                                    fetched,
                                    page_result.rows,
                                    utc_manifest_timestamp(candles[0].timestamp),
                                    utc_manifest_timestamp(candles[-1].timestamp),
                                )
                            elif page_count % 25 == 0:
                                logger.info(
                                    "Fetched %s page %s: fetched=%s pending=%s persisted_rows=%s page_range=%s..%s",
                                    spec.instrument,
                                    page_count,
                                    fetched,
                                    len(pending_candles),
                                    read_csv_row_count(csv_path),
                                    utc_manifest_timestamp(candles[0].timestamp),
                                    utc_manifest_timestamp(candles[-1].timestamp),
                                )
                        if pending_candles:
                            page_result = self.write_candles(spec, pending_candles, csv_path)
                            logger.info(
                                "Wrote %s final batch: pages=%s fetched=%s total_rows=%s",
                                spec.instrument,
                                page_count,
                                fetched,
                                page_result.rows,
                            )
                        elif fetched and defer_derived_timeframes:
                            page_result = self.write_candles(spec, [], csv_path)
                            logger.info(
                                "Refreshed %s derived timeframes after backfill batch: pages=%s fetched=%s total_rows=%s",
                                spec.instrument,
                                page_count,
                                fetched,
                                page_result.rows,
                            )
                    except Exception as exc:
                        if pending_candles:
                            self.write_candles(spec, pending_candles, csv_path)
                        elif current_range_fetched and defer_derived_timeframes:
                            self.write_candles(spec, [], csv_path)
                        total_fetched += current_range_fetched
                        retry_range = self.unresolved_fetch_range(spec, fetch_range, last_page)
                        if retry_range is not None:
                            retry_start, retry_end = retry_range
                            self.manifest.update_retry_range(
                                spec,
                                "M1",
                                retry_start,
                                retry_end,
                                fetch_range.reason,
                                f"{type(exc).__name__}: {exc}",
                            )
                            self.manifest.save()
                            logger.warning(
                                "Recorded retry range for %s after %s: %s..%s",
                                spec.instrument,
                                type(exc).__name__,
                                utc_manifest_timestamp(retry_start),
                                utc_manifest_timestamp(retry_end),
                            )
                        raise

                    if fetched == 0:
                        logger.info(
                            "No %s candles returned for %s..%s",
                            spec.instrument,
                            utc_manifest_timestamp(fetch_range.start_at),
                            utc_manifest_timestamp(fetch_range.end_at),
                        )
                        if fetch_range.reason != "append-latest":
                            self.manifest.update_empty_range(
                                spec,
                                "M1",
                                fetch_range.start_at,
                                fetch_range.end_at,
                                fetch_range.reason,
                            )
                            if fetch_range.reason in {"historical-backfill", "initial-backfill"}:
                                self.manifest.update_no_data_range(
                                    spec,
                                    "M1",
                                    fetch_range.start_at,
                                    fetch_range.end_at,
                                    fetch_range.reason,
                                )
                            if fetch_range.retry:
                                self.manifest.clear_retry_range(
                                    spec,
                                    "M1",
                                    fetch_range.start_at,
                                    fetch_range.end_at,
                                )
                            self.manifest.save()
                        elif fetch_range.retry:
                            self.manifest.clear_retry_range(
                                spec,
                                "M1",
                                fetch_range.start_at,
                                fetch_range.end_at,
                            )
                            self.manifest.save()
                        if fetch_range.reason in {"historical-backfill", "internal-gap"}:
                            continue
                        results.append(self.result_for_existing_file(spec, csv_path, total_fetched))
                        break
                    total_fetched += fetched
                    if fetch_range.retry:
                        self.manifest.clear_retry_range(
                            spec,
                            "M1",
                            fetch_range.start_at,
                            fetch_range.end_at,
                        )
                        self.manifest.save()
                    if fetch_range.reason in {"historical-backfill", "internal-gap"}:
                        continue
                    results.append(self.result_for_existing_file(spec, csv_path, total_fetched))
                    break
            except Exception as exc:
                logger.exception("Failed to populate %s", spec.instrument)
                results.append(self.result_for_error(spec, csv_path, total_fetched, exc))

        logger.info("Provider group finished: provider=%s instruments=%s", provider, len(specs))
        return results

    def write_batch_limit_for_range(self, fetch_range: FetchRange) -> int:
        if self.backfill_mode == "max" and fetch_range.reason in {
            "initial-backfill",
            "historical-backfill",
            "internal-gap",
        }:
            return self.backfill_write_batch_candles
        return self.write_batch_candles

    def should_defer_derived_timeframes(self, fetch_range: FetchRange) -> bool:
        return (
            bool(self.derived_timeframes)
            and self.backfill_mode == "max"
            and fetch_range.reason in {"initial-backfill", "historical-backfill", "internal-gap"}
        )

    def next_fetch_range(
        self,
        spec: MarketSpec,
        csv_path: Path,
        end_at: datetime,
    ) -> FetchRange | None:
        retry_range = self.next_retry_range(spec, end_at)
        if retry_range is not None:
            return retry_range

        local_range = self.local_data_range(spec, csv_path)
        provider_start = self.provider_start_dates[spec.provider]
        no_data_before = self.manifest.no_data_before(spec, "M1")
        if local_range is None:
            start_at = (
                provider_start
                if self.backfill_mode == "max"
                else end_at - timedelta(days=self.lookback_days)
            )
            if no_data_before is not None and no_data_before >= start_at:
                start_at = no_data_before + MINUTE
            if start_at > end_at:
                return None
            return FetchRange(start_at=start_at, end_at=end_at, reason="initial-backfill")

        first_timestamp, last_timestamp = local_range
        if self.backfill_mode == "max" and first_timestamp > provider_start:
            older_end = first_timestamp - MINUTE
            historical_start = provider_start
            if no_data_before is not None and no_data_before >= historical_start:
                historical_start = no_data_before + MINUTE
            if provider_start <= older_end:
                if historical_start > older_end:
                    if last_timestamp < end_at:
                        return FetchRange(
                            start_at=last_timestamp + MINUTE,
                            end_at=end_at,
                            reason="append-latest",
                        )
                    return None
                return FetchRange(
                    start_at=historical_start,
                    end_at=older_end,
                    reason="historical-backfill",
                )
        if self.backfill_mode == "max":
            internal_gap = self.next_internal_gap_range(spec, csv_path)
            if internal_gap is not None:
                return internal_gap
        if last_timestamp < end_at:
            return FetchRange(
                start_at=last_timestamp + MINUTE,
                end_at=end_at,
                reason="append-latest",
            )
        return None

    def next_retry_range(self, spec: MarketSpec, end_at: datetime) -> FetchRange | None:
        provider_start = self.provider_start_dates[spec.provider]
        for start_at, retry_end, reason in self.manifest.retry_ranges(spec, "M1"):
            start_at = max(start_at, provider_start)
            retry_end = min(retry_end, end_at)
            if start_at <= retry_end:
                return FetchRange(start_at=start_at, end_at=retry_end, reason=reason, retry=True)
        return None

    def next_fetch_start(self, spec: MarketSpec, csv_path: Path, end_at: datetime) -> datetime:
        fetch_range = self.next_fetch_range(spec, csv_path, end_at)
        return fetch_range.start_at if fetch_range is not None else end_at + MINUTE

    def local_data_range(self, spec: MarketSpec, csv_path: Path) -> tuple[datetime, datetime] | None:
        manifest_range = self.manifest.timestamp_range(spec, "M1")
        if manifest_range is not None:
            return manifest_range
        csv_range = read_timestamp_range(csv_path)
        if csv_range is not None:
            self.update_manifest_from_existing_file(spec, "M1", csv_path)
        return csv_range

    def next_internal_gap_range(self, spec: MarketSpec, csv_path: Path) -> FetchRange | None:
        gap = first_internal_m1_gap(
            spec,
            csv_path,
            self.manifest.empty_ranges(spec, "M1"),
        )
        if gap is None:
            return None
        start_at, end_at = gap
        return FetchRange(start_at=start_at, end_at=end_at, reason="internal-gap")

    def fetch_candles(
        self,
        spec: MarketSpec,
        start_at: datetime,
        end_at: datetime,
    ) -> list[MarketCandle]:
        candles: list[MarketCandle] = []
        for page in self.fetch_candle_pages(spec, start_at, end_at):
            candles.extend(page)
        return dedupe_candles(candles)

    def fetch_candle_pages(
        self,
        spec: MarketSpec,
        start_at: datetime,
        end_at: datetime,
    ) -> Iterator[list[MarketCandle]]:
        if spec.provider == "binance":
            yield from self.fetch_binance_candle_pages(spec.instrument, start_at, end_at)
            return
        yield from self.fetch_dukascopy_candle_pages(spec.instrument, start_at, end_at)

    def fetch_binance_candles(
        self,
        symbol: str,
        start_at: datetime,
        end_at: datetime,
    ) -> list[MarketCandle]:
        candles: list[MarketCandle] = []
        for page in self.fetch_binance_candle_pages(symbol, start_at, end_at):
            candles.extend(page)
        return dedupe_candles(candles)

    def fetch_binance_candle_pages(
        self,
        symbol: str,
        start_at: datetime,
        end_at: datetime,
    ) -> Iterator[list[MarketCandle]]:
        exclusive_end = end_at + MINUTE
        last_emitted: datetime | None = None
        archive_gap_start: datetime | None = None
        saw_monthly_archive = False
        monthly_end = start_of_utc_month(exclusive_end)

        monthly_requests: list[tuple[datetime, str]] = []
        month = start_of_utc_month(start_at)
        while month < monthly_end:
            monthly_requests.append((month, binance_monthly_archive_url(symbol, month)))
            month = add_months(month, 1)

        for month, archive in self.fetch_binance_archive_pages(monthly_requests, start_at, end_at):
            if archive is None:
                if saw_monthly_archive:
                    archive_gap_start = month
                    logger.info(
                        "Binance monthly archive missing for %s %s; falling back to REST",
                        symbol,
                        format_month(month),
                    )
                    break
                continue
            saw_monthly_archive = True
            if archive:
                last_emitted = archive[-1].timestamp
                yield archive

        if archive_gap_start is None:
            day = start_of_utc_day(max_datetime(start_at, monthly_end))
            daily_end = start_of_utc_day(exclusive_end)
            while day < daily_end:
                archive = self.fetch_binance_archive_candles(
                    binance_daily_archive_url(symbol, day),
                    start_at,
                    end_at,
                )
                if archive is None:
                    archive_gap_start = day
                    logger.info(
                        "Binance daily archive missing for %s %s; falling back to REST",
                        symbol,
                        format_day(day),
                    )
                    break
                if archive:
                    last_emitted = archive[-1].timestamp
                    yield archive
                day = add_days(day, 1)

        rest_start = start_at
        if last_emitted is not None:
            rest_start = last_emitted + MINUTE
        if archive_gap_start is not None:
            rest_start = min_datetime(rest_start, archive_gap_start)
        if rest_start <= end_at:
            yield from self.fetch_binance_rest_candle_pages(symbol, rest_start, end_at)

    def fetch_binance_archive_pages(
        self,
        requests: list[tuple[datetime, str]],
        start_at: datetime,
        end_at: datetime,
    ) -> Iterator[tuple[datetime, list[MarketCandle] | None]]:
        if not requests:
            return
        worker_count = min(self.binance_archive_workers, len(requests))
        if worker_count == 1:
            for period, url in requests:
                yield period, self.fetch_binance_archive_candles(url, start_at, end_at)
            return

        request_iter = iter(requests)
        in_flight = []

        def submit_next(executor: ThreadPoolExecutor) -> None:
            try:
                period, url = next(request_iter)
            except StopIteration:
                return
            in_flight.append(
                (
                    period,
                    executor.submit(self.fetch_binance_archive_candles, url, start_at, end_at),
                )
            )

        with ThreadPoolExecutor(
            max_workers=worker_count,
            thread_name_prefix="edgelab-binance-archive",
        ) as executor:
            for _ in range(worker_count):
                submit_next(executor)
            while in_flight:
                period, future = in_flight.pop(0)
                yield period, future.result()
                submit_next(executor)

    def fetch_binance_archive_candles(
        self,
        url: str,
        start_at: datetime,
        end_at: datetime,
    ) -> list[MarketCandle] | None:
        try:
            payload = self.fetch_bytes(url, self.request_timeout_seconds)
        except HTTPError as exc:
            if exc.code == 404:
                return None
            raise
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            csv_names = [name for name in archive.namelist() if not name.endswith("/")]
            if not csv_names:
                return []
            with archive.open(csv_names[0]) as handle:
                rows = csv.reader(io.TextIOWrapper(handle, encoding="utf-8"))
                candles = [
                    candle
                    for candle in (binance_archive_row_to_candle(row) for row in rows)
                    if candle is not None and start_at <= candle.timestamp <= end_at
                ]
        return dedupe_candles(candles)

    def fetch_binance_rest_candle_pages(
        self,
        symbol: str,
        start_at: datetime,
        end_at: datetime,
    ) -> Iterator[list[MarketCandle]]:
        cursor_ms = int(start_at.timestamp() * 1000)
        end_ms = int(end_at.timestamp() * 1000)

        while cursor_ms <= end_ms:
            request_end_ms = min(end_ms, cursor_ms + 1_000 * 60_000 - 1)
            query = urlencode(
                {
                    "symbol": symbol,
                    "interval": "1m",
                    "startTime": str(cursor_ms),
                    "endTime": str(request_end_ms),
                    "limit": "1000",
                }
            )
            data = self.fetch_binance_json(f"/klines?{query}")
            if not isinstance(data, list) or not data:
                break
            page = [binance_kline_to_candle(row) for row in data]
            page = [candle for candle in page if start_at <= candle.timestamp <= end_at]
            if not page:
                break
            page = dedupe_candles(page)
            yield page
            next_cursor = int(page[-1].timestamp.timestamp() * 1000) + 60_000
            if next_cursor <= cursor_ms:
                break
            cursor_ms = next_cursor

    def fetch_binance_json(self, path: str) -> object:
        last_error: Exception | None = None
        for base_url in BINANCE_REST_URLS:
            try:
                return self.fetch_json(f"{base_url}{path}", self.request_timeout_seconds)
            except Exception as exc:
                last_error = exc
        raise RuntimeError("Binance kline request failed") from last_error

    def fetch_dukascopy_candles(
        self,
        instrument: str,
        start_at: datetime,
        end_at: datetime,
    ) -> list[MarketCandle]:
        candles: list[MarketCandle] = []
        for page in self.fetch_dukascopy_candle_pages(instrument, start_at, end_at):
            candles.extend(page)
        return dedupe_candles(candles)

    def fetch_dukascopy_candle_pages(
        self,
        instrument: str,
        start_at: datetime,
        end_at: datetime,
    ) -> Iterator[list[MarketCandle]]:
        cursor_ms = int((end_at + MINUTE).timestamp() * 1000)
        start_ms = int(start_at.timestamp() * 1000)
        request_count = 0

        while cursor_ms > start_ms:
            if request_count and self.dukascopy_request_delay_seconds:
                time.sleep(self.dukascopy_request_delay_seconds)
            callback = f"_callbacks____{int(time.time() * 1000)}"
            query = urlencode(
                {
                    "path": "chart/json3",
                    "splits": "true",
                    "stocks": "true",
                    "init": "true",
                    "time_direction": "N",
                    "timestamp": str(cursor_ms),
                    "offer_side": "B",
                    "instrument": instrument,
                    "interval": "1MIN",
                    "jsonp": callback,
                }
            )
            data = self.fetch_json(f"{DUKASCOPY_URL}?{query}", self.request_timeout_seconds)
            request_count += 1
            if not isinstance(data, list) or not data:
                break
            page = [
                candle
                for candle in (dukascopy_row_to_candle(row) for row in data)
                if candle is not None and candle.volume != 0 and start_at <= candle.timestamp <= end_at
            ]
            oldest_timestamp = min(
                (
                    candle.timestamp
                    for candle in (dukascopy_row_to_candle(row) for row in data)
                    if candle is not None
                ),
                default=None,
            )
            if not page and oldest_timestamp is None:
                break
            if page:
                page = dedupe_candles(page)
                yield page
            if oldest_timestamp is None or oldest_timestamp <= start_at:
                break
            next_cursor = int(oldest_timestamp.timestamp() * 1000)
            if next_cursor >= cursor_ms:
                break
            cursor_ms = next_cursor

    def write_candles(
        self,
        spec: MarketSpec,
        candles: list[MarketCandle],
        csv_path: Path | None = None,
        *,
        write_derived: bool = True,
        sync_catalog: bool = True,
    ) -> PopulationResult:
        target_path = csv_path or self.csv_path_for_spec(spec)
        frame = merge_candles(
            load_csv_frame(target_path),
            candles_to_frame(candles),
        )
        if frame.empty:
            return PopulationResult(
                asset_id=spec.asset_id,
                symbol=spec.symbol,
                csv_path=str(target_path),
                fetched=len(candles),
                rows=0,
            )

        target_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = target_path.with_name(f".{target_path.name}.tmp")
        frame.to_csv(temp_path, index=False)
        temp_path.replace(target_path)
        derived_frames = self.write_derived_timeframes(spec, frame) if write_derived else []
        self.manifest.update_timeframe(spec, "M1", target_path, frame)
        for timeframe, derived_path, derived_frame in derived_frames:
            self.manifest.update_timeframe(spec, timeframe, derived_path, derived_frame)
        self.manifest.save()
        if sync_catalog:
            self.sync_catalog_rows(spec, target_path, frame, derived_frames)

        return PopulationResult(
            asset_id=spec.asset_id,
            symbol=spec.symbol,
            csv_path=str(target_path),
            fetched=len(candles),
            rows=len(frame),
            first_timestamp=parse_csv_timestamp(frame.iloc[0]["Timestamp"]),
            last_timestamp=parse_csv_timestamp(frame.iloc[-1]["Timestamp"]),
        )

    def result_for_existing_file(
        self,
        spec: MarketSpec,
        csv_path: Path,
        fetched: int,
    ) -> PopulationResult:
        frame = load_csv_frame(csv_path)
        return PopulationResult(
            asset_id=spec.asset_id,
            symbol=spec.symbol,
            csv_path=str(csv_path),
            fetched=fetched,
            rows=len(frame),
            first_timestamp=parse_csv_timestamp(frame.iloc[0]["Timestamp"]) if not frame.empty else None,
            last_timestamp=parse_csv_timestamp(frame.iloc[-1]["Timestamp"]) if not frame.empty else None,
        )

    def result_for_error(
        self,
        spec: MarketSpec,
        csv_path: Path,
        fetched: int,
        error: Exception,
    ) -> PopulationResult:
        try:
            existing = self.result_for_existing_file(spec, csv_path, fetched)
        except Exception:
            return PopulationResult(
                asset_id=spec.asset_id,
                symbol=spec.symbol,
                csv_path=str(csv_path),
                fetched=fetched,
                rows=0,
                error=str(error),
            )
        return PopulationResult(
            asset_id=existing.asset_id,
            symbol=existing.symbol,
            csv_path=existing.csv_path,
            fetched=existing.fetched,
            rows=existing.rows,
            first_timestamp=existing.first_timestamp,
            last_timestamp=existing.last_timestamp,
            error=str(error),
        )

    def unresolved_fetch_range(
        self,
        spec: MarketSpec,
        fetch_range: FetchRange,
        last_page: list[MarketCandle] | None,
    ) -> tuple[datetime, datetime] | None:
        if not last_page:
            return fetch_range.start_at, fetch_range.end_at

        if spec.provider == "dukascopy":
            earliest = min(candle.timestamp for candle in last_page)
            retry_end = min(fetch_range.end_at, earliest - MINUTE)
            if fetch_range.start_at <= retry_end:
                return fetch_range.start_at, retry_end
            return None

        latest = max(candle.timestamp for candle in last_page)
        retry_start = max(fetch_range.start_at, latest + MINUTE)
        if retry_start <= fetch_range.end_at:
            return retry_start, fetch_range.end_at
        return None

    def update_manifest_from_existing_file(
        self,
        spec: MarketSpec,
        timeframe: str,
        csv_path: Path,
    ) -> None:
        frame = load_csv_frame(csv_path)
        if frame.empty:
            return
        self.manifest.update_timeframe(spec, timeframe, csv_path, frame)
        self.manifest.save()

    def write_derived_timeframes(self, spec: MarketSpec, m1_frame: pd.DataFrame) -> list[tuple[str, Path, pd.DataFrame]]:
        derived_frames: list[tuple[str, Path, pd.DataFrame]] = []
        for timeframe in self.derived_timeframes:
            frame = derive_timeframe(m1_frame, timeframe)
            if frame.empty:
                continue
            target_path = self.csv_path_for_spec(spec, timeframe)
            temp_path = target_path.with_name(f".{target_path.name}.tmp")
            frame.to_csv(temp_path, index=False)
            temp_path.replace(target_path)
            derived_frames.append((timeframe, target_path, frame))
        return derived_frames

    def csv_path_for_spec(self, spec: MarketSpec, timeframe: str = "M1") -> Path:
        return self.root / spec.asset_id / f"{spec.filename_symbol}_{timeframe}.csv"

    def sync_catalog_rows(
        self,
        spec: MarketSpec,
        target_path: Path,
        frame: pd.DataFrame,
        derived_frames: list[tuple[str, Path, pd.DataFrame]],
    ) -> None:
        if self.catalog_session_factory is None:
            return
        with self.catalog_session_factory() as db:
            user_ids = self.catalog_user_ids(db)
            if not user_ids:
                return
            for user_id in user_ids:
                asset = self.upsert_catalog_asset(db, user_id, spec)
                changed_timeframes = [
                    timeframe
                    for timeframe, path, timeframe_frame in [
                        ("M1", target_path, frame),
                        *derived_frames,
                    ]
                    if self.upsert_catalog_timeframe(
                        db,
                        user_id,
                        asset,
                        timeframe,
                        path,
                        timeframe_frame,
                    )
                ]
                if changed_timeframes:
                    self.sync_catalog_replay_ready(db, user_id)
                    if self.catalog_import_enabled:
                        import_market_data_to_db(
                            db,
                            user_id=user_id,
                            instrument=spec.asset_id,
                            pending_only=True,
                            market_data_session_factory=self.market_data_session_factory,
                        )
            db.commit()

    def catalog_user_ids(self, db: Session) -> list[int]:
        user_ids = list(
            db.scalars(
                select(DatasetSettings.user_id).where(DatasetSettings.root_path == str(self.root))
            ).all()
        )
        if self.root == settings.datasets_root:
            explicit_user_ids = set(user_ids)
            default_user_ids = db.scalars(
                select(BetaUser.id).where(
                    BetaUser.id.not_in(select(DatasetSettings.user_id)),
                )
            ).all()
            user_ids.extend(user_id for user_id in default_user_ids if user_id not in explicit_user_ids)
        return sorted(set(user_ids))

    def upsert_catalog_asset(
        self,
        db: Session,
        user_id: int,
        spec: MarketSpec,
    ) -> DatasetAsset:
        asset = db.scalar(
            select(DatasetAsset).where(
                DatasetAsset.user_id == user_id,
                DatasetAsset.asset_key == spec.asset_id,
            )
        )
        folder_path = str(self.root / spec.asset_id)
        asset_name = spec.asset_id.replace("_", "/")
        symbol = spec.symbol
        if asset is None:
            asset = DatasetAsset(
                user_id=user_id,
                asset_key=spec.asset_id,
                name=asset_name,
                symbol=symbol,
                folder_path=folder_path,
                currency="USD",
                timezone="UTC",
                pnl_multiplier=1.0,
            )
            db.add(asset)
            db.flush()
            return asset
        if asset.name != asset_name or asset.symbol != symbol or asset.folder_path != folder_path:
            asset.name = asset_name
            asset.symbol = symbol
            asset.folder_path = folder_path
            asset.updated_at = utcnow()
        return asset

    def upsert_catalog_timeframe(
        self,
        db: Session,
        user_id: int,
        asset: DatasetAsset,
        timeframe: str,
        csv_path: Path,
        frame: pd.DataFrame,
    ) -> bool:
        stat = csv_path.stat()
        existing = db.scalar(
            select(DatasetTimeframe).where(
                DatasetTimeframe.user_id == user_id,
                DatasetTimeframe.asset_id == asset.id,
                DatasetTimeframe.timeframe == timeframe,
            )
        )
        unchanged = (
            existing is not None
            and existing.csv_path == str(csv_path)
            and existing.file_size == stat.st_size
            and existing.file_mtime_ns == stat.st_mtime_ns
        )
        if unchanged:
            return False
        if existing is None:
            existing = DatasetTimeframe(
                user_id=user_id,
                asset_id=asset.id,
                timeframe=timeframe,
                csv_path=str(csv_path),
                imported=False,
            )
            db.add(existing)
        existing.csv_path = str(csv_path)
        existing.rows = int(len(frame))
        existing.first_timestamp = frame.iloc[0]["Timestamp"] if not frame.empty else None
        existing.last_timestamp = frame.iloc[-1]["Timestamp"] if not frame.empty else None
        existing.file_size = stat.st_size
        existing.file_mtime_ns = stat.st_mtime_ns
        existing.imported = False
        existing.database_imported = False
        existing.database_imported_at = None
        existing.updated_at = utcnow()
        db.flush()
        return True

    def sync_catalog_replay_ready(self, db: Session, user_id: int) -> None:
        stored_timeframes = db.scalars(
            select(DatasetTimeframe).where(DatasetTimeframe.user_id == user_id)
        ).all()
        known_csv_paths = {row.csv_path for row in stored_timeframes if row.csv_path}
        known_dataset_keys = {(row.asset_id, row.timeframe) for row in stored_timeframes}
        assets_by_id = {
            asset.id: asset
            for asset in db.scalars(select(DatasetAsset).where(DatasetAsset.user_id == user_id)).all()
        }
        sessions = db.scalars(
            select(BacktestSession).where(BacktestSession.user_id == user_id)
        ).all()
        for session in sessions:
            if session.timeframe == "Imported":
                continue
            linked_asset_id = linked_session_dataset_asset_id(session, stored_timeframes, assets_by_id)
            if linked_asset_id is not None and session.dataset_asset_id != linked_asset_id:
                session.dataset_asset_id = linked_asset_id
            next_ready = bool(
                (session.csv_path and session.csv_path in known_csv_paths)
                or (
                    session.dataset_asset_id is not None
                    and session.timeframe is not None
                    and (session.dataset_asset_id, session.timeframe) in known_dataset_keys
                )
            )
            if session.replay_ready != next_ready:
                session.replay_ready = next_ready
                session.updated_at = utcnow()


def linked_session_dataset_asset_id(
    session: BacktestSession,
    stored_timeframes: list[DatasetTimeframe],
    assets_by_id: dict[int, DatasetAsset],
) -> int | None:
    if session.dataset_asset_id is not None:
        return session.dataset_asset_id

    wanted_timeframe = normalize_catalog_timeframe(session.timeframe) if session.timeframe else None
    if session.csv_path:
        for row in stored_timeframes:
            if row.csv_path != session.csv_path:
                continue
            if wanted_timeframe is None or row.timeframe == wanted_timeframe:
                return row.asset_id

    if not session.instrument:
        return None

    wanted_instrument = normalize_catalog_key(session.instrument)
    for row in stored_timeframes:
        if wanted_timeframe is not None and row.timeframe != wanted_timeframe:
            continue
        asset = assets_by_id.get(row.asset_id)
        if asset is None:
            continue
        if wanted_instrument in {
            normalize_catalog_key(asset.asset_key),
            normalize_catalog_key(asset.name),
            normalize_catalog_key(asset.symbol),
        }:
            return row.asset_id
    return None


def normalize_catalog_key(value: str) -> str:
    return value.replace("/", "_").replace(" ", "_").upper()


def normalize_catalog_timeframe(value: str) -> str:
    aliases = {
        "1M": "M1",
        "1MIN": "M1",
        "1MINUTE": "M1",
        "1m": "M1",
        "5M": "M5",
        "5MIN": "M5",
        "5m": "M5",
        "15M": "M15",
        "15m": "M15",
        "30M": "M30",
        "30m": "M30",
        "1H": "H1",
        "1h": "H1",
        "4H": "H4",
        "4h": "H4",
        "D": "Daily",
        "1D": "Daily",
        "Daily": "Daily",
        "W": "Weekly",
        "1W": "Weekly",
        "Weekly": "Weekly",
        "M": "Monthly",
        "1MO": "Monthly",
        "Monthly": "Monthly",
    }
    normalized = aliases.get(value, aliases.get(value.upper(), value))
    return normalized.upper() if normalized.upper() in RESAMPLE_RULES or normalized.upper() == "M1" else normalized


def fetch_json_url(url: str, timeout: int) -> object:
    last_error: Exception | None = None
    for attempt in range(1, NETWORK_RETRY_COUNT + 1):
        try:
            body = fetch_text_url(url, timeout)
            payload = strip_jsonp(body)
            return json.loads(payload)
        except json.JSONDecodeError as exc:
            last_error = exc
            if attempt == NETWORK_RETRY_COUNT:
                raise
            logger.warning("Invalid JSON response from %s; retrying attempt %s", url, attempt + 1)
            time.sleep(NETWORK_RETRY_BASE_SECONDS * attempt)
    raise RuntimeError("JSON request failed") from last_error


def fetch_text_url(url: str, timeout: int) -> str:
    return fetch_bytes_url(url, timeout).decode("utf-8")


def fetch_bytes_url(url: str, timeout: int) -> bytes:
    request = Request(url, headers=headers_for_url(url))
    last_error: Exception | None = None
    for attempt in range(1, NETWORK_RETRY_COUNT + 1):
        try:
            with urlopen(request, timeout=timeout) as response:
                return response.read()
        except HTTPError as exc:
            last_error = exc
            permanent_client_error = 400 <= exc.code < 500 and exc.code != 429
            if permanent_client_error or attempt == NETWORK_RETRY_COUNT:
                raise
            time.sleep(NETWORK_RETRY_BASE_SECONDS * attempt)
        except Exception as exc:
            last_error = exc
            if attempt == NETWORK_RETRY_COUNT:
                raise
            time.sleep(NETWORK_RETRY_BASE_SECONDS * attempt)
    raise RuntimeError("Request failed") from last_error


def headers_for_url(url: str) -> dict[str, str]:
    if "dukascopy.com" in url:
        return DUKASCOPY_HEADERS
    return {
        "Accept": "application/zip,application/json,text/csv,*/*",
        "User-Agent": DUKASCOPY_HEADERS["User-Agent"],
    }


def strip_jsonp(value: str) -> str:
    stripped = value.strip()
    match = stripped.find("(")
    if match > 0 and stripped.endswith((")", ");")):
        closing = -2 if stripped.endswith(");") else -1
        return stripped[match + 1 : closing]
    return stripped


def forex_spec(symbol: str) -> MarketSpec:
    normalized = symbol.strip().upper()
    asset_id = normalized.replace("/", "_")
    filename_symbol = asset_id.replace("_", "")
    return MarketSpec(
        provider="dukascopy",
        instrument=normalized,
        asset_id=asset_id,
        symbol=filename_symbol,
        filename_symbol=filename_symbol,
    )


def crypto_spec(symbol: str) -> MarketSpec:
    normalized = "".join(character for character in symbol.strip().upper() if character.isalnum())
    asset_id = split_crypto_symbol(normalized)
    return MarketSpec(
        provider="binance",
        instrument=normalized,
        asset_id=asset_id,
        symbol=normalized,
        filename_symbol=normalized,
    )


def split_crypto_symbol(symbol: str) -> str:
    for quote in ("USDT", "USDC", "FDUSD", "BUSD", "USD", "BTC", "ETH", "BNB"):
        if symbol.endswith(quote) and len(symbol) > len(quote):
            return f"{symbol[:-len(quote)]}_{quote}"
    return symbol


def binance_kline_to_candle(row: object) -> MarketCandle:
    if not isinstance(row, list) or len(row) < 6:
        raise ValueError("Invalid Binance kline row")
    return MarketCandle(
        timestamp=datetime.fromtimestamp(normalize_binance_timestamp(row[0]) / 1000, tz=timezone.utc),
        open=float(row[1]),
        high=float(row[2]),
        low=float(row[3]),
        close=float(row[4]),
        volume=float(row[5]),
    )


def binance_archive_row_to_candle(row: list[str]) -> MarketCandle | None:
    if len(row) < 6:
        return None
    try:
        return MarketCandle(
            timestamp=datetime.fromtimestamp(normalize_binance_timestamp(row[0]) / 1000, tz=timezone.utc),
            open=float(row[1]),
            high=float(row[2]),
            low=float(row[3]),
            close=float(row[4]),
            volume=float(row[5]),
        )
    except (TypeError, ValueError):
        return None


def normalize_binance_timestamp(value: object) -> int:
    timestamp = int(value)
    if timestamp > 100_000_000_000_000:
        return timestamp // 1000
    return timestamp


def dukascopy_row_to_candle(row: object) -> MarketCandle | None:
    if not isinstance(row, list) or len(row) < 5 or row[0] is None:
        return None
    return MarketCandle(
        timestamp=datetime.fromtimestamp(int(row[0]) / 1000, tz=timezone.utc),
        open=float(row[1]),
        high=float(row[2]),
        low=float(row[3]),
        close=float(row[4]),
        volume=float(row[5]) if len(row) > 5 and row[5] is not None else 0.0,
    )


def dedupe_candles(candles: list[MarketCandle]) -> list[MarketCandle]:
    by_timestamp = {floor_minute(candle.timestamp): candle for candle in candles}
    return [
        MarketCandle(
            timestamp=timestamp,
            open=candle.open,
            high=candle.high,
            low=candle.low,
            close=candle.close,
            volume=candle.volume,
        )
        for timestamp, candle in sorted(by_timestamp.items())
    ]


def candles_to_frame(candles: list[MarketCandle]) -> pd.DataFrame:
    if not candles:
        return empty_frame()
    return pd.DataFrame(
        {
            "Timestamp": [to_utc_naive(candle.timestamp) for candle in candles],
            "Open": [candle.open for candle in candles],
            "High": [candle.high for candle in candles],
            "Low": [candle.low for candle in candles],
            "Close": [candle.close for candle in candles],
            "Volume": [candle.volume for candle in candles],
        }
    )


def load_csv_frame(csv_path: Path) -> pd.DataFrame:
    if not csv_path.exists():
        return empty_frame()
    frame = pd.read_csv(csv_path)
    missing = [column for column in DATA_COLUMNS if column not in frame.columns]
    if missing:
        raise ValueError(f"CSV is missing required columns: {', '.join(missing)}")
    return normalize_frame(frame[DATA_COLUMNS])


def merge_candles(
    existing: pd.DataFrame,
    incoming: pd.DataFrame,
) -> pd.DataFrame:
    frames = [
        frame
        for frame in (normalize_frame(existing), normalize_frame(incoming))
        if not frame.empty
    ]
    if not frames:
        return empty_frame()
    frame = pd.concat(frames, ignore_index=True)

    frame = frame.dropna(subset=["Timestamp"]).sort_values("Timestamp")
    frame = frame.drop_duplicates(subset=["Timestamp"], keep="last")
    frame["Timestamp"] = frame["Timestamp"].dt.strftime("%Y-%m-%d %H:%M:%S")
    return frame[DATA_COLUMNS]


def derive_timeframe(m1_frame: pd.DataFrame, timeframe: str) -> pd.DataFrame:
    normalized_timeframe = normalize_timeframe(timeframe)
    rule = RESAMPLE_RULES.get(normalized_timeframe)
    if rule is None:
        raise ValueError(f"Unsupported derived timeframe: {timeframe}")
    frame = normalize_frame(m1_frame)
    if frame.empty:
        return empty_frame()
    frame = frame.set_index("Timestamp").sort_index()
    derived = frame.resample(rule, label="left", closed="left").agg(
        {
            "Open": "first",
            "High": "max",
            "Low": "min",
            "Close": "last",
            "Volume": "sum",
        }
    )
    derived = derived.dropna(subset=["Open", "High", "Low", "Close"])
    if derived.empty:
        return empty_frame()
    derived = derived.reset_index()
    derived["Timestamp"] = derived["Timestamp"].dt.strftime("%Y-%m-%d %H:%M:%S")
    return derived[DATA_COLUMNS]


def normalize_backfill_mode(value: str) -> Literal["max", "lookback"]:
    normalized = (value or "max").strip().lower()
    if normalized in {"max", "all", "maximum", "full"}:
        return "max"
    if normalized in {"lookback", "rolling", "recent"}:
        return "lookback"
    raise ValueError("EDGELAB_DATA_POPULATOR_BACKFILL_MODE must be max or lookback")


def normalize_timeframe(value: str) -> str:
    aliases = {
        "5M": "M5",
        "5MIN": "M5",
        "5m": "M5",
        "15M": "M15",
        "15MIN": "M15",
        "15m": "M15",
        "30M": "M30",
        "30MIN": "M30",
        "30m": "M30",
        "1H": "H1",
        "1h": "H1",
        "4H": "H4",
        "4h": "H4",
        "D": "Daily",
        "1D": "Daily",
        "Daily": "Daily",
    }
    return aliases.get(value, aliases.get(value.upper(), value))


def normalize_derived_timeframes(values: tuple[str, ...]) -> tuple[str, ...]:
    timeframes: list[str] = []
    for value in values:
        timeframe = normalize_timeframe(value.strip())
        if timeframe == "M1":
            continue
        if timeframe not in RESAMPLE_RULES:
            raise ValueError(f"Unsupported derived timeframe: {value}")
        if timeframe not in timeframes:
            timeframes.append(timeframe)
    return tuple(timeframes)


def normalize_frame(frame: pd.DataFrame) -> pd.DataFrame:
    if frame.empty:
        return empty_frame()
    normalized = frame.copy()
    normalized["Timestamp"] = pd.to_datetime(
        normalized["Timestamp"],
        errors="coerce",
        format="mixed",
        utc=True,
    ).dt.tz_convert(None)
    for column in ("Open", "High", "Low", "Close", "Volume"):
        normalized[column] = pd.to_numeric(normalized[column], errors="coerce")
    normalized = normalized.dropna(subset=DATA_COLUMNS)
    return normalized[DATA_COLUMNS]


def empty_frame() -> pd.DataFrame:
    return pd.DataFrame(columns=DATA_COLUMNS)


def read_last_timestamp(csv_path: Path) -> datetime | None:
    timestamp_range = read_timestamp_range(csv_path)
    return timestamp_range[1] if timestamp_range is not None else None


def read_timestamp_range(csv_path: Path) -> tuple[datetime, datetime] | None:
    if not csv_path.exists():
        return None
    frame = load_csv_frame(csv_path)
    if frame.empty:
        return None
    return (
        parse_csv_timestamp(frame.iloc[0]["Timestamp"]),
        parse_csv_timestamp(frame.iloc[-1]["Timestamp"]),
    )


def read_csv_row_count(csv_path: Path) -> int:
    if not csv_path.exists():
        return 0
    with csv_path.open("rb") as handle:
        return max(sum(1 for _line in handle) - 1, 0)


def first_internal_m1_gap(
    spec: MarketSpec,
    csv_path: Path,
    empty_ranges: list[tuple[datetime, datetime]],
) -> tuple[datetime, datetime] | None:
    timestamps = load_timestamp_series(csv_path)
    if len(timestamps) < 2:
        return None
    deltas = timestamps.diff()
    gap_positions = [int(position) for position in timestamps.index[deltas > MINUTE]]
    for position in gap_positions:
        previous_timestamp = parse_csv_timestamp(timestamps.iloc[position - 1])
        next_timestamp = parse_csv_timestamp(timestamps.iloc[position])
        missing_start = previous_timestamp + MINUTE
        missing_end = next_timestamp - MINUTE
        for segment_start, segment_end in subtract_ranges(missing_start, missing_end, empty_ranges):
            if spec.provider == "dukascopy" and not forex_gap_has_active_minutes(segment_start, segment_end):
                continue
            return segment_start, segment_end
    return None


def load_timestamp_series(csv_path: Path) -> pd.Series:
    if not csv_path.exists():
        return pd.Series(dtype="datetime64[ns]")
    try:
        frame = pd.read_csv(csv_path, usecols=["Timestamp"])
    except ValueError as exc:
        raise ValueError("CSV is missing required columns: Timestamp") from exc
    timestamps = pd.to_datetime(
        frame["Timestamp"],
        errors="coerce",
        format="mixed",
        utc=True,
    ).dt.tz_convert(None)
    return timestamps.dropna().drop_duplicates().sort_values().reset_index(drop=True)


def subtract_ranges(
    start_at: datetime,
    end_at: datetime,
    ranges: list[tuple[datetime, datetime]],
) -> list[tuple[datetime, datetime]]:
    segments = [(start_at, end_at)]
    for range_start, range_end in ranges:
        next_segments: list[tuple[datetime, datetime]] = []
        for segment_start, segment_end in segments:
            if range_end < segment_start or range_start > segment_end:
                next_segments.append((segment_start, segment_end))
                continue
            if range_start > segment_start:
                next_segments.append((segment_start, range_start - MINUTE))
            if range_end < segment_end:
                next_segments.append((range_end + MINUTE, segment_end))
        segments = [
            (segment_start, segment_end)
            for segment_start, segment_end in next_segments
            if segment_start <= segment_end
        ]
        if not segments:
            break
    return segments


def forex_gap_has_active_minutes(start_at: datetime, end_at: datetime) -> bool:
    cursor = start_at.astimezone(timezone.utc).date()
    end_date = end_at.astimezone(timezone.utc).date()
    while cursor <= end_date:
        day_start = datetime(cursor.year, cursor.month, cursor.day, tzinfo=timezone.utc)
        weekday = day_start.weekday()
        active_start: datetime | None = None
        active_end: datetime | None = None
        if weekday <= 3:
            active_start = day_start
            active_end = day_start + timedelta(days=1) - MINUTE
        elif weekday == 4:
            active_start = day_start
            active_end = day_start + timedelta(hours=22) - MINUTE
        elif weekday == 6:
            active_start = day_start + timedelta(hours=22)
            active_end = day_start + timedelta(days=1) - MINUTE

        if active_start is not None and active_end is not None:
            if max(start_at, active_start) <= min(end_at, active_end):
                return True
        cursor += timedelta(days=1)
    return False


def parse_csv_timestamp(value: object) -> datetime:
    parsed = pd.to_datetime(value, errors="raise", utc=True)
    return parsed.to_pydatetime()


def manifest_timestamp(value: object) -> str:
    return utc_manifest_timestamp(parse_csv_timestamp(value))


def utc_manifest_timestamp(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_utc_date(value: str) -> datetime:
    parsed = pd.to_datetime(value, errors="raise", utc=True)
    return parsed.to_pydatetime().replace(hour=0, minute=0, second=0, microsecond=0)


def start_of_utc_day(value: datetime) -> datetime:
    value = value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return datetime(value.year, value.month, value.day, tzinfo=timezone.utc)


def start_of_utc_month(value: datetime) -> datetime:
    value = value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return datetime(value.year, value.month, 1, tzinfo=timezone.utc)


def add_days(value: datetime, days: int) -> datetime:
    return value + timedelta(days=days)


def add_months(value: datetime, months: int) -> datetime:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    return datetime(year, month, 1, tzinfo=timezone.utc)


def format_month(value: datetime) -> str:
    value = value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return f"{value.year:04d}-{value.month:02d}"


def format_day(value: datetime) -> str:
    value = value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return f"{value.year:04d}-{value.month:02d}-{value.day:02d}"


def binance_monthly_archive_url(symbol: str, month: datetime) -> str:
    label = format_month(month)
    filename = f"{symbol}-1m-{label}.zip"
    return f"{BINANCE_ARCHIVE_BASE_URL}/monthly/klines/{symbol}/1m/{filename}"


def binance_daily_archive_url(symbol: str, day: datetime) -> str:
    label = format_day(day)
    filename = f"{symbol}-1m-{label}.zip"
    return f"{BINANCE_ARCHIVE_BASE_URL}/daily/klines/{symbol}/1m/{filename}"


def max_datetime(left: datetime, right: datetime) -> datetime:
    return left if left >= right else right


def min_datetime(left: datetime, right: datetime) -> datetime:
    return left if left <= right else right


def floor_minute(value: datetime) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).replace(second=0, microsecond=0)


def to_utc_naive(value: datetime) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).replace(tzinfo=None, second=0, microsecond=0)
