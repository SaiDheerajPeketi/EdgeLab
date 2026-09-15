import { useMemo, useState } from "react";
import { ArrowRight, ChevronLeft, Lightbulb, Target } from "lucide-react";
import {
  DEFAULT_JOURNAL_FILTERS,
  buildJournalBreakdown,
  filterJournalTrades,
  journalAssetMix,
  numeric,
  scopedCurrency,
  summarizeJournalTrades,
  weakSpots,
  type JournalBreakdownDimension,
  type JournalFilters,
} from "../../lib/journalAnalytics";
import type { CanonicalTrade, JournalAccount, JournalTag } from "../../lib/journalApi";
import { JournalButton, JournalEmpty, JournalFilterBar } from "./JournalControls";

const DIMENSIONS: Array<{ id: JournalBreakdownDimension; label: string }> = [
  { id: "market", label: "Market" }, { id: "symbol", label: "Symbol" }, { id: "direction", label: "Direction" },
  { id: "duration", label: "Duration" }, { id: "size", label: "Size" }, { id: "strategy", label: "Strategy" },
  { id: "tag", label: "Tag" }, { id: "rating", label: "Rating" }, { id: "grade", label: "Grade" },
  { id: "weekday", label: "Weekday" }, { id: "hour", label: "Time of day" }, { id: "account", label: "Account" },
];

type Props = { accounts: JournalAccount[]; tags: JournalTag[]; trades: CanonicalTrade[]; initialDimension?: JournalBreakdownDimension; onOpenTrade: (trade: CanonicalTrade) => void };

