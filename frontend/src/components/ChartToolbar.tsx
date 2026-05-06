import {
  Activity,
  AreaChart,
  CandlestickChart,
  ChevronDown,
  Command,
  Eye,
  EyeOff,
  Layers,
  LineChart,
  Save,
  Search,
  Settings2,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useEffect, useRef, useState } from "react";
import {
  TvCrosshairIcon,
  TvCursorIcon,
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
  INDICATORS,
  TIMEFRAMES,
  getTimeframeSeconds,
  indicatorDisplayName,
  type ChartIndicatorInstance,
  type ChartIndicatorKind,
  type ChartStyle,
  type ChartTimeframe,
  type DrawingTool,
  type IndicatorSettings,
} from "../lib/charting";
import { ThemedSelect } from "./ThemedSelect";

type Props = {
  chartStyle: ChartStyle;
  drawingTool: DrawingTool;
  drawingsCount: number;
  indicatorInstances: ChartIndicatorInstance[];
  layoutName: string;
  layoutNames: string[];
  onAddIndicator: (kind: ChartIndicatorKind) => void;
  onClearDrawings: () => void;
  onChartStyleChange: (style: ChartStyle) => void;
  onDeleteLayout: (name: string) => void;
  onDrawingToolChange: (tool: DrawingTool) => void;
  onLayoutNameChange: (name: string) => void;
  onLoadLayout: (name: string) => void;
  onSaveLayout: () => void;
  onTimeframeChange: (timeframe: ChartTimeframe) => void;
  onRemoveIndicator: (instanceId: string) => void;
  onToggleOrderOverlays: () => void;
  onSmoothCandlesChange: (value: boolean) => void;
  onUpdateIndicatorSettings: (
    instanceId: string,
    settings: Partial<IndicatorSettings>,
  ) => void;
  orderOverlaysVisible: boolean;
  savedLabel: string | null;
  smoothCandles: boolean;
  sourceTimeframe: ChartTimeframe | null;
  timeframe: ChartTimeframe;
};

const FALLBACK_SETTING: IndicatorSettings = {
  color: "#32d3ee",
  period: 20,
};

const DRAWING_TOOLS: Array<{
  icon: ChartToolIcon;
  label: string;
  shortcut?: string;
  tool: DrawingTool;
}> = [
  { icon: TvCursorIcon, label: "Cursor", tool: "cursor" },
  { icon: TvCrosshairIcon, label: "Crosshair", tool: "crosshair" },
  { icon: TvTrendLineIcon, label: "Trend", shortcut: "T", tool: "trendline" },
  { icon: TvHorizontalLineIcon, label: "H-Line", shortcut: "H", tool: "horizontal" },
  { icon: TvRectangleIcon, label: "Zone", shortcut: "R", tool: "rectangle" },
  { icon: TvFibIcon, label: "Fib", shortcut: "F", tool: "fib" },
  { icon: TvMeasureIcon, label: "Measure", shortcut: "M", tool: "measure" },
  { icon: TvLongPositionIcon, label: "Long", tool: "longPosition" },
  { icon: TvShortPositionIcon, label: "Short", tool: "shortPosition" },
  { icon: TvTextIcon, label: "Text", shortcut: "L", tool: "text" },
];

const CHART_STYLES: Array<{
  icon: LucideIcon;
  id: ChartStyle;
  label: string;
}> = [
  { icon: CandlestickChart, id: "candles", label: "Candles" },
  { icon: Activity, id: "heikinAshi", label: "Heikin Ashi" },
  { icon: LineChart, id: "line", label: "Line" },
  { icon: AreaChart, id: "area", label: "Area" },
];

