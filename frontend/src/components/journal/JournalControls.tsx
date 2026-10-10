import { Check, ChevronDown, Filter, RefreshCw, X } from "lucide-react";
import type { ReactNode } from "react";
import type { JournalAccount, JournalTag } from "../../lib/journalApi";
import { inferMarket, tagOptions, type JournalFilters } from "../../lib/journalAnalytics";
import type { JournalAccountScope } from "../../lib/journalWorkspaceState";
import { ThemedOptionSelect, ThemedSelect } from "../ThemedSelect";
import { CriticalStateSurface } from "../ui/CriticalStateSurface";

export const journalFieldClass = "min-h-[var(--control-height)] w-full min-w-0 rounded-[var(--radius-sm)] border border-[var(--ui-border-strong)] bg-[var(--ui-inset)] px-3 text-start text-sm text-[var(--text-primary)] outline-none focus:border-[var(--interaction)] focus:ring-2 focus:ring-[var(--ui-selection)] disabled:cursor-not-allowed disabled:opacity-50";

export function JournalScopeControl({ accounts, scope, onChange }: { accounts: JournalAccount[]; scope: JournalAccountScope; onChange: (scope: JournalAccountScope) => void }) {
  const selectionValue = scope.mode === "all" ? "all" : scope.accountIds.length === 1 ? String(scope.accountIds[0]) : "selected";
  return <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
    <label className="min-w-0 flex-1 text-xs font-medium text-[var(--text-secondary)]">Account scope
      <ThemedSelect ariaLabel="Account scope" portal className="mt-1 h-10 w-full [@media(pointer:coarse)]:h-11" value={selectionValue} onChange={(value) => {
        if (value === "all") onChange({ mode: "all", accountIds: [] });
        else if (value === "selected") onChange({ mode: "selected", accountIds: scope.accountIds.length ? scope.accountIds : accounts.slice(0, 2).map((account) => account.id) });
        else onChange({ mode: "selected", accountIds: [Number(value)] });
      }} options={[
        { value: "all", label: "All accounts" },
        ...accounts.map((account) => ({ value: String(account.id), label: `${account.name} · ${account.currency}` })),
        ...(accounts.length > 1 ? [{ value: "selected", label: "Selected accounts…" }] : []),
      ]} />
    </label>
    {selectionValue === "selected" ? <fieldset className="min-w-0 flex-[1.2] rounded-md border border-[var(--ui-border-subtle)] p-2"><legend className="px-1 text-[11px] text-[var(--text-secondary)]">Include accounts</legend><div className="flex max-h-24 flex-wrap gap-1.5 overflow-auto">{accounts.map((account) => { const checked = scope.accountIds.includes(account.id); return <label key={account.id} className={`relative inline-flex min-h-[var(--control-height)] min-w-11 cursor-pointer items-center gap-1.5 rounded px-2 text-xs outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--ui-focus)] ${checked ? "bg-[var(--ui-selection)] text-[var(--text-accent)]" : "bg-[var(--ui-inset)] text-[var(--text-secondary)]"}`}><input type="checkbox" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" checked={checked} onChange={() => { const accountIds = checked ? scope.accountIds.filter((id) => id !== account.id) : [...scope.accountIds, account.id]; onChange(accountIds.length ? { mode: "selected", accountIds } : { mode: "all", accountIds: [] }); }} />{checked ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : null}<span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: account.color ?? "#71717a" }} />{account.name}</label>; })}</div></fieldset> : null}
  </div>;
}

export function JournalFilterBar({ accounts, filters, tags, trades, onChange }: { accounts: JournalAccount[]; filters: JournalFilters; tags: JournalTag[]; trades: Array<{ symbol: string; strategy_name: string | null }>; onChange: (filters: JournalFilters) => void }) {
  const symbols = [...new Set(trades.map((trade) => trade.symbol))].sort();
  const strategies = [...new Set(trades.map((trade) => trade.strategy_name ?? "Unassigned"))].sort();
  const markets = [...new Set(trades.map((trade) => inferMarket(trade.symbol)))].sort();
  const activeCount = Number(Boolean(filters.dateFrom)) + Number(Boolean(filters.dateTo)) + filters.accountIds.length + Number(filters.symbol !== "ALL") + Number(filters.market !== "ALL") + Number(filters.strategy !== "ALL") + Number(filters.direction !== "ALL") + Number(filters.rating !== "ALL") + filters.tagIds.length;
  return <details className="group border-y border-white/10 bg-white/[0.015]">
    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm text-slate-300 outline-none hover:bg-white/[0.025] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300"><Filter aria-hidden="true" className="h-4 w-4" /><span className="font-medium">Analytics filters</span><span className="text-xs text-slate-600">{activeCount ? `${activeCount} active` : "All available data"}</span><ChevronDown aria-hidden="true" className="ml-auto h-4 w-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" /></summary>
    <div className="grid gap-3 border-t border-white/10 p-3 sm:grid-cols-2 xl:grid-cols-4">
      <FilterSelect label="Account" value={filters.accountIds.length === 1 ? String(filters.accountIds[0]) : "ALL"} onChange={(value) => onChange({ ...filters, accountIds: value === "ALL" ? [] : [Number(value)] })}><option value="ALL">Scope accounts</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</FilterSelect>
      <FilterSelect label="Market" value={filters.market} onChange={(value) => onChange({ ...filters, market: value })}><option value="ALL">All markets</option>{markets.map((market) => <option key={market}>{market}</option>)}</FilterSelect>
      <FilterSelect label="Symbol" value={filters.symbol} onChange={(value) => onChange({ ...filters, symbol: value })}><option value="ALL">All symbols</option>{symbols.map((symbol) => <option key={symbol}>{symbol}</option>)}</FilterSelect>
      <FilterSelect label="Strategy" value={filters.strategy} onChange={(value) => onChange({ ...filters, strategy: value })}><option value="ALL">All strategies</option>{strategies.map((strategy) => <option key={strategy}>{strategy}</option>)}</FilterSelect>
      <FilterSelect label="Direction" value={filters.direction} onChange={(value) => onChange({ ...filters, direction: value as JournalFilters["direction"] })}><option value="ALL">All directions</option><option value="LONG">Long</option><option value="SHORT">Short</option></FilterSelect>
      <FilterSelect label="Rating" value={filters.rating} onChange={(value) => onChange({ ...filters, rating: value as JournalFilters["rating"] })}><option value="ALL">All ratings</option><option value="UNRATED">Unrated</option>{[1,2,3,4,5].map((rating) => <option key={rating} value={rating}>{rating} star{rating === 1 ? "" : "s"}</option>)}</FilterSelect>
      <label className="text-xs text-slate-500">From<input type="date" value={filters.dateFrom} onChange={(event) => onChange({ ...filters, dateFrom: event.target.value })} className={`${journalFieldClass} mt-1`} /></label>
      <label className="text-xs text-slate-500">To<input type="date" value={filters.dateTo} min={filters.dateFrom || undefined} onChange={(event) => onChange({ ...filters, dateTo: event.target.value })} className={`${journalFieldClass} mt-1`} /></label>
      <fieldset className="sm:col-span-2 xl:col-span-3"><legend className="text-xs text-slate-500">Tags · all selected must match</legend><div className="mt-1 flex max-h-24 flex-wrap gap-1.5 overflow-auto rounded-md border border-white/10 p-2">{tagOptions(tags).map((tag) => { const checked = filters.tagIds.includes(tag.id); return <label key={tag.id} className={`relative inline-flex min-h-[var(--control-height)] min-w-11 cursor-pointer items-center gap-1.5 rounded px-2 text-xs outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-cyan-300 ${checked ? "bg-cyan-300/10 text-cyan-100" : "bg-white/[0.03] text-slate-400 hover:bg-white/[0.06]"}`}><input type="checkbox" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" checked={checked} onChange={() => onChange({ ...filters, tagIds: checked ? filters.tagIds.filter((id) => id !== tag.id) : [...filters.tagIds, tag.id] })} /><span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color ?? "#71717a" }} />{tag.name}</label>; })}{!tags.length ? <span className="text-xs text-slate-600">No reusable tags yet.</span> : null}</div></fieldset>
      <button type="button" disabled={!activeCount} onClick={() => onChange({ accountIds: [], dateFrom: "", dateTo: "", direction: "ALL", market: "ALL", rating: "ALL", strategy: "ALL", symbol: "ALL", tagIds: [] })} className="mt-auto inline-flex min-h-[var(--control-height)] min-w-0 items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-sm text-slate-300 outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:opacity-40"><X aria-hidden="true" className="h-4 w-4 shrink-0" /><span className="ui-resilient-text" dir="auto">Clear filters</span></button>
    </div>
  </details>;
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return <label className="text-xs text-slate-500">{label}<ThemedOptionSelect portal ariaLabel={label} className="mt-1 h-[var(--control-height)] w-full min-w-0" value={value} onChange={(selectedValue) => onChange(selectedValue)}>{children}</ThemedOptionSelect></label>;
}

export function JournalError({ message, onRetry, onDismiss }: { message: string; onRetry?: () => void; onDismiss?: () => void }) {
  return <CriticalStateSurface state="error" title="Journal could not update" detail={message} action={<div className="flex gap-2">{onRetry ? <button type="button" onClick={onRetry} className="ui-critical-state__action"><RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />Retry</button> : null}{onDismiss ? <button type="button" onClick={onDismiss} className="ui-critical-state__action">Dismiss</button> : null}</div>} />;
}

export function JournalSkeleton({ rows = 6 }: { rows?: number }) {
  return <div className="space-y-4 p-4 sm:p-5" aria-label="Loading Journal" aria-live="polite" role="status"><div className="flex items-center gap-3 border-b border-white/10 pb-4"><RefreshCw aria-hidden="true" className="h-5 w-5 animate-spin text-cyan-300 motion-reduce:animate-none" /><div><p className="font-semibold text-white">Loading Journal</p><p className="mt-0.5 text-sm text-slate-300">Preparing accounts, trades, and review context…</p></div></div><div className="animate-pulse space-y-3 motion-reduce:animate-none" aria-hidden="true">{Array.from({ length: rows }, (_, index) => <div key={index} className="grid grid-cols-[4rem_1fr_7rem] gap-3 border-b border-white/5 py-3"><span className="h-4 rounded bg-white/10" /><span className="h-4 rounded bg-white/10" /><span className="h-4 rounded bg-white/10" /></div>)}</div></div>;
}

export function JournalEmpty({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <CriticalStateSurface state="empty" title={title} detail={detail} action={action} />;
}

export function JournalButton({ children, onClick, disabled, tone = "secondary", type = "button" }: { children: ReactNode; onClick?: () => void; disabled?: boolean; tone?: "primary" | "secondary" | "danger"; type?: "button" | "submit" }) {
  const toneClass = tone === "primary" ? "bg-[var(--interaction)] text-[var(--on-interaction)] hover:bg-[var(--interaction-hover)] active:bg-[var(--interaction-pressed)]" : tone === "danger" ? "border border-[var(--loss-text)] text-[var(--loss-text)] hover:bg-[var(--loss-soft)]" : "border border-[var(--ui-border-strong)] bg-[var(--ui-raised)] text-[var(--text-primary)] hover:bg-[var(--ui-hover)]";
  return <button type={type} onClick={onClick} disabled={disabled} data-motion="microfeedback" className={`inline-flex min-h-[var(--control-height)] min-w-0 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)] disabled:cursor-not-allowed disabled:opacity-45 ${toneClass}`}>{children}</button>;
}
