import type { Candle } from "./api";
import { normalizeChartTimeframe, type ChartTimeframe } from "./charting";
import { validatePineBar } from "./pineProtocol";

const NATIVE_INTERVALS: Record<string, string> = {
  "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m",
  "1H": "1h", "2H": "2h", "4H": "4h", "6H": "6h", "8H": "8h", "12H": "12h",
  "1D": "1d", "1W": "1w", "1M": "1M",
};

/** Provider candles keep full bucket OHLCV; minute tails cannot reconstruct it. */
export function binanceChartInterval(timeframe: ChartTimeframe): string | null {
  const normalized = normalizeChartTimeframe(timeframe);
  return normalized ? NATIVE_INTERVALS[normalized] ?? null : null;
}

export function binanceChartCandle(row: unknown): Candle {
  if (!Array.isArray(row) || row.length < 6 || !Number.isSafeInteger(row[0]) || row[0] % 1000 !== 0
    || row.slice(1, 6).some(value => typeof value !== "number" && (typeof value !== "string" || !value.trim()))) {
    throw new Error("The provider returned an invalid historical candle.");
  }
  return validatePineBar({ time: row[0] / 1000, open: Number(row[1]), high: Number(row[2]),
    low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]) });
}

export function binanceChartEvent(payload: unknown, symbol: string, interval: string) {
  if (!payload || typeof payload !== "object") throw new Error("The provider returned an invalid candle update.");
  const message = payload as Record<string, unknown>;
  const k = message.k as Record<string, unknown> | undefined;
  if (message.e !== "kline" || message.s !== symbol || !k || k.s !== symbol || k.i !== interval
    || typeof k.x !== "boolean" || !Number.isSafeInteger(message.E) || !Number.isSafeInteger(k.T)) {
    throw new Error("The provider returned an invalid candle update.");
  }
  return { bar: binanceChartCandle([k.t, k.o, k.h, k.l, k.c, k.v]), confirmed: k.x,
    eventTime: message.E as number, closeTime: k.T as number };
}
