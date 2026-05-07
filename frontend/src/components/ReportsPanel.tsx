import type { Metrics } from "../lib/api";
import { EquityCurve } from "./EquityCurve";

type Props = {
  currency?: string;
  metrics: Metrics | null;
};

export function ReportsPanel({ currency = "USD", metrics }: Props) {
  return (
    <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
      <EquityCurve currency={currency} metrics={metrics} />
      <div className="min-w-0 rounded-md border border-white/10 bg-ink-850 p-4 shadow-panel">
        <h2 className="mb-3 text-sm font-semibold text-white">Backtest Report</h2>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Metric label="Best" value={money(metrics?.best_trade ?? 0, currency)} tone="text-emerald-300" />
          <Metric label="Worst" value={money(metrics?.worst_trade ?? 0, currency)} tone="text-rose-300" />
          <Metric label="Win Streak" value={String(metrics?.longest_win_streak ?? 0)} />
          <Metric label="Loss Streak" value={String(metrics?.longest_loss_streak ?? 0)} />
        </div>
        <div className="mt-4 grid gap-2">
          {metrics?.side_breakdown.map((row) => (
            <div key={row.side} className="rounded-md bg-ink-950 px-3 py-2 text-sm">
              <div className="flex justify-between">
                <span className={row.side === "LONG" ? "text-emerald-300" : "text-rose-300"}>
                  {row.side}
                </span>
                <span>{money(row.net_pnl, currency)}</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {row.trades} trades · {(row.win_rate * 100).toFixed(1)}% win
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="min-w-0 rounded-md border border-white/10 bg-ink-850 p-4 shadow-panel xl:col-span-2">
        <h2 className="mb-3 text-sm font-semibold text-white">Strategy Performance</h2>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {(metrics?.strategy_performance ?? []).map((row) => (
            <div key={row.strategy_name} className="rounded-md bg-ink-950 px-3 py-2 text-sm">
              <div className="flex justify-between gap-3">
                <span className="font-semibold text-slate-100">{row.strategy_name}</span>
                <span className={row.net_pnl >= 0 ? "text-emerald-300" : "text-rose-300"}>
                  {money(row.net_pnl, currency)}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {row.trades} trades · {(row.win_rate * 100).toFixed(1)}% · R{" "}
                {row.average_r?.toFixed(2) ?? "—"}
              </div>
            </div>
          ))}
          {(metrics?.strategy_performance.length ?? 0) === 0 && (
            <div className="rounded-md bg-ink-950 px-3 py-6 text-center text-sm text-slate-500">
              No closed trades yet
            </div>
          )}
        </div>
      </div>
      <div className="min-w-0 rounded-md border border-white/10 bg-ink-850 p-4 shadow-panel xl:col-span-2">
        <h2 className="mb-3 text-sm font-semibold text-white">Calendar Heatmap</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
          {(metrics?.calendar ?? []).slice(-32).map((day) => (
            <div
              key={day.date}
              className={`rounded-md px-3 py-2 text-xs ${
                day.pnl >= 0 ? "bg-emerald-300/10 text-emerald-100" : "bg-rose-300/10 text-rose-100"
              }`}
            >
              <div>{day.date}</div>
              <div className="mt-1 font-semibold">{money(day.pnl, currency)}</div>
            </div>
          ))}
          {(metrics?.calendar.length ?? 0) === 0 && (
            <div className="col-span-full rounded-md bg-ink-950 px-3 py-6 text-center text-sm text-slate-500">
              Close trades to populate the calendar
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value, tone = "text-slate-100" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md bg-ink-950 px-3 py-2">
      <div className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}
