import { Clock3, Database, RefreshCw, ShieldAlert, type LucideIcon } from "lucide-react";

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
  const state = resolveOrderFlowRouteState();

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
        <div className="flex items-center gap-2 text-xs tabular-nums text-slate-300">
          <span className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1.5">BTCUSDT</span>
          <span className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1.5">5m</span>
        </div>
      </header>

      <div className={`flex min-h-0 flex-1 justify-center p-4 sm:p-6 ${state === "available" ? "items-start" : "items-center"}`}>
        {state === "loading" ? <LoadingState /> : null}
        {state === "available" ? <AvailableState /> : null}
        {state === "stale" ? <StaleState /> : null}
        {state === "unsupported" ? <UnsupportedState /> : null}
        {state === "error" ? <ErrorState /> : null}
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

function AvailableState() {
  return (
    <div className="grid w-full max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]" data-order-flow-source="deterministic-evidence-fixture">
      <div className="min-w-0 overflow-hidden rounded-xl border border-white/10 bg-[#0b1118]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
          <div>
            <h2 className="font-semibold text-white">Bid × ask footprint</h2>
            <p className="mt-0.5 text-xs text-slate-400">Deterministic evidence fixture · not a live market feed</p>
          </div>
          <span className="rounded-full bg-emerald-300/10 px-2.5 py-1 text-xs font-medium text-emerald-200">Available</span>
        </div>
        <div className="overflow-x-auto p-3 sm:p-5">
          <table className="w-full border-separate border-spacing-y-1 font-mono text-[11px] tabular-nums sm:text-xs" aria-label="Order-flow price levels">
            <thead className="text-slate-500">
              <tr><th className="px-3 py-2 text-right font-medium">Bid volume</th><th className="px-3 py-2 text-center font-medium">Price</th><th className="px-3 py-2 text-left font-medium">Ask volume</th></tr>
            </thead>
            <tbody>
              {levels.map((level) => (
                <tr key={level.price}>
                  <td className="rounded-l-md bg-rose-300/10 px-3 py-3 text-right text-rose-100">{level.bid}</td>
                  <th scope="row" className="bg-white/[0.035] px-3 py-3 text-center font-medium text-slate-200">{level.price}</th>
                  <td className="rounded-r-md bg-cyan-300/10 px-3 py-3 text-left text-cyan-100">{level.ask}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <aside aria-label="Order-flow summary" className="grid content-start gap-3 sm:grid-cols-3 lg:grid-cols-1">
        <Metric label="Bar delta" value="−126" detail="Sell volume exceeds buy volume" />
        <Metric label="Total volume" value="930" detail="Attributed trades in the selected bar" />
        <Metric label="Imbalances" value="2 sell" detail="Diagonal ratio at or above 3:1" />
      </aside>
    </div>
  );
}

function Metric({ detail, label, value }: { detail: string; label: string; value: string }) {
  return <div className="rounded-xl bg-white/[0.045] p-4"><div className="text-xs text-slate-400">{label}</div><div className="mt-2 text-2xl font-semibold tabular-nums text-white">{value}</div><p className="mt-1 text-xs leading-5 text-slate-400">{detail}</p></div>;
}

function StaleState() {
  return <StatePanel icon={Clock3} role="status" title="Order-flow data is stale" detail="The last attributed trade update arrived 4m 32s ago. Values remain visible for review, but they are not current." action="Reconnect feed" onAction={() => window.location.reload()} tone="amber" />;
}

function UnsupportedState() {
  return <StatePanel icon={Database} role="status" title="This feed does not support order flow" detail="The current BTCUSDT feed provides candles and volume, not trade-level bid and ask attribution. EdgeLab will not infer footprint, delta, or imbalance values from OHLCV." action="Choose a compatible feed" onAction={() => window.location.assign("/app/live")} tone="slate" />;
}

function ErrorState() {
  return <StatePanel icon={ShieldAlert} role="alert" title="Order-flow data could not be loaded" detail="The provider rejected the latest aggregate request. No cached values are being presented as current market data." action="Try again" onAction={() => window.location.reload()} tone="rose" />;
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

function resolveOrderFlowRouteState(): OrderFlowRouteState {
  if (import.meta.env.VITE_E2E_STATE_FIXTURES === "1" && typeof window !== "undefined") {
    const testState = window.localStorage.getItem(TEST_STATE_KEY);
    if (testState === "loading" || testState === "available" || testState === "stale" || testState === "unsupported" || testState === "error") return testState;
  }
  return "unsupported";
}
