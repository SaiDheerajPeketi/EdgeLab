import { useEffect, useMemo, useState } from "react";
import { buildJournalBreakdown, computeEdgeScore, equityCurve, journalCalendar, numeric, riskBehavior, scopedCurrency, summarizeJournalTrades, type JournalBreakdownDimension } from "../../lib/journalAnalytics";
import type { CanonicalTrade, JournalAccount } from "../../lib/journalApi";
import { isJournalDate } from "../../lib/journalDailyNotes";
import { navigationStateFor, updateNavigationState, type NavigationSurfaceState } from "../../lib/navigationState";
import { restoreSurfaceValue } from "../../lib/useRestorableSurfaceState";

const surface = "journal:dashboard";
const dateSchema = { version: 1, validate: (value: unknown): value is string => typeof value === "string" && isJournalDate(value) };
type PreviousReflection = { date: string; body: string };
const reflectionSchema = { version: 1, validate: (value: unknown): value is PreviousReflection | null => value === null || Boolean(value && typeof value === "object" && isJournalDate(String((value as PreviousReflection).date)) && typeof (value as PreviousReflection).body === "string") };
type Comparison = { leftId: number; rightId: number };
const comparisonSchema = { version: 1, validate: (value: unknown): value is Comparison => Boolean(value && typeof value === "object" && [ (value as Comparison).leftId, (value as Comparison).rightId ].every((id) => Number.isSafeInteger(id) && id > 0)) };
function persistContext(key: "selectedId" | "viewport", value: unknown) {
  updateNavigationState(surface, { [key]: { __schemaVersion: 1, value } } as Partial<NavigationSurfaceState>);
}

export function useJournalDashboard(accounts: JournalAccount[], trades: CanonicalTrade[], initialDate?: string | null) {
  const model = useMemo(() => ({
    summary: summarizeJournalTrades(trades),
    currency: scopedCurrency(accounts, accounts.map((account) => account.id), trades),
    initialBalance: accounts.reduce((sum, account) => sum + numeric(account.initial_balance), 0),
    edgeScore: computeEdgeScore(trades), risk: riskBehavior(trades), calendar: journalCalendar(trades),
    recent: trades.slice().sort((a, b) => Date.parse(b.entry_time) - Date.parse(a.entry_time) || b.id - a.id).slice(0, 8),
  }), [accounts, trades]);
  const [restoredDate, setRestoredDate] = useState(() => restoreSurfaceValue(navigationStateFor(surface)?.selectedId, model.calendar.at(-1)?.date ?? new Date().toISOString().slice(0, 10), dateSchema));
  const selectedDate = initialDate && isJournalDate(initialDate) ? initialDate : restoredDate;
  const persistDate = (date: string) => persistContext("selectedId", date);
  useEffect(() => { persistDate(selectedDate); setRestoredDate(selectedDate); }, [selectedDate]);
  const selectDate = (date: string) => { if (!isJournalDate(date)) return; persistDate(date); setRestoredDate(date); };
  const [previousReflection] = useState(() => restoreSurfaceValue(navigationStateFor(surface)?.draft, null, reflectionSchema));
  const equity = useMemo(() => equityCurve(trades, model.initialBalance), [trades, model.initialBalance]);
  const days = useMemo(() => dashboardCalendarDays(selectedDate, model.calendar), [selectedDate, model.calendar]);
  return { ...model, equity, days, selectedDate, selectDate, previousReflection, selectedAccount: accounts.length === 1 ? accounts[0].id : null };
}

export function useJournalComparison(accounts: JournalAccount[]) {
  const defaults = () => ({ leftId: accounts[0]?.id ?? 0, rightId: accounts[1]?.id ?? accounts[0]?.id ?? 0 });
  const [saved, setSaved] = useState(() => restoreSurfaceValue(navigationStateFor(surface)?.viewport, defaults(), comparisonSchema));
  const ids = { leftId: accounts.some((account) => account.id === saved.leftId) ? saved.leftId : defaults().leftId, rightId: accounts.some((account) => account.id === saved.rightId) ? saved.rightId : defaults().rightId };
  function selectComparison(side: "left" | "right", id: number) {
    if (!accounts.some((account) => account.id === id)) return;
    const next = { ...ids, [side === "left" ? "leftId" : "rightId"]: id };
    persistContext("viewport", next);
    setSaved(next);
  }
  return { ...ids, selectComparison };
}

export const COMPARISON_LENSES: Array<{ dimension: JournalBreakdownDimension; label: string }> = [
  { dimension: "direction", label: "Direction" }, { dimension: "market", label: "Market" }, { dimension: "symbol", label: "Symbol" },
  { dimension: "hour", label: "Time" }, { dimension: "duration", label: "Hold" }, { dimension: "size", label: "Size" },
  { dimension: "tag", label: "Tag" }, { dimension: "rating", label: "Rating" }, { dimension: "strategy", label: "Strategy" },
];
export function strongestJournalSegment(trades: CanonicalTrade[], dimension: JournalBreakdownDimension, account: JournalAccount) {
  if (!scopedCurrency([account], [account.id], trades).combinable) return null;
  return buildJournalBreakdown(trades, dimension, [account]).filter((row) => row.closedTrades > 0).sort((a, b) => b.expectancy - a.expectancy || b.closedTrades - a.closedTrades)[0] ?? null;
}
function dashboardCalendarDays(endDate: string, entries: ReturnType<typeof journalCalendar>) {
  const byDate = new Map(entries.map((entry) => [entry.date, entry.summary]));
  const end = new Date(`${endDate}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6 - (end.getUTCDay() + 6) % 7);
  return Array.from({ length: 42 }, (_, index) => { const date = new Date(end); date.setUTCDate(end.getUTCDate() - 41 + index); const key = date.toISOString().slice(0, 10); return { date: key, summary: byDate.get(key) ?? null }; });
}
