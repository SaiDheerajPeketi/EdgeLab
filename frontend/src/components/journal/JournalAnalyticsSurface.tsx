import { useMemo } from "react";
import { ArrowRight, ChevronLeft, Lightbulb, Target } from "lucide-react";
import { buildJournalBreakdown, filterJournalTrades, journalAssetMix, numeric, scopedCurrency, summarizeJournalTrades, weakSpots, type JournalBreakdownDimension } from "../../lib/journalAnalytics";
import type { CanonicalTrade, JournalAccount, JournalTag } from "../../lib/journalApi";
import { JournalButton, JournalEmpty, JournalFilterBar } from "./JournalControls";
import { useJournalPages } from "./useJournalPages";
import { JOURNAL_DIMENSIONS as DIMENSIONS, useJournalAnalyticsContext } from "./useJournalAnalyticsContext";

type Props = {
  accounts: JournalAccount[];
  tags: JournalTag[];
  trades: CanonicalTrade[];
  initialDimension?: JournalBreakdownDimension;
  onOpenTrade: (trade: CanonicalTrade) => void;
};

export function JournalAnalyticsSurface({ accounts, tags, trades, initialDimension = "market", onOpenTrade }: Props) {
  const { filters, setFilters, dimension, setDimension, selectedKey, setSelectedKey, drilling, setDrilling } = useJournalAnalyticsContext(initialDimension);
  const filtered = useMemo(() => filterJournalTrades(trades, filters), [filters, trades]);
  const rows = useMemo(() => buildJournalBreakdown(filtered, dimension, accounts), [accounts, dimension, filtered]);
  const summary = useMemo(() => summarizeJournalTrades(filtered), [filtered]);
  const currency = useMemo(() => scopedCurrency(accounts, [...new Set(filtered.map((trade) => trade.account_id))], filtered), [accounts, filtered]);
  const weak = useMemo(() => currency.combinable ? weakSpots(filtered, accounts) : [], [accounts, filtered, currency.combinable]);
  const selectedRow = selectedKey ? (rows.find((row) => row.key === selectedKey) ?? null) : null;
  const drillIds = drilling ? selectedRow?.tradeIds ?? [] : null;
  const drillIdSet = useMemo(() => new Set(drillIds ?? []), [drillIds]);
  const drillTrades = drillIds ? filtered.filter((trade) => drillIdSet.has(trade.id)) : [];
  const context = JSON.stringify({ filters, dimension });
  const segments = useJournalPages(rows, context);
  const underlying = useJournalPages(drillTrades, `${context}:${selectedKey ?? ""}:${drillIds?.join(",") ?? ""}`);

  return (
    <div className="min-w-0 w-[calc(100vw-3rem)] max-w-full space-y-6 overflow-x-hidden sm:w-[calc(100vw-4.5rem)] lg:w-full">
      <section aria-labelledby="analytics-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 id="analytics-heading" className="text-xl font-semibold text-white">
              Analytics
            </h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">One filter context powers every breakdown. Select any result to inspect the exact underlying trades.</p>
          </div>
          <p className="text-xs text-slate-500">
            {filtered.length.toLocaleString()} matching trades · {summary.reviewedPercent.toFixed(0)}% reviewed
          </p>
        </div>
      </section>
      <JournalFilterBar
        accounts={accounts}
        filters={filters}
        tags={tags}
        trades={trades}
        onChange={(next) => {
          setFilters(next);
          setSelectedKey(null);
          setDrilling(false);
        }}
      />
      {filtered.length > 0 && filtered.length < 5 ? (
        <p className="rounded-md border border-sky-300/20 bg-sky-300/[0.04] px-3 py-2 text-xs leading-5 text-sky-100" data-analytics-sample role="status">
          <span className="font-semibold">
            Limited sample · {filtered.length} matching {filtered.length === 1 ? "trade" : "trades"}.
          </span>{" "}
          Small samples can swing sharply; inspect the underlying rows before acting on a pattern.
        </p>
      ) : null}
      {!currency.combinable ? (
        <p className="rounded-md border border-amber-300/20 bg-amber-300/[0.05] px-3 py-2 text-xs leading-5 text-amber-100" data-analytics-mixed-currency role="status">
          This filter contains {currency.currencies?.join(", ")}. P&amp;L totals are withheld because currencies cannot be combined; filter to one account before comparing monetary totals.
        </p>
      ) : null}

      <section aria-labelledby="asset-mix-heading" className="border-t border-white/10 pt-5">
        <div className="flex items-center gap-2">
          <Target aria-hidden="true" className="h-4 w-4 text-cyan-300" />
          <h2 id="asset-mix-heading" className="text-base font-semibold text-white">
            Position mix
          </h2>
        </div>
        <div className="mt-4 grid gap-8 xl:grid-cols-2">
          <AssetMix title="By market" rows={journalAssetMix(filtered, "market")} onSelect={(market) => setFilters((current) => ({ ...current, market }))} />
          <AssetMix title="By symbol" rows={journalAssetMix(filtered, "symbol")} onSelect={(symbol) => setFilters((current) => ({ ...current, symbol }))} />
        </div>
      </section>

      <section aria-labelledby="breakdown-heading" className="min-w-0 max-w-full overflow-hidden border-t border-white/10 pt-5 [contain:layout_paint_inline-size]">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="breakdown-heading" className="mr-2 text-base font-semibold text-white">
            Performance breakdown
          </h2>
          <div role="tablist" aria-label="Breakdown dimension" className="flex flex-wrap gap-1">
            {DIMENSIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={dimension === item.id}
                onClick={() => {
                  setDimension(item.id);
                  setSelectedKey(null);
                  setDrilling(false);
                }}
                className={breakdownTabClass(dimension === item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div role="region" aria-label="Performance breakdown table" tabIndex={0} className="mt-4 min-w-0 w-full max-w-[calc(100vw-3rem)] overflow-x-auto border-y border-white/10 focus-visible:outline focus-visible:outline-cyan-300 sm:max-w-[calc(100vw-4.5rem)] lg:max-w-full">
          <table aria-label={`${DIMENSIONS.find((item) => item.id === dimension)?.label ?? dimension} performance breakdown`} className="w-full min-w-[58rem] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-wide text-slate-600">
                <th className="px-3 py-2 font-medium">Segment</th>
                <th className="px-3 py-2 text-right font-medium">Trades</th>
                <th className="px-3 py-2 text-right font-medium">Win rate</th>
                <th className="px-3 py-2 text-right font-medium">Gross</th>
                <th className="px-3 py-2 text-right font-medium">Costs</th>
                <th className="px-3 py-2 text-right font-medium">Net</th>
                <th className="px-3 py-2 text-right font-medium">Expectancy</th>
                <th className="px-3 py-2 text-right font-medium">PF</th>
                <th className="px-3 py-2">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/8">
              {segments.rows.map((row) => {
                const selected = selectedKey === row.key;
                return (
                  <tr key={row.key} data-selected={selected || undefined} className={selected ? "bg-white/[0.045] ring-1 ring-inset ring-cyan-300/20" : "hover:bg-white/[0.035]"}>
                    <th scope="row" className="px-3 py-3 font-medium text-white">
                      {row.label}
                    </th>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-300">{row.totalTrades}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-300">{row.winRate.toFixed(1)}%</td>
                    <MoneyCell value={row.grossPnl} currency={currency.currency} combinable={currency.combinable} />
                    <MoneyCell value={-row.costs} currency={currency.currency} combinable={currency.combinable} muted />
                    <MoneyCell value={row.netPnl} currency={currency.currency} combinable={currency.combinable} />
                    <MoneyCell value={row.expectancy} currency={currency.currency} combinable={currency.combinable} />
                    <td className="px-3 py-3 text-right tabular-nums text-slate-300">{!currency.combinable ? <><span aria-hidden="true">—</span><span className="sr-only">Not combined across currencies</span></> : row.profitFactor == null ? "∞" : row.profitFactor.toFixed(2)}</td>
                    <td className="px-3 py-3 text-right">
                      <button type="button" onClick={() => { setSelectedKey(row.key); setDrilling(false); }} aria-label={`Select ${row.label} segment`} aria-pressed={selected} className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-cyan-300 hover:underline sm:min-h-8">
                        {selected ? "Selected" : "Select"} <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length ? <JournalEmpty title="No data for this breakdown" detail="Adjust filters or add trades with the fields required by this dimension." /> : null}
        </div>
        <AnalyticsPages label="Performance segment pages" noun="segments" paging={segments} />
        {selectedRow ? (
          <div data-selected-segment role="status" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-cyan-300/25 bg-cyan-300/[0.06] px-3 py-3 text-sm text-cyan-50">
            <p className="min-w-0"><span className="text-xs font-medium uppercase tracking-wide text-cyan-200">Selected segment</span><span className="ml-2 font-semibold">{selectedRow.label}</span><span className="ml-2 text-xs text-slate-300">{selectedRow.totalTrades} {selectedRow.totalTrades === 1 ? "trade" : "trades"}</span></p>
            <JournalButton onClick={() => setDrilling(true)}>View underlying trades</JournalButton>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="weak-spots-heading" className="border-t border-white/10 pt-5">
        <div className="flex items-center gap-2">
          <Lightbulb aria-hidden="true" className="h-4 w-4 text-cyan-300" />
          <h2 id="weak-spots-heading" className="text-base font-semibold text-white">
            Weak spots and strengths
          </h2>
        </div>
        <p className="mt-1 text-xs text-slate-500">Ranked by expectancy within each dimension. Small samples are shown, not overstated.</p>
        {weak.length ? (
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {weak.map(({ dimension: weakDimension, best, worst }) => (
              <button
                type="button"
                key={weakDimension}
                onClick={() => {
                  setDimension(weakDimension);
                  setSelectedKey(worst.key);
                  setDrilling(true);
                }}
                className="min-h-11 rounded-lg border border-white/10 bg-[#0d1117] p-3 text-left outline-none hover:bg-white/[0.045] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300"
              >
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">{DIMENSIONS.find((item) => item.id === weakDimension)?.label ?? weakDimension}</span>
                <span className="mt-2 block text-xs text-emerald-300">
                  Best · {best.label} · {best.expectancy.toFixed(2)} avg
                </span>
                <span className="mt-1 block text-xs text-rose-300">
                  Review · {worst.label} · {worst.expectancy.toFixed(2)} avg
                </span>
                <span className="mt-2 block text-[10px] text-slate-600">{worst.totalTrades} trade sample · open exact rows</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">{currency.combinable ? "Strength and review rankings appear after closed trades are available." : "Choose one currency before ranking expectancy."}</p>
        )}
      </section>

      {drillIds ? (
        <section aria-labelledby="drilldown-heading" className="rounded-xl border border-cyan-300/20 bg-[#0a0f15] p-4 sm:p-5 [&_button]:min-h-11 sm:[&_button]:min-h-[var(--control-height)]">
          <div className="flex flex-wrap items-start gap-3">
            <JournalButton onClick={() => setDrilling(false)}>
              <ChevronLeft aria-hidden="true" className="h-4 w-4" />
              Back to breakdown
            </JournalButton>
            <div className="min-w-0 flex-1">
              <h2 id="drilldown-heading" className="text-base font-semibold text-white">
                Underlying trades
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Selected segment: <span className="font-medium text-slate-300">{selectedRow?.label ?? "Current breakdown"}</span>. Exact rows are shown below; filters remain active.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {underlying.rows.map((trade) => (
              <button data-trade-id={trade.id} key={trade.id} type="button" onClick={() => onOpenTrade(trade)} className="grid min-w-0 w-full gap-2 rounded-lg border border-white/10 bg-white/[0.018] p-3 text-left outline-none hover:bg-white/[0.045] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300 sm:grid-cols-[6rem_minmax(0,1fr)_auto]">
                <span className="text-xs text-slate-500">{new Date(trade.entry_time).toLocaleDateString()}</span>
                <span className="min-w-0">
                  <span className="block font-semibold text-white">{trade.symbol}</span>
                  <span className="block truncate text-xs text-slate-400">
                    {trade.strategy_name ?? "Unassigned"} · {trade.tags.map((tag) => tag.name).join(", ") || "untagged"}
                  </span>
                </span>
                <span className={`text-right font-medium tabular-nums ${numeric(trade.net_pnl) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{money(numeric(trade.net_pnl), trade.currency)}</span>
              </button>
            ))}
            {!drillTrades.length ? <p className="py-8 text-center text-sm text-slate-500 md:col-span-2">No underlying rows remain in the current filter.</p> : null}
          </div>
          <AnalyticsPages label="Underlying trade pages" noun="trades" paging={underlying} />
        </section>
      ) : null}
    </div>
  );
}

function AssetMix({ title, rows, onSelect }: { title: string; rows: ReturnType<typeof journalAssetMix>; onSelect: (label: string) => void }) {
  let offset = 0;
  const palette = ["#67e8f9", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#94a3b8"];
  const paging = useJournalPages(rows, rows.map((row) => row.label).join("\n"));
  return (
    <div>
      <h3 className="text-xs font-semibold text-slate-300">{title}</h3>
      <div className="mt-3 flex flex-col gap-5 sm:flex-row sm:items-center">
        <svg viewBox="0 0 42 42" role="img" aria-label={`${title} across ${rows.length} segments`} className="h-32 w-32 shrink-0 -rotate-90">
          {rows.map((row, index) => {
            const circle = <circle key={row.label} cx="21" cy="21" r="15.915" fill="none" stroke={palette[index % palette.length]} strokeWidth="6" strokeDasharray={`${row.percent} ${100 - row.percent}`} strokeDashoffset={-offset} />;
            offset += row.percent;
            return circle;
          })}
        </svg>
        <div className="grid min-w-0 flex-1 gap-1">
          {paging.rows.map((row, index) => (
            <button key={row.label} type="button" onClick={() => onSelect(row.label)} className="flex min-h-11 items-center gap-2 rounded px-2 text-left text-sm text-slate-300 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 sm:min-h-9">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: palette[(paging.page * 100 + index) % palette.length] }} />
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              <span className="tabular-nums text-slate-500">
                {row.count} · {row.percent.toFixed(0)}%
              </span>
            </button>
          ))}
          {!rows.length ? <p className="text-sm text-slate-500">Position mix appears after trades are added.</p> : null}
        </div>
      </div>
      <AnalyticsPages label={`${title} pages`} noun="segments" paging={paging} />
    </div>
  );
}

function AnalyticsPages({ label, noun, paging }: { label: string; noun: string; paging: { page: number; pageCount: number; total: number; setPage: (page: number) => void } }) {
  if (paging.pageCount <= 1) return null;
  return <nav aria-label={label} className="mt-4 flex flex-wrap items-center justify-center gap-3 text-xs text-slate-400">
    <JournalButton disabled={paging.page === 0} onClick={() => paging.setPage(paging.page - 1)}>Previous 100 {noun}</JournalButton>
    <span>Page {paging.page + 1} of {paging.pageCount} · {paging.total.toLocaleString()} {noun}</span>
    <JournalButton disabled={paging.page === paging.pageCount - 1} onClick={() => paging.setPage(paging.page + 1)}>Next 100 {noun}</JournalButton>
  </nav>;
}

function MoneyCell({ value, currency, combinable, muted }: { value: number; currency: string; combinable: boolean; muted?: boolean }) {
  return (
    <td className={`px-3 py-3 text-right tabular-nums ${muted ? "text-slate-500" : value >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
      {combinable ? (
        money(value, currency)
      ) : (
        <>
          <span aria-hidden="true">—</span>
          <span className="sr-only">Not combined across currencies</span>
        </>
      )}
    </td>
  );
}
function breakdownTabClass(selected: boolean) {
  const base = "min-h-11 min-w-11 rounded px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 sm:min-h-9 sm:min-w-0";
  if (selected) return `${base} bg-cyan-300/10 text-cyan-100`;
  return `${base} text-slate-500 hover:bg-white/5 hover:text-slate-200`;
}
function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}
