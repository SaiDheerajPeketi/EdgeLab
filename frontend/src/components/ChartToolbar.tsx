import {
  BarChart2,
  CandlestickChart,
  ChevronDown,
  Eye,
  EyeOff,
  Layers,
  Maximize2,
  Minimize2,
  Save,
  Settings2,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  INDICATORS,
  TIMEFRAMES,
  type ChartIndicatorId,
  type ChartTimeframe,
  type DrawingTool,
  type IndicatorSettings,
  type IndicatorSettingsMap,
} from "../lib/charting";

type Props = {
  activeIndicators: ChartIndicatorId[];
  drawingTool: DrawingTool;
  drawingsCount: number;
  indicatorSettings: IndicatorSettingsMap;
  isFullscreen: boolean;
  onClearDrawings: () => void;
  onDrawingToolChange: (tool: DrawingTool) => void;
  onSaveLayout: () => void;
  onToggleFullscreen: () => void;
  onTimeframeChange: (timeframe: ChartTimeframe) => void;
  onToggleIndicator: (indicator: ChartIndicatorId) => void;
  onToggleOrderOverlays: () => void;
  onSmoothCandlesChange: (value: boolean) => void;
  onUpdateIndicatorSettings: (
    indicator: ChartIndicatorId,
    settings: Partial<IndicatorSettings>,
  ) => void;
  orderOverlaysVisible: boolean;
  savedLabel: string | null;
  smoothCandles: boolean;
  timeframe: ChartTimeframe;
};

const FALLBACK_SETTING: IndicatorSettings = {
  color: "#32d3ee",
  period: 20,
};

export function ChartToolbar({
  activeIndicators,
  drawingTool,
  drawingsCount,
  indicatorSettings,
  isFullscreen,
  onClearDrawings,
  onSaveLayout,
  onToggleFullscreen,
  onTimeframeChange,
  onToggleIndicator,
  onToggleOrderOverlays,
  onSmoothCandlesChange,
  onUpdateIndicatorSettings,
  orderOverlaysVisible,
  savedLabel,
  smoothCandles,
  timeframe,
}: Props) {
  const [indicatorMenuOpen, setIndicatorMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function closeOnOutsideClick(event: globalThis.MouseEvent) {
      const target = event.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) {
        setIndicatorMenuOpen(false);
      }
      if (settingsRef.current && !settingsRef.current.contains(target)) {
        setSettingsOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  return (
    <section className="chart-studio-toolbar">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-md border border-cyan-300/25 bg-cyan-300/10 text-cyan-100">
              <SlidersHorizontal size={17} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white">Chart Studio</div>
              <div className="truncate text-xs text-slate-500">
                {timeframe} active / {activeIndicators.length} indicators / {drawingsCount} drawings
              </div>
            </div>
          </div>
        </div>

        <div className="timeframe-strip">
          {TIMEFRAMES.map((interval) => (
            <button
              className={`timeframe-button ${interval.id === timeframe ? "timeframe-button-active" : ""}`}
              key={interval.id}
              onClick={() => onTimeframeChange(interval.id)}
              type="button"
            >
              {interval.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            className={`chart-mode-button ${!smoothCandles ? "chart-mode-active" : ""}`}
            onClick={() => onSmoothCandlesChange(false)}
            type="button"
          >
            <CandlestickChart size={15} />
            Candle
          </button>
          <button
            className={`chart-mode-button ${smoothCandles ? "chart-mode-active" : ""}`}
            onClick={() => onSmoothCandlesChange(true)}
            type="button"
          >
            <BarChart2 size={15} />
            Smooth
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
            className="chart-mode-button"
            onClick={onToggleFullscreen}
            type="button"
          >
            {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            {isFullscreen ? "Exit" : "Full"}
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

      <div className="flex min-w-0 flex-wrap items-center gap-2">
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
                const active = activeIndicators.includes(indicator.id);
                const settings = indicatorSettings[indicator.id] ?? FALLBACK_SETTING;
                return (
                  <button
                    className={`chart-dropdown-row ${active ? "chart-dropdown-row-active" : ""}`}
                    key={indicator.id}
                    onClick={() => onToggleIndicator(indicator.id)}
                    type="button"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: settings.color }}
                    />
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-sm font-semibold text-slate-100">
                        {indicator.label}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {indicator.description}
                      </span>
                    </span>
                    <span className={active ? "text-cyan-100" : "text-slate-500"}>
                      {active ? "Remove" : "Add"}
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
            disabled={activeIndicators.length === 0}
            onClick={() => {
              setSettingsOpen((value) => !value);
              setIndicatorMenuOpen(false);
            }}
            type="button"
          >
            <Settings2 size={15} />
            Settings
            {activeIndicators.length > 0 && (
              <span className="rounded bg-cyan-300/15 px-1.5 py-0.5 text-[10px] text-cyan-100">
                {activeIndicators.length}
              </span>
            )}
          </button>
          {settingsOpen && (
            <div className="chart-dropdown-panel left-0 w-[360px]">
              {activeIndicators.map((indicator) => (
                <IndicatorEditor
                  indicator={indicator}
                  key={indicator}
                  onRemove={() => onToggleIndicator(indicator)}
                  onUpdate={(settings) => onUpdateIndicatorSettings(indicator, settings)}
                  settings={indicatorSettings[indicator] ?? FALLBACK_SETTING}
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {activeIndicators.map((indicator) => {
            const definition = INDICATORS.find((item) => item.id === indicator);
            const settings = indicatorSettings[indicator] ?? FALLBACK_SETTING;
            return (
              <button
                className="indicator-chip indicator-chip-active"
                key={indicator}
                onClick={() => onToggleIndicator(indicator)}
                type="button"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: settings.color }}
                />
                {definition?.label ?? indicator}
                <X size={12} />
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function IndicatorEditor({
  indicator,
  onRemove,
  onUpdate,
  settings,
}: {
  indicator: ChartIndicatorId;
  onRemove: () => void;
  onUpdate: (settings: Partial<IndicatorSettings>) => void;
  settings: IndicatorSettings;
}) {
  const definition = INDICATORS.find((item) => item.id === indicator);
  const supportsPeriod = indicator !== "vwap";
  const supportsDeviation = indicator === "bb20";

  return (
    <div className="rounded-md border border-white/10 bg-black/20 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">
            {definition?.label ?? indicator}
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
      <div className="grid grid-cols-[1fr_92px] gap-2">
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
            <span>Std Dev</span>
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