export function JournalAnalyticsSurface({ accounts, tags, trades, initialDimension = "market", onOpenTrade }: Props) {
  const [filters, setFilters] = useState<JournalFilters>(DEFAULT_JOURNAL_FILTERS);
  const [dimension, setDimension] = useState<JournalBreakdownDimension>(initialDimension);
  const [drillIds, setDrillIds] = useState<number[] | null>(null);
  const filtered = useMemo(() => filterJournalTrades(trades, filters), [filters, trades]);
  const rows = useMemo(() => buildJournalBreakdown(filtered, dimension, accounts), [accounts, dimension, filtered]);
  const summary = useMemo(() => summarizeJournalTrades(filtered), [filtered]);
  const weak = useMemo(() => weakSpots(filtered, accounts), [accounts, filtered]);
  const currency = useMemo(() => scopedCurrency(accounts, [...new Set(filtered.map((trade) => trade.account_id))]), [accounts, filtered]);
  const drillTrades = drillIds ? filtered.filter((trade) => drillIds.includes(trade.id)) : [];

  return <div className="space-y-6">
    <section aria-labelledby="analytics-heading"><div className="flex flex-wrap items-end justify-between gap-3"><div><h1 id="analytics-heading" className="text-xl font-semibold text-white">Analytics</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">One filter context powers every breakdown. Select any result to inspect the exact underlying trades.</p></div><p className="text-xs text-slate-500">{filtered.length.toLocaleString()} matching trades · {summary.reviewedPercent.toFixed(0)}% reviewed</p></div></section>
    <JournalFilterBar accounts={accounts} filters={filters} tags={tags} trades={trades} onChange={(next) => { setFilters(next); setDrillIds(null); }} />
    {!currency.combinable ? <p className="rounded-md border border-amber-300/20 bg-amber-300/[0.05] px-3 py-2 text-xs leading-5 text-amber-100">This filter contains {currency.currencies?.join(", ")}. P&amp;L totals remain labeled by row currency context; use account filtering before comparing monetary totals.</p> : null}

    <section aria-labelledby="asset-mix-heading" className="border-t border-white/10 pt-5"><div className="flex items-center gap-2"><Target aria-hidden="true" className="h-4 w-4 text-cyan-300" /><h2 id="asset-mix-heading" className="text-base font-semibold text-white">Position mix</h2></div><div className="mt-4 grid gap-8 xl:grid-cols-2"><AssetMix title="By market" rows={journalAssetMix(filtered, "market")} onSelect={(market) => setFilters((current) => ({ ...current, market }))} /><AssetMix title="By symbol" rows={journalAssetMix(filtered, "symbol")} onSelect={(symbol) => setFilters((current) => ({ ...current, symbol }))} /></div></section>

    <section aria-labelledby="breakdown-heading" className="border-t border-white/10 pt-5">
      <div className="flex flex-wrap items-center gap-2"><h2 id="breakdown-heading" className="mr-2 text-base font-semibold text-white">Performance breakdown</h2><div role="tablist" aria-label="Breakdown dimension" className="flex flex-wrap gap-1">{DIMENSIONS.map((item) => <button key={item.id} type="button" role="tab" aria-selected={dimension === item.id} onClick={() => { setDimension(item.id); setDrillIds(null); }} className={`min-h-9 rounded px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${dimension === item.id ? "bg-cyan-300/10 text-cyan-100" : "text-slate-500 hover:bg-white/5 hover:text-slate-200"}`}>{item.label}</button>)}</div></div>
      <div className="mt-4 overflow-x-auto border-y border-white/10"><table className="w-full min-w-[58rem] text-left text-sm"><thead><tr className="border-b border-white/10 text-[11px] uppercase tracking-wide text-slate-600"><th className="px-3 py-2 font-medium">Segment</th><th className="px-3 py-2 text-right font-medium">Trades</th><th className="px-3 py-2 text-right font-medium">Win rate</th><th className="px-3 py-2 text-right font-medium">Gross</th><th className="px-3 py-2 text-right font-medium">Costs</th><th className="px-3 py-2 text-right font-medium">Net</th><th className="px-3 py-2 text-right font-medium">Expectancy</th><th className="px-3 py-2 text-right font-medium">PF</th><th className="px-3 py-2"><span className="sr-only">Open</span></th></tr></thead><tbody className="divide-y divide-white/8">{rows.map((row) => <tr key={row.key} className="hover:bg-white/[0.035]"><th scope="row" className="px-3 py-3 font-medium text-white">{row.label}</th><td className="px-3 py-3 text-right tabular-nums text-slate-300">{row.totalTrades}</td><td className="px-3 py-3 text-right tabular-nums text-slate-300">{row.winRate.toFixed(1)}%</td><MoneyCell value={row.grossPnl} currency={currency.currency} combinable={currency.combinable} /><MoneyCell value={-row.costs} currency={currency.currency} combinable={currency.combinable} muted /><MoneyCell value={row.netPnl} currency={currency.currency} combinable={currency.combinable} /><MoneyCell value={row.expectancy} currency={currency.currency} combinable={currency.combinable} /><td className="px-3 py-3 text-right tabular-nums text-slate-300">{row.profitFactor == null ? "∞" : row.profitFactor.toFixed(2)}</td><td className="px-3 py-3 text-right"><button type="button" onClick={() => setDrillIds(row.tradeIds)} aria-label={`Open trades for ${row.label}`} className="inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-cyan-300 hover:underline">Drill in <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" /></button></td></tr>)}</tbody></table>{!rows.length ? <JournalEmpty title="No data for this breakdown" detail="Adjust filters or add trades with the fields required by this dimension." /> : null}</div>
    </section>

    <section aria-labelledby="weak-spots-heading" className="border-t border-white/10 pt-5"><div className="flex items-center gap-2"><Lightbulb aria-hidden="true" className="h-4 w-4 text-cyan-300" /><h2 id="weak-spots-heading" className="text-base font-semibold text-white">Weak spots and strengths</h2></div><p className="mt-1 text-xs text-slate-500">Ranked by expectancy within each dimension. Small samples are shown, not overstated.</p><div className="mt-4 grid gap-px overflow-hidden rounded-md bg-white/10 md:grid-cols-2 xl:grid-cols-3">{weak.map(({ dimension: weakDimension, best, worst }) => <button type="button" key={weakDimension} onClick={() => { setDimension(weakDimension); setDrillIds(worst.tradeIds); }} className="bg-[#0d1117] p-3 text-left outline-none hover:bg-white/[0.045] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300"><span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">{DIMENSIONS.find((item) => item.id === weakDimension)?.label ?? weakDimension}</span><span className="mt-2 block text-xs text-emerald-300">Best · {best.label} · {best.expectancy.toFixed(2)} avg</span><span className="mt-1 block text-xs text-rose-300">Review · {worst.label} · {worst.expectancy.toFixed(2)} avg</span><span className="mt-2 block text-[10px] text-slate-600">{worst.totalTrades} trade sample · open exact rows</span></button>)}</div></section>

    {drillIds ? <section aria-labelledby="drilldown-heading" className="border-t border-cyan-300/20 pt-5"><div className="flex items-center gap-3"><JournalButton onClick={() => setDrillIds(null)}><ChevronLeft aria-hidden="true" className="h-4 w-4" />Back to breakdown</JournalButton><div><h2 id="drilldown-heading" className="text-base font-semibold text-white">Underlying trades</h2><p className="text-xs text-slate-500">Exact rows from the selected segment; filters remain active.</p></div></div><div className="mt-4 divide-y divide-white/8 border-y border-white/10">{drillTrades.map((trade) => <button key={trade.id} type="button" onClick={() => onOpenTrade(trade)} className="grid w-full gap-2 px-2 py-3 text-left outline-none hover:bg-white/[0.035] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300 sm:grid-cols-[8rem_6rem_minmax(0,1fr)_7rem]"><span className="text-xs text-slate-500">{new Date(trade.entry_time).toLocaleDateString()}</span><span className="font-semibold text-white">{trade.symbol}</span><span className="truncate text-sm text-slate-400">{trade.strategy_name ?? "Unassigned"} · {trade.tags.map((tag) => tag.name).join(", ") || "untagged"}</span><span className={`text-right font-medium tabular-nums ${numeric(trade.net_pnl) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{money(numeric(trade.net_pnl), trade.currency)}</span></button>)}{!drillTrades.length ? <p className="py-8 text-center text-sm text-slate-500">No underlying rows remain in the current filter.</p> : null}</div></section> : null}
  </div>;
}

function AssetMix({ title, rows, onSelect }: { title: string; rows: ReturnType<typeof journalAssetMix>; onSelect: (label: string) => void }) {
  let offset = 0;
  const palette = ["#67e8f9", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#94a3b8"];
  return <div><h3 className="text-xs font-semibold text-slate-300">{title}</h3><div className="mt-3 flex flex-col gap-5 sm:flex-row sm:items-center"><svg viewBox="0 0 42 42" role="img" aria-label={`${title} across ${rows.length} segments`} className="h-32 w-32 shrink-0 -rotate-90">{rows.map((row, index) => { const circle = <circle key={row.label} cx="21" cy="21" r="15.915" fill="none" stroke={palette[index % palette.length]} strokeWidth="6" strokeDasharray={`${row.percent} ${100 - row.percent}`} strokeDashoffset={-offset} />; offset += row.percent; return circle; })}</svg><div className="grid min-w-0 flex-1 gap-1">{rows.map((row, index) => <button key={row.label} type="button" onClick={() => onSelect(row.label)} className="flex min-h-9 items-center gap-2 rounded px-2 text-left text-sm text-slate-300 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: palette[index % palette.length] }} /><span className="min-w-0 flex-1 truncate">{row.label}</span><span className="tabular-nums text-slate-500">{row.count} · {row.percent.toFixed(0)}%</span></button>)}{!rows.length ? <p className="text-sm text-slate-500">Position mix appears after trades are added.</p> : null}</div></div></div>;
}

function MoneyCell({ value, currency, combinable, muted }: { value: number; currency: string; combinable: boolean; muted?: boolean }) { return <td className={`px-3 py-3 text-right tabular-nums ${muted ? "text-slate-500" : value >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{combinable ? money(value, currency) : "—"}</td>; }
function money(value: number, currency: string) { try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value); } catch { return `${value.toFixed(2)} ${currency}`; } }
