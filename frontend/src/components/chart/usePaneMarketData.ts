import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getApiBearerToken, type Candle } from "../../lib/api";
import { getStoredAuthSession, subscribeAuthSession } from "../../lib/authSession";
import { getTimeframeSeconds } from "../../lib/charting";
import { createMarketSubscription, deleteMarketSubscription, loadNormalizedCandles, resolveMarketInstrument, type MarketInstrument } from "../../lib/marketInfrastructure";
import { paneSubscriptionKey, planPaneSubscriptions, type PaneSubscriptionDescriptor } from "../../lib/paneSubscriptions";

export type PaneMarketDescriptor = PaneSubscriptionDescriptor;
export type PaneMarketData = { bars: Candle[]; detail: string; instrument: MarketInstrument | null; status: "loading" | "available" | "empty" | "unavailable" | "error"; updatedAt: string | null };

type OwnedPaneMarketData = PaneMarketData & { owner: string; source: string };

function marketDataOwner() {
  return JSON.stringify([getStoredAuthSession()?.user.id ?? null, getApiBearerToken()]);
}

type SharedSubscription = { leases: number; token: string | null; subscriptionId: Promise<string | null> };
const sharedSubscriptions = new Map<string, SharedSubscription>();
const PANE_MARKET_REFRESH_MS = 5_000;

function acquireMarketSubscription(key: string, token: string | null, payload: { pane_id: string; instrument_id: number }) {
  const existing = sharedSubscriptions.get(key);
  if (existing) {
    existing.leases += 1;
    return existing.subscriptionId;
  }
  const subscriptionId = createMarketSubscription({ ...payload, pane_id: `${payload.pane_id.slice(0, 20)}:${crypto.randomUUID()}`, channels: ["CANDLES", "DEPTH", "DIAGNOSTICS"] })
    .then((subscription) => subscription.subscription_id)
    .catch(() => null);
  sharedSubscriptions.set(key, { leases: 1, token, subscriptionId });
  return subscriptionId;
}

function releaseMarketSubscription(key: string) {
  const subscription = sharedSubscriptions.get(key);
  if (!subscription) return;
  subscription.leases -= 1;
  if (subscription.leases > 0) return;
  sharedSubscriptions.delete(key);
  void subscription.subscriptionId.then((subscriptionId) => {
    if (subscriptionId) void deleteMarketSubscription(subscriptionId, { token: subscription.token }).catch(() => undefined);
  });
}

