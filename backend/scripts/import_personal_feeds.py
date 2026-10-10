"""Import personal M1 history from official Alpaca IEX or Kraken public APIs."""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener

from app.services.data_populator import (
    DATA_COLUMNS, MINUTE, RESAMPLE_RULES, MarketCandle, candles_to_frame,
    dedupe_candles, derive_timeframe, format_frame_for_csv,
)

ALPACA_URL = "https://data.alpaca.markets/v2/stocks/bars"
KRAKEN_URL = "https://api.kraken.com/0/public/OHLC"
MAX_PAGES = 20
MAX_ROWS = 200_000
MAX_RESPONSE_BYTES = 5_000_000
JsonFetcher = Callable[[Request, float], object]


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Credentials must never follow a provider redirect.
        return None


def read_json(request: Request, timeout: float) -> object:
    try:
        with build_opener(NoRedirects()).open(request, timeout=timeout) as response:
            body = response.read(MAX_RESPONSE_BYTES + 1)
        if len(body) > MAX_RESPONSE_BYTES:
            raise ValueError("Provider response exceeds the import size limit")
        return json.loads(body)
    except HTTPError as exc:
        raise ValueError(f"Provider request failed (HTTP {exc.code}); no files written") from None
    except (URLError, TimeoutError, OSError):
        raise ValueError("Provider connection failed; no files written") from None
    except (UnicodeError, json.JSONDecodeError):
        raise ValueError("Provider returned invalid JSON; no files written") from None


def utc_minute(value: datetime) -> datetime:
    return value.astimezone(timezone.utc).replace(second=0, microsecond=0)


def parse_time(value: str) -> datetime:
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("Dates must use YYYY-MM-DD or timezone-aware RFC3339") from None
    if len(value) == 10:
        result = result.replace(tzinfo=timezone.utc)
    if result.tzinfo is None or result.second or result.microsecond:
        raise ValueError("Dates must include a timezone and align to a minute")
    return result.astimezone(timezone.utc)


def candle(timestamp: datetime, values: list[object]) -> MarketCandle:
    if timestamp.tzinfo is None or timestamp.second or timestamp.microsecond:
        raise ValueError("Provider candle timestamp is not a UTC minute")
    if len(values) != 5 or any(isinstance(value, bool) for value in values):
        raise ValueError("Provider candle has invalid OHLCV values")
    try:
        opening, high, low, close, volume = map(float, values)
    except (TypeError, ValueError, OverflowError):
        raise ValueError("Provider candle has invalid OHLCV values") from None
    if (not all(math.isfinite(value) for value in (opening, high, low, close, volume))
            or min(opening, high, low, close) <= 0 or volume < 0
            or high < max(opening, low, close) or low > min(opening, high, close)):
        raise ValueError("Provider candle has inconsistent OHLCV values")
    return MarketCandle(timestamp.astimezone(timezone.utc), opening, high, low, close, volume)


def alpaca_history(
    symbol: str, start: datetime, end: datetime, *, now: datetime,
    timeout: float = 20, fetch: JsonFetcher = read_json,
) -> list[MarketCandle]:
    if not re.fullmatch(r"[A-Z][A-Z0-9.-]{0,31}", symbol):
        raise ValueError("Use one valid Alpaca stock or ETF symbol")
    if (start.tzinfo is None or end.tzinfo is None or start != utc_minute(start)
            or end != utc_minute(end) or not start < end
            or end - start > timedelta(days=30)
            or end > utc_minute(now - timedelta(minutes=16))):
        raise ValueError("Alpaca requires a 1-minute to 30-day range ending at least 16 minutes ago")
    keys = {name: os.environ.get(name, "").strip()
            for name in ("APCA_API_KEY_ID", "APCA_API_SECRET_KEY")}
    if any(not value or "\r" in value or "\n" in value for value in keys.values()):
        raise ValueError("Set your own APCA_API_KEY_ID and APCA_API_SECRET_KEY")
    headers = {"Accept": "application/json", "APCA-API-KEY-ID": keys["APCA_API_KEY_ID"],
               "APCA-API-SECRET-KEY": keys["APCA_API_SECRET_KEY"]}
    params = {"symbols": symbol, "timeframe": "1Min", "feed": "iex", "adjustment": "raw",
              "start": start.isoformat(), "end": (end - MINUTE).isoformat(),
              "limit": "10000", "sort": "asc"}
    candles: list[MarketCandle] = []
    seen_tokens: set[str] = set()
    for _ in range(MAX_PAGES):
        payload = fetch(Request(f"{ALPACA_URL}?{urlencode(params)}", headers=headers), timeout)
        if not isinstance(payload, dict) or not isinstance(payload.get("bars"), dict):
            raise ValueError("Alpaca response is missing stock bars")
        bars = payload["bars"]
        if any(key != symbol for key in bars):
            raise ValueError("Alpaca returned an unexpected instrument")
        rows = bars.get(symbol, [])
        if not isinstance(rows, list) or len(rows) > 10000:
            raise ValueError("Alpaca returned an invalid page")
        for row in rows:
            if not isinstance(row, dict) or any(key not in row for key in ("t", "o", "h", "l", "c", "v")):
                raise ValueError("Alpaca returned an incomplete candle")
            timestamp = parse_time(row["t"]) if isinstance(row["t"], str) else None
            if timestamp is None or not start <= timestamp or timestamp + MINUTE > end:
                raise ValueError("Alpaca returned a partial or out-of-range candle")
            candles.append(candle(timestamp, [row[key] for key in ("o", "h", "l", "c", "v")]))
        if len(candles) > MAX_ROWS:
            raise ValueError("Import exceeds the candle limit")
        token = payload.get("next_page_token")
        if token is None:
            return dedupe_candles(candles)
        if not isinstance(token, str) or not token or len(token) > 4096 or token in seen_tokens:
            raise ValueError("Alpaca pagination token is invalid or repeated")
        seen_tokens.add(token)
        params["page_token"] = token
    raise ValueError("Alpaca pagination exceeds the page limit; no files written")


