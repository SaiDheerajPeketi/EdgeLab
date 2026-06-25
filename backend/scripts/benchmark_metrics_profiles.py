from __future__ import annotations

import argparse
import statistics
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import BacktestSession, BetaUser, Trade
from app.services.metrics import get_metrics, get_metrics_curves, get_metrics_summary


DEFAULT_SESSIONS = 50
DEFAULT_TRADES_PER_SESSION = 100
DEFAULT_ITERATIONS = 20


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(int(len(ordered) * fraction) - 1, 0)
    return ordered[index]


def seed_workload(session_factory, *, sessions: int, trades_per_session: int) -> tuple[int, int]:
    now = datetime.now(timezone.utc)
    with session_factory() as db:
        user = BetaUser(
            email="metrics-benchmark@edgelab.local",
            name="Metrics Benchmark",
            provider="email",
            status="APPROVED",
        )
        db.add(user)
        db.flush()

        session = BacktestSession(
            user_id=user.id,
            name="Metrics Benchmark Session",
            symbol="GBPUSD",
            current_offset=0,
        )
        db.add(session)
        db.flush()

        for session_index in range(sessions):
            for trade_index in range(trades_per_session):
                trade_time = now - timedelta(minutes=(session_index * trades_per_session) + trade_index)
                db.add(
                    Trade(
                        user_id=user.id,
                        session_id=session.id,
                        status="CLOSED",
                        side="LONG" if trade_index % 2 == 0 else "SHORT",
                        entry_time=trade_time - timedelta(minutes=5),
                        entry_price=100.0,
                        quantity=1.0,
                        remaining_quantity=0.0,
                        exit_time=trade_time,
                        exit_price=101.0,
                        realized_pnl=10.0 if trade_index % 2 == 0 else -5.0,
                        r_multiple=2.0 if trade_index % 2 == 0 else -1.0,
                        strategy_name=f"Strategy {trade_index % 5}",
                    )
                )

        db.commit()
        return user.id, session.id


def benchmark(fn, db, user_id: int, session_id: int, *, iterations: int) -> tuple[object, list[float]]:
    samples: list[float] = []
    result = None
    for _ in range(5):
        result = fn(db, user_id, session_id)
    for _ in range(iterations):
        started_at = time.perf_counter()
        result = fn(db, user_id, session_id)
        samples.append((time.perf_counter() - started_at) * 1000)
    return result, samples


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compare summary, curves, and full metrics payload costs for a replay session."
    )
    parser.add_argument("--sessions", type=int, default=DEFAULT_SESSIONS)
    parser.add_argument("--trades-per-session", type=int, default=DEFAULT_TRADES_PER_SESSION)
    parser.add_argument("--iterations", type=int, default=DEFAULT_ITERATIONS)
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="edgelab-metrics-bench-") as temp_dir:
        temp_root = Path(temp_dir)
        engine = create_engine(
            f"sqlite:///{temp_root / 'benchmark.db'}",
            connect_args={"check_same_thread": False},
        )
        session_factory = sessionmaker(bind=engine)
        Base.metadata.create_all(engine)
        user_id, session_id = seed_workload(
            session_factory,
            sessions=args.sessions,
            trades_per_session=args.trades_per_session,
        )

        with session_factory() as db:
            summary, summary_samples = benchmark(
                get_metrics_summary,
                db,
                user_id,
                session_id,
                iterations=args.iterations,
            )
            curves, curves_samples = benchmark(
                get_metrics_curves,
                db,
                user_id,
                session_id,
                iterations=args.iterations,
            )
            metrics, full_samples = benchmark(
                get_metrics,
                db,
                user_id,
                session_id,
                iterations=args.iterations,
            )

    summary_size = len(summary.model_dump_json().encode("utf-8"))
    curves_size = len(curves.model_dump_json().encode("utf-8"))
    full_size = len(metrics.model_dump_json().encode("utf-8"))

    print(f"Trades seeded: {args.sessions * args.trades_per_session}")
    print(f"Iterations: {args.iterations}")
    print()
    print(f"Summary mean: {statistics.mean(summary_samples):.2f} ms")
    print(f"Summary p95:  {percentile(summary_samples, 0.95):.2f} ms")
    print(f"Summary size: {summary_size} bytes")
    print()
    print(f"Curves mean:  {statistics.mean(curves_samples):.2f} ms")
    print(f"Curves p95:   {percentile(curves_samples, 0.95):.2f} ms")
    print(f"Curves size:  {curves_size} bytes")
    print()
    print(f"Full mean:    {statistics.mean(full_samples):.2f} ms")
    print(f"Full p95:     {percentile(full_samples, 0.95):.2f} ms")
    print(f"Full size:    {full_size} bytes")


if __name__ == "__main__":
    main()
