from __future__ import annotations

import argparse
import statistics
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api import routes
from app.db import Base
from app.models import BacktestSession, BetaUser, DatasetAsset, DatasetTimeframe, Playbook, Trade
from app.services.backtester import BacktestService
from app.services.datasets import DatasetCatalogService


DEFAULT_ASSETS = 200
DEFAULT_TIMEFRAMES = 6
DEFAULT_SESSIONS = 200
DEFAULT_TRADES = 200
DEFAULT_ITERATIONS = 20


class SeededCatalogService(DatasetCatalogService):
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
    assets: int,
    timeframes_per_asset: int,
    sessions: int,
    trades: int,
) -> int:
    timeframe_names = ["M1", "M5", "M15", "M30", "H1", "H4", "Daily", "Weekly"]
    selected_timeframes = timeframe_names[:timeframes_per_asset]
    now = datetime.now(timezone.utc)

    with session_factory() as db:
        user = BetaUser(
            email="bootstrap-benchmark@edgelab.local",
            name="Bootstrap Benchmark",
            provider="email",
            status="APPROVED",
        )
        db.add(user)
        db.flush()

        csv_paths: list[str] = []
        for asset_index in range(assets):
            asset_key = f"PAIR_{asset_index:04d}"
            asset = DatasetAsset(
                user_id=user.id,
                asset_key=asset_key,
                name=f"PAIR/{asset_index:04d}",
                symbol=f"PAIR{asset_index:04d}",
                folder_path=str(datasets_root / asset_key),
            )
            db.add(asset)
            db.flush()
            for timeframe in selected_timeframes:
                csv_path = str(datasets_root / asset_key / f"{asset_key}_{timeframe}.csv")
                csv_paths.append(csv_path)
                db.add(
                    DatasetTimeframe(
                        user_id=user.id,
                        asset_id=asset.id,
                        timeframe=timeframe,
                        csv_path=csv_path,
                        rows=10_000,
                        first_timestamp="2024-01-01 09:30:00",
                        last_timestamp="2024-12-31 15:30:00",
                        file_size=1_000_000,
                        file_mtime_ns=1,
                    )
                )

        for index in range(min(32, assets)):
            db.add(
                Playbook(
                    user_id=user.id,
                    name=f"Playbook {index:02d}",
                    description="Benchmark playbook",
                    rules="Follow the plan",
                )
            )

        session_ids: list[int] = []
        for index in range(sessions):
            csv_path = csv_paths[index % len(csv_paths)]
            session = BacktestSession(
                user_id=user.id,
                name=f"Session {index:04d}",
                symbol=f"PAIR{index % assets:04d}",
                timeframe=selected_timeframes[index % len(selected_timeframes)],
                csv_path=csv_path,
                current_offset=0,
                created_at=now - timedelta(minutes=index),
                updated_at=now - timedelta(minutes=index),
            )
            db.add(session)
            db.flush()
            session_ids.append(session.id)

        for index in range(trades):
            exit_time = now - timedelta(minutes=index)
            db.add(
                Trade(
                    user_id=user.id,
                    session_id=session_ids[index % len(session_ids)],
                    status="CLOSED",
                    side="LONG" if index % 2 == 0 else "SHORT",
                    entry_time=exit_time - timedelta(minutes=5),
                    entry_offset=index,
                    entry_price=1.2,
                    quantity=1.0,
                    remaining_quantity=0.0,
                    exit_time=exit_time,
                    exit_offset=index + 1,
                    exit_price=1.3,
                    realized_pnl=10.0 if index % 2 == 0 else -5.0,
                )
            )

        db.commit()
        return user.id


def benchmark_profile(fn, db: Session, user_id: int, *, iterations: int) -> tuple[object, list[float]]:
    samples: list[float] = []
    result = None

    for _ in range(5):
        result = fn(db, user_id)

    for _ in range(iterations):
        started_at = time.perf_counter()
        result = fn(db, user_id)
        samples.append((time.perf_counter() - started_at) * 1000)

    return result, samples


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compare full bootstrap payloads against the shell bootstrap profile."
    )
    parser.add_argument("--assets", type=int, default=DEFAULT_ASSETS)
    parser.add_argument("--timeframes", type=int, default=DEFAULT_TIMEFRAMES)
    parser.add_argument("--sessions", type=int, default=DEFAULT_SESSIONS)
    parser.add_argument("--trades", type=int, default=DEFAULT_TRADES)
    parser.add_argument("--iterations", type=int, default=DEFAULT_ITERATIONS)
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="edgelab-bootstrap-bench-") as temp_dir:
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
            assets=args.assets,
            timeframes_per_asset=args.timeframes,
            sessions=args.sessions,
            trades=args.trades,
        )

        original_dataset_catalog = routes.dataset_catalog
        original_backtester = routes.backtester
        try:
            routes.dataset_catalog = SeededCatalogService(temp_root / "datasets", session_factory)
            routes.backtester = BacktestService(dataset_catalog=routes.dataset_catalog)
            with session_factory() as db:
                shell_payload, shell_samples = benchmark_profile(
                    routes.build_bootstrap_shell_response,
                    db,
                    user_id,
                    iterations=args.iterations,
                )
                full_payload, full_samples = benchmark_profile(
                    routes.build_bootstrap_response,
                    db,
                    user_id,
                    iterations=args.iterations,
                )
        finally:
            routes.dataset_catalog = original_dataset_catalog
            routes.backtester = original_backtester

    shell_size = len(shell_payload.model_dump_json().encode("utf-8"))
    full_size = len(full_payload.model_dump_json().encode("utf-8"))

    print(f"Assets: {args.assets}")
    print(f"Timeframes per asset: {args.timeframes}")
    print(f"Sessions: {args.sessions}")
    print(f"Trades: {args.trades}")
    print(f"Iterations: {args.iterations}")
    print()
    print(f"Shell mean: {statistics.mean(shell_samples):.2f} ms")
    print(f"Shell p95:  {percentile(shell_samples, 0.95):.2f} ms")
    print(f"Shell size: {shell_size} bytes")
    print()
    print(f"Full mean:  {statistics.mean(full_samples):.2f} ms")
    print(f"Full p95:   {percentile(full_samples, 0.95):.2f} ms")
    print(f"Full size:  {full_size} bytes")
    print()
    if shell_size > 0:
        print(f"Payload reduction: {(1 - (shell_size / full_size)) * 100:.2f}%")
    if statistics.mean(shell_samples) > 0:
        print(f"Latency reduction: {(1 - (statistics.mean(shell_samples) / statistics.mean(full_samples))) * 100:.2f}%")


if __name__ == "__main__":
    main()
