import { usePineInputMetadata } from "../lib/usePineInputMetadata";
import { useId, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  CandlestickChart,
  Eye,
  EyeOff,
  Layers,
  LockKeyhole,
  PanelRightClose,
  Settings2,
  Trash2,
  GripVertical,
  UnlockKeyhole,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  TvCursorIcon,
  TvFibIcon,
  TvHorizontalLineIcon,
  TvLongPositionIcon,
  TvMeasureIcon,
  TvRectangleIcon,
  TvShortPositionIcon,
  TvTextIcon,
  TvTrendLineIcon,
  TvVerticalLineIcon,
  type ChartToolIcon,
} from "./ChartToolIcons";
import {
  type ChartDrawing,
  indicatorDisplayName,
  type ChartIndicatorInstance,
  type ChartStyle,
  type DrawingLineStyle,
  type IndicatorSettings,
  mergeIndicatorSettings,
} from "../lib/charting";
import { formatPrice } from "../lib/format";
import { isPineScriptSource, sanitizePinePrepared } from "../lib/customIndicators";
import { pineSourceVersion } from "../lib/pineProtocol";
import { PineInputControl } from "./PineInputControl";
import { ThemedColorPicker } from "./ThemedColorPicker";
import { ThemedSelect } from "./ThemedSelect";
import { DockedWorkspacePanel } from "./ui/WorkspacePanelManager";
import { useRestorableSurfaceState, type RestorableStateSchema } from "../lib/useRestorableSurfaceState";

const DEFAULT_LABEL_BACKGROUND_OPACITY = 0.92;
const OBJECTS_PANEL_SIZE_SCHEMA: RestorableStateSchema<number> = { version: 1, validate: (value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 280 && value <= 720 };

type Props = {
  chartStyle: ChartStyle;
  drawings: ChartDrawing[];
  indicatorInstances: ChartIndicatorInstance[];
  onClearDrawings: () => void;
  onCollapse: () => void;
  onDeleteDrawing: (drawingId: string) => void;
  onMoveDrawingLayer?: (drawingId: string, action: "back" | "backward" | "forward" | "front") => void;
  onReorderDrawing?: (sourceId: string, targetId: string) => void;
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
  fibExtension: TvFibIcon,
  fibChannel: TvFibIcon,
  fibTime: TvFibIcon,
  fibFan: TvFibIcon,
  horizontal: TvHorizontalLineIcon,
  horizontalRay: TvHorizontalLineIcon,
  vertical: TvVerticalLineIcon,
  longPosition: TvLongPositionIcon,
  measure: TvMeasureIcon,
  quickMeasure: TvMeasureIcon,
  eraser: TvCursorIcon,
  rectangle: TvRectangleIcon,
  ellipse: TvRectangleIcon,
  triangle: TvRectangleIcon,
  shortPosition: TvShortPositionIcon,
  text: TvTextIcon,
  callout: TvTextIcon,
  flag: TvTextIcon,
  icon: TvTextIcon,
  trendline: TvTrendLineIcon,
  ray: TvTrendLineIcon,
  extendedLine: TvTrendLineIcon,
  segment: TvTrendLineIcon,
  angle: TvTrendLineIcon,
  parallelChannel: TvTrendLineIcon,
  chartPattern: TvTrendLineIcon,
  elliottWave: TvTrendLineIcon,
  harmonicPattern: TvTrendLineIcon,
  brush: TvTrendLineIcon,
  arrow: TvTrendLineIcon,
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
  onMoveDrawingLayer,
  onReorderDrawing,
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
  const [panelWidth, setPanelWidth] = useRestorableSurfaceState("chart:objects", "viewport", 280, OBJECTS_PANEL_SIZE_SCHEMA);

  return (
    <DockedWorkspacePanel label="Chart objects" onSizeChange={setPanelWidth} size={panelWidth}>
    <div className="chart-side-panel border-0 shadow-none">
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
              aria-label="Collapse chart objects"
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
              aria-label={orderOverlaysVisible ? "Hide order overlays" : "Show order overlays"}
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
            {indicatorInstances.map((indicator) => (
              <IndicatorObjectRow
                indicator={indicator}
                key={indicator.id}
                onRemove={() => onRemoveIndicator(indicator.id)}
                onToggleVisibility={() => onToggleIndicatorVisibility(indicator.id)}
                onUpdate={(settingsPatch) => onUpdateIndicatorSettings(indicator.id, settingsPatch)}
              />
            ))}
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Drawings
            </span>
            <button
              aria-label={unlockedDrawingsCount === 0 && drawings.length > 0 ? "Unlock drawings before clearing" : "Clear unlocked drawings"}
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
                  draggable={!drawing.locked && Boolean(onReorderDrawing)}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("application/x-edgelab-drawing", drawing.id);
                  }}
                  onDragOver={(event) => {
                    if (onReorderDrawing) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const sourceId = event.dataTransfer.getData("application/x-edgelab-drawing");
                    if (sourceId && sourceId !== drawing.id) onReorderDrawing?.(sourceId, drawing.id);
                  }}
                  onClick={() => onSelectDrawing(drawing.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectDrawing(drawing.id);
                    }
                  }}
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
                        ? drawing.tool === "vertical"
                          ? formatDrawingTime(drawing.points[0].time)
                          : formatPrice(drawing.points[0].price)
                        : `${drawing.points.length} anchors`}
                    </span>
                  </span>
                  <div className="drawing-row-actions">
                    {onReorderDrawing ? <GripVertical aria-hidden="true" size={13} /> : null}
                    {drawing.visible === false ? <EyeOff size={13} /> : <Eye size={13} />}
                    {drawing.locked ? <LockKeyhole size={13} /> : null}
                    {onMoveDrawingLayer && !drawing.locked ? (
                      <span className="flex items-center gap-0.5" role="group" aria-label={`Layer order for ${drawing.label || drawing.tool}`}>
                        {([
                          ["back", ArrowDownToLine, "Send to back"],
                          ["backward", ArrowDown, "Move backward"],
                          ["forward", ArrowUp, "Move forward"],
                          ["front", ArrowUpToLine, "Bring to front"],
                        ] as const).map(([action, ActionIcon, label]) => (
                          <button
                            aria-label={`${label}: ${drawing.label || drawing.tool}`}
                            className="grid h-6 w-6 place-items-center rounded text-slate-400 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-300"
                            key={action}
                            onClick={(event) => {
                              event.stopPropagation();
                              onMoveDrawingLayer(drawing.id, action);
                            }}
                            type="button"
                          >
                            <ActionIcon size={11} />
                          </button>
                        ))}
                      </span>
                    ) : null}
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
    </div>
    </DockedWorkspacePanel>
  );
}

