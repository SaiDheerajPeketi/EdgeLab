from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import pandas as pd
from sqlalchemy import asc, select
from sqlalchemy.orm import sessionmaker

from app.models import DatasetTimeframe, MarketCandle
from app.schemas import BarsResponse, Candle, DatasetMeta


MAX_LIMIT = 5_000
DEFAULT_WARMUP = 120


class DatabaseMarketDataService:
    def __init__(
        self,
        session_factory: sessionmaker,
        *,
        user_id: int,
        asset_id: int,
        timeframe: str,
        csv_path: str,
        timestamp_timezone: str = "UTC",
    ):
        self.session_factory = session_factory
        self.user_id = user_id
        self.asset_id = asset_id
        self.timeframe = timeframe
        self.csv_path = csv_path
        self.timestamp_timezone = timestamp_timezone or "UTC"

    def get_metadata(self) -> DatasetMeta:
        with self.session_factory() as db:
            timeframe_row = db.scalar(
                select(DatasetTimeframe).where(
                    DatasetTimeframe.user_id == self.user_id,
                    DatasetTimeframe.asset_id == self.asset_id,
                    DatasetTimeframe.timeframe == self.timeframe,
                )
            )
            if timeframe_row is None or not timeframe_row.database_imported:
                raise FileNotFoundError("Database-backed market data is unavailable for this dataset")
            return DatasetMeta(
                csv_path=self.csv_path,
                rows=timeframe_row.rows,
                first_timestamp=self._parse_timestamp(timeframe_row.first_timestamp),
                last_timestamp=self._parse_timestamp(timeframe_row.last_timestamp),
            )

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

        start = max(0, offset - max(warmup, 0))
        warmup_rows = offset - start
        query_limit = limit + warmup_rows

        with self.session_factory() as db:
            rows = db.scalars(
                select(MarketCandle)
                .where(
                    MarketCandle.user_id == self.user_id,
                    MarketCandle.asset_id == self.asset_id,
                    MarketCandle.timeframe == self.timeframe,
                    MarketCandle.offset >= start,
                    MarketCandle.offset < start + query_limit,
                )
                .order_by(asc(MarketCandle.offset))
            ).all()

        if not rows:
            return BarsResponse(offset=offset, limit=limit, next_offset=offset, bars=[])

        frame = pd.DataFrame(
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
        frame = _with_indicators(frame)
        visible = frame.iloc[warmup_rows : warmup_rows + limit]
        bars = [self._row_to_candle(row) for _, row in visible.iterrows()]
        return BarsResponse(
            offset=offset,
            limit=limit,
            next_offset=offset + len(bars),
            bars=bars,
        )

    def get_candle(self, offset: int) -> Candle | None:
        if offset < 0:
            raise ValueError("offset must be greater than or equal to 0")
        response = self.get_bars(offset=offset, limit=1, warmup=DEFAULT_WARMUP)
        return response.bars[0] if response.bars else None

    def find_offset_at_or_after(self, timestamp: datetime) -> int | None:
        target = self._to_source_naive(timestamp)
        with self.session_factory() as db:
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

    def source_has_changed(self) -> bool:
        return False

    def _row_to_candle(self, row: pd.Series) -> Candle:
        timestamp = row["Timestamp"]
        if isinstance(timestamp, pd.Timestamp):
            dt = timestamp.to_pydatetime()
        else:
            dt = timestamp
        epoch = int(self._local_to_utc(dt).timestamp())
        return Candle(
            time=epoch,
            timestamp=dt,
            open=float(row["Open"]),
            high=float(row["High"]),
            low=float(row["Low"]),
            close=float(row["Close"]),
            volume=float(row["Volume"]),
            ema_20=_optional_float(row["ema_20"]),
            ema_50=_optional_float(row["ema_50"]),
            rsi_14=_optional_float(row["rsi_14"]),
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


def _optional_float(value: object) -> float | None:
    if pd.isna(value):
        return None
    return float(value)
