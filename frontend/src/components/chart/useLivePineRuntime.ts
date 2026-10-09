import { useEffect, useMemo, useRef, useState } from "react";
import type { Candle } from "../../lib/api";
import { getStoredAuthSession } from "../../lib/authSession";
import type { ChartIndicatorInstance, ChartTimeframe } from "../../lib/charting";
import { isPersistentPineIndicator, pineContextForChart, sanitizePinePrepared } from "../../lib/customIndicators";
import { pineFeedChartSnapshot, type PineFeedSnapshot, type PineLiveFeed } from "../../lib/pineLiveFeed";
import { createPineLiveMarketRuntime, createPineLiveRuntimeSession, createPineRuntimeJob, type PineLiveRuntimeSession } from "../../lib/pineRuntime";
import { binanceChartSymbolMatches } from "../../lib/pineInstrumentContext";
import { pineFeedNextSourceTime } from "../../lib/pineLiveFeed";
import { PINE_MARKETS_RELOADING } from "../../lib/pineLiveMarketCoordinator";
import { pineSourceSnapshotForChart } from "../../lib/pineSourceSnapshot";
import { PINE_LIMITS, PineProtocolError, type PineContext, type PineExecutionResult, type PineViewport } from "../../lib/pineProtocol";
import type { PineChartAlertHandle, PineChartAlertStore } from "../../lib/pineChartAlerts";

