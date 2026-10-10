from __future__ import annotations

from datetime import datetime, timezone
from threading import Lock
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import pandas as pd
from sqlalchemy import asc, select
from sqlalchemy.orm import Session, sessionmaker

from app.models import DatasetTimeframe, MarketCandle
from app.schemas import BarsResponse, Candle, DatasetMeta
from app.services.candle_frames import frame_to_candles


MAX_LIMIT = 5_000
DEFAULT_WARMUP = 120


class DatabaseMarketDataService:
    def __init__(
        self,
        metadata_session_factory: sessionmaker,
        market_data_session_factory: sessionmaker,
        *,
        user_id: int,
        asset_id: int,
        timeframe: str,
        csv_path: str,
        timestamp_timezone: str = "UTC",
    ):
        self.metadata_session_factory = metadata_session_factory
        self.market_data_session_factory = market_data_session_factory
        self.user_id = user_id
        self.asset_id = asset_id
        self.timeframe = timeframe
        self.csv_path = csv_path
        self.timestamp_timezone = timestamp_timezone or "UTC"
        self._frame: pd.DataFrame | None = None
        self._metadata: DatasetMeta | None = None
        self._source_signature: tuple[int, str | None, str | None] | None = None
        self._lock = Lock()

    def get_metadata(self) -> DatasetMeta:
        if self._metadata is not None and not self.source_has_changed():
            return self._metadata

        with self.metadata_session_factory() as db:
            timeframe_row = self._timeframe_row(db)
            if timeframe_row is None or not timeframe_row.database_imported:
                raise FileNotFoundError("Database-backed market data is unavailable for this dataset")
            self._metadata = DatasetMeta(
                csv_path=self.csv_path,
                rows=timeframe_row.rows,
                first_timestamp=self._parse_timestamp(timeframe_row.first_timestamp),
                last_timestamp=self._parse_timestamp(timeframe_row.last_timestamp),
            )
            self._source_signature = self._signature_for_row(timeframe_row)
            return self._metadata

    def validate_source(self) -> None:
        self.get_metadata()

    def get_bars(
        self,
        offset: int = 0,
        limit: int = 300,
        warmup: int = DEFAULT_WARMUP,
    ) -> BarsResponse:
        if offset < 0:
            raise ValueError("offset must be greater than or equal to 0")
        if limit < 1 or limit > MAX_LIMIT:
            raise ValueError(f"limit must be between 1 and {MAX_LIMIT}")

        frame, visible_start = self._get_window_frame(offset, limit, warmup)
        if frame.empty:
            return BarsResponse(offset=offset, limit=limit, next_offset=offset, bars=[])

        visible = frame.iloc[visible_start : visible_start + limit]
        bars = frame_to_candles(visible, self._local_to_utc)
        return BarsResponse(
            offset=offset,
            limit=limit,
            next_offset=offset + len(bars),
            bars=bars,
        )

    def get_candle(self, offset: int) -> Candle | None:
        if offset < 0:
            raise ValueError("offset must be greater than or equal to 0")
        with self.market_data_session_factory() as db:
            row = db.scalar(
                select(MarketCandle).where(
                    MarketCandle.user_id == self.user_id,
                    MarketCandle.asset_id == self.asset_id,
                    MarketCandle.timeframe == self.timeframe,
                    MarketCandle.offset == offset,
                )
            )
        return self._model_to_candle(row) if row is not None else None

    def find_offset_at_or_after(self, timestamp: datetime) -> int | None:
        target = self._to_source_naive(timestamp)
        with self.market_data_session_factory() as db:
            candle = db.scalar(
                select(MarketCandle)
                .where(
                    MarketCandle.user_id == self.user_id,
                    MarketCandle.asset_id == self.asset_id,
                    MarketCandle.timeframe == self.timeframe,
                    MarketCandle.timestamp >= target,
                )
                .order_by(asc(MarketCandle.timestamp), asc(MarketCandle.offset))
                .limit(1)
            )
        return candle.offset if candle is not None else None

    def _get_window_frame(
        self,
        offset: int,
        limit: int,
        warmup: int,
    ) -> tuple[pd.DataFrame, int]:
        metadata = self.get_metadata()
        if offset >= metadata.rows:
            return pd.DataFrame(), 0

        warmup_start = max(0, offset - max(warmup, 0))
        visible_start = offset - warmup_start
        fetch_limit = visible_start + limit
        with self.market_data_session_factory() as db:
            rows = db.scalars(
                select(MarketCandle)
                .where(
                    MarketCandle.user_id == self.user_id,
                    MarketCandle.asset_id == self.asset_id,
                    MarketCandle.timeframe == self.timeframe,
                    MarketCandle.offset >= warmup_start,
                )
                .order_by(asc(MarketCandle.offset))
                .limit(fetch_limit)
            ).all()
        frame = self._rows_to_frame(rows)
        return (_with_indicators(frame) if not frame.empty else frame), visible_start

    def source_has_changed(self) -> bool:
        if self._frame is None and self._metadata is None:
            return False
        with self.metadata_session_factory() as db:
            timeframe_row = self._timeframe_row(db)
            if timeframe_row is None or not timeframe_row.database_imported:
                return self._source_signature is not None
            return self._source_signature != self._signature_for_row(timeframe_row)

    def _get_frame(self) -> pd.DataFrame:
        if self._frame is not None and not self.source_has_changed():
            return self._frame

        with self._lock:
            if self._frame is not None and not self.source_has_changed():
                return self._frame
            with self.metadata_session_factory() as db:
                timeframe_row = self._timeframe_row(db)
                if timeframe_row is None or not timeframe_row.database_imported:
                    raise FileNotFoundError("Database-backed market data is unavailable for this dataset")
            with self.market_data_session_factory() as db:
                rows = db.scalars(
                    select(MarketCandle)
                    .where(
                        MarketCandle.user_id == self.user_id,
                        MarketCandle.asset_id == self.asset_id,
                        MarketCandle.timeframe == self.timeframe,
                    )
                    .order_by(asc(MarketCandle.offset))
                ).all()
            frame = self._rows_to_frame(rows)
            self._frame = _with_indicators(frame) if not frame.empty else frame
            self._metadata = DatasetMeta(
                csv_path=self.csv_path,
                rows=timeframe_row.rows,
                first_timestamp=self._parse_timestamp(timeframe_row.first_timestamp),
                last_timestamp=self._parse_timestamp(timeframe_row.last_timestamp),
            )
            self._source_signature = self._signature_for_row(timeframe_row)
            return self._frame

    def _rows_to_frame(self, rows: list[MarketCandle]) -> pd.DataFrame:
        return pd.DataFrame(
            [
                {
                    "Timestamp": row.timestamp,
                    "Open": row.open,
                    "High": row.high,
                    "Low": row.low,
                    "Close": row.close,
                    "Volume": row.volume,
                }
                for row in rows
            ]
        )

    def _timeframe_row(self, db: Session) -> DatasetTimeframe | None:
        return db.scalar(
            select(DatasetTimeframe).where(
                DatasetTimeframe.user_id == self.user_id,
                DatasetTimeframe.asset_id == self.asset_id,
                DatasetTimeframe.timeframe == self.timeframe,
            )
        )

    def _signature_for_row(
        self,
        timeframe_row: DatasetTimeframe,
    ) -> tuple[int, str | None, str | None]:
        imported_at = (
            timeframe_row.database_imported_at.isoformat()
            if timeframe_row.database_imported_at is not None
            else None
        )
        return (
            int(timeframe_row.rows or 0),
            imported_at,
            timeframe_row.last_timestamp,
        )

    def _model_to_candle(self, row: MarketCandle) -> Candle:
        epoch = int(self._local_to_utc(row.timestamp).timestamp())
        return Candle(
            time=epoch,
            timestamp=row.timestamp,
            open=float(row.open),
            high=float(row.high),
            low=float(row.low),
            close=float(row.close),
            volume=float(row.volume),
        )

    def _parse_timestamp(self, value: str | None) -> datetime | None:
        if not value:
            return None
        parsed = datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
        try:
            source_timezone = ZoneInfo(self.timestamp_timezone)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"Unknown timestamp timezone: {self.timestamp_timezone}") from exc
        return parsed.replace(tzinfo=source_timezone).astimezone(timezone.utc)

    def _local_to_utc(self, value: datetime) -> datetime:
        if value.tzinfo is not None:
            return value.astimezone(timezone.utc)
        try:
            source_timezone = ZoneInfo(self.timestamp_timezone)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"Unknown timestamp timezone: {self.timestamp_timezone}") from exc
        return value.replace(tzinfo=source_timezone).astimezone(timezone.utc)

    def _to_source_naive(self, value: datetime) -> datetime:
        try:
            source_timezone = ZoneInfo(self.timestamp_timezone)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"Unknown timestamp timezone: {self.timestamp_timezone}") from exc
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(source_timezone).replace(tzinfo=None)


def _with_indicators(frame: pd.DataFrame) -> pd.DataFrame:
    close = frame["Close"].astype(float)
    frame["ema_20"] = close.ewm(span=20, adjust=False).mean()
    frame["ema_50"] = close.ewm(span=50, adjust=False).mean()

    delta = close.diff()
    gains = delta.clip(lower=0)
    losses = -delta.clip(upper=0)
    avg_gain = gains.ewm(alpha=1 / 14, min_periods=14, adjust=False).mean()
    avg_loss = losses.ewm(alpha=1 / 14, min_periods=14, adjust=False).mean()
    relative_strength = avg_gain / avg_loss.replace(0, pd.NA)
    frame["rsi_14"] = 100 - (100 / (1 + relative_strength))
    return frame
