import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Literal
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import pandas as pd

DATA_COLUMNS = ["Timestamp", "Open", "High", "Low", "Close", "Volume"]
MINUTE = timedelta(minutes=1)
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

    def specs(self) -> list[MarketSpec]:
        return [
            *[forex_spec(symbol) for symbol in self.forex_symbols],
            *[crypto_spec(symbol) for symbol in self.crypto_symbols],
        ]

    def populate_once(self, now: datetime | None = None) -> PopulationSummary:
        started_at = datetime.now(tz=timezone.utc)
        end_at = floor_minute(now or started_at) - MINUTE
        results: list[PopulationResult] = []
        self.root.mkdir(parents=True, exist_ok=True)

        for spec in self.specs():
            csv_path = self.csv_path_for_spec(spec)
            try:
                start_at = self.next_fetch_start(spec, csv_path, end_at)
                if start_at > end_at:
                    results.append(self.write_candles(spec, [], csv_path))
                    continue
                candles = self.fetch_candles(spec, start_at, end_at)
                results.append(self.write_candles(spec, candles, csv_path))
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

        return PopulationSummary(
            started_at=started_at,
            finished_at=datetime.now(tz=timezone.utc),
            results=results,
        )

    def next_fetch_start(self, spec: MarketSpec, csv_path: Path, end_at: datetime) -> datetime:
        last_timestamp = read_last_timestamp(csv_path)
        if last_timestamp is not None:
            return last_timestamp + MINUTE
        if self.backfill_mode == "max":
            return self.provider_start_dates[spec.provider]
        return end_at - timedelta(days=self.lookback_days)

    def fetch_candles(
        self,
        spec: MarketSpec,
        start_at: datetime,
        end_at: datetime,
    ) -> list[MarketCandle]:
        if spec.provider == "binance":
            return self.fetch_binance_candles(spec.instrument, start_at, end_at)
        return self.fetch_dukascopy_candles(spec.instrument, start_at, end_at)

    def fetch_binance_candles(
        self,
        symbol: str,
        start_at: datetime,
        end_at: datetime,
    ) -> list[MarketCandle]:
        candles: list[MarketCandle] = []
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
            candles.extend(page)
            next_cursor = int(page[-1].timestamp.timestamp() * 1000) + 60_000
            if next_cursor <= cursor_ms:
                break
            cursor_ms = next_cursor

        return dedupe_candles(candles)

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
            candles.extend(page)
            earliest = min(candle.timestamp for candle in page)
            if earliest <= start_at:
                break
            next_cursor = int((earliest - MINUTE).timestamp() * 1000)
            if next_cursor >= cursor_ms:
                break
            cursor_ms = next_cursor

        return dedupe_candles(candles)

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
        self.write_derived_timeframes(spec, frame)

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

    def write_derived_timeframes(self, spec: MarketSpec, m1_frame: pd.DataFrame) -> None:
        for timeframe in self.derived_timeframes:
            frame = derive_timeframe(m1_frame, timeframe)
            if frame.empty:
                continue
            target_path = self.csv_path_for_spec(spec, timeframe)
            temp_path = target_path.with_name(f".{target_path.name}.tmp")
            frame.to_csv(temp_path, index=False)
            temp_path.replace(target_path)

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
    normalized["Timestamp"] = pd.to_datetime(normalized["Timestamp"], errors="coerce", utc=True).dt.tz_convert(None)
    for column in ("Open", "High", "Low", "Close", "Volume"):
        normalized[column] = pd.to_numeric(normalized[column], errors="coerce")
    normalized = normalized.dropna(subset=DATA_COLUMNS)
    return normalized[DATA_COLUMNS]


def empty_frame() -> pd.DataFrame:
    return pd.DataFrame(columns=DATA_COLUMNS)


def read_last_timestamp(csv_path: Path) -> datetime | None:
    if not csv_path.exists():
        return None
    frame = load_csv_frame(csv_path)
    if frame.empty:
        return None
    return parse_csv_timestamp(frame.iloc[-1]["Timestamp"])


def parse_csv_timestamp(value: object) -> datetime:
    parsed = pd.to_datetime(value, errors="raise", utc=True)
    return parsed.to_pydatetime()


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
