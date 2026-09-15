import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Bell, BellRing, Check, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import {
  acknowledgeMarketAlertEvent,
  createMarketAlert,
  deleteMarketAlert,
  getOrderBook,
  listMarketAlertEvents,
  listMarketAlerts,
  resolveMarketInstrument,
  type MarketAlertEvent,
  type MarketAlertRule,
  type MarketAlertType,
  type MarketInstrument,
  type OrderBookSnapshot,
} from "../../lib/marketInfrastructure";
import { JournalButton, journalFieldClass } from "../journal/JournalControls";

export function OrderBookPanel({ symbol }: { symbol: string }) {
  const [instrument, setInstrument] = useState<MarketInstrument | null>(null);
  const [snapshot, setSnapshot] = useState<OrderBookSnapshot | null>(null);
  const [aggregation, setAggregation] = useState(1);
  const [depth, setDepth] = useState(20);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const resolved = instrument ?? await resolveMarketInstrument(symbol);
      if (!resolved) { setInstrument(null); setSnapshot(null); setState("ready"); return; }
      setInstrument(resolved);
      setSnapshot(await getOrderBook(resolved.id, { aggregationTicks: aggregation, depth }));
      setState("ready");
    } catch (caught) { setState("error"); setError(caught instanceof Error ? caught.message : "Order book could not be loaded."); }
  }, [aggregation, depth, instrument, symbol]);

  useEffect(() => { setInstrument(null); setSnapshot(null); setState("loading"); }, [symbol]);
  useEffect(() => { let active = true; const run = () => { if (active) void refresh(); }; run(); const timer = window.setInterval(run, 2_000); return () => { active = false; window.clearInterval(timer); }; }, [refresh]);

  const asks = useMemo(() => snapshot?.levels.filter((level) => level.side === "ASK").sort((a, b) => Number(b.price) - Number(a.price)) ?? [], [snapshot]);
  const bids = useMemo(() => snapshot?.levels.filter((level) => level.side === "BID").sort((a, b) => Number(b.price) - Number(a.price)) ?? [], [snapshot]);
  const levelSizes = snapshot?.levels.map((level) => Number(level.size)) ?? [];
  const maxSize = Math.max(1, ...levelSizes);
  const bestAsk = asks.at(-1), bestBid = bids[0];
  const spread = bestAsk && bestBid ? Number(bestAsk.price) - Number(bestBid.price) : null;

  return <section aria-labelledby="order-book-panel-title" className="min-h-full bg-[#0a0d11]"><header className="border-b border-white/10 px-3 py-3"><div className="flex items-center gap-2"><div className="min-w-0 flex-1"><h2 id="order-book-panel-title" className="truncate text-sm font-semibold text-white">Order Book · {instrument?.canonical_symbol ?? symbol}</h2><p className="mt-0.5 truncate text-[11px] text-slate-500">{snapshot?.provider ?? "Normalized market infrastructure"} · {snapshot?.captured_at ? `updated ${new Date(snapshot.captured_at).toLocaleTimeString()}` : "waiting for depth"}</p></div><button type="button" onClick={() => void refresh()} aria-label="Refresh order book" className="grid h-10 w-10 place-items-center rounded text-slate-400 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"><RefreshCw aria-hidden="true" className={`h-4 w-4 ${state === "loading" ? "animate-spin motion-reduce:animate-none" : ""}`} /></button></div><div className="mt-3 grid grid-cols-2 gap-2"><label className="text-[11px] text-slate-500">Aggregate ticks<select value={aggregation} onChange={(event) => setAggregation(Number(event.target.value))} className={`${journalFieldClass} mt-1 min-h-9 py-0 text-xs`}><option value={1}>1 tick</option><option value={2}>2 ticks</option><option value={5}>5 ticks</option><option value={10}>10 ticks</option><option value={25}>25 ticks</option></select></label><label className="text-[11px] text-slate-500">Depth<select value={depth} onChange={(event) => setDepth(Number(event.target.value))} className={`${journalFieldClass} mt-1 min-h-9 py-0 text-xs`}><option value={10}>10 levels</option><option value={20}>20 levels</option><option value={50}>50 levels</option><option value={100}>100 levels</option></select></label></div></header>
    {error ? <PanelMessage tone="error" title="Depth unavailable" detail={error} /> : !instrument && state === "ready" ? <PanelMessage title="Symbol is not normalized" detail="Add or backfill this instrument in Data & providers before requesting depth." /> : snapshot?.status !== "AVAILABLE" ? <PanelMessage tone={snapshot?.status === "STALE" || snapshot?.status === "INCOMPLETE" ? "warning" : "neutral"} title={statusTitle(snapshot?.status)} detail={snapshot?.message ?? "No order-book snapshot has arrived for this provider and symbol."} /> : <div className="font-mono text-xs"><div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_3rem] border-b border-white/10 px-3 py-2 text-[10px] uppercase tracking-wide text-slate-600"><span>Price</span><span className="text-right">Size</span><span className="text-right">Orders</span></div><div>{asks.map((level, index) => <DepthRow key={`ask-${index}-${level.price}`} side="ASK" price={Number(level.price)} size={Number(level.size)} orders={level.order_count} fraction={Number(level.size) / maxSize} />)}</div><div className="flex items-center justify-between border-y border-white/10 bg-white/[0.025] px-3 py-2 text-[11px]"><span className="text-slate-500">Spread</span><span className="tabular-nums text-white">{spread == null ? "—" : spread.toLocaleString(undefined, { maximumFractionDigits: 8 })} · {snapshot.aggregation_tick_size} tick step</span></div><div>{bids.map((level, index) => <DepthRow key={`bid-${index}-${level.price}`} side="BID" price={Number(level.price)} size={Number(level.size)} orders={level.order_count} fraction={Number(level.size) / maxSize} />)}</div></div>}
  </section>;
}

