import type { Time } from "lightweight-charts";

export type IndicatorPlotPoint = { time: Time; value: number };
export type IndicatorPlotSeries = { label: string; color: string; digits: number; data: readonly IndicatorPlotPoint[] };
export type IndicatorPlotRow = { label: string; color: string; digits: number; value: number | null };

export function indicatorPlotTimestamp(time: Time): number {
  if (typeof time === "number") return time * 1000;
  if (typeof time === "string") return Date.parse(`${time}T00:00:00Z`);
  return Date.UTC(time.year, time.month - 1, time.day);
}

/** Secondary studies can have shorter warmups; match actual bar times, never array offsets. */
export function indicatorPlotReadouts(points: readonly IndicatorPlotPoint[], series: readonly IndicatorPlotSeries[]) {
  const lookups = series.map((item) => new Map(item.data.map((point) => [indicatorPlotTimestamp(point.time), point.value])));
  return points.map((point) => ({
    time: point.time,
    rows: series.map((item, index): IndicatorPlotRow => {
      const value = lookups[index].get(indicatorPlotTimestamp(point.time));
      return { label: item.label, color: item.color, digits: item.digits, value: typeof value === "number" && Number.isFinite(value) ? value : null };
    }),
  }));
}

/** Secondary paths use the primary plot's candle slots, including missing warmup bars. */
export function indicatorPlotSeriesPositions<T extends IndicatorPlotPoint>(points: readonly IndicatorPlotPoint[], secondary: readonly T[], width: number) {
  const indices = new Map(points.map((point, index) => [indicatorPlotTimestamp(point.time), index]));
  return secondary.flatMap((point) => {
    const index = indices.get(indicatorPlotTimestamp(point.time));
    return index === undefined ? [] : [{ point, index, x: index / Math.max(1, points.length - 1) * width }];
  });
}

/** The SVG plot covers the full width and stretches with its rendered container. */
export function nearestIndicatorPlotPoint(clientX: number, left: number, renderedWidth: number, pointCount: number): number | null {
  if (pointCount < 1 || renderedWidth <= 0 || ![clientX, left, renderedWidth].every(Number.isFinite)) return null;
  return Math.max(0, Math.min(pointCount - 1, Math.round((clientX - left) / renderedWidth * (pointCount - 1))));
}

export function formatIndicatorPlotValue(value: number | null, digits: number): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(Math.max(0, Math.min(10, digits)));
}
