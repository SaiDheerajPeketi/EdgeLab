import {
  Activity,
  CandlestickChart,
  Eye,
  EyeOff,
  Layers,
  LineChart,
  LockKeyhole,
  Magnet,
  Minus,
  Ruler,
  SlidersHorizontal,
  Square,
  Type,
  Trash2,
  UnlockKeyhole,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  INDICATORS,
  type ChartDrawing,
  type ChartIndicatorId,
  type ChartStyle,
  type DrawingLineStyle,
  type IndicatorSettings,
  type IndicatorSettingsMap,
} from "../lib/charting";
import { formatPrice } from "../lib/format";

type Props = {
  activeIndicators: ChartIndicatorId[];
  chartStyle: ChartStyle;
  drawings: ChartDrawing[];
  indicatorSettings: IndicatorSettingsMap;
  onClearDrawings: () => void;
  onDeleteDrawing: (drawingId: string) => void;
  onSelectDrawing: (drawingId: string | null) => void;
  onToggleIndicator: (indicator: ChartIndicatorId) => void;
  onToggleOrderOverlays: () => void;
  onUpdateDrawing: (drawing: ChartDrawing) => void;
  onUpdateIndicatorSettings: (
    indicator: ChartIndicatorId,
    settings: Partial<IndicatorSettings>,
  ) => void;
  orderOverlaysVisible: boolean;
  selectedDrawingId: string | null;
  smoothCandles: boolean;
};

const drawingIcons: Record<ChartDrawing["tool"], LucideIcon> = {
  fib: Magnet,
  horizontal: Minus,
  longPosition: LineChart,
  measure: Ruler,
  rectangle: Square,
  shortPosition: LineChart,
  text: Type,
  trendline: LineChart,
};

const FALLBACK_SETTING: IndicatorSettings = {
  color: "#32d3ee",
  period: 20,
};

