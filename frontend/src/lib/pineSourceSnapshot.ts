import type { Candle } from "./api";
import { pineContextForChart } from "./customIndicators";
import { PINE_LIMITS, canonicalPineTimeframe, pineFixedTimeframeDuration, type PineSourceSnapshot } from "./pineProtocol";

function nativeTimeframe(value: string): string {
  return /^(?:[1-9]\d*|(?:[1-9]\d*)?[SDWM])$/.test(value)
    ? canonicalPineTimeframe(value) : pineContextForChart("CHART", value).timeframe;
}

/** Only the source candles already owned by this chart may enter a Pine run. */
export function pineSourceSnapshotForChart(
  sourceBars: readonly Candle[], sourceTimeframe: string | null | undefined,
  chartBars: readonly Candle[], chartTimeframe: string,
): PineSourceSnapshot | undefined {
  if (!sourceTimeframe || !chartBars.length) return undefined;
  let source: string, chart: string;
  try {
    source = nativeTimeframe(sourceTimeframe);
    chart = nativeTimeframe(chartTimeframe);
  } catch { return undefined; }
  const sourceSeconds = pineFixedTimeframeDuration(source), chartSeconds = pineFixedTimeframeDuration(chart);
  if (!sourceSeconds || !chartSeconds || sourceSeconds >= chartSeconds || chartSeconds % sourceSeconds !== 0) return undefined;
  const first = chartBars[0].time, end = chartBars.at(-1)!.time + chartSeconds;
  // The caller supplies its replay-cursor-clipped source. Never reconstruct an
  // unfinished aggregate's missing minutes or introduce additional lookback.
  return { timeframe: source, bars: sourceBars.filter(bar => bar.time >= first && bar.time + sourceSeconds <= end).slice(-PINE_LIMITS.sourceBars) };
}
