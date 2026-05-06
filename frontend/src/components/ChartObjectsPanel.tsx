import {
  Activity,
  CandlestickChart,
  Eye,
  EyeOff,
  Layers,
  LockKeyhole,
  PanelRightClose,
  Trash2,
  UnlockKeyhole,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  TvFibIcon,
  TvHorizontalLineIcon,
  TvLongPositionIcon,
  TvMeasureIcon,
  TvRectangleIcon,
  TvShortPositionIcon,
  TvTextIcon,
  TvTrendLineIcon,
  type ChartToolIcon,
} from "./ChartToolIcons";
import {
  type ChartDrawing,
  indicatorDisplayName,
  type ChartIndicatorInstance,
  type ChartStyle,
  type DrawingLineStyle,
  type IndicatorSettings,
} from "../lib/charting";
import { formatPrice } from "../lib/format";
import { ThemedColorPicker } from "./ThemedColorPicker";
import { ThemedSelect } from "./ThemedSelect";

const DEFAULT_LABEL_BACKGROUND_OPACITY = 0.92;

type Props = {
  chartStyle: ChartStyle;
  drawings: ChartDrawing[];
  indicatorInstances: ChartIndicatorInstance[];
  onClearDrawings: () => void;
  onCollapse: () => void;
  onDeleteDrawing: (drawingId: string) => void;
  onRemoveIndicator: (instanceId: string) => void;
  onSelectDrawing: (drawingId: string | null) => void;
  onToggleIndicatorVisibility: (instanceId: string) => void;
  onToggleOrderOverlays: () => void;
  onUpdateDrawing: (drawing: ChartDrawing) => void;
  onUpdateIndicatorSettings: (
    instanceId: string,
    settings: Partial<IndicatorSettings>,
  ) => void;
  orderOverlaysVisible: boolean;
  selectedDrawingId: string | null;
  smoothCandles: boolean;
};

const drawingIcons: Record<ChartDrawing["tool"], ChartToolIcon> = {
  fib: TvFibIcon,
  horizontal: TvHorizontalLineIcon,
  longPosition: TvLongPositionIcon,
  measure: TvMeasureIcon,
  rectangle: TvRectangleIcon,
  shortPosition: TvShortPositionIcon,
  text: TvTextIcon,
  trendline: TvTrendLineIcon,
};

const FALLBACK_SETTING: IndicatorSettings = {
  color: "#32d3ee",
  period: 20,
};

