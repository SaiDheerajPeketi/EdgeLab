import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  Crosshair,
  LineChart,
  Magnet,
  Minus,
  MousePointer2,
  Square,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  CrosshairMode,
  createChart,
} from "lightweight-charts";
import type {
  CandlestickData,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  LineData,
  MouseEventParams,
  Time,
  UTCTimestamp,
} from "lightweight-charts";
import type { Candle, Execution, Order, Position } from "../lib/api";
import {
  aggregateBars,
  bucketTime,
  buildIndicatorDefinitions,
  latestIndicatorValue,
  rsiSeries,
  toCandles,
  type ChartDrawing,
  type ChartIndicatorId,
  type ChartTimeframe,
  type DrawingPoint,
  type DrawingTool,
  type IndicatorSettingsMap,
} from "../lib/charting";
import { formatPrice } from "../lib/format";

type Props = {
  activeIndicators: ChartIndicatorId[];
  bars: Candle[];
  drawingTool: DrawingTool;
  drawings: ChartDrawing[];
  executions: Execution[];
  indicatorSettings: IndicatorSettingsMap;
  onAddDrawing: (drawing: ChartDrawing) => void;
  onClearDrawings: () => void;
  onDrawingToolChange: (tool: DrawingTool) => void;
  orders: Order[];
  position: Position | null;
  showOrderOverlays: boolean;
  smoothCandles: boolean;
  timeframe: ChartTimeframe;
};

type TooltipData = {
  x: number;
  y: number;
  candle: Candle;
};

type DraftDrawing = {
  tool: Exclude<DrawingTool, "cursor" | "crosshair">;
  point: DrawingPoint;
};

const DRAWING_COLORS: Record<DraftDrawing["tool"], string> = {
  trendline: "#32d3ee",
  horizontal: "#f59e0b",
  rectangle: "#a78bfa",
  fib: "#22c55e",
};

