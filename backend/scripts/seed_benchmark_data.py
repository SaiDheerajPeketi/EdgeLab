from __future__ import annotations

import argparse
import json
from datetime import timedelta
from pathlib import Path
from secrets import token_urlsafe

from fastapi import HTTPException
from sqlalchemy import create_engine, delete, select
from sqlalchemy.orm import sessionmaker

from app.auth import create_session_token
from app.config import settings
from app.db import Base
from app.models import BacktestSession, BetaSession, BetaUser, DatasetAsset, DatasetTimeframe, Trade, utcnow
from app.services.datasets import TIMEFRAME_ORDER


DEFAULT_USERS = 10
DEFAULT_ASSETS = 100
DEFAULT_TIMEFRAMES = 6
DEFAULT_SESSIONS_PER_USER = 500
DEFAULT_TRADES_PER_SESSION = 10
DEFAULT_EMAIL_PREFIX = "benchmark-user"
DEFAULT_SESSION_TTL_DAYS = 7


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Seed benchmark users, dataset catalog rows, replay sessions, and closed trades."
    )
    parser.add_argument("--database-url", default=settings.database_url)
    parser.add_argument("--dataset-root", default=str(settings.datasets_root))
    parser.add_argument("--users", type=int, default=DEFAULT_USERS)
    parser.add_argument("--assets", type=int, default=DEFAULT_ASSETS)
    parser.add_argument("--timeframes", type=int, default=DEFAULT_TIMEFRAMES)
    parser.add_argument("--sessions-per-user", type=int, default=DEFAULT_SESSIONS_PER_USER)
    parser.add_argument("--trades-per-session", type=int, default=DEFAULT_TRADES_PER_SESSION)
    parser.add_argument("--email-prefix", default=DEFAULT_EMAIL_PREFIX)
    parser.add_argument("--session-ttl-days", type=int, default=DEFAULT_SESSION_TTL_DAYS)
    parser.add_argument("--reset", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    dataset_root = Path(args.dataset_root)
    engine = create_engine(args.database_url, connect_args=_sqlite_connect_args(args.database_url))
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)

    timeframe_names = list(TIMEFRAME_ORDER)[: max(min(args.timeframes, len(TIMEFRAME_ORDER)), 1)]
    dataset_root.mkdir(parents=True, exist_ok=True)

    with session_factory() as db:
        if args.reset:
            reset_seeded_users(db, args.email_prefix)

        catalog_blueprint = build_catalog_blueprint(dataset_root, args.assets, timeframe_names)
        seeded_users = []
        for user_index in range(args.users):
            seeded_users.append(
                seed_user_workload(
                    db,
                    user_index=user_index,
                    email_prefix=args.email_prefix,
                    timeframe_names=timeframe_names,
                    catalog_blueprint=catalog_blueprint,
                    sessions_per_user=args.sessions_per_user,
                    trades_per_session=args.trades_per_session,
                    session_ttl_days=args.session_ttl_days,
                )
            )

        db.commit()

    print(
        json.dumps(
            {
                "database_url": args.database_url,
                "dataset_root": str(dataset_root),
                "users_seeded": len(seeded_users),
                "assets_per_user": args.assets,
                "timeframes_per_asset": len(timeframe_names),
                "sessions_per_user": args.sessions_per_user,
                "trades_per_session": args.trades_per_session,
                "auth_tokens": seeded_users,
            },
            indent=2,
        )
    )


def _sqlite_connect_args(database_url: str) -> dict[str, bool]:
    return {"check_same_thread": False} if database_url.startswith("sqlite") else {}


def reset_seeded_users(db, email_prefix: str) -> None:
    users = db.scalars(select(BetaUser).where(BetaUser.email.like(f"{email_prefix}+%@edgelab.local"))).all()
    for user in users:
        db.execute(delete(BetaSession).where(BetaSession.user_id == user.id))
        db.delete(user)
    db.flush()


def build_catalog_blueprint(dataset_root: Path, assets: int, timeframe_names: list[str]) -> list[dict[str, object]]:
    blueprint: list[dict[str, object]] = []
    for asset_index in range(assets):
        asset_key = f"PAIR_{asset_index:04d}"
        folder_path = dataset_root / asset_key
        timeframes = []
        for timeframe in timeframe_names:
            csv_path = folder_path / f"{asset_key}_{timeframe}.csv"
            timeframes.append(
                {
                    "timeframe": timeframe,
                    "csv_path": str(csv_path),
                }
            )
        blueprint.append(
            {
                "asset_key": asset_key,
                "name": f"PAIR/{asset_index:04d}",
                "symbol": f"PAIR{asset_index:04d}",
                "folder_path": str(folder_path),
                "timeframes": timeframes,
            }
        )
    return blueprint


