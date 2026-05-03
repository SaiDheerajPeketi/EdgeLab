import {
  BarChart2,
  CandlestickChart,
  Eye,
  EyeOff,
  Layers,
  Save,
  Settings2,
  SlidersHorizontal,
} from "lucide-react";
import {
  INDICATORS,
  TIMEFRAMES,
  type ChartIndicatorId,
  type ChartTimeframe,
  type DrawingTool,
} from "../lib/charting";

type Props = {
  activeIndicators: ChartIndicatorId[];
  drawingTool: DrawingTool;
  drawingsCount: number;
  onClearDrawings: () => void;
  onDrawingToolChange: (tool: DrawingTool) => void;
  onSaveLayout: () => void;
  onTimeframeChange: (timeframe: ChartTimeframe) => void;
  onToggleIndicator: (indicator: ChartIndicatorId) => void;
  onToggleOrderOverlays: () => void;
  onSmoothCandlesChange: (value: boolean) => void;
  orderOverlaysVisible: boolean;
  savedLabel: string | null;
  smoothCandles: boolean;
  timeframe: ChartTimeframe;
};

export function ChartToolbar({
  activeIndicators,
  drawingTool,
  drawingsCount,
  onClearDrawings,
  onDrawingToolChange,
  onSaveLayout,
  onTimeframeChange,
  onToggleIndicator,
  onToggleOrderOverlays,
  onSmoothCandlesChange,
  orderOverlaysVisible,
  savedLabel,
  smoothCandles,
  timeframe,
}: Props) {
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
                {drawingTool === "cursor" || drawingTool === "crosshair"
                  ? "Drawing dock ready"
                  : `Active tool: ${drawingTool}`}{" "}
                / {drawingsCount} drawings
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
          <button className="chart-mode-button" type="button">
            <Settings2 size={15} />
            Settings
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
        <div className="flex items-center gap-2 px-1 text-xs uppercase tracking-[0.16em] text-slate-500">
          <Layers size={13} />
          Indicators
        </div>
        {INDICATORS.map((indicator) => {
          const active = activeIndicators.includes(indicator.id);
          return (
            <button
              className={`indicator-chip ${
                active
                  ? "indicator-chip-active"
                  : ""
              }`}
              key={indicator.id}
              onClick={() => onToggleIndicator(indicator.id)}
              title={indicator.description}
              type="button"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: active ? indicator.color : "rgba(148, 163, 184, 0.45)" }}
              />
              {indicator.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
