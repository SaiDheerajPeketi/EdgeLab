from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import pandas as pd
from sqlalchemy import asc, func, select
from sqlalchemy.orm import sessionmaker

from app.models import DatasetAsset, DatasetCandle, DatasetTimeframe
from app.schemas import BarsResponse, Candle, DatasetMeta
from app.services.market_data import DEFAULT_WARMUP, MAX_LIMIT


SOURCE_TIMESTAMP_FORMAT = "%Y-%m-%d %H:%M:%S"


class StoredMarketDataService:
    def __init__(
        self,
        asset_id: str,
        timeframe: str,
        session_factory: sessionmaker,
    ):
        self.asset_id = asset_id
        self.timeframe = timeframe
        self.session_factory = session_factory

    def get_metadata(self) -> DatasetMeta:
        with self.session_factory() as db:
            timeframe = self._timeframe_or_none(db)
            if timeframe is None:
                return DatasetMeta(
                    csv_path=f"stored://{self.asset_id}/{self.timeframe}",
                    rows=0,
                    first_timestamp=None,
                    last_timestamp=None,
                )
            asset = self._asset_or_none(db)
            source_timezone = asset.timezone if asset else "UTC"
            return DatasetMeta(
                csv_path=timeframe.csv_path,
                rows=timeframe.rows,
                first_timestamp=parse_source_timestamp(timeframe.first_timestamp, source_timezone),
                last_timestamp=parse_source_timestamp(timeframe.last_timestamp, source_timezone),
            )

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
        nrows = limit + warmup_rows

        with self.session_factory() as db:
            asset = self._asset_or_none(db)
            if asset is None:
                return BarsResponse(offset=offset, limit=limit, next_offset=offset, bars=[])
            rows = list(
                db.scalars(
                    select(DatasetCandle)
                    .where(
                        DatasetCandle.asset_id == self.asset_id,
                        DatasetCandle.timeframe == self.timeframe,
                    )
                    .order_by(asc(DatasetCandle.timestamp), asc(DatasetCandle.id))
                    .offset(start)
                    .limit(nrows)
                )
            )

        if not rows:
            return BarsResponse(offset=offset, limit=limit, next_offset=offset, bars=[])

        frame = pd.DataFrame(
            {
                "Timestamp": [row.timestamp for row in rows],
                "Open": [row.open for row in rows],
                "High": [row.high for row in rows],
                "Low": [row.low for row in rows],
                "Close": [row.close for row in rows],
                "Volume": [row.volume for row in rows],
            }
        )
        frame = with_indicators(frame)
        visible = frame.iloc[warmup_rows : warmup_rows + limit]
        bars = [row_to_candle(row, asset.timezone) for _, row in visible.iterrows()]
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
        with self.session_factory() as db:
            asset = self._asset_or_none(db)
            if asset is None:
                return None
            source_key = format_source_key(timestamp, asset.timezone)
            exists = db.scalar(
                select(DatasetCandle.id)
                .where(
                    DatasetCandle.asset_id == self.asset_id,
                    DatasetCandle.timeframe == self.timeframe,
                    DatasetCandle.timestamp >= source_key,
                )
                .order_by(asc(DatasetCandle.timestamp), asc(DatasetCandle.id))
                .limit(1)
            )
            if exists is None:
                return None
            return int(
                db.scalar(
                    select(func.count(DatasetCandle.id)).where(
                        DatasetCandle.asset_id == self.asset_id,
                        DatasetCandle.timeframe == self.timeframe,
                        DatasetCandle.timestamp < source_key,
                    )
                )
                or 0
            )

    def _asset_or_none(self, db) -> DatasetAsset | None:
        return db.scalar(select(DatasetAsset).where(DatasetAsset.id == self.asset_id))

    def _timeframe_or_none(self, db) -> DatasetTimeframe | None:
        return db.scalar(
            select(DatasetTimeframe).where(
                DatasetTimeframe.asset_id == self.asset_id,
                DatasetTimeframe.timeframe == self.timeframe,
            )
        )


def with_indicators(frame: pd.DataFrame) -> pd.DataFrame:
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


def row_to_candle(row: pd.Series, timestamp_timezone: str) -> Candle:
    dt = parse_source_timestamp(str(row["Timestamp"]), timestamp_timezone)
    if dt is None:
        raise ValueError("Stored candle is missing a timestamp")
    epoch = int(dt.timestamp())
    return Candle(
        time=epoch,
        timestamp=dt,
        open=float(row["Open"]),
        high=float(row["High"]),
        low=float(row["Low"]),
        close=float(row["Close"]),
        volume=float(row["Volume"]),
        ema_20=optional_float(row["ema_20"]),
        ema_50=optional_float(row["ema_50"]),
        rsi_14=optional_float(row["rsi_14"]),
    )


def optional_float(value: object) -> float | None:
    if pd.isna(value):
        return None
    return float(value)


def parse_source_timestamp(value: str | None, timestamp_timezone: str) -> datetime | None:
    if not value:
        return None
    parsed = datetime.strptime(value, SOURCE_TIMESTAMP_FORMAT)
    try:
        source_timezone = ZoneInfo(timestamp_timezone or "UTC")
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"Unknown timestamp timezone: {timestamp_timezone}") from exc
    return parsed.replace(tzinfo=source_timezone).astimezone(timezone.utc)


def format_source_key(value: datetime, timestamp_timezone: str) -> str:
    try:
        source_timezone = ZoneInfo(timestamp_timezone or "UTC")
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"Unknown timestamp timezone: {timestamp_timezone}") from exc
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(source_timezone).replace(tzinfo=None).strftime(SOURCE_TIMESTAMP_FORMAT)
