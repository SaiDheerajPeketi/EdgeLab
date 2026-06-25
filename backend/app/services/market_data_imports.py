from __future__ import annotations

from pathlib import Path

import pandas as pd
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import DatasetTimeframe, MarketCandle, utcnow


IMPORT_BATCH_SIZE = 1000
REQUIRED_COLUMNS = ["Timestamp", "Open", "High", "Low", "Close", "Volume"]


def import_market_data_to_db(
    db: Session,
    *,
    user_id: int,
    instrument: str | None = None,
    timeframe: str | None = None,
    csv_path: str | None = None,
    pending_only: bool = False,
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

    for timeframe_row in timeframes:
        rows = _read_csv_rows(Path(timeframe_row.csv_path))
        db.execute(
            delete(MarketCandle).where(
                MarketCandle.user_id == user_id,
                MarketCandle.asset_id == timeframe_row.asset_id,
                MarketCandle.timeframe == timeframe_row.timeframe,
            )
        )
        for start in range(0, len(rows), IMPORT_BATCH_SIZE):
            db.add_all(
                [
                    MarketCandle(
                        user_id=user_id,
                        asset_id=timeframe_row.asset_id,
                        timeframe=timeframe_row.timeframe,
                        offset=index,
                        timestamp=row["Timestamp"].to_pydatetime().replace(tzinfo=None),
                        open=float(row["Open"]),
                        high=float(row["High"]),
                        low=float(row["Low"]),
                        close=float(row["Close"]),
                        volume=float(row["Volume"]),
                    )
                    for index, row in rows[start : start + IMPORT_BATCH_SIZE]
                ]
            )
            db.flush()
        timeframe_row.rows = len(rows)
        timeframe_row.first_timestamp = rows[0][1]["Timestamp"].strftime("%Y-%m-%d %H:%M:%S") if rows else None
        timeframe_row.last_timestamp = rows[-1][1]["Timestamp"].strftime("%Y-%m-%d %H:%M:%S") if rows else None
        timeframe_row.database_imported = True
        timeframe_row.database_imported_at = utcnow()
        total_candles += len(rows)
        imported.append(
            {
                "asset_id": timeframe_row.asset_id,
                "timeframe": timeframe_row.timeframe,
                "csv_path": timeframe_row.csv_path,
                "rows": len(rows),
            }
        )

    return {
        "ok": True,
        "imported": imported,
        "candles": total_candles,
    }


def _read_csv_rows(csv_path: Path) -> list[tuple[int, dict[str, object]]]:
    frame = pd.read_csv(csv_path, parse_dates=["Timestamp"], date_format="mixed")
    missing = [column for column in REQUIRED_COLUMNS if column not in frame.columns]
    if missing:
        raise ValueError(f"CSV is missing required columns: {', '.join(missing)}")
    return list(enumerate(frame.to_dict(orient="records")))