export function TradingChart({
  activeIndicators,
  bars,
  drawingTool,
  drawings,
  executions,
  indicatorSettings,
  onAddDrawing,
  onClearDrawings,
  onDrawingToolChange,
  orders,
  position,
  showOrderOverlays,
  smoothCandles,
  timeframe,
}: Props) {
  const chartFrameRef = useRef<HTMLDivElement | null>(null);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const indicatorRefs = useRef<Record<string, ISeriesApi<"Line">>>({});
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const barsRef = useRef<Candle[]>([]);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [draftDrawing, setDraftDrawing] = useState<DraftDrawing | null>(null);
  const [plotVersion, setPlotVersion] = useState(0);
  const tooltipStyle = tooltip
    ? getTooltipStyle(tooltip, chartFrameRef.current)
    : undefined;

  const displayBars = useMemo(
    () => aggregateBars(bars, timeframe),
    [bars, timeframe],
  );

  const candleData = useMemo(
    () => toCandles(displayBars, smoothCandles),
    [displayBars, smoothCandles],
  );

  const indicatorDefinitions = useMemo(
    () => buildIndicatorDefinitions(displayBars, activeIndicators, indicatorSettings),
    [activeIndicators, displayBars, indicatorSettings],
  );

  const rsiPeriod = indicatorSettings.rsi14?.period ?? 14;
  const rsiData = useMemo(
    () =>
      activeIndicators.includes("rsi14")
        ? rsiSeries(displayBars, rsiPeriod)
        : [],
    [activeIndicators, displayBars, rsiPeriod],
  );
  const activeOverlayIndicators = indicatorDefinitions.filter(
    (indicator) => indicator.data.length > 0,
  );
  const drawingElements = useMemo(
    () =>
      buildDrawingElements({
        chart: chartRef.current,
        drawings,
        draftDrawing,
        frame: chartFrameRef.current,
        series: candlesRef.current,
        version: plotVersion,
      }),
    [drawings, draftDrawing, plotVersion],
  );

  useEffect(() => {
    barsRef.current = displayBars;
  }, [displayBars]);

  useEffect(() => {
    if (!chartContainerRef.current) {
      return;
    }

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: "#0d1117" },
        textColor: "#a8b3c7",
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.08)" },
        horzLines: { color: "rgba(148, 163, 184, 0.08)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: "rgba(148, 163, 184, 0.16)",
      },
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.16)",
        timeVisible: true,
        secondsVisible: false,
      },
      localization: {
        priceFormatter: (price: number) => formatPrice(price),
      },
      autoSize: true,
    });

    const candles = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#fb7185",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#fb7185",
      priceFormat: {
        type: "price",
        precision: 5,
        minMove: 0.00001,
      },
    });

    const refreshDrawingLayer = () => {
      setPlotVersion((value) => value + 1);
    };

    chartRef.current = chart;
    candlesRef.current = candles;

    chart.subscribeCrosshairMove((param) => {
      setTooltip(resolveTooltip(param, barsRef.current));
    });
    chart.timeScale().subscribeVisibleLogicalRangeChange(refreshDrawingLayer);
    window.addEventListener("resize", refreshDrawingLayer);

    return () => {
      window.removeEventListener("resize", refreshDrawingLayer);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(refreshDrawingLayer);
      chart.remove();
      chartRef.current = null;
      candlesRef.current = null;
      indicatorRefs.current = {};
    };
  }, []);

  useEffect(() => {
    candlesRef.current?.setData(toAscendingSeriesData(candleData));
    if (displayBars.length > 0) {
      chartRef.current?.timeScale().scrollToRealTime();
    }
    setPlotVersion((value) => value + 1);
  }, [candleData, displayBars.length]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) {
      return;
    }

    const activeIds = new Set(indicatorDefinitions.map((indicator) => indicator.id));
    Object.entries(indicatorRefs.current).forEach(([id, series]) => {
      if (!activeIds.has(id)) {
        chart.removeSeries(series);
        delete indicatorRefs.current[id];
      }
    });

    indicatorDefinitions.forEach((indicator) => {
      if (!indicatorRefs.current[indicator.id]) {
        indicatorRefs.current[indicator.id] = chart.addLineSeries({
          color: indicator.color,
          lineWidth: indicator.lineWidth ?? 2,
          lineStyle: indicator.lineStyle ?? 0,
          priceLineVisible: false,
          lastValueVisible: false,
          priceFormat: {
            type: "price",
            precision: 5,
            minMove: 0.00001,
          },
        });
      }
      indicatorRefs.current[indicator.id].applyOptions({
        color: indicator.color,
        lineStyle: indicator.lineStyle ?? 0,
        lineWidth: indicator.lineWidth ?? 2,
      });
      indicatorRefs.current[indicator.id].setData(toAscendingSeriesData(indicator.data));
    });
  }, [indicatorDefinitions]);

  useEffect(() => {
    candlesRef.current?.setMarkers(
      showOrderOverlays
        ? executions
            .map((execution) => ({
              time: bucketTime(toUnixTime(execution.timestamp), timeframe) as UTCTimestamp,
              position: execution.side === "BUY" ? ("belowBar" as const) : ("aboveBar" as const),
              color: execution.side === "BUY" ? "#22c55e" : "#fb7185",
              shape: execution.side === "BUY" ? ("arrowUp" as const) : ("arrowDown" as const),
              text: execution.side,
            }))
            .sort((left, right) => Number(left.time) - Number(right.time))
        : [],
    );
  }, [executions, showOrderOverlays, timeframe]);

  useEffect(() => {
    const series = candlesRef.current;
    if (!series) {
      return;
    }
    priceLinesRef.current.forEach((line) => series.removePriceLine(line));
    priceLinesRef.current = [];

    if (!showOrderOverlays) {
      return;
    }

    const addLine = (price: number | null | undefined, color: string, title: string) => {
      if (price == null) {
        return;
      }
      priceLinesRef.current.push(
        series.createPriceLine({
          price,
          color,
          title,
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
        }),
      );
    };

    if (position && position.side !== "FLAT") {
      addLine(position.avg_price, "#a8b3c7", `${position.side} avg`);
      addLine(position.stop_loss, "#fb7185", "SL");
      addLine(position.take_profit, "#22c55e", "TP");
    }

    orders
      .filter((order) => order.status === "PENDING")
      .forEach((order) => {
        addLine(
          order.limit_price ?? order.stop_price,
          order.side === "BUY" ? "#32d3ee" : "#f59e0b",
          `${order.side} ${order.order_type}`,
        );
      });
  }, [orders, position, showOrderOverlays]);

  useEffect(() => {
    if (drawingTool === "cursor" || drawingTool === "crosshair") {
      setDraftDrawing(null);
    }
  }, [drawingTool]);

  function handleDrawingClick(event: MouseEvent<HTMLDivElement>) {
    if (drawingTool === "cursor" || drawingTool === "crosshair") {
      return;
    }
    const point = pointFromMouseEvent(event, chartRef.current, candlesRef.current);
    if (!point) {
      return;
    }

    if (drawingTool === "horizontal") {
      onAddDrawing(makeDrawing("horizontal", [point]));
      return;
    }

    if (!draftDrawing || draftDrawing.tool !== drawingTool) {
      setDraftDrawing({ tool: drawingTool, point });
      return;
    }

    onAddDrawing(makeDrawing(drawingTool, [draftDrawing.point, point]));
    setDraftDrawing(null);
  }

  return (
    <section className="chart-stage">
      <div className="chart-stage-header">
        <div>
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-md bg-white text-sm font-black text-ink-950">
              EU
            </div>
            <div>
              <div className="text-base font-semibold text-white">EURUSD</div>
              <div className="text-xs text-slate-400">
                {timeframe} / {smoothCandles ? "Smooth candles" : "Candles"} / Bar replay
              </div>
            </div>
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 text-xs text-slate-400">
          {activeOverlayIndicators.slice(0, 4).map((indicator) => (
            <span className="chart-legend-pill" key={indicator.id}>
              <span
                className="h-2 w-2 rounded-sm"
                style={{ backgroundColor: indicator.color }}
              />
              {indicator.label}
            </span>
          ))}
          {rsiData.length > 0 && (
            <span className="chart-legend-pill text-fuchsia-100">
              RSI {latestIndicatorValue(rsiData)?.toFixed(1)}
            </span>
          )}
        </div>
      </div>

      <div className="chart-canvas-grid">
        <DrawingRail
          activeTool={drawingTool}
          drawingsCount={drawings.length}
          onClearDrawings={onClearDrawings}
          onToolChange={onDrawingToolChange}
        />

        <div className="relative min-w-0">
          <div ref={chartFrameRef} className="chart-frame">
            <div ref={chartContainerRef} className="chart-container-surface" />
            <div
              className={`absolute inset-0 z-10 ${drawingTool === "cursor" || drawingTool === "crosshair" ? "pointer-events-none" : "cursor-crosshair"}`}
              onClick={handleDrawingClick}
            >
              <svg className="h-full w-full overflow-visible">
                {drawingElements}
              </svg>
            </div>
          </div>
          {rsiData.length > 0 && <RsiPanel data={rsiData} />}
        </div>
      </div>

      {drawingTool !== "cursor" && drawingTool !== "crosshair" && (
        <div className="absolute left-20 top-20 z-20 rounded-md border border-cyan-300/20 bg-ink-950/95 px-3 py-2 text-xs text-cyan-100 shadow-panel">
          {draftDrawing ? "Click the second anchor" : `Click to place ${toolLabel(drawingTool)}`}
        </div>
      )}

      {tooltip && (
        <div
          className="pointer-events-none absolute z-30 max-w-[240px] rounded-md border border-white/10 bg-ink-950/95 px-3 py-2 text-xs text-slate-200 shadow-panel"
          style={tooltipStyle}
        >
          <div className="mb-1 font-semibold text-white">
            {new Date(tooltip.candle.timestamp).toLocaleString()}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <span>O {formatPrice(tooltip.candle.open)}</span>
            <span>H {formatPrice(tooltip.candle.high)}</span>
            <span>L {formatPrice(tooltip.candle.low)}</span>
            <span>C {formatPrice(tooltip.candle.close)}</span>
            <span>Vol {tooltip.candle.volume}</span>
            <span>RSI {tooltip.candle.rsi_14?.toFixed(1) ?? "—"}</span>
          </div>
        </div>
      )}
    </section>
  );
}

