import type { Logical, LogicalRange, UTCTimestamp } from "lightweight-charts";

type LogicalScale = {
  timeToCoordinate(time: UTCTimestamp): number | null;
  coordinateToLogical(coordinate: number): Logical | null;
};

/** The shared timeline can contain study timestamps before/after primary candles. */
export function chartCandleLogical(scale: LogicalScale, time: number): number | null {
  const x = scale.timeToCoordinate(time as UTCTimestamp);
  if (x === null || !Number.isFinite(x)) return null;
  const logical = scale.coordinateToLogical(x);
  return logical !== null && Number.isFinite(logical) ? Number(logical) : null;
}

export function recentChartLogicalRange(latest: number, width: number): LogicalRange | null {
  if (!Number.isFinite(latest) || !Number.isFinite(width) || width <= 1) return null;
  const span = Math.min(320, Math.max(96, Math.round(width / 6)));
  const to = latest + 8;
  // Short histories retain real whitespace, rather than stretching a few candles.
  return { from: (to - span) as Logical, to: to as Logical };
}

export function translatedChartLogicalRange(range: LogicalRange, previous: number, next: number): LogicalRange {
  const delta = next - previous;
  return { from: (range.from + delta) as Logical, to: (range.to + delta) as Logical };
}

export function chartGapMatches(gap: number, previous: number | null): boolean {
  return previous !== null && Number.isFinite(gap) && Number.isFinite(previous) && Math.abs(gap - previous) < 0.75;
}

export function chartLogicalRangesMatch(a: LogicalRange | null, b: LogicalRange | null): boolean {
  return a === b || !!a && !!b && Math.abs(a.from - b.from) < 0.0001 && Math.abs(a.to - b.to) < 0.0001;
}

/** Native LWC emits no range event when a requested range is already current. */
export function requestChartLogicalRange(scale: {
  getVisibleLogicalRange(): LogicalRange | null;
  setVisibleLogicalRange(range: LogicalRange): void;
}, range: LogicalRange): boolean {
  if (chartLogicalRangesMatch(scale.getVisibleLogicalRange(), range)) return false;
  scale.setVisibleLogicalRange(range);
  return true;
}

/** A data update must not cancel an initialization waiting for the chart's paint. */
export function createChartViewportInitializer(frames: {
  request(callback: () => void): number;
  cancel(frame: number): void;
}) {
  let owner: unknown;
  let action: (() => boolean) | null = null;
  let frame: number | null = null;
  let pending = false;
  const cancel = () => {
    if (frame !== null) frames.cancel(frame);
    frame = null;
  };
  const retry = () => {
    if (!pending || frame !== null) return;
    frame = frames.request(() => {
      frame = frames.request(() => {
        frame = null;
        if (pending && action?.()) pending = false;
      });
    });
  };
  const reset = (next: () => boolean) => {
    cancel();
    action = next;
    pending = true;
    retry();
  };
  return {
    get pending() { return pending; },
    setOwner(next: unknown, initialize: () => boolean) {
      if (owner !== next) { owner = next; reset(initialize); return true; }
      retry();
      return false;
    },
    reset,
    retry,
    adopt() { pending = false; cancel(); },
    dispose() { pending = false; action = null; owner = undefined; cancel(); },
  };
}
