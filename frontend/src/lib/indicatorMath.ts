import type { Candle } from "./api";

/** Wilder's moving average, seeded by a full window of finite observations. */
export function wilderAverage(values: number[], period: number): number[] {
  const length = Math.max(1, Math.round(period));
  let count = 0;
  let sum = 0;
  let average = Number.NaN;
  return values.map((value) => {
    if (!Number.isFinite(value)) {
      count = 0;
      sum = 0;
      average = Number.NaN;
      return Number.NaN;
    }
    if (count < length) {
      sum += value;
      count += 1;
      if (count === length) average = sum / length;
    } else {
      average = (average * (length - 1) + value) / length;
    }
    return average;
  });
}

export function trueRangeValues(bars: Candle[]): number[] {
  return bars.map((bar, index) => index === 0
    ? bar.high - bar.low
    : Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - bars[index - 1].close),
      Math.abs(bar.low - bars[index - 1].close),
    ));
}
