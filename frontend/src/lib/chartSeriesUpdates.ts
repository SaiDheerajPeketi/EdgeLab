export type TimedSeriesPoint = {
  time: unknown;
};

export type SeriesDataUpdatePlan<T> =
  | { mode: "none"; points: [] }
  | { mode: "setData"; points: T[] }
  | { mode: "update"; points: T[] };

export function planSeriesDataUpdate<T extends TimedSeriesPoint>(
  previous: readonly T[],
  next: T[],
  forceSetData = false,
): SeriesDataUpdatePlan<T> {
  if (forceSetData) {
    return { mode: "setData", points: next };
  }
  if (previous.length === 0) {
    return next.length === 0
      ? { mode: "none", points: [] }
      : { mode: "setData", points: next };
  }
  if (next.length === 0) {
    return { mode: "setData", points: next };
  }

  if (next.length === previous.length) {
    if (seriesRangeMatches(previous, next, previous.length)) {
      return { mode: "none", points: [] };
    }
    const tailIndex = next.length - 1;
    if (
      seriesRangeMatches(previous, next, tailIndex) &&
      seriesTimesMatch(previous[tailIndex], next[tailIndex])
    ) {
      return { mode: "update", points: [next[tailIndex]] };
    }
    return { mode: "setData", points: next };
  }

  if (next.length === previous.length + 1) {
    if (seriesRangeMatches(previous, next, previous.length)) {
      return { mode: "update", points: [next[next.length - 1]] };
    }
    const previousTailIndex = previous.length - 1;
    if (
      seriesRangeMatches(previous, next, previousTailIndex) &&
      seriesTimesMatch(previous[previousTailIndex], next[previousTailIndex])
    ) {
      return {
        mode: "update",
        points: [next[previousTailIndex], next[next.length - 1]],
      };
    }
  }

  return { mode: "setData", points: next };
}

function seriesRangeMatches<T extends TimedSeriesPoint>(
  previous: readonly T[],
  next: readonly T[],
  end: number,
) {
  for (let index = 0; index < end; index += 1) {
    if (!seriesPointsMatch(previous[index], next[index])) {
      return false;
    }
  }
  return true;
}

function seriesPointsMatch<T extends TimedSeriesPoint>(left: T, right: T) {
  if (left === right) {
    return true;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.is(leftRecord[key], rightRecord[key]))
  );
}

function seriesTimesMatch(left: TimedSeriesPoint, right: TimedSeriesPoint) {
  return Object.is(left.time, right.time);
}
