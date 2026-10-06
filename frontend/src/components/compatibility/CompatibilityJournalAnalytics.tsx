import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { buildJournalBreakdown, DEFAULT_JOURNAL_FILTERS, filterJournalTrades, inferMarket, journalAssetMix, numeric, scopedCurrency, summarizeJournalTrades, tagOptions, weakSpots, type JournalFilters } from "../../lib/journalAnalytics";
import { getCanonicalTrade, latestJournalRecord, subscribeJournalUpdates, type CanonicalTrade } from "../../lib/journalApi";
import { journalDeepLink, parseJournalDeepLink, type JournalAccountScope } from "../../lib/journalWorkspaceState";
import { formatDateTime, formatMoney } from "../../lib/format";
import { JOURNAL_DIMENSIONS, useJournalAnalyticsContext } from "../journal/useJournalAnalyticsContext";
import { useJournalData } from "../journal/useJournalData";
import { useJournalPages } from "../journal/useJournalPages";
import { TradeReview } from "./CompatibilityJournal";

const field = "mt-1 min-h-11 w-full min-w-0 border border-stone-600 bg-stone-900 px-3 text-sm text-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400";
const button = "min-h-11 border border-stone-500 px-3 text-sm hover:bg-stone-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 disabled:opacity-50";

export function CompatibilityJournalAnalytics() {
  const location = useLocation();
  const navigate = useNavigate();
  const link = parseJournalDeepLink(location.hash);
  const journal = useJournalData({ migrateLegacy: false });
  const { filters, setFilters, dimension, setDimension, selectedKey, setSelectedKey, drilling, setDrilling } = useJournalAnalyticsContext(JOURNAL_DIMENSIONS.find((item) => item.id === link?.segment)?.id ?? "market");
  const linkedAccount = link?.accountId ?? null;
  const accountAvailable = linkedAccount == null || journal.accounts.some((account) => account.id === linkedAccount);
  const trades = linkedAccount == null ? journal.scopedTrades : journal.trades.filter((trade) => trade.account_id === linkedAccount);
  const filtered = useMemo(() => filterJournalTrades(trades, filters), [trades, filters]);
  const rows = useMemo(() => buildJournalBreakdown(filtered, dimension, journal.accounts), [filtered, dimension, journal.accounts]);
  const summary = useMemo(() => summarizeJournalTrades(filtered), [filtered]);
  const currency = useMemo(() => scopedCurrency(journal.accounts, [...new Set(filtered.map((trade) => trade.account_id))]), [journal.accounts, filtered]);
  const weak = useMemo(() => currency.combinable ? weakSpots(filtered, journal.accounts) : [], [currency.combinable, filtered, journal.accounts]);
  const selectedRow = rows.find((row) => row.key === selectedKey);
  const drillIds = useMemo(() => new Set(selectedRow?.tradeIds ?? []), [selectedRow]);
  const context = JSON.stringify({ filters, dimension, scope: journal.scope, linkedAccount });
  const segments = useJournalPages(rows, context);
  const underlying = useJournalPages(drilling ? filtered.filter((trade) => drillIds.has(trade.id)) : [], `${context}:${selectedKey ?? ""}`);
  const [linkedTrade, setLinkedTrade] = useState<CanonicalTrade | null>(null);
  const [tradeError, setTradeError] = useState(false);
  const [tradeRevision, setTradeRevision] = useState(0);
  const confirmedTrades = useRef(new Map<number, CanonicalTrade>());
  const tradeId = link?.tradeId ?? null;
  const listedTrade = journal.trades.find((trade) => trade.id === tradeId);
  const selectedTrade = linkedTrade?.id === tradeId ? latestJournalRecord(linkedTrade, listedTrade) : listedTrade ?? null;
  useEffect(() => subscribeJournalUpdates((update) => {
    if (update.kind !== "review") return;
    confirmedTrades.current.set(update.trade.id, update.trade);
    setLinkedTrade((current) => current?.id === update.trade.id ? update.trade : current);
  }), []);
  useEffect(() => {
    if (linkedAccount != null && journal.historyReady && accountAvailable) journal.setScope({ mode: "selected", accountIds: [linkedAccount] });
  }, [linkedAccount, journal.historyReady, accountAvailable]);
  useEffect(() => {
    let active = true;
    setLinkedTrade(null); setTradeError(false);
    if (tradeId != null) void getCanonicalTrade(tradeId).then((trade) => { if (active) setLinkedTrade(latestJournalRecord(trade, confirmedTrades.current.get(trade.id))); }).catch(() => { if (active) setTradeError(true); });
    return () => { active = false; };
  }, [tradeId, tradeRevision]);
  const money = (value: number) => currency.combinable ? formatMoney(value, currency.currency) : "Separate currencies";
  function selectTrade(nextTrade: number | null) {
    navigate({ pathname: location.pathname, search: location.search, hash: journalDeepLink({ surface: "analytics", tradeId: nextTrade, accountId: linkedAccount, date: link?.date ?? null, segment: dimension, returnTo: nextTrade ? "analytics" : null }) }, { replace: true });
  }
  function scope(next: JournalAccountScope) {
    journal.setScope(next);
    navigate({ pathname: location.pathname, search: location.search, hash: journalDeepLink({ surface: "analytics", tradeId: null, accountId: null, date: null, segment: dimension, returnTo: null }) }, { replace: true });
  }

  return <section className="min-w-0" data-compatibility-journal-analytics>
    <h1 className="text-2xl font-semibold">{location.pathname.replace(/\/$/, "").endsWith("/reports") ? "Journal reports" : "Analytics"}</h1>
    <p className="mt-2 max-w-prose text-sm leading-6 text-stone-300">Filter the complete Journal history, compare performance, and review the exact trades behind each result.</p>
    <button className={`${button} mt-4`} type="button" disabled={journal.loading} onClick={() => void journal.refresh()}>Refresh journal</button>
    {journal.error ? <p className="mt-3 text-rose-200" role="alert">{journal.error} {journal.historyReady ? "Previous complete results remain visible." : "Retry before viewing performance."}</p> : null}
    {!journal.historyReady ? <p className="mt-4 text-sm text-stone-300" role="status">{journal.loading ? "Loading complete Journal history…" : "Complete Journal history is unavailable."}</p> : !accountAvailable ? <p className="mt-4 text-rose-200" role="alert">This account is unavailable. Choose one of your accounts to view its performance.</p> : null}
    {journal.historyReady ? <>
      <label className="mt-5 block max-w-sm text-sm text-stone-300">Account scope<select className={field} value={linkedAccount != null || journal.scope.mode === "selected" ? "SELECTED" : "ALL"} onChange={(event) => scope(event.target.value === "ALL" || !journal.accounts.length ? { mode: "all", accountIds: [] } : { mode: "selected", accountIds: journal.scope.accountIds.length ? journal.scope.accountIds : [journal.accounts[0].id] })}><option value="ALL">All accounts</option><option value="SELECTED">Selected accounts</option></select></label>
      {linkedAccount != null || journal.scope.mode === "selected" ? <fieldset className="mt-3"><legend className="text-sm text-stone-300">Include accounts</legend><div className="mt-1 flex max-h-40 flex-wrap gap-3 overflow-auto">{journal.accounts.map((account) => {
        const ids = linkedAccount != null ? [linkedAccount] : journal.scope.accountIds;
        const checked = ids.includes(account.id);
        return <label key={account.id} className="flex min-h-11 items-center gap-2 text-sm"><input className="h-11 w-11 shrink-0 accent-amber-300" type="checkbox" checked={checked} onChange={() => { const next = checked ? ids.filter((id) => id !== account.id) : [...ids, account.id]; scope(next.length ? { mode: "selected", accountIds: next } : { mode: "all", accountIds: [] }); }} />{account.name} · {account.currency}</label>;
      })}</div></fieldset> : null}
      {accountAvailable ? <>
        <p className="mt-4 text-sm text-stone-300" role="status">{filtered.length.toLocaleString()} matching trades · {summary.reviewedPercent.toFixed(0)}% reviewed</p>
        <details className="mt-4 border-y border-stone-700" open><summary className="min-h-11 cursor-pointer py-3 focus-visible:outline focus-visible:outline-amber-400">Analytics filters</summary>
          <div className="grid min-w-0 gap-3 pb-4 sm:grid-cols-2 lg:grid-cols-4">
            <Select label="Account" value={filters.accountIds.length === 1 ? String(filters.accountIds[0]) : "ALL"} onChange={(value) => setFilters({ ...filters, accountIds: value === "ALL" ? [] : [Number(value)] })}><option value="ALL">Scope accounts</option>{journal.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</Select>
            <Select label="Market" value={filters.market} onChange={(market) => setFilters({ ...filters, market })}><option value="ALL">All markets</option>{[...new Set(trades.map((trade) => inferMarket(trade.symbol)))].sort().map((market) => <option key={market}>{market}</option>)}</Select>
            <Select label="Symbol" value={filters.symbol} onChange={(symbol) => setFilters({ ...filters, symbol })}><option value="ALL">All symbols</option>{[...new Set(trades.map((trade) => trade.symbol))].sort().map((symbol) => <option key={symbol}>{symbol}</option>)}</Select>
            <Select label="Strategy" value={filters.strategy} onChange={(strategy) => setFilters({ ...filters, strategy })}><option value="ALL">All strategies</option>{[...new Set(trades.map((trade) => trade.strategy_name ?? "Unassigned"))].sort().map((strategy) => <option key={strategy}>{strategy}</option>)}</Select>
            <Select label="Direction" value={filters.direction} onChange={(direction) => setFilters({ ...filters, direction: direction as JournalFilters["direction"] })}><option value="ALL">All directions</option><option value="LONG">Long</option><option value="SHORT">Short</option></Select>
            <Select label="Rating" value={filters.rating} onChange={(rating) => setFilters({ ...filters, rating: rating as JournalFilters["rating"] })}><option value="ALL">All ratings</option><option value="UNRATED">Unrated</option>{[1,2,3,4,5].map((rating) => <option key={rating} value={rating}>{rating} star{rating === 1 ? "" : "s"}</option>)}</Select>
            <label className="text-sm text-stone-300">From<input className={field} type="date" value={filters.dateFrom} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })} /></label>
            <label className="text-sm text-stone-300">To<input className={field} type="date" value={filters.dateTo} min={filters.dateFrom || undefined} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })} /></label>
            <fieldset className="sm:col-span-2 lg:col-span-3"><legend className="text-sm text-stone-300">Tags · all selected must match</legend><div className="mt-1 flex max-h-40 flex-wrap gap-3 overflow-auto">{tagOptions(journal.tags).map((tag) => <label key={tag.id} className="flex min-h-11 items-center gap-2 text-sm"><input className="h-11 w-11 shrink-0 accent-amber-300" type="checkbox" checked={filters.tagIds.includes(tag.id)} onChange={() => setFilters({ ...filters, tagIds: filters.tagIds.includes(tag.id) ? filters.tagIds.filter((id) => id !== tag.id) : [...filters.tagIds, tag.id] })} />{tag.name}</label>)}{!journal.tags.length ? <p className="text-sm text-stone-300">No reusable tags yet.</p> : null}</div></fieldset>
            <button className={`${button} self-end`} type="button" onClick={() => setFilters(DEFAULT_JOURNAL_FILTERS)}>Clear filters</button>
          </div>
        </details>
        {filtered.length > 0 && filtered.length < 5 ? <p className="mt-4 text-sm text-amber-200" role="status">Limited sample · {filtered.length} matching trades. Inspect the underlying rows before acting on a pattern.</p> : null}
        {!currency.combinable ? <p className="mt-4 text-sm text-amber-200" role="status">This filter contains {currency.currencies?.join(", ")}. P&amp;L totals are withheld because currencies cannot be combined; filter to one account.</p> : null}
        <dl className="mt-5 grid gap-4 border-y border-stone-700 py-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filtered performance">
          {[['Closed trades', String(summary.closedTrades)], ['Net P&L', money(summary.netPnl)], ['Costs', money(summary.costs)], ['Win rate', `${summary.winRate.toFixed(1)}%`]].map(([label, value]) => <div key={label}><dt className="text-sm text-stone-300">{label}</dt><dd className="mt-1 font-semibold tabular-nums">{value}</dd></div>)}
        </dl>
        <section className="mt-6" aria-labelledby="compatibility-mix-heading"><h2 id="compatibility-mix-heading" className="text-lg font-semibold">Position mix</h2><div className="mt-3 grid gap-6 sm:grid-cols-2"><Mix title="By market" rows={journalAssetMix(filtered, "market")} onSelect={(market) => setFilters({ ...filters, market })} /><Mix title="By symbol" rows={journalAssetMix(filtered, "symbol")} onSelect={(symbol) => setFilters({ ...filters, symbol })} /></div></section>
        <section className="mt-6" aria-labelledby="compatibility-breakdown-heading">
          <h2 id="compatibility-breakdown-heading" className="text-lg font-semibold">Performance breakdown</h2>
          <div role="tablist" aria-label="Breakdown dimension" className="mt-3 flex flex-wrap gap-2">{JOURNAL_DIMENSIONS.map((item) => <button className={`${button} ${dimension === item.id ? "border-amber-400 bg-stone-800 text-amber-200" : ""}`} key={item.id} type="button" role="tab" aria-selected={dimension === item.id} onClick={() => setDimension(item.id)}>{item.label}</button>)}</div>
          <div role="region" aria-label="Performance breakdown table" tabIndex={0} className="mt-4 overflow-x-auto focus-visible:outline focus-visible:outline-amber-400">
            <table aria-label={`${JOURNAL_DIMENSIONS.find((item) => item.id === dimension)?.label} performance breakdown`} className="w-full min-w-[58rem] text-left text-sm">
              <thead><tr>{["Segment", "Trades", "Win rate", "Gross", "Costs", "Net", "Expectancy", "PF", "Open"].map((label) => <th className="border-y border-stone-600 px-2 py-3" key={label} scope="col">{label}</th>)}</tr></thead>
              <tbody>{segments.rows.map((row) => <tr className="border-b border-stone-700" key={row.key} data-selected={selectedKey === row.key || undefined}><th className="px-2 py-3" scope="row">{row.label}</th><td className="px-2 tabular-nums">{row.totalTrades}</td><td className="px-2 tabular-nums">{row.winRate.toFixed(1)}%</td>{[row.grossPnl, -row.costs, row.netPnl, row.expectancy].map((value, index) => <td className="px-2 tabular-nums" key={index}>{money(value)}</td>)}<td className="px-2 tabular-nums">{!currency.combinable ? "Separate currencies" : row.profitFactor == null ? "No losses" : row.profitFactor.toFixed(2)}</td><td className="px-2"><button className={`${button} my-1`} aria-label={`Select ${row.label} segment`} aria-pressed={selectedKey === row.key} type="button" onClick={() => { setSelectedKey(row.key); setDrilling(false); }}>{selectedKey === row.key ? "Selected" : "Select"}</button></td></tr>)}</tbody>
            </table>
          </div>
          {!rows.length ? <p className="mt-4 text-sm text-stone-300">No data for this breakdown. Adjust filters or add trades.</p> : null}
          <Pages label="Performance segment pages" noun="segments" paging={segments} />
          {selectedRow ? <div className="mt-4 flex flex-wrap items-center gap-3" data-selected-segment><p role="status">Selected segment: {selectedRow.label} · {selectedRow.totalTrades} trades</p><button className={button} type="button" onClick={() => setDrilling(true)}>View underlying trades</button></div> : null}
        </section>
        <section className="mt-6 border-t border-stone-700 pt-5" aria-labelledby="compatibility-weak-heading"><h2 id="compatibility-weak-heading" className="text-lg font-semibold">Weak spots and strengths</h2><p className="mt-2 text-sm text-stone-300">Ranked by expectancy within each dimension. Small samples are shown, not overstated.</p><div className="mt-3 grid gap-3 sm:grid-cols-2">{weak.map(({ dimension: weakDimension, best, worst }) => <button className={`${button} py-3 text-left`} key={weakDimension} type="button" onClick={() => { setDimension(weakDimension); setSelectedKey(worst.key); setDrilling(true); }}><span className="block font-semibold">{JOURNAL_DIMENSIONS.find((item) => item.id === weakDimension)?.label}</span><span className="mt-1 block">Best · {best.label} · {money(best.expectancy)} avg</span><span className="mt-1 block">Review · {worst.label} · {money(worst.expectancy)} avg</span><span className="mt-1 block text-stone-300">{worst.totalTrades} trade sample · open exact rows</span></button>)}</div>{!weak.length ? <p className="mt-3 text-sm text-stone-300">{currency.combinable ? "Rankings appear after closed trades are available." : "Choose one currency before ranking expectancy."}</p> : null}</section>
        {drilling ? <section className="mt-6 border-t border-stone-700 pt-5" aria-labelledby="compatibility-underlying-heading"><button className={button} type="button" onClick={() => setDrilling(false)}>Back to breakdown</button><h2 id="compatibility-underlying-heading" className="mt-4 text-lg font-semibold">Underlying trades</h2><p className="mt-2 text-sm text-stone-300">Selected segment: {selectedRow?.label ?? "No current segment"}. Exact rows retain their original currency.</p><div className="mt-3 divide-y divide-stone-700 border-y border-stone-700">{underlying.rows.map((trade) => <button className="flex min-h-11 w-full flex-wrap items-center justify-between gap-3 px-2 py-3 text-left hover:bg-stone-800 focus-visible:outline focus-visible:outline-amber-400" data-trade-id={trade.id} key={trade.id} type="button" aria-label={`Review ${trade.symbol} trade ${trade.id}`} onClick={() => selectTrade(trade.id)}><span className="min-w-0 break-words"><strong>{trade.symbol}</strong><span className="mt-1 block text-sm text-stone-300">{formatDateTime(trade.entry_time)} · {trade.strategy_name ?? "Unassigned"} · {trade.tags.map((tag) => tag.name).join(", ") || "untagged"}</span></span><span className="tabular-nums">{formatMoney(numeric(trade.net_pnl), trade.currency)}</span></button>)}</div>{!underlying.total ? <p className="mt-3 text-sm text-stone-300">No underlying rows remain in the current filter.</p> : null}<Pages label="Underlying trade pages" noun="trades" paging={underlying} /></section> : null}
      </> : null}
    </> : null}
    {tradeId != null && !selectedTrade && !tradeError ? <p className="mt-5" role="status">Loading selected trade…</p> : null}
    {tradeError && !selectedTrade ? <div className="mt-5"><p className="text-rose-200" role="alert">This trade could not be opened.</p><button className={`${button} mt-2`} type="button" onClick={() => setTradeRevision((value) => value + 1)}>Retry trade</button><button className={`${button} ml-2`} type="button" onClick={() => selectTrade(null)}>Close review</button></div> : null}
    {journal.historyReady && selectedTrade ? <TradeReview key={selectedTrade.id} trade={selectedTrade} onClose={() => selectTrade(null)} onSaved={setLinkedTrade} /> : null}
  </section>;
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) { return <label className="block min-w-0 text-sm text-stone-300">{label}<select className={field} value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></label>; }
function Mix({ title, rows, onSelect }: { title: string; rows: ReturnType<typeof journalAssetMix>; onSelect: (value: string) => void }) {
  const paging = useJournalPages(rows, rows.map((row) => row.label).join("\n"));
  return <div><h3 className="font-semibold">{title}</h3><ul className="mt-2 divide-y divide-stone-700 border-y border-stone-700">{paging.rows.map((row) => <li key={row.label}><button className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 px-2 py-2 text-left hover:bg-stone-800 focus-visible:outline focus-visible:outline-amber-400" type="button" onClick={() => onSelect(row.label)}><span className="min-w-0 break-words">{row.label}</span><span className="tabular-nums text-stone-300">{row.count} · {row.percent.toFixed(0)}%</span></button></li>)}</ul>{!rows.length ? <p className="mt-2 text-sm text-stone-300">Position mix appears after trades are added.</p> : null}<Pages label={`${title} pages`} noun="segments" paging={paging} /></div>;
}
function Pages({ label, noun, paging }: { label: string; noun: string; paging: { page: number; pageCount: number; total: number; setPage: (page: number) => void } }) {
  if (paging.pageCount <= 1) return null;
  return <nav className="mt-4 flex flex-wrap items-center justify-center gap-3 text-sm" aria-label={label}><button className={button} type="button" disabled={paging.page === 0} onClick={() => paging.setPage(paging.page - 1)}>Previous 100 {noun}</button><span>Page {paging.page + 1} of {paging.pageCount} · {paging.total.toLocaleString()} {noun}</span><button className={button} type="button" disabled={paging.page === paging.pageCount - 1} onClick={() => paging.setPage(paging.page + 1)}>Next 100 {noun}</button></nav>;
}
