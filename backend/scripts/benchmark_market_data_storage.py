from __future__ import annotations

import argparse
import statistics
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import BetaUser, DatasetTimeframe
from app.services.database_market_data import DatabaseMarketDataService
from app.services.datasets import DatasetCatalogService
from app.services.market_data import MarketDataService


DEFAULT_ROWS = 20_000
DEFAULT_LIMIT = 300
DEFAULT_OFFSET = 15_000
DEFAULT_ITERATIONS = 25


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(int(len(ordered) * fraction) - 1, 0)
    return ordered[index]


def seed_user(db) -> int:
    user = BetaUser(
        email="market-data-benchmark@edgelab.local",
        name="Market Data Benchmark",
        provider="email",
        status="APPROVED",
    )
    db.add(user)
    db.flush()
    return user.id


def write_csv(csv_path: Path, rows: int) -> None:
    start = datetime(2024, 1, 1, 9, 30, 0)
    with csv_path.open("w", encoding="utf-8") as handle:
        handle.write("Timestamp,Open,High,Low,Close,Volume\n")
        for index in range(rows):
            timestamp = start + timedelta(minutes=index)
            open_price = 1.1000 + (index * 0.0001)
            handle.write(
                f"{timestamp:%Y-%m-%d %H:%M:%S},"
                f"{open_price:.4f},"
                f"{open_price + 0.0008:.4f},"
                f"{open_price - 0.0007:.4f},"
                f"{open_price + 0.0003:.4f},"
                f"{100 + (index % 50)}\n"
            )


def benchmark(fn, *, iterations: int) -> tuple[object, list[float], float]:
    result = None
    cold_started_at = time.perf_counter()
    result = fn()
    cold_ms = (time.perf_counter() - cold_started_at) * 1000

    for _ in range(5):
        fn()

    samples: list[float] = []
    for _ in range(iterations):
        started_at = time.perf_counter()
        result = fn()
        samples.append((time.perf_counter() - started_at) * 1000)
    return result, samples, cold_ms


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Benchmark CSV-backed vs DB-backed market-data bars and metadata reads."
    )
    parser.add_argument("--rows", type=int, default=DEFAULT_ROWS)
    parser.add_argument("--offset", type=int, default=DEFAULT_OFFSET)
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    parser.add_argument("--iterations", type=int, default=DEFAULT_ITERATIONS)
    args = parser.parse_args()
    offset = min(max(args.offset, 0), max(args.rows - 1, 0))

    with tempfile.TemporaryDirectory(prefix="edgelab-market-data-bench-") as temp_dir:
        temp_root = Path(temp_dir)
        datasets_root = temp_root / "datasets"
        asset_dir = datasets_root / "EUR_USD"
        asset_dir.mkdir(parents=True)
        csv_path = asset_dir / "EURUSD_M1.csv"
        write_csv(csv_path, args.rows)

        engine = create_engine(
            f"sqlite:///{temp_root / 'benchmark.db'}",
            connect_args={"check_same_thread": False},
        )
        session_factory = sessionmaker(bind=engine)
        Base.metadata.create_all(engine)
        catalog = DatasetCatalogService(datasets_root, session_factory, market_data_import_enabled=True)

        with session_factory() as db:
            user_id = seed_user(db)
            catalog.refresh_catalog(db, user_id)
            timeframe_row = db.scalar(
                select(DatasetTimeframe).where(DatasetTimeframe.user_id == user_id)
            )
            if timeframe_row is None:
                raise SystemExit("Dataset timeframe was not indexed")
            asset_id = timeframe_row.asset_id

        csv_service = MarketDataService(csv_path, cache=True, timestamp_timezone="UTC")
        db_service = DatabaseMarketDataService(
            session_factory,
            session_factory,
            user_id=user_id,
            asset_id=asset_id,
            timeframe="M1",
            csv_path=str(csv_path),
            timestamp_timezone="UTC",
        )

        csv_meta, csv_meta_samples, csv_meta_cold_ms = benchmark(
            csv_service.get_metadata,
            iterations=args.iterations,
        )
        db_meta, db_meta_samples, db_meta_cold_ms = benchmark(
            db_service.get_metadata,
            iterations=args.iterations,
        )
        csv_bars, csv_bar_samples, csv_bar_cold_ms = benchmark(
            lambda: csv_service.get_bars(offset=offset, limit=args.limit),
            iterations=args.iterations,
        )
        db_bars, db_bar_samples, db_bar_cold_ms = benchmark(
            lambda: db_service.get_bars(offset=offset, limit=args.limit),
            iterations=args.iterations,
        )

    print(f"Rows seeded: {args.rows}")
    print(f"Offset: {offset}")
    print(f"Limit: {args.limit}")
    print(f"Iterations: {args.iterations}")
    print()
    print(f"CSV metadata rows: {csv_meta.rows}")
    print(f"CSV metadata cold: {csv_meta_cold_ms:.2f} ms")
    print(f"CSV metadata mean: {statistics.mean(csv_meta_samples):.2f} ms")
    print(f"CSV metadata p95:  {percentile(csv_meta_samples, 0.95):.2f} ms")
    print()
    print(f"DB metadata rows:  {db_meta.rows}")
    print(f"DB metadata cold:  {db_meta_cold_ms:.2f} ms")
    print(f"DB metadata mean:  {statistics.mean(db_meta_samples):.2f} ms")
    print(f"DB metadata p95:   {percentile(db_meta_samples, 0.95):.2f} ms")
    print()
    print(f"CSV bars returned: {len(csv_bars.bars)}")
    print(f"CSV bars cold:     {csv_bar_cold_ms:.2f} ms")
    print(f"CSV bars mean:     {statistics.mean(csv_bar_samples):.2f} ms")
    print(f"CSV bars p95:      {percentile(csv_bar_samples, 0.95):.2f} ms")
    print()
    print(f"DB bars returned:  {len(db_bars.bars)}")
    print(f"DB bars cold:      {db_bar_cold_ms:.2f} ms")
    print(f"DB bars mean:      {statistics.mean(db_bar_samples):.2f} ms")
    print(f"DB bars p95:       {percentile(db_bar_samples, 0.95):.2f} ms")


if __name__ == "__main__":
    main()
