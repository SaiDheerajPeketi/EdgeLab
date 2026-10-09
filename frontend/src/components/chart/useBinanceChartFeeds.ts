import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getApiBearerToken, type Candle } from "../../lib/api";
import { getStoredAuthSession, subscribeAuthSession } from "../../lib/authSession";
import { binanceChartCandle, binanceChartEvent, binanceChartInterval } from "../../lib/binanceChartFeed";
import { trackDiagnosticWebSocket } from "../../lib/browserDiagnostics";
import { normalizeChartTimeframe, type ChartTimeframe } from "../../lib/charting";
import { createPineLiveFeed, pineFeedNextSourceTime, type PineLiveFeed } from "../../lib/pineLiveFeed";

export type BinanceChartData = { bars: Candle[]; feed: PineLiveFeed; status: "loading" | "available" | "error"; detail: string };
type Entry = { key: string; timeframe: ChartTimeframe; data: BinanceChartData; dispose(): void };

/** Distinct visible intervals own independent, shared-per-pane provider streams. */
export function useBinanceChartFeeds(symbol: string, timeframes: ChartTimeframe[], contextKey: string, enabled: boolean) {
  useSyncExternalStore(subscribeAuthSession, getStoredAuthSession, () => null);
  const owner = JSON.stringify([getStoredAuthSession()?.user.id ?? null, getApiBearerToken(), symbol, contextKey, enabled]);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const entries = useRef(new Map<string, Entry>());
  const [values, setValues] = useState<Record<string, { key: string; data: BinanceChartData }>>({});
  const frames = [...new Set(timeframes.map(normalizeChartTimeframe).filter((frame): frame is string =>
    Boolean(frame && frame !== "1m" && binanceChartInterval(frame))))].sort();
  const signature = JSON.stringify(frames);

  useEffect(() => {
    const wanted = enabled && /^[A-Z0-9]{1,40}$/.test(symbol) ? frames : [];
    for (const [frame, entry] of entries.current) {
      if (entry.key !== JSON.stringify([owner, frame]) || !wanted.includes(frame)) {
        entry.dispose();
        entries.current.delete(frame);
      }
    }
    for (const frame of wanted) {
      if (entries.current.has(frame)) continue;
      const key = JSON.stringify([owner, frame]), interval = binanceChartInterval(frame)!;
      const controller = new AbortController(), feed = createPineLiveFeed(symbol, frame);
      const socketUrl = `wss://data-stream.binance.vision/ws/${symbol.toLowerCase()}@kline_${interval}`;
      const socket = new WebSocket(socketUrl);
      trackDiagnosticWebSocket(socket, socketUrl);
      let active = true;
      const entry: Entry = { key, timeframe: frame,
        data: { feed, bars: [], status: "loading", detail: "Loading chart history…" },
        dispose: () => { active = false; controller.abort(); unsubscribe(); socket.close(); },
      };
      entries.current.set(frame, entry);
      const owns = () => active && currentOwner.current === owner && entries.current.get(frame) === entry;
      const publish = () => {
        if (!owns()) return;
        setValues(current => owns() ? { ...current, [frame]: { key, data: entry.data } } : current);
      };
      const unsubscribe = feed.subscribe(snapshot => {
        if (!owns()) return;
        entry.data = { feed, bars: [...snapshot.bars], status: snapshot.error ? "error" : snapshot.bars.length ? "available" : "loading",
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
      const query = new URLSearchParams({ symbol, interval, limit: "1000" });
      void fetch(`https://data-api.binance.vision/api/v3/klines?${query}`, { signal: controller.signal })
        .then(async response => {
          if (!response.ok) throw new Error("Chart history could not be loaded. Retry the feed.");
          const rows: unknown = await response.json();
          if (!Array.isArray(rows) || !rows.length || rows.length > 1000) throw new Error("No valid chart history was returned for this interval.");
          if (owns()) feed.seed(rows.map(row => {
            const bar = binanceChartCandle(row);
            if (!Array.isArray(row) || row[6] !== pineFeedNextSourceTime(bar.time, frame) * 1000 - 1) {
              throw new Error("The provider returned history for an invalid candle interval.");
            }
            return bar;
          }));
        }).catch(error => {
          if (!controller.signal.aborted) fail(error instanceof Error ? error.message : "Chart history could not be loaded. Retry the feed.");
        });
    }
    // The signature represents frames without restarting feeds on incoming bars.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, signature]);

  useEffect(() => () => {
    for (const entry of entries.current.values()) entry.dispose();
    entries.current.clear();
  }, []);

  return Object.fromEntries(frames.map(frame => {
    const value = values[frame];
    return [frame, value?.key === JSON.stringify([owner, frame]) && enabled ? value.data : undefined];
  })) as Record<string, BinanceChartData | undefined>;
}
