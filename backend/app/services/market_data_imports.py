from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
from pathlib import Path

import pandas as pd
from sqlalchemy import delete, func, insert, select, text
from sqlalchemy.orm import Session, sessionmaker

from app.market_data_db import ensure_market_data_schema
from app.models import DatasetTimeframe, MarketCandle, utcnow


IMPORT_BATCH_SIZE = 1000
REQUIRED_COLUMNS = ["Timestamp", "Open", "High", "Low", "Close", "Volume"]


@dataclass(frozen=True)
class ExistingImportState:
    rows: int
    first_timestamp: datetime | None
    last_timestamp: datetime | None


def import_market_data_to_db(
    db: Session,
    *,
    user_id: int,
    instrument: str | None = None,
    timeframe: str | None = None,
    csv_path: str | None = None,
    pending_only: bool = False,
    market_data_session_factory: sessionmaker | None = None,
) -> dict[str, object]:
    imported = []
    total_candles = 0
    query = select(DatasetTimeframe).where(DatasetTimeframe.user_id == user_id)
    if timeframe is not None:
        query = query.where(DatasetTimeframe.timeframe == timeframe)
    if csv_path is not None:
        query = query.where(DatasetTimeframe.csv_path == csv_path)
    if pending_only:
        query = query.where(DatasetTimeframe.database_imported.is_(False))
    timeframes = db.scalars(query).all()
    if instrument is not None:
        normalized = instrument.replace("/", "_").upper()
        timeframes = [
            row
            for row in timeframes
            if row.asset is not None
            and (
                row.asset.asset_key.replace("/", "_").upper() == normalized
                or row.asset.symbol.replace("/", "_").upper() == normalized
                or row.asset.name.replace("/", "_").upper() == normalized
            )
        ]

    market_db, owns_market_db = _market_data_session(db, market_data_session_factory)
    try:
        _ensure_market_candle_table(market_db)
        _lock_imports(market_db, user_id, timeframes)
        for timeframe_row in timeframes:
            frame = _read_csv_frame(Path(timeframe_row.csv_path))
            existing = _existing_import_state(
                market_db,
                user_id=user_id,
                asset_id=timeframe_row.asset_id,
                timeframe=timeframe_row.timeframe,
            )
            start_index = _append_start_index(frame, existing)
            if start_index is None:
                market_db.execute(
                    delete(MarketCandle).where(
                        MarketCandle.user_id == user_id,
                        MarketCandle.asset_id == timeframe_row.asset_id,
                        MarketCandle.timeframe == timeframe_row.timeframe,
                    )
                )
                start_index = 0

            for start in range(start_index, len(frame), IMPORT_BATCH_SIZE):
                market_db.execute(
                    insert(MarketCandle.__table__),
                    [
                        {
                            "user_id": user_id,
                            "asset_id": timeframe_row.asset_id,
                            "timeframe": timeframe_row.timeframe,
                            "offset": start + index,
                            "timestamp": timestamp.to_pydatetime().replace(tzinfo=None),
                            "open": float(open_price),
                            "high": float(high),
                            "low": float(low),
                            "close": float(close),
                            "volume": float(volume),
                        }
                        for index, (timestamp, open_price, high, low, close, volume) in enumerate(
                            frame.iloc[start : start + IMPORT_BATCH_SIZE].itertuples(index=False, name=None)
                        )
                    ],
                )
            timeframe_row.rows = len(frame)
            timeframe_row.first_timestamp = (
                frame.iloc[0]["Timestamp"].strftime("%Y-%m-%d %H:%M:%S")
                if not frame.empty
                else None
            )
            timeframe_row.last_timestamp = (
                frame.iloc[-1]["Timestamp"].strftime("%Y-%m-%d %H:%M:%S")
                if not frame.empty
                else None
            )
            timeframe_row.database_imported = True
            timeframe_row.database_imported_at = utcnow()
            imported_rows = len(frame) - start_index
            total_candles += imported_rows
            imported.append(
                {
                    "asset_id": timeframe_row.asset_id,
                    "timeframe": timeframe_row.timeframe,
                    "csv_path": timeframe_row.csv_path,
                    "rows": len(frame),
                    "imported_rows": imported_rows,
                    "mode": "append" if start_index > 0 else "replace",
                }
            )
        if owns_market_db:
            market_db.commit()
    except Exception:
        if owns_market_db:
            market_db.rollback()
        raise
    finally:
        if owns_market_db:
            market_db.close()

    return {
        "ok": True,
        "imported": imported,
        "candles": total_candles,
    }


def _read_csv_frame(csv_path: Path) -> pd.DataFrame:
    frame = pd.read_csv(csv_path, parse_dates=["Timestamp"], date_format="mixed")
    missing = [column for column in REQUIRED_COLUMNS if column not in frame.columns]
    if missing:
        raise ValueError(f"CSV is missing required columns: {', '.join(missing)}")
    return frame[REQUIRED_COLUMNS]


def _lock_imports(db: Session, user_id: int, timeframes: list[DatasetTimeframe]) -> None:
    if db.get_bind().dialect.name != "postgresql":
        return
    # All callers share these locks on the transaction that writes candles.
    # Sorting prevents opposing multi-timeframe imports from deadlocking.
    keys = {
        int.from_bytes(
            sha256(f"edgelab:market-import:{user_id}:{row.asset_id}:{row.timeframe}".encode()).digest()[:8],
            "big", signed=True,
        )
        for row in timeframes
    }
    for key in sorted(keys):
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})


def _existing_import_state(
    db: Session,
    *,
    user_id: int,
    asset_id: int,
    timeframe: str,
) -> ExistingImportState:
    rows, first_timestamp, last_timestamp = db.execute(
        select(
            func.count(MarketCandle.id),
            func.min(MarketCandle.timestamp),
            func.max(MarketCandle.timestamp),
        ).where(
            MarketCandle.user_id == user_id,
            MarketCandle.asset_id == asset_id,
            MarketCandle.timeframe == timeframe,
        )
    ).one()
    return ExistingImportState(
        rows=int(rows or 0),
        first_timestamp=first_timestamp,
        last_timestamp=last_timestamp,
    )


def _market_data_session(
    db: Session,
    session_factory: sessionmaker | None,
) -> tuple[Session, bool]:
    if session_factory is None or session_factory.kw.get("bind") is db.get_bind():
        return db, False
    return session_factory(), True


def _ensure_market_candle_table(db: Session) -> None:
    ensure_market_data_schema(db.get_bind())


def _append_start_index(
    frame: pd.DataFrame,
    existing: ExistingImportState,
) -> int | None:
    if existing.rows <= 0:
        return 0
    if existing.rows > len(frame):
        return None
    if existing.first_timestamp is None or existing.last_timestamp is None:
        return None
    if frame.empty:
        return None

    first_timestamp = _row_timestamp(frame.iloc[0])
    last_prefix_timestamp = _row_timestamp(frame.iloc[existing.rows - 1])
    if first_timestamp != existing.first_timestamp:
        return None
    if last_prefix_timestamp != existing.last_timestamp:
        return None
    return existing.rows


def _row_timestamp(row: pd.Series) -> datetime:
    value = row["Timestamp"]
    return value.to_pydatetime().replace(tzinfo=None)
