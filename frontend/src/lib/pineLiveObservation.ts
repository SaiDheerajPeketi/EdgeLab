import type { Candle } from "./api";
import { bucketTime } from "./charting";
import { pineFeedNextSourceTime } from "./pineLiveFeed";
import { pineMarketChartTimeframe } from "./pineMarketProtocol";
import { canonicalPineTimeframe, PineProtocolError, validatePineBar, type PineContext, type PineSourceSnapshot } from "./pineProtocol";

export type PineLiveObservation = { bar: Candle; confirmed: boolean; eventTime: number; closeTime: number };
const native = new Set(["1", "3", "5", "15", "30", "60", "120", "240", "360", "480", "720", "1D", "1W", "1M"]);
function invalid(message: string): never { throw new PineProtocolError("INVALID_LIVE_OBSERVATION", message); }
function fields(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid("Live observations require ordinary data fields.");
  for (const key of Reflect.ownKeys(value)) {
    const field = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !allowed.includes(key) || !("value" in field) || !field.enumerable) invalid("Unexpected live observation field.");
  }
  return value as Record<string, unknown>;
}

/** Received primary evidence extends a seed cutoff without confirming the chart. */
export function validatePineLiveObservation(value: unknown, context: PineContext, bars: readonly Candle[], source?: PineSourceSnapshot): PineLiveObservation {
  const raw = fields(value, ["bar", "confirmed", "eventTime", "closeTime"]);
  const inputBar = fields(raw.bar, ["time", "timestamp", "open", "high", "low", "close", "volume", "ema_20", "ema_50", "rsi_14"]);
  if (!["time", "open", "high", "low", "close", "volume"].every(key => Object.prototype.hasOwnProperty.call(inputBar, key))) invalid("Live observations require explicit primary OHLCV.");
  const bar = validatePineBar(inputBar);
  const nativeTimeframe = canonicalPineTimeframe(source?.timeframe ?? context.timeframe);
  if (!native.has(nativeTimeframe)) invalid("Live observations require an actual native source interval.");
  const frame = pineMarketChartTimeframe(nativeTimeframe), chart = pineMarketChartTimeframe(context.timeframe);
  const nextChart = pineFeedNextSourceTime(bars.at(-1)!.time, chart);
  const closeTime = pineFeedNextSourceTime(bar.time, frame) * 1000 - 1;
  if (bucketTime(bar.time, frame) !== bar.time || bucketTime(bar.time, chart) !== nextChart || raw.closeTime !== closeTime
    || typeof raw.confirmed !== "boolean" || !Number.isSafeInteger(raw.eventTime) || (raw.eventTime as number) < bar.time * 1000
    || (raw.eventTime as number) > 253_402_300_799_999
    || (raw.confirmed ? (raw.eventTime as number) < closeTime : (raw.eventTime as number) > closeTime)) invalid("The live observation does not belong to the next owned chart candle.");
  if (source) {
    const prefix = source.bars.filter(item => item.time >= nextChart);
    if (prefix.some((item, index) => item.time !== (index ? pineFeedNextSourceTime(prefix[index - 1].time, frame) : nextChart))
      || bar.time !== (prefix.length ? pineFeedNextSourceTime(prefix.at(-1)!.time, frame) : nextChart)) invalid("The live observation must immediately follow its actual source prefix.");
  } else if (bar.time !== nextChart) invalid("A native live observation must open the next chart candle.");
  return { bar, confirmed: raw.confirmed, eventTime: raw.eventTime as number, closeTime };
}

/** Only an actual confirmed prefix or explicit received event proves extra time. */
export function pineLiveObservationCutoff(context: PineContext, bars: readonly Candle[], source?: PineSourceSnapshot, observation?: PineLiveObservation): number {
  const chart = pineMarketChartTimeframe(context.timeframe);
  const chartEnd = pineFeedNextSourceTime(bars.at(-1)!.time, chart);
  let cutoff = chartEnd;
  if (source) {
    const frame = pineMarketChartTimeframe(source.timeframe);
    const prefix = source.bars.filter(item => item.time >= chartEnd);
    if (prefix.length && prefix.every((item, index) => item.time === (index ? pineFeedNextSourceTime(prefix[index - 1].time, frame) : chartEnd))) {
      const end = pineFeedNextSourceTime(prefix.at(-1)!.time, frame);
      if (end < pineFeedNextSourceTime(chartEnd, chart)) cutoff = Math.max(cutoff, end);
    }
  }
  if (observation) cutoff = Math.max(cutoff, Math.min(Math.floor(observation.eventTime / 1000), (observation.closeTime + 1) / 1000));
  return cutoff;
}
