from __future__ import annotations

from sqlalchemy import select
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import BetaSession
from backend.scripts.seed_benchmark_data import build_catalog_blueprint, seed_user_workload


def test_seed_user_workload_exposes_sample_backtest_session_ids(tmp_path, monkeypatch):
    dataset_root = tmp_path / "datasets"
    dataset_root.mkdir()

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    blueprint = build_catalog_blueprint(dataset_root, assets=2, timeframe_names=["M1", "M5"])

    monkeypatch.setattr(
        "backend.scripts.seed_benchmark_data.create_session_token",
        lambda user_id, session_id, expires_at: f"benchmark-token-{user_id}-{session_id}",
    )

    with session_factory() as db:
        seeded = seed_user_workload(
            db,
            user_index=0,
            email_prefix="benchmark-user",
            timeframe_names=["M1", "M5"],
            catalog_blueprint=blueprint,
            sessions_per_user=6,
            trades_per_session=2,
            session_ttl_days=7,
        )
        db.commit()

        assert seeded["latest_backtest_session_id"] is not None
        assert len(seeded["sample_backtest_session_ids"]) == 5
        assert seeded["latest_backtest_session_id"] == seeded["sample_backtest_session_ids"][0]
        assert all(isinstance(session_id, int) for session_id in seeded["sample_backtest_session_ids"])
        assert seeded["session_id"] == db.scalar(select(BetaSession.id).limit(1))
