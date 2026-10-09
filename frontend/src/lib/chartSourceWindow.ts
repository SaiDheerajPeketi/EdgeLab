import type { Candle } from "./api";
import { bucketTime, type ChartTimeframe } from "./charting";

/** A missing opening constituent cannot describe a complete chart candle. */
export function trimChartSourceWindow(bars: readonly Candle[], chartTimeframe: ChartTimeframe): readonly Candle[] {
  const first = bars[0];
  if (!first) return bars;
  const firstBucket = bucketTime(first.time, chartTimeframe);
  if (first.time === firstBucket) return bars;
  return bars.filter(bar => bucketTime(bar.time, chartTimeframe) !== firstBucket);
}
