import { useMemo, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, FileUp, Plus, Search } from "lucide-react";
import { DEFAULT_JOURNAL_FILTERS, filterJournalTrades, numeric, type JournalFilters } from "../../lib/journalAnalytics";
import type { CanonicalTrade, CanonicalTradeCreate, JournalAccount, JournalTag } from "../../lib/journalApi";
import { JournalButton, JournalEmpty, JournalFilterBar, journalFieldClass } from "./JournalControls";
import { JournalTradeFlow } from "./JournalTradeFlow";
import { Table } from "../ui/Primitives";
import { useRestorableSurfaceState } from "../../lib/useRestorableSurfaceState";
import { formatLocaleCurrency, formatLocaleDateTime, formatLocaleNumber } from "../../lib/locale";

type Props = {
  accounts: JournalAccount[];
  tags: JournalTag[];
  trades: CanonicalTrade[];
  initialFilters?: Partial<JournalFilters>;
  onAddTrade: (payload: CanonicalTradeCreate) => Promise<CanonicalTrade>;
  onOpenTrade: (trade: CanonicalTrade) => void;
  onMarkReviewed: (tradeId: number) => Promise<unknown>;
};

type Sort = "newest" | "oldest" | "net-desc" | "net-asc";
const TRADE_PAGE_SIZE = 100;
const JOURNAL_FILTERS_SCHEMA = { version: 1, validate: (value: unknown): value is JournalFilters => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<JournalFilters>;
  return Array.isArray(candidate.accountIds) && candidate.accountIds.every(Number.isInteger)
    && Array.isArray(candidate.tagIds) && candidate.tagIds.every(Number.isInteger)
    && typeof candidate.dateFrom === "string" && typeof candidate.dateTo === "string"
    && ["ALL", "LONG", "SHORT"].includes(candidate.direction ?? "")
    && ["ALL", "UNRATED", "1", "2", "3", "4", "5"].includes(candidate.rating ?? "")
    && [candidate.market, candidate.strategy, candidate.symbol].every((item) => typeof item === "string");
} } as const;
type TradeControls = { query: string; reviewQueue: boolean; sort: Sort };
const TRADE_CONTROLS_SCHEMA = { version: 1, validate: (value: unknown): value is TradeControls => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TradeControls>;
  return typeof candidate.query === "string" && typeof candidate.reviewQueue === "boolean" && ["newest", "oldest", "net-desc", "net-asc"].includes(candidate.sort ?? "");
} } as const;
const OPEN_TRADE_PANEL_SCHEMA = { version: 1, validate: (value: unknown): value is string | null => value === null || value === "add-trade" } as const;
const TRADE_SELECTION_SCHEMA = { version: 1, validate: (value: unknown): value is number[] => Array.isArray(value) && value.every((item) => Number.isInteger(item) && item > 0) } as const;

