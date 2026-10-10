"""Isolated synthetic cache retention and chart conversion measurements."""
from __future__ import annotations

import argparse
import gc
import importlib.util
import json
from pathlib import Path
import statistics
import sys
import time
import tracemalloc

import pandas as pd

from app.services.candle_frames import frame_to_candles
from app.services.market_data import MarketDataService
from app.services.read_models import MemoryReadModelCache
from app.schemas import Candle


def cache_retention(factory, requests):
    gc.collect()
    tracemalloc.start()
    cache = factory()
    started = time.perf_counter()
    for index in range(requests):
        cache.get_or_load(str(index), 60, lambda index=index: {"data": bytes([index % 256]) * 4096})
    current, peak = tracemalloc.get_traced_memory()
    elapsed = (time.perf_counter() - started) * 1000
    tracemalloc.stop()
    return {
        "requests": requests, "resident_entries": len(cache._entries),
        "resident_locks": len(getattr(cache, "_loads_by_key", getattr(cache, "_locks_by_key", {}))),
        "current_bytes": current, "peak_bytes": peak, "elapsed_ms": round(elapsed, 3),
    }


def legacy_conversion(frame, service):
    # Reference to the previous per-row pandas-Series path, for output parity and timing.
    def optional(value):
        return None if pd.isna(value) else float(value)

    bars = []
    for _, row in frame.iterrows():
        timestamp = service._parse_timestamp(row["Timestamp"])
        bars.append(Candle(
            time=int(service._local_to_utc(timestamp).timestamp()), timestamp=timestamp,
            open=float(row["Open"]), high=float(row["High"]), low=float(row["Low"]),
            close=float(row["Close"]), volume=float(row["Volume"]),
            ema_20=optional(row["ema_20"]), ema_50=optional(row["ema_50"]),
            rsi_14=optional(row["rsi_14"]),
        ))
    return bars


def conversion_measurement(count, iterations):
    service = MarketDataService(Path("/synthetic-not-read.csv"), timestamp_timezone="Asia/Kolkata")
    frame = pd.DataFrame({
        "Timestamp": pd.date_range("2026-01-01", periods=count, freq="min"),
        "Open": 100.0, "High": 102.0, "Low": 99.0, "Close": 101.0, "Volume": 12345.5,
    })
    frame = service._with_indicators(frame)
    old = legacy_conversion(frame, service)
    current = frame_to_candles(frame, service._local_to_utc, parse_timestamp=service._parse_timestamp)
    assert old == current, "Candle values changed"
    report = {"rows": count, "identical_outputs": True}
    for name, convert in (
        ("series", lambda: legacy_conversion(frame, service)),
        ("tuples", lambda: frame_to_candles(frame, service._local_to_utc, parse_timestamp=service._parse_timestamp)),
    ):
        samples = []
        for _ in range(iterations):
            started = time.perf_counter()
            convert()
            samples.append((time.perf_counter() - started) * 1000)
        report[name] = {
            "mean_ms": round(statistics.mean(samples), 3),
            "p95_ms": round(sorted(samples)[max(0, int(len(samples) * 0.95) - 1)], 3),
        }
    report["mean_speedup"] = round(report["series"]["mean_ms"] / report["tuples"]["mean_ms"], 2)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--requests", type=int, default=20_000)
    parser.add_argument("--iterations", type=int, default=20)
    parser.add_argument("--compare-cache-source", type=Path)
    args = parser.parse_args()
    if args.requests < 1 or args.iterations < 1:
        parser.error("requests and iterations must be positive")
    report = {"cache": cache_retention(MemoryReadModelCache, args.requests)}
    if args.compare_cache_source:
        spec = importlib.util.spec_from_file_location("baseline_read_models", args.compare_cache_source)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        report["baseline_cache"] = cache_retention(module.MemoryReadModelCache, args.requests)
    report["conversion"] = [conversion_measurement(count, args.iterations) for count in (300, 5000)]
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