function DrawingRail({
  activeTool,
  drawingsCount,
  onClearDrawings,
  onToolChange,
}: {
  activeTool: DrawingTool;
  drawingsCount: number;
  onClearDrawings: () => void;
  onToolChange: (tool: DrawingTool) => void;
}) {
  const tools: Array<{
    icon: LucideIcon;
    label: string;
    tool: DrawingTool;
  }> = [
    { icon: MousePointer2, label: "Cursor", tool: "cursor" },
    { icon: Crosshair, label: "Crosshair", tool: "crosshair" },
    { icon: LineChart, label: "Trendline", tool: "trendline" },
    { icon: Minus, label: "Horizontal level", tool: "horizontal" },
    { icon: Square, label: "Rectangle zone", tool: "rectangle" },
    { icon: Magnet, label: "Fib retracement", tool: "fib" },
  ];

  return (
    <aside className="drawing-rail">
      {tools.map((item) => {
        const Icon = item.icon;
        return (
          <button
            className={`drawing-rail-button ${activeTool === item.tool ? "drawing-rail-button-active" : ""}`}
            key={item.tool}
            onClick={() => onToolChange(item.tool)}
            title={item.label}
            type="button"
          >
            <Icon size={17} />
          </button>
        );
      })}
      <div className="my-1 h-px w-8 bg-white/10" />
      <button
        className="drawing-rail-button"
        disabled={drawingsCount === 0}
        onClick={onClearDrawings}
        title="Clear drawings"
        type="button"
      >
        <Trash2 size={16} />
        {drawingsCount > 0 && (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-cyan-300 px-1 text-[10px] font-bold text-ink-950">
            {drawingsCount}
          </span>
        )}
      </button>
    </aside>
  );
}

