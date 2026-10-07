import { useEffect, useMemo, useRef, useState } from "react";
import type { Candle } from "../../lib/api";
import { getStoredAuthSession } from "../../lib/authSession";
import type { ChartIndicatorInstance, ChartTimeframe } from "../../lib/charting";
import { isPersistentPineIndicator, pineContextForChart } from "../../lib/customIndicators";
import { pineFeedChartSnapshot, type PineFeedSnapshot, type PineLiveFeed } from "../../lib/pineLiveFeed";
import { createPineLiveRuntimeSession, type PineLiveRuntimeSession } from "../../lib/pineRuntime";
import type { PineExecutionResult } from "../../lib/pineProtocol";

type Owner = { feed: PineLiveFeed; epoch: number; timeframe: ChartTimeframe; symbol: string; userId?: number | string; token?: string; key: string };
export type LivePineStudy = { sourceId: string; owner: Owner; bars: Candle[]; result?: PineExecutionResult; error?: string };
type Entry = { key: string; owner: Owner; sequence: number; bars: Candle[]; session?: PineLiveRuntimeSession; failed: boolean };
function signature(indicator: ChartIndicatorInstance) {
  return JSON.stringify([indicator.customScriptSource, Object.entries(indicator.settings.customInputs ?? {}).sort(([a], [b]) => a.localeCompare(b))]);
}

/** Each visible study owns its session; other studies and React batching cannot reset it. */
export function useLivePineRuntime(options: {
  feed?: PineLiveFeed;
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
    if (!feed) return;
    const entries = new Map<string, Entry>();
    let active = true, epoch = feed.getSnapshot().epoch;
    const ownsContext = () => {
      const current = latest.current, auth = getStoredAuthSession();
      return active && current.feed === feed && current.timeframe === options.timeframe && current.symbol === options.symbol
        && current.userId === options.userId && current.token === options.token
        && auth?.user.id === options.userId && auth?.token === options.token;
    };
    const visible = () => latest.current.indicators.filter(indicator => indicator.visible !== false && isPersistentPineIndicator(indicator));
    const ownsStudy = (id: string, entry: Entry) => ownsContext() && entries.get(id) === entry
      && visible().some(indicator => indicator.id === id && signature(indicator) === entry.key);
    const report = (id: string, entry: Entry, failure: unknown) => {
      if (!ownsStudy(id, entry) || entry.failed) return;
      entry.failed = true;
      entry.session?.cancel();
      const error = failure instanceof Error ? failure.message : "Live indicator execution failed.";
      setStudies(current => ({ ...current, [id]: { sourceId: id, owner: entry.owner, bars: entry.bars, error } }));
      latest.current.onRuntimeState?.(id, error);
    };
    const publish = (id: string, entry: Entry, result: PineExecutionResult, bars: Candle[]) => {
      if (!ownsStudy(id, entry) || entry.failed) return;
      setStudies(current => ({ ...current, [id]: { sourceId: id, owner: entry.owner, result, bars } }));
      const current = latest.current.indicators.find(indicator => indicator.id === id);
      if (current?.runtimeError) latest.current.onRuntimeState?.(id, null);
    };
    const accept = (snapshot: PineFeedSnapshot) => {
      if (!ownsContext()) return;
      if (snapshot.epoch !== epoch) {
        epoch = snapshot.epoch;
        for (const entry of entries.values()) entry.session?.cancel();
        entries.clear();
        setStudies({});
      }
      const candidates = visible();
      for (const [id, entry] of entries) {
        const candidate = candidates.find(indicator => indicator.id === id);
        if (!candidate || signature(candidate) !== entry.key) {
          entry.session?.cancel();
          entries.delete(id);
          setStudies(current => { const next = { ...current }; delete next[id]; return next; });
        }
      }
      for (const indicator of candidates) {
        let entry = entries.get(indicator.id);
        if (!entry) {
          const key = signature(indicator);
          entry = { key, owner: { feed, epoch, timeframe: options.timeframe, symbol: options.symbol, userId: options.userId, token: options.token, key }, sequence: -1, bars: [], failed: false };
          entries.set(indicator.id, entry);
        }
        if (entry.failed) continue;
        try {
          const chart = pineFeedChartSnapshot(snapshot, options.timeframe);
          if (!chart || !snapshot.event || snapshot.event.sequence <= entry.sequence) continue;
          if (!entry.session) {
            if (!chart.history.length) throw new Error("There are no earlier closed candles for this timeframe. Choose a shorter timeframe or load more history.");
            entry.bars = chart.history;
            entry.session = createPineLiveRuntimeSession({ source: indicator.customScriptSource!, inputs: indicator.settings.customInputs,
              context: pineContextForChart(options.symbol, options.timeframe), bars: chart.history });
            const currentEntry = entry, initialBars = entry.bars;
            void entry.session.promise.then(result => publish(indicator.id, currentEntry, result, initialBars))
              .catch(error => report(indicator.id, currentEntry, error));
          }
          entry.sequence = snapshot.event.sequence;
          entry.bars = entry.bars.at(-1)?.time === chart.bar.time ? [...entry.bars.slice(0, -1), chart.bar] : [...entry.bars, chart.bar];
          const currentEntry = entry, bars = entry.bars;
          void entry.session.update(chart.bar, chart.confirmed).then(result => publish(indicator.id, currentEntry, result, bars))
            .catch(error => report(indicator.id, currentEntry, error));
        } catch (error) { report(indicator.id, entry, error); }
      }
    };
    reconcile.current = () => accept(feed.getSnapshot());
    const unsubscribe = feed.subscribe(accept);
    return () => {
      active = false;
      reconcile.current = null;
      unsubscribe();
      for (const entry of entries.values()) entry.session?.cancel();
      entries.clear();
    };
  }, [options.feed, options.timeframe, options.symbol, options.userId, options.token]);
  useEffect(() => { reconcile.current?.(); }, [options.indicators]);
  const currentAuth = getStoredAuthSession(), currentEpoch = options.feed?.getSnapshot().epoch;
  return useMemo(() => {
    return Object.values(studies).filter(study => {
      const owner = study.owner;
      return owner.feed === options.feed && owner.epoch === currentEpoch
        && owner.timeframe === options.timeframe && owner.symbol === options.symbol
        && owner.userId === options.userId && owner.token === options.token
        && currentAuth?.user.id === owner.userId && currentAuth?.token === owner.token
        && options.indicators.some(indicator => indicator.id === study.sourceId && indicator.visible !== false
          && isPersistentPineIndicator(indicator) && signature(indicator) === owner.key);
    });
  }, [studies, options.feed, currentEpoch, options.timeframe, options.symbol, options.userId, options.token, options.indicators, currentAuth?.user.id, currentAuth?.token]);
}
