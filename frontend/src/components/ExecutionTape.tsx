import type { Execution } from "../lib/api";
import { formatPrice } from "../lib/format";

type Props = {
  currency?: string;
  executions: Execution[];
};

export function ExecutionTape({ currency = "USD", executions }: Props) {
  return (
    <section className="min-w-0 rounded-md border border-white/10 bg-ink-850 p-4 shadow-panel">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Execution Tape</h2>
        <span className="text-xs text-slate-500">{executions.length}</span>
      </div>
      <div className="max-h-64 space-y-2 overflow-auto">
        {executions.map((execution) => (
          <div key={execution.id} className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-2 rounded-md bg-ink-950 px-3 py-2 text-sm">
            <span className={execution.side === "BUY" ? "text-emerald-300" : "text-rose-300"}>
              {execution.side}
            </span>
            <span className="truncate text-slate-300">
              {execution.quantity.toLocaleString()} @ {formatPrice(execution.price)}
            </span>
            <span className={execution.realized_pnl >= 0 ? "text-emerald-300" : "text-rose-300"}>
              {execution.realized_pnl === 0 ? "—" : money(execution.realized_pnl, currency)}
            </span>
          </div>
        ))}
        {executions.length === 0 && (
          <div className="grid h-24 place-items-center rounded-md bg-ink-950 text-sm text-slate-500">
            No executions
          </div>
        )}
      </div>
    </section>
  );
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}
