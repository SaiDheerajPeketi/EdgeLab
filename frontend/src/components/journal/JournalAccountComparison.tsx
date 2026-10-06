import { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight, CalendarDays, Scale } from "lucide-react";
import {
  equityCurve,
  journalCalendar,
  numeric,
  summarizeJournalTrades,
  scopedCurrency,
} from "../../lib/journalAnalytics";
import type { CanonicalTrade, JournalAccount } from "../../lib/journalApi";
import { journalFieldClass } from "./JournalControls";

import { COMPARISON_LENSES, strongestJournalSegment, useJournalComparison } from "./useJournalDashboard";

export function JournalAccountComparison({ accounts, trades }: { accounts: JournalAccount[]; trades: CanonicalTrade[] }) {
  const { leftId, rightId, selectComparison } = useJournalComparison(accounts);
  const setLeftId = (id: number) => selectComparison("left", id);
  const setRightId = (id: number) => selectComparison("right", id);
  if (accounts.length < 2) return null;

  const left = accounts.find((account) => account.id === leftId) ?? accounts[0];
  const right = accounts.find((account) => account.id === rightId) ?? accounts[1];
  const leftTrades = trades.filter((trade) => trade.account_id === left.id);
  const rightTrades = trades.filter((trade) => trade.account_id === right.id);
  const sameCurrency = left.currency === right.currency;

  return <section aria-labelledby="account-comparison-heading" className="border-t border-white/10 pt-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><div className="flex items-center gap-2"><Scale aria-hidden="true" className="h-4 w-4 text-cyan-300" /><h2 id="account-comparison-heading" className="text-base font-semibold text-white">Account comparison</h2></div><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">Two independent account scopes, one consistent set of performance and process measures.</p></div><p className="text-xs text-slate-500">No implicit FX conversion</p></div>
    <div className="mt-4 grid gap-px overflow-hidden rounded-md bg-white/10 lg:grid-cols-2">
      <AccountColumn account={left} accounts={accounts} trades={leftTrades} value={left.id} onChange={setLeftId} side="left" />
      <AccountColumn account={right} accounts={accounts} trades={rightTrades} value={right.id} onChange={setRightId} side="right" />
    </div>
    {!sameCurrency ? <div role="note" className="border-x border-b border-amber-300/20 bg-amber-300/[0.05] px-4 py-3 text-xs leading-5 text-amber-100"><strong>{left.currency} and {right.currency} stay separate.</strong> Monetary KPIs and equity curves remain in each account’s native currency; percentage, R-multiple, rating, and process comparisons remain valid.</div> : null}
    <ComparisonCalendar left={left} right={right} leftTrades={leftTrades} rightTrades={rightTrades} />
    <ComparisonMatrix left={left} right={right} leftTrades={leftTrades} rightTrades={rightTrades} />
  </section>;
}

