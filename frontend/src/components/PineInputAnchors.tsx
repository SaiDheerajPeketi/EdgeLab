import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { Crosshair, MoveHorizontal, MoveVertical, X } from "lucide-react";
import type { IChartApi, ISeriesApi, ISeriesPrimitive, Logical, UTCTimestamp } from "lightweight-charts";
import type { Candle } from "../lib/api";
import type { PineInputDefinition, PineInputValue } from "../lib/pineProtocol";
import { pineInputAnchors, pineAnchorActive, pineAnchorValues, pineAnchorPatch, type PineInputAnchor } from "../lib/pineInteractiveInputs";
import { acquireTooltipContainer, releaseTooltipContainer } from "../lib/pineLinePrimitive";
import { guardPineInputCompletionClick } from "../lib/pineInputClickGuard";

type Values = { price?: number; time?: number };
type Patch = Record<string, PineInputValue>;
type PriceSeries = Pick<ISeriesApi<"Line">, "priceToCoordinate" | "coordinateToPrice">;
export type PineInputAnchorsProps = {
  chart: IChartApi; series: PriceSeries; bars: readonly Candle[];
  definitions: PineInputDefinition[]; inputs: Patch; contextKey: string;
  onCommit: (patch: Patch) => void; enabled?: boolean;
  picking?: { anchorId: string; onPick: (patch: Patch) => void; onCancel: () => void };
};
type Geometry = { width: number; height: number; left: number };
type Session = {
  anchor: PineInputAnchor; owner: object; values: Values; moved: boolean;
  target?: HTMLElement; pointerId?: number; picking?: boolean; start?: { x: number; y: number }; origin?: { x: number | null; y: number | null };
};

/** Existing values snap only inside loaded history; unknown/future times stay unpositioned. */
export function pineLoadedAnchorIndex(bars: readonly Pick<Candle, "time">[], milliseconds: number): number | null {
  if (!bars.length || !Number.isSafeInteger(milliseconds)) return null;
  const seconds = milliseconds / 1000;
  if (seconds < bars[0].time || seconds > bars[bars.length - 1].time) return null;
  let low = 0, high = bars.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (bars[middle].time < seconds) low = middle + 1; else high = middle;
  }
  return low > 0 && seconds - bars[low - 1].time <= bars[low].time - seconds ? low - 1 : low;
}

/** A pick is an actual loaded candle, never an extrapolated/future time-scale slot. */
export function pinePickedAnchorTime(chart: IChartApi, bars: readonly Pick<Candle, "time">[], x: number): number | null {
  const scale = chart.timeScale(), time = scale.coordinateToTime(x);
  if (typeof time === "number") {
    const index = pineLoadedAnchorIndex(bars, time * 1000);
    return index === null ? null : bars[index].time * 1000;
  }
  const logical = scale.coordinateToLogical(x);
  if (logical === null || !Number.isFinite(logical) || logical < 0 || logical > bars.length - 1) return null;
  const index = Math.round(logical);
  // Check the selected candle really occupies this chart timeline slot. A foreign
  // series may have inserted extra times, so bars[index] alone is not authority.
  const actual = scale.timeToCoordinate(bars[index].time as UTCTimestamp);
  const actualLogical = actual === null ? null : scale.coordinateToLogical(actual);
  if (actualLogical === null || Math.abs(actualLogical - index) > 0.01) return null;
  return bars[index].time * 1000;
}

function geometry(chart: IChartApi): Geometry | null {
  try {
    const pane = chart.paneSize(), left = chart.priceScale("left").width();
    return pane.width > 0 && pane.height > 0 && Number.isFinite(pane.width) && Number.isFinite(pane.height) && Number.isFinite(left)
      ? { width: pane.width, height: pane.height, left } : null;
  } catch { return null; }
}
function release(session: Session | null) {
  if (session?.target && session.pointerId !== undefined && session.target.hasPointerCapture?.(session.pointerId)) {
    session.target.releasePointerCapture(session.pointerId);
  }
}

