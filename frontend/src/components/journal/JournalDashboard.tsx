import { useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, Gauge, LineChart, Save, ShieldAlert } from "lucide-react";
import {
  computeEdgeScore,
  equityCurve,
  journalCalendar,
  numeric,
  riskBehavior,
  scopedCurrency,
  summarizeJournalTrades,
} from "../../lib/journalAnalytics";
import type { CanonicalTrade, JournalAccount, JournalDailyNote } from "../../lib/journalApi";
import { JournalButton, journalFieldClass } from "./JournalControls";

type Props = {
  accounts: JournalAccount[];
  notes: JournalDailyNote[];
  trades: CanonicalTrade[];
  onOpenDate: (date: string) => void;
  onOpenTrade: (trade: CanonicalTrade) => void;
  onSaveNote: (date: string, payload: { account_id?: number | null; body: string }) => Promise<JournalDailyNote>;
};

export function JournalDashboard({ accounts, notes, trades, onOpenDate, onOpenTrade, onSaveNote }: Props) {
  const summary = useMemo(() => summarizeJournalTrades(trades), [trades]);
  const accountIds = useMemo(() => [...new Set(trades.map((trade) => trade.account_id))], [trades]);
  const currency = useMemo(() => scopedCurrency(accounts, accountIds), [accounts, accountIds]);
  const initialBalance = useMemo(() => accounts.filter((account) => !accountIds.length || accountIds.includes(account.id)).reduce((sum, account) => sum + numeric(account.initial_balance), 0), [accounts, accountIds]);
  const equity = useMemo(() => equityCurve(trades, initialBalance), [initialBalance, trades]);
  const edgeScore = useMemo(() => computeEdgeScore(trades), [trades]);
  const risk = useMemo(() => riskBehavior(trades), [trades]);
  const calendar = useMemo(() => journalCalendar(trades), [trades]);
  const latestDate = calendar.at(-1)?.date ?? today();
  const [selectedDate, setSelectedDate] = useState(latestDate);
  const selectedNote = notes.find((note) => note.note_date === selectedDate) ?? null;
  const [noteBody, setNoteBody] = useState(selectedNote?.body ?? "");
  const [noteState, setNoteState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const selectedAccount = accounts.length === 1 ? accounts[0].id : null;

  useEffect(() => { setNoteBody(selectedNote?.body ?? ""); setNoteState("idle"); }, [selectedDate, selectedNote?.id, selectedNote?.body]);

  const days = useMemo(() => calendarDays(latestDate, calendar), [calendar, latestDate]);
  const selectedTrades = trades.filter((trade) => trade.entry_time.slice(0, 10) === selectedDate);
  const recent = trades.slice().sort((left, right) => Date.parse(right.entry_time) - Date.parse(left.entry_time)).slice(0, 8);
  const money = (value: number) => currency.combinable ? formatMoney(value, currency.currency) : "Separate currencies";

  async function saveNote() {
    setNoteState("saving");
    try { await onSaveNote(selectedDate, { account_id: selectedAccount, body: noteBody }); setNoteState("saved"); }
    catch { setNoteState("error"); }
  }

  return <div className="space-y-8">
    <section aria-labelledby="journal-overview-heading">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 id="journal-overview-heading" className="text-xl font-semibold text-white">Trading overview</h1><p className="mt-1 text-sm text-slate-400">Closed-trade performance, review discipline, and risk behavior for the active account scope.</p></div>{!currency.combinable ? <p className="max-w-md text-xs leading-5 text-amber-200">Totals are separated because this scope includes {currency.currencies?.join(", ")}. Choose one currency for combined P&amp;L.</p> : null}</div>
      <dl className="mt-5 grid border-y border-white/10 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="Net P&L" value={money(summary.netPnl)} tone={currency.combinable ? summary.netPnl : undefined} />
        <Metric label="Win rate" value={`${summary.winRate.toFixed(1)}%`} hint={`${summary.wins}W / ${summary.losses}L`} />
        <Metric label="Profit factor" value={summary.profitFactor == null ? "No losses" : summary.profitFactor.toFixed(2)} />
        <Metric label="Expectancy" value={money(summary.expectancy)} />
        <Metric label="Average R" value={summary.averageR == null ? "Not recorded" : `${summary.averageR.toFixed(2)}R`} />
        <Metric label="Costs" value={money(summary.costs)} hint={`${summary.closedTrades} closed`} />
      </dl>
    </section>

    <div className="grid gap-8 2xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,.8fr)]">
      <section aria-labelledby="equity-heading" className="min-w-0 border-t border-white/10 pt-5"><div className="flex items-center gap-2"><LineChart aria-hidden="true" className="h-4 w-4 text-cyan-300" /><h2 id="equity-heading" className="text-base font-semibold text-white">Equity curve</h2><span className="ml-auto text-xs tabular-nums text-slate-500">Max drawdown {money(summary.maxDrawdown)}</span></div>{currency.combinable && equity.length ? <EquityPlot points={equity.map((point) => point.value)} /> : <div className="mt-4 grid h-56 place-items-center border-y border-dashed border-white/10 text-center text-sm text-slate-500">{currency.combinable ? "Close trades to build the equity curve." : "Choose accounts with the same currency to compare one continuous curve."}</div>}</section>
      <section aria-labelledby="edge-heading" className="border-t border-white/10 pt-5"><div className="flex items-center gap-2"><Gauge aria-hidden="true" className="h-4 w-4 text-cyan-300" /><h2 id="edge-heading" className="text-base font-semibold text-white">Edge Score</h2><span className="ml-auto text-xs capitalize text-slate-500">{edgeScore.confidence} confidence</span></div><div className="mt-4 flex items-baseline gap-3"><span className="text-4xl font-semibold tabular-nums text-white">{edgeScore.score}</span><span className="text-sm capitalize text-slate-400">{edgeScore.direction} · {edgeScore.windowDays}-day window</span></div><p className="mt-2 text-xs leading-5 text-slate-500">Compares {edgeScore.recentCount} recent trades with {edgeScore.previousCount} in the prior window. Low samples reduce confidence, not the score.</p><dl className="mt-4 divide-y divide-white/8 border-y border-white/10">{edgeScore.components.map((component) => <div key={component.label} className="flex items-center justify-between gap-3 py-2 text-xs"><dt className="text-slate-500">{component.label}</dt><dd className="tabular-nums text-slate-200">{component.value > 0 ? "+" : ""}{component.value.toFixed(1)}{component.unit}</dd></div>)}</dl></section>
    </div>

    <section aria-labelledby="risk-heading" className="border-t border-white/10 pt-5"><div className="flex items-center gap-2"><ShieldAlert aria-hidden="true" className="h-4 w-4 text-cyan-300" /><h2 id="risk-heading" className="text-base font-semibold text-white">Risk behavior</h2><span className="ml-auto text-xs text-slate-500">{risk.sampleSize} taken trades</span></div><dl className="mt-4 grid border-y border-white/10 sm:grid-cols-2 lg:grid-cols-5"><Metric label="Discipline score" value={`${risk.score}/100`} /><Metric label="Stop coverage" value={`${risk.stopCoverage.toFixed(0)}%`} /><Metric label="Planned-stop adherence" value={risk.plannedStopAdherence == null ? "Not recorded" : `${risk.plannedStopAdherence.toFixed(0)}%`} /><Metric label="Oversized trades" value={String(risk.oversizedCount)} /><Metric label="Size after losses" value={String(risk.lossEscalations)} /></dl></section>

    <div className="grid gap-8 2xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,.75fr)]">
      <section aria-labelledby="calendar-heading" className="min-w-0 border-t border-white/10 pt-5"><div className="flex items-center gap-2"><CalendarDays aria-hidden="true" className="h-4 w-4 text-cyan-300" /><h2 id="calendar-heading" className="text-base font-semibold text-white">Trading calendar</h2><span className="ml-auto text-xs text-slate-500">Select a day for its note and trades</span></div><div className="mt-4 grid grid-cols-7 gap-px overflow-hidden rounded-md bg-white/10" role="grid" aria-label="Recent trading days">{["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((day) => <div key={day} role="columnheader" className="bg-[#0d1117] px-1 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-600">{day}</div>)}{days.map((day) => <button key={day.date} type="button" role="gridcell" aria-selected={selectedDate === day.date} onClick={() => { setSelectedDate(day.date); onOpenDate(day.date); }} className={`min-h-16 bg-[#0d1117] p-2 text-left outline-none hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300 ${selectedDate === day.date ? "bg-cyan-300/[0.08]" : ""}`}><span className="text-[11px] text-slate-500">{Number(day.date.slice(8))}</span>{day.summary ? <><span className={`mt-1 block text-xs font-semibold tabular-nums ${day.summary.netPnl >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{currency.combinable ? compactMoney(day.summary.netPnl, currency.currency) : `${day.summary.totalTrades} trades`}</span><span className="mt-0.5 block text-[10px] text-slate-600">{day.summary.totalTrades} · {day.summary.winRate.toFixed(0)}%</span></> : null}</button>)}</div></section>
      <section aria-labelledby="daily-note-heading" className="border-t border-white/10 pt-5"><div className="flex items-center justify-between gap-3"><div><h2 id="daily-note-heading" className="text-base font-semibold text-white">Daily note</h2><p className="mt-1 text-xs text-slate-500">{formatDate(selectedDate)} · {selectedTrades.length} trade{selectedTrades.length === 1 ? "" : "s"}</p></div><button type="button" onClick={() => onOpenDate(selectedDate)} className="min-h-9 text-xs font-semibold text-cyan-300 hover:underline">Open full day</button></div><label className="mt-4 block text-xs text-slate-500">Session reflection<textarea className={`${journalFieldClass} mt-1 min-h-40 resize-y py-2`} value={noteBody} onChange={(event) => { setNoteBody(event.target.value); setNoteState("idle"); }} placeholder="Plan quality, execution, emotions, and what to carry forward…" /></label><div className="mt-3 flex items-center justify-between gap-3"><span className={`text-xs ${noteState === "error" ? "text-rose-200" : "text-slate-500"}`}>{noteState === "saving" ? "Saving…" : noteState === "saved" ? "Saved across devices" : noteState === "error" ? "Save failed. Your text is still here." : "Explicit save"}</span><JournalButton onClick={() => void saveNote()} disabled={noteState === "saving" || noteBody === (selectedNote?.body ?? "")} tone="primary"><Save aria-hidden="true" className="h-4 w-4" />{noteState === "error" ? "Retry" : "Save note"}</JournalButton></div></section>
    </div>

    <AccountComparison accounts={accounts} trades={trades} />

    <section aria-labelledby="recent-trades-heading" className="border-t border-white/10 pt-5"><div className="flex items-center justify-between gap-3"><h2 id="recent-trades-heading" className="text-base font-semibold text-white">Recent trades</h2><span className="text-xs text-slate-500">Open any row in the shared review drawer</span></div><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[44rem] border-collapse text-left text-sm"><thead><tr className="border-y border-white/10 text-[11px] uppercase tracking-wide text-slate-600"><th className="px-2 py-2 font-medium">Time</th><th className="px-2 py-2 font-medium">Symbol</th><th className="px-2 py-2 font-medium">Side</th><th className="px-2 py-2 font-medium">Strategy</th><th className="px-2 py-2 text-right font-medium">Net</th><th className="px-2 py-2 text-right font-medium">Review</th></tr></thead><tbody className="divide-y divide-white/8">{recent.map((trade) => <tr key={trade.id} onClick={() => onOpenTrade(trade)} className="cursor-pointer text-slate-300 outline-none hover:bg-white/[0.035]" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenTrade(trade); } }}><td className="px-2 py-3 text-xs text-slate-500">{new Date(trade.entry_time).toLocaleString()}</td><td className="px-2 py-3 font-semibold text-white">{trade.symbol}</td><td className="px-2 py-3 text-xs">{trade.side}</td><td className="px-2 py-3">{trade.strategy_name ?? "Unassigned"}</td><td className={`px-2 py-3 text-right font-medium tabular-nums ${numeric(trade.net_pnl) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{formatMoney(numeric(trade.net_pnl), trade.currency)}</td><td className="px-2 py-3 text-right">{trade.reviewed ? <span className="inline-flex items-center gap-1 text-xs text-emerald-300"><CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />Done</span> : <span className="text-xs text-amber-200">Pending</span>}</td></tr>)}</tbody></table>{!recent.length ? <p className="border-b border-white/10 py-8 text-center text-sm text-slate-500">No trades in this scope yet.</p> : null}</div></section>
  </div>;
}

function Metric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: number }) { return <div className="min-w-0 border-b border-white/10 px-3 py-4 last:border-b-0 sm:border-r sm:last:border-r-0 xl:border-b-0"><dt className="text-[11px] uppercase tracking-wide text-slate-600">{label}</dt><dd className={`mt-1 truncate text-lg font-semibold tabular-nums ${tone == null ? "text-white" : tone >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{value}</dd>{hint ? <p className="mt-1 text-[11px] text-slate-600">{hint}</p> : null}</div>; }

function EquityPlot({ points }: { points: number[] }) {
  const width = 900, height = 224, pad = 12;
  const min = Math.min(...points), max = Math.max(...points), range = max - min || 1;
  const path = points.map((value, index) => `${index ? "L" : "M"}${pad + index / Math.max(1, points.length - 1) * (width - pad * 2)},${height - pad - (value - min) / range * (height - pad * 2)}`).join(" ");
  const positive = points.at(-1)! >= points[0];
  return <div className="mt-4"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Equity moved from ${points[0].toFixed(2)} to ${points.at(-1)!.toFixed(2)}`} className="h-56 w-full overflow-visible"><defs><linearGradient id="journal-equity-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={positive ? "#67e8f9" : "#fda4af"} stopOpacity=".22" /><stop offset="1" stopColor={positive ? "#67e8f9" : "#fda4af"} stopOpacity="0" /></linearGradient></defs><path d={`${path} L${width-pad},${height-pad} L${pad},${height-pad} Z`} fill="url(#journal-equity-fill)" /><path d={path} fill="none" stroke={positive ? "#67e8f9" : "#fda4af"} strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg><div className="flex justify-between text-[10px] tabular-nums text-slate-600"><span>{points[0].toFixed(2)}</span><span>{points.at(-1)!.toFixed(2)}</span></div></div>;
}

function AccountComparison({ accounts, trades }: { accounts: JournalAccount[]; trades: CanonicalTrade[] }) {
  const [leftId, setLeftId] = useState(() => accounts[0]?.id ?? 0);
  const [rightId, setRightId] = useState(() => accounts[1]?.id ?? accounts[0]?.id ?? 0);
  useEffect(() => { if (!accounts.some((account) => account.id === leftId)) setLeftId(accounts[0]?.id ?? 0); if (!accounts.some((account) => account.id === rightId)) setRightId(accounts[1]?.id ?? accounts[0]?.id ?? 0); }, [accounts, leftId, rightId]);
  if (accounts.length < 2) return null;
  const left = accounts.find((account) => account.id === leftId) ?? accounts[0];
  const right = accounts.find((account) => account.id === rightId) ?? accounts[1];
  const sameCurrency = left.currency === right.currency;
  return <section aria-labelledby="comparison-heading" className="border-t border-white/10 pt-5"><div><h2 id="comparison-heading" className="text-base font-semibold text-white">Account comparison</h2><p className="mt-1 text-xs text-slate-500">Compare process metrics across two accounts. Currency totals are never converted implicitly.</p></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><AccountSelect label="First account" value={left.id} accounts={accounts} onChange={setLeftId} /><AccountSelect label="Second account" value={right.id} accounts={accounts} onChange={setRightId} /></div>{!sameCurrency ? <p className="mt-3 rounded-md border border-amber-300/20 bg-amber-300/[0.05] px-3 py-2 text-xs leading-5 text-amber-100">Mixed-currency guard: {left.currency} and {right.currency} P&amp;L stay in separate columns. Win rate, R, and review discipline remain comparable.</p> : null}<div className="mt-3 overflow-x-auto"><table className="w-full min-w-[34rem] text-sm"><thead><tr className="border-y border-white/10 text-left text-xs text-slate-500"><th className="px-2 py-2 font-medium">Metric</th><th className="px-2 py-2 text-right font-medium">{left.name}</th><th className="px-2 py-2 text-right font-medium">{right.name}</th></tr></thead><tbody className="divide-y divide-white/8">{comparisonRows(left, right, trades).map((row) => <tr key={row.label}><th className="px-2 py-2 text-left text-xs font-normal text-slate-500">{row.label}</th><td className="px-2 py-2 text-right tabular-nums text-slate-200">{row.left}</td><td className="px-2 py-2 text-right tabular-nums text-slate-200">{row.right}</td></tr>)}</tbody></table></div></section>;
}

function AccountSelect({ label, value, accounts, onChange }: { label: string; value: number; accounts: JournalAccount[]; onChange: (id: number) => void }) { return <label className="text-xs text-slate-500">{label}<select className={`${journalFieldClass} mt-1`} value={value} onChange={(event) => onChange(Number(event.target.value))}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label>; }
function comparisonRows(left: JournalAccount, right: JournalAccount, trades: CanonicalTrade[]) { const a = summarizeJournalTrades(trades.filter((trade) => trade.account_id === left.id)); const b = summarizeJournalTrades(trades.filter((trade) => trade.account_id === right.id)); return [{ label: "Net P&L", left: formatMoney(a.netPnl, left.currency), right: formatMoney(b.netPnl, right.currency) }, { label: "Win rate", left: `${a.winRate.toFixed(1)}%`, right: `${b.winRate.toFixed(1)}%` }, { label: "Profit factor", left: a.profitFactor == null ? "No losses" : a.profitFactor.toFixed(2), right: b.profitFactor == null ? "No losses" : b.profitFactor.toFixed(2) }, { label: "Average R", left: a.averageR == null ? "—" : `${a.averageR.toFixed(2)}R`, right: b.averageR == null ? "—" : `${b.averageR.toFixed(2)}R` }, { label: "Reviewed", left: `${a.reviewedPercent.toFixed(0)}%`, right: `${b.reviewedPercent.toFixed(0)}%` }]; }
function calendarDays(endDate: string, entries: ReturnType<typeof journalCalendar>) { const byDate = new Map(entries.map((entry) => [entry.date, entry.summary])); const end = new Date(`${endDate}T12:00:00Z`); const weekday = (end.getUTCDay() + 6) % 7; end.setUTCDate(end.getUTCDate() + (6 - weekday)); return Array.from({ length: 42 }, (_, index) => { const date = new Date(end); date.setUTCDate(end.getUTCDate() - 41 + index); const key = date.toISOString().slice(0, 10); return { date: key, summary: byDate.get(key) ?? null }; }); }
function formatMoney(value: number, currency: string) { try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value); } catch { return `${value.toFixed(2)} ${currency}`; } }
function compactMoney(value: number, currency: string) { try { return new Intl.NumberFormat(undefined, { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(value); } catch { return `${value.toFixed(0)} ${currency}`; } }
function formatDate(date: string) { return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }); }
function today() { return new Date().toISOString().slice(0, 10); }
