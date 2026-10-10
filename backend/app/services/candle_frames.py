from collections.abc import Callable
from datetime import datetime

import pandas as pd

from app.schemas import Candle


CANDLE_COLUMNS = [
    "Timestamp", "Open", "High", "Low", "Close", "Volume",
    "ema_20", "ema_50", "rsi_14",
]


def frame_to_candles(
    frame: pd.DataFrame,
    to_utc: Callable[[datetime], datetime],
    *,
    parse_timestamp: Callable[[object], datetime] | None = None,
) -> list[Candle]:
    if frame.empty:
        return []
    bars = []
    # Tuples avoid allocating a pandas Series and looking up nine labels per bar.
    for timestamp, open_, high, low, close, volume, ema_20, ema_50, rsi_14 in frame[CANDLE_COLUMNS].itertuples(index=False, name=None):
        if parse_timestamp is not None:
            timestamp = parse_timestamp(timestamp)
        elif isinstance(timestamp, pd.Timestamp):
            timestamp = timestamp.to_pydatetime()
        bars.append(Candle(
            time=int(to_utc(timestamp).timestamp()),
            timestamp=timestamp,
            open=float(open_),
            high=float(high),
            low=float(low),
            close=float(close),
            volume=float(volume),
            ema_20=None if pd.isna(ema_20) else float(ema_20),
            ema_50=None if pd.isna(ema_50) else float(ema_50),
            rsi_14=None if pd.isna(rsi_14) else float(rsi_14),
        ))
    return bars