export function usePaneMarketData(panes: PaneMarketDescriptor[], enabled = true) {
  useSyncExternalStore(subscribeAuthSession, getStoredAuthSession, () => null);
  const owner = marketDataOwner();
  const token = getApiBearerToken();
  const [data, setData] = useState<Record<string, OwnedPaneMarketData>>({});
  const signature = useMemo(() => JSON.stringify(panes.map(pane => [pane.id, paneSubscriptionKey(pane)])), [panes]);
  const currentRequest = useRef({ owner, signature, enabled, generation: 0 });
  if (currentRequest.current.owner !== owner || currentRequest.current.signature !== signature || currentRequest.current.enabled !== enabled) {
    currentRequest.current = { owner, signature, enabled, generation: currentRequest.current.generation + 1 };
  }
  const generation = currentRequest.current.generation;

  useEffect(() => {
    if (!enabled || !panes.length) return undefined;
    let active = true;
    const ownsRequest = () => active && currentRequest.current.enabled
      && currentRequest.current.owner === owner && currentRequest.current.signature === signature
      && currentRequest.current.generation === generation
      && marketDataOwner() === owner;
    const subscriptionKeys: string[] = [];
    const refreshers = new Set<() => Promise<void>>();
    const groups = planPaneSubscriptions(panes);

    const refreshVisibleGroups = () => {
      if (!ownsRequest() || document.visibilityState !== "visible") return;
      refreshers.forEach((refresh) => void refresh());
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshVisibleGroups();
    };

    const loadGroup = async ({ key, leader: pane, paneIds }: ReturnType<typeof planPaneSubscriptions>[number]) => {
      const source = paneSubscriptionKey(pane);
      const owned = (value: PaneMarketData): OwnedPaneMarketData => ({ ...value, owner, source });
      const matching = (value: OwnedPaneMarketData | undefined) => value?.owner === owner && value.source === source;
      setData((current) => ownsRequest() ? Object.fromEntries(Object.entries(current).concat(paneIds.map((paneId) => [paneId,
        matching(current[paneId]) && current[paneId].status === "available" ? current[paneId]
          : owned({ bars: [], instrument: null, status: "loading", detail: `Resolving ${pane.symbol}…`, updatedAt: null }),
      ]))) : current);
      try {
        const instrument = await resolveMarketInstrument(pane.symbol);
        if (!ownsRequest()) return;
        if (!instrument) {
          setData((current) => ownsRequest() ? ({ ...current, ...Object.fromEntries(paneIds.map((paneId) => [paneId, owned({ bars: [], instrument: null, status: "unavailable", detail: `${pane.symbol} is not present in the normalized instrument catalog.`, updatedAt: null })])) }) : current);
          return;
        }
        const subscriptionKey = JSON.stringify([owner, key]);
        subscriptionKeys.push(subscriptionKey);
        await acquireMarketSubscription(subscriptionKey, token, { pane_id: pane.id, instrument_id: instrument.id });
        if (!ownsRequest()) return;
        let requestInFlight = false;
        const refresh = async () => {
          if (!ownsRequest() || requestInFlight) return;
          requestInFlight = true;
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
            if (!ownsRequest()) return;
            const updatedAt = new Date().toISOString();
            setData((current) => ownsRequest() ? ({ ...current, ...Object.fromEntries(paneIds.map((paneId) => [paneId, owned({ bars, instrument, status: bars.length ? "available" : "empty", detail: bars.length ? `${bars.length} normalized candles shared across ${paneIds.length} pane${paneIds.length === 1 ? "" : "s"} for ${instrument.canonical_symbol}.` : `No normalized ${pane.timeframe} candles are available for ${instrument.canonical_symbol}.`, updatedAt })])) }) : current);
          } catch (error) {
            if (!ownsRequest()) return;
            setData((current) => ownsRequest() ? ({ ...current, ...Object.fromEntries(paneIds.map((paneId) => [paneId, owned({ bars: matching(current[paneId]) ? current[paneId].bars : [], instrument, status: "error", detail: error instanceof Error ? error.message : `Could not load ${pane.symbol}.`, updatedAt: matching(current[paneId]) ? current[paneId].updatedAt : null })])) }) : current);
          } finally {
            requestInFlight = false;
          }
        };
        await refresh();
        if (ownsRequest()) refreshers.add(refresh);
      } catch (error) {
        if (ownsRequest()) setData((current) => ownsRequest() ? ({ ...current, ...Object.fromEntries(paneIds.map((paneId) => [paneId, owned({ bars: [], instrument: null, status: "error", detail: error instanceof Error ? error.message : `Could not resolve ${pane.symbol}.`, updatedAt: null })])) }) : current);
      }
    };

    groups.forEach((group) => void loadGroup(group));
    const pollTimer = window.setInterval(refreshVisibleGroups, PANE_MARKET_REFRESH_MS);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(pollTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      refreshers.clear();
      subscriptionKeys.forEach(releaseMarketSubscription);
    };
  // `signature` intentionally represents the complete subscription identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, signature, owner]);

  // Filter synchronously: an effect cleanup runs after the new descriptor renders.
  return useMemo(() => enabled ? Object.fromEntries(panes.map(pane => {
    const value = data[pane.id];
    return [pane.id, value?.owner === owner && value.source === paneSubscriptionKey(pane) ? value
      : { bars: [], instrument: null, status: "loading", detail: `Resolving ${pane.symbol}…`, updatedAt: null }];
  })) as Record<string, PaneMarketData> : {}, [data, enabled, owner, signature]);
}
