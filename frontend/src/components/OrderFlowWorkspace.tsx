import { useCallback, useEffect, useRef, useState } from "react";
import { Clock3, Database, RefreshCw, ShieldAlert, type LucideIcon } from "lucide-react";
import { listMarketFootprints, listMarketInstruments, type MarketFootprint, type MarketInstrument } from "@/lib/marketInfrastructure";

type OrderFlowRouteState = "loading" | "available" | "stale" | "unsupported" | "error";

const TEST_STATE_KEY = "edgelab.ui-test.order-flow-state";

const levels = [
  { ask: 142, bid: 61, price: "68,145.00" },
  { ask: 96, bid: 73, price: "68,144.50" },
  { ask: 54, bid: 118, price: "68,144.00" },
  { ask: 41, bid: 164, price: "68,143.50" },
  { ask: 79, bid: 102, price: "68,143.00" },
] as const;

export function OrderFlowWorkspace() {
  const { detail, fixture, footprint, instruments, intervalSeconds, provider, refresh, selectInstrument, selectedInstrumentId, setIntervalSeconds, setProvider, state } = useOrderFlowRouteState();
  const selectedInstrument = instruments.find((instrument) => instrument.id === selectedInstrumentId) ?? null;
  const providers = Array.from(new Set(selectedInstrument?.identifiers.map((identifier) => identifier.provider) ?? [])).sort();

  return (
    <section
      aria-labelledby="order-flow-heading"
      className="flex min-h-full min-w-0 flex-col bg-[#080c11] text-slate-100"
      data-order-flow-state={state}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 id="order-flow-heading" className="text-lg font-semibold tracking-[-0.02em] text-white sm:text-xl">
            Order flow
          </h2>
          <p className="mt-1 max-w-[70ch] text-sm leading-5 text-slate-400">
            Footprint data appears only when the selected feed supplies trade-level bid and ask attribution.
          </p>
        </div>
        <div aria-label="Order-flow source" className="flex flex-wrap items-center gap-2 text-xs tabular-nums text-slate-300">
          <label className="sr-only" htmlFor="order-flow-instrument">Instrument</label>
          <select id="order-flow-instrument" aria-label="Instrument" className="min-h-10 rounded-md border border-white/10 bg-[#0b1118] px-2.5" disabled={fixture || !instruments.length} onChange={(event) => selectInstrument(Number(event.target.value))} value={selectedInstrumentId ?? ""}>
            {!instruments.length ? <option value="">{fixture ? "BTCUSDT · E2E fixture" : "No normalized instruments"}</option> : instruments.map((instrument) => <option key={instrument.id} value={instrument.id}>{instrument.canonical_symbol}</option>)}
          </select>
          <label className="sr-only" htmlFor="order-flow-timeframe">Timeframe</label>
          <select id="order-flow-timeframe" aria-label="Timeframe" className="min-h-10 rounded-md border border-white/10 bg-[#0b1118] px-2.5" disabled={fixture} onChange={(event) => setIntervalSeconds(Number(event.target.value))} value={intervalSeconds}>
            <option value={60}>1m</option><option value={300}>5m</option><option value={900}>15m</option><option value={3600}>1h</option>
          </select>
          <label className="sr-only" htmlFor="order-flow-provider">Provider</label>
          <select id="order-flow-provider" aria-label="Provider" className="min-h-10 rounded-md border border-white/10 bg-[#0b1118] px-2.5" disabled={fixture || !providers.length} onChange={(event) => setProvider(event.target.value)} value={provider}>
            <option value="">All providers</option>{providers.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
      </header>

      <div className={`flex min-h-0 flex-1 justify-center p-4 sm:p-6 ${state === "available" ? "items-start" : "items-center"}`}>
        {state === "loading" ? <LoadingState /> : null}
        {state === "available" ? <AvailableState detail={detail} fixture={fixture} footprint={footprint} /> : null}
        {state === "stale" ? <StaleState detail={detail} onRetry={refresh} /> : null}
        {state === "unsupported" ? <UnsupportedState detail={detail} /> : null}
        {state === "error" ? <ErrorState detail={detail} onRetry={refresh} /> : null}
      </div>
    </section>
  );
}

function LoadingState() {
  return (
    <div aria-label="Order-flow loading state" className="w-full max-w-5xl" role="status">
      <div className="flex items-center gap-3 text-sm text-slate-300">
        <span aria-hidden="true" className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-300" />
        Verifying feed capabilities and requesting trade-level aggregates…
      </div>
      <div aria-hidden="true" className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="h-72 animate-pulse rounded-xl bg-white/[0.045] sm:h-96" />
        <div className="grid gap-3">
          <div className="h-24 animate-pulse rounded-xl bg-white/[0.045]" />
          <div className="h-24 animate-pulse rounded-xl bg-white/[0.045]" />
          <div className="h-24 animate-pulse rounded-xl bg-white/[0.045]" />
        </div>
      </div>
    </div>
  );
}

function AvailableState({ detail, fixture, footprint }: { detail: string; fixture: boolean; footprint: MarketFootprint | null }) {
  const displayedLevels = footprint?.levels.length ? footprint.levels : levels.map((level) => ({ ask_volume: level.ask, bid_volume: level.bid, price: level.price }));
  const bid = Number(footprint?.bid_volume ?? 518);
  const ask = Number(footprint?.ask_volume ?? 412);
  const delta = Number(footprint?.delta ?? ask - bid);
  const total = Number(footprint?.total_volume ?? bid + ask);
  return (
    <div className="grid w-full max-w-6xl gap-4 xl:grid-cols-[minmax(0,1fr)_19rem]" data-order-flow-source={fixture ? "e2e-deterministic-fixture" : "persisted-provider-footprint"}>
      <div className="min-w-0 overflow-hidden rounded-xl border border-white/10 bg-[#0b1118]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
          <div>
            <h2 className="font-semibold text-white">Bid × ask footprint</h2>
            <p className="mt-0.5 text-xs text-slate-400">{fixture ? "E2E deterministic fixture · never used in production" : detail}</p>
          </div>
          <span className="rounded-full bg-emerald-300/10 px-2.5 py-1 text-xs font-medium text-emerald-200">{fixture ? "Test fixture" : footprint?.complete ? "Provider aggregate" : "Partial aggregate"}</span>
        </div>
        <div className="overflow-x-auto p-3 sm:p-5">
          <table className="w-full border-separate border-spacing-y-1 font-mono text-[11px] tabular-nums sm:text-xs" aria-label="Order-flow price levels">
            <thead className="text-slate-500">
              <tr><th className="px-3 py-2 text-right font-medium">Bid volume</th><th className="px-3 py-2 text-center font-medium">Price</th><th className="px-3 py-2 text-left font-medium">Ask volume</th></tr>
            </thead>
            <tbody>
              {displayedLevels.map((level) => (
                <tr key={String(level.price)}>
                  <td className="rounded-l-md bg-rose-300/10 px-3 py-3 text-right text-rose-100">{formatNumber(level.bid_volume)}</td>
                  <th scope="row" className="bg-white/[0.035] px-3 py-3 text-center font-medium text-slate-200">{formatNumber(level.price, 8)}</th>
                  <td className="rounded-r-md bg-cyan-300/10 px-3 py-3 text-left text-cyan-100">{formatNumber(level.ask_volume)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <aside aria-label="Order-flow summary" className="grid content-start gap-3 sm:grid-cols-3 lg:grid-cols-1">
        <Metric label="Bar delta" value={`${delta >= 0 ? "+" : "−"}${formatNumber(Math.abs(delta))}`} detail="Ask-attributed minus bid-attributed volume" />
        <Metric label="Total volume" value={formatNumber(total)} detail="Attributed and unknown trades in this aggregate" />
        <Metric label="Provenance" value={fixture ? "E2E only" : footprint?.provider ?? "Provider"} detail={fixture ? "Synthetic values for visual regression" : `Ended ${new Date(footprint!.end_at).toLocaleString()}`} />
      </aside>
    </div>
  );
}

function Metric({ detail, label, value }: { detail: string; label: string; value: string }) {
  return <div className="rounded-xl bg-white/[0.045] p-4"><div className="text-xs text-slate-400">{label}</div><div className="mt-2 text-2xl font-semibold tabular-nums text-white">{value}</div><p className="mt-1 text-xs leading-5 text-slate-400">{detail}</p></div>;
}

function StaleState({ detail, onRetry }: { detail: string; onRetry: () => void }) {
  return <StatePanel icon={Clock3} role="status" title="Order-flow data is stale" detail={detail} action="Refresh aggregates" onAction={onRetry} tone="amber" />;
}

function UnsupportedState({ detail }: { detail: string }) {
  return <StatePanel icon={Database} role="status" title="Order flow is unavailable" detail={detail} action="Configure data provider" onAction={openProviderSettings} tone="slate" />;
}

function ErrorState({ detail, onRetry }: { detail: string; onRetry: () => void }) {
  return <StatePanel icon={ShieldAlert} role="alert" title="Order-flow data could not be loaded" detail={detail} action="Try again" onAction={onRetry} tone="rose" />;
}

function StatePanel({ action, detail, icon: Icon, onAction, role, title, tone }: { action: string; detail: string; icon: LucideIcon; onAction: () => void; role: "alert" | "status"; title: string; tone: "amber" | "rose" | "slate" }) {
  const tones = {
    amber: "bg-amber-300/10 text-amber-200",
    rose: "bg-rose-300/10 text-rose-200",
    slate: "bg-white/[0.06] text-white",
  } as const;
  return (
    <div className="w-full max-w-xl rounded-xl border border-white/10 bg-[#0b1118] p-5 shadow-[0_14px_40px_rgba(0,0,0,0.24)] sm:p-7" role={role}>
      <div className={`grid h-11 w-11 place-items-center rounded-xl ${tones[tone]}`}><Icon aria-hidden="true" size={20} /></div>
      <h2 className="mt-5 text-xl font-semibold tracking-[-0.02em] text-white sm:text-2xl">{title}</h2>
      <p className="mt-2 max-w-[62ch] text-sm leading-6 text-slate-300">{detail}</p>
      <button className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-md border border-white/15 bg-white/[0.06] px-4 text-sm font-semibold text-white outline-none transition hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-cyan-300/70" onClick={onAction} type="button">
        <RefreshCw aria-hidden="true" size={16} />{action}
      </button>
    </div>
  );
}

function resolveOrderFlowFixtureState(): OrderFlowRouteState | null {
  if (import.meta.env.VITE_E2E_STATE_FIXTURES === "1" && typeof window !== "undefined") {
    const testState = window.localStorage.getItem(TEST_STATE_KEY);
    if (testState === "loading" || testState === "available" || testState === "stale" || testState === "unsupported" || testState === "error") return testState;
  }
  return null;
}

function useOrderFlowRouteState() {
  const fixtureState = resolveOrderFlowFixtureState();
  const [instruments, setInstruments] = useState<MarketInstrument[]>([]);
  const [selectedInstrumentId, setSelectedInstrumentId] = useState<number | null>(null);
  const [intervalSeconds, setIntervalSeconds] = useState(300);
  const [provider, setProvider] = useState("");
  const skipSelectionReloadRef = useRef(false);
  const requestRef = useRef<{ controller: AbortController; generation: number } | null>(null);
  const [model, setModel] = useState<{ detail: string; footprint: MarketFootprint | null; state: OrderFlowRouteState }>(() => ({
    detail: fixtureState ? fixtureDetail(fixtureState) : "Resolving the normalized BTCUSDT instrument and persisted footprint aggregates.",
    footprint: null,
    state: fixtureState ?? "loading",
  }));
  const refresh = useCallback(() => {
    if (fixtureState) {
      setModel({ detail: fixtureDetail(fixtureState), footprint: null, state: fixtureState });
      return;
    }
    requestRef.current?.controller.abort();
    const request = { controller: new AbortController(), generation: (requestRef.current?.generation ?? 0) + 1 };
    requestRef.current = request;
    const ownsRequest = () => requestRef.current?.generation === request.generation && !request.controller.signal.aborted;
    setModel((current) => ({ ...current, state: "loading" }));
    void listMarketInstruments("", { signal: request.controller.signal }).then(async (catalog) => {
      if (!ownsRequest()) return;
      setInstruments(catalog);
      const instrument = catalog.find((item) => item.id === selectedInstrumentId) ?? catalog[0] ?? null;
      if (!instrument) {
        setSelectedInstrumentId(null);
        setModel({ detail: "No instrument is configured in the normalized catalog. Add an entitled provider and map an instrument before requesting footprints.", footprint: null, state: "unsupported" });
        return;
      }
      if (selectedInstrumentId !== instrument.id) {
        skipSelectionReloadRef.current = true;
        setSelectedInstrumentId(instrument.id);
      }
      const instrumentProviders = new Set(instrument.identifiers.map((identifier) => identifier.provider));
      const effectiveProvider = provider && instrumentProviders.has(provider) ? provider : "";
      if (provider !== effectiveProvider) setProvider(effectiveProvider);
      const footprints = await listMarketFootprints(instrument.id, { intervalSeconds, limit: 500, provider: effectiveProvider || null, signal: request.controller.signal });
      if (!ownsRequest()) return;
      const footprint = footprints.reduce<MarketFootprint | null>((latest, item) => !latest || Date.parse(item.end_at) > Date.parse(latest.end_at) ? item : latest, null);
      if (!footprint) {
        setModel({ detail: `${instrument.canonical_symbol} has no persisted ${formatInterval(intervalSeconds)} footprints${provider ? ` from ${provider}` : ""}. Configure a trade-level provider with aggressor-side attribution, then backfill or stream trades.`, footprint: null, state: "unsupported" });
        return;
      }
      const stale = Date.now() - Date.parse(footprint.end_at) > 10 * 60_000;
      setModel({ detail: `${footprint.provider} · persisted ${formatInterval(footprint.interval_seconds)} aggregate · ${footprint.complete ? "complete" : "contains provider gaps"}`, footprint, state: stale ? "stale" : "available" });
    }).catch((error: unknown) => {
      if (!ownsRequest() || (error instanceof DOMException && error.name === "AbortError")) return;
      const message = error instanceof Error ? error.message : "The footprint request failed.";
      const unavailable = /403|404|entitlement|not found|unavailable/i.test(message);
      setModel({ detail: unavailable ? `${message} Configure an entitled trade-level provider; EdgeLab will not infer aggressor side from OHLCV.` : `${message} No cached footprint is being presented as current market data.`, footprint: null, state: unavailable ? "unsupported" : "error" });
    });
  }, [fixtureState, intervalSeconds, provider, selectedInstrumentId]);
  useEffect(() => {
    if (skipSelectionReloadRef.current) {
      skipSelectionReloadRef.current = false;
      return;
    }
    refresh();
  }, [refresh]);
  useEffect(() => () => requestRef.current?.controller.abort(), []);
  const selectInstrument = useCallback((instrumentId: number) => {
    const nextInstrument = instruments.find((instrument) => instrument.id === instrumentId);
    const nextProviders = new Set(nextInstrument?.identifiers.map((identifier) => identifier.provider) ?? []);
    if (provider && !nextProviders.has(provider)) setProvider("");
    setSelectedInstrumentId(instrumentId);
  }, [instruments, provider]);
  return { ...model, fixture: Boolean(fixtureState), instruments, intervalSeconds, provider, refresh, selectInstrument, selectedInstrumentId, setIntervalSeconds, setProvider };
}

function fixtureDetail(state: OrderFlowRouteState) {
  if (state === "stale") return "E2E fixture: the attributed trade update stopped 4m 32s ago. Values are not current.";
  if (state === "unsupported") return "The E2E candle-only feed has no aggressor-side attribution. EdgeLab will not infer footprint, delta, or imbalance values from OHLCV.";
  if (state === "error") return "The E2E provider rejected the aggregate request. No cached values are being presented as current market data.";
  return "E2E-only deterministic visual evidence.";
}

function openProviderSettings() { window.location.assign("/app/settings/data-providers#settings/data-providers/broker-connections"); }
function formatNumber(value: number | string, maximumFractionDigits = 2) { return Number(value).toLocaleString(undefined, { maximumFractionDigits }); }
function formatInterval(seconds: number) { return seconds % 3600 === 0 ? `${seconds / 3600}h` : `${seconds / 60}m`; }
