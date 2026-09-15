import { Activity, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { Execution } from "../lib/api";
import { formatPrice } from "../lib/format";
import { formatLocaleCurrency, formatLocaleDateTime, formatLocaleNumber } from "../lib/locale";

type Props = {
  currency?: string;
  executions: Execution[];
};

export function ExecutionTape({ currency = "USD", executions }: Props) {
  return (
    <section className="min-w-0 overflow-hidden rounded-xl bg-[#080c11] shadow-panel ring-1 ring-inset ring-white/10">
      <header className="flex min-h-14 items-center justify-between gap-4 border-b border-white/[0.08] px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Activity aria-hidden="true" className="text-cyan-300" size={16} strokeWidth={1.8} />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold tracking-[-0.01em] text-white">
              Execution tape
            </h2>
            <p className="text-[11px] text-slate-400">Chronological fills</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-medium text-slate-400">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(50,211,238,0.65)]" />
          <span>{executions.length} fills</span>
        </div>
      </header>

      <div className="grid grid-cols-[76px_minmax(0,1fr)_auto] gap-3 border-b border-white/[0.06] bg-white/[0.018] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        <span>Side</span>
        <span>Fill</span>
        <span className="text-end">Realized</span>
      </div>

      <div aria-live="polite" className="max-h-72 overflow-auto" role="log">
        {executions.map((execution, index) => {
          const isBuy = execution.side === "BUY";
          const isProfit = execution.realized_pnl >= 0;
          const SideIcon = isBuy ? ArrowDownLeft : ArrowUpRight;

          return (
            <div
              className={`grid min-w-0 grid-cols-[76px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-white/[0.035] ${
                index > 0 ? "border-t border-white/[0.055]" : ""
              }`}
              key={execution.id}
            >
              <div
                className={`flex items-center gap-2 font-semibold ${
                  isBuy ? "text-emerald-300" : "text-rose-300"
                }`}
              >
                <SideIcon aria-hidden="true" size={14} strokeWidth={2} />
                <span>{execution.side}</span>
              </div>
              <div className="min-w-0">
                <div className="truncate font-data text-xs text-slate-200">
                  {formatLocaleNumber(execution.quantity)} @ {formatPrice(execution.price)}
                </div>
                <div className="mt-1 truncate text-[10px] text-slate-400">
                  {formatExecutionTime(execution.timestamp)} · {execution.position_side_after.toLowerCase()} {formatLocaleNumber(execution.position_quantity_after)}
                </div>
              </div>
              <span
                className={`font-data text-xs font-medium tabular-nums ${
                  execution.realized_pnl === 0
                    ? "text-slate-400"
                    : isProfit
                      ? "text-emerald-300"
                      : "text-rose-300"
                }`}
              >
                {execution.realized_pnl === 0 ? "—" : money(execution.realized_pnl, currency)}
              </span>
            </div>
          );
        })}

        {executions.length === 0 ? (
          <div className="grid min-h-32 place-items-center px-5 text-center">
            <div>
              <Activity aria-hidden="true" className="mx-auto text-slate-700" size={22} strokeWidth={1.5} />
              <p className="mt-3 text-sm font-medium text-slate-300">Tape is quiet</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">New fills will appear here in execution order.</p>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function formatExecutionTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return formatLocaleDateTime(parsed, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function money(value: number, currency: string) {
  return formatLocaleCurrency(value, currency);
}