def kraken_history(
    symbol: str, *, now: datetime, timeout: float = 20, fetch: JsonFetcher = read_json,
) -> list[MarketCandle]:
    if not re.fullmatch(r"[A-Z0-9]{2,32}", symbol):
        raise ValueError("Use one compact Kraken pair such as XBTUSD")
    query = urlencode({"pair": symbol, "interval": "1"})
    payload = fetch(Request(f"{KRAKEN_URL}?{query}", headers={"Accept": "application/json"}), timeout)
    if not isinstance(payload, dict) or payload.get("error") != [] or not isinstance(payload.get("result"), dict):
        raise ValueError("Kraken returned an invalid or failed OHLC response")
    result = payload["result"]
    pairs = [key for key in result if key != "last"]
    if len(pairs) != 1 or not isinstance(result[pairs[0]], list):
        raise ValueError("Kraken returned an unexpected instrument response")
    rows = result[pairs[0]]
    if not rows or len(rows) > 721:
        raise ValueError("Kraken response exceeds 720 recent candles plus its uncommitted tail")
    parsed: list[MarketCandle] = []
    for row in rows:
        if not isinstance(row, list) or len(row) != 8 or isinstance(row[0], bool):
            raise ValueError("Kraken returned an incomplete candle")
        try:
            epoch = float(row[0])
            if not math.isfinite(epoch) or epoch % 60:
                raise ValueError()
            timestamp = datetime.fromtimestamp(epoch, tz=timezone.utc)
        except (TypeError, ValueError, OverflowError, OSError):
            raise ValueError("Kraken returned an invalid candle timestamp") from None
        parsed.append(candle(timestamp, [row[1], row[2], row[3], row[4], row[6]]))
    if any(left.timestamp >= right.timestamp for left, right in zip(parsed, parsed[1:])):
        raise ValueError("Kraken candle timestamps are not strictly ordered")
    cutoff = utc_minute(now)
    if parsed[-1].timestamp > cutoff:
        raise ValueError("Kraken returned a future candle")
    # Kraken always appends an uncommitted candle, even when 'since' was supplied.
    return [bar for bar in parsed[:-1] if bar.timestamp + MINUTE <= cutoff]


