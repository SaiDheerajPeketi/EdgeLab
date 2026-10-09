import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getApiBearerToken } from "../../lib/api";
import { getStoredAuthSession, subscribeAuthSession } from "../../lib/authSession";
import { acknowledgeMarketAlertEvent, createMarketAlert, deleteMarketAlert, getOrderBook, listMarketAlertEvents, listMarketAlerts, resolveMarketInstrument, type MarketAlertEvent, type MarketAlertRule, type MarketInstrument, type OrderBookSnapshot } from "../../lib/marketInfrastructure";

function marketOwner() { return JSON.stringify([getStoredAuthSession()?.user.id ?? null, getApiBearerToken()]); }
type Generation = { owner: string; source: string };

// Retire requests at render time, and latch account changes even when React
// batches an A -> B -> A transition into a single render.
function useRequestOwner(source: string) {
  const current = useRef<Generation>({ owner: marketOwner(), source });
  const subscribe = useCallback((listener: () => void) => {
    const changed = () => {
      const owner = marketOwner();
      if (current.current.owner !== owner) current.current = { owner, source: current.current.source };
      listener();
    };
    // Cross-tab events may arrive after storage has already changed back.
    // These events record an identity transition even if the final key matches.
    const retired = () => { current.current = { owner: marketOwner(), source: current.current.source }; listener(); };
    const storage = (event: StorageEvent) => { if (event.key === null) retired(); };
    const unsubscribe = subscribeAuthSession(changed);
    window.addEventListener("edgelab:auth-session-change", retired);
    window.addEventListener("storage", storage);
    return () => { unsubscribe(); window.removeEventListener("edgelab:auth-session-change", retired); window.removeEventListener("storage", storage); };
  }, []);
  const owner = marketOwner();
  if (current.current.owner !== owner || current.current.source !== source) current.current = { owner, source };
  const snapshot = useCallback(() => current.current, []);
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const generation = current.current;
  const owns = useCallback(() => current.current === generation && marketOwner() === generation.owner, [generation]);
  return { generation, owns };
}

type BookData = { generation: Generation; instrument: MarketInstrument | null; snapshot: OrderBookSnapshot | null; state: "loading" | "ready" | "error"; error: string | null };

