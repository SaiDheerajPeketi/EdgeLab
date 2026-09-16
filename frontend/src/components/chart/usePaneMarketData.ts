import { useEffect, useMemo, useState } from "react";
import type { Candle } from "../../lib/api";
import { getTimeframeSeconds } from "../../lib/charting";
import { createMarketSubscription, deleteMarketSubscription, loadNormalizedCandles, resolveMarketInstrument, type MarketInstrument } from "../../lib/marketInfrastructure";
import { planPaneSubscriptions, type PaneSubscriptionDescriptor } from "../../lib/paneSubscriptions";

export type PaneMarketDescriptor = PaneSubscriptionDescriptor;
export type PaneMarketData = { bars: Candle[]; detail: string; instrument: MarketInstrument | null; status: "loading" | "available" | "empty" | "unavailable" | "error"; updatedAt: string | null };

type SharedSubscription = { leases: number; subscriptionId: Promise<string | null> };
const sharedSubscriptions = new Map<string, SharedSubscription>();

function acquireMarketSubscription(key: string, payload: { pane_id: string; instrument_id: number }) {
  const existing = sharedSubscriptions.get(key);
  if (existing) {
    existing.leases += 1;
    return existing.subscriptionId;
  }
  const subscriptionId = createMarketSubscription({ ...payload, channels: ["CANDLES", "DEPTH", "DIAGNOSTICS"] })
    .then((subscription) => subscription.subscription_id)
    .catch(() => null);
  sharedSubscriptions.set(key, { leases: 1, subscriptionId });
  return subscriptionId;
}

function releaseMarketSubscription(key: string) {
  const subscription = sharedSubscriptions.get(key);
  if (!subscription) return;
  subscription.leases -= 1;
  if (subscription.leases > 0) return;
  sharedSubscriptions.delete(key);
  void subscription.subscriptionId.then((subscriptionId) => {
    if (subscriptionId) void deleteMarketSubscription(subscriptionId).catch(() => undefined);
  });
}

export function usePaneMarketData(panes: PaneMarketDescriptor[], enabled = true) {
  const [data, setData] = useState<Record<string, PaneMarketData>>({});
  const signature = useMemo(() => panes.map((pane) => `${pane.id}:${pane.symbol}:${pane.timeframe}:${pane.fromAt ?? ""}:${pane.toAt ?? ""}`).join("|"), [panes]);

  useEffect(() => {
    if (!enabled || !panes.length) return undefined;
    let active = true;
    const subscriptionKeys: string[] = [];
    const timers: number[] = [];
    const groups = planPaneSubscriptions(panes);

    const loadGroup = async ({ key, leader: pane, paneIds }: ReturnType<typeof planPaneSubscriptions>[number]) => {
      setData((current) => Object.fromEntries(Object.entries(current).concat(paneIds.map((paneId) => [paneId, current[paneId]?.status === "available" ? current[paneId] : { bars: [], instrument: null, status: "loading", detail: `Resolving ${pane.symbol}…`, updatedAt: null }]))));
      try {
        const instrument = await resolveMarketInstrument(pane.symbol);
        if (!active) return;
        if (!instrument) {
          setData((current) => ({ ...current, ...Object.fromEntries(paneIds.map((paneId) => [paneId, { bars: [], instrument: null, status: "unavailable", detail: `${pane.symbol} is not present in the normalized instrument catalog.`, updatedAt: null }])) }));
          return;
        }
        subscriptionKeys.push(key);
        await acquireMarketSubscription(key, { pane_id: pane.id, instrument_id: instrument.id });
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
            const updatedAt = new Date().toISOString();
            setData((current) => ({ ...current, ...Object.fromEntries(paneIds.map((paneId) => [paneId, { bars, instrument, status: bars.length ? "available" : "empty", detail: bars.length ? `${bars.length} normalized candles shared across ${paneIds.length} pane${paneIds.length === 1 ? "" : "s"} for ${instrument.canonical_symbol}.` : `No normalized ${pane.timeframe} candles are available for ${instrument.canonical_symbol}.`, updatedAt }])) }));
          } catch (error) {
            if (!active) return;
            setData((current) => ({ ...current, ...Object.fromEntries(paneIds.map((paneId) => [paneId, { bars: current[paneId]?.bars ?? [], instrument, status: "error", detail: error instanceof Error ? error.message : `Could not load ${pane.symbol}.`, updatedAt: current[paneId]?.updatedAt ?? null }])) }));
          }
        };
        await refresh();
        if (active) timers.push(window.setInterval(() => void refresh(), 5_000));
      } catch (error) {
        if (active) setData((current) => ({ ...current, ...Object.fromEntries(paneIds.map((paneId) => [paneId, { bars: [], instrument: null, status: "error", detail: error instanceof Error ? error.message : `Could not resolve ${pane.symbol}.`, updatedAt: null }])) }));
      }
    };

    groups.forEach((group) => void loadGroup(group));
    return () => {
      active = false;
      timers.forEach((timer) => window.clearInterval(timer));
      subscriptionKeys.forEach(releaseMarketSubscription);
    };
  // `signature` intentionally represents the complete subscription identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, signature]);

  return data;
}
