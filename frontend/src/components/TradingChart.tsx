import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  Crosshair,
  Eye,
  EyeOff,
  LineChart,
  LockKeyhole,
  Magnet,
  Minus,
  MousePointer2,
  Square,
  Trash2,
  Type,
  UnlockKeyhole,
  X,
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
  Logical,
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
  type DrawingLineStyle,
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
  originalPixels: Array<{ x: number; y: number } | null>;
  pointIndex: number | null;
  startPixel: { x: number; y: number };
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
  const isDrawingPlacementMode = drawingTool !== "cursor" && drawingTool !== "crosshair";
  const drawingLayerCapturesPointer =
    dragState != null || isDrawingPlacementMode || selectedDrawingId != null;
  const selectedDrawing = useMemo(
    () => drawings.find((drawing) => drawing.id === selectedDrawingId) ?? null,
    [drawings, selectedDrawingId],
  );
  const activeHeaderCandle = tooltip?.candle ?? displayBars.at(-1) ?? null;
  const headerPriceTone =
    activeHeaderCandle == null
      ? "text-slate-300"
      : activeHeaderCandle.close >= activeHeaderCandle.open
        ? "text-emerald-300"
        : "text-rose-300";
  const drawingElements = buildDrawingElements({
    chart: chartRef.current,
    drawings,
    draftDrawing,
    frame: chartFrameRef.current,
    hoverPoint,
    onDeleteDrawing,
    onDragStart: startDrawingDrag,
    onSelectDrawing,
    interactive: !isDrawingPlacementMode,
    selectedDrawingId,
    series: candlesRef.current,
    version: plotVersion,
  });
  const floatingToolbarPosition =
    selectedDrawing && !isDrawingPlacementMode
      ? toolbarPositionFromDrawing(
          selectedDrawing,
          chartFrameRef.current,
          chartRef.current,
          candlesRef.current,
        )
      : null;

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
    let line: ISeriesApi<"Line"> | null = null;
    let area: ISeriesApi<"Area"> | null = null;
    try {
      line = chart.addLineSeries({
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
      area = chart.addAreaSeries({
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
    } catch {
      line = null;
      area = null;
    }
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
    const canShowLine = chartStyle === "line" && lineRef.current != null;
    const canShowArea = chartStyle === "area" && areaRef.current != null;
    candlesRef.current?.applyOptions({
      visible:
        chartStyle === "candles" ||
        chartStyle === "heikinAshi" ||
        (chartStyle === "line" && !canShowLine) ||
        (chartStyle === "area" && !canShowArea),
    });
    lineRef.current?.applyOptions({ visible: canShowLine });
    areaRef.current?.applyOptions({ visible: canShowArea });
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
      barsRef.current,
    );
    if (!point) {
      return;
    }

    if (drawingTool === "horizontal") {
      onAddDrawing(makeDrawing("horizontal", [point]));
      onDrawingToolChange("cursor");
      return;
    }

    if (drawingTool === "text") {
      onAddDrawing(makeDrawing("text", [point], "Text"));
      onDrawingToolChange("cursor");
      setDraftDrawing(null);
      setHoverPoint(null);
      return;
    }

    if (!draftDrawing || draftDrawing.tool !== drawingTool) {
      setDraftDrawing({ tool: drawingTool, point });
      return;
    }

    onAddDrawing(makeDrawing(drawingTool, [draftDrawing.point, point]));
    onDrawingToolChange("cursor");
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
        barsRef.current,
      );
      const pixel = pixelFromClient(event.clientX, event.clientY, chartFrameRef.current);
      if (!point || !pixel) {
        return;
      }
      const nextDrawing = moveDrawing(
        dragState,
        point,
        pixel,
        chartFrameRef.current,
        chartRef.current,
        candlesRef.current,
        barsRef.current,
      );
      if (!nextDrawing) {
        return;
      }
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
        barsRef.current,
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
      barsRef.current,
    );
    if (!point) {
      return;
    }
    if (drawing.locked) {
      onSelectDrawing(drawing.id);
      return;
    }
    const startPixel = pixelFromClient(event.clientX, event.clientY, chartFrameRef.current);
    if (!startPixel) {
      return;
    }
    const originalPixels = drawing.points.map((item) =>
      pixelFromPoint(item, chartRef.current, candlesRef.current),
    );
    onSelectDrawing(drawing.id);
    setDragState({
      drawing,
      mode,
      originalPoints: drawing.points.map((item) => ({ ...item })),
      originalPixels,
      pointIndex,
      startPixel,
      startPoint: point,
    });
  }

  function stopDrawingDrag() {
    setDragState(null);
  }

  function updateSelectedDrawing(patch: Partial<ChartDrawing>) {
    if (!selectedDrawing) {
      return;
    }
    onUpdateDrawing({
      ...selectedDrawing,
      ...patch,
    });
  }

  return (
    <section className="chart-stage">
      <div className="chart-stage-header">
        <div className="min-w-0 flex-1">
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
          <OhlcvStrip candle={activeHeaderCandle} tone={headerPriceTone} />
          <div className="chart-study-row">
            {activeOverlayIndicators.slice(0, 5).map((indicator) => (
              <span className="chart-study-pill" key={indicator.id}>
                <span
                  className="h-2 w-2 rounded-sm"
                  style={{ backgroundColor: indicator.color }}
                />
                <span>{indicator.label}</span>
                <strong>{latestIndicatorValue(indicator.data)?.toFixed(5) ?? "—"}</strong>
              </span>
            ))}
            {rsiData.length > 0 && (
              <span className="chart-study-pill text-fuchsia-100">
                <span className="h-2 w-2 rounded-sm bg-fuchsia-300" />
                <span>RSI</span>
                <strong>{latestIndicatorValue(rsiData)?.toFixed(2) ?? "—"}</strong>
              </span>
            )}
            {macdData && (
              <span className="chart-study-pill text-blue-100">
                <span className="h-2 w-2 rounded-sm bg-blue-300" />
                <span>MACD</span>
                <strong>{latestIndicatorValue(macdData.macd)?.toFixed(5) ?? "—"}</strong>
              </span>
            )}
          </div>
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
              className={`absolute inset-0 z-10 ${drawingLayerCapturesPointer ? "pointer-events-auto" : "pointer-events-none"} ${isDrawingPlacementMode ? "cursor-crosshair" : "cursor-default"}`}
              onMouseDown={handleDrawingClick}
              onMouseLeave={stopDrawingDrag}
              onMouseMove={handleDrawingMove}
              onMouseUp={stopDrawingDrag}
            >
              <svg className="h-full w-full overflow-visible pointer-events-none">
                {drawingElements}
              </svg>
            </div>
            {selectedDrawing && floatingToolbarPosition && !isDrawingPlacementMode && (
              <FloatingDrawingToolbar
                drawing={selectedDrawing}
                onChange={updateSelectedDrawing}
                onDelete={() => {
                  onDeleteDrawing(selectedDrawing.id);
                  onSelectDrawing(null);
                }}
                position={floatingToolbarPosition}
              />
            )}
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

    </section>
  );
}