type Owner = { feed: PineLiveFeed; epoch: number; timeframe: ChartTimeframe; symbol: string; userId?: number | string; token?: string; key: string; metadataKey?: string; alertStore?: PineChartAlertStore; alertGeneration?: number };
export type LivePineStudy = { sourceId: string; owner: Owner; bars: Candle[]; viewport?: PineViewport | null; usesVisibleRange?: boolean; result?: PineExecutionResult; error?: string };
type Entry = { key: string; owner: Owner; sequence: number; bars: Candle[]; sourceOwned?: boolean; session?: PineLiveRuntimeSession; markets?: ReturnType<typeof createPineLiveMarketRuntime>; marketsReadyAfter?: number; startupMain?: PineFeedSnapshot[]; failed: boolean; usesVisibleRange?: boolean; viewport?: PineViewport | null; viewportInFlight?: boolean; failedViewport?: PineViewport | null; preparation?: ReturnType<typeof createPineRuntimeJob>; alert?: PineChartAlertHandle; alertName?: string };
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
  alerts?: { store: PineChartAlertStore; generation: number };
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
        && current.alerts?.store === options.alerts?.store && current.alerts?.generation === options.alerts?.generation
        && (!options.alerts || options.alerts.store.getGeneration() === options.alerts.generation)
        && auth?.user.id === options.userId && auth?.token === options.token;
    };
    const visible = () => latest.current.indicators.filter(indicator => indicator.visible !== false && isPersistentPineIndicator(indicator));
    const ownsStudy = (id: string, entry: Entry) => ownsContext() && entries.get(id) === entry
      && visible().some(indicator => indicator.id === id && signature(indicator) === entry.key);
    const registerAlert = (id: string, entry: Entry) => options.alerts?.store.register({ name: entry.alertName ?? "Pine indicator", symbol: options.symbol, timeframe: options.timeframe,
      readCurrent: () => { const current = feed.getSnapshot(); return { epoch: current.epoch, sequence: current.event?.sequence ?? -1, error: !!current.error }; },
      readConditions: () => {
        const state = entry.session?.readConditionState?.(), event = feed.getSnapshot().event;
        if (!state || !event) return;
        const end = (event.closeTime + 1) / 1000;
        const primaryCutoff = event.confirmed ? end : Math.max(event.bar.time, Math.min(event.eventTime / 1000, end));
        return Number.isFinite(primaryCutoff) ? { ...state, primaryCutoff } : undefined;
      },
      owns: () => ownsStudy(id, entry) && !entry.failed && feed.getSnapshot().epoch === entry.owner.epoch && !feed.getSnapshot().error });
    const report = (id: string, entry: Entry, failure: unknown, viewport: PineViewport | null | undefined, session?: PineLiveRuntimeSession) => {
      if (!ownsStudy(id, entry) || entry.failed) return;
      if (session && entry.session !== session) return;
      entry.alert?.disarm("Indicator restarted or stopped.");
      if (failure instanceof PineProtocolError && failure.code === PINE_MARKETS_RELOADING && entry.markets) {
        entry.alert?.dispose();
        entry.alert = registerAlert(id, entry);
        entry.session = undefined;
        entry.marketsReadyAfter = feed.getSnapshot().event?.sequence ?? entry.sequence;
        return;
      }
      entry.failed = true;
      entry.failedViewport = viewport ?? null;
      entry.session?.cancel();
      entry.markets?.cancel();
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
      const session = entry.session;
      entry.alert?.disarm("Chart view changed.");
      void session.setViewport(viewport).then(result => {
        if (entry.session === session && ownsStudy(id, entry) && !entry.failed && feed.getSnapshot().epoch === entry.owner.epoch && !feed.getSnapshot().error) {
          if (sameViewport(viewport, latest.current.viewport ?? null)) entry.alert?.setReady(result.alertConditions);
          publish(id, entry, result, bars, viewport);
        }
      }).catch(error => report(id, entry, error, viewport, session)).finally(() => {
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
    const started = (id: string, entry: Entry, session: PineLiveRuntimeSession, result: PineExecutionResult, bars: Candle[], viewport: PineViewport | null | undefined) => {
      if (!ownsStudy(id, entry) || entry.failed || entry.session !== session || feed.getSnapshot().epoch !== entry.owner.epoch || feed.getSnapshot().error) return;
      entry.alert?.setReady(result.alertConditions);
      publish(id, entry, result, bars, viewport);
    };
    const accept = (snapshot: PineFeedSnapshot) => {
      if (!ownsContext()) return;
      if (snapshot.epoch !== epoch) {
        epoch = snapshot.epoch;
        for (const entry of entries.values()) { entry.alert?.dispose(); entry.session?.cancel(); entry.markets?.cancel(); entry.preparation?.cancel(); }
        entries.clear();
        setStudies({});
      }
      const candidates = visible();
      for (const [id, entry] of entries) {
        const candidate = candidates.find(indicator => indicator.id === id);
        if (!candidate || signature(candidate) !== entry.key) {
          entry.alert?.dispose();
          entry.session?.cancel();
          entry.markets?.cancel();
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
          entry.alert?.dispose();
          entry.session?.cancel();
          entry.markets?.cancel();
          entry.preparation?.cancel();
          entry = undefined;
          recovering = true;
        }
        if (!entry) {
          const key = signature(indicator);
          const prepared = sanitizePinePrepared(indicator.settings.pineInputPrepared, indicator.customScriptSource!)
            ?? sanitizePinePrepared(indicator.customPinePrepared, indicator.customScriptSource!);
          entry = { key, owner: { feed, epoch, timeframe: options.timeframe, symbol: options.symbol, userId: options.userId, token: options.token, key, metadataKey: options.metadataKey, alertStore: options.alerts?.store, alertGeneration: options.alerts?.generation }, sequence: -1, bars: [], failed: false, viewport: latest.current.viewport ?? null, usesVisibleRange: recovering ? true : prepared?.usesVisibleRange };
          entries.set(indicator.id, entry);
          entry.alertName = prepared?.name ?? indicator.customScriptName ?? "Pine indicator";
          entry.alert = registerAlert(indicator.id, entry);
        }
        if (entry.failed) continue;
        rerange(indicator.id, entry);
        try {
          const chart = pineFeedChartSnapshot(snapshot, options.timeframe);
          if (!chart || !snapshot.event || snapshot.event.sequence <= entry.sequence) continue;
          if (!entry.session) {
            if (options.contextError) throw new Error(options.contextError);
            // Wait for a closed warmup candle; a shallow feed can gain history live.
            if (!chart.history.length) continue;
            entry.bars = recovering && chart.confirmed ? [...chart.history, chart.bar] : chart.history;
            const sourceBars = snapshot.bars.filter(bar => recovering && chart.confirmed ? bar.time <= snapshot.event!.bar.time : bar.time < snapshot.event!.bar.time);
            const sourceSnapshot = pineSourceSnapshotForChart(sourceBars, snapshot.sourceTimeframe ?? "1m", recovering && chart.confirmed ? entry.bars : [...entry.bars, chart.bar], options.timeframe);
            entry.sourceOwned = sourceSnapshot !== undefined;
            const input = { source: indicator.customScriptSource!, inputs: indicator.settings.customInputs,
              strategySettings: indicator.settings.pineStrategySettings,
              inputMetadata: sanitizePinePrepared(indicator.settings.pineInputPrepared, indicator.customScriptSource!) ?? sanitizePinePrepared(indicator.customPinePrepared, indicator.customScriptSource!),
              context: options.context ?? pineContextForChart(options.symbol, options.timeframe), bars: entry.bars, viewport: entry.viewport,
              sourceSnapshot, ...(recovering && chart.confirmed ? {} : { liveObservation: {
                bar: snapshot.event.bar, confirmed: snapshot.event.confirmed, eventTime: snapshot.event.eventTime, closeTime: snapshot.event.closeTime,
              } }) };
            if (binanceChartSymbolMatches(options.symbol, snapshot.symbol)) {
              if (!entry.markets) {
                const currentEntry = entry, asOf = pineFeedNextSourceTime(entry.bars.at(-1)!.time, options.timeframe);
                entry.startupMain = [snapshot];
                entry.markets = createPineLiveMarketRuntime(input, { provider: "binance", chartSymbol: snapshot.symbol, revision: `pine-live:${indicator.id.slice(0, 192)}:${epoch}`,
                  range: { from: entry.bars[0].time, to: asOf - 1 }, asOf,
                  owns: () => ownsStudy(indicator.id, currentEntry) && feed.getSnapshot().epoch === epoch && !feed.getSnapshot().error }, epoch);
                void entry.markets.promise.then(() => {
                  if (!ownsStudy(indicator.id, currentEntry) || currentEntry.failed) return;
                  currentEntry.marketsReadyAfter = feed.getSnapshot().event?.sequence ?? currentEntry.sequence;
                  if (currentEntry.markets!.hasRequestedMarkets()) { currentEntry.startupMain = undefined; return; }
                  // Without foreign data, the captured primary receipts remain
                  // causal and can keep the ordinary study's first-tick behavior.
                  const session = currentEntry.markets!.start({ ...input, id: "pine-live-primary-cutover", action: "run", mode: "live" });
                  if (!session) return;
                  currentEntry.session = session; currentEntry.bars = input.bars; currentEntry.sourceOwned = input.sourceSnapshot !== undefined;
                  const initialBars = currentEntry.bars, viewport = currentEntry.viewport;
                  void session.promise.then(result => started(indicator.id, currentEntry, session, result, initialBars, viewport))
                    .catch(error => report(indicator.id, currentEntry, error, viewport, session));
                  const received = currentEntry.startupMain ?? []; currentEntry.startupMain = undefined;
                  for (const item of received) accept(item);
                }).catch(error => report(indicator.id, currentEntry, error, currentEntry.viewport));
                void entry.markets.failure.catch(error => report(indicator.id, currentEntry, error, currentEntry.viewport));
                continue;
              }
              if (entry.marketsReadyAfter === undefined) {
                if (snapshot.event.sequence > (entry.startupMain?.at(-1)?.event?.sequence ?? -1)) {
                  if ((entry.startupMain?.length ?? 0) >= 32) throw new PineProtocolError("LIVE_QUEUE_LIMIT", "Live indicator startup exceeded its update buffer. Reapply the indicator.");
                  entry.startupMain?.push(snapshot);
                }
                continue;
              }
              if (snapshot.event.sequence <= entry.marketsReadyAfter) continue;
              entry.session = entry.markets.start({ ...input, id: "pine-live-market-cutover", action: "run", mode: "live" });
              if (!entry.session) continue;
            } else entry.session = createPineLiveRuntimeSession(input);
            const session = entry.session;
            const currentEntry = entry, initialBars = entry.bars, initialViewport = entry.viewport;
            void session.promise.then(result => started(indicator.id, currentEntry, session, result, initialBars, initialViewport))
              .catch(error => report(indicator.id, currentEntry, error, initialViewport, session));
          }
          entry.sequence = snapshot.event.sequence;
          // A completed tail belongs in historical warmup after a full reload;
          // only an actual unfinished tail receives a provisional update.
          if (recovering && chart.confirmed) continue;
          entry.bars = entry.bars.at(-1)?.time === chart.bar.time ? [...entry.bars.slice(0, -1), chart.bar] : [...entry.bars, chart.bar];
          const currentEntry = entry, bars = entry.bars, viewport = entry.viewport;
          const session = entry.session;
          const nonce = entry.alert?.capture(snapshot.epoch, snapshot.event.sequence);
          const collectConditions = nonce !== undefined && entry.alert?.collectConditions(nonce);
          void session.update(chart.bar, chart.confirmed, entry.sourceOwned ? { bar: snapshot.event.bar, confirmed: snapshot.event.confirmed } : undefined,
            nonce !== undefined && !collectConditions ? true : undefined, collectConditions ? true : undefined).then(result => {
            if (nonce !== undefined && ownsStudy(indicator.id, currentEntry) && !currentEntry.failed && currentEntry.session === session
              && feed.getSnapshot().epoch === snapshot.epoch && !feed.getSnapshot().error) currentEntry.alert?.receive(nonce, result.alertEvents, result.conditionSamples);
            publish(indicator.id, currentEntry, result, bars, viewport);
          })
            .catch(error => report(indicator.id, currentEntry, error, viewport, session));
        } catch (error) { report(indicator.id, entry, error, entry.viewport); }
      }
    };
    reconcile.current = () => accept(feed.getSnapshot());
    const unsubscribe = feed.subscribe(accept);
    return () => {
      active = false;
      reconcile.current = null;
      unsubscribe();
      for (const entry of entries.values()) { entry.alert?.dispose(); entry.session?.cancel(); entry.markets?.cancel(); entry.preparation?.cancel(); }
      entries.clear();
    };
  }, [options.feed, options.timeframe, options.symbol, options.userId, options.token, options.metadataKey, options.contextLoading, options.contextError, options.alerts?.store, options.alerts?.generation]);
  useEffect(() => { reconcile.current?.(); }, [options.indicators, options.viewport?.from, options.viewport?.to, options.viewport === null]);
  const currentAuth = getStoredAuthSession(), currentEpoch = options.feed?.getSnapshot().epoch;
  return useMemo(() => {
    return Object.values(studies).filter(study => {
      const owner = study.owner;
      return (study.usesVisibleRange !== true || sameViewport(study.viewport, options.viewport ?? null))
        && owner.feed === options.feed && owner.epoch === currentEpoch
        && owner.timeframe === options.timeframe && owner.symbol === options.symbol && owner.metadataKey === options.metadataKey
        && owner.alertStore === options.alerts?.store && owner.alertGeneration === options.alerts?.generation
        && (!options.alerts || options.alerts.store.getGeneration() === options.alerts.generation)
        && owner.userId === options.userId && owner.token === options.token
        && currentAuth?.user.id === owner.userId && currentAuth?.token === owner.token
        && options.indicators.some(indicator => indicator.id === study.sourceId && indicator.visible !== false
          && isPersistentPineIndicator(indicator) && signature(indicator) === owner.key);
    });
  }, [studies, options.feed, currentEpoch, options.timeframe, options.symbol, options.userId, options.token, options.indicators, options.metadataKey, currentAuth?.user.id, currentAuth?.token, options.viewport?.from, options.viewport?.to, options.viewport === null, options.alerts?.store, options.alerts?.generation]);
}
