import type { Metrics } from "../lib/api";

type Props = {
  currency?: string;
  metrics: Metrics | null;
};

export function EquityCurve({ currency = "USD", metrics }: Props) {
  const points = metrics?.equity_curve ?? [];
  const path = toPath(points.map((point) => point.equity), 472, 150);

  return (
    <section className="min-w-0 rounded-md border border-white/10 bg-ink-850 p-4 shadow-panel">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Equity Curve</h2>
        <span className="text-xs text-slate-500">
          DD {money(metrics?.max_drawdown ?? 0, currency)}
        </span>
      </div>
      <div className="h-[150px] overflow-hidden rounded-md bg-ink-950">
        {points.length > 1 ? (
          <svg
            className="h-full w-full"
            preserveAspectRatio="none"
            viewBox="0 0 472 150"
          >
            <path
              d="M 0 150 L 472 150"
              fill="none"
              stroke="rgba(148, 163, 184, 0.18)"
              strokeWidth="1"
            />
            <path d={path} fill="none" stroke="#32d3ee" strokeWidth="2.5" />
          </svg>
        ) : (
          <div className="grid h-full place-items-center text-sm text-slate-500">
            No closed trades
          </div>
        )}
      </div>
    </section>
  );
}

function toPath(values: number[], width: number, height: number) {
  if (values.length < 2) {
    return "";
  }

  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const range = max - min || 1;
  const step = width / (values.length - 1);

  return values
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / range) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}
