from __future__ import annotations

import argparse
import json

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.services.market_data_imports import import_market_data_to_db as import_market_data_to_db_service


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import dataset timeframe CSV rows into database-backed market_candles storage."
    )
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--user-id", type=int, required=True)
    parser.add_argument("--instrument")
    parser.add_argument("--timeframe")
    parser.add_argument("--csv-path")
    parser.add_argument("--market-data-database-url")
    return parser.parse_args()


def import_market_data_to_db(
    session_factory: sessionmaker,
    *,
    user_id: int,
    instrument: str | None = None,
    timeframe: str | None = None,
    csv_path: str | None = None,
    market_data_session_factory: sessionmaker | None = None,
) -> dict[str, object]:
    with session_factory() as db:
        summary = import_market_data_to_db_service(
            db,
            user_id=user_id,
            instrument=instrument,
            timeframe=timeframe,
            csv_path=csv_path,
            market_data_session_factory=market_data_session_factory,
        )
        db.commit()
        return summary


def main() -> None:
    args = parse_args()
    engine = create_engine(
        args.database_url,
        connect_args={"check_same_thread": False} if args.database_url.startswith("sqlite") else {},
    )
    session_factory = sessionmaker(bind=engine)
    market_data_session_factory = None
    if args.market_data_database_url:
        market_data_engine = create_engine(
            args.market_data_database_url,
            connect_args={"check_same_thread": False}
            if args.market_data_database_url.startswith("sqlite")
            else {},
        )
        market_data_session_factory = sessionmaker(bind=market_data_engine)
    summary = import_market_data_to_db(
        session_factory,
        user_id=args.user_id,
        instrument=args.instrument,
        timeframe=args.timeframe,
        csv_path=args.csv_path,
        market_data_session_factory=market_data_session_factory,
    )
    print(json.dumps(summary, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
