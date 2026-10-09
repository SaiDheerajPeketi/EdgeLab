import type { Candle } from "./api";
import { canonicalPineTimeframe, PineProtocolError } from "./pineProtocol";

export function pineCalculationFrame(timeframe: string) {
  const match = /^(\d+)([SDWM]?)$/.exec(canonicalPineTimeframe(timeframe))!;
  return { amount: Number(match[1]), unit: match[2] };
}

/** UTC 24x7 boundaries, including Monday weeks and actual calendar months. */
export function pineCalculationStart(time: number, timeframe: string): number {
  const { amount, unit } = pineCalculationFrame(timeframe);
  if (unit === "M") {
    const date = new Date(time * 1000), month = Math.floor((date.getUTCFullYear() * 12 + date.getUTCMonth()) / amount) * amount;
    return Date.UTC(Math.floor(month / 12), month % 12, 1) / 1000;
  }
  const seconds = amount * ({ S: 1, D: 86400, W: 604800 }[unit] ?? 60);
  const anchor = unit === "W" ? -259200 : 0;
  return Math.floor((time - anchor) / seconds) * seconds + anchor;
}

export function pineCalculationEnd(time: number, timeframe: string): number {
  const { amount, unit } = pineCalculationFrame(timeframe);
  if (unit === "M") {
    const date = new Date(time * 1000);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1) / 1000;
  }
  return time + amount * ({ S: 1, D: 86400, W: 604800 }[unit] ?? 60);
}

export function pineCalculationCanAggregate(base: string, target: string): boolean {
  const first = pineCalculationFrame(base), second = pineCalculationFrame(target);
  if (first.unit === "M") return second.unit === "M" && second.amount % first.amount === 0;
  const duration = pineCalculationEnd(0, base);
  if (second.unit === "M") return first.unit !== "W" && 86400 % duration === 0;
  return pineCalculationEnd(0, target) >= duration && pineCalculationEnd(0, target) % duration === 0;
}

/** Every source child is owned and contiguous; no missing OHLCV is invented. */
export function aggregatePineCalculationBars(bars: readonly Candle[], base: string, target: string, developing = false): Candle[] {
  if (!pineCalculationCanAggregate(base, target)) throw new PineProtocolError("UNAVAILABLE_DATA", "This calculation timeframe needs smaller source candles.");
  const output: Candle[] = [];
  let current: Candle | undefined, end = 0, next = 0, contiguous = false;
  const finish = (tail = false) => {
    if (current && contiguous && (next === end || tail && next <= end)) output.push(current);
  };
  for (const bar of bars) {
    const time = pineCalculationStart(bar.time, target), childEnd = pineCalculationEnd(bar.time, base);
    if (!current || current.time !== time) {
      finish();
      end = pineCalculationEnd(time, target);
      current = { ...bar, time, timestamp: new Date(time * 1000).toISOString() };
      contiguous = bar.time === time && pineCalculationStart(bar.time, base) === bar.time;
    } else {
      contiguous = contiguous && bar.time === next;
      current.high = Math.max(current.high, bar.high); current.low = Math.min(current.low, bar.low);
      current.close = bar.close; current.volume += bar.volume;
    }
    contiguous = contiguous && childEnd <= end;
    if (!Number.isFinite(current.volume)) throw new PineProtocolError("UNAVAILABLE_DATA", "Calculation candle volume exceeds the supported finite range.");
    next = childEnd;
  }
  finish(developing);
  return output;
}
