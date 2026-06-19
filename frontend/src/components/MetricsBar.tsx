import { Activity, BarChart3, Gauge, Sigma, Target, TrendingUp } from "lucide-react";
import type { Metrics } from "../lib/api";

type Props = {
  currency?: string;
  metrics: Metrics | null;
};

export function MetricsBar({ currency = "USD", metrics }: Props) {
  const stats = [
    {
      label: "Net PnL",
      value: money(metrics?.net_pnl ?? 0, currency),
      icon: TrendingUp,
      tone: (metrics?.net_pnl ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300",
    },
    {
      label: "Win %",
      value: percent(metrics?.win_rate ?? 0),
      icon: Target,
      tone: "text-cyan-200",
    },
    {
      label: "Trades",
      value: String(metrics?.total_trades ?? 0),
      icon: Activity,
      tone: "text-slate-100",
    },
    {
      label: "Profit Factor",
      value: optionalNumber(metrics?.profit_factor),
      icon: Sigma,
      tone: "text-amber-200",
    },
    {
      label: "Sharpe",
      value: optionalNumber(metrics?.sharpe_ratio),
      icon: BarChart3,
      tone: "text-cyan-200",
    },
    {
      label: "Avg R",
      value: optionalNumber(metrics?.average_r),
      icon: Gauge,
      tone: "text-emerald-200",
    },
  ];

  return (
    <section className="grid w-full max-w-full min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <div
            key={stat.label}
            className="min-w-0 rounded-md border border-white/10 bg-ink-850 px-4 py-3 shadow-panel"
          >
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-medium uppercase tracking-[0.18em]">
                {stat.label}
              </span>
              <Icon size={17} />
            </div>
            <div className={`mt-3 truncate text-2xl font-semibold ${stat.tone}`}>
              {stat.value}
            </div>
          </div>
        );
      })}
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

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function optionalNumber(value: number | null | undefined) {
  return value == null ? "—" : value.toFixed(2);
}
