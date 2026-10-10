import { useId, useMemo, useState, type PointerEvent } from "react";
import { formatLocaleCurrency, formatLocaleDateTime } from "../../lib/locale";
import { journalEquityGeometry, journalEquityPointIndex, type JournalEquityPoint } from "../../lib/journalEquityGeometry";

type Props = {
  points: readonly JournalEquityPoint[];
  currency: string;
  label?: string;
  compact?: boolean;
};

export function JournalEquityPlot({ points, currency, label = "Journal equity curve", compact = false }: Props) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const id = useId();
  const gradientId = `journal-equity-${id.replace(/:/g, "")}`;
  const tooltipId = `${gradientId}-tooltip`;
  const width = 900, height = compact ? 80 : 224, padding = compact ? 5 : 12;
  const plotted = useMemo(() => journalEquityGeometry(points, width, height, padding), [points, height, padding]);
  const active = activeIndex === null ? null : plotted[activeIndex] ?? null;
  const path = plotted.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  const positive = (points.at(-1)?.value ?? 0) >= (points[0]?.value ?? 0);
  const color = positive ? "var(--accent-primary)" : "var(--loss)";
  const activePercent = active ? active.x / width * 100 : 0;

  function inspect(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    setActiveIndex(journalEquityPointIndex(event.clientX, bounds.left, bounds.width, plotted.length, width, padding));
  }

  if (!plotted.length) return <div className={`mt-4 grid place-items-center border-y border-dashed border-[var(--ui-border-subtle)] text-sm text-[var(--text-secondary)] ${compact ? "h-20" : "h-56"}`}>Close trades to build the equity curve.</div>;

  return <div className="mt-4">
    <div
      aria-label={label}
      aria-describedby={active ? tooltipId : undefined}
      className="relative rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]"
      data-journal-equity-chart
      role="group"
      tabIndex={0}
      onBlur={() => setActiveIndex(null)}
      onFocus={() => setActiveIndex((current) => current ?? plotted.length - 1)}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
        event.preventDefault();
        if (event.key === "Escape") setActiveIndex(null);
        else if (event.key === "Home") setActiveIndex(0);
        else if (event.key === "End") setActiveIndex(plotted.length - 1);
        else setActiveIndex((current) => Math.max(0, Math.min(plotted.length - 1, (current ?? plotted.length - 1) + (event.key === "ArrowLeft" ? -1 : 1))));
      }}
    >
      <svg aria-hidden="true" className={`w-full cursor-crosshair touch-pan-y ${compact ? "h-20" : "h-56"}`} preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`} onPointerDown={inspect} onPointerMove={inspect} onPointerLeave={(event) => { if (event.pointerType !== "touch") setActiveIndex(null); }} onPointerCancel={() => setActiveIndex(null)}>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".18" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        {!compact && plotted.length > 1 ? <path d={`${path} L${width - padding},${height - padding} L${padding},${height - padding} Z`} fill={`url(#${gradientId})`} /> : null}
        <path d={path} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {plotted.length === 1 ? <circle cx={plotted[0].x} cy={plotted[0].y} r="3" fill={color} /> : null}
        {active ? <g pointerEvents="none"><line x1={active.x} x2={active.x} y1={padding} y2={height - padding} stroke="var(--chart-crosshair)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" /><circle cx={active.x} cy={active.y} r="4" fill={color} stroke="var(--ui-surface)" strokeWidth="2" vectorEffect="non-scaling-stroke" /></g> : null}
      </svg>
      {active ? <div
        id={tooltipId}
        data-journal-equity-tooltip
        role="tooltip"
        className="pointer-events-none absolute top-2 z-20 w-max max-w-[calc(100%-1rem)] rounded-md border border-[var(--ui-border-strong)] bg-[var(--ui-floating)] px-3 py-2 text-xs shadow-[var(--elevation-floating)]"
        style={{ left: activePercent <= 50 ? 8 : undefined, right: activePercent > 50 ? 8 : undefined }}
      >
        <p className="break-words text-[var(--text-secondary)]">{formatLocaleDateTime(`${active.point.date}T12:00:00Z`, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} · Trade {active.point.tradeId}</p>
        <p className="mt-1 break-words font-semibold tabular-nums text-[var(--text-primary)]">Balance {formatLocaleCurrency(active.point.value, currency)}</p>
      </div> : null}
      <span className="sr-only">Use left and right arrow keys to inspect balances. Home and End select the first and last trade. Escape dismisses the values.</span>
    </div>
    {!compact ? <div className="mt-1 flex justify-between text-[10px] tabular-nums text-[var(--text-secondary)]"><span>{formatLocaleCurrency(points[0].value, currency)}</span><span>{formatLocaleCurrency(points.at(-1)!.value, currency)}</span></div> : null}
  </div>;
}
