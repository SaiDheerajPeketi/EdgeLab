import { useEffect, useRef, useState } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { Candle } from "../lib/api";
import type { PineInputValue } from "../lib/pineProtocol";
import { pineAnchorActive, pineInputAnchors } from "../lib/pineInteractiveInputs";
import { registerPineChartInputPicker, type PineChartInputPick } from "../lib/pineChartInputPicker";
import { PineInputAnchors } from "./PineInputAnchors";

type Target = {
  chart: IChartApi;
  series: Pick<ISeriesApi<"Line">, "priceToCoordinate" | "coordinateToPrice">;
  bars: readonly Candle[];
};
type Pending = {
  request: PineChartInputPick;
  values: Record<string, PineInputValue>;
  index: number;
  id: number;
  finish: (values: Record<string, PineInputValue> | null) => void;
};

export function PineChartInputPicker({ symbol, timeframe, owner, contextKey, enabled, target }: {
  symbol: string; timeframe: string; owner: string; contextKey: string; enabled: boolean; target: Target | null;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const serial = useRef(0);
  const targetRef = useRef(target);
  targetRef.current = target;
  useEffect(() => {
    if (!enabled || !target) return;
    const unregister = registerPineChartInputPicker({ symbol, timeframe, owner, pick(request, signal) {
      pendingRef.current?.finish(null);
      if (signal.aborted || !targetRef.current?.bars.length) return Promise.resolve(null);
      const anchors = pineInputAnchors(request.definitions);
      if (!request.anchorIds.length || request.anchorIds.length > 24 || new Set(request.anchorIds).size !== request.anchorIds.length
        || request.anchorIds.some(id => !anchors.some(anchor => anchor.id === id && pineAnchorActive(anchor, request.definitions, request.inputs)))) {
        return Promise.reject(new Error("These chart input anchors are no longer available."));
      }
      return new Promise(resolve => {
        const id = ++serial.current;
        let finished = false;
        const finish = (values: Record<string, PineInputValue> | null) => {
          if (finished) return;
          finished = true;
          signal.removeEventListener("abort", abort);
          if (pendingRef.current?.id === id) {
            pendingRef.current = null;
            setPending(null);
          }
          resolve(values);
        };
        const abort = () => finish(null);
        signal.addEventListener("abort", abort, { once: true });
        const next = { id, request, index: 0, values: { ...request.inputs }, finish };
        pendingRef.current = next;
        setPending(next);
        if (signal.aborted) finish(null);
      });
    } });
    return () => {
      unregister();
      pendingRef.current?.finish(null);
    };
  }, [enabled, symbol, timeframe, owner, contextKey, target?.chart, target?.series]);

  if (!enabled || !pending || !target) return null;
  const anchors = pineInputAnchors(pending.request.definitions);
  const anchor = anchors.find(item => item.id === pending.request.anchorIds[pending.index]);
  const cancel = () => pendingRef.current?.finish(null);
  const accept = (patch: Record<string, PineInputValue>) => {
    const current = pendingRef.current;
    if (current !== pending || !anchor || !pineAnchorActive(anchor, current.request.definitions, current.values)) return;
    const values = { ...current.values, ...patch };
    const nextIndex = current.request.anchorIds.findIndex((id, index) => index > current.index
      && anchors.some(item => item.id === id && pineAnchorActive(item, current.request.definitions, values)));
    if (nextIndex === -1) current.finish(values);
    else {
      const next = { ...current, values, index: nextIndex };
      pendingRef.current = next;
      setPending(next);
    }
  };
  return <>
    <div role="status" className="absolute left-3 right-3 top-3 z-50 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--ui-border-strong)] bg-[var(--ui-floating)] px-3 py-2 text-sm text-[var(--text-primary)] shadow-lg">
      <span>Choose {anchor?.label ?? "input"} · {pending.index + 1} of {pending.request.anchorIds.length}</span>
      <button className="min-h-11 rounded px-3 hover:bg-[var(--ui-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]" onClick={cancel} type="button">Cancel input selection</button>
    </div>
    {anchor && <PineInputAnchors {...target} contextKey={`${contextKey}:pick:${pending.id}:${pending.index}`}
      definitions={pending.request.definitions} inputs={pending.values} onCommit={accept}
      picking={{ anchorId: anchor.id, onPick: accept, onCancel: cancel }} />}
  </>;
}