export function ChartObjectsPanel({
  activeIndicators,
  chartStyle,
  drawings,
  indicatorSettings,
  onClearDrawings,
  onDeleteDrawing,
  onSelectDrawing,
  onToggleIndicator,
  onToggleOrderOverlays,
  onUpdateDrawing,
  onUpdateIndicatorSettings,
  orderOverlaysVisible,
  selectedDrawingId,
  smoothCandles,
}: Props) {
  const selectedDrawing = drawings.find((drawing) => drawing.id === selectedDrawingId) ?? null;
  const updateSelectedDrawing = (patch: Partial<ChartDrawing>) => {
    if (!selectedDrawing) {
      return;
    }
    onUpdateDrawing({ ...selectedDrawing, ...patch });
  };

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
              label={chartStyleLabel(chartStyle, smoothCandles)}
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
              const settings = indicatorSettings[indicator.id] ?? FALLBACK_SETTING;
              return (
                <div
                  className={`chart-object-row text-left ${active ? "chart-object-row-active" : ""}`}
                  key={indicator.id}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: active
                        ? settings.color
                        : "rgba(148, 163, 184, 0.38)",
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-100">
                      {indicator.label}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {indicator.id === "macd"
                        ? `${settings.fastPeriod ?? 12}/${settings.slowPeriod ?? 26}/${settings.signalPeriod ?? 9}`
                        : indicator.id === "vwap"
                        ? indicator.description
                        : `Period ${settings.period}${indicator.id === "bb20" ? ` / ${settings.stdDev ?? 2}σ` : ""}`}
                    </span>
                  </span>
                  <button
                    className={active ? "text-cyan-100" : "text-slate-500"}
                    onClick={() => onToggleIndicator(indicator.id)}
                    type="button"
                  >
                    {active ? "On" : "Off"}
                  </button>
                  {active && indicator.id !== "vwap" && indicator.id !== "macd" && (
                    <input
                      className="h-8 w-16 rounded-md border border-white/10 bg-ink-950 px-2 text-xs text-slate-100 outline-none"
                      min={2}
                      onChange={(event) =>
                        onUpdateIndicatorSettings(indicator.id, {
                          period: Math.max(2, Number(event.target.value) || 2),
                        })
                      }
                      type="number"
                      value={settings.period}
                    />
                  )}
                </div>
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
                <div
                  className={`chart-object-row ${drawing.visible === false ? "opacity-55" : ""} ${selectedDrawingId === drawing.id ? "chart-object-row-selected" : ""}`}
                  key={drawing.id}
                  onClick={() => onSelectDrawing(drawing.id)}
                  role="button"
                  tabIndex={0}
                >
                  <span
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-white/10 bg-white/5"
                    style={{ color: drawing.color }}
                  >
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold capitalize text-slate-100">
                      {drawing.label || `${drawing.tool} ${index + 1}`}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {drawing.visible === false
                        ? "Hidden"
                        : drawing.locked
                          ? "Locked"
                          : drawing.points.length === 1
                        ? formatPrice(drawing.points[0].price)
                        : `${drawing.points.length} anchors`}
                    </span>
                  </span>
                  <button
                    className="icon-button h-8 w-8"
                    onClick={(event) => {
                      event.stopPropagation();
                      onUpdateDrawing({
                        ...drawing,
                        visible: drawing.visible === false,
                      });
                    }}
                    title={drawing.visible === false ? "Show drawing" : "Hide drawing"}
                    type="button"
                  >
                    {drawing.visible === false ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                  <button
                    className="icon-button h-8 w-8"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteDrawing(drawing.id);
                      onSelectDrawing(null);
                    }}
                    title="Delete drawing"
                    type="button"
                  >
                    <X size={13} />
                  </button>
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

        <section className="rounded-md border border-white/10 bg-black/20 p-3">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Object Settings
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {selectedDrawing ? selectedDrawing.tool : "Select a drawing"}
              </div>
            </div>
            <SlidersHorizontal size={16} className="text-cyan-200" />
          </div>
          {selectedDrawing ? (
            <DrawingInspector
              drawing={selectedDrawing}
              onChange={updateSelectedDrawing}
            />
          ) : (
            <div className="rounded-md border border-dashed border-white/10 px-3 py-5 text-center text-sm text-slate-500">
              Click an object to edit style, visibility, lock, and labels.
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}

function DrawingInspector({
  drawing,
  onChange,
}: {
  drawing: ChartDrawing;
  onChange: (patch: Partial<ChartDrawing>) => void;
}) {
  const fillOpacity = Math.round((drawing.fillOpacity ?? 0.16) * 100);
  const lineStyle = drawing.lineStyle ?? "solid";
  const lineWidth = drawing.lineWidth ?? 2;

  return (
    <div className="grid gap-3">
      <label className="object-setting-field">
        <span>Label</span>
        <input
          className="input-control h-9"
          onChange={(event) => onChange({ label: event.target.value })}
          placeholder={`${drawing.tool} label`}
          value={drawing.label ?? ""}
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="object-setting-field">
          <span>Color</span>
          <input
            className="h-9 w-full cursor-pointer rounded-md border border-white/10 bg-ink-950 p-1"
            onChange={(event) => onChange({ color: event.target.value })}
            type="color"
            value={drawing.color}
          />
        </label>
        <label className="object-setting-field">
          <span>Line</span>
          <select
            className="input-control h-9"
            onChange={(event) =>
              onChange({ lineStyle: event.target.value as DrawingLineStyle })
            }
            value={lineStyle}
          >
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
          </select>
        </label>
      </div>

      <label className="object-setting-field">
        <span className="flex items-center justify-between">
          <span>Stroke Width</span>
          <strong className="text-slate-300">{lineWidth.toFixed(1)}</strong>
        </span>
        <input
          max={6}
          min={1}
          onChange={(event) => onChange({ lineWidth: Number(event.target.value) })}
          step={0.5}
          type="range"
          value={lineWidth}
        />
      </label>

      {(drawing.tool === "rectangle" ||
        drawing.tool === "longPosition" ||
        drawing.tool === "shortPosition") && (
        <label className="object-setting-field">
          <span className="flex items-center justify-between">
            <span>Fill</span>
            <strong className="text-slate-300">{fillOpacity}%</strong>
          </span>
          <input
            max={60}
            min={0}
            onChange={(event) =>
              onChange({ fillOpacity: Number(event.target.value) / 100 })
            }
            step={1}
            type="range"
            value={fillOpacity}
          />
        </label>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          className={`control-button h-9 text-xs ${drawing.visible === false ? "" : "border-cyan-300/30 bg-cyan-300/10 text-cyan-100"}`}
          onClick={() => onChange({ visible: drawing.visible === false })}
          type="button"
        >
          {drawing.visible === false ? <EyeOff size={14} /> : <Eye size={14} />}
          {drawing.visible === false ? "Hidden" : "Visible"}
        </button>
        <button
          className={`control-button h-9 text-xs ${drawing.locked ? "border-amber-300/30 bg-amber-300/10 text-amber-100" : ""}`}
          onClick={() => onChange({ locked: !drawing.locked })}
          type="button"
        >
          {drawing.locked ? <LockKeyhole size={14} /> : <UnlockKeyhole size={14} />}
          {drawing.locked ? "Locked" : "Unlocked"}
        </button>
      </div>
    </div>
  );
}

function chartStyleLabel(style: ChartStyle, smoothCandles: boolean) {
  switch (style) {
    case "area":
      return "Area Chart";
    case "heikinAshi":
      return "Heikin Ashi";
    case "line":
      return "Line Chart";
    default:
      return smoothCandles ? "Smooth Candles" : "Candles";
  }
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
