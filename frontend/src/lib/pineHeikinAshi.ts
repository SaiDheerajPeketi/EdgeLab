import type { Kline } from "pinets";

/** Only this explicitly supported chart transform may resolve to an owned base feed. */
export function pineHeikinAshiBase(symbol: string): string {
  return symbol.endsWith(";heikinashi") ? symbol.slice(0, -11) : symbol;
}

/** Transform the entire owned timeframe history before a requested calculation limit is applied. */
export function pineHeikinAshiBars(bars: readonly Kline[]): Kline[] {
  let previous: Kline | undefined;
  return bars.map(bar => {
    // Divide before summing so finite prices cannot overflow their average.
    const close = bar.open / 4 + bar.high / 4 + bar.low / 4 + bar.close / 4;
    const open = previous ? previous.open / 2 + previous.close / 2 : bar.open / 2 + bar.close / 2;
    const transformed = { ...bar, open, close, high: Math.max(bar.high, open, close), low: Math.min(bar.low, open, close) };
    previous = transformed;
    return transformed;
  });
}
