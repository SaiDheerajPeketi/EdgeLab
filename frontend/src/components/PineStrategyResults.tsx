import { useEffect, useState } from "react";
import type { PineExecutionResult, PineScalar } from "../lib/pineProtocol";

type LedgerRow = Record<string, PineScalar>;
const PAGE_SIZE = 20;

export function PineStrategyResults({ result }: { result: PineExecutionResult }) {
  const strategy = result.strategy;
  if (!strategy) return null;
  return <section aria-label="Pine strategy results" className="mt-4 min-w-0 space-y-4 border-t border-white/10 pt-4 text-xs">
    <div><h3 className="font-semibold text-white">Pine strategy results</h3><p className="mt-1 leading-5 text-slate-300">PineTS 0.11.0 · {result.audit.bars.toLocaleString()} loaded bars. Experimental execution; compare fills and assumptions before relying on results.</p></div>
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-white/10 py-3">
      {[["Net profit", strategy.metrics.netprofit], ["Equity", strategy.metrics.equity], ["Open profit", strategy.metrics.openprofit], ["Max drawdown", strategy.metrics.max_drawdown], ["Closed trades", strategy.closedTrades.length], ["Open positions", strategy.openTrades.length]].map(([name, value]) => <div key={String(name)}><dt className="text-slate-300">{name}</dt><dd className="mt-1 font-mono tabular-nums text-white">{formatScalar(value as PineScalar)}</dd></div>)}
    </dl>
    <dl aria-label="Test assumptions" className="grid grid-cols-2 gap-x-4 gap-y-3 text-slate-300">
      {[["Starting capital", strategy.config.initial_capital], ["Order size", `${formatScalar(strategy.config.default_qty_value)} ${strategy.config.default_qty_type === "percent_of_equity" ? "% of equity" : strategy.config.default_qty_type === "cash" ? "cash" : "units"}`], ["Commission", `${formatScalar(strategy.config.commission_value)} ${strategy.config.commission_type === "percent" ? "%" : strategy.config.commission_type === "cash_per_contract" ? "per unit" : "per order"}`], ["Slippage", `${formatScalar(strategy.config.slippage)} ticks`]].map(([name, value]) => <div key={String(name)}><dt>{name}</dt><dd className="mt-1 break-words font-mono tabular-nums text-white">{formatScalar(value as PineScalar)}</dd></div>)}
    </dl>
    <Ledger label="Closed trades" rows={strategy.closedTrades} fields={["entry_id", "entry_time", "entry_price", "exit_time", "exit_price", "size", "profit", "commission"]} />
    <Ledger label="Open trades" rows={strategy.openTrades} fields={["entry_id", "entry_time", "entry_price", "size", "profit"]} />
    <Ledger label="Pending orders" rows={strategy.pendingOrders} fields={["id", "type", "direction", "qty", "limit", "stop", "time"]} />
    <details className="text-slate-300"><summary className="cursor-pointer font-semibold text-white">Engine settings and metrics</summary><dl className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
      {Object.entries(strategy.config).map(([name, value]) => <div className="contents" key={`config-${name}`}><dt className="break-words">{name.replaceAll("_", " ")}</dt><dd className="break-words font-mono text-white">{formatScalar(value)}</dd></div>)}
      {Object.entries(strategy.metrics).map(([name, value]) => <div className="contents" key={`metric-${name}`}><dt className="break-words">{name.replaceAll("_", " ")}</dt><dd className="break-words font-mono text-white">{formatScalar(value)}</dd></div>)}
    </dl></details>
    <p className="leading-5 text-slate-300">Open positions remain open. Pending orders have not filled. Results use the script’s order rules with the trading assumptions shown above. Explicit order quantities take precedence over default order size.</p>
  </section>;
}

function Ledger({ label, rows, fields }: { label: string; rows: LedgerRow[]; fields: string[] }) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [rows]);
  const pages = Math.ceil(rows.length / PAGE_SIZE);
  const currentPage = Math.min(page, Math.max(0, pages - 1));
  return <div className="min-w-0"><h4 className="mb-2 font-semibold text-white">{label} <span className="font-mono text-slate-300">{rows.length}</span></h4>
    {rows.length === 0 ? <p className="text-slate-300">No {label.toLowerCase()} in this run.</p> : <>
      <div className="overflow-x-auto rounded-md border border-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" tabIndex={0} aria-label={`${label} ledger`}><table className="w-full whitespace-nowrap text-left text-[11px]">
        <caption className="sr-only">{label}</caption><thead className="bg-white/5 text-slate-300"><tr>{fields.map((field) => <th className="px-2 py-2 font-medium" key={field} scope="col">{field.replaceAll("_", " ")}</th>)}</tr></thead>
        <tbody className="font-mono tabular-nums text-slate-200">{rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((row, index) => <tr className="border-t border-white/10" key={`${String(row.id)}-${index}`}>{fields.map((field) => <td className="px-2 py-2" key={field}>{field.endsWith("time") ? formatTime(row[field]) : formatScalar(row[field])}</td>)}</tr>)}</tbody>
      </table></div>
      {pages > 1 ? <div className="mt-2 flex items-center justify-between gap-2"><button className="studio-tool-button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} type="button" aria-label={`Previous ${label.toLowerCase()}`}>Previous</button><span className="text-slate-300">{currentPage + 1} / {pages}</span><button className="studio-tool-button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)} type="button" aria-label={`Next ${label.toLowerCase()}`}>Next</button></div> : null}
    </>}
  </div>;
}

function formatScalar(value: PineScalar | undefined) {
  if (value == null) return "—";
  return typeof value === "number" ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(value) : String(value);
}
function formatTime(value: PineScalar | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const date = new Date(value * 1_000);
  return Number.isFinite(date.getTime()) ? date.toISOString().replace("T", " ").replace(".000Z", " UTC") : "—";
}
