import json
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import RLock
from typing import Callable, Iterator, Literal
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import pandas as pd

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
DUKASCOPY_URL = "https://freeserv.dukascopy.com/2.0/index.php"
DUKASCOPY_HEADERS = {
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; EdgeLab/0.1; +https://github.com/SaiDheerajPeketi/EdgeLab)",
    "Referer": "https://freeserv.dukascopy.com/2.0/?path=chart/index&instrument=EUR/USD",
}

FetchJson = Callable[[str, int], object]
Provider = Literal["binance", "dukascopy"]

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class MarketSpec:
    provider: Provider
    instrument: str
    asset_id: str
    symbol: str
    filename_symbol: str


@dataclass(frozen=True)
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
            first_timestamp = parse_csv_timestamp(frame.iloc[0]["Timestamp"])
            timeframes[timeframe] = {
                "csv_path": self.relative_path(csv_path),
                "rows": int(len(frame)),
                "first_timestamp": utc_manifest_timestamp(first_timestamp),
                "last_timestamp": manifest_timestamp(frame.iloc[-1]["Timestamp"]),
                "updated_at": utc_manifest_timestamp(datetime.now(tz=timezone.utc)),
            }
            if no_data_before:
                try:
                    if first_timestamp > parse_csv_timestamp(no_data_before):
                        timeframes[timeframe]["no_data_before"] = no_data_before
                except (TypeError, ValueError):
                    pass
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
        fetch_json: FetchJson | None = None,
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
        self.fetch_json = fetch_json or fetch_json_url
        self.manifest = DataPopulatorManifest(root)

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
                attempted_ranges: set[tuple[str, datetime, datetime]] = set()
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

                    range_key = (fetch_range.reason, fetch_range.start_at, fetch_range.end_at)
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
                    for page_count, candles in enumerate(
                        self.fetch_candle_pages(spec, fetch_range.start_at, fetch_range.end_at),
                        start=1,
                    ):
                        if not candles:
                            continue
                        fetched += len(candles)
                        page_result = self.write_candles(spec, candles, csv_path)
                        if page_count == 1 or page_count % 25 == 0:
                            logger.info(
                                "Wrote %s page %s: fetched=%s total_rows=%s page_range=%s..%s",
                                spec.instrument,
                                page_count,
                                fetched,
                                page_result.rows,
                                utc_manifest_timestamp(candles[0].timestamp),
                                utc_manifest_timestamp(candles[-1].timestamp),
                            )

                    if fetched == 0:
                        logger.info(
                            "No %s candles returned for %s..%s",
                            spec.instrument,
                            utc_manifest_timestamp(fetch_range.start_at),
                            utc_manifest_timestamp(fetch_range.end_at),
                        )
                        if fetch_range.reason != "append-latest":
                            self.manifest.update_no_data_range(
                                spec,
                                "M1",
                                fetch_range.start_at,
                                fetch_range.end_at,
                                fetch_range.reason,
                            )
                            self.manifest.save()
                        if fetch_range.reason == "historical-backfill":
                            continue
                        results.append(self.result_for_existing_file(spec, csv_path, total_fetched))
                        break
                    total_fetched += fetched
                    results.append(self.result_for_existing_file(spec, csv_path, total_fetched))
                    break
            except Exception as exc:
                logger.exception("Failed to populate %s", spec.instrument)
                results.append(
                    PopulationResult(
                        asset_id=spec.asset_id,
                        symbol=spec.symbol,
                        csv_path=str(csv_path),
                        fetched=0,
                        rows=0,
                        error=str(exc),
                    )
                )

        logger.info("Provider group finished: provider=%s instruments=%s", provider, len(specs))
        return results

    def next_fetch_range(
        self,
        spec: MarketSpec,
        csv_path: Path,
        end_at: datetime,
    ) -> FetchRange | None:
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
        if last_timestamp < end_at:
            return FetchRange(
                start_at=last_timestamp + MINUTE,
                end_at=end_at,
                reason="append-latest",
            )
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
        cursor_ms = int(start_at.timestamp() * 1000)
        end_ms = int(end_at.timestamp() * 1000)

        while cursor_ms <= end_ms:
            query = urlencode(
                {
                    "symbol": symbol,
                    "interval": "1m",
                    "startTime": str(cursor_ms),
                    "endTime": str(end_ms),
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
        cursor_ms = int(end_at.timestamp() * 1000)
        start_ms = int(start_at.timestamp() * 1000)

        while cursor_ms >= start_ms:
            query = urlencode(
                {
                    "path": "chart/json3",
                    "jsonp": "_edgelab",
                    "splits": "true",
                    "stocks": "true",
                    "time_direction": "P",
                    "last_update": str(cursor_ms),
                    "offer_side": "B",
                    "instrument": instrument,
                    "interval": "1MIN",
                    "limit": "1000",
                }
            )
            data = self.fetch_json(f"{DUKASCOPY_URL}?{query}", self.request_timeout_seconds)
            if not isinstance(data, list) or not data:
                break
            page = [
                candle
                for candle in (dukascopy_row_to_candle(row) for row in data)
                if candle is not None and start_at <= candle.timestamp <= end_at
            ]
            if not page:
                break
            page = dedupe_candles(page)
            yield page
            earliest = min(candle.timestamp for candle in page)
            if earliest <= start_at:
                break
            next_cursor = int((earliest - MINUTE).timestamp() * 1000)
            if next_cursor >= cursor_ms:
                break
            cursor_ms = next_cursor

    def write_candles(
        self,
        spec: MarketSpec,
        candles: list[MarketCandle],
        csv_path: Path | None = None,
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
        derived_frames = self.write_derived_timeframes(spec, frame)
        self.manifest.update_timeframe(spec, "M1", target_path, frame)
        for timeframe, derived_path, derived_frame in derived_frames:
            self.manifest.update_timeframe(spec, timeframe, derived_path, derived_frame)
        self.manifest.save()

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


def fetch_json_url(url: str, timeout: int) -> object:
    request = Request(url, headers=DUKASCOPY_HEADERS)
    with urlopen(request, timeout=timeout) as response:
        body = response.read().decode("utf-8")
    payload = strip_jsonp(body)
    return json.loads(payload)


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
        timestamp=datetime.fromtimestamp(int(row[0]) / 1000, tz=timezone.utc),
        open=float(row[1]),
        high=float(row[2]),
        low=float(row[3]),
        close=float(row[4]),
        volume=float(row[5]),
    )


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
        [
            {
                "Timestamp": to_utc_naive(candle.timestamp),
                "Open": candle.open,
                "High": candle.high,
                "Low": candle.low,
                "Close": candle.close,
                "Volume": candle.volume,
            }
            for candle in candles
        ]
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


def floor_minute(value: datetime) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).replace(second=0, microsecond=0)


def to_utc_naive(value: datetime) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).replace(tzinfo=None, second=0, microsecond=0)