function OhlcvStrip({
  candle,
  tone,
}: {
  candle: Candle | null;
  tone: string;
}) {
  const change =
    candle == null || candle.open === 0
      ? null
      : ((candle.close - candle.open) / candle.open) * 100;
  const hasVolume =
    candle != null && Number.isFinite(candle.volume) && candle.volume > 0;

  return (
    <div className="chart-ohlcv-row">
      <span className="chart-ohlcv-time">
        {candle ? new Date(candle.timestamp).toLocaleString() : "No candle"}
      </span>
      <OhlcvValue label="O" value={formatPrice(candle?.open)} />
      <OhlcvValue label="H" value={formatPrice(candle?.high)} tone="text-emerald-300" />
      <OhlcvValue label="L" value={formatPrice(candle?.low)} tone="text-rose-300" />
      <OhlcvValue label="C" value={formatPrice(candle?.close)} tone={tone} />
      {hasVolume && <OhlcvValue label="Vol" value={formatCompactNumber(candle.volume)} />}
      <span className={`chart-ohlcv-change ${tone}`}>
        {change == null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}
      </span>
    </div>
  );
}

function OhlcvValue({
  label,
  tone = "text-slate-200",
  value,
}: {
  label: string;
  tone?: string;
  value: string;
}) {
  return (
    <span className="chart-ohlcv-item">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </span>
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

function FloatingDrawingToolbar({
  drawing,
  onChange,
  onDelete,
  position,
}: {
  drawing: ChartDrawing;
  onChange: (patch: Partial<ChartDrawing>) => void;
  onDelete: () => void;
  position: { x: number; y: number };
}) {
  const lineStyle = drawing.lineStyle ?? "solid";
  const lineWidth = drawing.lineWidth ?? 2;
  const fillOpacity = Math.round((drawing.fillOpacity ?? 0.16) * 100);
  const canFill =
    drawing.tool === "rectangle" ||
    drawing.tool === "longPosition" ||
    drawing.tool === "shortPosition";
  const lineStyles: DrawingLineStyle[] = ["solid", "dashed", "dotted"];

  const stopToolbarEvent = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  return (
    <div
      className="chart-object-floating-toolbar"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={stopToolbarEvent}
      role="group"
      style={{ left: position.x, top: position.y }}
    >
      {drawing.tool === "text" && (
        <input
          aria-label="Text label"
          className="chart-object-floating-label-input"
          onChange={(event) => onChange({ label: event.target.value })}
          placeholder="Text"
          value={drawing.label ?? ""}
        />
      )}

      <label
        className="chart-object-floating-color"
        title="Color"
      >
        <span style={{ backgroundColor: drawing.color }} />
        <input
          aria-label="Drawing color"
          onChange={(event) => onChange({ color: event.target.value })}
          type="color"
          value={drawing.color}
        />
      </label>

      <div className="chart-object-floating-style" role="group">
        {lineStyles.map((style) => (
          <button
            className={lineStyle === style ? "active" : ""}
            key={style}
            onClick={() => onChange({ lineStyle: style })}
            title={`${style} line`}
            type="button"
          >
            <span className={`line-preview line-preview-${style}`} />
          </button>
        ))}
      </div>

      <label className="chart-object-floating-width" title="Line width">
        <span>{lineWidth.toFixed(1)}</span>
        <input
          max={6}
          min={1}
          onChange={(event) => onChange({ lineWidth: Number(event.target.value) })}
          step={0.5}
          type="range"
          value={lineWidth}
        />
      </label>

      {canFill && (
        <label className="chart-object-floating-width" title="Fill opacity">
          <span>{fillOpacity}%</span>
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

      <button
        className={`chart-object-floating-button ${drawing.visible === false ? "" : "active"}`}
        onClick={() => onChange({ visible: drawing.visible === false })}
        title={drawing.visible === false ? "Show drawing" : "Hide drawing"}
        type="button"
      >
        {drawing.visible === false ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
      <button
        className={`chart-object-floating-button ${drawing.locked ? "active-warn" : ""}`}
        onClick={() => onChange({ locked: !drawing.locked })}
        title={drawing.locked ? "Unlock drawing" : "Lock drawing"}
        type="button"
      >
        {drawing.locked ? <LockKeyhole size={14} /> : <UnlockKeyhole size={14} />}
      </button>
      <button
        className="chart-object-floating-button danger"
        onClick={onDelete}
        title="Delete drawing"
        type="button"
      >
        <X size={14} />
      </button>
    </div>
  );
}

function buildDrawingElements({
  chart,
  drawings,
  draftDrawing,
  frame,
  hoverPoint,
  interactive,
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
  interactive: boolean;
  selectedDrawingId: string | null;
  series: ISeriesApi<"Candlestick"> | null;
  version: number;
}) {
  if (!chart || !series || !frame) {
    return null;
  }

  const width = frame.clientWidth;
  const toPixel = (point: DrawingPoint) => {
    return pixelFromPoint(point, chart, series);
  };

  return (
    <>
      {drawings.filter((drawing) => drawing.visible !== false).map((drawing) =>
        renderDrawing(drawing, toPixel, width, {
          onDeleteDrawing,
          onDragStart,
          onSelectDrawing,
          interactive,
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
                interactive: false,
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
    interactive: boolean;
    selected: boolean;
  },
) {
  const color = drawing.color;
  const isLocked = drawing.locked === true;
  const isSelected = options.interactive && options.selected;
  const strokeDasharray = drawingStrokeDasharray(drawing);
  const selectedStrokeWidth = drawingStrokeWidth(drawing, isSelected);
  const hitTargetPointerEvents = options.interactive ? "all" : "none";
  const handleBodyDown = (event: MouseEvent<SVGElement>) => {
    if (!options.interactive) {
      return;
    }
    if (isLocked) {
      handleSelect(event);
      return;
    }
    options.onDragStart(drawing, "body", null, event);
  };
  const handleSelect = (event: MouseEvent<SVGElement>) => {
    if (!options.interactive) {
      return;
    }
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
          cursor={isLocked ? "default" : "ns-resize"}
          onMouseDown={handleBodyDown}
          onClick={handleSelect}
          pointerEvents={hitTargetPointerEvents}
          stroke="transparent"
          strokeWidth="14"
          x1={0}
          x2={width}
          y1={point.y}
          y2={point.y}
        />
        <line
          stroke={color}
          strokeDasharray={strokeDasharray ?? "5 5"}
          strokeOpacity={isSelected ? 1 : 0.82}
          strokeWidth={selectedStrokeWidth}
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
        {isSelected && !isLocked && renderAnchors(drawing, [point], options)}
      </g>
    );
  }

  if (drawing.tool === "text") {
    const point = toPixel(drawing.points[0]);
    if (!point) {
      return null;
    }
    const textLines = normalizeTextLines(drawing.label);
    const labelMetrics = textLabelMetrics(textLines);
    const labelX = point.x + 14;
    const labelY = point.y - labelMetrics.height - 16;
    return (
      <g
        cursor={isLocked ? "default" : "move"}
        key={drawing.id}
        onClick={handleSelect}
        onMouseDown={handleBodyDown}
        pointerEvents={hitTargetPointerEvents}
      >
        <rect
          fill="transparent"
          height={labelMetrics.height + 28}
          width={labelMetrics.width + 34}
          x={point.x - 8}
          y={labelY - 8}
        />
        <line
          stroke={color}
          strokeOpacity={isSelected ? 0.58 : 0.22}
          strokeWidth={1}
          x1={point.x}
          x2={labelX + 6}
          y1={point.y}
          y2={labelY + labelMetrics.height}
        />
        <rect
          fill={isSelected ? "rgba(8, 12, 17, 0.88)" : "rgba(8, 12, 17, 0.62)"}
          height={labelMetrics.height}
          rx={5}
          stroke={color}
          strokeOpacity={isSelected ? 0.82 : 0.2}
          strokeWidth={isSelected ? 1.5 : 1}
          width={labelMetrics.width}
          x={labelX}
          y={labelY}
        />
        <rect
          fill={color}
          height={Math.max(18, labelMetrics.height - 10)}
          opacity={isSelected ? 0.95 : 0.7}
          rx={2}
          width={3}
          x={labelX + 7}
          y={labelY + 5}
        />
        <text
          fill="rgba(5, 7, 10, 0.9)"
          fontSize="13"
          fontWeight="700"
          stroke="rgba(5, 7, 10, 0.82)"
          strokeLinejoin="round"
          strokeWidth={4}
          x={labelX + 18}
          y={labelY + 21}
        >
          {textLines.map((line, index) => (
            <tspan
              key={`${drawing.id}-halo-${index}`}
              x={labelX + 18}
              dy={index === 0 ? 0 : 17}
            >
              {line}
            </tspan>
          ))}
        </text>
        <text
          fill={color}
          fontSize="13"
          fontWeight="700"
          x={labelX + 18}
          y={labelY + 21}
        >
          {textLines.map((line, index) => (
            <tspan
              key={`${drawing.id}-text-${index}`}
              x={labelX + 18}
              dy={index === 0 ? 0 : 17}
            >
              {line}
            </tspan>
          ))}
        </text>
        <circle
          cx={point.x}
          cy={point.y}
          fill="#05070a"
          r={4}
          stroke={color}
          strokeOpacity={0.95}
          strokeWidth={1.5}
        />
        {isSelected && !isLocked && renderAnchors(drawing, [point], options)}
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
          pointerEvents={hitTargetPointerEvents}
          stroke="transparent"
          strokeWidth="14"
          x1={first.x}
          x2={second.x}
          y1={first.y}
          y2={second.y}
        />
        <line
          stroke={color}
          strokeDasharray={strokeDasharray ?? "6 5"}
          strokeLinecap="round"
          strokeWidth={selectedStrokeWidth}
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
        {isSelected && !isLocked && renderAnchors(drawing, [first, second], options)}
      </g>
    );
  }

  if (drawing.tool === "longPosition" || drawing.tool === "shortPosition") {
    const stopPoint = drawing.points[2] ?? defaultPositionStopPoint(drawing);
    const stop = toPixel(stopPoint);
    if (!stop) {
      return null;
    }
    const positionDrawing =
      drawing.points[2] == null
        ? { ...drawing, points: [drawing.points[0], drawing.points[1], stopPoint] }
        : drawing;
    return renderPositionDrawing(positionDrawing, first, second, stop, width, options);
  }

  if (drawing.tool === "rectangle") {
    const x = Math.min(first.x, second.x);
    const y = Math.min(first.y, second.y);
    const rectWidth = Math.abs(second.x - first.x);
    const rectHeight = Math.abs(second.y - first.y);
    return (
      <g key={drawing.id}>
        <rect
          cursor={isLocked ? "default" : "move"}
          fill={colorWithOpacity(color, drawing.fillOpacity ?? 0.16)}
          height={rectHeight}
          onClick={handleSelect}
          onMouseDown={handleBodyDown}
          pointerEvents={hitTargetPointerEvents}
          stroke={color}
          strokeOpacity={isSelected ? 1 : 0.82}
          strokeDasharray={strokeDasharray}
          strokeWidth={selectedStrokeWidth}
          width={rectWidth}
          x={x}
          y={y}
        />
        {isSelected && (
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
            {!isLocked && renderAnchors(drawing, [first, second], options)}
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
          cursor={isLocked ? "default" : "move"}
          fill="transparent"
          height={Math.abs(second.y - first.y) + 20}
          onClick={handleSelect}
          onMouseDown={handleBodyDown}
          pointerEvents={hitTargetPointerEvents}
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
                strokeDasharray={strokeDasharray}
                strokeOpacity={isSelected || level === 0 || level === 1 ? 0.9 : 0.55}
                strokeWidth={level === 0 || level === 1 ? selectedStrokeWidth : Math.max(1, selectedStrokeWidth - 0.75)}
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
        {isSelected && !isLocked && renderAnchors(drawing, [first, second], options)}
      </g>
    );
  }

  return (
    <g key={drawing.id}>
      <line
        cursor={isLocked ? "default" : "move"}
        onClick={handleSelect}
        onMouseDown={handleBodyDown}
        pointerEvents={hitTargetPointerEvents}
        stroke="transparent"
        strokeWidth="14"
        x1={first.x}
        x2={second.x}
        y1={first.y}
        y2={second.y}
      />
      <line
        stroke={color}
        strokeDasharray={strokeDasharray}
        strokeLinecap="round"
        strokeOpacity={isSelected ? 1 : 0.9}
        strokeWidth={selectedStrokeWidth}
        x1={first.x}
        x2={second.x}
        y1={first.y}
        y2={second.y}
      />
      {isSelected && !isLocked && renderAnchors(drawing, [first, second], options)}
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
  return (
    <g>
      {points.map((point, index) => (
        <g
          className="drawing-anchor-group"
          cursor="grab"
          key={`${drawing.id}-${index}`}
          onMouseDown={(event) => options.onDragStart(drawing, "anchor", index, event)}
          pointerEvents="all"
        >
          <circle
            cx={point.x}
            cy={point.y}
            fill="transparent"
            r={13}
          />
          <circle
            className="drawing-anchor"
            cx={point.x}
            cy={point.y}
            fill="#05070a"
            pointerEvents="none"
            r={5}
            stroke={drawing.color}
            strokeWidth={2}
          />
          <circle
            cx={point.x}
            cy={point.y}
            fill="none"
            pointerEvents="none"
            r={9}
            stroke={drawing.color}
            strokeOpacity="0.22"
            strokeWidth={1}
          />
        </g>
      ))}
    </g>
  );
}

function renderPositionDrawing(
  drawing: ChartDrawing,
  first: { x: number; y: number },
  second: { x: number; y: number },
  stop: { x: number; y: number },
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
    interactive: boolean;
    selected: boolean;
  },
) {
  const isLong = drawing.tool === "longPosition";
  const isLocked = drawing.locked === true;
  const isSelected = options.interactive && options.selected;
  const strokeWidth = drawingStrokeWidth(drawing, isSelected);
  const hitTargetPointerEvents = options.interactive ? "all" : "none";
  const dash = drawingStrokeDasharray(drawing);
  const fillOpacity = drawing.fillOpacity ?? 0.16;
  const entryPrice = drawing.points[0].price;
  const targetPrice = drawing.points[1].price;
  const stopPrice = drawing.points[2].price;
  const reward = Math.abs(targetPrice - entryPrice);
  const left = Math.min(first.x, second.x, stop.x);
  const right = Math.max(first.x, second.x, stop.x);
  const boxWidth = Math.max(72, right - left);
  const targetTop = Math.min(first.y, second.y);
  const targetHeight = Math.abs(second.y - first.y);
  const stopTop = Math.min(first.y, stop.y);
  const stopHeight = Math.abs(stop.y - first.y);
  const risk = Math.abs(entryPrice - stopPrice);
  const ratio = risk === 0 ? 0 : reward / risk;
  const hitTop = Math.min(first.y, second.y, stop.y);
  const hitBottom = Math.max(first.y, second.y, stop.y);
  const labelX = Math.min(width - 204, right + 10);
  const labelY = clamp(hitTop, 10, Math.max(10, hitBottom - 46));

  const handleBodyDown = (event: MouseEvent<SVGElement>) => {
    if (!options.interactive) {
      return;
    }
    if (isLocked) {
      handleSelect(event);
      return;
    }
    options.onDragStart(drawing, "body", null, event);
  };
  const handleSelect = (event: MouseEvent<SVGElement>) => {
    if (!options.interactive) {
      return;
    }
    event.stopPropagation();
    options.onSelectDrawing(drawing.id);
  };

  return (
    <g key={drawing.id}>
      <rect
        cursor={isLocked ? "default" : "move"}
        fill="transparent"
        height={hitBottom - hitTop + 24}
        onClick={handleSelect}
        onMouseDown={handleBodyDown}
        pointerEvents={hitTargetPointerEvents}
        width={boxWidth + 32}
        x={left - 16}
        y={hitTop - 12}
      />
      <rect
        fill={`rgba(34, 197, 94, ${fillOpacity})`}
        height={targetHeight}
        stroke="#22c55e"
        strokeDasharray={dash}
        strokeOpacity={isSelected ? 0.95 : 0.65}
        strokeWidth={strokeWidth}
        width={boxWidth}
        x={left}
        y={targetTop}
      />
      <rect
        fill={`rgba(251, 113, 133, ${fillOpacity})`}
        height={stopHeight}
        stroke="#fb7185"
        strokeDasharray={dash}
        strokeOpacity={isSelected ? 0.95 : 0.65}
        strokeWidth={strokeWidth}
        width={boxWidth}
        x={left}
        y={stopTop}
      />
      <line stroke="#e2e8f0" strokeDasharray="4 4" strokeWidth={strokeWidth} x1={left} x2={right} y1={first.y} y2={first.y} />
      <line stroke="#22c55e" strokeDasharray="6 5" strokeWidth={strokeWidth} x1={left} x2={right} y1={second.y} y2={second.y} />
      <line stroke="#fb7185" strokeDasharray="6 5" strokeWidth={strokeWidth} x1={left} x2={right} y1={stop.y} y2={stop.y} />
      <text fill="#dbeafe" fontSize="10" fontWeight="800" x={left + 8} y={first.y - 7}>
        ENTRY {formatPrice(entryPrice)}
      </text>
      <text fill="#bbf7d0" fontSize="10" fontWeight="800" x={left + 8} y={second.y - 7}>
        TP {formatPrice(targetPrice)}
      </text>
      <text fill="#fecdd3" fontSize="10" fontWeight="800" x={left + 8} y={stop.y - 7}>
        SL {formatPrice(stopPrice)}
      </text>
      <rect
        fill="rgba(8, 12, 17, 0.95)"
        height={44}
        rx={5}
        stroke={isLong ? "#22c55e" : "#fb7185"}
        strokeOpacity="0.72"
        width={192}
        x={labelX}
        y={labelY}
      />
      <text fill={isLong ? "#bbf7d0" : "#fecdd3"} fontSize="11" fontWeight="900" x={labelX + 10} y={labelY + 17}>
        {isLong ? "LONG" : "SHORT"} POSITION
      </text>
      <text fill="#cbd5e1" fontSize="10" fontWeight="700" x={labelX + 10} y={labelY + 33}>
        RR {ratio.toFixed(2)} · Risk {formatPrice(risk)}
      </text>
      {isSelected && !isLocked && renderAnchors(drawing, [first, second, stop], options)}
    </g>
  );
}

function toolbarPositionFromDrawing(
  drawing: ChartDrawing,
  frame: HTMLDivElement | null,
  chart: IChartApi | null,
  series: ISeriesApi<"Candlestick"> | null,
): { x: number; y: number } | null {
  if (!frame || !chart || !series) {
    return null;
  }

  const pixels = drawing.points
    .map((point) => pixelFromPoint(point, chart, series))
    .filter((point): point is { x: number; y: number } => point != null);

  if (pixels.length === 0) {
    return null;
  }

  const toolbarWidth = drawing.tool === "text" ? 380 : 332;
  const toolbarHeight =
    drawing.tool === "rectangle" ||
    drawing.tool === "longPosition" ||
    drawing.tool === "shortPosition"
      ? 88
      : 48;
  const minX = Math.min(...pixels.map((point) => point.x));
  const maxX = Math.max(...pixels.map((point) => point.x));
  const minY = Math.min(...pixels.map((point) => point.y));
  const maxY = Math.max(...pixels.map((point) => point.y));
  const maxLeft = Math.max(12, frame.clientWidth - toolbarWidth - 12);
  const maxTop = Math.max(12, frame.clientHeight - toolbarHeight - 12);

  if (drawing.tool === "horizontal") {
    return {
      x: clamp(frame.clientWidth - toolbarWidth - 14, 12, maxLeft),
      y: clamp(minY - toolbarHeight - 10, 12, maxTop),
    };
  }

  const rightX = maxX + 14;
  const leftX = minX - toolbarWidth - 14;
  const x = rightX <= maxLeft ? rightX : leftX;
  const y =
    drawing.tool === "text"
      ? minY - toolbarHeight - 34
      : Math.min(minY, maxY) - toolbarHeight - 12;

  return {
    x: clamp(x, 12, maxLeft),
    y: clamp(y, 12, maxTop),
  };
}

function normalizeTextLines(label: string | undefined) {
  const lines = (label?.trim() || "Text")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4);

  return lines.length > 0 ? lines : ["Text"];
}

function textLabelMetrics(lines: string[]) {
  const longest = Math.max(...lines.map((line) => line.length), 4);
  return {
    height: lines.length * 17 + 15,
    width: clamp(longest * 7.4 + 38, 78, 280),
  };
}

function pointFromClient(
  clientX: number,
  clientY: number,
  frame: HTMLDivElement | null,
  chart: IChartApi | null,
  series: ISeriesApi<"Candlestick"> | null,
  bars: Candle[] = [],
): DrawingPoint | null {
  const pixel = pixelFromClient(clientX, clientY, frame);
  if (!pixel) {
    return null;
  }
  return pointFromPixel(pixel.x, pixel.y, frame, chart, series, bars);
}

function pixelFromClient(
  clientX: number,
  clientY: number,
  frame: HTMLDivElement | null,
): { x: number; y: number } | null {
  if (!frame) {
    return null;
  }
  const rect = frame.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

function pointFromPixel(
  x: number,
  y: number,
  frame: HTMLDivElement | null,
  chart: IChartApi | null,
  series: ISeriesApi<"Candlestick"> | null,
  bars: Candle[] = [],
): DrawingPoint | null {
  if (!chart || !series || !frame) {
    return null;
  }
  const clampedX = clamp(x, 0, Math.max(0, frame.clientWidth - 1));
  const clampedY = clamp(y, 0, Math.max(0, frame.clientHeight - 1));
  const logicalValue = chart.timeScale().coordinateToLogical(clampedX);
  const logical = logicalValue == null ? null : Number(logicalValue);
  const time = chart.timeScale().coordinateToTime(clampedX);
  const price = series.coordinateToPrice(clampedY);
  if (price == null) {
    return null;
  }
  if (time != null && typeof time === "number") {
    return { logical: logical ?? undefined, time, price };
  }
  if (logical == null) {
    return null;
  }
  return {
    logical,
    time: estimateTimeFromLogical(logical, bars),
    price,
  };
}

function pixelFromPoint(
  point: DrawingPoint,
  chart: IChartApi | null,
  series: ISeriesApi<"Candlestick"> | null,
): { x: number; y: number } | null {
  if (!chart || !series) {
    return null;
  }
  const x =
    point.logical == null
      ? chart.timeScale().timeToCoordinate(point.time as UTCTimestamp)
      : chart.timeScale().logicalToCoordinate(point.logical as Logical);
  const y = series.priceToCoordinate(point.price);
  if (x == null || y == null) {
    return null;
  }
  return { x, y };
}

function estimateTimeFromLogical(logical: number, bars: Candle[]) {
  const sortedBars = bars
    .filter((bar) => Number.isFinite(bar.time))
    .sort((left, right) => left.time - right.time);
  if (sortedBars.length === 0) {
    return Math.max(0, Math.round(logical));
  }

  const barSeconds = inferBarSeconds(sortedBars);
  if (logical <= 0) {
    return Math.max(0, Math.round(sortedBars[0].time + logical * barSeconds));
  }

  const lowerIndex = Math.floor(logical);
  const upperIndex = Math.ceil(logical);
  if (lowerIndex >= 0 && upperIndex < sortedBars.length) {
    const lower = sortedBars[lowerIndex].time;
    const upper = sortedBars[upperIndex].time;
    return Math.round(lower + (upper - lower) * (logical - lowerIndex));
  }

  if (lowerIndex < sortedBars.length) {
    return Math.round(sortedBars[lowerIndex].time);
  }

  const lastIndex = sortedBars.length - 1;
  return Math.round(sortedBars[lastIndex].time + (logical - lastIndex) * barSeconds);
}

function inferBarSeconds(bars: Candle[]) {
  const gaps = bars
    .slice(1, Math.min(bars.length, 80))
    .map((bar, index) => bar.time - bars[index].time)
    .filter((gap) => Number.isFinite(gap) && gap > 0)
    .sort((left, right) => left - right);
  return gaps[Math.floor(gaps.length / 2)] ?? 60;
}

function moveDrawing(
  dragState: DragState,
  point: DrawingPoint,
  pixel: { x: number; y: number },
  frame: HTMLDivElement | null,
  chart: IChartApi | null,
  series: ISeriesApi<"Candlestick"> | null,
  bars: Candle[] = [],
): ChartDrawing | null {
  if (dragState.mode === "anchor" && dragState.pointIndex != null) {
    const points = dragState.originalPoints.map((originalPoint, index) =>
      index === dragState.pointIndex ? point : originalPoint,
    );
    return { ...dragState.drawing, points };
  }

  const xDelta = pixel.x - dragState.startPixel.x;
  const yDelta = pixel.y - dragState.startPixel.y;
  const points = dragState.originalPoints.map((originalPoint, index) => {
    const originalPixel = dragState.originalPixels[index];
    if (!originalPixel) {
      const priceDelta = point.price - dragState.startPoint.price;
      return {
        time: originalPoint.time,
        price: originalPoint.price + priceDelta,
      };
    }
    const moved = pointFromPixel(
      dragState.drawing.tool === "horizontal" ? originalPixel.x : originalPixel.x + xDelta,
      originalPixel.y + yDelta,
      frame,
      chart,
      series,
      bars,
    );
    return moved ?? originalPoint;
  });
  return { ...dragState.drawing, points };
}

function defaultPositionStopPoint(drawing: ChartDrawing): DrawingPoint {
  const entry = drawing.points[0];
  const target = drawing.points[1] ?? entry;
  const reward = Math.abs(target.price - entry.price);
  const fallbackRisk = Math.max(Math.abs(entry.price) * 0.001, 0.0001);
  const risk = reward > 0 ? reward : fallbackRisk;
  const price =
    drawing.tool === "shortPosition"
      ? entry.price + risk
      : entry.price - risk;

  return {
    logical: target.logical,
    time: target.time,
    price,
  };
}

function makeDrawing(
  tool: DraftDrawing["tool"],
  points: DrawingPoint[],
  label?: string,
): ChartDrawing {
  const normalizedPoints =
    (tool === "longPosition" || tool === "shortPosition") && points.length === 2
      ? [
          points[0],
          points[1],
          defaultPositionStopPoint({
            id: "draft-position",
            tool,
            color: DRAWING_COLORS[tool],
            points,
            createdAt: "",
          }),
        ]
      : points;

  return {
    id: window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    tool,
    color: DRAWING_COLORS[tool],
    fillOpacity: tool === "rectangle" ? 0.16 : undefined,
    lineStyle: tool === "horizontal" || tool === "measure" ? "dashed" : "solid",
    lineWidth: tool === "horizontal" ? 1.5 : 2,
    locked: false,
    points: normalizedPoints,
    label,
    createdAt: new Date().toISOString(),
    visible: true,
  };
}

function drawingStrokeDasharray(drawing: ChartDrawing) {
  switch (drawing.lineStyle) {
    case "dotted":
      return "2 4";
    case "dashed":
      return "6 5";
    default:
      return undefined;
  }
}

function drawingStrokeWidth(drawing: ChartDrawing, selected: boolean) {
  const width = drawing.lineWidth ?? 2;
  return selected ? Math.min(width + 0.75, 6) : width;
}

function colorWithOpacity(color: string, opacity: number) {
  const normalizedOpacity = clamp(opacity, 0, 1);
  if (!color.startsWith("#")) {
    return color;
  }
  const hex = color.slice(1);
  const expanded =
    hex.length === 3
      ? hex
          .split("")
          .map((char) => char + char)
          .join("")
      : hex;
  if (expanded.length !== 6) {
    return color;
  }
  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);
  if ([red, green, blue].some((value) => Number.isNaN(value))) {
    return color;
  }
  return `rgba(${red}, ${green}, ${blue}, ${normalizedOpacity})`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function resolveTooltip(
  param: MouseEventParams<Time>,
  bars: Candle[],
): TooltipData | null {
  if (param.time == null) {
    return null;
  }
  const time = Number(param.time);
  const candle = bars.find((bar) => bar.time === time);
  if (!candle) {
    return null;
  }
  return {
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

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    notation: "compact",
  }).format(value);
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