def atomic_text(path: Path, content: str) -> None:
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix=".personal-import-", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        # Dataset artifacts are shared with the read-only, non-root API container.
        temporary.chmod(0o644)
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def write_history(
    root: Path, provider: str, symbol: str, incoming: list[MarketCandle],
    *, derived: tuple[str, ...] = (),
) -> dict[str, object]:
    if provider not in {"alpaca", "kraken"}:
        raise ValueError("Unsupported personal feed provider")
    pattern = r"[A-Z][A-Z0-9.-]{0,31}" if provider == "alpaca" else r"[A-Z0-9]{2,32}"
    if not re.fullmatch(pattern, symbol) or not incoming:
        raise ValueError("No valid completed candles to import")
    if any(value not in RESAMPLE_RULES for value in derived):
        raise ValueError("Unsupported derived timeframe")
    for bar in incoming:
        candle(bar.timestamp, [bar.open, bar.high, bar.low, bar.close, bar.volume])
    asset = f"ALPACA_IEX_{symbol}" if provider == "alpaca" else f"KRAKEN_{symbol}"
    folder = root / asset
    csv_path = folder / f"{asset}_M1.csv"
    sidecar = folder / "provenance.json"
    identity = {"provider": provider, "instrument": symbol, "feed": "iex" if provider == "alpaca" else "spot",
                "interval": "M1", "timezone": "UTC", "adjustment": "raw"}
    if csv_path.exists() and not sidecar.exists():
        raise ValueError("Existing personal-feed CSV lacks provenance; refusing to merge")
    if sidecar.exists():
        try:
            previous = json.loads(sidecar.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raise ValueError("Existing provenance is unreadable; refusing to merge") from None
        if not isinstance(previous, dict) or any(previous.get(key) != value for key, value in identity.items()):
            raise ValueError("Existing provenance differs; refusing to merge")
    existing: list[MarketCandle] = []
    if csv_path.exists():
        with csv_path.open(newline="", encoding="utf-8") as stream:
            reader = csv.DictReader(stream)
            if reader.fieldnames != DATA_COLUMNS:
                raise ValueError("Existing CSV has invalid columns")
            for row in reader:
                if len(existing) >= MAX_ROWS:
                    raise ValueError("Existing CSV exceeds the candle limit")
                try:
                    timestamp = datetime.strptime(row["Timestamp"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
                    existing.append(candle(timestamp, [row[key] for key in DATA_COLUMNS[1:]]))
                except (KeyError, TypeError, ValueError):
                    raise ValueError("Existing CSV contains an invalid candle") from None
    merged = dedupe_candles(existing + incoming)
    if len(merged) > MAX_ROWS:
        raise ValueError("Merged history exceeds the candle limit")
    frame = candles_to_frame(merged)
    output = {csv_path: format_frame_for_csv(frame).to_csv(index=False)}
    for timeframe in dict.fromkeys(derived):
        higher = derive_timeframe(frame, timeframe)
        timestamps = higher["Timestamp"].map(
            lambda value: datetime.strptime(value, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        )
        duration = {"M5": 5, "M15": 15, "M30": 30, "H1": 60, "H4": 240, "Daily": 1440}[timeframe]
        higher = higher[(timestamps >= merged[0].timestamp)
                        & (timestamps + timedelta(minutes=duration) <= merged[-1].timestamp + MINUTE)]
        output[folder / f"{asset}_{timeframe}.csv"] = higher.to_csv(index=False)
    metadata = {**identity, "personal_use": True, "source_url": ALPACA_URL if provider == "alpaca" else KRAKEN_URL,
                "coverage": "IEX only; historical bars, not consolidated US market data" if provider == "alpaca"
                else "Recent OHLC only: at most 720 committed M1 candles per request",
                "rows": len(merged), "first_timestamp": merged[0].timestamp.isoformat(),
                "last_timestamp": merged[-1].timestamp.isoformat()}
    folder.mkdir(parents=True, exist_ok=True)
    # Establish immutable source identity before the first CSV can be discovered.
    atomic_text(sidecar, json.dumps(metadata, indent=2, sort_keys=True) + "\n")
    for path, content in output.items():
        atomic_text(path, content)
    return {"provider": provider, "instrument": symbol, "rows": len(merged), "csv_path": str(csv_path)}


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("provider", choices=("alpaca", "kraken"))
    parser.add_argument("--symbol", required=True, help="One Alpaca stock/ETF or compact Kraken pair")
    parser.add_argument("--root", type=Path, default=Path(os.environ.get("EDGELAB_DATASETS_ROOT", "datasets")))
    parser.add_argument("--personal-use", action="store_true", help="Confirm this import is for your personal use")
    parser.add_argument("--start", help="Alpaca only: inclusive UTC minute or YYYY-MM-DD")
    parser.add_argument("--end", help="Alpaca only: exclusive UTC minute, at least 16 minutes old")
    parser.add_argument("--lookback-days", type=int, help="Alpaca only: 1-30 days (default 7)")
    parser.add_argument("--timeout", type=float, default=20, help="Provider request timeout in seconds (1-60)")
    parser.add_argument("--derived-timeframes", default="", help="Optional M5,M15,M30,H1,H4,Daily; closed buckets only")
    args = parser.parse_args(argv)
    if not args.personal_use and os.environ.get("EDGELAB_DEPLOYMENT_MODE") != "personal":
        parser.error("Use personal deployment mode or explicitly pass --personal-use")
    if not math.isfinite(args.timeout) or not 1 <= args.timeout <= 60:
        parser.error("--timeout must be between 1 and 60 seconds")
    derived = tuple(value.strip() for value in args.derived_timeframes.split(",") if value.strip())
    if any(value not in RESAMPLE_RULES for value in derived):
        parser.error("Unsupported derived timeframe")
    symbol = args.symbol.strip().upper()
    now = datetime.now(timezone.utc)
    try:
        if args.provider == "kraken":
            if any(value is not None for value in (args.start, args.end, args.lookback_days)):
                raise ValueError("Kraken imports only its latest 720 M1 entries; date/lookback options are Alpaca-only")
            bars = kraken_history(symbol, now=now, timeout=args.timeout)
        else:
            days = args.lookback_days if args.lookback_days is not None else 7
            if not 1 <= days <= 30 or (args.start and args.lookback_days is not None):
                raise ValueError("Choose --start or --lookback-days 1-30")
            end = parse_time(args.end) if args.end else utc_minute(now - timedelta(minutes=16))
            start = parse_time(args.start) if args.start else end - timedelta(days=days)
            bars = alpaca_history(symbol, start, end, now=now, timeout=args.timeout)
        summary = write_history(args.root, args.provider, symbol, bars, derived=derived)
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    print(json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    main()
