import { useEffect, useMemo, useRef, useState } from "react";
import type { Candle } from "../../lib/api";
import { getStoredAuthSession } from "../../lib/authSession";
import type { ChartIndicatorInstance, ChartTimeframe } from "../../lib/charting";
import { isPersistentPineIndicator, pineContextForChart, sanitizePinePrepared } from "../../lib/customIndicators";
import { pineFeedChartSnapshot, type PineFeedSnapshot, type PineLiveFeed } from "../../lib/pineLiveFeed";
import { createPineLiveRuntimeSession, createPineRuntimeJob, type PineLiveRuntimeSession } from "../../lib/pineRuntime";
import { pineSourceSnapshotForChart } from "../../lib/pineSourceSnapshot";
import { PINE_LIMITS, type PineContext, type PineExecutionResult, type PineViewport } from "../../lib/pineProtocol";

type Owner = { feed: PineLiveFeed; epoch: number; timeframe: ChartTimeframe; symbol: string; userId?: number | string; token?: string; key: string; metadataKey?: string };
export type LivePineStudy = { sourceId: string; owner: Owner; bars: Candle[]; viewport?: PineViewport | null; usesVisibleRange?: boolean; result?: PineExecutionResult; error?: string };
type Entry = { key: string; owner: Owner; sequence: number; bars: Candle[]; sourceOwned?: boolean; session?: PineLiveRuntimeSession; failed: boolean; usesVisibleRange?: boolean; viewport?: PineViewport | null; viewportInFlight?: boolean; failedViewport?: PineViewport | null; preparation?: ReturnType<typeof createPineRuntimeJob> };
function sameViewport(a: PineViewport | null | undefined, b: PineViewport | null | undefined) {
  return a === b || (a != null && b != null && a.from === b.from && a.to === b.to);
}
function signature(indicator: ChartIndicatorInstance) {
  const metadata = indicator.settings.pineInputPrepared ?? indicator.customPinePrepared;
  const schema = Array.isArray(metadata?.inputDefinitions) && metadata.inputDefinitions.length <= PINE_LIMITS.inputs
    ? metadata.inputDefinitions.map((item) => [typeof item?.id === "string" ? item.id.slice(0, 96) : undefined, typeof item?.type === "string" ? item.type.slice(0, 32) : undefined, item?.enumVersion === 1 ? 1 : undefined]) : undefined;
  return JSON.stringify([indicator.customScriptSource, Object.entries(indicator.settings.customInputs ?? {}).sort(([a], [b]) => a.localeCompare(b)), Object.entries(indicator.settings.pineStrategySettings ?? {}).sort(([a], [b]) => a.localeCompare(b)), metadata?.source === indicator.customScriptSource, schema]);
}