function toAscendingSeriesData<T extends CandlestickData | LineData>(data: T[]): T[] {
  const byTime = new Map<number, T>();
  for (const item of data) {
    const time = Number(item.time);
    if (!Number.isFinite(time)) {
      continue;
    }
    byTime.set(time, item);
  }
  return Array.from(byTime.values()).sort(
    (left, right) => Number(left.time) - Number(right.time),
  );
}

function RsiPanel({ data }: { data: LineData[] }) {
  const visible = data.slice(-160);
  const path = toRsiPath(visible, 960, 96);
  const latest = latestIndicatorValue(data);

  return (
    <div className="border-t border-white/10 bg-ink-950 px-4 py-3">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-semibold uppercase tracking-[0.16em] text-slate-500">RSI 14</span>
        <span className="text-fuchsia-100">{latest == null ? "—" : latest.toFixed(1)}</span>
      </div>
      <div className="h-24 overflow-hidden rounded-md bg-black/20">
        {visible.length > 1 ? (
          <svg className="h-full w-full" preserveAspectRatio="none" viewBox="0 0 960 96">
            <path d="M 0 28.8 L 960 28.8" stroke="rgba(34, 197, 94, 0.26)" strokeWidth="1" />
            <path d="M 0 67.2 L 960 67.2" stroke="rgba(251, 113, 133, 0.26)" strokeWidth="1" />
            <path d={path} fill="none" stroke="#f472b6" strokeWidth="2" />
          </svg>
        ) : (
          <div className="grid h-full place-items-center text-xs text-slate-500">
            Waiting for enough candles
          </div>
        )}
      </div>
    </div>
  );
}

function buildDrawingElements({
  chart,
  drawings,
  draftDrawing,
  frame,
  series,
}: {
  chart: IChartApi | null;
  drawings: ChartDrawing[];
  draftDrawing: DraftDrawing | null;
  frame: HTMLDivElement | null;
  series: ISeriesApi<"Candlestick"> | null;
  version: number;
}) {
  if (!chart || !series || !frame) {
    return null;
  }

  const width = frame.clientWidth;
  const toPixel = (point: DrawingPoint) => {
    const x = chart.timeScale().timeToCoordinate(point.time as UTCTimestamp);
    const y = series.priceToCoordinate(point.price);
    if (x == null || y == null) {
      return null;
    }
    return { x, y };
  };

  return (
    <>
      {drawings.map((drawing) =>
        renderDrawing(drawing, toPixel, width),
      )}
      {draftDrawing && (
        <circle
          cx={toPixel(draftDrawing.point)?.x ?? 0}
          cy={toPixel(draftDrawing.point)?.y ?? 0}
          fill={DRAWING_COLORS[draftDrawing.tool]}
          opacity={0.9}
          r={4}
        />
      )}
    </>
  );
}