export function ChartToolbar({
  chartStyle,
  drawingTool,
  drawingsCount,
  indicatorInstances,
  layoutName,
  layoutNames,
  onAddIndicator,
  onChartStyleChange,
  onClearDrawings,
  onDeleteLayout,
  onDrawingToolChange,
  onLayoutNameChange,
  onLoadLayout,
  onSaveLayout,
  onTimeframeChange,
  onRemoveIndicator,
  onToggleOrderOverlays,
  onSmoothCandlesChange,
  onUpdateIndicatorSettings,
  orderOverlaysVisible,
  savedLabel,
  sourceTimeframe,
  timeframe,
}: Props) {
  const [indicatorMenuOpen, setIndicatorMenuOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const commandRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);

  function selectChartStyle(style: ChartStyle) {
    onChartStyleChange(style);
    onSmoothCandlesChange(style === "heikinAshi");
  }

  useEffect(() => {
    function closeOnOutsideClick(event: globalThis.PointerEvent) {
      const target = event.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) {
        setIndicatorMenuOpen(false);
      }
      if (commandRef.current && !commandRef.current.contains(target)) {
        setCommandOpen(false);
      }
      if (settingsRef.current && !settingsRef.current.contains(target)) {
        setSettingsOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, []);

  function openCommandSearch(
    event?: ReactMouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>,
  ) {
    if ((event?.target as HTMLElement | undefined)?.closest(".chart-command-menu")) {
      return;
    }
    setCommandOpen(true);
    commandInputRef.current?.focus();
  }

  return (
    <section className="chart-studio-toolbar">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-md border border-cyan-300/25 bg-cyan-300/10 text-cyan-100">
              <SlidersHorizontal size={17} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white">Chart Workbench</div>
              <div className="truncate text-xs text-slate-500">
                {timeframe} / {chartStyleLabel(chartStyle)} / {indicatorInstances.length} studies / {drawingsCount} drawings
              </div>
            </div>
          </div>
        </div>

        <div
          ref={commandRef}
          className="chart-command-box"
          onClickCapture={openCommandSearch}
          onPointerDownCapture={openCommandSearch}
        >
          <Command size={15} className="text-cyan-200" />
          <input
            ref={commandInputRef}
            onChange={(event) => {
              setCommandQuery(event.target.value);
              setCommandOpen(true);
            }}
            onClick={() => setCommandOpen(true)}
            onFocus={() => setCommandOpen(true)}
            onPointerDown={() => setCommandOpen(true)}
            placeholder="Search tools, indicators, styles, intervals"
            value={commandQuery}
          />
          <Search size={14} className="text-slate-500" />
          {commandOpen && (
            <CommandMenu
              indicatorInstances={indicatorInstances}
              onChartStyleChange={selectChartStyle}
              onClose={() => {
                setCommandOpen(false);
                setCommandQuery("");
              }}
              onDrawingToolChange={onDrawingToolChange}
              onTimeframeChange={onTimeframeChange}
              onAddIndicator={onAddIndicator}
              query={commandQuery}
              sourceTimeframe={sourceTimeframe}
            />
          )}
        </div>

        <div className="timeframe-strip">
          {TIMEFRAMES.map((interval) => {
            const unavailable = !isTimeframeAvailable(interval.id, sourceTimeframe);
            const unavailableLabel = `${interval.label} data not available from ${sourceTimeframe} source`;
            return (
              <button
                aria-label={unavailable ? unavailableLabel : interval.label}
                className={`timeframe-button ${interval.id === timeframe ? "timeframe-button-active" : ""} ${unavailable ? "timeframe-button-unavailable" : ""}`}
                disabled={unavailable}
                key={interval.id}
                onClick={() => onTimeframeChange(interval.id)}
                title={unavailable ? unavailableLabel : interval.label}
                type="button"
              >
                <span>{interval.label}</span>
                {unavailable && <span className="timeframe-unavailable-label">N/A</span>}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            className="chart-mode-button"
            onClick={() => selectChartStyle("candles")}
            type="button"
          >
            <CandlestickChart size={15} />
            {chartStyleLabel(chartStyle)}
          </button>
          <button
            className={`chart-mode-button ${orderOverlaysVisible ? "chart-mode-active" : ""}`}
            onClick={onToggleOrderOverlays}
            type="button"
          >
            {orderOverlaysVisible ? <Eye size={16} /> : <EyeOff size={16} />}
            Overlays
          </button>
          <button
            className="chart-mode-button"
            onClick={onClearDrawings}
            disabled={drawingsCount === 0}
            type="button"
          >
            Clear {drawingsCount}
          </button>
          <button
            className="chart-mode-button chart-mode-primary"
            onClick={onSaveLayout}
            type="button"
          >
            <Save size={15} />
            {savedLabel ?? "Save Layout"}
          </button>
        </div>
      </div>

      <div className="chart-style-strip">
        {CHART_STYLES.map((style) => {
          const Icon = style.icon;
          return (
            <button
              className={`chart-style-button ${chartStyle === style.id ? "chart-style-button-active" : ""}`}
              key={style.id}
              onClick={() => {
                selectChartStyle(style.id);
              }}
              type="button"
            >
              <Icon size={14} />
              {style.label}
            </button>
          );
        })}
      </div>

      <div className="layout-manager-strip">
        <span className="study-manager-label">Layouts</span>
        <ThemedSelect
          ariaLabel="Saved layouts"
          className="h-8 w-44"
          onChange={onLoadLayout}
          options={
            layoutNames.length > 0
              ? [
                  { disabled: true, label: "Saved layouts", value: "" },
                  ...layoutNames.map((name) => ({ label: name, value: name })),
                ]
              : [{ disabled: true, label: "No saved layouts", value: "" }]
          }
          value={layoutNames.includes(layoutName) ? layoutName : ""}
        />
        <input
          className="input-control h-8 max-w-56 text-xs"
          onChange={(event) => onLayoutNameChange(event.target.value)}
          placeholder="Layout name"
          value={layoutName}
        />
        <button
          className="studio-tool-button studio-tool-button-active"
          onClick={onSaveLayout}
          type="button"
        >
          <Save size={13} />
          Save
        </button>
        <button
          className="studio-tool-button"
          disabled={layoutNames.length === 0 || !layoutNames.includes(layoutName)}
          onClick={() => onDeleteLayout(layoutName)}
          type="button"
        >
          <Trash2 size={13} />
          Delete
        </button>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="drawing-tool-strip" aria-label="Drawing tools">
          {DRAWING_TOOLS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={`studio-tool-button ${drawingTool === item.tool ? "studio-tool-button-active" : ""}`}
                key={item.tool}
                onClick={() => onDrawingToolChange(item.tool)}
                title={`${item.label}${item.shortcut ? ` (${item.shortcut})` : ""}`}
                type="button"
              >
                <Icon size={15} />
                <span>{item.label}</span>
              </button>
            );
          })}
          <button
            className="studio-tool-button"
            disabled={drawingsCount === 0}
            onClick={onClearDrawings}
            title="Clear all drawings"
            type="button"
          >
            <Trash2 size={14} />
            <span>{drawingsCount}</span>
          </button>
        </div>

        <div ref={menuRef} className="relative">
          <button
            className="chart-dropdown-trigger"
            onClick={() => {
              setIndicatorMenuOpen((value) => !value);
              setSettingsOpen(false);
            }}
            type="button"
          >
            <Layers size={15} />
            Indicators
            <ChevronDown size={14} />
          </button>
          {indicatorMenuOpen && (
            <div className="chart-dropdown-panel left-0 w-72">
              {INDICATORS.map((indicator) => {
                const count = indicatorInstances.filter(
                  (instance) => instance.kind === indicator.kind,
                ).length;
                return (
                  <button
                    className={`chart-dropdown-row ${count > 0 ? "chart-dropdown-row-active" : ""}`}
                    key={indicator.id}
                    onClick={() => onAddIndicator(indicator.kind)}
                    type="button"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: indicator.color }}
                    />
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-sm font-semibold text-slate-100">
                        {indicator.label}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {indicator.description}
                      </span>
                    </span>
                    <span className={count > 0 ? "text-cyan-100" : "text-slate-500"}>
                      {count > 0 ? `Add ${count + 1}` : "Add"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div ref={settingsRef} className="relative">
          <button
            className="chart-dropdown-trigger"
            disabled={indicatorInstances.length === 0}
            onClick={() => {
              setSettingsOpen((value) => !value);
              setIndicatorMenuOpen(false);
            }}
            type="button"
          >
            <Settings2 size={15} />
            Settings
            {indicatorInstances.length > 0 && (
              <span className="rounded bg-cyan-300/15 px-1.5 py-0.5 text-[10px] text-cyan-100">
                {indicatorInstances.length}
              </span>
            )}
          </button>
          {settingsOpen && (
            <div className="chart-dropdown-panel left-0 w-[360px]">
              {indicatorInstances.map((indicator) => (
                <IndicatorEditor
                  indicator={indicator}
                  key={indicator.id}
                  onRemove={() => onRemoveIndicator(indicator.id)}
                  onUpdate={(settings) => onUpdateIndicatorSettings(indicator.id, settings)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {indicatorInstances.map((indicator) => {
            const settings = indicator.settings ?? FALLBACK_SETTING;
            return (
              <button
                className="indicator-chip indicator-chip-active"
                key={indicator.id}
                onClick={() => onRemoveIndicator(indicator.id)}
                type="button"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: settings.color }}
                />
                {indicatorDisplayName(indicator)}
                <X size={12} />
              </button>
            );
          })}
        </div>
      </div>

      {indicatorInstances.length > 0 && (
        <div className="study-manager-strip">
          <span className="study-manager-label">Active studies</span>
          {indicatorInstances.map((indicator) => {
            const settings = indicator.settings ?? FALLBACK_SETTING;
            const isMacd = indicator.kind === "macd";
            return (
              <div className="study-chip" key={indicator.id}>
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: settings.color }}
                />
                <span className="min-w-0 font-semibold">
                  {indicatorDisplayName(indicator)}
                </span>
                {isMacd ? (
                  <>
                    <NumberPill
                      label="F"
                      onChange={(value) => onUpdateIndicatorSettings(indicator.id, { fastPeriod: value })}
                      value={settings.fastPeriod ?? 12}
                    />
                    <NumberPill
                      label="S"
                      onChange={(value) => onUpdateIndicatorSettings(indicator.id, { slowPeriod: value })}
                      value={settings.slowPeriod ?? 26}
                    />
                    <NumberPill
                      label="Sig"
                      onChange={(value) => onUpdateIndicatorSettings(indicator.id, { signalPeriod: value })}
                      value={settings.signalPeriod ?? 9}
                    />
                  </>
                ) : indicator.kind !== "vwap" ? (
                  <NumberPill
                    label="Len"
                    onChange={(value) => onUpdateIndicatorSettings(indicator.id, { period: value })}
                    value={settings.period}
                  />
                ) : (
                  <span className="rounded bg-white/5 px-2 py-1 text-[10px] text-slate-500">
                    Session
                  </span>
                )}
                <input
                  className="h-6 w-7 cursor-pointer rounded border border-white/10 bg-ink-950 p-0.5"
                  onChange={(event) =>
                    onUpdateIndicatorSettings(indicator.id, { color: event.target.value })
                  }
                  title="Study color"
                  type="color"
                  value={settings.color}
                />
                <button
                  className="grid h-6 w-6 place-items-center rounded hover:bg-white/10 hover:text-white"
                  onClick={() => onRemoveIndicator(indicator.id)}
                  title="Remove study"
                  type="button"
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function NumberPill({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label className="study-number-pill">
      <span>{label}</span>
      <input
        min={1}
        onChange={(event) => onChange(clampInteger(event.target.value, 1, 500))}
        type="number"
        value={value}
      />
    </label>
  );
}

function CommandMenu({
  indicatorInstances,
  onChartStyleChange,
  onClose,
  onDrawingToolChange,
  onTimeframeChange,
  onAddIndicator,
  query,
  sourceTimeframe,
}: {
  indicatorInstances: ChartIndicatorInstance[];
  onChartStyleChange: (style: ChartStyle) => void;
  onClose: () => void;
  onDrawingToolChange: (tool: DrawingTool) => void;
  onTimeframeChange: (timeframe: ChartTimeframe) => void;
  onAddIndicator: (kind: ChartIndicatorKind) => void;
  query: string;
  sourceTimeframe: ChartTimeframe | null;
}) {
  const normalized = query.trim().toLowerCase();
  const commands: Array<{
    description: string;
    disabled?: boolean;
    icon: ChartToolIcon | LucideIcon;
    id: string;
    label: string;
    run: () => void;
    type: string;
  }> = [
    ...INDICATORS.map((indicator) => ({
      description:
        indicatorInstances.some((instance) => instance.kind === indicator.kind)
          ? "Add another configurable instance"
          : indicator.description,
      icon: Layers,
      id: `indicator-${indicator.id}`,
      label: indicator.label,
      run: () => onAddIndicator(indicator.kind),
      type: "Study",
    })),
    ...DRAWING_TOOLS.map((tool) => ({
      description: tool.shortcut ? `Shortcut ${tool.shortcut}` : "Drawing tool",
      icon: tool.icon,
      id: `drawing-${tool.tool}`,
      label: tool.label,
      run: () => onDrawingToolChange(tool.tool),
      type: "Drawing",
    })),
    ...TIMEFRAMES.map((interval) => {
      const unavailable = !isTimeframeAvailable(interval.id, sourceTimeframe);
      return {
        description: unavailable
          ? `Data not available from ${sourceTimeframe} source`
          : `${interval.seconds}s interval`,
        disabled: unavailable,
        icon: Command,
        id: `timeframe-${interval.id}`,
        label: interval.label,
        run: () => onTimeframeChange(interval.id),
        type: "Interval",
      };
    }),
    ...CHART_STYLES.map((style) => ({
      description: "Chart style",
      icon: style.icon,
      id: `style-${style.id}`,
      label: style.label,
      run: () => onChartStyleChange(style.id),
      type: "Style",
    })),
  ];
  const visibleCommands = commands
    .filter((command) =>
      normalized
        ? `${command.label} ${command.description} ${command.type}`
            .toLowerCase()
            .includes(normalized)
        : true,
    )
    .slice(0, 12);

  return (
    <div className="chart-command-menu">
      <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
        Command Search
      </div>
      {visibleCommands.map((command) => {
        const Icon = command.icon;
        return (
          <button
            className={`chart-command-row ${command.disabled ? "chart-command-row-disabled" : ""}`}
            disabled={command.disabled}
            key={command.id}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (command.disabled) {
                return;
              }
              command.run();
              onClose();
            }}
            type="button"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-white/10 bg-white/5 text-cyan-100">
              <Icon size={15} />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm font-semibold text-white">
                {command.label}
              </span>
              <span className="block truncate text-xs text-slate-500">
                {command.type} · {command.description}
              </span>
            </span>
          </button>
        );
      })}
      {visibleCommands.length === 0 && (
        <div className="px-3 py-6 text-center text-sm text-slate-500">
          No matching command
        </div>
      )}
    </div>
  );
}

function isTimeframeAvailable(
  timeframe: ChartTimeframe,
  sourceTimeframe: ChartTimeframe | null,
) {
  return (
    sourceTimeframe == null ||
    getTimeframeSeconds(timeframe) >= getTimeframeSeconds(sourceTimeframe)
  );
}

function IndicatorEditor({
  indicator,
  onRemove,
  onUpdate,
}: {
  indicator: ChartIndicatorInstance;
  onRemove: () => void;
  onUpdate: (settings: Partial<IndicatorSettings>) => void;
}) {
  const definition = INDICATORS.find((item) => item.kind === indicator.kind);
  const settings = indicator.settings ?? FALLBACK_SETTING;
  const isMacd = indicator.kind === "macd";
  const supportsPeriod = indicator.kind !== "vwap" && !isMacd;
  const supportsDeviation =
    indicator.kind === "bb" ||
    indicator.kind === "keltner" ||
    indicator.kind === "supertrend";

  return (
    <div className="rounded-md border border-white/10 bg-black/20 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">
            {indicatorDisplayName(indicator)}
          </div>
          <div className="truncate text-xs text-slate-500">
            {definition?.description ?? "Custom indicator"}
          </div>
        </div>
        <button
          className="icon-button h-8 w-8"
          onClick={onRemove}
          title="Remove indicator"
          type="button"
        >
          <X size={14} />
        </button>
      </div>
      <div className={isMacd ? "grid grid-cols-3 gap-2" : "grid grid-cols-[1fr_92px] gap-2"}>
        {isMacd && (
          <>
            <label className="form-field">
              <span>Fast</span>
              <input
                className="input-control h-9"
                min={1}
                onChange={(event) =>
                  onUpdate({ fastPeriod: clampInteger(event.target.value, 1, 100) })
                }
                type="number"
                value={settings.fastPeriod ?? 12}
              />
            </label>
            <label className="form-field">
              <span>Slow</span>
              <input
                className="input-control h-9"
                min={2}
                onChange={(event) =>
                  onUpdate({ slowPeriod: clampInteger(event.target.value, 2, 200) })
                }
                type="number"
                value={settings.slowPeriod ?? 26}
              />
            </label>
            <label className="form-field">
              <span>Signal</span>
              <input
                className="input-control h-9"
                min={1}
                onChange={(event) =>
                  onUpdate({ signalPeriod: clampInteger(event.target.value, 1, 100) })
                }
                type="number"
                value={settings.signalPeriod ?? 9}
              />
            </label>
          </>
        )}
        {supportsPeriod && (
          <label className="form-field">
            <span>Period</span>
            <input
              className="input-control h-9"
              min={2}
              onChange={(event) =>
                onUpdate({ period: clampInteger(event.target.value, 2, 500) })
              }
              type="number"
              value={settings.period}
            />
          </label>
        )}
        {supportsDeviation && (
          <label className="form-field">
            <span>{indicator.kind === "bb" ? "Std Dev" : "Multiplier"}</span>
            <input
              className="input-control h-9"
              min={0.5}
              onChange={(event) => onUpdate({ stdDev: Number(event.target.value) })}
              step={0.1}
              type="number"
              value={settings.stdDev ?? 2}
            />
          </label>
        )}
        <label className="form-field">
          <span>Color</span>
          <input
            className="h-9 w-full cursor-pointer rounded-md border border-white/10 bg-ink-950 p-1"
            onChange={(event) => onUpdate({ color: event.target.value })}
            type="color"
            value={settings.color}
          />
        </label>
      </div>
    </div>
  );
}

function clampInteger(value: string, min: number, max: number) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return min;
  }
  return Math.min(max, Math.max(min, parsed));
}

function chartStyleLabel(style: ChartStyle) {
  switch (style) {
    case "area":
      return "Area";
    case "heikinAshi":
      return "Heikin";
    case "line":
      return "Line";
    default:
      return "Candles";
  }
}
