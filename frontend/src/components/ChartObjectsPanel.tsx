import {
  Activity,
  CandlestickChart,
  Eye,
  EyeOff,
  Layers,
  LineChart,
  Magnet,
  Minus,
  Square,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  INDICATORS,
  type ChartDrawing,
  type ChartIndicatorId,
} from "../lib/charting";
import { formatPrice } from "../lib/format";

type Props = {
  activeIndicators: ChartIndicatorId[];
  drawings: ChartDrawing[];
  onClearDrawings: () => void;
  onToggleIndicator: (indicator: ChartIndicatorId) => void;
  onToggleOrderOverlays: () => void;
  orderOverlaysVisible: boolean;
  smoothCandles: boolean;
};

const drawingIcons: Record<ChartDrawing["tool"], LucideIcon> = {
  fib: Magnet,
  horizontal: Minus,
  rectangle: Square,
  trendline: LineChart,
};

export function ChartObjectsPanel({
  activeIndicators,
  drawings,
  onClearDrawings,
  onToggleIndicator,
  onToggleOrderOverlays,
  orderOverlaysVisible,
  smoothCandles,
}: Props) {
  return (
    <aside className="chart-side-panel">
      <div className="border-b border-white/10 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Chart Objects</h2>
            <p className="mt-1 text-xs text-slate-500">
              Indicators, drawings, overlays
            </p>
          </div>
          <Layers size={18} className="text-cyan-200" />
        </div>
      </div>

      <div className="space-y-4 p-3">
        <section>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Layers
            </span>
            <button
              className="icon-button h-8 w-8"
              onClick={onToggleOrderOverlays}
              title={orderOverlaysVisible ? "Hide order overlays" : "Show order overlays"}
              type="button"
            >
              {orderOverlaysVisible ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
          </div>
          <div className="grid gap-2">
            <ObjectRow
              active
              icon={CandlestickChart}
              label={smoothCandles ? "Smooth Candles" : "Candles"}
              meta="Main price series"
            />
            <ObjectRow
              active={orderOverlaysVisible}
              icon={Activity}
              label="Orders & Levels"
              meta="Entries, exits, SL/TP"
            />
          </div>
        </section>

        <section>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Indicators
          </div>
          <div className="grid gap-2">
            {INDICATORS.map((indicator) => {
              const active = activeIndicators.includes(indicator.id);
              return (
                <button
                  className={`chart-object-row text-left ${active ? "chart-object-row-active" : ""}`}
                  key={indicator.id}
                  onClick={() => onToggleIndicator(indicator.id)}
                  type="button"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: active
                        ? indicator.color
                        : "rgba(148, 163, 184, 0.38)",
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-100">
                      {indicator.label}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {indicator.description}
                    </span>
                  </span>
                  <span className={active ? "text-cyan-100" : "text-slate-600"}>
                    {active ? "On" : "Off"}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Drawings
            </span>
            <button
              className="icon-button h-8 w-8"
              disabled={drawings.length === 0}
              onClick={onClearDrawings}
              title="Clear drawings"
              type="button"
            >
              <Trash2 size={14} />
            </button>
          </div>
          <div className="grid gap-2">
            {drawings.map((drawing, index) => {
              const Icon = drawingIcons[drawing.tool];
              return (
                <div className="chart-object-row" key={drawing.id}>
                  <span
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-white/10 bg-white/5"
                    style={{ color: drawing.color }}
                  >
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold capitalize text-slate-100">
                      {drawing.tool} {index + 1}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {drawing.points.length === 1
                        ? formatPrice(drawing.points[0].price)
                        : `${drawing.points.length} anchors`}
                    </span>
                  </span>
                </div>
              );
            })}
            {drawings.length === 0 && (
              <div className="rounded-md border border-dashed border-white/10 bg-black/15 px-3 py-5 text-center text-sm text-slate-500">
                No drawings yet
              </div>
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}

function ObjectRow({
  active,
  icon: Icon,
  label,
  meta,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  meta: string;
}) {
  return (
    <div className={`chart-object-row ${active ? "chart-object-row-active" : ""}`}>
      <Icon size={16} className={active ? "text-cyan-100" : "text-slate-600"} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-100">
          {label}
        </span>
        <span className="block truncate text-xs text-slate-500">{meta}</span>
      </span>
      <span className={active ? "text-cyan-100" : "text-slate-600"}>
        {active ? "On" : "Off"}
      </span>
    </div>
  );
}
