import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  Eye,
  EyeOff,
  LockKeyhole,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  UnlockKeyhole,
  X,
} from "lucide-react";
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
  aggregateBars,
  atrSeries,
  bucketTime,
  buildIndicatorDefinitions,
  DEFAULT_FIB_BACKGROUND_OPACITY,
  DEFAULT_FIB_LEVELS,
  defaultRiskRewardStopPoint,
  indicatorDisplayName,
  isRiskRewardTool,
  latestIndicatorValue,
  mergeIndicatorSettings,
  macdSeries,
  momentumSeries,
  normalizeRiskRewardDrawing,
  normalizeRiskRewardPoints,
  normalizeFibLevels,
  rsiSeries,
  toCandles,
  type ChartDrawing,
  type ChartIndicatorInstance,
  type ChartStyle,
  type ChartTimeframe,
  type DrawingLineStyle,
  type DrawingPoint,
  type DrawingTool,
  type FibLevel,
  type MacdData,
} from "../lib/charting";
import type { ChartVisualSettings } from "../lib/chartSettings";
import { formatPrice } from "../lib/format";
import { formatMarketSymbol, symbolBadge } from "../lib/symbols";
import { ThemedColorPicker } from "./ThemedColorPicker";
import { ThemedSelect } from "./ThemedSelect";

const DRAWING_PRESETS_KEY = "edgelab.drawing-presets.v1";
const FIB_PRESETS_KEY = "edgelab.fib-presets.v1";
const DEFAULT_LABEL_BACKGROUND_OPACITY = 0.92;

