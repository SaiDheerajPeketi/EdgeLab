import { useEffect, useMemo, useState } from "react";
import type { Candle } from "../../lib/api";
import { getTimeframeSeconds, type ChartTimeframe } from "../../lib/charting";
import { createMarketSubscription, deleteMarketSubscription, loadNormalizedCandles, resolveMarketInstrument, type MarketInstrument } from "../../lib/marketInfrastructure";

export type PaneMarketDescriptor = {
  id: string;
  symbol: string;
  timeframe: ChartTimeframe;
  fromAt?: string;
  toAt?: string;
};
export type PaneMarketData = { bars: Candle[]; detail: string; instrument: MarketInstrument | null; status: "loading" | "available" | "empty" | "unavailable" | "error"; updatedAt: string | null };

export function usePaneMarketData(panes: PaneMarketDescriptor[], enabled = true) {
  const [data, setData] = useState<Record<string, PaneMarketData>>({});
  const signature = useMemo(() => panes.map((pane) => `${pane.id}:${pane.symbol}:${pane.timeframe}:${pane.fromAt ?? ""}:${pane.toAt ?? ""}`).join("|"), [panes]);

  useEffect(() => {
    if (!enabled || !panes.length) return undefined;
    let active = true;
    const subscriptions: string[] = [];
    const timers: number[] = [];
    const currentPanes = panes.map((pane) => ({ ...pane }));

    const loadPane = async (pane: PaneMarketDescriptor) => {
      setData((current) => ({ ...current, [pane.id]: current[pane.id]?.status === "available" ? current[pane.id] : { bars: [], instrument: null, status: "loading", detail: `Resolving ${pane.symbol}…`, updatedAt: null } }));
      try {
        const instrument = await resolveMarketInstrument(pane.symbol);
        if (!active) return;
        if (!instrument) {
          setData((current) => ({ ...current, [pane.id]: { bars: [], instrument: null, status: "unavailable", detail: `${pane.symbol} is not present in the normalized instrument catalog.`, updatedAt: null } }));
          return;
        }
        try {
          const subscription = await createMarketSubscription({ pane_id: pane.id, instrument_id: instrument.id, channels: ["CANDLES", "DEPTH", "DIAGNOSTICS"] });
          if (active) subscriptions.push(subscription.subscription_id);
          else void deleteMarketSubscription(subscription.subscription_id).catch(() => undefined);
        } catch {
          // Snapshot reads still work when the ephemeral fan-out subscription is unavailable.
        }
        const refresh = async () => {
          try {
            const requestedFrom = pane.fromAt ? new Date(pane.fromAt) : null;
            const requestedTo = pane.toAt ? new Date(pane.toAt) : null;
            const requestedWindow = requestedFrom && requestedTo
              && Number.isFinite(requestedFrom.getTime())
              && Number.isFinite(requestedTo.getTime())
              && requestedTo.getTime() > requestedFrom.getTime()
              ? { from: requestedFrom, to: requestedTo, limit: 5_000 }
              : { limit: 600 };
            const bars = await loadNormalizedCandles(
              instrument.id,
              getTimeframeSeconds(pane.timeframe),
              requestedWindow,
            );
            if (!active) return;
            setData((current) => ({ ...current, [pane.id]: { bars, instrument, status: bars.length ? "available" : "empty", detail: bars.length ? `${bars.length} normalized candles subscribed for ${instrument.canonical_symbol}.` : `No normalized ${pane.timeframe} candles are available for ${instrument.canonical_symbol}.`, updatedAt: new Date().toISOString() } }));
          } catch (error) {
            if (!active) return;
            setData((current) => ({ ...current, [pane.id]: { bars: current[pane.id]?.bars ?? [], instrument, status: "error", detail: error instanceof Error ? error.message : `Could not load ${pane.symbol}.`, updatedAt: current[pane.id]?.updatedAt ?? null } }));
          }
        };
        await refresh();
        if (active) timers.push(window.setInterval(() => void refresh(), 5_000));
      } catch (error) {
        if (active) setData((current) => ({ ...current, [pane.id]: { bars: [], instrument: null, status: "error", detail: error instanceof Error ? error.message : `Could not resolve ${pane.symbol}.`, updatedAt: null } }));
      }
    };

    currentPanes.forEach((pane) => void loadPane(pane));
    return () => {
      active = false;
      timers.forEach((timer) => window.clearInterval(timer));
      subscriptions.forEach((subscriptionId) => void deleteMarketSubscription(subscriptionId).catch(() => undefined));
    };
  // `signature` intentionally represents the complete subscription identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, signature]);

  return data;
}
