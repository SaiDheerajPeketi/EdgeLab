import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getApiBearerToken, type Candle } from "../../lib/api";
import { getStoredAuthSession, subscribeAuthSession } from "../../lib/authSession";
import { binanceChartEvent, binanceChartPlan, loadBinanceChartHistory, type BinanceChartPlan } from "../../lib/binanceChartFeed";
import { trackDiagnosticWebSocket } from "../../lib/browserDiagnostics";
import { normalizeChartTimeframe, type ChartTimeframe } from "../../lib/charting";
import { trimChartSourceWindow } from "../../lib/chartSourceWindow";
import { createPineLiveFeed, type PineLiveFeed } from "../../lib/pineLiveFeed";

export type BinanceChartData = { bars: Candle[]; sourceTimeframe: ChartTimeframe; requestedBars: number; feed: PineLiveFeed; status: "loading" | "available" | "error"; detail: string };
export type BinanceChartDescriptor = { id: string; symbol: string; timeframe: ChartTimeframe };
type Entry = { key: string; targetBars: number; data: BinanceChartData; dispose(): void };

/** Visible panes share only the same canonical symbol and actual source interval. */
export function useBinanceChartFeeds(panes: BinanceChartDescriptor[], contextKey: string, enabled = true) {
  useSyncExternalStore(subscribeAuthSession, getStoredAuthSession, () => null);
  const owner = JSON.stringify([getStoredAuthSession()?.user.id ?? null, getApiBearerToken(), contextKey, enabled]);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const entries = useRef(new Map<string, Entry>());
  const [values, setValues] = useState<Record<string, { key: string; data: BinanceChartData }>>({});
  const requests = panes.flatMap(pane => {
    const frame = normalizeChartTimeframe(pane.timeframe);
    return frame && binanceChartPlan(frame) && /^[A-Z0-9]{1,40}$/.test(pane.symbol)
      ? [{ id: pane.id, symbol: pane.symbol, timeframe: frame }] : [];
  }).sort((a, b) => a.id.localeCompare(b.id));
  const signature = JSON.stringify(requests);
  const plans = useMemo(() => requests.map(pane => ({ ...binanceChartPlan(pane.timeframe)!, id: pane.id, symbol: pane.symbol })), [signature]);
  const sourcePlans = useMemo(() => {
    const groups = new Map<string, BinanceChartPlan & { symbol: string }>();
    for (const plan of plans) {
      const source = JSON.stringify([plan.symbol, plan.sourceTimeframe]);
      const previous = groups.get(source);
      if (!previous || previous.targetBars < plan.targetBars) groups.set(source, plan);
    }
    return [...groups.values()];
  }, [plans]);

  useEffect(() => {
    const wanted = enabled ? sourcePlans : [];
    for (const [source, entry] of entries.current) {
      const plan = wanted.find(plan => JSON.stringify([plan.symbol, plan.sourceTimeframe]) === source);
      if (entry.key !== JSON.stringify([owner, source]) || !plan || plan.targetBars > entry.targetBars) {
        entry.dispose();
        entries.current.delete(source);
      }
    }
    for (const plan of wanted) {
      const frame = plan.sourceTimeframe, symbol = plan.symbol, source = JSON.stringify([symbol, frame]);
      if (entries.current.has(source)) continue;
      const key = JSON.stringify([owner, source]), interval = plan.interval;
      const controller = new AbortController(), feed = createPineLiveFeed(symbol, frame);
      const socketUrl = `wss://data-stream.binance.vision/ws/${symbol.toLowerCase()}@kline_${interval}`;
      const socket = new WebSocket(socketUrl);
      trackDiagnosticWebSocket(socket, socketUrl);
      let active = true;
      const entry: Entry = { key, targetBars: plan.targetBars,
        data: { feed, bars: [], sourceTimeframe: frame, requestedBars: plan.targetBars, status: "loading", detail: "Loading chart history…" },
        dispose: () => { active = false; controller.abort(); unsubscribe(); socket.close(); },
      };
      entries.current.set(source, entry);
      const owns = () => active && currentOwner.current === owner && entries.current.get(source) === entry;
      const publish = () => {
        if (!owns()) return;
        setValues(current => owns() ? { ...current, [source]: { key, data: entry.data } } : current);
      };
      const unsubscribe = feed.subscribe(snapshot => {
        if (!owns()) return;
        entry.data = { feed, sourceTimeframe: frame, requestedBars: plan.targetBars, bars: [...snapshot.bars], status: snapshot.error ? "error" : snapshot.bars.length ? "available" : "loading",
          detail: snapshot.error ?? (snapshot.bars.length ? "Live provider candles." : "Loading chart history…") };
        publish();
      });
      const fail = (message: string) => { if (owns()) feed.fail(message); };
      socket.onerror = () => fail("The chart feed disconnected. Retry the feed to reconnect.");
      socket.onclose = () => fail("The chart feed disconnected. Retry the feed to reconnect.");
      socket.onmessage = event => {
        if (!owns()) return;
        try {
          const tick = binanceChartEvent(JSON.parse(String(event.data)), symbol, interval);
          feed.receive(tick.bar, tick.confirmed, tick.eventTime, tick.closeTime);
        } catch { fail("The provider returned an invalid candle update. Retry the feed."); }
      };
      void loadBinanceChartHistory(symbol, plan, { signal: controller.signal, owns })
        .then(history => { if (owns()) feed.seed(history); }).catch(error => {
          if (!controller.signal.aborted) fail(error instanceof Error ? error.message : "Chart history could not be loaded. Retry the feed.");
        });
    }
    // Retired markets must not accumulate full candle windows in component state.
    setValues(current => {
      const retained = Object.entries(current).filter(([source, value]) => entries.current.get(source)?.key === value.key);
      return retained.length === Object.keys(current).length ? current : Object.fromEntries(retained);
    });
    // The signature represents frames without restarting feeds on incoming bars.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, signature]);

  useEffect(() => () => {
    for (const entry of entries.current.values()) entry.dispose();
    entries.current.clear();
  }, []);

  return useMemo(() => Object.fromEntries(plans.map(plan => {
    const source = JSON.stringify([plan.symbol, plan.sourceTimeframe]), value = values[source];
    const data = value?.key === JSON.stringify([owner, source]) && enabled
      && value.data.requestedBars >= plan.targetBars ? value.data : undefined;
    if (!data) return [plan.id, undefined];
    const bars = trimChartSourceWindow(data.bars, plan.chartTimeframe) as Candle[];
    return [plan.id, bars === data.bars ? data : { ...data, bars,
      status: bars.length || data.status === "error" ? data.status : "loading",
      detail: bars.length || data.status === "error" ? data.detail : "Waiting for the candle's opening data…" }];
  })) as Record<string, BinanceChartData | undefined>, [plans, values, owner, enabled]);
}