type Props = {
  bars: Candle[];
  chartSettings: ChartVisualSettings;
  chartStyle: ChartStyle;
  drawingTool: DrawingTool;
  drawings: ChartDrawing[];
  executions: Execution[];
  indicatorInstances: ChartIndicatorInstance[];
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

type LabelableDrawingTool = "horizontal" | "rectangle" | "trendline";

type DrawingPreset = {
  id: string;
  color: string;
  fillOpacity?: number;
  label: string;
  labelBackgroundOpacity?: number;
  lineStyle?: DrawingLineStyle;
  lineWidth?: number;
  name: string;
  tool: LabelableDrawingTool;
  updatedAt: string;
};

type FibPreset = {
  extendLeft: boolean;
  extendRight: boolean;
  id: string;
  levels: FibLevel[];
  name: string;
  updatedAt: string;
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

const RECTANGLE_EDGE_HANDLE = {
  left: -1,
  right: -2,
  top: -3,
  bottom: -4,
} as const;

export function TradingChart({
  bars,
  chartSettings,
  chartStyle,
  drawingTool,
  drawings,
  executions,
  indicatorInstances,
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
  const settingPriceLinesRef = useRef<IPriceLine[]>([]);
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
    () =>
      applyCandleVisualSettings(
        toCandles(displayBars, chartStyle === "heikinAshi"),
        displayBars,
        chartSettings,
      ),
    [chartSettings, chartStyle, displayBars],
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
              ? colorWithOpacity(chartSettings.bodyUpColor, 0.22)
              : colorWithOpacity(chartSettings.bodyDownColor, 0.24),
        }),
      ),
    [chartSettings.bodyDownColor, chartSettings.bodyUpColor, displayBars],
  );

  const indicatorDefinitions = useMemo(
    () => buildIndicatorDefinitions(displayBars, indicatorInstances),
    [displayBars, indicatorInstances],
  );

  const visibleIndicatorInstances = useMemo(
    () => indicatorInstances.filter((indicator) => indicator.visible !== false),
    [indicatorInstances],
  );

  const rsiStudies = useMemo(
    () =>
      visibleIndicatorInstances
        .filter((indicator) => indicator.kind === "rsi")
        .map((indicator) => {
          const settings = mergeIndicatorSettings(indicator.kind, indicator.settings);
          return {
            color: settings.color,
            data: rsiSeries(displayBars, settings.period),
            id: indicator.id,
            label: indicatorDisplayName({ ...indicator, settings }),
          };
        }),
    [displayBars, visibleIndicatorInstances],
  );

  const macdStudies = useMemo(
    () =>
      visibleIndicatorInstances
        .filter((indicator) => indicator.kind === "macd")
        .map((indicator) => {
          const settings = mergeIndicatorSettings(indicator.kind, indicator.settings);
          return {
            color: settings.color,
            data: macdSeries(
              displayBars,
              settings.fastPeriod ?? 12,
              settings.slowPeriod ?? 26,
              settings.signalPeriod ?? 9,
            ),
            histogramColor: settings.histogramColor ?? "#94a3b8",
            id: indicator.id,
            label: indicatorDisplayName({ ...indicator, settings }),
            signalColor: settings.signalColor ?? "#f59e0b",
          };
        }),
    [displayBars, visibleIndicatorInstances],
  );

  const atrStudies = useMemo(
    () =>
      visibleIndicatorInstances
        .filter((indicator) => indicator.kind === "atr")
        .map((indicator) => {
          const settings = mergeIndicatorSettings(indicator.kind, indicator.settings);
          return {
            color: settings.color,
            data: atrSeries(displayBars, settings.period),
            id: indicator.id,
            label: indicatorDisplayName({ ...indicator, settings }),
          };
        }),
    [displayBars, visibleIndicatorInstances],
  );

  const momentumStudies = useMemo(
    () =>
      visibleIndicatorInstances
        .filter((indicator) => indicator.kind === "momentum")
        .map((indicator) => {
          const settings = mergeIndicatorSettings(indicator.kind, indicator.settings);
          return {
            color: settings.color,
            data: momentumSeries(displayBars, settings.period),
            id: indicator.id,
            label: indicatorDisplayName({ ...indicator, settings }),
          };
        }),
    [displayBars, visibleIndicatorInstances],
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
  const headerPriceTone = candleChangeTone(activeHeaderCandle);
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
    const priceFormat = priceFormatFromPrecision(chartSettings.pricePrecision);
    chartRef.current?.applyOptions({
      crosshair: {
        mode: chartSettings.crosshairVisible
          ? CrosshairMode.Normal
          : CrosshairMode.Hidden,
        horzLine: {
          color: chartSettings.crosshairColor,
          labelVisible: chartSettings.crosshairVisible,
          visible: chartSettings.crosshairVisible,
        },
        vertLine: {
          color: chartSettings.crosshairColor,
          labelVisible: chartSettings.crosshairVisible,
          visible: chartSettings.crosshairVisible,
        },
      },
      grid: {
        horzLines: {
          color: colorWithOpacity(chartSettings.gridColor, 0.28),
          visible: chartSettings.gridMode === "both" || chartSettings.gridMode === "horizontal",
        },
        vertLines: {
          color: colorWithOpacity(chartSettings.gridColor, 0.22),
          visible: chartSettings.gridMode === "both" || chartSettings.gridMode === "vertical",
        },
      },
      layout: {
        background: { color: chartSettings.backgroundColor },
        fontSize: chartSettings.textSize,
        textColor: chartSettings.textColor,
      },
      localization: {
        dateFormat: toLightweightDateFormat(chartSettings.dateFormat),
        priceFormatter: (price: number) =>
          price.toFixed(chartSettings.pricePrecision),
        timeFormatter: (time: Time) => formatChartTime(time, chartSettings),
      },
      leftPriceScale: {
        alignLabels: chartSettings.noOverlappingLabels,
        borderColor: colorWithOpacity(chartSettings.textColor, 0.16),
        borderVisible: chartSettings.priceScaleBorderVisible,
        visible: chartSettings.scalePlacement === "left",
      },
      rightPriceScale: {
        alignLabels: chartSettings.noOverlappingLabels,
        borderColor: colorWithOpacity(chartSettings.textColor, 0.16),
        borderVisible: chartSettings.priceScaleBorderVisible,
        visible: chartSettings.scalePlacement !== "left",
      },
      timeScale: {
        borderColor: colorWithOpacity(chartSettings.textColor, 0.16),
        borderVisible: chartSettings.timeScaleBorderVisible,
      },
      watermark: {
        color: colorWithOpacity(chartSettings.textColor, 0.08),
        fontSize: Math.max(26, chartSettings.textSize * 4),
        text:
          chartSettings.watermark === "symbol"
            ? formatMarketSymbol(symbol)
            : chartSettings.watermarkText,
        visible: chartSettings.watermark !== "hidden",
      },
    });
    candlesRef.current?.applyOptions({
      borderDownColor: chartSettings.borderDownColor,
      borderUpColor: chartSettings.borderUpColor,
      borderVisible: chartSettings.borderVisible,
      downColor: chartSettings.bodyVisible
        ? chartSettings.bodyDownColor
        : colorWithOpacity(chartSettings.bodyDownColor, 0.08),
      lastValueVisible: chartSettings.symbolLine !== "hidden",
      priceFormat,
      priceLineVisible: chartSettings.symbolLine === "valueLine",
      upColor: chartSettings.bodyVisible
        ? chartSettings.bodyUpColor
        : colorWithOpacity(chartSettings.bodyUpColor, 0.08),
      wickDownColor: chartSettings.wickDownColor,
      wickUpColor: chartSettings.wickUpColor,
      wickVisible: chartSettings.wickVisible,
    });
    lineRef.current?.applyOptions({
      lastValueVisible: chartSettings.symbolLine !== "hidden",
      priceFormat,
      priceLineVisible: chartSettings.symbolLine === "valueLine",
    });
    areaRef.current?.applyOptions({
      lastValueVisible: chartSettings.symbolLine !== "hidden",
      priceFormat,
      priceLineVisible: chartSettings.symbolLine === "valueLine",
    });
    volumeRef.current?.applyOptions({ visible: chartSettings.volume });
    setPlotVersion((value) => value + 1);
  }, [chartSettings, symbol]);

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
          lastValueVisible: chartSettings.indicatorValues,
          priceFormat: {
            type: "price",
            precision: chartSettings.pricePrecision,
            minMove: minMoveFromPrecision(chartSettings.pricePrecision),
          },
        });
      }
      indicatorRefs.current[indicator.id].applyOptions({
        color: indicator.color,
        lastValueVisible: chartSettings.indicatorValues,
        lineStyle: indicator.lineStyle ?? 0,
        lineWidth: indicator.lineWidth ?? 2,
        priceFormat: priceFormatFromPrecision(chartSettings.pricePrecision),
      });
      indicatorRefs.current[indicator.id].setData(toAscendingSeriesData(indicator.data));
    });
  }, [chartSettings.indicatorValues, chartSettings.pricePrecision, indicatorDefinitions]);

  useEffect(() => {
    const series = candlesRef.current;
    if (!series) {
      return;
    }
    settingPriceLinesRef.current.forEach((line) => series.removePriceLine(line));
    settingPriceLinesRef.current = [];

    const addSettingLine = (
      price: number | null,
      title: string,
      mode: "hidden" | "value" | "valueLine",
      color: string,
    ) => {
      if (price == null || mode === "hidden") {
        return;
      }
      settingPriceLinesRef.current.push(
        series.createPriceLine({
          axisLabelVisible: true,
          color,
          lineStyle: 2,
          lineVisible: mode === "valueLine",
          lineWidth: 1,
          price,
          title,
        }),
      );
    };

    addSettingLine(
      previousDayClose(displayBars),
      "Prev close",
      chartSettings.previousDayClose,
      "#94a3b8",
    );
    const extremes = highLowRange(displayBars);
    addSettingLine(extremes.high, "High", chartSettings.highLowLabels, chartSettings.bodyUpColor);
    addSettingLine(extremes.low, "Low", chartSettings.highLowLabels, chartSettings.bodyDownColor);

    return () => {
      settingPriceLinesRef.current.forEach((line) => series.removePriceLine(line));
      settingPriceLinesRef.current = [];
    };
  }, [
    chartSettings.bodyDownColor,
    chartSettings.bodyUpColor,
    chartSettings.highLowLabels,
    chartSettings.previousDayClose,
    displayBars,
  ]);

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

    const addLine = (
      price: number | null | undefined,
      color: string,
      title: string,
      lineStyle = 2,
    ) => {
      if (price == null) {
        return;
      }
      priceLinesRef.current.push(
        series.createPriceLine({
          price,
          color,
          title,
          lineWidth: 1,
          lineStyle,
          axisLabelVisible: true,
        }),
      );
    };

    if (position && position.side !== "FLAT" && position.quantity > 0) {
      addLine(position.avg_price, "#a8b3c7", `${position.side} avg`, 0);
      addLine(position.stop_loss, "#fb7185", "SL", 2);
      addLine(position.take_profit, "#22c55e", "TP", 2);
    }

    orders
      .filter((order) => order.status === "PENDING")
      .forEach((order) => {
        const orderLabel = `P#${order.id}`;
        addLine(
          order.limit_price ?? order.stop_price,
          order.side === "BUY" ? "#32d3ee" : "#f59e0b",
          `${orderLabel} ${order.side} ${order.order_type}`,
          2,
        );
        addLine(order.stop_loss, "#fb7185", `${orderLabel} SL`, 1);
        addLine(order.take_profit, "#22c55e", `${orderLabel} TP`, 1);
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

  const unlockedDrawingsCount = drawings.filter((drawing) => !drawing.locked).length;

  return (
    <section className="chart-stage">
      <div className="chart-stage-header">
        <div className="min-w-0">
          <div className="min-w-0 flex-1">
            {chartSettings.title && (
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-md bg-white text-sm font-black text-ink-950">
                  {symbolBadge(symbol)}
                </div>
                <div>
                  <div className="flex items-center gap-2 text-base font-semibold text-white">
                    {formatMarketSymbol(symbol)}
                  </div>
                  <div className="text-xs text-slate-400">
                    {datasetTimeframe ?? timeframe} source / {timeframe} view / {chartStyleLabel(chartStyle)}
                  </div>
                </div>
              </div>
            )}
            {(chartSettings.chartValues ||
              chartSettings.barChangeValues ||
              chartSettings.volume) && (
              <OhlcvStrip
                candle={activeHeaderCandle}
                showChange={chartSettings.barChangeValues}
                showOhlc={chartSettings.chartValues}
                showVolume={chartSettings.volume}
                tone={headerPriceTone}
              />
            )}
            {(chartSettings.indicatorTitles || chartSettings.indicatorValues) && (
              <div className="chart-study-row">
                {activeOverlayIndicators.slice(0, 5).map((indicator) => (
                  <span className="chart-study-pill" key={indicator.id}>
                    <span
                      className="h-2 w-2 rounded-sm"
                      style={{ backgroundColor: indicator.color }}
                    />
                    {chartSettings.indicatorTitles && <span>{indicator.label}</span>}
                    {chartSettings.indicatorValues && (
                      <strong>{latestIndicatorValue(indicator.data)?.toFixed(5) ?? "—"}</strong>
                    )}
                  </span>
                ))}
                {rsiStudies.map((study) =>
                  study.data.length > 0 ? (
                    <span className="chart-study-pill" key={`header-${study.id}`}>
                      <span
                        className="h-2 w-2 rounded-sm"
                        style={{ backgroundColor: study.color }}
                      />
                      {chartSettings.indicatorTitles && <span>{study.label}</span>}
                      {chartSettings.indicatorValues && (
                        <strong>{latestIndicatorValue(study.data)?.toFixed(2) ?? "—"}</strong>
                      )}
                    </span>
                  ) : null,
                )}
                {macdStudies.map((study) => (
                  <span className="chart-study-pill" key={`header-${study.id}`}>
                    <span
                      className="h-2 w-2 rounded-sm"
                      style={{ backgroundColor: study.color }}
                    />
                    {chartSettings.indicatorTitles && <span>{study.label}</span>}
                    {chartSettings.indicatorValues && (
                      <strong>{latestIndicatorValue(study.data.macd)?.toFixed(5) ?? "—"}</strong>
                    )}
                  </span>
                ))}
                {atrStudies.map((study) =>
                  study.data.length > 0 ? (
                    <span className="chart-study-pill" key={`header-${study.id}`}>
                      <span
                        className="h-2 w-2 rounded-sm"
                        style={{ backgroundColor: study.color }}
                      />
                      {chartSettings.indicatorTitles && <span>{study.label}</span>}
                      {chartSettings.indicatorValues && (
                        <strong>{latestIndicatorValue(study.data)?.toFixed(5) ?? "—"}</strong>
                      )}
                    </span>
                  ) : null,
                )}
                {momentumStudies.map((study) =>
                  study.data.length > 0 ? (
                    <span className="chart-study-pill" key={`header-${study.id}`}>
                      <span
                        className="h-2 w-2 rounded-sm"
                        style={{ backgroundColor: study.color }}
                      />
                      {chartSettings.indicatorTitles && <span>{study.label}</span>}
                      {chartSettings.indicatorValues && (
                        <strong>{latestIndicatorValue(study.data)?.toFixed(5) ?? "—"}</strong>
                      )}
                    </span>
                  ) : null,
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="chart-canvas-grid">
        <DrawingRail
          activeTool={drawingTool}
          clearableDrawingsCount={unlockedDrawingsCount}
          drawingsCount={drawings.length}
          onClearDrawings={onClearDrawings}
          onToolChange={onDrawingToolChange}
        />

        <div className="relative min-w-0">
          <div
            ref={chartFrameRef}
            className="chart-frame"
            style={{ backgroundColor: chartSettings.backgroundColor }}
          >
            <div
              ref={chartContainerRef}
              className="chart-container-surface"
              style={{ backgroundColor: chartSettings.backgroundColor }}
            />
            <div
              className={`absolute inset-0 z-10 ${drawingLayerCapturesPointer ? "pointer-events-auto" : "pointer-events-none"} ${isDrawingPlacementMode ? "cursor-crosshair" : "cursor-default"}`}
              onMouseDown={handleDrawingClick}
              onMouseLeave={stopDrawingDrag}
              onMouseMove={handleDrawingMove}
              onMouseUp={stopDrawingDrag}
            >
              <svg className="h-full w-full overflow-visible pointer-events-none">
                {chartSettings.sessionBreaks &&
                  buildSessionBreakElements(
                    displayBars,
                    chartFrameRef.current,
                    chartRef.current,
                    colorWithOpacity(chartSettings.sessionBreakColor, 0.72),
                  )}
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
          {rsiStudies.map((study) => (
            <RsiPanel
              color={study.color}
              data={study.data}
              key={study.id}
              label={study.label}
            />
          ))}
          {macdStudies.map((study) => (
            <MacdPanel
              color={study.color}
              data={study.data}
              histogramColor={study.histogramColor}
              key={study.id}
              label={study.label}
              signalColor={study.signalColor}
            />
          ))}
          {atrStudies.map((study) => (
            <StudyLinePanel
              color={study.color}
              data={study.data}
              key={study.id}
              label={study.label}
              valueDigits={5}
            />
          ))}
          {momentumStudies.map((study) => (
            <StudyLinePanel
              color={study.color}
              data={study.data}
              key={study.id}
              label={study.label}
              valueDigits={5}
              zeroLine
            />
          ))}
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
  showChange,
  showOhlc,
  showVolume,
  tone,
}: {
  candle: Candle | null;
  showChange: boolean;
  showOhlc: boolean;
  showVolume: boolean;
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
      {showOhlc && (
        <>
          <OhlcvValue label="O" value={formatPrice(candle?.open)} tone={tone} />
          <OhlcvValue label="H" value={formatPrice(candle?.high)} tone={tone} />
          <OhlcvValue label="L" value={formatPrice(candle?.low)} tone={tone} />
          <OhlcvValue label="C" value={formatPrice(candle?.close)} tone={tone} />
        </>
      )}
      {showVolume && hasVolume && (
        <OhlcvValue label="Vol" value={formatCompactNumber(candle.volume)} />
      )}
      {showChange && (
        <span className={`chart-ohlcv-change ${tone}`}>
          {change == null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}
        </span>
      )}
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
  clearableDrawingsCount,
  drawingsCount,
  onClearDrawings,
  onToolChange,
}: {
  activeTool: DrawingTool;
  clearableDrawingsCount: number;
  drawingsCount: number;
  onClearDrawings: () => void;
  onToolChange: (tool: DrawingTool) => void;
}) {
  const tools: Array<{
    icon: ChartToolIcon;
    label: string;
    tool: DrawingTool;
  }> = [
    { icon: TvCursorIcon, label: "Cursor", tool: "cursor" },
    { icon: TvCrosshairIcon, label: "Crosshair", tool: "crosshair" },
    { icon: TvTrendLineIcon, label: "Trendline", tool: "trendline" },
    { icon: TvHorizontalLineIcon, label: "Horizontal level", tool: "horizontal" },
    { icon: TvRectangleIcon, label: "Rectangle zone", tool: "rectangle" },
    { icon: TvFibIcon, label: "Fib retracement", tool: "fib" },
    { icon: TvMeasureIcon, label: "Measure", tool: "measure" },
    { icon: TvLongPositionIcon, label: "Long position", tool: "longPosition" },
    { icon: TvShortPositionIcon, label: "Short position", tool: "shortPosition" },
    { icon: TvTextIcon, label: "Text label", tool: "text" },
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
        disabled={clearableDrawingsCount === 0}
        onClick={onClearDrawings}
        title={
          clearableDrawingsCount === 0 && drawingsCount > 0
            ? "Unlock drawings to clear them"
            : "Clear unlocked drawings"
        }
        type="button"
      >
        <Trash2 size={16} />
        {clearableDrawingsCount > 0 && (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-cyan-300 px-1 text-[10px] font-bold text-ink-950">
            {clearableDrawingsCount}
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

function applyCandleVisualSettings(
  data: CandlestickData[],
  bars: Candle[],
  settings: ChartVisualSettings,
): CandlestickData[] {
  return data.map((candle, index) => {
    const sourceBar = bars[index];
    if (!sourceBar) {
      return candle;
    }
    const previousBar = bars[index - 1];
    const isUp = settings.colorBarsByPreviousClose && previousBar
      ? sourceBar.close >= previousBar.close
      : sourceBar.close >= sourceBar.open;
    const bodyColor = isUp ? settings.bodyUpColor : settings.bodyDownColor;
    const borderColor = isUp ? settings.borderUpColor : settings.borderDownColor;
    const wickColor = isUp ? settings.wickUpColor : settings.wickDownColor;
    return {
      ...candle,
      borderColor,
      color: settings.bodyVisible ? bodyColor : colorWithOpacity(bodyColor, 0.08),
      wickColor,
    };
  });
}

function priceFormatFromPrecision(precision: number) {
  return {
    type: "price" as const,
    precision,
    minMove: minMoveFromPrecision(precision),
  };
}

function minMoveFromPrecision(precision: number) {
  return precision <= 0 ? 1 : 1 / 10 ** precision;
}

function toLightweightDateFormat(format: ChartVisualSettings["dateFormat"]) {
  if (format === "MMM dd yyyy") {
    return "MMM dd yyyy";
  }
  if (format === "yyyy-MM-dd") {
    return "yyyy-MM-dd";
  }
  return "dd MMM 'yy";
}

function formatChartTime(time: Time, settings: ChartVisualSettings) {
  const date = timeToDate(time);
  if (!date) {
    return String(time);
  }
  const options: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    hour12: settings.timeHoursFormat === "12-hour",
    minute: "2-digit",
    month: "short",
  };
  if (settings.dayOfWeekLabels) {
    options.weekday = "short";
  }
  if (settings.dateFormat === "yyyy-MM-dd") {
    options.year = "numeric";
    options.month = "2-digit";
    options.day = "2-digit";
  } else {
    options.day = "2-digit";
    if (settings.dateFormat === "MMM dd yyyy") {
      options.year = "numeric";
    } else {
      options.year = "2-digit";
    }
  }
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function timeToDate(time: Time) {
  if (typeof time === "number") {
    return new Date(time * 1000);
  }
  if (typeof time === "string") {
    return new Date(time);
  }
  if ("year" in time) {
    return new Date(Date.UTC(time.year, time.month - 1, time.day));
  }
  return null;
}

function previousDayClose(bars: Candle[]) {
  const latest = bars.at(-1);
  if (!latest) {
    return null;
  }
  const latestDay = dayKey(latest.timestamp);
  for (let index = bars.length - 2; index >= 0; index -= 1) {
    if (dayKey(bars[index].timestamp) !== latestDay) {
      return bars[index].close;
    }
  }
  return null;
}

function highLowRange(bars: Candle[]) {
  if (bars.length === 0) {
    return { high: null, low: null };
  }
  return bars.reduce(
    (range, bar) => ({
      high: Math.max(range.high, bar.high),
      low: Math.min(range.low, bar.low),
    }),
    { high: Number.NEGATIVE_INFINITY, low: Number.POSITIVE_INFINITY },
  );
}

function dayKey(timestamp: string) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function buildSessionBreakElements(
  bars: Candle[],
  frame: HTMLDivElement | null,
  chart: IChartApi | null,
  color: string,
) {
  if (!frame || !chart || bars.length < 2) {
    return null;
  }
  const height = frame.clientHeight;
  return bars.flatMap((bar, index) => {
    if (index === 0 || dayKey(bar.timestamp) === dayKey(bars[index - 1].timestamp)) {
      return [];
    }
    const x = chart.timeScale().timeToCoordinate(bar.time as UTCTimestamp);
    if (x == null || x < 0 || x > frame.clientWidth) {
      return [];
    }
    return (
      <line
        key={`session-break-${bar.time}`}
        stroke={color}
        strokeDasharray="4 8"
        strokeWidth="1"
        x1={x}
        x2={x}
        y1={0}
        y2={height}
      />
    );
  });
}

function RsiPanel({
  color,
  data,
  label,
}: {
  color: string;
  data: LineData[];
  label: string;
}) {
  const visible = data.slice(-160);
  const path = toRsiPath(visible, 960, 96);
  const latest = latestIndicatorValue(data);

  return (
    <div className="border-t border-white/10 bg-ink-950 px-4 py-3">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
        <span style={{ color }}>{latest == null ? "—" : latest.toFixed(1)}</span>
      </div>
      <div className="h-24 overflow-hidden rounded-md bg-black/20">
        {visible.length > 1 ? (
          <svg className="h-full w-full" preserveAspectRatio="none" viewBox="0 0 960 96">
            <path d="M 0 28.8 L 960 28.8" stroke="rgba(34, 197, 94, 0.26)" strokeWidth="1" />
            <path d="M 0 67.2 L 960 67.2" stroke="rgba(251, 113, 133, 0.26)" strokeWidth="1" />
            <path d={path} fill="none" stroke={color} strokeWidth="2" />
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
  label,
  signalColor,
}: {
  color: string;
  data: MacdData;
  histogramColor: string;
  label: string;
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
        <span className="font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
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

function StudyLinePanel({
  color,
  data,
  label,
  valueDigits = 2,
  zeroLine = false,
}: {
  color: string;
  data: LineData[];
  label: string;
  valueDigits?: number;
  zeroLine?: boolean;
}) {
  const visible = data.slice(-160);
  const values = visible.map((point) => Number(point.value));
  const maxAbs = Math.max(0.000001, ...values.map((value) => Math.abs(value)));
  const latest = latestIndicatorValue(data);

  return (
    <div className="border-t border-white/10 bg-ink-950 px-4 py-3">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-semibold uppercase tracking-[0.16em] text-slate-500">
          {label}
        </span>
        <span className="text-slate-300">
          {latest == null ? "—" : latest.toFixed(valueDigits)}
        </span>
      </div>
      <div className="h-24 overflow-hidden rounded-md bg-black/20">
        {visible.length > 1 ? (
          <svg className="h-full w-full" preserveAspectRatio="none" viewBox="0 0 960 96">
            {zeroLine && (
              <path d="M 0 48 L 960 48" stroke="rgba(148, 163, 184, 0.24)" strokeWidth="1" />
            )}
            <path
              d={
                zeroLine
                  ? toOscillatorPath(visible, 960, 96, maxAbs)
                  : toScaledPath(visible, 960, 96)
              }
              fill="none"
              stroke={color}
              strokeWidth="2"
            />
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
  const labelBackgroundOpacity = Math.round(
    (drawing.labelBackgroundOpacity ?? DEFAULT_LABEL_BACKGROUND_OPACITY) * 100,
  );
  const [presets, setPresets] = useState<DrawingPreset[]>(() => loadDrawingPresets());
  const canFill =
    drawing.tool === "rectangle" ||
    drawing.tool === "longPosition" ||
    drawing.tool === "shortPosition";
  const canDelete = !drawing.locked;
  const isFib = drawing.tool === "fib";
  const canLabel = drawing.tool === "text" || isLabelableDrawingTool(drawing.tool);
  const hasRenderedLabel = drawing.tool === "text" || Boolean(drawing.label?.trim());
  const drawingPresets = isLabelableDrawingTool(drawing.tool)
    ? presets.filter((preset) => preset.tool === drawing.tool)
    : [];
  const lineStyles: DrawingLineStyle[] = ["solid", "dashed", "dotted"];

  const stopToolbarEvent = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  function saveCurrentPreset() {
    if (!isLabelableDrawingTool(drawing.tool)) {
      return;
    }
    const preset = makeDrawingPreset(drawing);
    const nextPresets = [
      preset,
      ...presets.filter(
        (item) => !(item.tool === preset.tool && normalizePresetName(item.name) === normalizePresetName(preset.name)),
      ),
    ].slice(0, 36);
    setPresets(nextPresets);
    saveDrawingPresets(nextPresets);
  }

  function applyPreset(presetId: string) {
    const preset = presets.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }
    onChange({
      color: preset.color,
      fillOpacity: drawing.tool === "rectangle" ? preset.fillOpacity : drawing.fillOpacity,
      label: preset.label,
      labelBackgroundOpacity: preset.labelBackgroundOpacity,
      lineStyle: preset.lineStyle,
      lineWidth: preset.lineWidth,
    });
  }

  return (
    <div
      className="chart-object-floating-toolbar"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={stopToolbarEvent}
      role="group"
      style={{ left: position.x, top: position.y }}
    >
      {canLabel && (
        <input
          aria-label="Drawing label"
          className="chart-object-floating-label-input"
          onChange={(event) => onChange({ label: event.target.value })}
          placeholder={drawing.tool === "text" ? "Text" : "Label"}
          value={drawing.label ?? ""}
        />
      )}

      {isLabelableDrawingTool(drawing.tool) && (
        <div className="drawing-preset-controls">
          <ThemedSelect
            ariaLabel="Drawing presets"
            className="h-8 w-40"
            disabled={drawingPresets.length === 0}
            menuClassName="w-56"
            onChange={applyPreset}
            options={drawingPresets.map((preset) => ({
              label: preset.name,
              sublabel: preset.label || `${preset.lineStyle ?? "solid"} · ${preset.lineWidth ?? 2}px`,
              value: preset.id,
            }))}
            placeholder={drawingPresets.length === 0 ? "No presets" : "Apply preset"}
            value=""
          />
          <button
            className="chart-object-floating-button"
            onClick={saveCurrentPreset}
            title="Save label/style preset"
            type="button"
          >
            <Save size={14} />
          </button>
        </div>
      )}

      <ThemedColorPicker
        ariaLabel="Drawing color"
        className="chart-object-floating-picker"
        compact
        onChange={(color) => onChange({ color })}
        value={drawing.color}
      />

      <div className="chart-object-floating-style" role="group">
        {lineStyles.map((style) => (
          <button
            className={lineStyle === style ? "active" : ""}
            key={style}
            onClick={() => onChange({ lineStyle: style })}
            title={`${style} line`}
            type="button"
          >
            <LineStylePreview style={style} />
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

      {hasRenderedLabel && (
        <label className="chart-object-floating-width" title="Label background opacity">
          <span>BG {labelBackgroundOpacity}%</span>
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

      {isFib && (
        <FibLevelEditor
          drawing={drawing}
          onChange={onChange}
        />
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
      </button>
    </div>
  );
}

function FibLevelEditor({
  drawing,
  onChange,
}: {
  drawing: ChartDrawing;
  onChange: (patch: Partial<ChartDrawing>) => void;
}) {
  const levels = normalizeFibLevels(drawing.fibLevels, drawing.color);
  const priceStart = drawing.points[0]?.price ?? 0;
  const priceRange = (drawing.points[1]?.price ?? priceStart) - priceStart;
  const [presets, setPresets] = useState<FibPreset[]>(() => loadFibPresets());
  const [presetName, setPresetName] = useState("");
  const lineStyles: DrawingLineStyle[] = ["solid", "dashed", "dotted"];

  function updateLevel(levelId: string, patch: Partial<FibLevel>) {
    onChange({
      fibLevels: levels
        .map((level) =>
          level.id === levelId
            ? {
                ...level,
                ...patch,
                value:
                  patch.value == null || !Number.isFinite(patch.value)
                    ? level.value
                    : Math.min(4.236, Math.max(-2, patch.value)),
              }
            : level,
        )
        .sort((left, right) => left.value - right.value),
    });
  }

  function addLevel() {
    const last = levels.at(-1);
    const nextValue = Math.min(4.236, Number(((last?.value ?? 1) + 0.236).toFixed(3)));
    const nextLevel: FibLevel = {
      id: `fib-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      value: nextValue,
      color: nextFibLevelColor(levels),
      backgroundOpacity: DEFAULT_FIB_BACKGROUND_OPACITY,
      label: formatFibLevelInput(nextValue),
      lineStyle: "dashed",
      visible: true,
    };
    onChange({ fibLevels: [...levels, nextLevel].sort((left, right) => left.value - right.value) });
  }

  function savePreset() {
    const preset = makeFibPreset({
      extendLeft: drawing.fibExtendLeft === true,
      extendRight: drawing.fibExtendRight !== false,
      levels,
      name: presetName,
    });
    const nextPresets = [
      preset,
      ...presets.filter(
        (item) => normalizePresetName(item.name) !== normalizePresetName(preset.name),
      ),
    ].slice(0, 24);
    setPresets(nextPresets);
    saveFibPresets(nextPresets);
    setPresetName(preset.name);
  }

  function applyPreset(presetId: string) {
    const preset = presets.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }
    onChange({
      fibExtendLeft: preset.extendLeft,
      fibExtendRight: preset.extendRight,
      fibLevels: normalizeFibLevels(preset.levels, drawing.color),
    });
    setPresetName(preset.name);
  }

  return (
    <div className="fib-level-editor">
      <div className="fib-level-editor-header">
        <span>Fib Levels</span>
        <div className="fib-preset-controls">
          <input
            aria-label="Fib preset name"
            className="fib-preset-name"
            onChange={(event) => setPresetName(event.target.value)}
            placeholder="Preset name"
            value={presetName}
          />
          <ThemedSelect
            ariaLabel="Fib presets"
            className="h-7 w-36"
            disabled={presets.length === 0}
            menuClassName="w-56"
            onChange={applyPreset}
            options={presets.map((preset) => ({
              label: preset.name,
              sublabel: `${preset.levels.length} levels`,
              value: preset.id,
            }))}
            placeholder={presets.length === 0 ? "No presets" : "Apply"}
            value=""
          />
          <button
            className="fib-icon-button"
            onClick={savePreset}
            title="Save fib preset"
            type="button"
          >
            <Save size={12} />
          </button>
          <button
            className="fib-icon-button"
            onClick={() =>
              onChange({
                fibExtendLeft: false,
                fibExtendRight: true,
                fibLevels: normalizeFibLevels(DEFAULT_FIB_LEVELS, drawing.color),
              })
            }
            title="Reset default levels"
            type="button"
          >
            <RotateCcw size={12} />
          </button>
          <button className="fib-icon-button" onClick={addLevel} title="Add level" type="button">
            <Plus size={13} />
          </button>
        </div>
      </div>

      <div className="fib-extend-row">
        <span>Horizontal extend</span>
        <label className="fib-level-extend">
          <input
            checked={drawing.fibExtendLeft === true}
            onChange={(event) => onChange({ fibExtendLeft: event.target.checked })}
            type="checkbox"
          />
          Left
        </label>
        <label className="fib-level-extend">
          <input
            checked={drawing.fibExtendRight !== false}
            onChange={(event) => onChange({ fibExtendRight: event.target.checked })}
            type="checkbox"
          />
          Right
        </label>
      </div>

      <div className="fib-level-grid">
        {levels.map((level) => {
          const price = priceStart + priceRange * level.value;
          return (
            <div className="fib-level-row" key={level.id}>
              <input
                aria-label={`${level.label ?? level.value} visible`}
                checked={level.visible !== false}
                onChange={(event) =>
                  updateLevel(level.id, { visible: event.target.checked })
                }
                type="checkbox"
              />
              <ThemedColorPicker
                ariaLabel={`${level.label ?? level.value} color`}
                className="fib-level-color"
                compact
                onChange={(color) => updateLevel(level.id, { color })}
                value={level.color}
              />
              <input
                aria-label="Fib ratio"
                className="fib-level-value"
                onChange={(event) =>
                  updateLevel(level.id, {
                    label: event.target.value,
                    value: Number(event.target.value),
                  })
                }
                step="0.001"
                type="number"
                value={formatFibLevelInput(level.value)}
              />
              <ThemedSelect
                ariaLabel="Fib level line style"
                className="fib-level-style"
                menuClassName="w-28"
                onChange={(value) =>
                  updateLevel(level.id, { lineStyle: value as DrawingLineStyle })
                }
                options={lineStyles.map((style) => ({
                  label: <LineStylePreview style={style} />,
                  sublabel: style,
                  value: style,
                }))}
                value={level.lineStyle ?? "solid"}
              />
              <label className="fib-level-opacity">
                <span>BG {Math.round((level.backgroundOpacity ?? DEFAULT_FIB_BACKGROUND_OPACITY) * 100)}%</span>
                <input
                  aria-label="Fib background opacity"
                  max={24}
                  min={0}
                  onChange={(event) =>
                    updateLevel(level.id, {
                      backgroundOpacity: Number(event.target.value) / 100,
                    })
                  }
                  step={1}
                  type="range"
                  value={Math.round((level.backgroundOpacity ?? DEFAULT_FIB_BACKGROUND_OPACITY) * 100)}
                />
              </label>
              <span className="fib-level-price">{formatPrice(price)}</span>
              <button
                aria-label="Remove fib level"
                className="fib-level-remove-button"
                disabled={levels.length <= 1}
                onClick={() =>
                  onChange({ fibLevels: levels.filter((item) => item.id !== level.id) })
                }
                title="Remove level"
                type="button"
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LineStylePreview({ style }: { style: DrawingLineStyle }) {
  const dashArray =
    style === "dashed" ? "7 5" : style === "dotted" ? "1 4" : undefined;

  return (
    <svg
      aria-hidden="true"
      className="line-preview"
      focusable="false"
      viewBox="0 0 28 12"
    >
      <line
        stroke="currentColor"
        strokeDasharray={dashArray}
        strokeLinecap={style === "dotted" ? "round" : "butt"}
        strokeWidth={2}
        x1={3}
        x2={25}
        y1={6}
        y2={6}
      />
    </svg>
  );
}

function nextFibLevelColor(levels: FibLevel[]) {
  const usedColors = new Set(levels.map((level) => level.color.toLowerCase()));
  return (
    DEFAULT_FIB_LEVELS.find((level) => !usedColors.has(level.color.toLowerCase()))
      ?.color ?? "#32d3ee"
  );
}

function formatFibLevelInput(value: number) {
  return Number(value.toFixed(3)).toString();
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

  const width = chartPlotWidth(chart, frame);
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

function chartPlotWidth(chart: IChartApi, frame: HTMLDivElement) {
  const timeScaleWidth = chart.timeScale().width();
  if (Number.isFinite(timeScaleWidth) && timeScaleWidth > 0) {
    return Math.min(frame.clientWidth, timeScaleWidth);
  }
  return frame.clientWidth;
}

function horizontalPriceLabelGeometry(label: string, plotWidth: number, y: number) {
  const paddingX = 16;
  const estimatedTextWidth = label.length * 6.9;
  const maxWidth = Math.max(72, plotWidth - 16);
  const labelWidth = clamp(
    Math.ceil(estimatedTextWidth + paddingX),
    72,
    Math.min(172, maxWidth),
  );
  const textWidth = Math.max(12, labelWidth - paddingX);

  return {
    squeeze: estimatedTextWidth > textWidth,
    textWidth,
    width: labelWidth,
    x: clamp(plotWidth - labelWidth - 8, 8, Math.max(8, plotWidth - labelWidth - 8)),
    y: clamp(y - 24, 4, Math.max(4, y + 4)),
  };
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
    const label = formatPrice(drawing.points[0].price);
    const labelGeometry = horizontalPriceLabelGeometry(label, width, point.y);
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
          strokeDasharray={strokeDasharray}
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
          width={labelGeometry.width}
          x={labelGeometry.x}
          y={labelGeometry.y}
        />
        <text
          fill={color}
          fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
          fontSize="11"
          fontWeight="700"
          lengthAdjust={labelGeometry.squeeze ? "spacingAndGlyphs" : undefined}
          textLength={labelGeometry.squeeze ? labelGeometry.textWidth : undefined}
          x={labelGeometry.x + 8}
          y={labelGeometry.y + 14}
        >
          {label}
        </text>
        {renderDrawingLabel({
          backgroundOpacity: drawing.labelBackgroundOpacity,
          color,
          id: `${drawing.id}-label`,
          label: drawing.label,
          plotWidth: width,
          x: 10,
          y: point.y - 34,
        })}
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
    const labelBackgroundFill = drawingLabelBackgroundFill(drawing.labelBackgroundOpacity);
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
          fill={labelBackgroundFill}
          fillOpacity={isSelected ? 1 : 0.72}
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
          strokeDasharray={strokeDasharray}
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
    const positionDrawing = normalizeRiskRewardDrawing(drawing);
    const entry = toPixel(positionDrawing.points[0]);
    const target = toPixel(positionDrawing.points[1]);
    const stop = toPixel(positionDrawing.points[2]);
    if (!entry || !target || !stop) {
      return null;
    }
    return renderPositionDrawing(positionDrawing, entry, target, stop, width, options);
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
        {renderDrawingLabel({
          backgroundOpacity: drawing.labelBackgroundOpacity,
          color,
          id: `${drawing.id}-label`,
          label: drawing.label,
          plotWidth: width,
          x: x + 8,
          y: rectHeight >= 34 ? y + 8 : y - 28,
        })}
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
            {!isLocked && (
              <>
                {renderRectangleEdgeHandles(
                  drawing,
                  { bottom: y + rectHeight, left: x, right: x + rectWidth, top: y },
                  options,
                )}
                {renderAnchors(drawing, [first, second], options)}
              </>
            )}
          </>
        )}
      </g>
    );
  }

  if (drawing.tool === "fib") {
    const levels = normalizeFibLevels(drawing.fibLevels, color).filter(
      (level) => level.visible !== false,
    );
    const yStart = first.y;
    const yRange = second.y - first.y;
    const priceStart = drawing.points[0].price;
    const priceRange = drawing.points[1].price - drawing.points[0].price;
    const anchorLeft = Math.min(first.x, second.x);
    const anchorRight = Math.max(first.x, second.x);
    const lineLeft = drawing.fibExtendLeft === true ? 0 : anchorLeft;
    const lineEnd = drawing.fibExtendRight === false ? anchorRight : width;
    const labelWidth = 154;
    const labelHeight = 20;
    const maxLabelX = Math.max(8, width - labelWidth - 8);
    const labelMinX = Math.min(lineLeft + 8, maxLabelX);
    const labelX = clamp(lineEnd - labelWidth - 8, labelMinX, maxLabelX);
    const lineRight = Math.max(lineLeft, Math.min(lineEnd, labelX - 6));
    const bandLevels = levels
      .map((level) => ({
        ...level,
        y: yStart + yRange * level.value,
      }))
      .sort((a, b) => a.y - b.y);
    return (
      <g key={drawing.id}>
        <rect
          cursor={isLocked ? "default" : "move"}
          fill="transparent"
          height={Math.abs(second.y - first.y) + 20}
          onClick={handleSelect}
          onMouseDown={handleBodyDown}
          pointerEvents={hitTargetPointerEvents}
          width={Math.max(0, lineEnd - lineLeft) + 20}
          x={lineLeft - 10}
          y={Math.min(first.y, second.y) - 10}
        />
        <line
          stroke={color}
          strokeDasharray="3 4"
          strokeOpacity={isSelected ? 0.65 : 0.36}
          strokeWidth={1}
          x1={first.x}
          x2={second.x}
          y1={first.y}
          y2={second.y}
        />
        {bandLevels.slice(0, -1).map((level, index) => {
          const next = bandLevels[index + 1];
          const bandY = Math.min(level.y, next.y);
          const bandHeight = Math.abs(next.y - level.y);
          if (bandHeight < 2) {
            return null;
          }
          return (
            <rect
              fill={colorWithOpacity(
                next.color,
                next.backgroundOpacity ?? DEFAULT_FIB_BACKGROUND_OPACITY,
              )}
              height={bandHeight}
              key={`${drawing.id}-${level.id}-band`}
              pointerEvents="none"
              width={Math.max(0, lineRight - lineLeft)}
              x={lineLeft}
              y={bandY}
            />
          );
        })}
        {levels.map((level) => {
          const y = yStart + yRange * level.value;
          const price = priceStart + priceRange * level.value;
          const levelLabel = level.label?.trim() || formatFibLevelInput(level.value);
          const text = `${levelLabel}  ${formatPrice(price)}`;
          const levelLineStyle = level.lineStyle ?? "solid";
          const labelY = clamp(
            y - labelHeight / 2,
            4,
            Math.max(4, y + labelHeight / 2),
          );
          return (
            <g key={level.id}>
              <line
                stroke={level.color}
                strokeDasharray={lineStyleDasharray(levelLineStyle)}
                strokeLinecap={levelLineStyle === "dotted" ? "round" : "butt"}
                strokeOpacity={isSelected || level.value === 0 || level.value === 1 ? 0.95 : 0.72}
                strokeWidth={
                  level.value === 0 || level.value === 1
                    ? selectedStrokeWidth
                    : Math.max(1, selectedStrokeWidth - 0.75)
                }
                x1={lineLeft}
                x2={lineRight}
                y1={y}
                y2={y}
              />
              <rect
                fill="rgba(8, 12, 17, 0.92)"
                height={labelHeight}
                rx={4}
                stroke={level.color}
                strokeOpacity={isSelected ? 0.72 : 0.42}
                width={labelWidth}
                x={labelX}
                y={labelY}
              />
              <text
                fill={level.color}
                fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                fontSize="10"
                fontWeight="800"
                lengthAdjust="spacingAndGlyphs"
                textLength={labelWidth - 14}
                x={labelX + 7}
                y={labelY + 13}
              >
                {text}
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
      {renderDrawingLabel({
        backgroundOpacity: drawing.labelBackgroundOpacity,
        color,
        id: `${drawing.id}-label`,
        label: drawing.label,
        plotWidth: width,
        x: (first.x + second.x) / 2 - 70,
        y: (first.y + second.y) / 2 - 30,
      })}
      {isSelected && !isLocked && renderAnchors(drawing, [first, second], options)}
    </g>
  );
}

function renderDrawingLabel({
  backgroundOpacity,
  color,
  id,
  label,
  plotWidth,
  x,
  y,
}: {
  backgroundOpacity?: number;
  color: string;
  id: string;
  label?: string;
  plotWidth: number;
  x: number;
  y: number;
}) {
  const text = compactDrawingLabel(label);
  if (!text) {
    return null;
  }
  const labelWidth = clamp(Math.ceil(text.length * 7.2 + 18), 54, 220);
  const labelX = clamp(x, 6, Math.max(6, plotWidth - labelWidth - 6));
  const labelY = Math.max(4, y);
  const squeeze = text.length * 7.2 > labelWidth - 18;

  return (
    <g key={id} pointerEvents="none">
      <rect
        fill={drawingLabelBackgroundFill(backgroundOpacity)}
        height={22}
        rx={5}
        stroke={color}
        strokeOpacity="0.55"
        width={labelWidth}
        x={labelX}
        y={labelY}
      />
      <text
        fill={color}
        fontSize="11"
        fontWeight="800"
        lengthAdjust={squeeze ? "spacingAndGlyphs" : undefined}
        textLength={squeeze ? labelWidth - 16 : undefined}
        x={labelX + 8}
        y={labelY + 15}
      >
        {text}
      </text>
    </g>
  );
}

function renderRectangleEdgeHandles(
  drawing: ChartDrawing,
  box: { bottom: number; left: number; right: number; top: number },
  options: {
    onDragStart: (
      drawing: ChartDrawing,
      mode: DragState["mode"],
      pointIndex: number | null,
      event: MouseEvent<SVGElement>,
    ) => void;
  },
) {
  const midX = (box.left + box.right) / 2;
  const midY = (box.top + box.bottom) / 2;
  const handles = [
    {
      cursor: "ew-resize",
      height: Math.max(24, box.bottom - box.top - 20),
      id: RECTANGLE_EDGE_HANDLE.left,
      width: 12,
      x: box.left - 6,
      y: box.top + 10,
    },
    {
      cursor: "ew-resize",
      height: Math.max(24, box.bottom - box.top - 20),
      id: RECTANGLE_EDGE_HANDLE.right,
      width: 12,
      x: box.right - 6,
      y: box.top + 10,
    },
    {
      cursor: "ns-resize",
      height: 12,
      id: RECTANGLE_EDGE_HANDLE.top,
      width: Math.max(24, box.right - box.left - 20),
      x: box.left + 10,
      y: box.top - 6,
    },
    {
      cursor: "ns-resize",
      height: 12,
      id: RECTANGLE_EDGE_HANDLE.bottom,
      width: Math.max(24, box.right - box.left - 20),
      x: box.left + 10,
      y: box.bottom - 6,
    },
  ];

  return (
    <g>
      {handles.map((handle) => (
        <rect
          cursor={handle.cursor}
          fill={drawing.color}
          fillOpacity="0.12"
          height={handle.height}
          key={`${drawing.id}-edge-${handle.id}`}
          onMouseDown={(event) =>
            options.onDragStart(drawing, "anchor", handle.id, event)
          }
          pointerEvents="all"
          rx={4}
          stroke={drawing.color}
          strokeOpacity="0.36"
          strokeWidth={1}
          width={handle.width}
          x={handle.x}
          y={handle.y}
        />
      ))}
      <circle cx={box.left} cy={midY} fill={drawing.color} opacity={0.9} r={3.5} />
      <circle cx={box.right} cy={midY} fill={drawing.color} opacity={0.9} r={3.5} />
      <circle cx={midX} cy={box.top} fill={drawing.color} opacity={0.9} r={3.5} />
      <circle cx={midX} cy={box.bottom} fill={drawing.color} opacity={0.9} r={3.5} />
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

function compactDrawingLabel(label: string | undefined) {
  const normalized = label?.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, 48) : null;
}

function drawingLabelBackgroundFill(opacity: number | undefined) {
  return `rgba(8, 12, 17, ${clamp(opacity ?? DEFAULT_LABEL_BACKGROUND_OPACITY, 0, 1)})`;
}

function isLabelableDrawingTool(
  tool: ChartDrawing["tool"] | DrawingTool,
): tool is LabelableDrawingTool {
  return tool === "horizontal" || tool === "rectangle" || tool === "trendline";
}

function loadDrawingPresets(): DrawingPreset[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DRAWING_PRESETS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((preset): DrawingPreset | null => {
        if (typeof preset !== "object" || preset == null) {
          return null;
        }
        const candidate = preset as Partial<DrawingPreset>;
        if (
          typeof candidate.id !== "string" ||
          typeof candidate.name !== "string" ||
          typeof candidate.tool !== "string" ||
          !isLabelableDrawingTool(candidate.tool) ||
          typeof candidate.color !== "string" ||
          typeof candidate.label !== "string" ||
          typeof candidate.updatedAt !== "string"
        ) {
          return null;
        }
        return {
          id: candidate.id,
          color: candidate.color,
          fillOpacity:
            typeof candidate.fillOpacity === "number" &&
            Number.isFinite(candidate.fillOpacity)
              ? clamp(candidate.fillOpacity, 0, 0.6)
              : undefined,
          label: candidate.label.slice(0, 64),
          labelBackgroundOpacity:
            typeof candidate.labelBackgroundOpacity === "number" &&
            Number.isFinite(candidate.labelBackgroundOpacity)
              ? clamp(candidate.labelBackgroundOpacity, 0, 1)
              : DEFAULT_LABEL_BACKGROUND_OPACITY,
          lineStyle:
            candidate.lineStyle === "dashed" || candidate.lineStyle === "dotted"
              ? candidate.lineStyle
              : "solid",
          lineWidth:
            typeof candidate.lineWidth === "number" && Number.isFinite(candidate.lineWidth)
              ? clamp(candidate.lineWidth, 1, 6)
              : 2,
          name: candidate.name.slice(0, 48),
          tool: candidate.tool,
          updatedAt: candidate.updatedAt,
        };
      })
      .filter((preset): preset is DrawingPreset => preset != null)
      .slice(0, 36);
  } catch {
    return [];
  }
}

function saveDrawingPresets(presets: DrawingPreset[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(DRAWING_PRESETS_KEY, JSON.stringify(presets));
}

function loadFibPresets(): FibPreset[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FIB_PRESETS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((preset): FibPreset | null => {
        if (typeof preset !== "object" || preset == null) {
          return null;
        }
        const candidate = preset as Partial<FibPreset>;
        if (
          typeof candidate.id !== "string" ||
          typeof candidate.name !== "string" ||
          typeof candidate.updatedAt !== "string" ||
          !Array.isArray(candidate.levels)
        ) {
          return null;
        }
        return {
          extendLeft: candidate.extendLeft === true,
          extendRight: candidate.extendRight !== false,
          id: candidate.id,
          levels: normalizeFibLevels(candidate.levels),
          name: candidate.name.trim().slice(0, 48) || "Fib preset",
          updatedAt: candidate.updatedAt,
        };
      })
      .filter((preset): preset is FibPreset => preset != null)
      .slice(0, 24);
  } catch {
    return [];
  }
}

function saveFibPresets(presets: FibPreset[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(FIB_PRESETS_KEY, JSON.stringify(presets));
}

function makeFibPreset({
  extendLeft,
  extendRight,
  levels,
  name,
}: {
  extendLeft: boolean;
  extendRight: boolean;
  levels: FibLevel[];
  name: string;
}): FibPreset {
  const normalizedLevels = normalizeFibLevels(levels);
  const presetName =
    name.trim().slice(0, 48) ||
    `Fib ${normalizedLevels.length} levels ${new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  return {
    extendLeft,
    extendRight,
    id: `fib-${normalizePresetName(presetName)}-${Date.now().toString(36)}`,
    levels: normalizedLevels.map((level) => ({ ...level })),
    name: presetName,
    updatedAt: new Date().toISOString(),
  };
}

function makeDrawingPreset(drawing: ChartDrawing): DrawingPreset {
  const tool = isLabelableDrawingTool(drawing.tool) ? drawing.tool : "trendline";
  const label = drawing.label?.trim() ?? "";
  const name = label.length > 0 ? label.slice(0, 48) : `${presetToolName(tool)} preset`;
  return {
    id: `${tool}-${normalizePresetName(name)}-${Date.now().toString(36)}`,
    color: drawing.color,
    fillOpacity: tool === "rectangle" ? drawing.fillOpacity ?? 0.16 : undefined,
    label,
    labelBackgroundOpacity: drawing.labelBackgroundOpacity ?? DEFAULT_LABEL_BACKGROUND_OPACITY,
    lineStyle: drawing.lineStyle ?? "solid",
    lineWidth: drawing.lineWidth ?? 2,
    name,
    tool,
    updatedAt: new Date().toISOString(),
  };
}

function normalizePresetName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function presetToolName(tool: LabelableDrawingTool) {
  switch (tool) {
    case "horizontal":
      return "Horizontal";
    case "rectangle":
      return "Rectangle";
    case "trendline":
      return "Trendline";
  }
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
    if (dragState.drawing.tool === "rectangle" && dragState.pointIndex < 0) {
      return resizeRectangleAxisLocked(dragState, point);
    }
    const points = dragState.originalPoints.map((originalPoint, index) =>
      index === dragState.pointIndex ? point : originalPoint,
    );
    return normalizeDraggedDrawing({ ...dragState.drawing, points });
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
  return normalizeDraggedDrawing({ ...dragState.drawing, points });
}

function normalizeDraggedDrawing(drawing: ChartDrawing): ChartDrawing {
  return isRiskRewardTool(drawing.tool) ? normalizeRiskRewardDrawing(drawing) : drawing;
}

function resizeRectangleAxisLocked(
  dragState: DragState,
  point: DrawingPoint,
): ChartDrawing {
  const firstPixel = dragState.originalPixels[0];
  const secondPixel = dragState.originalPixels[1];
  if (!firstPixel || !secondPixel) {
    return dragState.drawing;
  }

  const leftIndex = firstPixel.x <= secondPixel.x ? 0 : 1;
  const rightIndex = leftIndex === 0 ? 1 : 0;
  const topIndex = firstPixel.y <= secondPixel.y ? 0 : 1;
  const bottomIndex = topIndex === 0 ? 1 : 0;
  const targetIndex =
    dragState.pointIndex === RECTANGLE_EDGE_HANDLE.left
      ? leftIndex
      : dragState.pointIndex === RECTANGLE_EDGE_HANDLE.right
      ? rightIndex
      : dragState.pointIndex === RECTANGLE_EDGE_HANDLE.top
      ? topIndex
      : bottomIndex;

  const points = dragState.originalPoints.map((originalPoint, index) => {
    if (index !== targetIndex) {
      return originalPoint;
    }
    if (
      dragState.pointIndex === RECTANGLE_EDGE_HANDLE.left ||
      dragState.pointIndex === RECTANGLE_EDGE_HANDLE.right
    ) {
      return {
        ...originalPoint,
        logical: point.logical,
        time: point.time,
      };
    }
    return {
      ...originalPoint,
      price: point.price,
    };
  });

  return { ...dragState.drawing, points };
}

function makeDrawing(
  tool: DraftDrawing["tool"],
  points: DrawingPoint[],
  label?: string,
): ChartDrawing {
  const normalizedPoints =
    isRiskRewardTool(tool) && points.length >= 2
      ? normalizeRiskRewardPoints(tool, [
          points[0],
          points[1],
          points[2] ?? defaultRiskRewardStopPoint(tool, points),
        ])
      : points;

  return {
    id: window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    tool,
    color: DRAWING_COLORS[tool],
    fibExtendLeft: tool === "fib" ? false : undefined,
    fibExtendRight: tool === "fib" ? true : undefined,
    fibLevels:
      tool === "fib" ? DEFAULT_FIB_LEVELS.map((level) => ({ ...level })) : undefined,
    fillOpacity: tool === "rectangle" ? 0.16 : undefined,
    labelBackgroundOpacity:
      tool === "text" || isLabelableDrawingTool(tool)
        ? DEFAULT_LABEL_BACKGROUND_OPACITY
        : undefined,
    lineStyle: "solid",
    lineWidth: tool === "horizontal" ? 1.5 : 2,
    locked: false,
    points: normalizedPoints,
    label,
    createdAt: new Date().toISOString(),
    visible: true,
  };
}

function drawingStrokeDasharray(drawing: ChartDrawing) {
  return lineStyleDasharray(drawing.lineStyle);
}

function lineStyleDasharray(style: DrawingLineStyle | undefined) {
  switch (style) {
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

function candleChangeTone(candle: Candle | null) {
  if (candle == null || candle.open === 0) {
    return "text-slate-300";
  }
  const change = ((candle.close - candle.open) / candle.open) * 100;
  if (change > 0) {
    return "text-emerald-300";
  }
  if (change < 0) {
    return "text-rose-300";
  }
  return "text-slate-300";
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

function toScaledPath(values: LineData[], width: number, height: number) {
  if (values.length < 2) {
    return "";
  }
  const numericValues = values.map((point) => Number(point.value));
  const min = Math.min(...numericValues);
  const max = Math.max(...numericValues);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  return numericValues
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / range) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}