/** Each visible study owns its session; other studies and React batching cannot reset it. */
export function useLivePineRuntime(options: {
  feed?: PineLiveFeed;
  context?: PineContext;
  /** Without a chart viewport, dependent studies receive the explicit empty range. */
  viewport?: PineViewport | null;
  contextLoading?: boolean;
  contextError?: string | null;
  metadataKey?: string;
  timeframe: ChartTimeframe;
  symbol: string;
  indicators: ChartIndicatorInstance[];
  userId?: number | string;
  token?: string;
  onRuntimeState?: (id: string, error: string | null) => void;
}): LivePineStudy[] {
  const [studies, setStudies] = useState<Record<string, LivePineStudy>>({});
  const latest = useRef(options);
  latest.current = options;
  const reconcile = useRef<(() => void) | null>(null);
  useEffect(() => {
    const feed = options.feed;
    setStudies({});
    if (!feed || options.contextLoading) return;
    const entries = new Map<string, Entry>();
    let active = true, epoch = feed.getSnapshot().epoch;
    const ownsContext = () => {
      const current = latest.current, auth = getStoredAuthSession();
      return active && current.feed === feed && current.timeframe === options.timeframe && current.symbol === options.symbol
        && current.userId === options.userId && current.token === options.token && current.metadataKey === options.metadataKey
        && auth?.user.id === options.userId && auth?.token === options.token;
    };
    const visible = () => latest.current.indicators.filter(indicator => indicator.visible !== false && isPersistentPineIndicator(indicator));
    const ownsStudy = (id: string, entry: Entry) => ownsContext() && entries.get(id) === entry
      && visible().some(indicator => indicator.id === id && signature(indicator) === entry.key);
    const report = (id: string, entry: Entry, failure: unknown, viewport: PineViewport | null | undefined) => {
      if (!ownsStudy(id, entry) || entry.failed) return;
      entry.failed = true;
      entry.failedViewport = viewport ?? null;
      entry.session?.cancel();
      const error = failure instanceof Error ? failure.message : "Live study execution failed.";
      setStudies(current => ({ ...current, [id]: { sourceId: id, owner: entry.owner, bars: entry.bars,
        usesVisibleRange: entry.usesVisibleRange, viewport: entry.failedViewport, error } }));
      latest.current.onRuntimeState?.(id, error);
      if (entry.usesVisibleRange === undefined) {
        // A failed execution has no result metadata. Learn only this owned source's
        // dependency; a failed preparation leaves the original execution error intact.
        const indicator = visible().find(item => item.id === id);
        if (!indicator?.customScriptSource) return;
        const preparation = createPineRuntimeJob({ action: "prepare", source: indicator.customScriptSource });
        entry.preparation = preparation;
        void preparation.promise.then(prepared => {
          if (!ownsStudy(id, entry) || !entry.failed || entry.preparation !== preparation || prepared.kind !== "prepare") return;
          entry.usesVisibleRange = prepared.usesVisibleRange;
          setStudies(current => {
            if (!ownsStudy(id, entry)) return current;
            const study = current[id];
            return study ? { ...current, [id]: { ...study, usesVisibleRange: prepared.usesVisibleRange } } : current;
          });
          if (prepared.usesVisibleRange === true) reconcile.current?.();
        }).catch(() => undefined).finally(() => {
          if (entry.preparation === preparation) entry.preparation = undefined;
        });
      } else if (entry.usesVisibleRange === true && !sameViewport(entry.failedViewport, latest.current.viewport ?? null)) {
        // The range can change while a failing command is still in flight.
        reconcile.current?.();
      }
    };
    // Viewport work shares the session's ordered queue with every actual feed tick.
    // Only one rerun can be in flight; a changing range is read again on completion.
    const rerange = (id: string, entry: Entry) => {
      if (!ownsStudy(id, entry) || entry.failed || !entry.session || entry.usesVisibleRange !== true
        || entry.viewportInFlight || sameViewport(entry.viewport, latest.current.viewport ?? null)) return;
      const viewport = latest.current.viewport ?? null;
      const bars = entry.bars;
      entry.viewport = viewport;
      entry.viewportInFlight = true;
      void entry.session.setViewport(viewport).then(result => publish(id, entry, result, bars, viewport))
        .catch(error => report(id, entry, error, viewport)).finally(() => {
          entry.viewportInFlight = false;
          rerange(id, entry);
        });
    };
    const publish = (id: string, entry: Entry, result: PineExecutionResult, bars: Candle[], viewport: PineViewport | null | undefined) => {
      if (!ownsStudy(id, entry) || entry.failed) return;
      entry.usesVisibleRange = result.usesVisibleRange;
      if (result.usesVisibleRange === true && !sameViewport(viewport, latest.current.viewport ?? null)) {
        rerange(id, entry);
        return;
      }
      // A held older command must never replace the latest accepted feed snapshot.
      if (bars !== entry.bars) return;
      setStudies(current => ({ ...current, [id]: { sourceId: id, owner: entry.owner, result, bars,
        viewport, usesVisibleRange: result.usesVisibleRange } }));
      const current = latest.current.indicators.find(indicator => indicator.id === id);
      if (current?.runtimeError) latest.current.onRuntimeState?.(id, null);
    };
    const accept = (snapshot: PineFeedSnapshot) => {
      if (!ownsContext()) return;
      if (snapshot.epoch !== epoch) {
        epoch = snapshot.epoch;
        for (const entry of entries.values()) { entry.session?.cancel(); entry.preparation?.cancel(); }
        entries.clear();
        setStudies({});
      }
      const candidates = visible();
      for (const [id, entry] of entries) {
        const candidate = candidates.find(indicator => indicator.id === id);
        if (!candidate || signature(candidate) !== entry.key) {
          entry.session?.cancel();
          entry.preparation?.cancel();
          entries.delete(id);
          setStudies(current => { const next = { ...current }; delete next[id]; return next; });
        }
      }
      for (const indicator of candidates) {
        let entry = entries.get(indicator.id);
        let recovering = false;
        if (entry?.failed) {
          if (entry.usesVisibleRange !== true || sameViewport(entry.failedViewport, latest.current.viewport ?? null)) continue;
          entry.session?.cancel();
          entry.preparation?.cancel();
          entry = undefined;
          recovering = true;
        }
        if (!entry) {
          const key = signature(indicator);
          const prepared = sanitizePinePrepared(indicator.settings.pineInputPrepared, indicator.customScriptSource!)
            ?? sanitizePinePrepared(indicator.customPinePrepared, indicator.customScriptSource!);
          entry = { key, owner: { feed, epoch, timeframe: options.timeframe, symbol: options.symbol, userId: options.userId, token: options.token, key, metadataKey: options.metadataKey }, sequence: -1, bars: [], failed: false, viewport: latest.current.viewport ?? null, usesVisibleRange: recovering ? true : prepared?.usesVisibleRange };
          entries.set(indicator.id, entry);
        }
        if (entry.failed) continue;
        rerange(indicator.id, entry);
        try {
          const chart = pineFeedChartSnapshot(snapshot, options.timeframe);
          if (!chart || !snapshot.event || snapshot.event.sequence <= entry.sequence) continue;
          if (!entry.session) {
            if (options.contextError) throw new Error(options.contextError);
            if (!chart.history.length) throw new Error("There are no earlier closed candles for this timeframe. Choose a shorter timeframe or load more history.");
            entry.bars = recovering && chart.confirmed ? [...chart.history, chart.bar] : chart.history;
            const sourceBars = snapshot.bars.filter(bar => recovering && chart.confirmed ? bar.time <= snapshot.event!.bar.time : bar.time < snapshot.event!.bar.time);
            const sourceSnapshot = pineSourceSnapshotForChart(sourceBars, snapshot.sourceTimeframe ?? "1m", recovering && chart.confirmed ? entry.bars : [...entry.bars, chart.bar], options.timeframe);
            entry.sourceOwned = sourceSnapshot !== undefined;
            entry.session = createPineLiveRuntimeSession({ source: indicator.customScriptSource!, inputs: indicator.settings.customInputs,
              strategySettings: indicator.settings.pineStrategySettings,
              inputMetadata: sanitizePinePrepared(indicator.settings.pineInputPrepared, indicator.customScriptSource!) ?? sanitizePinePrepared(indicator.customPinePrepared, indicator.customScriptSource!),
              context: options.context ?? pineContextForChart(options.symbol, options.timeframe), bars: entry.bars, viewport: entry.viewport,
              sourceSnapshot });
            const currentEntry = entry, initialBars = entry.bars, initialViewport = entry.viewport;
            void entry.session.promise.then(result => publish(indicator.id, currentEntry, result, initialBars, initialViewport))
              .catch(error => report(indicator.id, currentEntry, error, initialViewport));
          }
          entry.sequence = snapshot.event.sequence;
          // A completed tail belongs in historical warmup after a full reload;
          // only an actual unfinished tail receives a provisional update.
          if (recovering && chart.confirmed) continue;
          entry.bars = entry.bars.at(-1)?.time === chart.bar.time ? [...entry.bars.slice(0, -1), chart.bar] : [...entry.bars, chart.bar];
          const currentEntry = entry, bars = entry.bars, viewport = entry.viewport;
          void entry.session.update(chart.bar, chart.confirmed, entry.sourceOwned ? { bar: snapshot.event.bar, confirmed: snapshot.event.confirmed } : undefined).then(result => publish(indicator.id, currentEntry, result, bars, viewport))
            .catch(error => report(indicator.id, currentEntry, error, viewport));
        } catch (error) { report(indicator.id, entry, error, entry.viewport); }
      }
    };
    reconcile.current = () => accept(feed.getSnapshot());
    const unsubscribe = feed.subscribe(accept);
    return () => {
      active = false;
      reconcile.current = null;
      unsubscribe();
      for (const entry of entries.values()) { entry.session?.cancel(); entry.preparation?.cancel(); }
      entries.clear();
    };
  }, [options.feed, options.timeframe, options.symbol, options.userId, options.token, options.metadataKey, options.contextLoading, options.contextError]);
  useEffect(() => { reconcile.current?.(); }, [options.indicators, options.viewport?.from, options.viewport?.to, options.viewport === null]);
  const currentAuth = getStoredAuthSession(), currentEpoch = options.feed?.getSnapshot().epoch;
  return useMemo(() => {
    return Object.values(studies).filter(study => {
      const owner = study.owner;
      return (study.usesVisibleRange !== true || sameViewport(study.viewport, options.viewport ?? null))
        && owner.feed === options.feed && owner.epoch === currentEpoch
        && owner.timeframe === options.timeframe && owner.symbol === options.symbol && owner.metadataKey === options.metadataKey
        && owner.userId === options.userId && owner.token === options.token
        && currentAuth?.user.id === owner.userId && currentAuth?.token === owner.token
        && options.indicators.some(indicator => indicator.id === study.sourceId && indicator.visible !== false
          && isPersistentPineIndicator(indicator) && signature(indicator) === owner.key);
    });
  }, [studies, options.feed, currentEpoch, options.timeframe, options.symbol, options.userId, options.token, options.indicators, options.metadataKey, currentAuth?.user.id, currentAuth?.token, options.viewport?.from, options.viewport?.to, options.viewport === null]);
}