export function ChartObjectsPanel({
  chartStyle,
  drawings,
  indicatorInstances,
  onClearDrawings,
  onCollapse,
  onDeleteDrawing,
  onRemoveIndicator,
  onSelectDrawing,
  onToggleIndicatorVisibility,
  onToggleOrderOverlays,
  onUpdateDrawing,
  onUpdateIndicatorSettings,
  orderOverlaysVisible,
  selectedDrawingId,
  smoothCandles,
}: Props) {
  const unlockedDrawingsCount = drawings.filter((drawing) => !drawing.locked).length;

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
          <div className="flex items-center gap-2">
            <Layers size={18} className="text-cyan-200" />
            <button
              className="icon-button h-8 w-8"
              onClick={onCollapse}
              title="Collapse layers"
              type="button"
            >
              <PanelRightClose size={14} />
            </button>
          </div>
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
            {indicatorInstances.length === 0 && (
              <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-4 text-center text-xs text-slate-500">
                No active studies.
              </div>
            )}
            {indicatorInstances.map((indicator) => {
              const settings = indicator.settings ?? FALLBACK_SETTING;
              return (
                <div
                  className={`chart-object-row object-row-with-hover text-left ${indicator.visible === false ? "opacity-55" : "chart-object-row-active"}`}
                  key={indicator.id}
                >
                  <span
                    className="object-symbol-cell"
                    style={{ color: settings.color }}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: settings.color }}
                    />
                    <IndicatorHoverControls
                      indicator={indicator}
                      onRemove={() => onRemoveIndicator(indicator.id)}
                      onToggleVisibility={() => onToggleIndicatorVisibility(indicator.id)}
                      onUpdate={(settingsPatch) =>
                        onUpdateIndicatorSettings(indicator.id, settingsPatch)
                      }
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-100">
                      {indicatorDisplayName(indicator)}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {indicator.kind === "macd"
                        ? `${settings.fastPeriod ?? 12}/${settings.slowPeriod ?? 26}/${settings.signalPeriod ?? 9}`
                        : indicator.kind === "vwap"
                        ? "Session fair value"
                        : `Period ${settings.period}${indicator.kind === "bb" ? ` / ${settings.stdDev ?? 2}σ` : ""}`}
                    </span>
                  </span>
                  <button
                    className={`rounded px-1.5 py-1 ${indicator.visible === false ? "text-slate-500" : "text-cyan-100"}`}
                    onClick={() => onToggleIndicatorVisibility(indicator.id)}
                    type="button"
                  >
                    {indicator.visible === false ? "Off" : "On"}
                  </button>
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
              disabled={unlockedDrawingsCount === 0}
              onClick={onClearDrawings}
              title={
                unlockedDrawingsCount === 0 && drawings.length > 0
                  ? "Unlock drawings to clear them"
                  : "Clear unlocked drawings"
              }
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
                  className={`chart-object-row drawing-object-row object-row-with-hover ${drawing.visible === false ? "opacity-55" : ""} ${selectedDrawingId === drawing.id ? "chart-object-row-selected" : ""}`}
                  key={drawing.id}
                  onClick={() => onSelectDrawing(drawing.id)}
                  role="button"
                  tabIndex={0}
                >
                  <span
                    className="drawing-symbol-cell"
                    style={{ color: drawing.color }}
                  >
                    <Icon size={15} />
                    <DrawingHoverControls
                      drawing={drawing}
                      onChange={(patch) => onUpdateDrawing({ ...drawing, ...patch })}
                      onDelete={() => {
                        onDeleteDrawing(drawing.id);
                        onSelectDrawing(null);
                      }}
                    />
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
                  <div className="drawing-row-actions">
                    {drawing.visible === false ? <EyeOff size={13} /> : <Eye size={13} />}
                    {drawing.locked ? <LockKeyhole size={13} /> : null}
                  </div>
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

function DrawingHoverControls({
  drawing,
  onChange,
  onDelete,
}: {
  drawing: ChartDrawing;
  onChange: (patch: Partial<ChartDrawing>) => void;
  onDelete: () => void;
}) {
  const fillOpacity = Math.round((drawing.fillOpacity ?? 0.16) * 100);
  const labelBackgroundOpacity = Math.round(
    (drawing.labelBackgroundOpacity ?? DEFAULT_LABEL_BACKGROUND_OPACITY) * 100,
  );
  const lineStyle = drawing.lineStyle ?? "solid";
  const lineWidth = drawing.lineWidth ?? 2;
  const canDelete = !drawing.locked;
  const hasRenderedLabel = drawing.tool === "text" || Boolean(drawing.label?.trim());

  return (
    <div
      className="drawing-hover-options"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      role="group"
    >
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
          <ThemedColorPicker
            ariaLabel="Drawing color"
            compact
            onChange={(color) => onChange({ color })}
            value={drawing.color}
          />
        </label>
        <label className="object-setting-field">
          <span>Line</span>
          <ThemedSelect
            ariaLabel="Drawing line style"
            className="h-9"
            onChange={(value) => onChange({ lineStyle: value as DrawingLineStyle })}
            options={[
              { label: "Solid", value: "solid" },
              { label: "Dashed", value: "dashed" },
              { label: "Dotted", value: "dotted" },
            ]}
            value={lineStyle}
          />
        </label>
      </div>

      <label className="object-setting-field">
        <span className="flex items-center justify-between">
          <span>Width</span>
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

      {hasRenderedLabel && (
        <label className="object-setting-field">
          <span className="flex items-center justify-between">
            <span>Label BG</span>
            <strong className="text-slate-300">{labelBackgroundOpacity}%</strong>
          </span>
          <input
            max={100}
            min={0}
            onChange={(event) =>
              onChange({ labelBackgroundOpacity: Number(event.target.value) / 100 })
            }
            step={1}
            type="range"
            value={labelBackgroundOpacity}
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
      <button
        className="control-button h-9 border-rose-300/30 bg-rose-300/10 text-xs text-rose-100"
        disabled={!canDelete}
        onClick={() => {
          if (canDelete) {
            onDelete();
          }
        }}
        title={canDelete ? "Delete drawing" : "Unlock drawing to delete"}
        type="button"
      >
        <X size={14} />
        Delete
      </button>
    </div>
  );
}

function IndicatorHoverControls({
  indicator,
  onRemove,
  onToggleVisibility,
  onUpdate,
}: {
  indicator: ChartIndicatorInstance;
  onRemove: () => void;
  onToggleVisibility: () => void;
  onUpdate: (settings: Partial<IndicatorSettings>) => void;
}) {
  const settings = indicator.settings ?? FALLBACK_SETTING;
  const isMacd = indicator.kind === "macd";
  const isVwap = indicator.kind === "vwap";
  const isVisible = indicator.visible !== false;

  return (
    <div
      className="drawing-hover-options"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      role="group"
    >
      <button
        className={`control-button h-9 text-xs ${isVisible ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100" : ""}`}
        onClick={onToggleVisibility}
        type="button"
      >
        {isVisible ? <Eye size={14} /> : <EyeOff size={14} />}
        {isVisible ? "Visible" : "Hidden"}
      </button>

      {isVisible && (
        <>
          <label className="object-setting-field">
            <span>Color</span>
            <ThemedColorPicker
              ariaLabel="Indicator color"
              compact
              onChange={(color) => onUpdate({ color })}
              value={settings.color}
            />
          </label>

          {isMacd ? (
            <div className="grid grid-cols-3 gap-2">
              <NumberSetting
                label="Fast"
                onChange={(value) => onUpdate({ fastPeriod: value })}
                value={settings.fastPeriod ?? 12}
              />
              <NumberSetting
                label="Slow"
                onChange={(value) => onUpdate({ slowPeriod: value })}
                value={settings.slowPeriod ?? 26}
              />
              <NumberSetting
                label="Sig"
                onChange={(value) => onUpdate({ signalPeriod: value })}
                value={settings.signalPeriod ?? 9}
              />
            </div>
          ) : !isVwap ? (
            <NumberSetting
              label="Period"
              onChange={(value) => onUpdate({ period: value })}
              value={settings.period}
            />
          ) : null}

          <button
            className="control-button h-9 border-rose-300/30 bg-rose-300/10 text-xs text-rose-100"
            onClick={onRemove}
            type="button"
          >
            <Trash2 size={14} />
            Remove
          </button>
        </>
      )}
    </div>
  );
}

function NumberSetting({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label className="object-setting-field">
      <span>{label}</span>
      <input
        className="input-control h-9"
        min={1}
        onChange={(event) => onChange(Math.max(1, Number(event.target.value) || 1))}
        type="number"
        value={value}
      />
    </label>
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
