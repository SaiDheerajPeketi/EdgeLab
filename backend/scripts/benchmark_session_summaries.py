from __future__ import annotations

import argparse
import statistics
import tempfile
import time
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db import Base
from app.models import BacktestSession, BetaUser, DatasetAsset, DatasetTimeframe
from app.services.backtester import BacktestService


DEFAULT_SESSIONS = 20000
DEFAULT_ITERATIONS = 25
DEFAULT_LIMIT = 50
DEFAULT_STALE_RATIO = 0.25


class NoopCatalog:
    def discover_catalog(self, db: Session, user_id: int, *, force: bool = False) -> None:
        return None


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(int(len(ordered) * fraction) - 1, 0)
    return ordered[index]


def seed_workload(
    session_factory: sessionmaker,
    datasets_root: Path,
    *,
    sessions: int,
    stale_ratio: float,
) -> int:
    csv_dir = datasets_root / "GBP_USD"
    csv_dir.mkdir(parents=True, exist_ok=True)
    csv_path = csv_dir / "GBPUSD_M1.csv"
    csv_path.write_text(
        "Timestamp,Open,High,Low,Close,Volume\n"
        "2024-01-01 09:30:00,1.2,1.3,1.1,1.25,100\n",
        encoding="utf-8",
    )
    csv_stat = csv_path.stat()

    stale_every = max(int(round(1 / max(stale_ratio, 0.0001))), 1) if stale_ratio > 0 else sessions + 1

    with session_factory() as db:
        user = BetaUser(
            email="benchmark@edgelab.local",
            name="Benchmark Runner",
            provider="email",
            status="APPROVED",
        )
        db.add(user)
        db.flush()

        asset = DatasetAsset(
            user_id=user.id,
            asset_key="GBP_USD",
            name="GBP/USD",
            symbol="GBPUSD",
            folder_path=str(csv_dir),
        )
        db.add(asset)
        db.flush()
        db.add(
            DatasetTimeframe(
                user_id=user.id,
                asset_id=asset.id,
                timeframe="M1",
                csv_path=str(csv_path),
                rows=1,
                first_timestamp="2024-01-01 09:30:00",
                last_timestamp="2024-01-01 09:30:00",
                file_size=csv_stat.st_size,
                file_mtime_ns=csv_stat.st_mtime_ns,
            )
        )

        for index in range(sessions):
            stale = stale_ratio > 0 and index % stale_every == 0
            db.add(
                BacktestSession(
                    user_id=user.id,
                    name=f"Session {index}",
                    symbol="GBPUSD",
                    timeframe="M1",
                    csv_path=f"/stale/GBPUSD_M1_{index}.csv" if stale else str(csv_path),
                    current_offset=0,
                )
            )

        db.commit()
        return user.id


def legacy_page(service: BacktestService, db: Session, user_id: int, *, limit: int) -> list[BacktestSession]:
    batch_size = max(limit * 3, limit)
    next_offset = 0
    items: list[BacktestSession] = []

    while len(items) < limit:
        candidates = service.list_sessions(db, user_id, offset=next_offset, limit=batch_size)
        if not candidates:
            return items

        for session in candidates:
            next_offset += 1
            if not service.session_is_listable(session):
                continue
            items.append(session)
            if len(items) == limit:
                return items

        if len(candidates) < batch_size:
            break

    return items


def indexed_page(service: BacktestService, db: Session, user_id: int, *, limit: int) -> list[BacktestSession]:
    return service.list_listable_sessions(db, user_id, limit=limit)


def benchmark(
    fn,
    service: BacktestService,
    db: Session,
    user_id: int,
    *,
    limit: int,
    iterations: int,
) -> tuple[list[BacktestSession], list[float]]:
    samples: list[float] = []
    result: list[BacktestSession] = []

    for _ in range(5):
        result = fn(service, db, user_id, limit=limit)

    for _ in range(iterations):
        started_at = time.perf_counter()
        result = fn(service, db, user_id, limit=limit)
        samples.append((time.perf_counter() - started_at) * 1000)

    return result, samples


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compare legacy filesystem-filtered session summaries against the indexed database path."
    )
    parser.add_argument("--sessions", type=int, default=DEFAULT_SESSIONS)
    parser.add_argument("--iterations", type=int, default=DEFAULT_ITERATIONS)
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    parser.add_argument("--stale-ratio", type=float, default=DEFAULT_STALE_RATIO)
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="edgelab-bench-") as temp_dir:
        temp_root = Path(temp_dir)
        engine = create_engine(
            f"sqlite:///{temp_root / 'benchmark.db'}",
            connect_args={"check_same_thread": False},
        )
        session_factory = sessionmaker(bind=engine)
        Base.metadata.create_all(engine)
        user_id = seed_workload(
            session_factory,
            temp_root / "datasets",
            sessions=args.sessions,
            stale_ratio=args.stale_ratio,
        )

        legacy_service = BacktestService()
        indexed_service = BacktestService(dataset_catalog=NoopCatalog())

        with session_factory() as db:
            legacy_items, legacy_samples = benchmark(
                legacy_page,
                legacy_service,
                db,
                user_id,
                limit=args.limit,
                iterations=args.iterations,
            )
            indexed_items, indexed_samples = benchmark(
                indexed_page,
                indexed_service,
                db,
                user_id,
                limit=args.limit,
                iterations=args.iterations,
            )

    if [session.id for session in legacy_items] != [session.id for session in indexed_items]:
        raise SystemExit("Benchmark mismatch: legacy and indexed queries returned different session sets")

    legacy_mean = statistics.mean(legacy_samples)
    indexed_mean = statistics.mean(indexed_samples)
    speedup = legacy_mean / indexed_mean if indexed_mean > 0 else 0.0

    print(f"Seeded sessions: {args.sessions}")
    print(f"Summary page size: {args.limit}")
    print(f"Stale session ratio: {args.stale_ratio:.2f}")
    print(f"Iterations: {args.iterations}")
    print()
    print(f"Legacy mean:  {legacy_mean:.2f} ms")
    print(f"Legacy p95:   {percentile(legacy_samples, 0.95):.2f} ms")
    print(f"Indexed mean: {indexed_mean:.2f} ms")
    print(f"Indexed p95:  {percentile(indexed_samples, 0.95):.2f} ms")
    print(f"Speedup:      {speedup:.2f}x")


if __name__ == "__main__":
    main()
