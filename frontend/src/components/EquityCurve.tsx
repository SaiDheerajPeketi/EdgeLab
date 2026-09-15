import { useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Metrics } from "../lib/api";
import { formatLocaleCurrency } from "../lib/locale";

type Props = {
  currency?: string;
  metrics: Metrics | null;
};

export function EquityCurve({ currency = "USD", metrics }: Props) {
  const points = metrics?.equity_curve ?? [];
  const values = points.map((point) => point.equity);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const width = 472;
  const height = 150;
  const domain = chartDomain(values);
  const chartPoints = toPoints(values, width, height, domain);
  const path = toPath(chartPoints);
  const activePoint = activeIndex == null ? null : chartPoints[activeIndex] ?? null;
  const activeSource = activeIndex == null ? null : points[activeIndex] ?? null;

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const rawIndex = ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * (points.length - 1);
    setActiveIndex(Math.max(0, Math.min(points.length - 1, Math.round(rawIndex))));
  }

  function moveActiveIndex(delta: number) {
    setActiveIndex((current) => {
      const nextIndex = (current ?? points.length - 1) + delta;
      return Math.max(0, Math.min(points.length - 1, nextIndex));
    });
  }

  return (
    <section className="min-w-0 rounded-md border border-white/10 bg-ink-850 p-4 shadow-panel">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Equity Curve</h2>
        <span className="text-xs text-slate-500">
          DD {money(metrics?.max_drawdown ?? 0, currency)}
        </span>
      </div>
      <div
        aria-label="Interactive account equity curve"
        className="relative h-[150px] overflow-hidden rounded-md bg-ink-950 outline-none focus-visible:ring-1 focus-visible:ring-cyan-300/40"
        onBlur={() => setActiveIndex(null)}
        onFocus={() => setActiveIndex((current) => current ?? points.length - 1)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            moveActiveIndex(-1);
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            moveActiveIndex(1);
          }
          if (event.key === "Home") {
            event.preventDefault();
            setActiveIndex(0);
          }
          if (event.key === "End") {
            event.preventDefault();
            setActiveIndex(points.length - 1);
          }
        }}
        role="img"
        tabIndex={points.length > 1 ? 0 : -1}
      >
        {points.length > 1 ? (
          <>
          <svg
            className="h-full w-full cursor-crosshair"
            onPointerLeave={() => setActiveIndex(null)}
            onPointerMove={handlePointerMove}
            preserveAspectRatio="none"
            viewBox={`0 0 ${width} ${height}`}
          >
            <path
              d={`M 0 ${zeroY(0, height, domain).toFixed(2)} L ${width} ${zeroY(0, height, domain).toFixed(2)}`}
              fill="none"
              stroke="rgba(148, 163, 184, 0.18)"
              strokeWidth="1"
            />
            <path d={path} fill="none" stroke="#32d3ee" strokeWidth="2.5" />
            {activePoint && (
              <g>
                <line
                  stroke="rgba(226, 232, 240, 0.28)"
                  strokeDasharray="4 6"
                  strokeWidth="1"
                  x1={activePoint.x}
                  x2={activePoint.x}
                  y1="0"
                  y2={height}
                />
                <line
                  stroke="rgba(226, 232, 240, 0.16)"
                  strokeDasharray="4 6"
                  strokeWidth="1"
                  x1="0"
                  x2={width}
                  y1={activePoint.y}
                  y2={activePoint.y}
                />
                <circle cx={activePoint.x} cy={activePoint.y} fill="#32d3ee" r="5" stroke="#020617" strokeWidth="2.5" />
              </g>
            )}
          </svg>
          {activePoint && activeSource && (
            <div
              className="pointer-events-none absolute z-10 rounded-md border border-white/10 bg-slate-950/95 px-2.5 py-2 text-xs shadow-xl shadow-black/30 backdrop-blur"
              style={{
                left: `${clampPercent((activePoint.x / width) * 100, 12, 88)}%`,
                top: `${clampPercent((activePoint.y / height) * 100, 16, 84)}%`,
                transform: activePoint.y < height * 0.36 ? "translate(-50%, 14px)" : "translate(-50%, calc(-100% - 12px))",
              }}
            >
              <div className="font-semibold text-white">{formatDateTime(activeSource.timestamp)}</div>
              <div className={`mt-1 font-semibold tabular-nums ${(activeSource.equity ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                {money(activeSource.equity, currency)}
              </div>
            </div>
          )}
          </>
        ) : (
          <div className="grid h-full place-items-center text-sm text-slate-500">
            No closed trades
          </div>
        )}
      </div>
    </section>
  );
}

function chartDomain(values: number[]) {
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  if (min === max) {
    const padding = Math.max(1, Math.abs(min) * 0.12);
    return { max: max + padding, min: min - padding };
  }
  const padding = (max - min) * 0.08;
  return { max: max + padding, min: min - padding };
}

function toPoints(
  values: number[],
  width: number,
  height: number,
  domain: { max: number; min: number },
) {
  if (values.length < 2) {
    return [];
  }
  const range = domain.max - domain.min || 1;
  const step = width / (values.length - 1);
  return values.map((value, index) => ({
    x: index * step,
    y: height - ((value - domain.min) / range) * height,
  }));
}

function toPath(points: Array<{ x: number; y: number }>) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
}

function zeroY(
  value: number,
  height: number,
  domain: { max: number; min: number },
) {
  const range = domain.max - domain.min || 1;
  return height - ((value - domain.min) / range) * height;
}

function clampPercent(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString([], {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}

function money(value: number, currency: string) {
  return formatLocaleCurrency(value, currency);
}