export function JournalTradesSurface({ accounts, tags, trades, initialFilters, onAddTrade, onOpenTrade, onMarkReviewed }: Props) {
  const [filters, setFilters] = useRestorableSurfaceState<JournalFilters>("journal:trades", "filters", { ...DEFAULT_JOURNAL_FILTERS, ...initialFilters }, JOURNAL_FILTERS_SCHEMA);
  const [controls, setControls] = useRestorableSurfaceState<TradeControls>("journal:trades", "draft", { query: "", reviewQueue: false, sort: "newest" }, TRADE_CONTROLS_SCHEMA);
  const { query, reviewQueue, sort } = controls;
  const [page, setPage] = useState(0);
  const [openPanel, setOpenPanel] = useRestorableSurfaceState<string | null>("journal:trades", "openPanel", null, OPEN_TRADE_PANEL_SCHEMA);
  const adding = openPanel === "add-trade";
  const [busyTradeId, setBusyTradeId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useRestorableSurfaceState<number[]>("journal:trades", "selectedId", [], TRADE_SELECTION_SCHEMA);
  const [bulkState, setBulkState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = filterJournalTrades(trades, filters).filter((trade) => (!reviewQueue || !trade.reviewed) && (!needle || `${trade.symbol} ${trade.strategy_name ?? ""} ${trade.notes.map((note) => note.body).join(" ")} ${trade.tags.map((tag) => tag.name).join(" ")}`.toLowerCase().includes(needle)));
    return rows.sort((left, right) => sort === "newest" ? Date.parse(right.entry_time) - Date.parse(left.entry_time) : sort === "oldest" ? Date.parse(left.entry_time) - Date.parse(right.entry_time) : sort === "net-desc" ? numeric(right.net_pnl) - numeric(left.net_pnl) : numeric(left.net_pnl) - numeric(right.net_pnl));
  }, [filters, query, reviewQueue, sort, trades]);
  const pageCount = Math.max(1, Math.ceil(visible.length / TRADE_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = currentPage * TRADE_PAGE_SIZE;
  const renderedTrades = visible.slice(pageStart, pageStart + TRADE_PAGE_SIZE);

  return <div className="space-y-5">
    <section aria-labelledby="journal-trades-heading"><div className="flex flex-wrap items-end justify-between gap-3"><div><h1 id="journal-trades-heading" className="text-xl font-semibold text-white">Trades</h1><p className="mt-1 text-sm text-slate-400">Manual, imported, broker, and backtest records. Open any row in the same review drawer.</p></div><div className="flex flex-wrap gap-2"><JournalButton disabled={!accounts.length} onClick={() => { window.location.hash = "#journal/accounts"; }}><FileUp aria-hidden="true" className="h-4 w-4" />Import CSV</JournalButton><JournalButton tone="primary" disabled={!accounts.length} onClick={() => setOpenPanel("add-trade")}><Plus aria-hidden="true" className="h-4 w-4" />Add trade</JournalButton></div></div></section>
    {adding ? <JournalTradeFlow accounts={accounts} tags={tags} preferredAccountId={filters.accountIds[0]} onCancel={() => setOpenPanel(null)} onCreate={onAddTrade} /> : null}
    <JournalFilterBar accounts={accounts} filters={filters} tags={tags} trades={trades} onChange={(next) => { setFilters(next); setPage(0); }} />
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end"><label className="min-w-0 flex-1 text-xs text-slate-500">Search symbol, strategy, tag, or note<div className="relative mt-1"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" /><input className={`${journalFieldClass} pl-9`} value={query} onChange={(event) => { setControls((current) => ({ ...current, query: event.target.value })); setPage(0); }} /></div></label><label className="text-xs text-slate-500">Sort<select className={`${journalFieldClass} mt-1 sm:w-44`} value={sort} onChange={(event) => { setControls((current) => ({ ...current, sort: event.target.value as Sort })); setPage(0); }}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="net-desc">Net P&amp;L high</option><option value="net-asc">Net P&amp;L low</option></select></label><label className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm ${reviewQueue ? "border-amber-300/30 bg-amber-300/[0.07] text-amber-100" : "border-white/10 text-slate-300"}`}><input type="checkbox" checked={reviewQueue} onChange={(event) => { setControls((current) => ({ ...current, reviewQueue: event.target.checked })); setPage(0); }} />Review queue</label></div>
    {selectedIds.length ? <div className="ui-action-feedback flex flex-wrap items-center gap-3" data-state={bulkState} role="status"><span className="text-sm font-semibold">{selectedIds.length} selected</span><JournalButton disabled={bulkState === "saving"} onClick={async () => { setBulkState("saving"); try { await Promise.all(selectedIds.map(onMarkReviewed)); setSelectedIds([]); setBulkState("saved"); } catch { setBulkState("error"); } }}>{bulkState === "saving" ? "Marking…" : bulkState === "error" ? "Retry mark reviewed" : "Mark reviewed"}</JournalButton><button type="button" className="min-h-9 text-xs text-slate-400 hover:text-white" onClick={() => { setSelectedIds([]); setBulkState("idle"); }}>Clear selection</button></div> : bulkState === "saved" ? <p className="ui-action-feedback" data-state="saved" role="status"><CheckCircle2 aria-hidden="true" className="h-4 w-4" />Selected trades marked reviewed.</p> : null}
    <div className="border-y border-white/10"><Table label="Journal trades" className="min-w-[70rem]"><thead><tr><th><label className="inline-flex cursor-pointer items-center justify-center"><input type="checkbox" checked={renderedTrades.length > 0 && renderedTrades.every((trade) => selectedIds.includes(trade.id))} onChange={(event) => setSelectedIds(event.target.checked ? renderedTrades.map((trade) => trade.id) : [])} /><span className="sr-only">Select all visible trades</span></label></th><th>Entered</th><th>Symbol</th><th>Account</th><th>Side</th><th>Strategy</th><th className="numeric">Qty</th><th className="numeric">Net</th><th className="numeric">R</th><th className="numeric">Review</th></tr></thead><tbody>{renderedTrades.map((trade) => <TradeRow key={trade.id} trade={trade} account={accounts.find((account) => account.id === trade.account_id)} selected={selectedIds.includes(trade.id)} onSelect={(selected) => setSelectedIds((current) => selected ? [...new Set([...current, trade.id])] : current.filter((id) => id !== trade.id))} busy={busyTradeId === trade.id} onOpen={() => onOpenTrade(trade)} onMarkReviewed={async () => { setBusyTradeId(trade.id); try { await onMarkReviewed(trade.id); } finally { setBusyTradeId(null); } }} />)}</tbody></Table>{!visible.length ? <JournalEmpty title={reviewQueue ? "Review queue cleared" : "No matching trades"} detail={reviewQueue ? "Every trade in the current scope is marked reviewed." : "Clear filters or add a manual, imported, broker, or backtest trade."} /> : null}</div>
    {pageCount > 1 ? <nav aria-label="Journal trade pages" className="flex items-center justify-center gap-3"><JournalButton disabled={currentPage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}><ChevronLeft aria-hidden="true" className="h-4 w-4" />Previous 100</JournalButton><span className="text-xs tabular-nums text-slate-400">Page {currentPage + 1} of {pageCount}</span><JournalButton disabled={currentPage === pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>Next 100 <ChevronRight aria-hidden="true" className="h-4 w-4" /></JournalButton></nav> : null}
    <p className="text-xs text-slate-600" aria-live="polite">Showing {visible.length ? pageStart + 1 : 0}–{Math.min(pageStart + TRADE_PAGE_SIZE, visible.length).toLocaleString()} of {visible.length.toLocaleString()} filtered trades · {trades.length.toLocaleString()} in scope</p>
  </div>;
}

function TradeRow({ trade, account, selected, onSelect, busy, onOpen, onMarkReviewed }: { trade: CanonicalTrade; account?: JournalAccount; selected: boolean; onSelect: (selected: boolean) => void; busy: boolean; onOpen: () => void; onMarkReviewed: () => Promise<void> }) {
  return <tr aria-selected={selected} className="group text-slate-300 hover:bg-white/[0.035] aria-selected:bg-cyan-300/[0.07]"><td><label className="inline-flex cursor-pointer items-center justify-center"><input type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} /><span className="sr-only">Select {trade.symbol} trade</span></label></td><td><button type="button" onClick={onOpen} className="text-start text-xs text-slate-500 hover:text-cyan-200"><bdi>{formatLocaleDateTime(trade.entry_time)}</bdi></button></td><td><button type="button" onClick={onOpen} className="font-semibold text-white hover:text-cyan-200"><bdi>{trade.symbol}</bdi></button><p className="mt-0.5 text-[10px] text-slate-600">{trade.entry_type === "MISSED" ? "Missed" : trade.status.toLowerCase()} · {trade.source_type.toLowerCase().replaceAll("_", " ")}</p></td><td className="ui-resilient-text text-xs" dir="auto">{account?.name ?? `Account ${trade.account_id}`}</td><td className={`text-xs font-medium ${trade.side === "LONG" ? "text-emerald-300" : "text-rose-300"}`}><span className="sr-only">{trade.side === "LONG" ? "Up direction" : "Down direction"} </span>{trade.side}</td><td className="ui-resilient-text max-w-52" dir="auto">{trade.strategy_name ?? "Unassigned"}</td><td className="numeric"><bdi>{formatLocaleNumber(numeric(trade.quantity))}</bdi></td><td className={`numeric font-medium ${numeric(trade.net_pnl) >= 0 ? "text-emerald-300" : "text-rose-300"}`}><span className="sr-only">{numeric(trade.net_pnl) >= 0 ? "Profit" : "Loss"} </span><bdi>{money(numeric(trade.net_pnl), trade.currency)}</bdi></td><td className="numeric"><bdi>{trade.r_multiple == null ? "—" : `${formatLocaleNumber(numeric(trade.r_multiple), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}R`}</bdi></td><td className="numeric">{trade.reviewed ? <button type="button" onClick={onOpen} className="inline-flex min-h-8 items-center gap-1 text-xs text-emerald-300"><CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />Reviewed</button> : <button type="button" disabled={busy} onClick={() => void onMarkReviewed()} className="inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-amber-200 hover:underline disabled:opacity-50">{busy ? "Saving…" : "Mark reviewed"}</button>}</td></tr>;
}

function money(value: number, currency: string) { return formatLocaleCurrency(value, currency); }