function formatDrawingTime(time: number) {
  return new Date(time * 1000).toLocaleString([], {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "2-digit",
  });
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

function IndicatorObjectRow({ indicator, onRemove, onToggleVisibility, onUpdate }: {
  indicator: ChartIndicatorInstance;
  onRemove: () => void;
  onToggleVisibility: () => void;
  onUpdate: (settings: Partial<IndicatorSettings>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const disclosureId = useId();
  const name = indicatorDisplayName(indicator);
  const settings = mergeIndicatorSettings(indicator.kind, indicator.settings ?? FALLBACK_SETTING);
  const native = indicator.kind === "custom" && isPineScriptSource(indicator.customScriptSource ?? "");
  const prepared = native ? sanitizePinePrepared(indicator.customPinePrepared, indicator.customScriptSource!) : undefined;
  let pineVersion: number | undefined = prepared?.pineVersion;
  if (native && pineVersion === undefined) {
    try { pineVersion = pineSourceVersion(indicator.customScriptSource!); } catch { /* Unsupported source remains identified as native Pine. */ }
  }
  const caption = indicator.kind === "custom"
    ? indicator.runtimeError ? `Runtime error · ${indicator.runtimeError}`
      : `${native ? `Native Pine${pineVersion ? ` v${pineVersion}` : ""}` : "EdgeLab DSL"} · revision ${indicator.customScriptVersion ?? 1}`
    : indicator.kind === "macd" ? `${settings.fastPeriod ?? 12}/${settings.slowPeriod ?? 26}/${settings.signalPeriod ?? 9}`
    : indicator.kind === "fvg" || indicator.kind === "ifvg" ? settings.unmitigatedOnly === true ? "Unmitigated only" : "All visible gaps"
    : indicator.kind === "vwap" ? "Session fair value"
    : `Period ${settings.period}${indicator.kind === "bb" ? ` / ${settings.stdDev ?? 2}σ` : ""}`;
  const visible = indicator.visible !== false;
  const close = () => { setExpanded(false); trigger.current?.focus({ preventScroll: true }); };
  const remove = () => {
    const row = trigger.current?.closest(".indicator-object-row");
    if (row?.contains(document.activeElement)) {
      const panel = row.closest(".chart-side-panel");
      const triggers = Array.from(panel?.querySelectorAll<HTMLButtonElement>("[data-indicator-settings-trigger]") ?? []);
      const index = triggers.indexOf(trigger.current!);
      const fallback = triggers[index + 1] ?? triggers[index - 1] ?? panel?.querySelector<HTMLButtonElement>('[aria-label="Collapse chart objects"]');
      fallback?.focus({ preventScroll: true });
    }
    onRemove();
  };
  return <div className={`chart-object-row indicator-object-row text-left ${visible ? "chart-object-row-active" : ""}`}>
    <div className="indicator-object-header">
      <span aria-hidden="true" className="object-symbol-cell" style={{ color: settings.color }}>
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: settings.color }} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="indicator-object-name block text-sm font-semibold leading-5 text-slate-100">{name}</span>
        {indicator.kind !== "custom" ? <span className="block truncate text-xs text-slate-400" title={caption}>{caption}</span> : null}
      </span>
      <button aria-label={`${visible ? "On: Hide" : "Off: Show"} ${name}`} className={`indicator-object-action ${visible ? "text-cyan-100" : "text-slate-300"}`} onClick={onToggleVisibility} title={`${visible ? "Hide" : "Show"} ${name}`} type="button">{visible ? "On" : "Off"}</button>
      <button data-indicator-settings-trigger="true" aria-controls={disclosureId} aria-expanded={expanded} aria-label={`Settings for ${name}`} className="indicator-object-action text-slate-300" onClick={() => setExpanded(!expanded)} ref={trigger} title={`Settings for ${name}`} type="button"><Settings2 aria-hidden="true" size={16} /></button>
    </div>
    {indicator.kind === "custom" ? <p className="indicator-object-caption mt-1 min-w-0 text-xs leading-5 text-slate-300">{caption}</p> : null}
    <div className="indicator-object-settings" hidden={!expanded} id={disclosureId} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 text-xs font-semibold text-slate-200">Study settings</span>
        <button aria-label={`Close settings for ${name}`} className="indicator-object-action text-slate-300" onClick={close} type="button"><X aria-hidden="true" size={16} /></button>
      </div>
      <IndicatorSettingsControls indicator={indicator} onRemove={remove} onUpdate={onUpdate} />
    </div>
  </div>;
}

function IndicatorSettingsControls({
  indicator,
  onRemove,
  onUpdate,
}: {
  indicator: ChartIndicatorInstance;
  onRemove: () => void;
  onUpdate: (settings: Partial<IndicatorSettings>) => void;
}) {
  const settings = indicator.settings ?? FALLBACK_SETTING;
  const isMacd = indicator.kind === "macd";
  const isGapStudy = indicator.kind === "fvg" || indicator.kind === "ifvg";
  const isVwap = indicator.kind === "vwap";
  const native = indicator.kind === "custom" && isPineScriptSource(indicator.customScriptSource ?? "");
  const prepared = usePineInputMetadata(native ? indicator.customScriptSource : undefined, native ? sanitizePinePrepared(indicator.customPinePrepared, indicator.customScriptSource!) : undefined);

  return (
    <div
      className="grid min-w-0 gap-3"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      aria-label={`Settings for ${indicatorDisplayName(indicator)}`}
      role="group"
    >
      {native ? <div className="grid min-w-0 gap-3">
        {prepared?.inputDefinitions.map((definition) => <PineInputControl key={definition.id} definitions={prepared.inputDefinitions} inputs={settings.customInputs} definition={definition} value={settings.customInputs?.[definition.id]} onChange={(value) => onUpdate({ customInputs: { ...settings.customInputs, [definition.id]: value } })} />)}
        {!prepared ? <p className="text-xs leading-5 text-slate-300">Check and save this Pine script in the editor to configure its inputs.</p> : !prepared.inputDefinitions.length ? <p className="text-xs leading-5 text-slate-300">No configurable Pine inputs.</p> : null}
      </div> : (
        <>
          <label className="object-setting-field">
            <span>{isGapStudy ? "Bullish" : "Color"}</span>
            <ThemedColorPicker
              ariaLabel="Indicator color"
              compact
              onChange={(color) => onUpdate({ color })}
              value={settings.color}
            />
          </label>

          {isGapStudy && (
            <label className="object-setting-field">
              <span>Bearish</span>
              <ThemedColorPicker
                ariaLabel="Opposite indicator color"
                compact
                onChange={(secondaryColor) => onUpdate({ secondaryColor, signalColor: secondaryColor })}
                value={settings.secondaryColor ?? settings.signalColor ?? "#f43f5e"}
              />
            </label>
          )}

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
          ) : !isGapStudy && !isVwap ? (
            <NumberSetting
              label="Period"
              onChange={(value) => onUpdate({ period: value })}
              value={settings.period}
            />
          ) : null}

        </>
      )}
      <button aria-label={`Remove ${indicatorDisplayName(indicator)}`} className="control-button min-h-11 border-rose-300/30 bg-rose-300/10 text-xs text-rose-100" onClick={onRemove} type="button">
        <Trash2 aria-hidden="true" size={14} />
        Remove
      </button>
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
    case "footprint":
      return "Footprint";
    case "line":
      return "Line Chart";
    case "tpo":
      return "TPO Profile";
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
