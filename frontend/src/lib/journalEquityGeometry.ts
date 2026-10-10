export type JournalEquityPoint = { date: string; tradeId: number; value: number };

export function journalEquityGeometry(points: readonly JournalEquityPoint[], width: number, height: number, padding: number) {
  if (!points.length || points.some((point) => !Number.isFinite(point.value))) return [];
  const min = points.reduce((value, point) => Math.min(value, point.value), Infinity);
  const max = points.reduce((value, point) => Math.max(value, point.value), -Infinity);
  const range = max - min;
  return points.map((point, index) => ({
    point,
    x: points.length === 1 ? width / 2 : padding + index / (points.length - 1) * (width - padding * 2),
    y: range === 0 ? height / 2 : height - padding - (point.value - min) / range * (height - padding * 2),
  }));
}

/** SVGs stretch to their container; map the pointer through the same padded plot. */
export function journalEquityPointIndex(clientX: number, left: number, renderedWidth: number, pointCount: number, width: number, padding: number): number | null {
  if (pointCount < 1 || ![clientX, left, renderedWidth].every(Number.isFinite) || renderedWidth <= 0) return null;
  if (pointCount === 1) return 0;
  const plotX = (clientX - left) / renderedWidth * width;
  const position = (plotX - padding) / (width - padding * 2);
  return Math.max(0, Math.min(pointCount - 1, Math.round(position * (pointCount - 1))));
}
