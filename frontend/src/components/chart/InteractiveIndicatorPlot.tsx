import { useId, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { formatChartDateTime, type ChartTimeFormatSettings } from "../../lib/chartTimezones";
import { formatIndicatorPlotValue, indicatorPlotReadouts, indicatorPlotTimestamp, nearestIndicatorPlotPoint, type IndicatorPlotPoint, type IndicatorPlotSeries } from "../../lib/indicatorPlotInspection";
import { OverlaySurface } from "../overlays/OverlaySurface";

type Props = {
  children: ReactNode;
  className: string;
  height: number;
  label: string;
  points: readonly IndicatorPlotPoint[];
  series: readonly IndicatorPlotSeries[];
  timeSettings: ChartTimeFormatSettings;
  width?: number;
};

export function InteractiveIndicatorPlot({ children, className, height, label, points, series, timeSettings, width = 960 }: Props) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const id = useId();
  const readouts = useMemo(() => indicatorPlotReadouts(points, series), [points, series]);
  const active = activeIndex === null ? null : readouts[activeIndex] ?? null;
  const activeX = activeIndex === null ? 0 : activeIndex / Math.max(1, points.length - 1) * width;
  const timestamp = active ? indicatorPlotTimestamp(active.time) : NaN;
  const validTime = Number.isFinite(timestamp);

  function inspect(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    setActiveIndex(nearestIndicatorPlotPoint(event.clientX, bounds.left, bounds.width, points.length));
  }

  return <div
    ref={anchorRef}
    className={`relative ${className} outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]`}
    data-indicator-plot={label}
    role="group"
    aria-label={`${label} indicator values`}
    aria-describedby={active ? id : undefined}
    tabIndex={0}
    onFocus={() => setActiveIndex((current) => current ?? points.length - 1)}
    onBlur={() => setActiveIndex(null)}
    onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") setActiveIndex(null);
      else if (event.key === "Home") setActiveIndex(0);
      else if (event.key === "End") setActiveIndex(points.length - 1);
      else setActiveIndex((current) => Math.max(0, Math.min(points.length - 1, (current ?? points.length - 1) + (event.key === "ArrowLeft" ? -1 : 1))));
    }}
  >
    <svg aria-hidden="true" className="h-full w-full cursor-crosshair touch-pan-y" preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`} onPointerMove={inspect} onPointerDown={inspect} onPointerLeave={(event) => { if (event.pointerType !== "touch") setActiveIndex(null); }} onPointerCancel={() => setActiveIndex(null)}>
      {children}
      {active ? <line data-indicator-crosshair x1={activeX} x2={activeX} y1="0" y2={height} stroke="var(--chart-crosshair)" strokeDasharray="4 4" strokeWidth="1" vectorEffect="non-scaling-stroke" pointerEvents="none" /> : null}
    </svg>
    <OverlaySurface anchorRef={anchorRef} surfaceRef={tooltipRef} blocksModalEscape={false} open={active !== null} portal preferredWidth={220} estimatedHeight={48 + series.length * 20} id={id} role="tooltip" onDismiss={() => setActiveIndex(null)} className="pointer-events-none z-[190] max-w-[220px] rounded-md border border-[var(--ui-border-strong)] bg-[var(--ui-floating)] px-3 py-2 text-xs shadow-[var(--elevation-floating)]">
      {active ? <div data-indicator-tooltip>
        <time dateTime={validTime ? new Date(timestamp).toISOString() : undefined} className="block break-words text-[var(--text-secondary)]">{validTime ? formatChartDateTime(timestamp, timeSettings) : "Unknown time"}</time>
        <dl className="mt-2 space-y-1">
          {active.rows.map((row) => <div key={row.label} className="flex min-w-0 items-baseline justify-between gap-3"><dt className="min-w-0 break-words text-[var(--text-secondary)]">{row.label}</dt><dd data-indicator-value={row.label} className="break-words font-mono font-semibold tabular-nums text-[var(--text-primary)]">{formatIndicatorPlotValue(row.value, row.digits)}</dd></div>)}
        </dl>
      </div> : null}
    </OverlaySurface>
    <span className="sr-only">Use left and right arrow keys to inspect indicator values. Home and End select the first and last plotted candle. Escape dismisses the values.</span>
  </div>;
}
