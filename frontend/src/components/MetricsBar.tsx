import { Activity, BarChart3, Gauge, Sigma, Target, TrendingUp } from "lucide-react";
import type { Metrics } from "../lib/api";
import { formatLocaleCurrency, formatMetricPercent, formatMetricRatio } from "../lib/locale";

type Props = {
  compact?: boolean;
  currency?: string;
  metrics: Metrics | null;
};

export function MetricsBar({ compact = false, currency = "USD", metrics }: Props) {
  const stats = [
    {
      label: "Net PnL",
      value: money(metrics?.net_pnl ?? 0, currency),
      icon: TrendingUp,
      tone: (metrics?.net_pnl ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300",
    },
    {
      label: "Win %",
      value: formatMetricPercent(metrics?.win_rate ?? 0),
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
      value: formatMetricRatio(metrics?.profit_factor),
      icon: Sigma,
      tone: "text-amber-200",
    },
    {
      label: "Sharpe",
      value: formatMetricRatio(metrics?.sharpe_ratio),
      icon: BarChart3,
      tone: "text-cyan-200",
    },
    {
      label: "Avg R",
      value: formatMetricRatio(metrics?.average_r),
      icon: Gauge,
      tone: "text-emerald-200",
    },
  ];

  return (
    <section className={compact ? "grid min-w-0 grid-cols-3 gap-x-4 gap-y-5 lg:grid-cols-6" : "grid w-full max-w-full min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6"}>
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <div
            key={stat.label}
            className={compact ? "min-w-0" : "min-w-0 rounded-md border border-white/10 bg-ink-850 px-4 py-3 shadow-panel"}
          >
            <div className="flex items-center justify-between text-slate-400">
              <span className={compact ? "ui-resilient-text min-w-0 text-xs" : "ui-resilient-text min-w-0 text-xs font-medium uppercase tracking-[0.18em]"} dir="auto">
                {stat.label}
              </span>
              {!compact ? <Icon size={17} /> : null}
            </div>
            <div className={`ui-number overflow-x-auto font-semibold ${compact ? "mt-1 text-lg" : "mt-3 text-2xl"} ${stat.tone}`} title={stat.value}>
              {stat.value}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function money(value: number, currency: string) {
  return formatLocaleCurrency(value, currency);
}