/** React-owned chart input handles. All changes are previews until an explicit commit. */
export function PineInputAnchors(props: PineInputAnchorsProps) {
  const { chart, series, bars, definitions, inputs, contextKey, enabled = true, picking } = props;
  const anchors = useMemo(() => pineInputAnchors(definitions), [definitions]);
  const instructionId = useId();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [, repaint] = useState(0);
  const [preview, setPreview] = useState<{ id: string; values: Values } | null>(null);
  // Scope identity includes numeric edits/activation as well as chart/account/source.
  // A delayed pointerup cannot commit an old snapshot after any of these change.
  const fingerprint = JSON.stringify([contextKey, enabled, definitions, inputs, picking?.anchorId]);
  const owner = useMemo(() => ({}), [chart, series, fingerprint, picking?.anchorId]);
  const latest = useRef({ ...props, enabled, owner });
  latest.current = { ...props, enabled, owner };
  const session = useRef<Session | null>(null);
  const pickerElement = useRef<HTMLDivElement | null>(null);
  const cancel = () => {
    const previous = session.current;
    session.current = null;
    release(previous);
    setPreview(null);
  };

  useLayoutEffect(() => { cancel(); }, [owner]);
  useLayoutEffect(() => {
    if (!root || !enabled || !picking || !pickerElement.current) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pickerElement.current.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [root, enabled, picking?.anchorId]);
  useLayoutEffect(() => {
    const element = chart.chartElement();
    let disposed = false, frame = 0;
    const refresh = () => {
      if (disposed || frame) return;
      frame = requestAnimationFrame(() => { frame = 0; if (!disposed) repaint(value => value + 1); });
    };
    acquireTooltipContainer(element);
    setRoot(element);
    const scale = chart.timeScale();
    scale.subscribeVisibleLogicalRangeChange(refresh);
    const observer = new ResizeObserver(refresh); observer.observe(element);
    // The integration passes the real series. This view receives axis transforms
    // too (logarithmic/inverted/dragged scales), without adding a synthetic series.
    const attachable = series as PriceSeries & Partial<Pick<ISeriesApi<"Line">, "attachPrimitive" | "detachPrimitive">>;
    const primitive: ISeriesPrimitive = { updateAllViews: refresh };
    let attached = false;
    if (attachable.attachPrimitive && attachable.detachPrimitive) {
      attachable.attachPrimitive(primitive); attached = true;
    }
    refresh();
    return () => {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect();
      scale.unsubscribeVisibleLogicalRangeChange(refresh);
      if (attached) { try { attachable.detachPrimitive!(primitive); } catch { /* Chart may already have been disposed. */ } }
      cancel(); releaseTooltipContainer(element); setRoot(null);
    };
  }, [chart, series]);

  const pane = geometry(chart);
  const valid = (transaction: Session) => {
    const current = latest.current;
    return current.enabled && current.owner === transaction.owner
      && pineAnchorActive(transaction.anchor, current.definitions, current.inputs)
      && (!transaction.picking || current.picking?.anchorId === transaction.anchor.id);
  };
  const coordinates = (values: Values) => {
    const index = values.time === undefined ? null : pineLoadedAnchorIndex(bars, values.time);
    try {
      const x = index === null ? null : chart.timeScale().timeToCoordinate(bars[index].time as UTCTimestamp);
      const y = values.price === undefined ? null : series.priceToCoordinate(values.price);
      return { x: x !== null && Number.isFinite(x) ? x : null, y: y !== null && Number.isFinite(y) ? y : null };
    } catch { return { x: null, y: null }; }
  };
  const at = (anchor: PineInputAnchor, x: number, y: number): Values | null => {
    if (!pane || x < 0 || y < 0 || x > pane.width || y > pane.height) return null;
    const values: Values = {};
    if (anchor.priceId) {
      const price = series.coordinateToPrice(y);
      if (price === null || !Number.isFinite(price)) return null;
      values.price = price;
    }
    if (anchor.timeId) {
      const time = pinePickedAnchorTime(chart, bars, x);
      if (time === null) return null;
      values.time = time;
    }
    return pineAnchorPatch(anchor, values, definitions) ? values : null;
  };
  const local = (event: PointerEvent<HTMLElement>) => {
    const rect = root!.getBoundingClientRect();
    return { x: event.clientX - rect.left - pane!.left, y: event.clientY - rect.top };
  };
  const finish = (transaction: Session, point?: { clientX: number; clientY: number }) => {
    session.current = null; release(transaction); setPreview(null);
    if (!valid(transaction) || !transaction.moved) return;
    const current = latest.current, patch = pineAnchorPatch(transaction.anchor, transaction.values, current.definitions);
    if (!patch) return;
    if (transaction.values.time !== undefined) {
      const index = pineLoadedAnchorIndex(current.bars, transaction.values.time);
      if (index === null || current.bars[index].time * 1000 !== transaction.values.time) return;
    }
    if (point && root) guardPineInputCompletionClick(root.ownerDocument, point);
    if (transaction.picking) current.picking?.onPick(patch); else current.onCommit(patch);
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const transaction = session.current;
    if (!transaction || transaction.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    if (!valid(transaction)) { cancel(); return; }
    const point = local(event);
    const x = !transaction.picking && transaction.start && transaction.origin?.x !== null && transaction.origin?.x !== undefined
      ? transaction.origin.x + point.x - transaction.start.x : point.x;
    const y = !transaction.picking && transaction.start && transaction.origin?.y !== null && transaction.origin?.y !== undefined
      ? transaction.origin.y + point.y - transaction.start.y : point.y;
    const inside = pane && point.x >= 0 && point.x <= pane.width && point.y >= 0 && point.y <= pane.height;
    const values = inside ? at(transaction.anchor, x, y) : null;
    // Leaving loaded history/the pane cannot commit the last valid preview.
    const changed = transaction.picking || !transaction.start
      || transaction.anchor.priceId && point.y !== transaction.start.y
      || transaction.anchor.timeId && point.x !== transaction.start.x;
    transaction.moved = values !== null && Boolean(changed);
    if (values) { transaction.values = values; setPreview({ id: transaction.anchor.id, values }); }
  };
  const up = (event: PointerEvent<HTMLElement>) => {
    const transaction = session.current;
    if (!transaction || transaction.pointerId !== event.pointerId) return;
    move(event);
    finish(transaction, event);
  };
  const down = (event: PointerEvent<HTMLElement>, anchor: PineInputAnchor, isPick = false) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault(); event.stopPropagation(); cancel();
    if (!enabled || !pineAnchorActive(anchor, definitions, inputs)) return;
    const point = local(event), initial = isPick ? at(anchor, point.x, point.y) : pineAnchorValues(anchor, definitions, inputs);
    if (!initial) return;
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    session.current = { anchor, owner, values: initial, moved: isPick, target: event.currentTarget, pointerId: event.pointerId, picking: isPick, start: point, origin: coordinates(initial) };
    setPreview({ id: anchor.id, values: initial });
  };
  const key = (event: KeyboardEvent<HTMLElement>, anchor: PineInputAnchor, isPick = false) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); return; }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); event.stopPropagation();
      if (session.current?.anchor.id === anchor.id && session.current.pointerId === undefined) finish(session.current);
      return;
    }
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (!enabled || !pineAnchorActive(anchor, definitions, inputs)) return;
    let transaction = session.current;
    if (!transaction || transaction.anchor.id !== anchor.id || !valid(transaction)) {
      cancel(); const values = isPick && pane ? at(anchor, pane.width / 2, pane.height / 2) : pineAnchorValues(anchor, definitions, inputs);
      if (!values) return;
      transaction = { anchor, owner, values, moved: false, picking: isPick }; session.current = transaction;
    }
    const position = coordinates(transaction.values), values = { ...transaction.values };
    if (anchor.priceId && (event.key === "ArrowUp" || event.key === "ArrowDown") && position.y !== null) {
      const y = position.y + (event.key === "ArrowUp" ? -1 : 1) * (event.shiftKey ? 10 : 1);
      if (!pane || y < 0 || y > pane.height) return;
      const price = series.coordinateToPrice(y);
      if (price === null || !Number.isFinite(price)) return;
      values.price = price;
    } else if (anchor.timeId && (event.key === "ArrowLeft" || event.key === "ArrowRight") && values.time !== undefined) {
      const index = pineLoadedAnchorIndex(bars, values.time);
      if (index === null) return;
      const next = index + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 10 : 1);
      if (next < 0 || next >= bars.length) return;
      values.time = bars[next].time * 1000;
    } else return;
    if (!pineAnchorPatch(anchor, values, definitions)) return;
    transaction.values = values; transaction.moved = true; setPreview({ id: anchor.id, values });
  };

  const pointerCancel = (event: PointerEvent<HTMLElement>) => {
    if (session.current?.pointerId === event.pointerId) cancel();
  };
  const timeLabel = (time: number) => {
    const date = new Date(time);
    return Number.isFinite(date.getTime()) ? date.toISOString() : String(time);
  };
  if (!root || !pane || !enabled) return null;
  const pickingAnchor = picking ? anchors.find(anchor => anchor.id === picking.anchorId && pineAnchorActive(anchor, definitions, inputs)) : undefined;
  return createPortal(<div data-pine-input-anchors data-pine-input-context={contextKey}
    style={{ position: "absolute", left: pane.left, top: 0, width: pane.width, height: pane.height, overflow: "hidden", pointerEvents: "none", zIndex: picking ? 45 : 25 }}>
    <span id={instructionId} className="sr-only">Arrow keys preview a change. Enter applies it. Escape cancels.</span>
    {anchors.map(anchor => {
      if (!pineAnchorActive(anchor, definitions, inputs)) return null;
      const values = preview?.id === anchor.id ? preview.values : pineAnchorValues(anchor, definitions, inputs);
      if (!values) return null;
      const { x, y } = coordinates(values);
      if (anchor.timeId && (x === null || x < 0 || x > pane.width) || anchor.priceId && (y === null || y < 0 || y > pane.height)) return null;
      const left = Math.max(0, Math.min(pane.width - 44, (x ?? pane.width - 22) - 22));
      const top = Math.max(0, Math.min(pane.height - 44, (y ?? 22) - 22));
      const Icon = anchor.kind === "price" ? MoveVertical : anchor.kind === "time" ? MoveHorizontal : Crosshair;
      return <div key={anchor.id}>
        {y !== null ? <div aria-hidden="true" style={{ position: "absolute", left: 0, top: y, width: "100%", borderTop: "1px dashed var(--ui-focus)", pointerEvents: "none" }} /> : null}
        {x !== null ? <div aria-hidden="true" style={{ position: "absolute", left: x, top: 0, height: "100%", borderLeft: "1px dashed var(--ui-focus)", pointerEvents: "none" }} /> : null}
        <button type="button" data-pine-input-anchor={anchor.id} data-pine-input-kind={anchor.kind}
          aria-label={`Move ${anchor.label} ${anchor.kind} input`} aria-describedby={instructionId}
          title={`${anchor.label}${values.price === undefined ? "" : ` · ${values.price}`}${values.time === undefined ? "" : ` · ${timeLabel(values.time)}`}`}
          className="flex items-center justify-center rounded-md border border-[var(--ui-border-strong)] bg-[var(--ui-floating)] text-[var(--text-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)] focus-visible:outline-offset-[-2px]"
          style={{ position: "absolute", left, top, width: 44, height: 44, touchAction: "none", pointerEvents: pickingAnchor ? "none" : "auto" }}
          onPointerDown={event => down(event, anchor)} onPointerMove={move} onPointerUp={up}
          onPointerCancel={pointerCancel} onLostPointerCapture={pointerCancel} onKeyDown={event => key(event, anchor)}
          onBlur={() => { if (session.current?.pointerId === undefined) cancel(); }}
          onClick={event => event.stopPropagation()}><Icon size={18} aria-hidden="true" /></button>
      </div>;
    })}
    {pickingAnchor ? <div ref={pickerElement} role="group" aria-label={`Pick ${pickingAnchor.label} on chart`} tabIndex={0}
      style={{ position: "absolute", inset: 0, pointerEvents: "auto", touchAction: "none", cursor: "crosshair", outlineOffset: -2 }}
      onPointerDown={event => { if (!(event.target as HTMLElement).closest("[data-pine-input-cancel]")) down(event, pickingAnchor, true); }}
      onPointerMove={move} onPointerUp={up} onPointerCancel={pointerCancel} onLostPointerCapture={pointerCancel}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); latest.current.picking?.onCancel(); }
        else if (!(event.target as HTMLElement).closest("[data-pine-input-cancel]")) key(event, pickingAnchor, true);
      }}>
      <div className="flex max-w-full items-center gap-2 border border-[var(--ui-border-strong)] bg-[var(--ui-floating)] p-2 text-xs text-[var(--text-primary)]" style={{ position: "absolute", top: 4, left: 4 }}>
        <span>Pick {pickingAnchor.label} on the chart</span>
        <button type="button" data-pine-input-cancel aria-label={`Cancel picking ${pickingAnchor.label}`} className="flex min-h-11 min-w-11 items-center justify-center text-[var(--text-secondary)]"
          onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); cancel(); latest.current.picking?.onCancel(); }}><X size={18} aria-hidden="true" /></button>
      </div>
    </div> : null}
  </div>, root);
}