export function useOrderBookData(symbol: string, aggregation: number, depth: number) {
  const { generation, owns } = useRequestOwner(JSON.stringify([symbol, aggregation, depth]));
  const [loaded, setLoaded] = useState<BookData | null>(null);
  const context = useMemo(() => ({ active: false, serial: 0, controller: null as AbortController | null, instrument: null as MarketInstrument | null }), [generation]);
  const refresh = useCallback(async (force = true) => {
    if (!context.active || !owns() || (!force && context.controller)) return;
    context.controller?.abort();
    const controller = new AbortController(), serial = ++context.serial;
    context.controller = controller;
    const current = () => context.active && owns() && context.serial === serial && !controller.signal.aborted;
    setLoaded(previous => current() ? { generation, instrument: context.instrument, snapshot: previous?.generation === generation ? previous.snapshot : null, state: "loading", error: null } : previous);
    try {
      const instrument = context.instrument ?? await resolveMarketInstrument(symbol, { signal: controller.signal });
      if (!current()) return;
      context.instrument = instrument;
      if (!instrument) {
        setLoaded(previous => current() ? { generation, instrument: null, snapshot: null, state: "ready", error: null } : previous);
        return;
      }
      const snapshot = await getOrderBook(instrument.id, { aggregationTicks: aggregation, depth, signal: controller.signal });
      if (!current()) return;
      if (snapshot.instrument_id !== instrument.id) throw new Error("The order book does not match the selected market. Refresh to retry.");
      setLoaded(previous => current() ? { generation, instrument, snapshot, state: "ready", error: null } : previous);
    } catch (error) {
      if (current()) setLoaded(previous => current() ? { generation, instrument: context.instrument, snapshot: previous?.generation === generation ? previous.snapshot : null, state: "error", error: error instanceof Error ? error.message : "Order book could not be loaded." } : previous);
    } finally {
      if (context.serial === serial) context.controller = null;
    }
  }, [aggregation, context, depth, generation, owns, symbol]);
  useEffect(() => {
    context.active = true;
    void refresh(false);
    const visible = () => { if (document.visibilityState === "visible") void refresh(false); };
    const timer = window.setInterval(visible, 2_000);
    document.addEventListener("visibilitychange", visible);
    return () => { context.active = false; context.serial++; context.controller?.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [context, refresh]);
  const data = loaded?.generation === generation ? loaded : null;
  return { instrument: data?.instrument ?? null, snapshot: data?.snapshot ?? null, state: data?.state ?? "loading", error: data?.error ?? null, refresh };
}

type AlertData = { generation: Generation; rules: MarketAlertRule[]; events: MarketAlertEvent[]; received: boolean; loading: boolean; error: string | null; actionError: string | null; busy: string | null };
type InstrumentData = { generation: Generation; instrument: MarketInstrument | null; error: string | null };
type AlertPayload = Parameters<typeof createMarketAlert>[0];

export function useMarketAlertsData(symbol: string) {
  const account = useRequestOwner("alerts");
  const market = useRequestOwner(JSON.stringify(["alert-instrument", symbol]));
  const [loaded, setLoaded] = useState<AlertData | null>(null);
  const [resolved, setResolved] = useState<InstrumentData | null>(null);
  const context = useMemo(() => ({ active: false, serial: 0, controller: null as AbortController | null, mutation: null as object | null }), [account.generation]);
  const empty = useCallback((): AlertData => ({ generation: account.generation, rules: [], events: [], received: false, loading: true, error: null, actionError: null, busy: null }), [account.generation]);
  const update = useCallback((change: (previous: AlertData) => AlertData) => {
    setLoaded(previous => account.owns() ? change(previous?.generation === account.generation ? previous : empty()) : previous);
  }, [account.generation, account.owns, empty]);
  const load = useCallback(async (force = false) => {
    if (!context.active || !account.owns() || (!force && context.controller)) return;
    context.controller?.abort();
    const controller = new AbortController(), serial = ++context.serial;
    context.controller = controller;
    const current = () => context.active && account.owns() && context.serial === serial && !controller.signal.aborted;
    try {
      const [rules, events] = await Promise.all([listMarketAlerts({ signal: controller.signal }), listMarketAlertEvents(false, { signal: controller.signal })]);
      if (current()) update(previous => current() ? { ...previous, rules, events, received: true, loading: false, error: null } : previous);
    } catch (error) {
      if (current()) update(previous => current() ? { ...previous, loading: false, error: error instanceof Error ? error.message : "Alerts could not be loaded." } : previous);
    } finally { if (context.serial === serial) context.controller = null; }
  }, [account.owns, context, update]);
  useEffect(() => {
    context.active = true;
    void load();
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(visible, 10_000);
    document.addEventListener("visibilitychange", visible);
    return () => { context.active = false; context.serial++; context.controller?.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [context, load]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void resolveMarketInstrument(symbol, { signal: controller.signal }).then(instrument => {
      if (active && market.owns()) setResolved({ generation: market.generation, instrument, error: null });
    }).catch(error => {
      if (active && market.owns()) setResolved({ generation: market.generation, instrument: null, error: error instanceof Error ? error.message : "This market could not be loaded." });
    });
    return () => { active = false; controller.abort(); };
  }, [market.generation, market.owns, symbol]);

  const mutate = useCallback(async (busy: string, request: () => Promise<unknown>) => {
    if (!context.active || !account.owns() || context.mutation) return false;
    const mutation = {};
    context.mutation = mutation;
    const current = () => context.active && account.owns() && context.mutation === mutation;
    update(previous => ({ ...previous, busy, actionError: null }));
    try {
      await request();
      if (!current()) return false;
      await load(true);
      return current();
    } catch (error) {
      if (current()) update(previous => ({ ...previous, actionError: error instanceof Error ? error.message : "The alert could not be updated. Try again." }));
      return false;
    } finally {
      if (current()) update(previous => ({ ...previous, busy: null }));
      if (context.mutation === mutation) context.mutation = null;
    }
  }, [account.owns, context, load, update]);
  const setError = useCallback((message: string | null) => update(previous => ({ ...previous, actionError: message })), [update]);
  const create = useCallback((payload: AlertPayload) => mutate("create", () => createMarketAlert(payload)), [mutate]);
  const remove = useCallback((id: number) => mutate(`delete-${id}`, () => deleteMarketAlert(id)), [mutate]);
  const acknowledge = useCallback((id: number) => mutate(`ack-${id}`, () => acknowledgeMarketAlertEvent(id)), [mutate]);
  const data = loaded?.generation === account.generation ? loaded : null;
  const instrument = resolved?.generation === market.generation ? resolved : null;
  return { generation: account.generation, owns: account.owns, instrument: instrument?.instrument ?? null, rules: data?.rules ?? [], events: data?.events ?? [], eventsReady: data?.received ?? false, loading: data?.loading ?? true, error: data?.actionError ?? data?.error ?? instrument?.error ?? null, busy: data?.busy ?? null, setError, create, remove, acknowledge };
}