function AccountColumn({ account, accounts, trades, value, onChange, side }: { account: JournalAccount; accounts: JournalAccount[]; trades: CanonicalTrade[]; value: number; onChange: (id: number) => void; side: "left" | "right" }) {
  const summary = useMemo(() => summarizeJournalTrades(trades), [trades]);
  const currency = scopedCurrency([account], [account.id], trades);
  const cash = (value: number) => currency.combinable ? money(value, account.currency) : "Separate currencies";
  const curve = useMemo(() => equityCurve(trades, numeric(account.initial_balance)), [account.initial_balance, trades]);
  return <div className="bg-[#0d1117] p-4">
    <label className="text-xs text-slate-500">{side === "left" ? "First account" : "Second account"}<select aria-label={`${side === "left" ? "First" : "Second"} comparison account`} className={`${journalFieldClass} mt-1`} value={value} onChange={(event) => onChange(Number(event.target.value))}>{accounts.map((option) => <option key={option.id} value={option.id}>{option.name} · {option.currency}</option>)}</select></label>
    <div className="mt-4 flex items-end justify-between gap-3"><div><p className={`text-2xl font-semibold tabular-nums ${summary.netPnl >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{cash(summary.netPnl)}</p><p className="mt-1 text-[11px] text-slate-500">Net P&amp;L · {summary.closedTrades} closed trades</p></div>{currency.combinable ? summary.netPnl >= 0 ? <ArrowUpRight aria-label="Positive net result" className="h-5 w-5 text-emerald-300" /> : <ArrowDownRight aria-label="Negative net result" className="h-5 w-5 text-rose-300" /> : null}</div>
    {!currency.combinable ? <p className="mt-3 text-xs text-amber-100">Account and trade currencies differ. Monetary results and rankings stay separate.</p> : null}
    {currency.combinable ? <MiniEquity values={curve.map((point) => point.value)} label={`${account.name} equity curve in ${account.currency}`} /> : null}
    <dl className="mt-4 grid grid-cols-2 gap-x-5 border-y border-white/10 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4"><Kpi label="Balance" value={cash(numeric(account.initial_balance) + summary.netPnl)} /><Kpi label="Gross P&L" value={cash(summary.grossPnl)} /><Kpi label="Win rate" value={`${summary.winRate.toFixed(1)}%`} /><Kpi label="Profit factor" value={!currency.combinable ? "Separate currencies" : summary.profitFactor == null ? "No losses" : summary.profitFactor.toFixed(2)} /><Kpi label="Trades" value={summary.closedTrades.toLocaleString()} /><Kpi label="Costs" value={cash(summary.costs)} /><Kpi label="Drawdown" value={cash(summary.maxDrawdown)} /><Kpi label="Expectancy" value={cash(summary.expectancy)} /></dl>
  </div>;
}

function ComparisonCalendar({ left, right, leftTrades, rightTrades }: { left: JournalAccount; right: JournalAccount; leftTrades: CanonicalTrade[]; rightTrades: CanonicalTrade[] }) {
  const leftDays = new Map(journalCalendar(leftTrades).map((day) => [day.date, day.summary]));
  const rightDays = new Map(journalCalendar(rightTrades).map((day) => [day.date, day.summary]));
  const dates = [...new Set([...leftDays.keys(), ...rightDays.keys()])].sort().slice(-28);
  return <section aria-labelledby="comparison-calendar-heading" className="mt-6 border-t border-white/10 pt-5"><div className="flex items-center gap-2"><CalendarDays aria-hidden="true" className="h-4 w-4 text-cyan-300" /><h3 id="comparison-calendar-heading" className="text-sm font-semibold text-white">Trading-day comparison</h3><span className="ml-auto text-xs text-slate-500">Last {dates.length || 0} active days</span></div>{dates.length ? <div className="mt-3 overflow-x-auto focus-visible:outline focus-visible:outline-cyan-300" role="region" aria-label="Trading-day comparison table" tabIndex={0}><table className="w-full min-w-[38rem] text-sm"><thead><tr className="border-y border-white/10 text-[11px] uppercase tracking-wide text-slate-600"><th className="px-3 py-2 text-left font-medium">Date</th><th className="px-3 py-2 text-right font-medium">{left.name}</th><th className="px-3 py-2 text-right font-medium">Trades</th><th className="px-3 py-2 text-right font-medium">{right.name}</th><th className="px-3 py-2 text-right font-medium">Trades</th></tr></thead><tbody className="divide-y divide-white/8">{dates.map((date) => { const a = leftDays.get(date); const b = rightDays.get(date); return <tr key={date} className="hover:bg-white/[0.025]"><th scope="row" className="px-3 py-2 text-left text-xs font-medium text-slate-400">{new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}</th><ResultCell summary={a} currency={left.currency} combinable={scopedCurrency([left], [left.id], leftTrades).combinable} /><td className="px-3 py-2 text-right tabular-nums text-slate-500">{a?.totalTrades ?? 0}</td><ResultCell summary={b} currency={right.currency} combinable={scopedCurrency([right], [right.id], rightTrades).combinable} /><td className="px-3 py-2 text-right tabular-nums text-slate-500">{b?.totalTrades ?? 0}</td></tr>; })}</tbody></table></div> : <p className="mt-3 border-y border-dashed border-white/10 py-6 text-center text-sm text-slate-500">Closed trades will populate the shared comparison calendar.</p>}</section>;
}

function ResultCell({ summary, currency, combinable }: { summary?: ReturnType<typeof summarizeJournalTrades>; currency: string; combinable: boolean }) { const value = summary?.netPnl ?? 0; return <td className={`px-3 py-2 text-right font-medium tabular-nums ${!summary ? "text-slate-600" : value >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{summary ? combinable ? money(value, currency) : "Separate currencies" : "—"}</td>; }

function ComparisonMatrix({ left, right, leftTrades, rightTrades }: { left: JournalAccount; right: JournalAccount; leftTrades: CanonicalTrade[]; rightTrades: CanonicalTrade[] }) {
  return <div className="mt-4 overflow-x-auto focus-visible:outline focus-visible:outline-cyan-300" role="region" aria-label="Account comparison lens table" tabIndex={0}><table className="w-full min-w-[46rem] text-sm"><caption className="sr-only">Account performance by direction, market, symbol, time, holding duration, size, tag, rating, and strategy</caption><thead><tr className="border-y border-white/10 text-left text-[11px] uppercase tracking-wide text-slate-600"><th className="px-3 py-2 font-medium">Lens</th><th className="px-3 py-2 font-medium">{left.name} strongest</th><th className="px-3 py-2 text-right font-medium">Expectancy</th><th className="px-3 py-2 font-medium">{right.name} strongest</th><th className="px-3 py-2 text-right font-medium">Expectancy</th></tr></thead><tbody className="divide-y divide-white/8">{COMPARISON_LENSES.map(({ dimension, label }) => { const a = strongestJournalSegment(leftTrades, dimension, left); const b = strongestJournalSegment(rightTrades, dimension, right); return <tr key={dimension} className="hover:bg-white/[0.025]"><th scope="row" className="px-3 py-3 text-left text-xs font-medium text-slate-400">{label}</th><td className="px-3 py-3 text-slate-200">{a?.label ?? "Not enough data"}<span className="ml-2 text-[10px] text-slate-600">{a ? `${a.closedTrades} trades` : ""}</span></td><td className="px-3 py-3 text-right tabular-nums text-slate-300">{a ? money(a.expectancy, left.currency) : "—"}</td><td className="px-3 py-3 text-slate-200">{b?.label ?? "Not enough data"}<span className="ml-2 text-[10px] text-slate-600">{b ? `${b.closedTrades} trades` : ""}</span></td><td className="px-3 py-3 text-right tabular-nums text-slate-300">{b ? money(b.expectancy, right.currency) : "—"}</td></tr>; })}</tbody></table></div>;
}

function Kpi({ label, value }: { label: string; value: string }) { return <div className="py-3"><dt className="text-[10px] uppercase tracking-wide text-slate-600">{label}</dt><dd className="mt-1 font-medium tabular-nums text-slate-200">{value}</dd></div>; }
function MiniEquity({ values, label }: { values: number[]; label: string }) { if (values.length < 2) return <div className="mt-4 grid h-20 place-items-center border-y border-dashed border-white/10 text-xs text-slate-600">Close two trades to compare the curve.</div>; const width = 420, height = 80, pad = 5, min = values.reduce((a, b) => Math.min(a, b), Infinity), max = values.reduce((a, b) => Math.max(a, b), -Infinity), range = max - min || 1; const path = values.map((value, index) => `${index ? "L" : "M"}${pad + index / (values.length - 1) * (width - pad * 2)},${height - pad - (value - min) / range * (height - pad * 2)}`).join(" "); const positive = values.at(-1)! >= values[0]; return <svg className="mt-4 h-20 w-full" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}><path d={path} fill="none" stroke={positive ? "#67e8f9" : "#fda4af"} strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>; }
function money(value: number, currency: string) { try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value); } catch { return `${value.toFixed(2)} ${currency}`; } }