def seed_user_workload(
    db,
    *,
    user_index: int,
    email_prefix: str,
    timeframe_names: list[str],
    catalog_blueprint: list[dict[str, object]],
    sessions_per_user: int,
    trades_per_session: int,
    session_ttl_days: int,
) -> dict[str, object]:
    user = BetaUser(
        email=f"{email_prefix}+{user_index:03d}@edgelab.local",
        name=f"Benchmark User {user_index:03d}",
        provider="email",
        status="APPROVED",
        beta_position=user_index + 1,
        last_login_at=utcnow(),
    )
    db.add(user)
    db.flush()

    timeframe_rows: list[dict[str, object]] = []
    for asset_blueprint in catalog_blueprint:
        asset = DatasetAsset(
            user_id=user.id,
            asset_key=str(asset_blueprint["asset_key"]),
            name=str(asset_blueprint["name"]),
            symbol=str(asset_blueprint["symbol"]),
            folder_path=str(asset_blueprint["folder_path"]),
            currency="USD",
            timezone="UTC",
            pnl_multiplier=1.0,
        )
        db.add(asset)
        db.flush()
        for timeframe_blueprint in asset_blueprint["timeframes"]:
            dataset_timeframe = DatasetTimeframe(
                user_id=user.id,
                asset_id=asset.id,
                timeframe=str(timeframe_blueprint["timeframe"]),
                csv_path=str(timeframe_blueprint["csv_path"]),
                rows=500_000,
                first_timestamp="2024-01-01 00:00:00",
                last_timestamp="2024-12-31 23:59:00",
                file_size=64_000_000,
                file_mtime_ns=1_717_205_600_000_000_000,
                imported=False,
            )
            db.add(dataset_timeframe)
            db.flush()
            timeframe_rows.append(
                {
                    "symbol": asset.symbol,
                    "csv_path": dataset_timeframe.csv_path,
                    "timeframe": dataset_timeframe.timeframe,
                }
            )

    sessions = []
    now = utcnow()
    for session_index in range(sessions_per_user):
        timeframe_row = timeframe_rows[session_index % len(timeframe_rows)]
        session = BacktestSession(
            user_id=user.id,
            name=f"Benchmark Session {user_index:03d}-{session_index:04d}",
            symbol=str(timeframe_row["symbol"]),
            instrument=str(timeframe_row["symbol"]),
            timeframe=str(timeframe_row["timeframe"]),
            csv_path=str(timeframe_row["csv_path"]),
            currency="USD",
            timezone="UTC",
            pnl_multiplier=1.0,
            strategy_name=f"Strategy {session_index % 5}",
            current_offset=0,
            replay_ready=True,
            created_at=now - timedelta(minutes=session_index),
            updated_at=now - timedelta(minutes=session_index),
        )
        db.add(session)
        db.flush()
        sessions.append(session)

        for trade_index in range(trades_per_session):
            entry_time = now - timedelta(minutes=(session_index * trades_per_session) + trade_index + 5)
            exit_time = entry_time + timedelta(minutes=5)
            realized_pnl = 15.0 if trade_index % 2 == 0 else -7.5
            db.add(
                Trade(
                    user_id=user.id,
                    session_id=session.id,
                    status="CLOSED",
                    side="LONG" if trade_index % 2 == 0 else "SHORT",
                    entry_time=entry_time,
                    entry_offset=trade_index,
                    entry_price=1.2,
                    quantity=1.0,
                    remaining_quantity=0.0,
                    exit_time=exit_time,
                    exit_offset=trade_index + 1,
                    exit_price=1.3,
                    realized_pnl=realized_pnl,
                    r_multiple=2.0 if trade_index % 2 == 0 else -1.0,
                )
            )

    beta_session = BetaSession(
        id=token_urlsafe(24),
        user_id=user.id,
        expires_at=utcnow() + timedelta(days=session_ttl_days),
    )
    db.add(beta_session)
    db.flush()

    try:
        token = create_session_token(user.id, beta_session.id, beta_session.expires_at)
    except HTTPException as exc:
        raise SystemExit(
            "Unable to create benchmark auth token. Set EDGELAB_JWT_SECRET before seeding. "
            f"Backend returned: {exc.detail}"
        ) from exc

    return {
        "user_id": user.id,
        "email": user.email,
        "session_id": beta_session.id,
        "token": token,
        "latest_backtest_session_id": sessions[0].id if sessions else None,
        "sample_backtest_session_ids": [session.id for session in sessions[: min(len(sessions), 5)]],
        "assets": len(catalog_blueprint),
        "timeframes_per_asset": len(timeframe_names),
        "sessions": len(sessions),
        "trades": len(sessions) * trades_per_session,
    }


if __name__ == "__main__":
    main()