export function AlertsPanel({ symbol }: { symbol: string }) {
  const [instrument, setInstrument] = useState<MarketInstrument | null>(null);
  const [rules, setRules] = useState<MarketAlertRule[]>([]);
  const [events, setEvents] = useState<MarketAlertEvent[]>([]);
  const [draft, setDraft] = useState({ name: "", type: "PRICE_CROSSES_ABOVE" as MarketAlertType, threshold: "", cooldown: "60" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const load = useCallback(async () => {
    try { const [resolved, nextRules, nextEvents] = await Promise.all([resolveMarketInstrument(symbol), listMarketAlerts(), listMarketAlertEvents(false)]); setInstrument(resolved); setRules(nextRules); setEvents(nextEvents); setError(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Alerts could not be loaded."); }
  }, [symbol]);
  useEffect(() => { void load(); const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 10_000); return () => window.clearInterval(timer); }, [load]);

  async function create() {
    const needsThreshold = !["PROVIDER_STALE", "SEQUENCE_GAP"].includes(draft.type);
    if (!draft.name.trim() || (needsThreshold && (!Number.isFinite(Number(draft.threshold)) || Number(draft.threshold) <= 0))) { setError("Name the alert and enter a positive threshold for this condition."); return; }
    setBusy("create"); setError(null);
    try { await createMarketAlert({ instrument_id: instrument?.id ?? null, name: draft.name.trim(), alert_type: draft.type, threshold: needsThreshold ? Number(draft.threshold) : null, cooldown_seconds: Math.max(0, Math.min(86400, Number(draft.cooldown) || 0)) }); setDraft({ name: "", type: "PRICE_CROSSES_ABOVE", threshold: "", cooldown: "60" }); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Alert could not be created."); } finally { setBusy(null); }
  }

  return <section aria-labelledby="alerts-panel-title" className="min-h-full bg-[#0a0d11]"><header className="border-b border-white/10 px-3 py-3"><div className="flex items-center gap-2"><Bell aria-hidden="true" className="h-4 w-4 text-cyan-300" /><div className="min-w-0"><h2 id="alerts-panel-title" className="truncate text-sm font-semibold text-white">Alerts · {instrument?.canonical_symbol ?? symbol}</h2><p className="mt-0.5 text-[11px] text-slate-500">Server-evaluated rules · {events.length} unacknowledged</p></div></div></header>{error ? <div className="border-b border-rose-300/20 bg-rose-300/[0.06] px-3 py-2 text-xs leading-5 text-rose-100" role="alert">{error}</div> : null}
    <form className="space-y-3 border-b border-white/10 p-3" onSubmit={(event) => { event.preventDefault(); void create(); }}><label className="text-[11px] text-slate-500">Alert name<input maxLength={160} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Breakout confirmation" className={`${journalFieldClass} mt-1`} /></label><label className="text-[11px] text-slate-500">Condition<select value={draft.type} onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value as MarketAlertType }))} className={`${journalFieldClass} mt-1`}><option value="PRICE_ABOVE">Price above</option><option value="PRICE_BELOW">Price below</option><option value="PRICE_CROSSES_ABOVE">Price crosses above</option><option value="PRICE_CROSSES_BELOW">Price crosses below</option><option value="VOLUME_ABOVE">Volume above</option><option value="DELTA_ABOVE">Delta above</option><option value="DELTA_BELOW">Delta below</option><option value="PROVIDER_STALE">Provider becomes stale</option><option value="SEQUENCE_GAP">Sequence gap detected</option></select></label><div className="grid grid-cols-2 gap-2"><label className="text-[11px] text-slate-500">Threshold<input inputMode="decimal" disabled={["PROVIDER_STALE", "SEQUENCE_GAP"].includes(draft.type)} value={draft.threshold} onChange={(event) => setDraft((current) => ({ ...current, threshold: event.target.value }))} className={`${journalFieldClass} mt-1`} /></label><label className="text-[11px] text-slate-500">Cooldown · seconds<input inputMode="numeric" min={0} max={86400} value={draft.cooldown} onChange={(event) => setDraft((current) => ({ ...current, cooldown: event.target.value }))} className={`${journalFieldClass} mt-1`} /></label></div><JournalButton type="submit" tone="primary" disabled={busy === "create" || (!instrument && !["PROVIDER_STALE", "SEQUENCE_GAP"].includes(draft.type))}>{busy === "create" ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <BellRing aria-hidden="true" className="h-4 w-4" />}Create alert</JournalButton>{!instrument ? <p className="text-[11px] leading-5 text-amber-100">Price, volume, and delta alerts need a normalized instrument. Provider-health alerts can still be global.</p> : null}</form>
    <div><div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-600">Active rules</div><div className="divide-y divide-white/8 border-y border-white/10">{rules.map((rule) => <div key={rule.id} className="px-3 py-3"><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-white">{rule.name}</p><p className="mt-1 text-[11px] text-slate-500">{conditionLabel(rule)} · cooldown {rule.cooldown_seconds}s</p><p className="mt-1 text-[10px] text-slate-600">{rule.last_triggered_at ? `Last triggered ${new Date(rule.last_triggered_at).toLocaleString()}` : "Not triggered yet"}</p></div>{confirmDelete === rule.id ? <div className="flex gap-1"><button type="button" onClick={() => setConfirmDelete(null)} className="min-h-9 px-2 text-xs text-slate-300">Keep</button><button type="button" onClick={() => { setBusy(`delete-${rule.id}`); void deleteMarketAlert(rule.id).then(load).finally(() => { setBusy(null); setConfirmDelete(null); }); }} className="min-h-9 px-2 text-xs font-semibold text-rose-200">Delete</button></div> : <button type="button" onClick={() => setConfirmDelete(rule.id)} aria-label={`Delete ${rule.name}`} className="grid h-10 w-10 place-items-center rounded text-slate-500 hover:bg-rose-300/10 hover:text-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"><Trash2 aria-hidden="true" className="h-4 w-4" /></button>}</div></div>)}{!rules.length ? <p className="px-3 py-6 text-center text-xs leading-5 text-slate-500">No alert rules. Create a price, activity, or provider-health rule above.</p> : null}</div></div>
    {events.length ? <div><div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-600">Needs attention</div><div className="divide-y divide-white/8 border-y border-white/10">{events.map((item) => <div key={item.id} className="px-3 py-3"><p className="text-xs leading-5 text-amber-100">{item.message}</p><div className="mt-1 flex items-center justify-between gap-2"><time className="text-[10px] text-slate-600">{new Date(item.observed_at).toLocaleString()}</time><button type="button" onClick={() => { setBusy(`ack-${item.id}`); void acknowledgeMarketAlertEvent(item.id).then(load).finally(() => setBusy(null)); }} disabled={busy === `ack-${item.id}`} className="inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-cyan-300 hover:underline"><Check aria-hidden="true" className="h-3.5 w-3.5" />Acknowledge</button></div></div>)}</div></div> : null}
  </section>;
}

function DepthRow({ side, price, size, orders, fraction }: { side: "BID" | "ASK"; price: number; size: number; orders: number; fraction: number }) { return <div className="relative grid min-h-7 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_3rem] items-center px-3"><span aria-hidden="true" className={`absolute inset-y-0 ${side === "BID" ? "left-0 bg-emerald-300/[0.08]" : "right-0 bg-rose-300/[0.08]"}`} style={{ width: `${Math.max(2, fraction * 100)}%` }} /><span className={`relative tabular-nums ${side === "BID" ? "text-emerald-300" : "text-rose-300"}`}><span className="sr-only">{side === "BID" ? "Bid" : "Ask"} </span>{price.toLocaleString(undefined, { maximumFractionDigits: 8 })}</span><span className="relative text-right tabular-nums text-slate-300">{size.toLocaleString()}</span><span className="relative text-right tabular-nums text-slate-600">{orders}</span></div>; }
function PanelMessage({ title, detail, tone = "neutral" }: { title: string; detail: string; tone?: "neutral" | "warning" | "error" }) { return <div className={`m-3 rounded-md px-3 py-4 text-sm ${tone === "error" ? "bg-rose-300/[0.06] text-rose-100" : tone === "warning" ? "bg-amber-300/[0.06] text-amber-100" : "bg-white/[0.025] text-slate-300"}`}><p className="flex items-center gap-2 font-semibold">{tone !== "neutral" ? <AlertCircle aria-hidden="true" className="h-4 w-4" /> : null}{title}</p><p className="mt-1 text-xs leading-5 opacity-75">{detail}</p></div>; }
function statusTitle(status?: OrderBookSnapshot["status"]) { if (status === "STALE") return "Depth is stale"; if (status === "INCOMPLETE") return "Depth is incomplete"; if (status === "ENTITLEMENT_REQUIRED") return "Depth entitlement required"; return "Depth unavailable"; }
function conditionLabel(rule: MarketAlertRule) { const threshold = rule.condition.threshold ?? rule.last_value; return `${rule.alert_type.toLowerCase().replace(/_/g, " ")}${threshold == null ? "" : ` · ${Number(threshold).toLocaleString()}`}`; }
