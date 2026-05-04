import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  Crosshair,
  LineChart,
  Magnet,
  Minus,
  MousePointer2,
  Square,
  Trash2,
  Type,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  CrosshairMode,
  createChart,
} from "lightweight-charts";
import type {
  CandlestickData,
  HistogramData,
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
  macdSeries,
  rsiSeries,
  toCandles,
  type ChartDrawing,
  type ChartIndicatorId,
  type ChartStyle,
  type ChartTimeframe,
  type DrawingPoint,
  type DrawingTool,
  type MacdData,
  type IndicatorSettingsMap,
} from "../lib/charting";
import { formatPrice } from "../lib/format";

type Props = {
  activeIndicators: ChartIndicatorId[];
  bars: Candle[];
  chartStyle: ChartStyle;
  drawingTool: DrawingTool;
  drawings: ChartDrawing[];
  executions: Execution[];
  indicatorSettings: IndicatorSettingsMap;
  onAddDrawing: (drawing: ChartDrawing) => void;
  onClearDrawings: () => void;
  onDeleteDrawing: (drawingId: string) => void;
  onDrawingToolChange: (tool: DrawingTool) => void;
  onSelectDrawing: (drawingId: string | null) => void;
  onUpdateDrawing: (drawing: ChartDrawing) => void;
  orders: Order[];
  position: Position | null;
  selectedDrawingId: string | null;
  showOrderOverlays: boolean;
  symbol?: string;
  datasetTimeframe?: string | null;
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

type DragState = {
  drawing: ChartDrawing;
  mode: "anchor" | "body";
  originalPoints: DrawingPoint[];
  pointIndex: number | null;
  startPoint: DrawingPoint;
};

const DRAWING_COLORS: Record<DraftDrawing["tool"], string> = {
  trendline: "#32d3ee",
  horizontal: "#f59e0b",
  rectangle: "#a78bfa",
  fib: "#22c55e",
  measure: "#38bdf8",
  longPosition: "#22c55e",
  shortPosition: "#fb7185",
  text: "#f8fafc",
};

export function TradingChart({
  activeIndicators,
  bars,
  chartStyle,
  drawingTool,
  drawings,
  executions,
  indicatorSettings,
  onAddDrawing,
  onClearDrawings,
  onDeleteDrawing,
  onDrawingToolChange,
  onSelectDrawing,
  onUpdateDrawing,
  orders,
  position,
  selectedDrawingId,
  showOrderOverlays,
  symbol = "EURUSD",
  datasetTimeframe,
  timeframe,
}: Props) {
  const chartFrameRef = useRef<HTMLDivElement | null>(null);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const areaRef = useRef<ISeriesApi<"Area"> | null>(null);
  const lineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const indicatorRefs = useRef<Record<string, ISeriesApi<"Line">>>({});
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const barsRef = useRef<Candle[]>([]);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [draftDrawing, setDraftDrawing] = useState<DraftDrawing | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [hoverPoint, setHoverPoint] = useState<DrawingPoint | null>(null);
  const [plotVersion, setPlotVersion] = useState(0);
  const tooltipStyle = tooltip
    ? getTooltipStyle(tooltip, chartFrameRef.current)
    : undefined;

  const displayBars = useMemo(
    () => aggregateBars(bars, timeframe),
    [bars, timeframe],
  );

  const candleData = useMemo(
    () => toCandles(displayBars, chartStyle === "heikinAshi"),
    [chartStyle, displayBars],
  );
  const closeLineData = useMemo(
    () =>
      displayBars.map(
        (bar): LineData => ({
          time: bar.time as UTCTimestamp,
          value: bar.close,
        }),
      ),
    [displayBars],
  );
  const volumeData = useMemo(
    () =>
      displayBars.map(
        (bar): HistogramData => ({
          time: bar.time as UTCTimestamp,
          value: bar.volume,
          color:
            bar.close >= bar.open
              ? "rgba(34, 197, 94, 0.22)"
              : "rgba(251, 113, 133, 0.24)",
        }),
      ),
    [displayBars],
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
  const macdSettings = indicatorSettings.macd;
  const macdData = useMemo(
    () =>
      activeIndicators.includes("macd")
        ? macdSeries(
            displayBars,
            macdSettings.fastPeriod ?? 12,
            macdSettings.slowPeriod ?? 26,
            macdSettings.signalPeriod ?? 9,
          )
        : null,
    [
      activeIndicators,
      displayBars,
      macdSettings.fastPeriod,
      macdSettings.signalPeriod,
      macdSettings.slowPeriod,
    ],
  );
  const activeOverlayIndicators = indicatorDefinitions.filter(
    (indicator) => indicator.data.length > 0,
  );
  const drawingElements = buildDrawingElements({
    chart: chartRef.current,
    drawings,
    draftDrawing,
    frame: chartFrameRef.current,
    hoverPoint,
    onDeleteDrawing,
    onDragStart: startDrawingDrag,
    onSelectDrawing,
    selectedDrawingId,
    series: candlesRef.current,
    version: plotVersion,
  });

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
    const line = chart.addLineSeries({
      color: "#32d3ee",
      lineWidth: 2,
      priceLineVisible: false,
      visible: false,
      priceFormat: {
        type: "price",
        precision: 5,
        minMove: 0.00001,
      },
    });
    const area = chart.addAreaSeries({
      bottomColor: "rgba(50, 211, 238, 0.02)",
      lineColor: "#32d3ee",
      lineWidth: 2,
      priceLineVisible: false,
      topColor: "rgba(50, 211, 238, 0.28)",
      visible: false,
      priceFormat: {
        type: "price",
        precision: 5,
        minMove: 0.00001,
      },
    });
    const volume = chart.addHistogramSeries({
      color: "rgba(148, 163, 184, 0.24)",
      priceFormat: {
        type: "volume",
      },
      priceLineVisible: false,
      priceScaleId: "",
    });
    volume.priceScale().applyOptions({
      scaleMargins: {
        top: 0.82,
        bottom: 0,
      },
    });

    const refreshDrawingLayer = () => {
      setPlotVersion((value) => value + 1);
    };

    chartRef.current = chart;
    candlesRef.current = candles;
    areaRef.current = area;
    lineRef.current = line;
    volumeRef.current = volume;

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
      areaRef.current = null;
      lineRef.current = null;
      volumeRef.current = null;
      indicatorRefs.current = {};
    };
  }, []);

  useEffect(() => {
    candlesRef.current?.setData(toAscendingSeriesData(candleData));
    lineRef.current?.setData(toAscendingSeriesData(closeLineData));
    areaRef.current?.setData(toAscendingSeriesData(closeLineData));
    volumeRef.current?.setData(toAscendingHistogramData(volumeData));
    if (displayBars.length > 0) {
      chartRef.current?.timeScale().scrollToRealTime();
    }
    setPlotVersion((value) => value + 1);
  }, [candleData, closeLineData, displayBars.length, volumeData]);

  useEffect(() => {
    candlesRef.current?.applyOptions({
      visible: chartStyle === "candles" || chartStyle === "heikinAshi",
    });
    lineRef.current?.applyOptions({ visible: chartStyle === "line" });
    areaRef.current?.applyOptions({ visible: chartStyle === "area" });
  }, [chartStyle]);

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
      setHoverPoint(null);
    }
  }, [drawingTool]);

  function handleDrawingClick(event: MouseEvent<HTMLDivElement>) {
    if (drawingTool === "cursor" || drawingTool === "crosshair") {
      onSelectDrawing(null);
      return;
    }
    const point = pointFromClient(
      event.clientX,
      event.clientY,
      chartFrameRef.current,
      chartRef.current,
      candlesRef.current,
    );
    if (!point) {
      return;
    }

    if (drawingTool === "horizontal") {
      onAddDrawing(makeDrawing("horizontal", [point]));
      return;
    }

    if (drawingTool === "text") {
      const label = window.prompt("Text label", "Note")?.trim() || "Note";
      onAddDrawing(makeDrawing("text", [point], label));
      setDraftDrawing(null);
      setHoverPoint(null);
      return;
    }

    if (!draftDrawing || draftDrawing.tool !== drawingTool) {
      setDraftDrawing({ tool: drawingTool, point });
      return;
    }

    onAddDrawing(makeDrawing(drawingTool, [draftDrawing.point, point]));
    setDraftDrawing(null);
    setHoverPoint(null);
  }

  function handleDrawingMove(event: MouseEvent<HTMLDivElement>) {
    if (dragState) {
      const point = pointFromClient(
        event.clientX,
        event.clientY,
        chartFrameRef.current,
        chartRef.current,
        candlesRef.current,
      );
      if (!point) {
        return;
      }
      const nextDrawing = moveDrawing(dragState, point);
      onUpdateDrawing(nextDrawing);
      return;
    }

    if (!draftDrawing || drawingTool === "cursor" || drawingTool === "crosshair") {
      return;
    }
    setHoverPoint(
      pointFromClient(
        event.clientX,
        event.clientY,
        chartFrameRef.current,
        chartRef.current,
        candlesRef.current,
      ),
    );
  }

  function startDrawingDrag(
    drawing: ChartDrawing,
    mode: DragState["mode"],
    pointIndex: number | null,
    event: MouseEvent<SVGElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const point = pointFromClient(
      event.clientX,
      event.clientY,
      chartFrameRef.current,
      chartRef.current,
      candlesRef.current,
    );
    if (!point) {
      return;
    }
    onSelectDrawing(drawing.id);
    setDragState({
      drawing,
      mode,
      originalPoints: drawing.points.map((item) => ({ ...item })),
      pointIndex,
      startPoint: point,
    });
  }

  function stopDrawingDrag() {
    setDragState(null);
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
              <div className="text-base font-semibold text-white">{symbol}</div>
              <div className="text-xs text-slate-400">
                {datasetTimeframe ?? timeframe} source / {timeframe} view / {chartStyleLabel(chartStyle)}
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
              className={`absolute inset-0 z-10 ${dragState || (drawingTool !== "cursor" && drawingTool !== "crosshair") ? "pointer-events-auto" : "pointer-events-none"} ${drawingTool === "cursor" || drawingTool === "crosshair" ? "cursor-default" : "cursor-crosshair"}`}
              onMouseDown={handleDrawingClick}
              onMouseLeave={stopDrawingDrag}
              onMouseMove={handleDrawingMove}
              onMouseUp={stopDrawingDrag}
            >
              <svg className="h-full w-full overflow-visible pointer-events-none">
                {drawingElements}
              </svg>
            </div>
          </div>
          {rsiData.length > 0 && <RsiPanel data={rsiData} />}
          {macdData && (
            <MacdPanel
              color={macdSettings.color}
              data={macdData}
              histogramColor={macdSettings.histogramColor ?? "#94a3b8"}
              signalColor={macdSettings.signalColor ?? "#f59e0b"}
            />
          )}
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
    { icon: Minus, label: "Measure", tool: "measure" },
    { icon: LineChart, label: "Long position", tool: "longPosition" },
    { icon: LineChart, label: "Short position", tool: "shortPosition" },
    { icon: Type, label: "Text label", tool: "text" },
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

function toAscendingHistogramData(data: HistogramData[]): HistogramData[] {
  const byTime = new Map<number, HistogramData>();
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

function MacdPanel({
  color,
  data,
  histogramColor,
  signalColor,
}: {
  color: string;
  data: MacdData;
  histogramColor: string;
  signalColor: string;
}) {
  const visibleMacd = data.macd.slice(-160);
  const visibleSignal = data.signal.slice(-160);
  const visibleHistogram = data.histogram.slice(-160);
  const values = [
    ...visibleMacd.map((point) => Number(point.value)),
    ...visibleSignal.map((point) => Number(point.value)),
    ...visibleHistogram.map((point) => point.value),
  ];
  const maxAbs = Math.max(0.000001, ...values.map((value) => Math.abs(value)));
  const latest = visibleMacd.at(-1)?.value;
  const signalLatest = visibleSignal.at(-1)?.value;

  return (
    <div className="border-t border-white/10 bg-ink-950 px-4 py-3">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-semibold uppercase tracking-[0.16em] text-slate-500">MACD 12 26 9</span>
        <span className="text-slate-300">
          {latest == null ? "—" : Number(latest).toFixed(5)} / {signalLatest == null ? "—" : Number(signalLatest).toFixed(5)}
        </span>
      </div>
      <div className="h-28 overflow-hidden rounded-md bg-black/20">
        {visibleMacd.length > 1 ? (
          <svg className="h-full w-full" preserveAspectRatio="none" viewBox="0 0 960 112">
            <path d="M 0 56 L 960 56" stroke="rgba(148, 163, 184, 0.24)" strokeWidth="1" />
            {visibleHistogram.map((point, index) => {
              const x = (index / Math.max(1, visibleHistogram.length - 1)) * 960;
              const y = 56 - (point.value / maxAbs) * 50;
              return (
                <line
                  key={`${point.time}-${index}`}
                  stroke={point.value >= 0 ? histogramColor : "#fb7185"}
                  strokeOpacity="0.62"
                  strokeWidth="4"
                  x1={x}
                  x2={x}
                  y1={56}
                  y2={y}
                />
              );
            })}
            <path d={toOscillatorPath(visibleMacd, 960, 112, maxAbs)} fill="none" stroke={color} strokeWidth="2" />
            <path d={toOscillatorPath(visibleSignal, 960, 112, maxAbs)} fill="none" stroke={signalColor} strokeWidth="2" />
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
  hoverPoint,
  onDeleteDrawing,
  onDragStart,
  onSelectDrawing,
  selectedDrawingId,
  series,
}: {
  chart: IChartApi | null;
  drawings: ChartDrawing[];
  draftDrawing: DraftDrawing | null;
  frame: HTMLDivElement | null;
  hoverPoint: DrawingPoint | null;
  onDeleteDrawing: (drawingId: string) => void;
  onDragStart: (
    drawing: ChartDrawing,
    mode: DragState["mode"],
    pointIndex: number | null,
    event: MouseEvent<SVGElement>,
  ) => void;
  onSelectDrawing: (drawingId: string | null) => void;
  selectedDrawingId: string | null;
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
        renderDrawing(drawing, toPixel, width, {
          onDeleteDrawing,
          onDragStart,
          onSelectDrawing,
          selected: selectedDrawingId === drawing.id,
        }),
      )}
      {draftDrawing && (
        <g>
          {hoverPoint &&
            renderDrawing(
              {
                id: "draft",
                tool: draftDrawing.tool,
                color: DRAWING_COLORS[draftDrawing.tool],
                points: [draftDrawing.point, hoverPoint],
                createdAt: "",
              },
              toPixel,
              width,
              {
                onDeleteDrawing,
                onDragStart,
                onSelectDrawing,
                selected: false,
              },
            )}
          <circle
            cx={toPixel(draftDrawing.point)?.x ?? 0}
            cy={toPixel(draftDrawing.point)?.y ?? 0}
            fill={DRAWING_COLORS[draftDrawing.tool]}
            opacity={0.9}
            r={4}
          />
        </g>
      )}
    </>
  );
}

function renderDrawing(
  drawing: ChartDrawing,
  toPixel: (point: DrawingPoint) => { x: number; y: number } | null,
  width: number,
  options: {
    onDeleteDrawing: (drawingId: string) => void;
    onDragStart: (
      drawing: ChartDrawing,
      mode: DragState["mode"],
      pointIndex: number | null,
      event: MouseEvent<SVGElement>,
    ) => void;
    onSelectDrawing: (drawingId: string | null) => void;
    selected: boolean;
  },
) {
  const color = drawing.color;
  const handleBodyDown = (event: MouseEvent<SVGElement>) => {
    options.onDragStart(drawing, "body", null, event);
  };
  const handleSelect = (event: MouseEvent<SVGElement>) => {
    event.stopPropagation();
    options.onSelectDrawing(drawing.id);
  };

  if (drawing.tool === "horizontal") {
    const point = toPixel(drawing.points[0]);
    if (!point) {
      return null;
    }
    return (
      <g key={drawing.id}>
        <line
          cursor="ns-resize"
          onMouseDown={handleBodyDown}
          onClick={handleSelect}
          pointerEvents="all"
          stroke="transparent"
          strokeWidth="14"
          x1={0}
          x2={width}
          y1={point.y}
          y2={point.y}
        />
        <line
          stroke={color}
          strokeDasharray="5 5"
          strokeOpacity={options.selected ? 1 : 0.82}
          strokeWidth={options.selected ? "2.5" : "1.5"}
          x1={0}
          x2={width}
          y1={point.y}
          y2={point.y}
        />
        <rect
          fill="rgba(8, 12, 17, 0.92)"
          height={20}
          rx={4}
          stroke={color}
          strokeOpacity="0.55"
          width={88}
          x={Math.max(8, width - 104)}
          y={point.y - 24}
        />
        <text fill={color} fontSize="11" fontWeight="700" x={Math.max(16, width - 96)} y={point.y - 10}>
          {formatPrice(drawing.points[0].price)}
        </text>
        {options.selected && renderAnchors(drawing, [point], options)}
      </g>
    );
  }

  if (drawing.tool === "text") {
    const point = toPixel(drawing.points[0]);
    if (!point) {
      return null;
    }
    const label = drawing.label || "Note";
    const widthEstimate = Math.max(56, Math.min(220, label.length * 7 + 22));
    return (
      <g
        cursor="move"
        key={drawing.id}
        onClick={handleSelect}
        onMouseDown={handleBodyDown}
        pointerEvents="all"
      >
        <rect
          fill="rgba(8, 12, 17, 0.92)"
          height={24}
          rx={4}
          stroke={color}
          strokeOpacity={options.selected ? 1 : 0.8}
          strokeWidth={options.selected ? 2 : 1}
          width={widthEstimate}
          x={point.x + 8}
          y={point.y - 28}
        />
        <text
          fill={color}
          fontSize="12"
          fontWeight="600"
          x={point.x + 18}
          y={point.y - 12}
        >
          {label}
        </text>
        <circle cx={point.x} cy={point.y} fill={color} r={3} />
        {options.selected && renderAnchors(drawing, [point], options)}
      </g>
    );
  }

  const first = toPixel(drawing.points[0]);
  const second = toPixel(drawing.points[1]);
  if (!first || !second) {
    return null;
  }

  if (drawing.tool === "measure") {
    const priceDelta = drawing.points[1].price - drawing.points[0].price;
    const percentDelta =
      drawing.points[0].price === 0 ? 0 : (priceDelta / drawing.points[0].price) * 100;
    const timeDelta = Math.abs(drawing.points[1].time - drawing.points[0].time);
    const midX = (first.x + second.x) / 2;
    const midY = (first.y + second.y) / 2;
    const label = `${priceDelta >= 0 ? "+" : ""}${formatPrice(priceDelta)} (${percentDelta.toFixed(2)}%) · ${formatDurationSeconds(timeDelta)}`;
    return (
      <g key={drawing.id}>
        <line
          cursor="move"
          onClick={handleSelect}
          onMouseDown={handleBodyDown}
          pointerEvents="all"
          stroke="transparent"
          strokeWidth="14"
          x1={first.x}
          x2={second.x}
          y1={first.y}
          y2={second.y}
        />
        <line
          stroke={color}
          strokeDasharray="6 5"
          strokeLinecap="round"
          strokeWidth={options.selected ? "2.5" : "2"}
          x1={first.x}
          x2={second.x}
          y1={first.y}
          y2={second.y}
        />
        <line
          stroke={color}
          strokeOpacity="0.38"
          strokeWidth="1"
          x1={first.x}
          x2={first.x}
          y1={first.y}
          y2={second.y}
        />
        <line
          stroke={color}
          strokeOpacity="0.38"
          strokeWidth="1"
          x1={first.x}
          x2={second.x}
          y1={second.y}
          y2={second.y}
        />
        <rect
          fill="rgba(8, 12, 17, 0.94)"
          height={24}
          rx={5}
          stroke={color}
          strokeOpacity="0.72"
          width={Math.min(300, Math.max(188, label.length * 7.2))}
          x={midX + 8}
          y={midY - 32}
        />
        <text fill={color} fontSize="11" fontWeight="800" x={midX + 18} y={midY - 16}>
          {label}
        </text>
        {options.selected && renderAnchors(drawing, [first, second], options)}
      </g>
    );
  }

  if (drawing.tool === "longPosition" || drawing.tool === "shortPosition") {
    return renderPositionDrawing(drawing, first, second, width, options);
  }

  if (drawing.tool === "rectangle") {
    const x = Math.min(first.x, second.x);
    const y = Math.min(first.y, second.y);
    const rectWidth = Math.abs(second.x - first.x);
    const rectHeight = Math.abs(second.y - first.y);
    return (
      <g key={drawing.id}>
        <rect
          cursor="move"
          fill={`${color}26`}
          height={rectHeight}
          onClick={handleSelect}
          onMouseDown={handleBodyDown}
          pointerEvents="all"
          stroke={color}
          strokeOpacity={options.selected ? 1 : 0.82}
          strokeWidth={options.selected ? "2" : "1.5"}
          width={rectWidth}
          x={x}
          y={y}
        />
        {options.selected && (
          <>
            <rect
              fill="none"
              height={rectHeight + 8}
              pointerEvents="none"
              stroke={color}
              strokeDasharray="3 4"
              strokeOpacity="0.7"
              width={rectWidth + 8}
              x={x - 4}
              y={y - 4}
            />
            {renderAnchors(drawing, [first, second], options)}
          </>
        )}
      </g>
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
        <rect
          cursor="move"
          fill="transparent"
          height={Math.abs(second.y - first.y) + 20}
          onClick={handleSelect}
          onMouseDown={handleBodyDown}
          pointerEvents="all"
          width={Math.abs(second.x - first.x) + 20}
          x={left - 10}
          y={Math.min(first.y, second.y) - 10}
        />
        {levels.map((level) => {
          const y = top + range * level;
          return (
            <g key={level}>
              <line
                stroke={color}
                strokeOpacity={options.selected || level === 0 || level === 1 ? 0.9 : 0.55}
                strokeWidth={options.selected && (level === 0 || level === 1) ? "2" : level === 0 || level === 1 ? "1.5" : "1"}
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
        {options.selected && renderAnchors(drawing, [first, second], options)}
      </g>
    );
  }

  return (
    <g key={drawing.id}>
      <line
        cursor="move"
        onClick={handleSelect}
        onMouseDown={handleBodyDown}
        pointerEvents="all"
        stroke="transparent"
        strokeWidth="14"
        x1={first.x}
        x2={second.x}
        y1={first.y}
        y2={second.y}
      />
      <line
        stroke={color}
        strokeLinecap="round"
        strokeOpacity={options.selected ? 1 : 0.9}
        strokeWidth={options.selected ? "3" : "2"}
        x1={first.x}
        x2={second.x}
        y1={first.y}
        y2={second.y}
      />
      {options.selected && renderAnchors(drawing, [first, second], options)}
    </g>
  );
}

function renderAnchors(
  drawing: ChartDrawing,
  points: Array<{ x: number; y: number }>,
  options: {
    onDeleteDrawing: (drawingId: string) => void;
    onDragStart: (
      drawing: ChartDrawing,
      mode: DragState["mode"],
      pointIndex: number | null,
      event: MouseEvent<SVGElement>,
    ) => void;
    onSelectDrawing: (drawingId: string | null) => void;
    selected: boolean;
  },
) {
  const toolbarPoint = points[0];
  return (
    <g>
      {points.map((point, index) => (
        <circle
          className="drawing-anchor"
          cx={point.x}
          cy={point.y}
          fill="#05070a"
          key={`${drawing.id}-${index}`}
          onMouseDown={(event) => options.onDragStart(drawing, "anchor", index, event)}
          pointerEvents="all"
          r={5}
          stroke={drawing.color}
          strokeWidth={2}
        />
      ))}
      {toolbarPoint && (
        <g transform={`translate(${toolbarPoint.x + 12} ${toolbarPoint.y + 12})`}>
          <rect
            fill="rgba(8, 12, 17, 0.96)"
            height={26}
            rx={5}
            stroke="rgba(255,255,255,0.14)"
            width={102}
          />
          <text fill="#cbd5e1" fontSize="10" fontWeight="700" x={9} y={17}>
            DRAG
          </text>
          <text
            cursor="pointer"
            fill="#fb7185"
            fontSize="13"
            fontWeight="800"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              options.onDeleteDrawing(drawing.id);
              options.onSelectDrawing(null);
            }}
            pointerEvents="all"
            x={82}
            y={18}
          >
            DEL
          </text>
        </g>
      )}
    </g>
  );
}

function renderPositionDrawing(
  drawing: ChartDrawing,
  first: { x: number; y: number },
  second: { x: number; y: number },
  width: number,
  options: {
    onDeleteDrawing: (drawingId: string) => void;
    onDragStart: (
      drawing: ChartDrawing,
      mode: DragState["mode"],
      pointIndex: number | null,
      event: MouseEvent<SVGElement>,
    ) => void;
    onSelectDrawing: (drawingId: string | null) => void;
    selected: boolean;
  },
) {
  const isLong = drawing.tool === "longPosition";
  const entryPrice = drawing.points[0].price;
  const targetPrice = drawing.points[1].price;
  const reward = Math.abs(targetPrice - entryPrice);
  const stopPrice = isLong ? entryPrice - reward * 0.65 : entryPrice + reward * 0.65;
  const stopY = first.y + (isLong ? Math.abs(second.y - first.y) * 0.65 : -Math.abs(second.y - first.y) * 0.65);
  const left = Math.min(first.x, second.x);
  const right = Math.max(first.x, second.x);
  const boxWidth = Math.max(72, right - left);
  const targetTop = Math.min(first.y, second.y);
  const targetHeight = Math.abs(second.y - first.y);
  const stopTop = Math.min(first.y, stopY);
  const stopHeight = Math.abs(stopY - first.y);
  const risk = Math.abs(entryPrice - stopPrice);
  const ratio = risk === 0 ? 0 : reward / risk;

  const handleBodyDown = (event: MouseEvent<SVGElement>) => {
    options.onDragStart(drawing, "body", null, event);
  };
  const handleSelect = (event: MouseEvent<SVGElement>) => {
    event.stopPropagation();
    options.onSelectDrawing(drawing.id);
  };

  return (
    <g key={drawing.id}>
      <rect
        cursor="move"
        fill="transparent"
        height={targetHeight + stopHeight + 24}
        onClick={handleSelect}
        onMouseDown={handleBodyDown}
        pointerEvents="all"
        width={boxWidth + 32}
        x={left - 16}
        y={Math.min(targetTop, stopTop) - 12}
      />
      <rect
        fill="rgba(34, 197, 94, 0.16)"
        height={targetHeight}
        stroke="#22c55e"
        strokeOpacity={options.selected ? 0.95 : 0.65}
        width={boxWidth}
        x={left}
        y={targetTop}
      />
      <rect
        fill="rgba(251, 113, 133, 0.15)"
        height={stopHeight}
        stroke="#fb7185"
        strokeOpacity={options.selected ? 0.95 : 0.65}
        width={boxWidth}
        x={left}
        y={stopTop}
      />
      <line stroke="#e2e8f0" strokeDasharray="4 4" x1={left} x2={right} y1={first.y} y2={first.y} />
      <line stroke="#22c55e" strokeDasharray="6 5" x1={left} x2={right} y1={second.y} y2={second.y} />
      <line stroke="#fb7185" strokeDasharray="6 5" x1={left} x2={right} y1={stopY} y2={stopY} />
      <rect
        fill="rgba(8, 12, 17, 0.95)"
        height={44}
        rx={5}
        stroke={isLong ? "#22c55e" : "#fb7185"}
        strokeOpacity="0.72"
        width={176}
        x={Math.min(width - 188, right + 10)}
        y={Math.min(targetTop, stopTop)}
      />
      <text fill={isLong ? "#bbf7d0" : "#fecdd3"} fontSize="11" fontWeight="900" x={Math.min(width - 176, right + 20)} y={Math.min(targetTop, stopTop) + 17}>
        {isLong ? "LONG" : "SHORT"} POSITION
      </text>
      <text fill="#cbd5e1" fontSize="10" fontWeight="700" x={Math.min(width - 176, right + 20)} y={Math.min(targetTop, stopTop) + 33}>
        RR {ratio.toFixed(2)} · Entry {formatPrice(entryPrice)}
      </text>
      {options.selected && renderAnchors(drawing, [first, second], options)}
    </g>
  );
}

function pointFromClient(
  clientX: number,
  clientY: number,
  frame: HTMLDivElement | null,
  chart: IChartApi | null,
  series: ISeriesApi<"Candlestick"> | null,
): DrawingPoint | null {
  if (!chart || !series || !frame) {
    return null;
  }
  const rect = frame.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const time = chart.timeScale().coordinateToTime(x);
  const price = series.coordinateToPrice(y);
  if (time == null || price == null || typeof time !== "number") {
    return null;
  }
  return { time, price };
}

function moveDrawing(dragState: DragState, point: DrawingPoint): ChartDrawing {
  if (dragState.mode === "anchor" && dragState.pointIndex != null) {
    const points = dragState.originalPoints.map((originalPoint, index) =>
      index === dragState.pointIndex ? point : originalPoint,
    );
    return { ...dragState.drawing, points };
  }

  const timeDelta = point.time - dragState.startPoint.time;
  const priceDelta = point.price - dragState.startPoint.price;
  const points = dragState.originalPoints.map((originalPoint) => ({
    time:
      dragState.drawing.tool === "horizontal"
        ? originalPoint.time
        : originalPoint.time + timeDelta,
    price: originalPoint.price + priceDelta,
  }));
  return { ...dragState.drawing, points };
}

function makeDrawing(
  tool: DraftDrawing["tool"],
  points: DrawingPoint[],
  label?: string,
): ChartDrawing {
  return {
    id: window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    tool,
    color: DRAWING_COLORS[tool],
    points,
    label,
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
    case "longPosition":
      return "long position anchors";
    case "measure":
      return "measurement anchors";
    case "shortPosition":
      return "short position anchors";
    case "text":
      return "a text label";
    default:
      return "a drawing";
  }
}

function chartStyleLabel(style: ChartStyle) {
  switch (style) {
    case "area":
      return "Area";
    case "heikinAshi":
      return "Heikin Ashi";
    case "line":
      return "Line";
    default:
      return "Candles";
  }
}

function formatDurationSeconds(seconds: number) {
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m`;
  }
  if (seconds < 86400) {
    return `${(seconds / 3600).toFixed(1)}h`;
  }
  return `${(seconds / 86400).toFixed(1)}d`;
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

function toOscillatorPath(
  values: LineData[],
  width: number,
  height: number,
  maxAbs: number,
) {
  if (values.length < 2) {
    return "";
  }
  const step = width / (values.length - 1);
  const middle = height / 2;
  const amplitude = height * 0.44;
  return values
    .map((point, index) => {
      const x = index * step;
      const y = middle - (Number(point.value) / maxAbs) * amplitude;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}
