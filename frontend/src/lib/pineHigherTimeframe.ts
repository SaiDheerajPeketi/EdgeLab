import type { Candle } from "./api";
import { PineProtocolError, pineFixedTimeframeDuration } from "./pineProtocol";

/** Canonical Pine fixed-duration intraday timeframes, expressed in seconds. */
export function pineHigherTimeframeDuration(timeframe: string): number | undefined {
  return pineFixedTimeframeDuration(timeframe);
}

function unavailable(message: string): never {
  throw new PineProtocolError("UNAVAILABLE_DATA", message);
}

/**
 * Aggregate supplied history only. A target bucket needs every consecutive
 * UTC-aligned base bar; incomplete and missing buckets are never fabricated.
 */
export function aggregatePineHigherTimeframe(
  bars: readonly Candle[],
  baseTimeframe: string,
  targetTimeframe: string,
  developingTail = false,
): Candle[] {
  const base = pineHigherTimeframeDuration(baseTimeframe);
  const target = pineHigherTimeframeDuration(targetTimeframe);
  if (base === undefined || target === undefined || target <= base || target % base !== 0
    || 86400 % base !== 0 || 86400 % target !== 0) {
    unavailable("Requested higher-timeframe data requires fixed UTC-day-aligned intraday multiples of the chart timeframe.");
  }
  const children = target / base;
  const result: Candle[] = [];
  let current: Candle | undefined;
  let count = 0;
  let contiguous = false;
  let previousTime: number | undefined;

  const finish = (allowPartial = false) => {
    if (!current || !contiguous || count !== children && !allowPartial) return;
    if (!Number.isFinite(current.volume)) unavailable("Aggregated volume exceeds the supported finite range.");
    result.push(current);
  };

  for (const bar of bars) {
    if (!bar || !Number.isSafeInteger(bar.time) || bar.time < 0 || bar.time > 253402300799
      || bar.time % base !== 0 || previousTime !== undefined && bar.time <= previousTime
      || ![bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)
      || bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close)
      || bar.low > bar.high || bar.volume < 0) {
      unavailable("Higher-timeframe history requires ordered valid OHLCV bars on the chart's UTC grid.");
    }
    const start = Math.floor(bar.time / target) * target;
    if (!current || current.time !== start) {
      finish();
      current = {
        time: start,
        timestamp: new Date(start * 1000).toISOString(),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        ema_20: null,
        ema_50: null,
        rsi_14: null,
      };
      count = 1;
      contiguous = bar.time === start;
    } else {
      contiguous = contiguous && bar.time === previousTime! + base;
      count++;
      current.high = Math.max(current.high, bar.high);
      current.low = Math.min(current.low, bar.low);
      current.close = bar.close;
      current.volume += bar.volume;
    }
    previousTime = bar.time;
  }
  finish(developingTail);
  return result;
}
