import {
  BarChart2,
  CandlestickChart,
  Crosshair,
  Eye,
  EyeOff,
  Layers,
  LineChart,
  Magnet,
  Minus,
  MousePointer2,
  Save,
  Settings2,
  Square,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
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
    <section className="terminal-panel mb-2 grid min-w-0 gap-2 px-2 py-2">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <IconButton
            active={drawingTool === "cursor"}
            onClick={() => onDrawingToolChange("cursor")}
            title="Cursor"
          >
            <MousePointer2 size={16} />
          </IconButton>
          <IconButton
            active={drawingTool === "crosshair"}
            onClick={() => onDrawingToolChange("crosshair")}
            title="Crosshair inspect"
          >
            <Crosshair size={16} />
          </IconButton>
          <IconButton
            active={drawingTool === "trendline"}
            onClick={() => onDrawingToolChange("trendline")}
            title="Trendline"
          >
            <LineChart size={16} />
          </IconButton>
          <IconButton
            active={drawingTool === "horizontal"}
            onClick={() => onDrawingToolChange("horizontal")}
            title="Horizontal level"
          >
            <Minus size={16} />
          </IconButton>
          <IconButton
            active={drawingTool === "rectangle"}
            onClick={() => onDrawingToolChange("rectangle")}
            title="Rectangle zone"
          >
            <Square size={16} />
          </IconButton>
          <IconButton
            active={drawingTool === "fib"}
            onClick={() => onDrawingToolChange("fib")}
            title="Fibonacci retracement"
          >
            <Magnet size={16} />
          </IconButton>
          <button
            className="chart-tool-button px-2 text-xs"
            disabled={drawingsCount === 0}
            onClick={onClearDrawings}
            title="Clear drawings"
            type="button"
          >
            <Trash2 size={15} />
            <span>{drawingsCount}</span>
          </button>
          <div className="mx-1 h-5 w-px bg-white/10" />
          <IconButton active={!smoothCandles} onClick={() => onSmoothCandlesChange(false)} title="Regular candles">
            <CandlestickChart size={16} />
          </IconButton>
          <IconButton active={smoothCandles} onClick={() => onSmoothCandlesChange(true)} title="Smooth candles">
            <BarChart2 size={16} />
          </IconButton>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {TIMEFRAMES.map((interval) => (
            <button
              className={`chart-tool-button px-2 text-xs ${interval.id === timeframe ? "chart-tool-active" : ""}`}
              key={interval.id}
              onClick={() => onTimeframeChange(interval.id)}
              type="button"
            >
              {interval.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <IconButton
            active={orderOverlaysVisible}
            onClick={onToggleOrderOverlays}
            title={orderOverlaysVisible ? "Hide order overlays" : "Show order overlays"}
          >
            {orderOverlaysVisible ? <Eye size={16} /> : <EyeOff size={16} />}
          </IconButton>
          <IconButton title="Indicator library">
            <Layers size={16} />
          </IconButton>
          <IconButton title="Chart settings">
            <Settings2 size={16} />
          </IconButton>
          <button
            className="chart-tool-button px-2 text-xs"
            onClick={onSaveLayout}
            title="Save chart layout"
            type="button"
          >
            <Save size={16} />
            <span className="hidden sm:inline">{savedLabel ?? "Save"}</span>
          </button>
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-white/10 pt-2">
        <div className="flex items-center gap-2 px-1 text-xs uppercase tracking-[0.16em] text-slate-500">
          <Layers size={13} />
          Indicators
        </div>
        {INDICATORS.map((indicator) => {
          const active = activeIndicators.includes(indicator.id);
          return (
            <button
              className={`inline-flex h-8 min-w-0 items-center gap-2 rounded-md border px-2 text-xs font-semibold transition ${
                active
                  ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
                  : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
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

function IconButton({
  active = false,
  children,
  onClick,
  title,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
  title: string;
}) {
  return (
    <button
      className={`chart-tool-button ${active ? "chart-tool-active" : ""}`}
      onClick={onClick}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}
