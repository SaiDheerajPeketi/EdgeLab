from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

import pandas as pd

from app.schemas import BarsResponse, Candle, DatasetMeta


REQUIRED_COLUMNS = ["Timestamp", "Open", "High", "Low", "Close", "Volume"]
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"
MAX_LIMIT = 5_000
DEFAULT_WARMUP = 120


class MarketDataService:
    def __init__(self, csv_path: Path, cache: bool = True):
        self.csv_path = csv_path
        self.cache = cache
        self._frame: pd.DataFrame | None = None
        self._metadata: DatasetMeta | None = None
        self._lock = Lock()

    def get_metadata(self) -> DatasetMeta:
        if self._metadata is not None:
            return self._metadata
        if self.cache:
            frame = self._get_frame()
            self._metadata = DatasetMeta(
                csv_path=str(self.csv_path),
                rows=len(frame),
                first_timestamp=self._parse_timestamp(frame.iloc[0]["Timestamp"])
                if not frame.empty
                else None,
                last_timestamp=self._parse_timestamp(frame.iloc[-1]["Timestamp"])
                if not frame.empty
                else None,
            )
            return self._metadata

        self._ensure_csv_exists()
        first_row = pd.read_csv(self.csv_path, nrows=1)
        self._validate_columns(first_row)

        first_timestamp = self._parse_timestamp(first_row.iloc[0]["Timestamp"])
        last_timestamp = None
        last_line = self._read_last_data_line()
        if last_line:
            last_timestamp = self._parse_timestamp(last_line.split(",", 1)[0])

        self._metadata = DatasetMeta(
            csv_path=str(self.csv_path),
            rows=self._count_data_rows(),
            first_timestamp=first_timestamp,
            last_timestamp=last_timestamp,
        )
        return self._metadata

    def get_bars(
        self,
        offset: int = 0,
        limit: int = 300,
        warmup: int = DEFAULT_WARMUP,
    ) -> BarsResponse:
        self._ensure_csv_exists()
        if offset < 0:
            raise ValueError("offset must be greater than or equal to 0")
        if limit < 1 or limit > MAX_LIMIT:
            raise ValueError(f"limit must be between 1 and {MAX_LIMIT}")

        if self.cache:
            frame = self._get_frame()
            visible = frame.iloc[offset : offset + limit]
            bars = [self._row_to_candle(row) for _, row in visible.iterrows()]
            return BarsResponse(
                offset=offset,
                limit=limit,
                next_offset=offset + len(bars),
                bars=bars,
            )

        start = max(0, offset - max(warmup, 0))
        warmup_rows = offset - start
        nrows = limit + warmup_rows

        frame = pd.read_csv(
            self.csv_path,
            skiprows=range(1, start + 1),
            nrows=nrows,
            parse_dates=["Timestamp"],
            date_format=DATE_FORMAT,
        )
        if frame.empty:
            return BarsResponse(offset=offset, limit=limit, next_offset=offset, bars=[])

        self._validate_columns(frame)
        frame = self._with_indicators(frame)
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
        if self.cache:
            frame = self._get_frame()
            target = pd.Timestamp(timestamp.replace(tzinfo=None))
            positions = frame["Timestamp"].searchsorted(target, side="left")
            if positions >= len(frame):
                return None
            return int(positions)

        chunk_size = 200_000
        for chunk_index, frame in enumerate(
            pd.read_csv(
                self.csv_path,
                chunksize=chunk_size,
                parse_dates=["Timestamp"],
                date_format=DATE_FORMAT,
            )
        ):
            target = pd.Timestamp(timestamp.replace(tzinfo=None))
            positions = frame["Timestamp"].searchsorted(target, side="left")
            if positions < len(frame):
                return chunk_index * chunk_size + int(positions)
        return None

    def _get_frame(self) -> pd.DataFrame:
        if self._frame is not None:
            return self._frame

        with self._lock:
            if self._frame is None:
                self._ensure_csv_exists()
                frame = pd.read_csv(
                    self.csv_path,
                    parse_dates=["Timestamp"],
                    date_format=DATE_FORMAT,
                )
                self._validate_columns(frame)
                self._frame = self._with_indicators(frame)
        return self._frame

    def _with_indicators(self, frame: pd.DataFrame) -> pd.DataFrame:
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

    def _row_to_candle(self, row: pd.Series) -> Candle:
        timestamp = row["Timestamp"]
        if isinstance(timestamp, pd.Timestamp):
            dt = timestamp.to_pydatetime()
        else:
            dt = self._parse_timestamp(timestamp)

        epoch = int(dt.replace(tzinfo=timezone.utc).timestamp())
        return Candle(
            time=epoch,
            timestamp=dt,
            open=float(row["Open"]),
            high=float(row["High"]),
            low=float(row["Low"]),
            close=float(row["Close"]),
            volume=float(row["Volume"]),
            ema_20=self._optional_float(row["ema_20"]),
            ema_50=self._optional_float(row["ema_50"]),
            rsi_14=self._optional_float(row["rsi_14"]),
        )

    def _optional_float(self, value: object) -> float | None:
        if pd.isna(value):
            return None
        return float(value)

    def _ensure_csv_exists(self) -> None:
        if not self.csv_path.exists():
            raise FileNotFoundError(f"CSV file not found: {self.csv_path}")

    def _validate_columns(self, frame: pd.DataFrame) -> None:
        missing = [column for column in REQUIRED_COLUMNS if column not in frame.columns]
        if missing:
            raise ValueError(f"CSV is missing required columns: {', '.join(missing)}")

    def _parse_timestamp(self, value: object) -> datetime:
        if isinstance(value, pd.Timestamp):
            return value.to_pydatetime()
        if isinstance(value, datetime):
            return value
        return datetime.strptime(str(value), DATE_FORMAT)

    def _count_data_rows(self) -> int:
        with self.csv_path.open("rb") as handle:
            return max(sum(1 for _ in handle) - 1, 0)

    def _read_last_data_line(self) -> str | None:
        with self.csv_path.open("rb") as handle:
            handle.seek(0, 2)
            position = handle.tell()
            buffer = bytearray()
            while position > 0:
                position -= 1
                handle.seek(position)
                byte = handle.read(1)
                if byte == b"\n" and buffer:
                    break
                if byte not in {b"\n", b"\r"}:
                    buffer.extend(byte)
            line = bytes(reversed(buffer)).decode("utf-8").strip()
            return line or None
