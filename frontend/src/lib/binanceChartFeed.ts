import type { Candle } from "./api";
import { bucketTime, canAggregateTimeframe, getTimeframeSeconds, normalizeChartTimeframe, type ChartTimeframe } from "./charting";
import { validatePineBar } from "./pineProtocol";
import { pineFeedNextSourceTime } from "./pineLiveFeed";

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

export type BinanceChartPlan = { chartTimeframe: ChartTimeframe; sourceTimeframe: ChartTimeframe; interval: string; targetBars: number };
export const BINANCE_CHART_HISTORY_LIMIT = 16_000;

/** Use the largest aligned native divisor without manufacturing finer candles. */
export function binanceChartPlan(timeframe: ChartTimeframe): BinanceChartPlan | null {
  const chartTimeframe = normalizeChartTimeframe(timeframe);
  if (!chartTimeframe) return null;
  const direct = binanceChartInterval(chartTimeframe);
  if (direct) return { chartTimeframe, sourceTimeframe: chartTimeframe, interval: direct, targetBars: 1000 };
  const sourceTimeframe = Object.keys(NATIVE_INTERVALS)
    .filter(source => source !== "1W" && source !== "1M" && canAggregateTimeframe(chartTimeframe, source))
    .sort((a, b) => getTimeframeSeconds(b) - getTimeframeSeconds(a))[0];
  if (!sourceTimeframe) return null;
  const ratio = getTimeframeSeconds(chartTimeframe) / getTimeframeSeconds(sourceTimeframe);
  return { chartTimeframe, sourceTimeframe, interval: NATIVE_INTERVALS[sourceTimeframe],
    targetBars: Math.min(BINANCE_CHART_HISTORY_LIMIT, 1000 * ratio + ratio - 1) };
}

/** Bounded backward pagination; provider exhaustion never pads missing history. */
export async function loadBinanceChartHistory(symbol: string, plan: BinanceChartPlan, options: {
  signal: AbortSignal; owns?: () => boolean; fetcher?: typeof fetch;
}): Promise<Candle[]> {
  const target = Math.min(BINANCE_CHART_HISTORY_LIMIT, Math.max(1, Math.floor(plan.targetBars)));
  const fetcher = options.fetcher ?? fetch;
  const ensureActive = () => {
    if (options.signal.aborted || options.owns?.() === false) throw new DOMException("Chart history request retired.", "AbortError");
  };
  let before: number | undefined, history: Candle[] = [];
  for (let request = 0; history.length < target && request < Math.ceil(target / 1000); request++) {
    ensureActive();
    const limit = Math.min(1000, target - history.length);
    const query = new URLSearchParams({ symbol, interval: plan.interval, limit: String(limit) });
    if (before !== undefined) query.set("endTime", String(before));
    const response = await fetcher(`https://data-api.binance.vision/api/v3/klines?${query}`, { signal: options.signal });
    ensureActive();
    if (!response.ok) throw new Error("Chart history could not be loaded. Retry the feed.");
    const rows: unknown = await response.json();
    ensureActive();
    if (!Array.isArray(rows) || rows.length > limit) throw new Error("The provider returned invalid chart history.");
    if (!rows.length) break;
    const page = rows.map(row => {
      const bar = binanceChartCandle(row);
      if (!Array.isArray(row) || bar.time !== bucketTime(bar.time, plan.sourceTimeframe)
        || row[6] !== pineFeedNextSourceTime(bar.time, plan.sourceTimeframe) * 1000 - 1) {
        throw new Error("The provider returned history for an invalid candle interval.");
      }
      return bar;
    });
    if (page.some((bar, index) => index > 0 && bar.time !== pineFeedNextSourceTime(page[index - 1].time, plan.sourceTimeframe))
      || before !== undefined && page.at(-1)!.time * 1000 > before
      || history.length && pineFeedNextSourceTime(page.at(-1)!.time, plan.sourceTimeframe) !== history[0].time) {
      throw new Error("Chart history has missing or overlapping candles. Retry the feed.");
    }
    history = [...page, ...history];
    before = page[0].time * 1000 - 1;
    if (rows.length < limit || before < 0) break;
  }
  if (!history.length) throw new Error("No chart history was returned for this interval.");
  return history;
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
