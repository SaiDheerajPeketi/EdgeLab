export const TIMEFRAME_MS = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1D": 24 * 60 * 60_000,
};

export function normalizeTimeframe(timeframe) {
  if (!timeframe) return "1m";
  const clean = String(timeframe).trim();
  const aliases = {
    "1M": "1m",
    "5M": "5m",
    "15M": "15m",
    "30M": "30m",
    "1H": "1h",
    "4H": "4h",
    D: "1D",
    "1d": "1D",
    "1day": "1D",
  };
  return aliases[clean] ?? clean;
}

export function resampleCandles(candles, timeframe) {
  const normalized = normalizeTimeframe(timeframe);
  const bucketSize = TIMEFRAME_MS[normalized];
  if (!bucketSize || normalized === "1m") {
    return candles;
  }

  const buckets = new Map();
  for (const candle of candles) {
    const bucketTime = Math.floor(candle.timestamp / bucketSize) * bucketSize;
    const existing = buckets.get(bucketTime);
    if (!existing) {
      buckets.set(bucketTime, {
        timestamp: bucketTime,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      });
      continue;
    }

    existing.high = Math.max(existing.high, candle.high);
    existing.low = Math.min(existing.low, candle.low);
    existing.close = candle.close;
    existing.volume += candle.volume;
  }

  return Array.from(buckets.values()).sort((a, b) => a.timestamp - b.timestamp);
}

export function timeframeToMs(timeframe) {
  return TIMEFRAME_MS[normalizeTimeframe(timeframe)] ?? TIMEFRAME_MS["1m"];
}
