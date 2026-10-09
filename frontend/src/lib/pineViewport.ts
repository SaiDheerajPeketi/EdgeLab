import type { PineViewport } from "./pineProtocol";

/** Compare chart inputs without tying a study's lifetime to a new range object. */
export function pineViewportMatches(left: PineViewport | null | undefined, right: PineViewport | null | undefined): boolean {
  return left === right || Boolean(left && right && left.from === right.from && left.to === right.to);
}

/** Read only the primary price series: other plots can extend the shared timeline. */
export function pineViewportFromSeries(value: { from?: unknown; to?: unknown } | null): PineViewport | null {
  return value && typeof value.from === "number" && typeof value.to === "number"
    && Number.isSafeInteger(value.from) && Number.isSafeInteger(value.to)
    && value.from >= 0 && value.from <= value.to && value.to <= 253402300799
    ? { from: value.from, to: value.to } : null;
}