function renderDrawing(
  drawing: ChartDrawing,
  toPixel: (point: DrawingPoint) => { x: number; y: number } | null,
  width: number,
) {
  const color = drawing.color;
  if (drawing.tool === "horizontal") {
    const point = toPixel(drawing.points[0]);
    if (!point) {
      return null;
    }
    return (
      <g key={drawing.id}>
        <line
          stroke={color}
          strokeDasharray="5 5"
          strokeWidth="1.5"
          x1={0}
          x2={width}
          y1={point.y}
          y2={point.y}
        />
        <text fill={color} fontSize="11" x={8} y={point.y - 6}>
          {formatPrice(drawing.points[0].price)}
        </text>
      </g>
    );
  }

  const first = toPixel(drawing.points[0]);
  const second = toPixel(drawing.points[1]);
  if (!first || !second) {
    return null;
  }

  if (drawing.tool === "rectangle") {
    return (
      <rect
        fill={`${color}24`}
        height={Math.abs(second.y - first.y)}
        key={drawing.id}
        stroke={color}
        strokeWidth="1.5"
        width={Math.abs(second.x - first.x)}
        x={Math.min(first.x, second.x)}
        y={Math.min(first.y, second.y)}
      />
    );
  }

  if (drawing.tool === "fib") {
    const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    const top = first.y;
    const range = second.y - first.y;
    const left = Math.min(first.x, second.x);
    const right = Math.max(first.x, second.x);
    return (
      <g key={drawing.id}>
        {levels.map((level) => {
          const y = top + range * level;
          return (
            <g key={level}>
              <line
                stroke={color}
                strokeOpacity={level === 0 || level === 1 ? 0.9 : 0.55}
                strokeWidth={level === 0 || level === 1 ? "1.5" : "1"}
                x1={left}
                x2={right}
                y1={y}
                y2={y}
              />
              <text fill={color} fontSize="10" x={right + 6} y={y - 3}>
                {(level * 100).toFixed(1)}%
              </text>
            </g>
          );
        })}
      </g>
    );
  }

  return (
    <line
      key={drawing.id}
      stroke={color}
      strokeWidth="2"
      x1={first.x}
      x2={second.x}
      y1={first.y}
      y2={second.y}
    />
  );
}

function pointFromMouseEvent(
  event: MouseEvent<HTMLDivElement>,
  chart: IChartApi | null,
  series: ISeriesApi<"Candlestick"> | null,
): DrawingPoint | null {
  if (!chart || !series) {
    return null;
  }
  const rect = event.currentTarget.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const time = chart.timeScale().coordinateToTime(x);
  const price = series.coordinateToPrice(y);
  if (time == null || price == null || typeof time !== "number") {
    return null;
  }
  return { time, price };
}

function makeDrawing(
  tool: DraftDrawing["tool"],
  points: DrawingPoint[],
): ChartDrawing {
  return {
    id: window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    tool,
    color: DRAWING_COLORS[tool],
    points,
    createdAt: new Date().toISOString(),
  };
}

function getTooltipStyle(tooltip: TooltipData, container: HTMLDivElement | null) {
  const width = container?.clientWidth ?? 320;
  const height = container?.clientHeight ?? 508;
  const left = Math.min(Math.max(12, tooltip.x + 12), Math.max(12, width - 252));
  const top = Math.min(Math.max(60, tooltip.y + 60), Math.max(60, height - 102));
  return { left, top };
}

function resolveTooltip(
  param: MouseEventParams<Time>,
  bars: Candle[],
): TooltipData | null {
  if (!param.point || param.time == null) {
    return null;
  }
  const time = Number(param.time);
  const candle = bars.find((bar) => bar.time === time);
  if (!candle) {
    return null;
  }
  return {
    x: param.point.x,
    y: param.point.y,
    candle,
  };
}

function toUnixTime(timestamp: string) {
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp);
  const normalized = hasTimezone ? timestamp : `${timestamp}Z`;
  return Math.floor(new Date(normalized).getTime() / 1000);
}

function toolLabel(tool: DrawingTool) {
  switch (tool) {
    case "trendline":
      return "a trendline";
    case "horizontal":
      return "a horizontal level";
    case "rectangle":
      return "a zone";
    case "fib":
      return "fib anchors";
    default:
      return "a drawing";
  }
}

function toRsiPath(values: LineData[], width: number, height: number) {
  if (values.length < 2) {
    return "";
  }
  const step = width / (values.length - 1);
  return values
    .map((point, index) => {
      const x = index * step;
      const y = height - (Number(point.value) / 100) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}
