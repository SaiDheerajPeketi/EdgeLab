import { useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, Plus, Search } from "lucide-react";
import { DEFAULT_JOURNAL_FILTERS, filterJournalTrades, numeric, type JournalFilters } from "../../lib/journalAnalytics";
import type { CanonicalTrade, CanonicalTradeCreate, JournalAccount, JournalTag } from "../../lib/journalApi";
import { JournalButton, JournalEmpty, JournalFilterBar, journalFieldClass } from "./JournalControls";
import { JournalTradeFlow } from "./JournalTradeFlow";

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

export function JournalTradesSurface({ accounts, tags, trades, initialFilters, onAddTrade, onOpenTrade, onMarkReviewed }: Props) {
  const [filters, setFilters] = useState<JournalFilters>({ ...DEFAULT_JOURNAL_FILTERS, ...initialFilters });
  const [query, setQuery] = useState("");
  const [reviewQueue, setReviewQueue] = useState(false);
  const [sort, setSort] = useState<Sort>("newest");
  const [limit, setLimit] = useState(100);
  const [adding, setAdding] = useState(false);
  const [busyTradeId, setBusyTradeId] = useState<number | null>(null);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = filterJournalTrades(trades, filters).filter((trade) => (!reviewQueue || !trade.reviewed) && (!needle || `${trade.symbol} ${trade.strategy_name ?? ""} ${trade.notes.map((note) => note.body).join(" ")} ${trade.tags.map((tag) => tag.name).join(" ")}`.toLowerCase().includes(needle)));
    return rows.sort((left, right) => sort === "newest" ? Date.parse(right.entry_time) - Date.parse(left.entry_time) : sort === "oldest" ? Date.parse(left.entry_time) - Date.parse(right.entry_time) : sort === "net-desc" ? numeric(right.net_pnl) - numeric(left.net_pnl) : numeric(left.net_pnl) - numeric(right.net_pnl));
  }, [filters, query, reviewQueue, sort, trades]);

  return <div className="space-y-5">
    <section aria-labelledby="journal-trades-heading"><div className="flex flex-wrap items-end justify-between gap-3"><div><h1 id="journal-trades-heading" className="text-xl font-semibold text-white">Trades</h1><p className="mt-1 text-sm text-slate-400">Canonical manual, import, broker, and backtest records. Open any row in the same review drawer.</p></div><JournalButton tone="primary" disabled={!accounts.length} onClick={() => setAdding(true)}><Plus aria-hidden="true" className="h-4 w-4" />Add trade</JournalButton></div></section>
    {adding ? <JournalTradeFlow accounts={accounts} tags={tags} preferredAccountId={filters.accountIds[0]} onCancel={() => setAdding(false)} onCreate={onAddTrade} /> : null}
    <JournalFilterBar accounts={accounts} filters={filters} tags={tags} trades={trades} onChange={(next) => { setFilters(next); setLimit(100); }} />
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end"><label className="min-w-0 flex-1 text-xs text-slate-500">Search symbol, strategy, tag, or note<div className="relative mt-1"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" /><input className={`${journalFieldClass} pl-9`} value={query} onChange={(event) => { setQuery(event.target.value); setLimit(100); }} /></div></label><label className="text-xs text-slate-500">Sort<select className={`${journalFieldClass} mt-1 sm:w-44`} value={sort} onChange={(event) => setSort(event.target.value as Sort)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="net-desc">Net P&amp;L high</option><option value="net-asc">Net P&amp;L low</option></select></label><label className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm ${reviewQueue ? "border-amber-300/30 bg-amber-300/[0.07] text-amber-100" : "border-white/10 text-slate-300"}`}><input type="checkbox" checked={reviewQueue} onChange={(event) => { setReviewQueue(event.target.checked); setLimit(100); }} />Review queue</label></div>
    <div className="overflow-x-auto border-y border-white/10"><table className="w-full min-w-[66rem] border-collapse text-left text-sm"><thead className="sticky top-0 z-[1] bg-[#0d1117]"><tr className="border-b border-white/10 text-[11px] uppercase tracking-wide text-slate-600"><th className="px-3 py-2 font-medium">Entered</th><th className="px-3 py-2 font-medium">Symbol</th><th className="px-3 py-2 font-medium">Account</th><th className="px-3 py-2 font-medium">Side</th><th className="px-3 py-2 font-medium">Strategy</th><th className="px-3 py-2 text-right font-medium">Qty</th><th className="px-3 py-2 text-right font-medium">Net</th><th className="px-3 py-2 text-right font-medium">R</th><th className="px-3 py-2 text-right font-medium">Review</th></tr></thead><tbody className="divide-y divide-white/8">{visible.slice(0, limit).map((trade) => <TradeRow key={trade.id} trade={trade} account={accounts.find((account) => account.id === trade.account_id)} busy={busyTradeId === trade.id} onOpen={() => onOpenTrade(trade)} onMarkReviewed={async () => { setBusyTradeId(trade.id); try { await onMarkReviewed(trade.id); } finally { setBusyTradeId(null); } }} />)}</tbody></table>{!visible.length ? <JournalEmpty title={reviewQueue ? "Review queue cleared" : "No matching trades"} detail={reviewQueue ? "Every trade in the current scope is marked reviewed." : "Clear filters or add a manual, imported, broker, or backtest trade."} /> : null}</div>
    {visible.length > limit ? <div className="flex justify-center"><JournalButton onClick={() => setLimit((value) => value + 100)}>Show 100 more <ChevronDown aria-hidden="true" className="h-4 w-4" /></JournalButton></div> : null}
    <p className="text-xs text-slate-600" aria-live="polite">Showing {Math.min(limit, visible.length).toLocaleString()} of {visible.length.toLocaleString()} filtered trades · {trades.length.toLocaleString()} in scope</p>
  </div>;
}

function TradeRow({ trade, account, busy, onOpen, onMarkReviewed }: { trade: CanonicalTrade; account?: JournalAccount; busy: boolean; onOpen: () => void; onMarkReviewed: () => Promise<void> }) {
  return <tr className="group text-slate-300 hover:bg-white/[0.035]"><td className="px-3 py-3"><button type="button" onClick={onOpen} className="text-left text-xs text-slate-500 hover:text-cyan-200">{new Date(trade.entry_time).toLocaleString()}</button></td><td className="px-3 py-3"><button type="button" onClick={onOpen} className="font-semibold text-white hover:text-cyan-200">{trade.symbol}</button><p className="mt-0.5 text-[10px] text-slate-600">{trade.entry_type === "MISSED" ? "Missed" : trade.status.toLowerCase()} · {trade.source_type.toLowerCase().replaceAll("_", " ")}</p></td><td className="px-3 py-3 text-xs">{account?.name ?? `Account ${trade.account_id}`}</td><td className={`px-3 py-3 text-xs font-medium ${trade.side === "LONG" ? "text-emerald-300" : "text-rose-300"}`}>{trade.side}</td><td className="max-w-52 truncate px-3 py-3">{trade.strategy_name ?? "Unassigned"}</td><td className="px-3 py-3 text-right tabular-nums">{numeric(trade.quantity).toLocaleString()}</td><td className={`px-3 py-3 text-right font-medium tabular-nums ${numeric(trade.net_pnl) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{money(numeric(trade.net_pnl), trade.currency)}</td><td className="px-3 py-3 text-right tabular-nums">{trade.r_multiple == null ? "—" : `${numeric(trade.r_multiple).toFixed(2)}R`}</td><td className="px-3 py-3 text-right">{trade.reviewed ? <button type="button" onClick={onOpen} className="inline-flex min-h-8 items-center gap-1 text-xs text-emerald-300"><CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />Reviewed</button> : <button type="button" disabled={busy} onClick={() => void onMarkReviewed()} className="inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-amber-200 hover:underline disabled:opacity-50">{busy ? "Saving…" : "Mark reviewed"}</button>}</td></tr>;
}

function money(value: number, currency: string) { try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value); } catch { return `${value.toFixed(2)} ${currency}`; } }
