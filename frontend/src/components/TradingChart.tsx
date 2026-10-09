import { colorWithOpacity } from "../lib/colorTokens";
import { NumericDraftInput } from "./NumericDraftInput";
import { usePineInputMetadata, usePineInputMigration } from "../lib/usePineInputMetadata";
import {
  useEffect,
  useLayoutEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { chartRuntimeOwnerMatches, type ChartRuntimeOwner } from "../lib/chartRuntimeOwnership";
import { PointOverlaySurface } from "./overlays/OverlaySurface";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpToLine,
  Camera,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Layers,
  LockKeyhole,
  Magnet,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Trash2,
  Undo2,
  UnlockKeyhole,
  X,
} from "lucide-react";
import {
  CrosshairMode,
  ColorType,
  createChart,
  TickMarkType,
} from "lightweight-charts";
import type {
  CandlestickData,
  HistogramData,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  SeriesMarker,
  Logical,
  LineData,
  MouseEventParams,
  Time,
  UTCTimestamp,
} from "lightweight-charts";
import type {
  Candle,
  Execution,
  Order,
  OrderUpdatePayload,
  Position,
  PositionUpdatePayload,
  Trade,
} from "../lib/api";
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
  TvVerticalLineIcon,
  type ChartToolIcon,
} from "./ChartToolIcons";
import {
  aggregateBars,
  atrSeries,
  bucketTime,
  buildFvgZoneDefinitions,
  buildIndicatorDefinitions,
  DEFAULT_FIB_BACKGROUND_OPACITY,
  DEFAULT_FIB_LEVELS,
  defaultRiskRewardStopPoint,
  drawingRequiredPoints,
  formatChartTimeframeLabel,
  fvgZoneVisibleSpan,
  indicatorDisplayName,
  isFibDrawingTool,
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
  type IndicatorDefinition,
  type IndicatorSettings,
  type ChartStyle,
  type ChartTimeframe,
  type DrawingLineStyle,
  type DrawingPoint,
  type DrawingTool,
  type FibLevel,
  type FvgZoneDefinition,
  type MacdData,
  type MagnetMode,
} from "../lib/charting";
import type {
  SyncedChartCrosshair,
  SyncedChartVisibleRange,
} from "../lib/chartWorkspace";
import {
  createPriceScaleSettleScheduler,
  type PriceScaleSettleScheduler,
} from "../lib/chartScaleSync";
import {
  createChartCandleSnapshotStore,
  type ChartCandleSnapshotStore,
  type ChartCrosshairSyncBus,
} from "../lib/chartCrosshairSync";
import {
  planSeriesDataUpdate,
  type SeriesDataUpdatePlan,
} from "../lib/chartSeriesUpdates";
import type { ChartVisualSettings } from "../lib/chartSettings";
import {
  chartSessionPhaseLabel,
  filterBarsForTradingSession,
  resolveChartSessionTemplate,
  sessionPhaseAt,
  sessionTradingDayKey,
  type ChartSessionPhase,
  type ChartSessionTemplate,
} from "../lib/chartSessions";
import {
  formatChartAxisTick,
  formatChartDateTime,
  getChartTimeZoneLabel,
  type ChartTickGranularity,
} from "../lib/chartTimezones";
import {
  aggregateOrderFlowBars,
  analyzeOrderFlowBar,
  buildMarketProfile,
  buildOrderFlowIndicatorSeries,
  formatOrderFlowMetric,
  readOrderFlowSeries,
  resolveOrderFlowAvailability,
  type MarketProfile,
  type OrderFlowBarAggregate,
  type OrderFlowDisplayMode,
  type OrderFlowStatsMetric,
} from "../lib/orderFlowPresentation";
import {
  hydrateDrawingToolFavorites,
  loadCachedDrawingToolFavorites,
  subscribeDrawingToolFavorites,
  type FavoriteDrawingTool,
} from "../lib/drawingToolFavorites";
import { formatPrice } from "../lib/format";
import { useChartPresets } from "../lib/useChartPresets";
import { ChartPresetFeedback } from "./ChartPresetFeedback";
import { formatMarketSymbol, symbolBadge } from "../lib/symbols";
import { ThemedColorPicker } from "./ThemedColorPicker";
import { ThemedSelect } from "./ThemedSelect";
import { PresetApplyDropdown } from "./PresetApplyDropdown";
import { createCustomScriptRuntimeJob } from "../lib/customScriptRuntime";
import { parseEdgeIndicator, type EdgeIndicatorExecutionResult } from "../lib/indicatorDsl";
import { isPersistentPineIndicator, isPineScriptSource, sanitizePinePrepared } from "../lib/customIndicators";
import { adaptPineChartResult, installPineChartPlots, latestPineChartPoint, projectPineBarColors, type PineChartPlot } from "../lib/pineChartAdapter";
import { PineChartNotices } from "./PineChartNotices";
import type { PineChartNoticeStudy } from "../lib/pineChartNotices";
import type { PineExecutionResult } from "../lib/pineProtocol";
import { pineSourceSnapshotForChart } from "../lib/pineSourceSnapshot";
import { PineInputControl } from "./PineInputControl";
import { PineStrategySettingsControl } from "./PineStrategySettingsControl";
import { getStoredAuthSession, subscribeAuthSession } from "../lib/authSession";
import type { PineLiveFeed } from "../lib/pineLiveFeed";
import { useLivePineRuntime } from "./chart/useLivePineRuntime";
import { usePineInstrumentContext } from "./chart/usePineInstrumentContext";
import { observeSharedChartSize } from "../lib/sharedChartResize";
import { useChartViewportHeight } from "../lib/useChartViewportHeight";
import { paneSubscriptionKey } from "../lib/paneSubscriptions";

const RADIAL_TOOLBOX_RADIUS = 88;
const RADIAL_TOOLBOX_EDGE_PADDING = 118;
const DEFAULT_LABEL_BACKGROUND_OPACITY = 0.92;
const TRANSPARENT_COLOR = "rgba(0, 0, 0, 0)";
const WEAK_MAGNET_THRESHOLD_PX = 14;
const DEFAULT_REPLAY_BAR_SPACING = 6;
const DEFAULT_REPLAY_RIGHT_OFFSET = 8;
const MIN_RESET_REPLAY_BARS = 96;
const MAX_RESET_REPLAY_BARS = 320;
const EMPTY_MARKET_PROFILE: MarketProfile = {
  pointOfControl: null,
  rows: [],
  valueAreaHigh: null,
  valueAreaLow: null,
};

const DRAWING_RAIL_TOOLS: Array<{
  icon: ChartToolIcon;
  label: string;
  tool: DrawingTool;
}> = [
  { icon: TvCursorIcon, label: "Cursor: select and edit drawings", tool: "cursor" },
  { icon: TvCrosshairIcon, label: "Crosshair: inspect candles", tool: "crosshair" },
  { icon: TvTrendLineIcon, label: "Trendline", tool: "trendline" },
  { icon: TvHorizontalLineIcon, label: "Horizontal level", tool: "horizontal" },
  { icon: TvVerticalLineIcon, label: "Vertical level", tool: "vertical" },
  { icon: TvRectangleIcon, label: "Rectangle zone", tool: "rectangle" },
  { icon: TvFibIcon, label: "Fib retracement", tool: "fib" },
  { icon: TvMeasureIcon, label: "Measure", tool: "measure" },
  { icon: TvMeasureIcon, label: "Quick measure", tool: "quickMeasure" },
  { icon: TvCursorIcon, label: "Erase one drawing", tool: "eraser" },
  { icon: TvLongPositionIcon, label: "Long position", tool: "longPosition" },
  { icon: TvShortPositionIcon, label: "Short position", tool: "shortPosition" },
  { icon: TvTextIcon, label: "Text label", tool: "text" },
];

type PrimaryChartSeries =
  | ISeriesApi<"Candlestick">
  | ISeriesApi<"Line">
  | ISeriesApi<"Area">;

type PrimarySeriesKind = "candlestick" | "line" | "area";

type Props = {
  bars: Candle[];
  canUndoDrawingChange: boolean;
  captureMode?: boolean;
  chartSettings: ChartVisualSettings;
  chartStyle: ChartStyle;
  crosshairSyncBus?: ChartCrosshairSyncBus;
  confirmOrderLineModifications: boolean;
  drawingTool: DrawingTool;
  drawings: ChartDrawing[];
  executions: Execution[];
  indicatorInstances: ChartIndicatorInstance[];
  indicatorRuntimeMode?: "historical" | "live";
  runtimeContextKey?: string;
  pineLiveFeed?: PineLiveFeed;
  keepDrawingAfterPlacement?: boolean;
  magnetMode: MagnetMode;
  neutralDrawingTool: Extract<DrawingTool, "cursor" | "crosshair">;
  onAddDrawing: (drawing: ChartDrawing) => void;
  onCaptureChart?: () => void;
  onCrosshairSync?: (value: SyncedChartCrosshair) => void;
  onAmendOrder: (orderId: number, payload: OrderUpdatePayload) => Promise<void> | void;
  onClearDrawings: () => void;
  onClosePositionFraction: (fraction: number) => void;
  onDeleteDrawing: (drawingId: string) => void;
  onDrawingToolChange: (tool: DrawingTool) => void;
  onMagnetModeChange: (mode: MagnetMode) => void;
  onOpenChartSettings?: () => void;
  onRemoveIndicator: (instanceId: string) => void;
  onSelectDrawing: (drawingId: string | null) => void;
  onToggleIndicatorVisibility: (instanceId: string) => void;
  onUndoDrawingChange: () => void;
  onUpdateDrawing: (drawing: ChartDrawing, coalesceUndo?: boolean) => void;
  onUpdateIndicatorSettings: (instanceId: string, settings: Partial<IndicatorSettings>) => void;
  onUpdatePosition: (payload: PositionUpdatePayload) => Promise<void> | void;
  onVisibleRangeSync?: (value: SyncedChartVisibleRange) => void;
  onIndicatorRuntimeState?: (instanceId: string, error: string | null) => void;
  orders: Order[];
  position: Position | null;
  pnlMultiplier: number;
  replayFocusTrade?: Trade | null;
  replaySeekVersion?: number;
  selectedDrawingId: string | null;
  showOrderOverlays: boolean;
  showDrawingRail?: boolean;
  drawingControlsActive?: boolean;
  paneId?: string;
  dataState?: { detail: string; status: "available" | "empty" | "unavailable" | "stale" | "gapped" };
  drawingMarker?: string;
  syncedCrosshair?: SyncedChartCrosshair | null;
  syncedVisibleRange?: SyncedChartVisibleRange | null;
  symbol?: string;
  currency?: string;
  datasetTimeframe?: string | null;
  timeframe: ChartTimeframe;
  undoShortcutLabel: string;
};

type CustomRuntimeStudy = {
  color: string;
  data: LineData[];
  error: string | null;
  id: string;
  label: string;
  overlay: boolean;
  plotName: string;
  sourceId: string;
  pinePlot?: PineChartPlot;
  barcolorOwner?: {
    bars: Candle[]; indicators: ChartIndicatorInstance[]; mode: "historical" | "live";
    symbol?: string; timeframe: ChartTimeframe; token?: string;
  };
};

type SnapshotRuntimeResults = {
  owner: ChartRuntimeOwner | null;
  studies: CustomRuntimeStudy[];
  warnings: Record<string, Omit<PineChartNoticeStudy, "id" | "name">>;
  markers: Record<string, SeriesMarker<UTCTimestamp>[]>;
};

const EMPTY_SNAPSHOT_RESULTS: SnapshotRuntimeResults = { owner: null, studies: [], warnings: {}, markers: {} };

type DraftDrawing = {
  tool: Exclude<DrawingTool, "cursor" | "crosshair">;
  point: DrawingPoint;
  points: DrawingPoint[];
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

type DrawingHit = {
  drawing: ChartDrawing;
  mode: DragState["mode"];
  pointIndex: number | null;
};

type RadialToolboxState = {
  anchor: { x: number; y: number };
  highlightedIndex: number | null;
};

type PositionOrderField = "stop_loss" | "take_profit";
type PendingOrderField = "limit_price" | "stop_price" | "stop_loss" | "take_profit";

type OrderLineDragTarget =
  | {
      field: PositionOrderField;
      kind: "position";
    }
  | {
      field: PendingOrderField;
      kind: "order";
      orderId: number;
    };

type OrderLineDragState = {
  target: OrderLineDragTarget;
  price: number;
};

type OrderLineModificationDraft = {
  label: string;
  nextPrice: number;
  previousPrice: number;
  stats: OrderLineModificationStats | null;
  target: OrderLineDragTarget;
};

type OrderLineModificationStats = {
  pnl: number | null;
  pnlLabel: string;
  rr: number | null;
};

type OrderEditLine = {
  color: string;
  key: string;
  label: string;
  price: number;
  target: OrderLineDragTarget;
};

type OhlcSnapCandidate = {
  distance: number;
  point: DrawingPoint;
};

type LabelableDrawingTool =
  | "horizontal"
  | "vertical"
  | "rectangle"
  | "ellipse"
  | "triangle"
  | "trendline"
  | "ray"
  | "extendedLine"
  | "segment"
  | "angle"
  | "horizontalRay"
  | "parallelChannel"
  | "arrow"
  | "callout"
  | "flag"
  | "icon"
  | "longPosition"
  | "shortPosition";

type FillableDrawingTool = "rectangle" | "ellipse" | "triangle" | "callout" | "longPosition" | "shortPosition";

type DrawingPreset = {
  id: string;
  color: string;
  fillOpacity?: number;
  label: string;
  labelBackgroundOpacity?: number;
  lineStyle?: DrawingLineStyle;
  lineWidth?: number;
  name: string;
  rewardColor?: string;
  riskColor?: string;
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
  ray: "#32d3ee",
  extendedLine: "#32d3ee",
  segment: "#38bdf8",
  angle: "#f59e0b",
  horizontalRay: "#f59e0b",
  parallelChannel: "#a78bfa",
  horizontal: "#f59e0b",
  vertical: "#38bdf8",
  rectangle: "#a78bfa",
  ellipse: "#a78bfa",
  triangle: "#a78bfa",
  fib: "#22c55e",
  fibExtension: "#22c55e",
  fibChannel: "#22c55e",
  fibTime: "#22c55e",
  fibFan: "#22c55e",
  chartPattern: "#38bdf8",
  elliottWave: "#f59e0b",
  harmonicPattern: "#a78bfa",
  brush: "#f8fafc",
  arrow: "#32d3ee",
  measure: "#38bdf8",
  quickMeasure: "#38bdf8",
  eraser: "#fb7185",
  longPosition: "#22c55e",
  shortPosition: "#fb7185",
  text: "#f8fafc",
  callout: "#f8fafc",
  flag: "#f59e0b",
  icon: "#32d3ee",
};

const RECTANGLE_EDGE_HANDLE = {
  left: -1,
  right: -2,
  top: -3,
  bottom: -4,
} as const;

const POSITION_HANDLE = {
  topLeft: -11,
  topRight: -12,
  bottomLeft: -13,
  bottomRight: -14,
} as const;

const POSITION_REWARD_COLOR = "#22c55e";
const POSITION_RISK_COLOR = "#fb7185";

export function TradingChart({
  bars,
  canUndoDrawingChange,
  captureMode = false,
  chartSettings,
  chartStyle,
  crosshairSyncBus,
  confirmOrderLineModifications,
  drawingTool,
  drawings,
  executions,
  indicatorInstances,
  indicatorRuntimeMode = "historical",
  runtimeContextKey = "",
  pineLiveFeed,
  keepDrawingAfterPlacement = false,
  magnetMode,
  neutralDrawingTool,
  onAddDrawing,
  onCaptureChart,
  onCrosshairSync,
  onAmendOrder,
  onClearDrawings,
  onClosePositionFraction,
  onDeleteDrawing,
  onDrawingToolChange,
  onMagnetModeChange,
  onOpenChartSettings,
  onRemoveIndicator,
  onSelectDrawing,
  onToggleIndicatorVisibility,
  onUndoDrawingChange,
  onUpdateDrawing,
  onUpdateIndicatorSettings,
  onUpdatePosition,
  onVisibleRangeSync,
  onIndicatorRuntimeState,
  orders,
  position,
  pnlMultiplier,
  replayFocusTrade = null,
  replaySeekVersion = 0,
  selectedDrawingId,
  showOrderOverlays,
  showDrawingRail = true,
  drawingControlsActive = true,
  paneId = "chart-pane-1",
  dataState,
  drawingMarker = "★",
  syncedCrosshair = null,
  syncedVisibleRange = null,
  symbol = "EURUSD",
  currency = "USD",
  datasetTimeframe,
  timeframe,
  undoShortcutLabel,
}: Props) {
  const authSession = useSyncExternalStore(subscribeAuthSession, getStoredAuthSession, () => null);
  const stageRef = useRef<HTMLElement | null>(null);
  const chartFrameRef = useRef<HTMLDivElement | null>(null);
  const viewportSizedPricePlot = useChartViewportHeight(chartFrameRef);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const pineInstallationsRef = useRef(new Set<{ dispose(): void }>());
  const primarySeriesRef = useRef<PrimaryChartSeries | null>(null);
  const candlesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const areaRef = useRef<ISeriesApi<"Area"> | null>(null);
  const lineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const candleSeriesDataRef = useRef<CandlestickData[]>([]);
  const lineSeriesDataRef = useRef<LineData[]>([]);
  const areaSeriesDataRef = useRef<LineData[]>([]);
  const volumeSeriesDataRef = useRef<HistogramData[]>([]);
  const indicatorRefs = useRef<Record<string, ISeriesApi<"Line">>>({});
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const settingPriceLinesRef = useRef<IPriceLine[]>([]);
  const barsRef = useRef<Candle[]>([]);
  const barsByTimeRef = useRef<Map<number, Candle>>(new Map());
  const candleSnapshotStoreRef = useRef<ChartCandleSnapshotStore | null>(null);
  if (!candleSnapshotStoreRef.current) {
    candleSnapshotStoreRef.current = createChartCandleSnapshotStore();
  }
  const candleSnapshotStore = candleSnapshotStoreRef.current;
  const [snapshotRuntimeResults, setSnapshotRuntimeResults] = useState<SnapshotRuntimeResults>(EMPTY_SNAPSHOT_RESULTS);
  const [draftDrawing, setDraftDrawing] = useState<DraftDrawing | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [orderLineDrag, setOrderLineDrag] = useState<OrderLineDragState | null>(null);
  const [pendingOrderLineModification, setPendingOrderLineModification] =
    useState<OrderLineModificationDraft | null>(null);
  const [hoverPoint, setHoverPoint] = useState<DrawingPoint | null>(null);
  const [indicatorToolbarPosition, setIndicatorToolbarPosition] =
    useState<{ x: number; y: number } | null>(null);
  const [chartContextMenuPosition, setChartContextMenuPosition] =
    useState<{ x: number; y: number } | null>(null);
  const chartContextMenuRef = useRef<HTMLDivElement | null>(null);
  const [plotVersion, setPlotVersion] = useState(0);
  const [selectedIndicatorId, setSelectedIndicatorId] = useState<string | null>(null);
  const indicatorToolbarReturnFocusRef = useRef<HTMLElement | null>(null);
  const indicatorToolbarFocusFrameRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (indicatorToolbarFocusFrameRef.current !== null) window.cancelAnimationFrame(indicatorToolbarFocusFrameRef.current);
  }, []);
  const renderedSelectedIndicatorId = captureMode ? null : selectedIndicatorId;
  const [drawingToolbarOpen, setDrawingToolbarOpen] = useState(false);
  const drawingToolbarReturnFocusRef = useRef<HTMLElement | null>(null);
  const [favoriteDrawingTools, setFavoriteDrawingTools] = useState<FavoriteDrawingTool[]>(() =>
    drawingControlsActive ? loadCachedDrawingToolFavorites() : [],
  );
  const [radialToolbox, setRadialToolbox] = useState<RadialToolboxState | null>(null);
  const [positionActionsOpen, setPositionActionsOpen] = useState(false);
  const snappedCrosshairRef = useRef<string | null>(null);
  const pendingCrosshairPointRef = useRef<DrawingPoint | null>(null);
  const crosshairFrameRef = useRef<number | null>(null);
  const drawingDragMovedRef = useRef(false);
  const lastChartPointerRef = useRef<{ x: number; y: number } | null>(null);
  const orderLineDragRef = useRef<OrderLineDragState | null>(null);
  const pendingPriceScaleSyncRef = useRef(false);
  const priceScaleFingerprintRef = useRef<string | null>(null);
  const priceScaleSettleSchedulerRef = useRef<PriceScaleSettleScheduler | null>(null);
  const suppressNextDrawingClickRef = useRef(false);
  const previousTimeframeRef = useRef(timeframe);
  const previousReplaySeekVersionRef = useRef(replaySeekVersion);
  const previousChartStyleRef = useRef(chartStyle);
  const syncApplyingRef = useRef(false);
  const localPointerActiveRef = useRef(false);
  const linkedCrosshairAppliedRef = useRef(false);
  const crosshairSyncRevisionRef = useRef(-1);
  const rangeSyncRevisionRef = useRef(-1);
  const onCrosshairSyncRef = useRef(onCrosshairSync);
  const crosshairSyncBusRef = useRef(crosshairSyncBus);
  const onVisibleRangeSyncRef = useRef(onVisibleRangeSync);
  const drawingClipIdRef = useRef(
    `drawing-plot-clip-${Math.random().toString(36).slice(2, 10)}`,
  );
  onCrosshairSyncRef.current = onCrosshairSync;
  crosshairSyncBusRef.current = crosshairSyncBus;
  onVisibleRangeSyncRef.current = onVisibleRangeSync;

  const sessionTemplate = useMemo(
    () => resolveChartSessionTemplate(symbol, chartSettings.sessionTemplate),
    [chartSettings.sessionTemplate, symbol],
  );
  const sessionBars = useMemo(
    () =>
      filterBarsForTradingSession(
        bars,
        chartSettings.tradingHoursMode,
        sessionTemplate,
      ),
    [bars, chartSettings.tradingHoursMode, sessionTemplate],
  );
  const displayBars = useMemo(
    () => aggregateBars(sessionBars, timeframe),
    [sessionBars, timeframe],
  );
  const latestDisplayBarTime = displayBars.at(-1)?.time;
  const previousDisplayBarsRef = useRef<Candle[] | null>(null);
  const sessionFilteredBarCount = bars.length - sessionBars.length;
  const sourceOrderFlowBars = useMemo(
    () => readOrderFlowSeries(sessionBars),
    [sessionBars],
  );
  const orderFlowAvailability = useMemo(
    () => resolveOrderFlowAvailability(sessionBars.length, sourceOrderFlowBars),
    [sessionBars.length, sourceOrderFlowBars],
  );
  const orderFlowBars = useMemo(
    () =>
      aggregateOrderFlowBars(sourceOrderFlowBars, (time) =>
        bucketTime(time, timeframe),
      ),
    [sourceOrderFlowBars, timeframe],
  );
  const orderFlowByTime = useMemo(
    () => new Map(orderFlowBars.map((bar) => [bar.time, bar])),
    [orderFlowBars],
  );
  const marketProfile = useMemo(() => {
    const latest = orderFlowBars.at(-1);
    const latestSessionKey = latest
      ? sessionTradingDayKey(latest.time, sessionTemplate)
      : null;
    const profileBars = latestSessionKey
      ? orderFlowBars.filter(
          (bar) => sessionTradingDayKey(bar.time, sessionTemplate) === latestSessionKey,
        )
      : orderFlowBars;
    return buildMarketProfile(
      profileBars,
      chartSettings.tpoBracketMinutes,
      chartSettings.tpoValueAreaPercent,
    );
  }, [
    chartSettings.tpoBracketMinutes,
    chartSettings.tpoValueAreaPercent,
    orderFlowBars,
    sessionTemplate,
  ]);
  const primarySeriesKind = primarySeriesKindForStyle(chartStyle);
  const persistentPineFeed = indicatorRuntimeMode === "live" && chartSettings.tradingHoursMode === "extended"
    && ["crypto-24x7", "always-open"].includes(sessionTemplate.id) ? pineLiveFeed : undefined;
  const pineInstrument = usePineInstrumentContext(symbol ?? "", timeframe, pineLiveFeed, indicatorInstances.some(indicator => indicator.visible !== false && Boolean(indicator.customScriptSource) && isPineScriptSource(indicator.customScriptSource!)));
  const runtimeOwner: ChartRuntimeOwner = { bars: displayBars, sourceBars: sessionBars, sourceTimeframe: datasetTimeframe, indicators: indicatorInstances,
    mode: indicatorRuntimeMode, symbol, timeframe, contextKey: runtimeContextKey, metadataKey: pineInstrument.key, feed: pineLiveFeed,
    feedEpoch: pineLiveFeed?.getSnapshot().epoch, userId: authSession?.user.id, token: authSession?.token };
  // Filter during render: an effect cleanup is too late to prevent old values
  // and notices from being attributed to the newly selected chart/account.
  const ownedSnapshot = chartRuntimeOwnerMatches(snapshotRuntimeResults.owner, runtimeOwner)
    ? snapshotRuntimeResults : EMPTY_SNAPSHOT_RESULTS;
  const snapshotRuntimeStudies = ownedSnapshot.studies;
  const snapshotRuntimeWarnings = ownedSnapshot.warnings;
  const pineStrategyMarkers = ownedSnapshot.markers;
  const livePine = useLivePineRuntime({ feed: persistentPineFeed, context: pineInstrument.context,
    contextLoading: pineInstrument.loading, contextError: pineInstrument.error, metadataKey: pineInstrument.key,
    timeframe, symbol, indicators: indicatorInstances, userId: authSession?.user.id, token: authSession?.token,
    onRuntimeState: onIndicatorRuntimeState });
  const livePineAdapted = useMemo(() => livePine.flatMap(study => {
    const indicator = indicatorInstances.find(item => item.id === study.sourceId && item.visible !== false);
    if (!indicator) return [];
    return [{ ...study, indicator, adapted: study.result ? adaptPineChartResult(study.result, study.bars) : null }];
  }), [livePine, indicatorInstances]);
  const customRuntimeStudies = useMemo(() => [...snapshotRuntimeStudies, ...livePineAdapted.flatMap(study => {
    if (study.error) return [emptyCustomRuntimeStudy(study.indicator, study.error)];
    if (!study.result || !study.adapted) return [];
    return study.adapted.plots.map((plot): CustomRuntimeStudy => {
      const latest = latestPineChartPoint(plot);
      return { color: plot.color, data: latest ? [latest] : [], error: null,
        id: `${study.sourceId}-${plot.id}`, label: `${study.result!.name} · ${plot.name}`,
        overlay: plot.overlay, plotName: plot.name, sourceId: study.sourceId, pinePlot: plot,
        ...(plot.kind === "barcolor" ? { barcolorOwner: { bars: displayBars, indicators: indicatorInstances,
          mode: indicatorRuntimeMode, symbol, timeframe, token: authSession?.token } } : {}) };
    });
  })], [snapshotRuntimeStudies, livePineAdapted, displayBars, indicatorInstances, indicatorRuntimeMode, symbol, timeframe, authSession?.token]);
  const customRuntimeWarnings = useMemo(() => ({ ...snapshotRuntimeWarnings,
    ...Object.fromEntries(livePineAdapted.flatMap(study => study.result && study.adapted ? [[study.sourceId,
      { diagnostics: study.result.diagnostics, adapterWarnings: study.adapted.adapterWarnings }]] : [])) }), [snapshotRuntimeWarnings, livePineAdapted]);
  const barcolorSupported = chartStyle === "candles" || chartStyle === "heikinAshi";
  const pineBarcolorPlots = useMemo(() => indicatorInstances.flatMap((indicator) => {
    if (indicator.visible === false || indicator.kind !== "custom") return [];
    return customRuntimeStudies.flatMap((study) => {
      const owner = study.barcolorOwner;
      return study.sourceId === indicator.id && study.pinePlot?.kind === "barcolor" && owner
        && owner.bars === displayBars && owner.indicators === indicatorInstances
        && owner.mode === indicatorRuntimeMode && owner.symbol === symbol && owner.timeframe === timeframe
        && owner.token === authSession?.token
        ? [study.pinePlot] : [];
    });
  }), [authSession?.token, customRuntimeStudies, displayBars, indicatorInstances, indicatorRuntimeMode, symbol, timeframe]);
  const pineBarcolors = useMemo(() => projectPineBarColors(pineBarcolorPlots, displayBars), [pineBarcolorPlots, displayBars]);

  const candleData = useMemo(
    () => {
      if (primarySeriesKind !== "candlestick") return [];
      const data = applyCandleVisualSettings(toCandles(displayBars, chartStyle === "heikinAshi"), displayBars, chartSettings);
      if (!barcolorSupported || !chartSettings.bodyVisible || !pineBarcolorPlots.length) return data;
      return data.map((candle, index) => {
        const color = pineBarcolors.colorAt(index);
        return color === undefined ? candle : { ...candle, color };
      });
    },
    [barcolorSupported, chartSettings, chartStyle, displayBars, pineBarcolorPlots.length, pineBarcolors, primarySeriesKind],
  );
  const closeLineData = useMemo(
    () =>
      primarySeriesKind === "line" || primarySeriesKind === "area"
        ? displayBars.map(
            (bar): LineData => ({
              time: bar.time as UTCTimestamp,
              value: bar.close,
            }),
          )
        : [],
    [displayBars, primarySeriesKind],
  );
  const hasVolumeData = useMemo(
    () => displayBars.some(hasRenderableVolume),
    [displayBars],
  );
  const volumeData = useMemo(
    () =>
      chartSettings.volume && hasVolumeData
        ? displayBars.map(
            (bar): HistogramData => ({
              time: bar.time as UTCTimestamp,
              value: bar.volume,
              color:
                bar.close >= bar.open
                  ? colorWithOpacity(chartSettings.bodyUpColor, 0.22)
                  : colorWithOpacity(chartSettings.bodyDownColor, 0.24),
            }),
          )
        : [],
    [
      chartSettings.bodyDownColor,
      chartSettings.bodyUpColor,
      chartSettings.volume,
      displayBars,
      hasVolumeData,
    ],
  );

  const nativeIndicatorDefinitions = useMemo(
    () => buildIndicatorDefinitions(displayBars, indicatorInstances, {
      sessionTemplate,
      sourceBars: sessionBars,
      timeframe,
    }),
    [displayBars, indicatorInstances, sessionBars, sessionTemplate, timeframe],
  );
  const runtimeContextRef = useRef(runtimeOwner);
  runtimeContextRef.current = runtimeOwner;
  const indicatorDefinitions = useMemo<IndicatorDefinition[]>(
    () => [
      ...nativeIndicatorDefinitions,
      ...customRuntimeStudies.filter((study) => study.overlay && !study.error && !study.pinePlot).map((study) => ({
        color: study.color,
        data: study.data,
        id: study.id,
        label: study.label,
        lineWidth: 2 as const,
        sourceId: study.sourceId,
      })),
    ],
    [customRuntimeStudies, nativeIndicatorDefinitions],
  );
  const pinePaneGroups = useMemo(() => {
    const groups = new Map<string, PineChartPlot[]>();
    customRuntimeStudies.forEach((study) => {
      if (!study.overlay && study.pinePlot) groups.set(study.sourceId, [...groups.get(study.sourceId) ?? [], study.pinePlot]);
    });
    return groups;
  }, [customRuntimeStudies]);
  const customHeaderGroups = useMemo(() => {
    const groups = new Map<string, CustomRuntimeStudy[]>();
    customRuntimeStudies.forEach((study) => groups.set(study.sourceId, [...groups.get(study.sourceId) ?? [], study]));
    return [...groups.values()];
  }, [customRuntimeStudies]);
  const customNoticeStudies = useMemo(() => Object.entries(customRuntimeWarnings).flatMap(([id, result]) => {
    const indicator = indicatorInstances.find((item) => item.id === id && item.visible !== false);
    const hasBarcolor = pineBarcolorPlots.some((plot) => customRuntimeStudies.some((study) => study.sourceId === id && study.pinePlot === plot));
    return indicator ? [{ ...result, adapterWarnings: [...result.adapterWarnings, ...(hasBarcolor ? pineBarcolors.warnings : []), ...(hasBarcolor && !barcolorSupported ? ["Bar coloring is available on candle and Heikin Ashi charts; this chart style does not display it."] : [])], id, name: indicator.customScriptName ?? "Pine script" }] : [];
  }), [barcolorSupported, customRuntimeStudies, customRuntimeWarnings, indicatorInstances, pineBarcolorPlots, pineBarcolors]);
  const fvgZoneDefinitions = useMemo(
    () => buildFvgZoneDefinitions(displayBars, indicatorInstances),
    [displayBars, indicatorInstances],
  );

  useEffect(() => {
    const customInstances = indicatorInstances.filter(
      (indicator) => indicator.kind === "custom" && indicator.visible !== false
        && !(persistentPineFeed && isPersistentPineIndicator(indicator)),
    );
    if (customInstances.length === 0) {
      setSnapshotRuntimeResults(EMPTY_SNAPSHOT_RESULTS);
      return;
    }
    let active = true;
    const capturedContext = runtimeContextRef.current;
    const ownsResult = () => {
      const storedAuth = getStoredAuthSession();
      return active && chartRuntimeOwnerMatches(capturedContext, runtimeContextRef.current)
        && storedAuth?.token === capturedContext.token && storedAuth?.user.id === capturedContext.userId
        && capturedContext.feedEpoch === pineLiveFeed?.getSnapshot().epoch;
    };
    const jobs: ReturnType<typeof createCustomScriptRuntimeJob>[] = [];
    setSnapshotRuntimeResults({ ...EMPTY_SNAPSHOT_RESULTS, owner: capturedContext });
    const publish = (id: string, studies: CustomRuntimeStudy[], warning?: SnapshotRuntimeResults["warnings"][string], markers?: SeriesMarker<UTCTimestamp>[]) => {
      if (!ownsResult()) return;
      setSnapshotRuntimeResults((previous) => {
        if (!ownsResult()) return previous;
        const current = chartRuntimeOwnerMatches(previous.owner, capturedContext) ? previous : EMPTY_SNAPSHOT_RESULTS;
        return { owner: capturedContext,
          studies: [...current.studies.filter((study) => study.sourceId !== id), ...studies],
          warnings: { ...current.warnings, ...(warning ? { [id]: warning } : {}) },
          markers: { ...current.markers, ...(markers ? { [id]: markers } : {}) } };
      });
    };
    customInstances.forEach((indicator) => {
      if (!indicator.customScriptSource) {
        const error = "This custom indicator has no saved script source.";
        publish(indicator.id, [emptyCustomRuntimeStudy(indicator, error)]);
        if (indicator.runtimeError !== error) onIndicatorRuntimeState?.(indicator.id, error);
        return;
      }
      const nativePine = isPineScriptSource(indicator.customScriptSource);
      const snapshot = nativePine && indicatorRuntimeMode === "live"
        ? displayBars.filter((bar) => bar.time < bucketTime(Math.floor(Date.now() / 1000), timeframe)).slice(-20_000)
        : displayBars.slice(-20_000);
      // A source transition can legitimately have no owned candles yet. Its
      // loading/unavailable state belongs to the feed, not to the saved script.
      if (!snapshot.length) return;
      let job: ReturnType<typeof createCustomScriptRuntimeJob>;
      try {
        if (nativePine && pineInstrument.loading) return;
        if (nativePine && pineInstrument.error) throw new Error(pineInstrument.error);
        job = createCustomScriptRuntimeJob({
          bars: snapshot,
          sourceSnapshot: nativePine && indicatorRuntimeMode === "historical" ? pineSourceSnapshotForChart(sessionBars, datasetTimeframe, snapshot, timeframe) : undefined,
          context: nativePine ? pineInstrument.context : undefined,
          inputs: indicator.settings.customInputs,
          inputMetadata: nativePine ? (sanitizePinePrepared(indicator.settings.pineInputPrepared, indicator.customScriptSource) ?? sanitizePinePrepared(indicator.customPinePrepared, indicator.customScriptSource)) : undefined,
          strategySettings: nativePine ? indicator.settings.pineStrategySettings : undefined,
          mode: indicatorRuntimeMode,
          source: indicator.customScriptSource,
        });
      } catch (failure) {
        const error = failure instanceof Error ? failure.message : "Invalid chart script context.";
        publish(indicator.id, [emptyCustomRuntimeStudy(indicator, error)]);
        if (indicator.runtimeError !== error) onIndicatorRuntimeState?.(indicator.id, error);
        return;
      }
      jobs.push(job);
      void job.promise.then((result) => {
        if (!ownsResult()) return;
        const nativeResult = "language" in result && result.language === "pine" ? result as PineExecutionResult : null;
        const adapted = nativeResult ? adaptPineChartResult(nativeResult, snapshot) : null;
        const studies = adapted ? adapted.plots.map((plot): CustomRuntimeStudy => {
          const latest = latestPineChartPoint(plot);
          return {
            color: plot.color, data: latest ? [latest] : [],
            error: null, id: `${indicator.id}-${plot.id}`, label: `${nativeResult!.name} · ${plot.name}`,
            overlay: plot.overlay, plotName: plot.name, sourceId: indicator.id, pinePlot: plot,
            ...(plot.kind === "barcolor" ? { barcolorOwner: {
              bars: displayBars, indicators: indicatorInstances,
              mode: capturedContext.mode, symbol: capturedContext.symbol,
              timeframe, token: capturedContext.token,
            } } : {}),
          };
        }) : customStudiesFromResult(indicator, result as EdgeIndicatorExecutionResult);
        publish(indicator.id, studies, adapted ? {
            diagnostics: nativeResult!.diagnostics,
            adapterWarnings: adapted.adapterWarnings,
          } : undefined, adapted?.strategyMarkers);
        if (indicator.runtimeError) onIndicatorRuntimeState?.(indicator.id, null);
      }).catch((failure) => {
        if (!ownsResult() || (failure instanceof Error && "code" in failure && failure.code === "CANCELLED")) return;
        const error = failure instanceof Error ? failure.message : "Indicator execution failed.";
        publish(indicator.id, [emptyCustomRuntimeStudy(indicator, error)]);
        if (indicator.runtimeError !== error) onIndicatorRuntimeState?.(indicator.id, error);
      });
    });
    return () => {
      active = false;
      jobs.forEach((job) => job.cancel());
    };
  }, [authSession, displayBars, sessionBars, datasetTimeframe, indicatorInstances, indicatorRuntimeMode, persistentPineFeed, pineLiveFeed, runtimeContextKey, runtimeOwner.feedEpoch, symbol, timeframe, pineInstrument.key, pineInstrument.context, pineInstrument.loading, pineInstrument.error]);

  useEffect(() => {
    if (!drawingControlsActive) {
      return;
    }

    let active = true;
    setFavoriteDrawingTools(loadCachedDrawingToolFavorites());
    void hydrateDrawingToolFavorites().then((value) => {
      if (active) {
        setFavoriteDrawingTools(value);
      }
    });
    const unsubscribe = subscribeDrawingToolFavorites((value) => {
      if (active) {
        setFavoriteDrawingTools(value);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [drawingControlsActive]);

  useEffect(() => {
    if (!drawingControlsActive) {
      setRadialToolbox(null);
      return;
    }

    function closeRadialToolbox() {
      setRadialToolbox(null);
    }

    function selectRadialTool(index: number | null) {
      if (index == null) {
        return false;
      }
      const tool = favoriteDrawingTools[index];
      if (!tool) {
        return false;
      }
      onDrawingToolChange(tool);
      closeRadialToolbox();
      return true;
    }

    function handleRadialKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Alt") {
        if (event.repeat || radialToolbox || !chartAcceptsRadialToolbox(stageRef.current)) {
          return;
        }
        const activeElement = document.activeElement as HTMLElement | null;
        if (
          isEditableTarget(activeElement) ||
          activeElement?.closest('[role="dialog"], [role="menu"], .chart-command-menu')
        ) {
          return;
        }
        event.preventDefault();
        setRadialToolbox({
          anchor: radialToolboxAnchor(stageRef.current, lastChartPointerRef.current),
          highlightedIndex: null,
        });
        return;
      }

      if (!radialToolbox) {
        return;
      }

      if (/^[1-8]$/.test(event.key)) {
        const index = Number(event.key) - 1;
        if (selectRadialTool(index)) {
          event.preventDefault();
        }
        return;
      }

      if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        setRadialToolbox((current) => {
          if (!current) {
            return current;
          }
          const lastIndex = Math.max(0, favoriteDrawingTools.length - 1);
          if (event.key === "Home") {
            return { ...current, highlightedIndex: 0 };
          }
          if (event.key === "End") {
            return { ...current, highlightedIndex: lastIndex };
          }
          const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
          const currentIndex = current.highlightedIndex ?? (direction > 0 ? -1 : 0);
          return {
            ...current,
            highlightedIndex:
              (currentIndex + direction + favoriteDrawingTools.length) % favoriteDrawingTools.length,
          };
        });
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        if (selectRadialTool(radialToolbox.highlightedIndex)) {
          event.preventDefault();
        }
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        closeRadialToolbox();
      }
    }

    function handleRadialKeyUp(event: globalThis.KeyboardEvent) {
      if (event.key !== "Alt" || !radialToolbox) {
        return;
      }
      event.preventDefault();
      if (!selectRadialTool(radialToolbox.highlightedIndex)) {
        closeRadialToolbox();
      }
    }

    window.addEventListener("blur", closeRadialToolbox);
    window.addEventListener("keydown", handleRadialKeyDown);
    window.addEventListener("keyup", handleRadialKeyUp);
    return () => {
      window.removeEventListener("blur", closeRadialToolbox);
      window.removeEventListener("keydown", handleRadialKeyDown);
      window.removeEventListener("keyup", handleRadialKeyUp);
    };
  }, [drawingControlsActive, favoriteDrawingTools, onDrawingToolChange, radialToolbox]);

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
            lineStyle: defaultIndicatorLineStyle(indicator.kind, settings),
            lineWidth: indicatorPanelLineWidth(settings.lineWidth, 2),
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
            lineStyle: defaultIndicatorLineStyle(indicator.kind, settings),
            lineWidth: indicatorPanelLineWidth(settings.lineWidth, 2),
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
            lineStyle: defaultIndicatorLineStyle(indicator.kind, settings),
            lineWidth: indicatorPanelLineWidth(settings.lineWidth, 2),
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
            lineStyle: defaultIndicatorLineStyle(indicator.kind, settings),
            lineWidth: indicatorPanelLineWidth(settings.lineWidth, 2),
          };
        }),
    [displayBars, visibleIndicatorInstances],
  );
  const orderFlowStudies = useMemo(
    () =>
      visibleIndicatorInstances
        .filter(isOrderFlowIndicatorInstance)
        .map((indicator) => {
          const settings = mergeIndicatorSettings(indicator.kind, indicator.settings);
          const data =
            orderFlowAvailability.status === "insufficient" ||
            orderFlowAvailability.status === "unavailable"
              ? []
              : buildOrderFlowIndicatorSeries(
                  orderFlowBars,
                  indicator.kind,
                  indicator.kind === "order-flow-imbalance"
                    ? settings.period
                    : chartSettings.footprintImbalanceRatio,
                );
          return {
            color: settings.color,
            data: data.map(
              (point): LineData => ({
                time: point.time as UTCTimestamp,
                value: point.value,
              }),
            ),
            id: indicator.id,
            label: indicatorDisplayName({ ...indicator, settings }),
            lineStyle: defaultIndicatorLineStyle(indicator.kind, settings),
            lineWidth: indicatorPanelLineWidth(settings.lineWidth, 2),
          };
        }),
    [
      chartSettings.footprintImbalanceRatio,
      orderFlowBars,
      orderFlowAvailability.status,
      visibleIndicatorInstances,
    ],
  );
  const activeOverlayIndicators = indicatorDefinitions.filter(
    (indicator) => indicator.data.length > 0,
  );
  const overlayIndicatorPills = useMemo(
    () =>
      visibleIndicatorInstances
        .filter((indicator) => isOverlayIndicatorKind(indicator.kind))
        .map((indicator) => {
          const settings = mergeIndicatorSettings(indicator.kind, indicator.settings);
          const zoneDefinitions = fvgZoneDefinitions.filter(
            (item) => item.sourceId === indicator.id,
          );
          if (indicator.kind === "fvg" || indicator.kind === "ifvg") {
            const activeCount = zoneDefinitions.filter((item) => item.active).length;
            return {
              color: settings.color,
              data: [],
              id: indicator.id,
              isVisible: zoneDefinitions.length > 0,
              label: indicatorDisplayName({ ...indicator, settings }),
              valueText: `${activeCount}/${zoneDefinitions.length}`,
            };
          }
          const definition = activeOverlayIndicators.find(
            (item) => item.sourceId === indicator.id,
          );
          return {
            color: settings.color,
            data: definition?.data ?? [],
            id: indicator.id,
            isVisible: (definition?.data?.length ?? 0) > 0,
            label: indicatorDisplayName({ ...indicator, settings }),
            valueText: null,
          };
        })
        .filter((indicator) => indicator.isVisible),
    [activeOverlayIndicators, fvgZoneDefinitions, visibleIndicatorInstances],
  );
  const isCursorTool = drawingTool === "cursor";
  const isCrosshairTool = drawingTool === "crosshair";
  const isNeutralTool = isCursorTool || isCrosshairTool;
  const isDrawingPlacementMode = !isCursorTool && !isCrosshairTool;
  const effectiveCrosshairVisible =
    !captureMode && (isCrosshairTool || (chartSettings.crosshairVisible && !isCursorTool));
  const drawingObjectsInteractive = isNeutralTool;
  const drawingLayerCapturesPointer =
    dragState != null || isDrawingPlacementMode || isCursorTool;
  const selectedDrawing = useMemo(
    () => drawings.find((drawing) => drawing.id === selectedDrawingId) ?? null,
    [drawings, selectedDrawingId],
  );
  const selectedIndicator = useMemo(
    () =>
      selectedIndicatorId
        ? indicatorInstances.find((indicator) => indicator.id === selectedIndicatorId) ?? null
        : null,
    [indicatorInstances, selectedIndicatorId],
  );
  const activePosition = isOpenPosition(position) ? position : null;
  const drawingElements = buildDrawingElements({
    chart: chartRef.current,
    chartSettings,
    drawings,
    draftDrawing: captureMode ? null : draftDrawing,
    frame: chartFrameRef.current,
    hoverPoint: captureMode ? null : hoverPoint,
    onDeleteDrawing,
    onDragStart: startDrawingDrag,
    onSelectDrawing: selectDrawingFromChart,
    interactive: captureMode ? false : drawingObjectsInteractive,
    selectedDrawingId: captureMode ? null : selectedDrawingId,
    series: primarySeriesRef.current,
    version: plotVersion,
  });
  const fvgZoneElements = buildFvgZoneElements({
    chart: chartRef.current,
    definitions: fvgZoneDefinitions,
    frame: chartFrameRef.current,
    onOpenSettings: openIndicatorToolbarAtFramePoint,
    selectedIndicatorId: renderedSelectedIndicatorId,
    series: primarySeriesRef.current,
  });
  const drawingPlotWidth =
    chartRef.current && chartFrameRef.current
      ? chartPlotWidth(chartRef.current, chartFrameRef.current)
      : 0;
  const drawingPlotHeight = chartRef.current
    ? chartPlotHeight(chartRef.current, chartFrameRef.current)
    : 0;
  const sessionShadeElements = buildSessionShadeElements({
    bars: displayBars,
    chart: chartRef.current,
    closedVisible: chartSettings.closedSessionShading,
    frame: chartFrameRef.current,
    postMarketVisible: chartSettings.postMarketShading,
    preMarketVisible: chartSettings.preMarketShading,
    template: sessionTemplate,
  });
  const footprintPresentation = buildFootprintElements({
    askColor: chartSettings.footprintAskColor,
    bars: chartStyle === "footprint" ? orderFlowBars : [],
    bidColor: chartSettings.footprintBidColor,
    chart: chartRef.current,
    displayMode: chartSettings.footprintDisplayMode,
    frame: chartFrameRef.current,
    imbalanceRatio: chartSettings.footprintImbalanceRatio,
    alignment: chartSettings.footprintAlignment,
    neutralColor: chartSettings.footprintNeutralColor,
    series: primarySeriesRef.current,
    showAverageTradeSize: chartSettings.footprintShowAverageTradeSize,
    showImbalances: chartSettings.footprintShowImbalances,
    showUnfinishedAuctions: chartSettings.footprintShowUnfinishedAuctions,
    stackedImbalanceCount: chartSettings.footprintStackedImbalanceCount,
  });
  const marketProfileElements = buildMarketProfileElements({
    askColor: chartSettings.footprintAskColor,
    bidColor: chartSettings.footprintBidColor,
    chart: chartRef.current,
    frame: chartFrameRef.current,
    profile: chartStyle === "tpo" ? marketProfile : EMPTY_MARKET_PROFILE,
    series: primarySeriesRef.current,
    showPointOfControl: chartSettings.tpoShowPointOfControl,
    showValueArea: chartSettings.tpoShowValueArea,
  });
  const footprintDataReady =
    orderFlowBars.length > 0 &&
    (chartSettings.footprintDisplayMode === "volume-profile" ||
      orderFlowAvailability.status === "available" ||
      orderFlowAvailability.status === "partial");
  const marketProfileDataReady = marketProfile.rows.length > 0;
  const orderFlowCanvasReady =
    (chartStyle === "footprint" && footprintDataReady) ||
    (chartStyle === "tpo" && marketProfileDataReady);
  const floatingToolbarPosition =
    !captureMode && selectedDrawing && drawingToolbarOpen && !isDrawingPlacementMode && dragState == null
      ? toolbarPositionFromDrawing(
          selectedDrawing,
          chartFrameRef.current,
          chartRef.current,
          primarySeriesRef.current,
        )
      : null;
  const positionOverlayPosition =
    activePosition && showOrderOverlays
      ? positionOverlayFromPrice(
          activePosition.avg_price,
          chartFrameRef.current,
          chartRef.current,
          primarySeriesRef.current,
        )
      : null;
  const orderEditLines = useMemo(
    () => buildOrderEditLines(activePosition, orders, orderLineDrag),
    [activePosition, orderLineDrag, orders],
  );
  const orderLineDragPreview = useMemo(
    () =>
      orderLineDrag
        ? buildOrderLineModificationDraft({
            activePosition,
            nextPrice: orderLineDrag.price,
            orders,
            pnlMultiplier,
            target: orderLineDrag.target,
          })
        : null,
    [activePosition, orderLineDrag, orders, pnlMultiplier],
  );
  const orderLineDragActive = orderLineDrag != null;

  const removableDrawingsCount = drawings.filter((drawing) => !drawing.locked).length;
  const shouldWatchPriceScale =
    drawings.length > 0 ||
    draftDrawing != null ||
    dragState != null ||
    fvgZoneDefinitions.length > 0 ||
    isDrawingPlacementMode ||
    chartStyle === "footprint" ||
    chartStyle === "tpo" ||
    (showOrderOverlays && (activePosition != null || orders.length > 0));

  useLayoutEffect(() => {
    barsRef.current = displayBars;
    barsByTimeRef.current = new Map(displayBars.map((bar) => [bar.time, bar]));
    const activeTime = candleSnapshotStore.getSnapshot()?.time;
    if (activeTime != null) {
      candleSnapshotStore.setSnapshot(barsByTimeRef.current.get(activeTime) ?? null);
    }
  }, [candleSnapshotStore, displayBars]);

  useEffect(() => {
    if (!shouldWatchPriceScale) {
      priceScaleSettleSchedulerRef.current?.cancel();
      priceScaleFingerprintRef.current = null;
      return;
    }

    let frameId: number | null = null;
    let settleFramesRemaining = 2;
    const interactionActive = dragState != null || draftDrawing != null;

    const watchPriceScale = () => {
      syncDrawingLayerToPriceScale();
      if (interactionActive || settleFramesRemaining > 0) {
        settleFramesRemaining -= 1;
        frameId = window.requestAnimationFrame(watchPriceScale);
      }
    };

    frameId = window.requestAnimationFrame(watchPriceScale);
    return () => {
      if (frameId != null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [draftDrawing, dragState, shouldWatchPriceScale]);

  useEffect(() => {
    if (magnetMode === "off" || !effectiveCrosshairVisible || !isDrawingPlacementMode) {
      clearMagnetCrosshair();
    }
  }, [effectiveCrosshairVisible, isDrawingPlacementMode, magnetMode]);

  useEffect(() => {
    if (!activePosition || !showOrderOverlays) {
      setPositionActionsOpen(false);
    }
  }, [activePosition, showOrderOverlays]);

  useEffect(() => {
    if (!orderLineDragActive) {
      return;
    }

    function handlePointerMove(event: globalThis.PointerEvent) {
      const current = orderLineDragRef.current;
      if (!current) {
        return;
      }
      const price = priceFromClientY(event.clientY);
      if (price == null) {
        return;
      }
      event.preventDefault();
      updateOrderLineDrag({ ...current, price });
    }

    function handlePointerUp(event: globalThis.PointerEvent) {
      const current = orderLineDragRef.current;
      if (!current) {
        return;
      }
      const price = priceFromClientY(event.clientY) ?? current.price;
      event.preventDefault();
      updateOrderLineDrag(null);
      requestOrderLineModification(current.target, price);
    }

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerUp);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [
    activePosition,
    confirmOrderLineModifications,
    orderLineDragActive,
    orders,
    pnlMultiplier,
    onAmendOrder,
    onUpdatePosition,
  ]);

  useEffect(() => {
    return () => {
      cancelScheduledMagnetCrosshair();
      priceScaleSettleSchedulerRef.current?.cancel();
    };
  }, []);

  useEffect(() => {
    if (!chartContextMenuPosition) {
      return;
    }

    window.requestAnimationFrame(() => {
      chartContextMenuRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
    });

    function closeMenu() {
      setChartContextMenuPosition(null);
    }

    function closeMenuOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        stageRef.current?.focus({ preventScroll: true });
      }
    }

    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeMenuOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeMenuOnEscape);
    };
  }, [chartContextMenuPosition]);

  useEffect(() => {
    if (!positionActionsOpen) {
      return;
    }

    function closePositionActions(event: globalThis.PointerEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".chart-position-overlay")) {
        return;
      }
      setPositionActionsOpen(false);
    }

    document.addEventListener("pointerdown", closePositionActions);
    return () => document.removeEventListener("pointerdown", closePositionActions);
  }, [positionActionsOpen]);

  useLayoutEffect(() => {
    if (!chartContainerRef.current) {
      return;
    }

    const chartContainer = chartContainerRef.current;
    const chart = createChart(chartContainer, {
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
        visible: chartSettings.scalePlacement !== "left",
      },
      leftPriceScale: {
        borderColor: "rgba(148, 163, 184, 0.16)",
        visible: chartSettings.scalePlacement === "left",
      },
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.16)",
        timeVisible: true,
        secondsVisible: false,
        lockVisibleTimeRangeOnResize: true,
      },
      localization: {
        priceFormatter: (price: number) => formatPrice(price),
      },
      autoSize: false,
      height: Math.max(1, chartContainer.clientHeight),
      width: Math.max(1, chartContainer.clientWidth),
    });

    const refreshDrawingLayer = () => {
      setPlotVersion((value) => value + 1);
    };

    chartRef.current = chart;
    const handlePointerEnter = () => {
      localPointerActiveRef.current = true;
    };
    const handlePointerLeave = () => {
      localPointerActiveRef.current = false;
    };
    chartContainer.addEventListener("pointerenter", handlePointerEnter);
    chartContainer.addEventListener("pointerleave", handlePointerLeave);

    chart.subscribeCrosshairMove((param) => {
      const time = typeof param.time === "number" ? Number(param.time) : null;
      candleSnapshotStore.setSnapshot(resolveCandleAtTime(param.time, barsByTimeRef.current));
      if (
        syncApplyingRef.current ||
        !localPointerActiveRef.current ||
        (!crosshairSyncBusRef.current && !onCrosshairSyncRef.current)
      ) return;
      const price = param.point
        ? primarySeriesRef.current?.coordinateToPrice(param.point.y) ?? null
        : null;
      const value = {
        price: typeof price === "number" && Number.isFinite(price) ? price : null,
        revision: Date.now(),
        sourcePaneId: paneId,
        time,
      };
      if (crosshairSyncBusRef.current) {
        crosshairSyncBusRef.current.publish(value);
      } else {
        onCrosshairSyncRef.current?.(value);
      }
    });
    const handleVisibleRangeChange = () => {
      refreshDrawingLayer();
      if (syncApplyingRef.current || !onVisibleRangeSyncRef.current) return;
      const range = chart.timeScale().getVisibleRange();
      if (!range || typeof range.from !== "number" || typeof range.to !== "number") return;
      onVisibleRangeSyncRef.current({
        from: Number(range.from),
        revision: Date.now(),
        sourcePaneId: paneId,
        to: Number(range.to),
      });
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
    const stopObservingSize = observeSharedChartSize(chartContainer, ({ height, width }) => {
      chart.resize(width, height);
      refreshDrawingLayer();
    });

    return () => {
      stopObservingSize();
      chartContainer.removeEventListener("pointerenter", handlePointerEnter);
      chartContainer.removeEventListener("pointerleave", handlePointerLeave);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
      pineInstallationsRef.current.forEach((installation) => installation.dispose());
      pineInstallationsRef.current.clear();
      chart.remove();
      chartRef.current = null;
      primarySeriesRef.current = null;
      candlesRef.current = null;
      areaRef.current = null;
      lineRef.current = null;
      volumeRef.current = null;
      candleSeriesDataRef.current = [];
      lineSeriesDataRef.current = [];
      areaSeriesDataRef.current = [];
      volumeSeriesDataRef.current = [];
      indicatorRefs.current = {};
    };
  }, [candleSnapshotStore, paneId]);

  useLayoutEffect(() => {
    const chart = chartRef.current;
    if (!chart) {
      return;
    }
    const priceFormat = priceFormatFromPrecision(chartSettings.pricePrecision);
    const priceScaleId = primaryPriceScaleIdForPlacement(chartSettings.scalePlacement);
    let primarySeries: PrimaryChartSeries;

    if (primarySeriesKind === "line") {
      const line = chart.addLineSeries({
        color: "#32d3ee",
        lastValueVisible: chartSettings.symbolLine !== "hidden",
        lineWidth: 2,
        priceFormat,
        priceLineVisible: chartSettings.symbolLine === "valueLine",
        priceScaleId,
      });
      lineRef.current = line;
      primarySeries = line;
    } else if (primarySeriesKind === "area") {
      const area = chart.addAreaSeries({
        bottomColor: "rgba(50, 211, 238, 0.02)",
        lastValueVisible: chartSettings.symbolLine !== "hidden",
        lineColor: "#32d3ee",
        lineWidth: 2,
        priceFormat,
        priceLineVisible: chartSettings.symbolLine === "valueLine",
        priceScaleId,
        topColor: "rgba(50, 211, 238, 0.28)",
      });
      areaRef.current = area;
      primarySeries = area;
    } else {
      const candles = chart.addCandlestickSeries({
        borderDownColor: chartSettings.borderDownColor,
        borderUpColor: chartSettings.borderUpColor,
        borderVisible: chartSettings.borderVisible,
        downColor: chartSettings.bodyVisible
          ? chartSettings.bodyDownColor
          : TRANSPARENT_COLOR,
        lastValueVisible: chartSettings.symbolLine !== "hidden",
        priceFormat,
        priceLineVisible: chartSettings.symbolLine === "valueLine",
        priceScaleId,
        upColor: chartSettings.bodyVisible
          ? chartSettings.bodyUpColor
          : TRANSPARENT_COLOR,
        wickDownColor: chartSettings.wickDownColor,
        wickUpColor: chartSettings.wickUpColor,
        wickVisible: chartSettings.wickVisible,
      });
      candlesRef.current = candles;
      primarySeries = candles;
    }

    primarySeriesRef.current = primarySeries;
    priceScaleFingerprintRef.current = null;
    setPlotVersion((value) => value + 1);

    return () => {
      priceLinesRef.current.forEach((line) => removePriceLineSafely(primarySeries, line));
      settingPriceLinesRef.current.forEach((line) =>
        removePriceLineSafely(primarySeries, line),
      );
      priceLinesRef.current = [];
      settingPriceLinesRef.current = [];
      if (primarySeriesRef.current === primarySeries) {
        primarySeriesRef.current = null;
      }
      candlesRef.current = null;
      lineRef.current = null;
      areaRef.current = null;
      candleSeriesDataRef.current = [];
      lineSeriesDataRef.current = [];
      areaSeriesDataRef.current = [];
      try {
        chart.removeSeries(primarySeries);
      } catch {
        // The chart can already be detached during pane teardown.
      }
    };
  }, [paneId, primarySeriesKind]);

  useLayoutEffect(() => {
    const chart = chartRef.current;
    if (!chart || !chartSettings.volume || !hasVolumeData) {
      return;
    }
    const volume = chart.addHistogramSeries({
      color: "rgba(148, 163, 184, 0.24)",
      priceFormat: { type: "volume" },
      priceLineVisible: false,
      priceScaleId: "",
    });
    volume.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });
    volumeRef.current = volume;

    return () => {
      if (volumeRef.current === volume) {
        volumeRef.current = null;
      }
      volumeSeriesDataRef.current = [];
      try {
        chart.removeSeries(volume);
      } catch {
        // The chart can already be detached during pane teardown.
      }
    };
  }, [chartSettings.volume, hasVolumeData, paneId]);

  useEffect(() => {
    if (!crosshairSyncBus) return;
    return crosshairSyncBus.subscribe((event) => {
      const chart = chartRef.current;
      if (!chart) return;
      if (event.type === "disabled") {
        if (!linkedCrosshairAppliedRef.current) return;
        linkedCrosshairAppliedRef.current = false;
        syncApplyingRef.current = true;
        chart.clearCrosshairPosition();
        candleSnapshotStore.setSnapshot(null);
        window.requestAnimationFrame(() => {
          syncApplyingRef.current = false;
        });
        return;
      }

      const value = event.value;
      if (
        value.sourcePaneId === paneId ||
        value.revision <= crosshairSyncRevisionRef.current
      ) return;
      const series = primarySeriesRef.current;
      if (!series || barsByTimeRef.current.size === 0) return;
      crosshairSyncRevisionRef.current = value.revision;
      syncApplyingRef.current = true;
      linkedCrosshairAppliedRef.current = value.time != null && value.price != null;
      candleSnapshotStore.setSnapshot(resolveCandleAtTime(value.time, barsByTimeRef.current));
      if (!linkedCrosshairAppliedRef.current) {
        chart.clearCrosshairPosition();
      } else {
        chart.setCrosshairPosition(value.price!, value.time as UTCTimestamp, series);
      }
      window.requestAnimationFrame(() => {
        syncApplyingRef.current = false;
      });
    });
  }, [candleSnapshotStore, crosshairSyncBus, paneId]);

  useEffect(() => {
    if (
      !syncedCrosshair ||
      syncedCrosshair.sourcePaneId === paneId ||
      syncedCrosshair.revision <= crosshairSyncRevisionRef.current
    ) {
      return;
    }
    const chart = chartRef.current;
    const series = primarySeriesRef.current;
    if (!chart || !series || barsRef.current.length === 0) return;
    crosshairSyncRevisionRef.current = syncedCrosshair.revision;
    syncApplyingRef.current = true;
    linkedCrosshairAppliedRef.current = syncedCrosshair.time != null && syncedCrosshair.price != null;
    candleSnapshotStore.setSnapshot(resolveCandleAtTime(syncedCrosshair.time, barsByTimeRef.current));
    if (syncedCrosshair.time == null || syncedCrosshair.price == null) {
      chart.clearCrosshairPosition();
    } else {
      chart.setCrosshairPosition(
        syncedCrosshair.price,
        syncedCrosshair.time as UTCTimestamp,
        series,
      );
    }
    window.requestAnimationFrame(() => {
      syncApplyingRef.current = false;
    });
  }, [candleSnapshotStore, paneId, syncedCrosshair]);

  useEffect(() => {
    if (
      !syncedVisibleRange ||
      syncedVisibleRange.sourcePaneId === paneId ||
      syncedVisibleRange.revision <= rangeSyncRevisionRef.current
    ) {
      return;
    }
    const chart = chartRef.current;
    if (!chart || barsRef.current.length === 0) return;
    rangeSyncRevisionRef.current = syncedVisibleRange.revision;
    syncApplyingRef.current = true;
    chart.timeScale().setVisibleRange({
      from: syncedVisibleRange.from as UTCTimestamp,
      to: syncedVisibleRange.to as UTCTimestamp,
    });
    window.requestAnimationFrame(() => {
      syncApplyingRef.current = false;
    });
  }, [paneId, syncedVisibleRange]);

  useLayoutEffect(() => {
    const timeframeChanged = previousTimeframeRef.current !== timeframe;
    const replaySeekChanged = previousReplaySeekVersionRef.current !== replaySeekVersion;
    const styleChanged = previousChartStyleRef.current !== chartStyle;
    previousTimeframeRef.current = timeframe;
    previousReplaySeekVersionRef.current = replaySeekVersion;
    previousChartStyleRef.current = chartStyle;
    const sourceDataChanged = previousDisplayBarsRef.current !== displayBars;
    previousDisplayBarsRef.current = displayBars;
    const forceSetData = timeframeChanged || replaySeekChanged || styleChanged;
    let dataChanged = false;

    if (candlesRef.current) {
      const next = toAscendingSeriesData(candleData);
      const plan = planSeriesDataUpdate(candleSeriesDataRef.current, next, forceSetData);
      applyCandlestickDataPlan(candlesRef.current, plan);
      candleSeriesDataRef.current = next;
      dataChanged ||= plan.mode !== "none";
    }
    if (lineRef.current) {
      const next = toAscendingSeriesData(closeLineData);
      const plan = planSeriesDataUpdate(lineSeriesDataRef.current, next, forceSetData);
      applyLineDataPlan(lineRef.current, plan);
      lineSeriesDataRef.current = next;
      dataChanged ||= plan.mode !== "none";
    }
    if (areaRef.current) {
      const next = toAscendingSeriesData(closeLineData);
      const plan = planSeriesDataUpdate(areaSeriesDataRef.current, next, forceSetData);
      applyAreaDataPlan(areaRef.current, plan);
      areaSeriesDataRef.current = next;
      dataChanged ||= plan.mode !== "none";
    }
    if (volumeRef.current) {
      const next = toAscendingHistogramData(volumeData);
      const plan = planSeriesDataUpdate(volumeSeriesDataRef.current, next, forceSetData);
      applyHistogramDataPlan(volumeRef.current, plan);
      volumeSeriesDataRef.current = next;
      dataChanged ||= plan.mode !== "none";
    }

    const resetFrames: number[] = [];
    if (displayBars.length > 0 && dataChanged && (sourceDataChanged || forceSetData)) {
      if (timeframeChanged || replaySeekChanged) {
        const firstFrame = window.requestAnimationFrame(() => {
          const secondFrame = window.requestAnimationFrame(() => resetChartView());
          resetFrames.push(secondFrame);
        });
        resetFrames.push(firstFrame);
      } else {
        chartRef.current?.timeScale().scrollToRealTime();
      }
    }
    if (dataChanged) {
      setPlotVersion((value) => value + 1);
    }
    return () => {
      resetFrames.forEach((frame) => window.cancelAnimationFrame(frame));
    };
  }, [
    candleData,
    chartSettings.volume,
    chartStyle,
    closeLineData,
    displayBars,
    hasVolumeData,
    paneId,
    replaySeekVersion,
    timeframe,
    volumeData,
  ]);

  useEffect(() => {
    const priceFormat = priceFormatFromPrecision(chartSettings.pricePrecision);
    const primaryPriceScaleId = primaryPriceScaleIdForPlacement(chartSettings.scalePlacement);
    chartRef.current?.applyOptions({
      crosshair: {
        mode: effectiveCrosshairVisible ? CrosshairMode.Normal : CrosshairMode.Hidden,
        horzLine: {
          color: chartSettings.crosshairColor,
          labelVisible: effectiveCrosshairVisible,
          visible: effectiveCrosshairVisible,
        },
        vertLine: {
          color: chartSettings.crosshairColor,
          labelVisible: effectiveCrosshairVisible,
          visible: effectiveCrosshairVisible,
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
        tickMarkFormatter: (time: Time, tickMarkType: TickMarkType) =>
          formatChartTickMark(time, tickMarkType, chartSettings),
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
        : TRANSPARENT_COLOR,
      lastValueVisible: chartSettings.symbolLine !== "hidden",
      priceFormat,
      priceLineVisible: chartSettings.symbolLine === "valueLine",
      priceScaleId: primaryPriceScaleId,
      upColor: chartSettings.bodyVisible
        ? chartSettings.bodyUpColor
        : TRANSPARENT_COLOR,
      wickDownColor: chartSettings.wickDownColor,
      wickUpColor: chartSettings.wickUpColor,
      wickVisible: chartSettings.wickVisible,
    });
    lineRef.current?.applyOptions({
      lastValueVisible: chartSettings.symbolLine !== "hidden",
      priceFormat,
      priceLineVisible: chartSettings.symbolLine === "valueLine",
      priceScaleId: primaryPriceScaleId,
    });
    areaRef.current?.applyOptions({
      lastValueVisible: chartSettings.symbolLine !== "hidden",
      priceFormat,
      priceLineVisible: chartSettings.symbolLine === "valueLine",
      priceScaleId: primaryPriceScaleId,
    });
    volumeRef.current?.applyOptions({ visible: chartSettings.volume && hasVolumeData });
    setPlotVersion((value) => value + 1);
  }, [chartSettings, effectiveCrosshairVisible, hasVolumeData, symbol]);

  useLayoutEffect(() => {
    const chart = chartRef.current;
    if (!chart) {
      return;
    }
    const primaryPriceScaleId = primaryPriceScaleIdForPlacement(chartSettings.scalePlacement);

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
          lineWidth: selectedIndicatorLineWidth(
            indicator.lineWidth,
            indicator.sourceId === renderedSelectedIndicatorId,
          ),
          lineStyle: indicator.lineStyle ?? 0,
          priceLineVisible: false,
          lastValueVisible: chartSettings.indicatorValues,
          priceScaleId: primaryPriceScaleId,
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
        lineWidth: selectedIndicatorLineWidth(
          indicator.lineWidth,
          indicator.sourceId === renderedSelectedIndicatorId,
        ),
        priceFormat: priceFormatFromPrecision(chartSettings.pricePrecision),
        priceScaleId: primaryPriceScaleId,
      });
      indicatorRefs.current[indicator.id].setData(toAscendingSeriesData(indicator.data));
    });
  }, [
    chartSettings.indicatorValues,
    chartSettings.pricePrecision,
    chartSettings.scalePlacement,
    indicatorDefinitions,
    renderedSelectedIndicatorId,
  ]);

  useLayoutEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const plots = customRuntimeStudies.flatMap((study) => study.overlay && study.pinePlot ? [study.pinePlot] : []);
    const installed = installPineChartPlots(chart, plots, primaryPriceScaleIdForPlacement(chartSettings.scalePlacement), { allowFillOnlyScale: false, scaleAnchor: barsRef.current.at(-1) });
    pineInstallationsRef.current.add(installed);
    return () => {
      pineInstallationsRef.current.delete(installed);
      installed.dispose();
    };
  }, [customRuntimeStudies, chartSettings.scalePlacement, paneId, latestDisplayBarTime]);

  useEffect(() => {
    const series = primarySeriesRef.current;
    if (!series) {
      return;
    }
    settingPriceLinesRef.current.forEach((line) => removePriceLineSafely(series, line));
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
      previousDayClose(displayBars, sessionTemplate),
      "Prev close",
      chartSettings.previousDayClose,
      "#94a3b8",
    );
    const extremes = highLowRange(displayBars);
    addSettingLine(extremes.high, "High", chartSettings.highLowLabels, chartSettings.bodyUpColor);
    addSettingLine(extremes.low, "Low", chartSettings.highLowLabels, chartSettings.bodyDownColor);

    return () => {
      settingPriceLinesRef.current.forEach((line) => removePriceLineSafely(series, line));
      settingPriceLinesRef.current = [];
    };
  }, [
    chartSettings.bodyDownColor,
    chartSettings.bodyUpColor,
    chartSettings.highLowLabels,
    chartSettings.previousDayClose,
    displayBars,
    paneId,
    primarySeriesKind,
    sessionTemplate,
  ]);

  useLayoutEffect(() => {
    primarySeriesRef.current?.setMarkers(
      [...(showOrderOverlays
        ? [
            ...executions.map((execution) => ({
              time: bucketTime(toUnixTime(execution.timestamp), timeframe) as UTCTimestamp,
              position: execution.side === "BUY" ? ("belowBar" as const) : ("aboveBar" as const),
              color: execution.side === "BUY" ? "#22c55e" : "#fb7185",
              shape: execution.side === "BUY" ? ("arrowUp" as const) : ("arrowDown" as const),
              text: execution.side,
            })),
            ...(replayFocusTrade
              ? [
                  {
                    time: bucketTime(toUnixTime(replayFocusTrade.entry_time), timeframe) as UTCTimestamp,
                    position: "belowBar" as const,
                    color: "#38bdf8",
                    shape: "circle" as const,
                    text: `Trade #${replayFocusTrade.id} start`,
                  },
                ]
              : []),
          ]
        : []), ...Object.values(pineStrategyMarkers).flat()].sort((left, right) => Number(left.time) - Number(right.time)),
    );
  }, [executions, paneId, pineStrategyMarkers, primarySeriesKind, replayFocusTrade, showOrderOverlays, timeframe]);

  useEffect(() => {
    const series = primarySeriesRef.current;
    if (!series) {
      return;
    }
    clearOrderPriceLines(series);

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

    if (activePosition) {
      addLine(
        activePosition.avg_price,
        "#a8b3c7",
        "Open",
        0,
      );
      addLine(activePosition.stop_loss, "#fb7185", "SL", 2);
      addLine(activePosition.take_profit, "#22c55e", "TP", 2);
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
    if (replayFocusTrade?.session_id) {
      addLine(
        replayFocusTrade.entry_price,
        "#38bdf8",
        `Trade #${replayFocusTrade.id} Start`,
        0,
      );
      addLine(replayFocusTrade.stop_loss, "#fda4af", `Trade #${replayFocusTrade.id} SL`, 2);
      addLine(replayFocusTrade.take_profit, "#86efac", `Trade #${replayFocusTrade.id} TP`, 2);
      addLine(replayFocusTrade.exit_price, "#c084fc", `Trade #${replayFocusTrade.id} Exit`, 2);
    }
    return () => clearOrderPriceLines(series);
  }, [
    activePosition,
    currency,
    orders,
    paneId,
    primarySeriesKind,
    replayFocusTrade,
    showOrderOverlays,
  ]);

  useEffect(() => {
    setDraftDrawing(null);
    setHoverPoint(null);
  }, [drawingTool]);

  useEffect(() => {
    if (!selectedDrawingId) {
      setDrawingToolbarOpen(false);
    }
  }, [selectedDrawingId]);

  function addDrawingAndMaybeOpenToolbar(drawing: ChartDrawing) {
    onAddDrawing(drawing);
    onSelectDrawing(drawing.id);
    setDrawingToolbarOpen(shouldAutoOpenDrawingToolbar(drawing));
    setSelectedIndicatorId(null);
    setIndicatorToolbarPosition(null);
  }

  function handleChartStageKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
    if (drawingTool === "cursor" || drawingTool === "crosshair" || drawingTool === "eraser") return;
    if (drawingRequiredPoints(drawingTool) !== 1) return;
    const frame = chartFrameRef.current;
    if (!frame) return;
    const bounds = frame.getBoundingClientRect();
    const point = pointFromClient(
      bounds.left + bounds.width / 2,
      bounds.top + bounds.height / 2,
      frame,
      chartRef.current,
      primarySeriesRef.current,
      barsRef.current,
      magnetMode,
    );
    if (!point) return;
    event.preventDefault();
    drawingToolbarReturnFocusRef.current = event.currentTarget;
    addDrawingAndMaybeOpenToolbar(
      makeDrawing(drawingTool, [point], drawingTool === "text" ? "Text" : undefined, drawingTool === "icon" || drawingTool === "flag" ? drawingMarker : undefined),
    );
    if (!keepDrawingAfterPlacement) onDrawingToolChange(neutralDrawingTool);
  }

  function handleDrawingClick(event: MouseEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.button !== 0) {
      return;
    }
    setChartContextMenuPosition(null);
    if (drawingTool === "cursor" || drawingTool === "crosshair" || drawingTool === "eraser") {
      const indicatorPoint = pixelFromClient(
        event.clientX,
        event.clientY,
        chartFrameRef.current,
      );
      const drawingHit = indicatorPoint
        ? hitTestDrawingAtPoint({
            chart: chartRef.current,
            drawings,
            frame: chartFrameRef.current,
            point: indicatorPoint,
            selectedDrawingId,
            series: primarySeriesRef.current,
          })
        : null;
      if (drawingTool === "eraser") {
        if (drawingHit && !drawingHit.drawing.locked) {
          event.preventDefault();
          onDeleteDrawing(drawingHit.drawing.id);
          onSelectDrawing(null);
          if (!keepDrawingAfterPlacement) onDrawingToolChange(neutralDrawingTool);
        }
        return;
      }
      if (drawingHit) {
        event.preventDefault();
        beginDrawingDrag(
          drawingHit.drawing,
          drawingHit.mode,
          drawingHit.pointIndex,
          event.clientX,
          event.clientY,
        );
        return;
      }
      const indicatorHit = indicatorPoint ? hitTestOverlayIndicator(indicatorPoint) : null;
      if (indicatorHit) {
        openIndicatorToolbarAtFramePoint(indicatorHit.indicatorId, indicatorHit.point);
        return;
      }
      onSelectDrawing(null);
      setDrawingToolbarOpen(false);
      setSelectedIndicatorId(null);
      setIndicatorToolbarPosition(null);
      return;
    }
    const point = pointFromClient(
      event.clientX,
      event.clientY,
      chartFrameRef.current,
      chartRef.current,
      primarySeriesRef.current,
      barsRef.current,
      magnetMode,
    );
    if (!point) {
      return;
    }

    const requiredPoints = drawingRequiredPoints(drawingTool);
    if (requiredPoints === 1) {
      const label = drawingTool === "text" ? "Text" : undefined;
      addDrawingAndMaybeOpenToolbar(
        makeDrawing(drawingTool, [point], label, drawingTool === "icon" || drawingTool === "flag" ? drawingMarker : undefined),
      );
      if (!keepDrawingAfterPlacement) {
        onDrawingToolChange(neutralDrawingTool);
      }
      return;
    }

    if (drawingTool === "brush") {
      setDraftDrawing({ tool: drawingTool, point, points: [point] });
      return;
    }

    if (!draftDrawing || draftDrawing.tool !== drawingTool) {
      setDraftDrawing({ tool: drawingTool, point, points: [point] });
      return;
    }

    const nextPoints = [...draftDrawing.points, point];
    if (requiredPoints != null && nextPoints.length < requiredPoints) {
      setDraftDrawing({ ...draftDrawing, points: nextPoints });
      return;
    }
    addDrawingAndMaybeOpenToolbar(makeDrawing(drawingTool, nextPoints));
    if (!keepDrawingAfterPlacement) {
      onDrawingToolChange(neutralDrawingTool);
    }
    setDraftDrawing(null);
    setHoverPoint(null);
  }

  function handleDrawingMove(event: MouseEvent<HTMLDivElement>) {
    if (dragState) {
      const dragMagnetMode = dragState.mode === "anchor" ? magnetMode : "off";
      const point = pointFromClient(
        event.clientX,
        event.clientY,
        chartFrameRef.current,
        chartRef.current,
        primarySeriesRef.current,
        barsRef.current,
        dragMagnetMode,
      );
      const pixel = pixelFromClient(event.clientX, event.clientY, chartFrameRef.current);
      if (!point || !pixel) {
        return;
      }
      if (Math.hypot(pixel.x - dragState.startPixel.x, pixel.y - dragState.startPixel.y) > 3) {
        drawingDragMovedRef.current = true;
        suppressNextDrawingClickRef.current = true;
      }
      const nextDrawing = moveDrawing(
        dragState,
        point,
        pixel,
        chartFrameRef.current,
        chartRef.current,
        primarySeriesRef.current,
        barsRef.current,
      );
      if (!nextDrawing) {
        return;
      }
      onUpdateDrawing(nextDrawing, true);
      return;
    }

    if (!draftDrawing || drawingTool === "cursor" || drawingTool === "crosshair") {
      return;
    }
    const nextPoint = pointFromClient(
        event.clientX,
        event.clientY,
        chartFrameRef.current,
        chartRef.current,
        primarySeriesRef.current,
        barsRef.current,
        magnetMode,
      );
    setHoverPoint(nextPoint);
    if (
      drawingTool === "brush" &&
      nextPoint &&
      event.buttons === 1 &&
      drawingPointDistance(draftDrawing.points.at(-1), nextPoint) > 0.5
    ) {
      setDraftDrawing((current) =>
        current?.tool === "brush"
          ? { ...current, points: [...current.points, nextPoint].slice(-256) }
          : current,
      );
    }
  }

  function finishDrawingInteraction() {
    if (draftDrawing?.tool === "brush" && draftDrawing.points.length >= 2) {
      addDrawingAndMaybeOpenToolbar(makeDrawing("brush", draftDrawing.points));
      setDraftDrawing(null);
      setHoverPoint(null);
      if (!keepDrawingAfterPlacement) onDrawingToolChange(neutralDrawingTool);
    }
    stopDrawingDrag();
  }

  function handleMagnetCrosshairMove(event: MouseEvent<HTMLDivElement>) {
    if (magnetMode === "off" || !effectiveCrosshairVisible || !isDrawingPlacementMode) {
      return;
    }

    const pixel = pixelFromClient(event.clientX, event.clientY, chartFrameRef.current);
    if (!pixel) {
      return;
    }
    const point = pointFromPixel(
      pixel.x,
      pixel.y,
      chartFrameRef.current,
      chartRef.current,
      primarySeriesRef.current,
      barsRef.current,
    );
    if (!point) {
      clearMagnetCrosshair();
      return;
    }

    const snap = resolveOhlcSnapPoint(
      point,
      pixel,
      chartRef.current,
      primarySeriesRef.current,
      barsRef.current,
      magnetMode,
    );
    const crosshairPoint = snap ?? (magnetMode === "weak" ? point : null);
    if (!crosshairPoint) {
      clearMagnetCrosshair();
      return;
    }
    scheduleMagnetCrosshair(crosshairPoint);
  }

  function handleMagnetCrosshairLeave() {
    clearMagnetCrosshair();
  }

  function handleChartContextMenu(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const frame = chartFrameRef.current;
    if (!frame) {
      return;
    }
    const rect = frame.getBoundingClientRect();
    const menuWidth = 256;
    const menuHeight =
      152 + (onCaptureChart ? 44 : 0) + (onOpenChartSettings ? 44 : 0);
    setChartContextMenuPosition({
      x: clamp(event.clientX - rect.left, 8, Math.max(8, rect.width - menuWidth - 8)),
      y: clamp(event.clientY - rect.top, 8, Math.max(8, rect.height - menuHeight - 8)),
    });
    setDrawingToolbarOpen(false);
    setSelectedIndicatorId(null);
    setIndicatorToolbarPosition(null);
  }

  function runChartContextMenuAction(
    action: () => void,
    event?: MouseEvent<HTMLElement>,
    restoreChartFocus = true,
  ) {
    event?.preventDefault();
    event?.stopPropagation();
    action();
    setChartContextMenuPosition(null);
    if (restoreChartFocus) {
      window.requestAnimationFrame(() => stageRef.current?.focus({ preventScroll: true }));
    }
  }

  function handleChartContextMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ),
    );
    if (items.length === 0) {
      return;
    }
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length;
    items[nextIndex]?.focus();
  }

  function resetChartView() {
    resetReplayChartViewport();
    primarySeriesRef.current?.priceScale().applyOptions({ autoScale: true });
    setPlotVersion((value) => value + 1);
  }

  function resetReplayChartViewport() {
    const chart = chartRef.current;
    if (!chart || displayBars.length === 0) {
      return;
    }

    const plotWidth =
      chartFrameRef.current && chartPlotWidth(chart, chartFrameRef.current) > 0
        ? chartPlotWidth(chart, chartFrameRef.current)
        : chart.paneSize().width;
    const visibleBars = clamp(
      Math.round(plotWidth / DEFAULT_REPLAY_BAR_SPACING),
      MIN_RESET_REPLAY_BARS,
      MAX_RESET_REPLAY_BARS,
    );
    const latestLogical = displayBars.length - 1;
    const to = latestLogical + DEFAULT_REPLAY_RIGHT_OFFSET;
    const from = Math.max(0, to - visibleBars);

    chart.timeScale().setVisibleLogicalRange({
      from: from as Logical,
      to: to as Logical,
    });
  }

  function removeAllIndicators() {
    indicatorInstances.forEach((indicator) => onRemoveIndicator(indicator.id));
  }

  function clearOrderPriceLines(series: PrimaryChartSeries) {
    priceLinesRef.current.forEach((line) => {
      try {
        series.removePriceLine(line);
      } catch {
        // Price lines can already be detached during chart teardown.
      }
    });
    priceLinesRef.current = [];
  }

  function updateOrderLineDrag(next: OrderLineDragState | null) {
    orderLineDragRef.current = next;
    setOrderLineDrag(next);
  }

  function schedulePriceScaleSync() {
    if (pendingPriceScaleSyncRef.current) {
      return;
    }
    pendingPriceScaleSyncRef.current = true;
    queueMicrotask(() => {
      pendingPriceScaleSyncRef.current = false;
      syncDrawingLayerToPriceScale();
    });
  }

  function schedulePriceScaleSettle() {
    if (!shouldWatchPriceScale) {
      return;
    }
    if (!priceScaleSettleSchedulerRef.current) {
      priceScaleSettleSchedulerRef.current = createPriceScaleSettleScheduler({
        cancelFrame: (frameId) => window.cancelAnimationFrame(frameId),
        requestFrame: (callback) => window.requestAnimationFrame(callback),
        synchronize: syncDrawingLayerToPriceScale,
      });
    }
    priceScaleSettleSchedulerRef.current.schedule();
  }

  function syncDrawingLayerToPriceScale() {
    const fingerprint = priceScaleCoordinateFingerprint(
      primarySeriesRef.current,
      barsRef.current,
    );
    if (fingerprint == null || fingerprint === priceScaleFingerprintRef.current) {
      return;
    }
    priceScaleFingerprintRef.current = fingerprint;
    flushSync(() => {
      setPlotVersion((value) => value + 1);
    });
  }

  function startOrderLineDrag(
    target: OrderLineDragTarget,
    price: number,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setChartContextMenuPosition(null);
    setDrawingToolbarOpen(false);
    setSelectedIndicatorId(null);
    setIndicatorToolbarPosition(null);
    updateOrderLineDrag({ target, price });
  }

  function priceFromClientY(clientY: number) {
    const frame = chartFrameRef.current;
    const chart = chartRef.current;
    const series = primarySeriesRef.current;
    if (!frame || !series) {
      return null;
    }
    const rect = frame.getBoundingClientRect();
    const plotHeight = chart ? chartPlotHeight(chart, frame) : frame.clientHeight;
    const y = clamp(clientY - rect.top, 0, Math.max(0, plotHeight - 1));
    const price = series.coordinateToPrice(y);
    return price != null && Number.isFinite(price) && price > 0 ? price : null;
  }

  function requestOrderLineModification(target: OrderLineDragTarget, price: number) {
    const draft = buildOrderLineModificationDraft({
      activePosition,
      nextPrice: price,
      orders,
      pnlMultiplier,
      target,
    });
    if (!draft) {
      applyOrderLineModification(target, price);
      return;
    }
    if (Math.abs(draft.nextPrice - draft.previousPrice) <= 1e-10) {
      return;
    }
    if (confirmOrderLineModifications) {
      setPendingOrderLineModification(draft);
      return;
    }
    applyOrderLineModification(target, draft.nextPrice);
  }

  function confirmPendingOrderLineModification() {
    if (!pendingOrderLineModification) {
      return;
    }
    applyOrderLineModification(
      pendingOrderLineModification.target,
      pendingOrderLineModification.nextPrice,
    );
    setPendingOrderLineModification(null);
  }

  function applyOrderLineModification(target: OrderLineDragTarget, price: number) {
    if (!Number.isFinite(price) || price <= 0) {
      return;
    }

    if (target.kind === "position") {
      const payload: PositionUpdatePayload =
        target.field === "stop_loss" ? { stop_loss: price } : { take_profit: price };
      void onUpdatePosition(payload);
      return;
    }

    const payload: OrderUpdatePayload =
      target.field === "limit_price"
        ? { limit_price: price }
        : target.field === "stop_price"
          ? { stop_price: price }
          : target.field === "stop_loss"
            ? { stop_loss: price }
            : { take_profit: price };
    void onAmendOrder(target.orderId, payload);
  }

  function scheduleMagnetCrosshair(point: DrawingPoint) {
    pendingCrosshairPointRef.current = point;
    if (crosshairFrameRef.current != null) {
      return;
    }
    crosshairFrameRef.current = window.requestAnimationFrame(() => {
      crosshairFrameRef.current = null;
      const target = pendingCrosshairPointRef.current;
      if (!target || !chartRef.current || !primarySeriesRef.current) {
        return;
      }
      const signature = `${target.time}:${target.price}`;
      chartRef.current.setCrosshairPosition(
        target.price,
        target.time as UTCTimestamp,
        primarySeriesRef.current,
      );
      snappedCrosshairRef.current = signature;
    });
  }

  function clearMagnetCrosshair() {
    cancelScheduledMagnetCrosshair();
    chartRef.current?.clearCrosshairPosition();
    snappedCrosshairRef.current = null;
  }

  function cancelScheduledMagnetCrosshair() {
    pendingCrosshairPointRef.current = null;
    if (crosshairFrameRef.current == null) {
      return;
    }
    window.cancelAnimationFrame(crosshairFrameRef.current);
    crosshairFrameRef.current = null;
  }

  function startDrawingDrag(
    drawing: ChartDrawing,
    mode: DragState["mode"],
    pointIndex: number | null,
    event: MouseEvent<SVGElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0) {
      return;
    }
    beginDrawingDrag(drawing, mode, pointIndex, event.clientX, event.clientY);
  }

  function beginDrawingDrag(
    drawing: ChartDrawing,
    mode: DragState["mode"],
    pointIndex: number | null,
    clientX: number,
    clientY: number,
  ) {
    drawingDragMovedRef.current = false;
    suppressNextDrawingClickRef.current = false;
    setDrawingToolbarOpen(false);
    setSelectedIndicatorId(null);
    setIndicatorToolbarPosition(null);
    const point = pointFromClient(
      clientX,
      clientY,
      chartFrameRef.current,
      chartRef.current,
      primarySeriesRef.current,
      barsRef.current,
    );
    if (!point) {
      return;
    }
    if (drawing.locked) {
      onSelectDrawing(drawing.id);
      setDrawingToolbarOpen(true);
      return;
    }
    const startPixel = pixelFromClient(clientX, clientY, chartFrameRef.current);
    if (!startPixel) {
      return;
    }
    const originalPixels = drawing.points.map((item) =>
      pixelFromPoint(item, chartRef.current, primarySeriesRef.current),
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
    if (dragState && drawingDragMovedRef.current) {
      setDrawingToolbarOpen(shouldAutoOpenDrawingToolbar(dragState.drawing));
      suppressNextDrawingClickRef.current = true;
      window.setTimeout(() => {
        suppressNextDrawingClickRef.current = false;
      }, 0);
    } else if (dragState) {
      setDrawingToolbarOpen(true);
    }
    setDragState(null);
  }

  function selectDrawingFromChart(
    drawingId: string,
    event: MouseEvent<SVGElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (suppressNextDrawingClickRef.current) {
      suppressNextDrawingClickRef.current = false;
      return;
    }
    onSelectDrawing(drawingId);
    setDrawingToolbarOpen(true);
    setSelectedIndicatorId(null);
    setIndicatorToolbarPosition(null);
  }

  function updateSelectedDrawing(patch: Partial<ChartDrawing>) {
    if (!selectedDrawing) {
      return;
    }
    onUpdateDrawing(
      {
        ...selectedDrawing,
        ...patch,
      },
      false,
    );
  }

  function openIndicatorToolbar(
    indicatorId: string,
    event: MouseEvent<HTMLElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    indicatorToolbarReturnFocusRef.current = event.currentTarget;
    const stageRect = stage.getBoundingClientRect();
    const triggerRect = event.currentTarget.getBoundingClientRect();
    const x = triggerRect.left - stageRect.left;
    const y = triggerRect.bottom - stageRect.top + 8;
    openIndicatorToolbarAtStagePoint(indicatorId, x, y);
  }

  function openIndicatorToolbarAtStagePoint(indicatorId: string, x: number, y: number) {
    if (indicatorToolbarFocusFrameRef.current !== null) window.cancelAnimationFrame(indicatorToolbarFocusFrameRef.current);
    indicatorToolbarFocusFrameRef.current = null;
    setSelectedIndicatorId(indicatorId);
    setIndicatorToolbarPosition(clampIndicatorToolbarPosition({ x, y }));
    onSelectDrawing(null);
    setDrawingToolbarOpen(false);
  }

  function closeIndicatorToolbar() {
    const closingIndicatorId = selectedIndicatorId;
    const closingToolbar = stageRef.current?.querySelector<HTMLElement>(".indicator-floating-toolbar");
    setSelectedIndicatorId(null);
    setIndicatorToolbarPosition(null);
    if (indicatorToolbarFocusFrameRef.current !== null) window.cancelAnimationFrame(indicatorToolbarFocusFrameRef.current);
    indicatorToolbarFocusFrameRef.current = window.requestAnimationFrame(() => {
      indicatorToolbarFocusFrameRef.current = null;
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body && active !== document.documentElement && active.isConnected && !closingToolbar?.contains(active)) return;
      const trigger = indicatorToolbarReturnFocusRef.current;
      const refreshedTrigger = Array.from(stageRef.current?.querySelectorAll<HTMLElement>(".chart-study-pill[data-indicator-id]") ?? [])
        .find((element) => element.dataset.indicatorId === closingIndicatorId && element.getClientRects().length);
      const target = trigger?.isConnected && trigger.getClientRects().length ? trigger : refreshedTrigger ?? stageRef.current;
      target?.focus({ preventScroll: true });
    });
  }

  function openIndicatorToolbarAtFramePoint(
    indicatorId: string,
    point: { x: number; y: number },
  ) {
    const stage = stageRef.current;
    const frame = chartFrameRef.current;
    if (!stage || !frame) {
      return;
    }
    indicatorToolbarReturnFocusRef.current = null;
    const stageRect = stage.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    openIndicatorToolbarAtStagePoint(
      indicatorId,
      frameRect.left - stageRect.left + point.x + 12,
      frameRect.top - stageRect.top + point.y - 18,
    );
  }

  function clampIndicatorToolbarPosition(position: { x: number; y: number }) {
    const stage = stageRef.current;
    if (!stage) {
      return position;
    }
    return {
      x: clamp(position.x, 12, Math.max(12, stage.clientWidth - 360)),
      y: clamp(position.y, 12, Math.max(12, stage.clientHeight - 96)),
    };
  }

  function hitTestOverlayIndicator(point: { x: number; y: number }) {
    return (
      findNearestFvgZone({
        chart: chartRef.current,
        definitions: fvgZoneDefinitions,
        frame: chartFrameRef.current,
        point,
        series: primarySeriesRef.current,
      }) ??
      findNearestOverlayIndicator({
        chart: chartRef.current,
        definitions: activeOverlayIndicators,
        frame: chartFrameRef.current,
        point,
        seriesById: indicatorRefs.current,
      })
    );
  }

  useEffect(() => {
    if (
      selectedIndicatorId &&
      !indicatorInstances.some((indicator) => indicator.id === selectedIndicatorId)
    ) {
      setSelectedIndicatorId(null);
      setIndicatorToolbarPosition(null);
    }
  }, [indicatorInstances, selectedIndicatorId]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || isDrawingPlacementMode || dragState != null) {
      return;
    }

    function handleChartClick(param: MouseEventParams<Time>) {
      if (!param.point) {
        return;
      }
      if (isNeutralTool) {
        const drawingHit = hitTestDrawingAtPoint({
          chart,
          drawings,
          frame: chartFrameRef.current,
          point: param.point,
          selectedDrawingId,
          series: primarySeriesRef.current,
        });
        if (drawingHit) {
          onSelectDrawing(drawingHit.drawing.id);
          setDrawingToolbarOpen(true);
          setSelectedIndicatorId(null);
          setIndicatorToolbarPosition(null);
          return;
        }
      }
      const indicatorIdFromSeries = sourceIndicatorIdForSeries(
        param.hoveredSeries,
        activeOverlayIndicators,
        indicatorRefs.current,
      );
      const hit = indicatorIdFromSeries
        ? { indicatorId: indicatorIdFromSeries, point: param.point }
        : hitTestOverlayIndicator(param.point);
      if (!hit) {
        if (isNeutralTool) {
          onSelectDrawing(null);
          setDrawingToolbarOpen(false);
          setSelectedIndicatorId(null);
          setIndicatorToolbarPosition(null);
        }
        return;
      }
      openIndicatorToolbarAtFramePoint(hit.indicatorId, hit.point);
    }

    chart.subscribeClick(handleChartClick);
    return () => chart.unsubscribeClick(handleChartClick);
  }, [
    activeOverlayIndicators,
    dragState,
    drawings,
    fvgZoneDefinitions,
    isDrawingPlacementMode,
    isNeutralTool,
    onSelectDrawing,
    selectedDrawingId,
  ]);

  useEffect(() => {
    if (!selectedIndicatorId) {
      return;
    }

    function closeIndicatorToolbarOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeIndicatorToolbar();
    }

    function closeIndicatorToolbarOnOutsideClick(event: globalThis.PointerEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) {
        return;
      }
      if (
        target.closest(".indicator-floating-toolbar") ||
        target.closest(".chart-study-pill") ||
        target.closest(".indicator-pane-title") ||
        target.closest(".indicator-pane-plot") ||
        target.closest(".themed-color-popover")
      ) {
        return;
      }
      setSelectedIndicatorId(null);
      setIndicatorToolbarPosition(null);
    }

    document.addEventListener("pointerdown", closeIndicatorToolbarOnOutsideClick);
    document.addEventListener("keydown", closeIndicatorToolbarOnEscape);
    return () =>
      { document.removeEventListener("pointerdown", closeIndicatorToolbarOnOutsideClick); document.removeEventListener("keydown", closeIndicatorToolbarOnEscape); };
  }, [selectedIndicatorId]);

  useEffect(() => {
    if (!drawingToolbarOpen || !selectedDrawing) return;
    function closeDrawingToolbarOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setDrawingToolbarOpen(false);
      drawingToolbarReturnFocusRef.current?.focus({ preventScroll: true });
    }
    document.addEventListener("keydown", closeDrawingToolbarOnEscape);
    return () => document.removeEventListener("keydown", closeDrawingToolbarOnEscape);
  }, [drawingToolbarOpen, selectedDrawing]);

  const unlockedDrawingsCount = removableDrawingsCount;
  const chartSummaryId = useId();
  const latestSummaryBar = displayBars.at(-1);
  const chartTextSummary = latestSummaryBar
    ? `${formatMarketSymbol(symbol)} ${formatChartTimeframeLabel(timeframe)} chart with ${displayBars.length} visible bars. Latest bar: open ${latestSummaryBar.open}, high ${latestSummaryBar.high}, low ${latestSummaryBar.low}, close ${latestSummaryBar.close}, volume ${latestSummaryBar.volume}.`
    : `${formatMarketSymbol(symbol)} ${formatChartTimeframeLabel(timeframe)} chart. ${dataState?.detail ?? "No bars are currently available."}`;

  return (
    <section
      aria-describedby={chartSummaryId}
      aria-keyshortcuts="Alt"
      aria-label={`${formatMarketSymbol(symbol)} ${formatChartTimeframeLabel(timeframe)} chart`}
      className="chart-stage"
      data-chart-capture-mode={captureMode ? "true" : undefined}
      data-market-pane-id={paneId}
      data-market-subscription-key={paneSubscriptionKey({ id: paneId, symbol, timeframe })}
      onPointerDownCapture={(event) => {
        const target = event.target as HTMLElement;
        if (!isEditableTarget(target) && !target.closest("button, [role='button'], a")) {
          stageRef.current?.focus({ preventScroll: true });
        }
      }}
      onKeyDown={handleChartStageKeyDown}
      onPointerMoveCapture={(event) => {
        lastChartPointerRef.current = { x: event.clientX, y: event.clientY };
      }}
      ref={stageRef}
      tabIndex={0}
    >
      <p className="sr-only" id={chartSummaryId}>{chartTextSummary}</p>
      {displayBars.length > 0 ? (
        <div className="sr-only">
          <table>
            <caption>{formatMarketSymbol(symbol)} recent price bars; newest five of {displayBars.length} visible bars</caption>
            <thead><tr><th scope="col">Time</th><th scope="col">Open</th><th scope="col">High</th><th scope="col">Low</th><th scope="col">Close</th><th scope="col">Volume</th></tr></thead>
            <tbody>{displayBars.slice(-5).map((bar) => <tr key={bar.time}><th scope="row">{new Date(Number(bar.time) * 1_000).toISOString()}</th><td>{bar.open}</td><td>{bar.high}</td><td>{bar.low}</td><td>{bar.close}</td><td>{bar.volume}</td></tr>)}</tbody>
          </table>
        </div>
      ) : null}
      {drawingControlsActive && radialToolbox && (
        <RadialDrawingToolbox
          anchor={radialToolbox.anchor}
          favorites={favoriteDrawingTools}
          highlightedIndex={radialToolbox.highlightedIndex}
          onHighlight={(highlightedIndex) =>
            setRadialToolbox((current) => current ? { ...current, highlightedIndex } : current)
          }
          onSelect={(tool) => {
            onDrawingToolChange(tool);
            setRadialToolbox(null);
            stageRef.current?.focus({ preventScroll: true });
          }}
        />
      )}
      <div className="chart-stage-header">
        <div className="min-w-0">
          <div className="min-w-0 flex-1">
            {chartSettings.title && (
              <div className="chart-title-summary flex items-center gap-3">
                <div aria-hidden="true" className="chart-symbol-badge grid h-10 w-10 place-items-center rounded-md bg-white text-sm font-black text-ink-950">
                  {symbolBadge(symbol)}
                </div>
                <div className="chart-title-copy min-w-0">
                  <div className="flex items-center gap-2 text-base font-semibold text-white">
                    {formatMarketSymbol(symbol)}
                  </div>
                  <div className="truncate text-xs text-slate-400">
                    {datasetTimeframe ?? formatChartTimeframeLabel(timeframe)} source / {formatChartTimeframeLabel(timeframe)} view / {chartStyleLabel(chartStyle)} / {getChartTimeZoneLabel(chartSettings.timeZone)} time
                  </div>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-slate-400">
                    <span
                      aria-label={`Trading hours mode: ${chartSettings.tradingHoursMode === "regular" ? "Regular Trading Hours" : "Extended Trading Hours"}`}
                      className="rounded border border-cyan-300/20 bg-cyan-300/[0.07] px-1.5 py-0.5 font-semibold text-cyan-100"
                    >
                      {chartSettings.tradingHoursMode === "regular" ? "RTH" : "ETH"}
                    </span>
                    <span
                      aria-label={`Session template: ${sessionTemplate.label}, ${sessionTemplate.scheduleLabel}, ${sessionTemplate.timeZone}`}
                      className="max-w-72 truncate"
                      title={`${sessionTemplate.exchange} · ${sessionTemplate.scheduleLabel} · ${sessionTemplate.timeZone}`}
                    >
                      {sessionTemplate.exchange} · {sessionTemplate.timeZone}
                    </span>
                    <SubscribedSessionPhase
                      captureMode={captureMode}
                      fallbackCandle={displayBars.at(-1) ?? null}
                      sessionTemplate={sessionTemplate}
                      store={candleSnapshotStore}
                    />
                    {chartSettings.tradingHoursMode === "regular" && sessionFilteredBarCount > 0 ? (
                      <span aria-label={`${sessionFilteredBarCount} extended-hours bars hidden`}>
                        · {sessionFilteredBarCount} hidden
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
            {(chartSettings.chartValues ||
              chartSettings.barChangeValues ||
              (chartSettings.volume && hasVolumeData)) && (
              <SubscribedOhlcvStrip
                captureMode={captureMode}
                chartSettings={chartSettings}
                fallbackCandle={displayBars.at(-1) ?? null}
                pricePrecision={chartSettings.pricePrecision}
                showChange={chartSettings.barChangeValues}
                showOhlc={chartSettings.chartValues}
                showVolume={chartSettings.volume && hasVolumeData}
                store={candleSnapshotStore}
              />
            )}
            {(chartSettings.indicatorTitles || chartSettings.indicatorValues) && (
              <div className="chart-study-row">
                {overlayIndicatorPills.slice(0, 5).map((indicator) => (
                  <button
                    className={`chart-study-pill ${renderedSelectedIndicatorId === indicator.id ? "chart-study-pill-active" : ""}`}
                    key={indicator.id}
                    onClick={(event) => openIndicatorToolbar(indicator.id, event)}
                    type="button"
                  >
                    <span
                      className="h-2 w-2 rounded-sm"
                      style={{ backgroundColor: indicator.color }}
                    />
                    {chartSettings.indicatorTitles && <span>{indicator.label}</span>}
                    {chartSettings.indicatorValues && (
                      <strong>
                        {indicator.valueText ??
                          (indicator.data.length > 0
                            ? latestIndicatorValue(indicator.data)?.toFixed(5) ?? "—"
                            : "—")}
                      </strong>
                    )}
                  </button>
                ))}
                {rsiStudies.map((study) =>
                  study.data.length > 0 ? (
                    <button
                      className={`chart-study-pill ${renderedSelectedIndicatorId === study.id ? "chart-study-pill-active" : ""}`}
                      key={`header-${study.id}`}
                      onClick={(event) => openIndicatorToolbar(study.id, event)}
                      type="button"
                    >
                      <span
                        className="h-2 w-2 rounded-sm"
                        style={{ backgroundColor: study.color }}
                      />
                      {chartSettings.indicatorTitles && <span>{study.label}</span>}
                      {chartSettings.indicatorValues && (
                        <strong>{latestIndicatorValue(study.data)?.toFixed(2) ?? "—"}</strong>
                      )}
                    </button>
                  ) : null,
                )}
                {macdStudies.map((study) => (
                  <button
                    className={`chart-study-pill ${renderedSelectedIndicatorId === study.id ? "chart-study-pill-active" : ""}`}
                    key={`header-${study.id}`}
                    onClick={(event) => openIndicatorToolbar(study.id, event)}
                    type="button"
                  >
                    <span
                      className="h-2 w-2 rounded-sm"
                      style={{ backgroundColor: study.color }}
                    />
                    {chartSettings.indicatorTitles && <span>{study.label}</span>}
                    {chartSettings.indicatorValues && (
                      <strong>{latestIndicatorValue(study.data.macd)?.toFixed(5) ?? "—"}</strong>
                    )}
                  </button>
                ))}
                {atrStudies.map((study) =>
                  study.data.length > 0 ? (
                    <button
                      className={`chart-study-pill ${renderedSelectedIndicatorId === study.id ? "chart-study-pill-active" : ""}`}
                      key={`header-${study.id}`}
                      onClick={(event) => openIndicatorToolbar(study.id, event)}
                      type="button"
                    >
                      <span
                        className="h-2 w-2 rounded-sm"
                        style={{ backgroundColor: study.color }}
                      />
                      {chartSettings.indicatorTitles && <span>{study.label}</span>}
                      {chartSettings.indicatorValues && (
                        <strong>{latestIndicatorValue(study.data)?.toFixed(5) ?? "—"}</strong>
                      )}
                    </button>
                  ) : null,
                )}
                {momentumStudies.map((study) =>
                  study.data.length > 0 ? (
                    <button
                      className={`chart-study-pill ${renderedSelectedIndicatorId === study.id ? "chart-study-pill-active" : ""}`}
                      key={`header-${study.id}`}
                      onClick={(event) => openIndicatorToolbar(study.id, event)}
                      type="button"
                    >
                      <span
                        className="h-2 w-2 rounded-sm"
                        style={{ backgroundColor: study.color }}
                      />
                      {chartSettings.indicatorTitles && <span>{study.label}</span>}
                      {chartSettings.indicatorValues && (
                        <strong>{latestIndicatorValue(study.data)?.toFixed(5) ?? "—"}</strong>
                      )}
                    </button>
                  ) : null,
                )}
                {orderFlowStudies.map((study) => (
                  <button
                    className={`chart-study-pill ${renderedSelectedIndicatorId === study.id ? "chart-study-pill-active" : ""}`}
                    key={`header-${study.id}`}
                    onClick={(event) => openIndicatorToolbar(study.id, event)}
                    title={study.data.length > 0 ? study.label : orderFlowAvailability.detail}
                    type="button"
                  >
                    <span
                      className="h-2 w-2 rounded-sm"
                      style={{ backgroundColor: study.color }}
                    />
                    {chartSettings.indicatorTitles && <span>{study.label}</span>}
                    {chartSettings.indicatorValues && (
                      <strong>
                        {latestIndicatorValue(study.data)?.toFixed(2) ?? "No feed"}
                      </strong>
                    )}
                  </button>
                ))}
                {customHeaderGroups.map((studies) => {
                  const buttons = studies.map((study) => {
                    const semantics = indicatorInstances.find((indicator) => indicator.id === study.sourceId)?.customQuantSemantics;
                    const isScore = semantics?.scorePlotName === study.plotName;
                    const isProbability = semantics?.probabilityPlotName === study.plotName;
                    const label = isScore ? semantics.scoreLabel : isProbability ? semantics.probabilityLabel : study.label;
                    const detail = isScore ? semantics.scoreSemantics : isProbability ? semantics.probabilitySemantics : study.label;
                    return <button
                      className={`chart-study-pill ${renderedSelectedIndicatorId === study.sourceId ? "chart-study-pill-active" : ""}`}
                      data-indicator-id={study.sourceId}
                      key={`header-${study.id}`}
                      onClick={(event) => openIndicatorToolbar(study.sourceId, event)}
                      title={`${study.error ?? detail}${semantics ? ` · ${semantics.modelProvenance}` : ""}`}
                      type="button"
                    >
                      <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: study.error ? "#fb7185" : study.color }} />
                      {chartSettings.indicatorTitles && <span>{label}</span>}
                      {chartSettings.indicatorValues && study.pinePlot?.kind !== "barcolor" && <strong>{study.error ? "Error" : latestIndicatorValue(study.data)?.toFixed(isProbability ? 1 : 4) ?? "—"}{isProbability ? "%" : ""}</strong>}
                    </button>;
                  });
                  if (studies.length <= 4 || !studies.some((study) => study.pinePlot)) return buttons;
                  const sourceId = studies[0].sourceId;
                  const name = indicatorInstances.find((indicator) => indicator.id === sourceId)?.customScriptName ?? "Pine script";
                  return <div className="flex min-w-0 basis-full flex-wrap items-start gap-2" key={`outputs-${sourceId}`}>
                    <button aria-label={name} data-indicator-id={sourceId} className={`chart-study-pill max-md:min-h-11 ${renderedSelectedIndicatorId === sourceId ? "chart-study-pill-active" : ""}`} onClick={(event) => openIndicatorToolbar(sourceId, event)} title={`Edit ${name}`} type="button">{chartSettings.indicatorTitles ? name : <Settings2 aria-hidden="true" className="h-3.5 w-3.5" />}</button>
                    <details className="min-w-0 max-w-full text-slate-400">
                      <summary className="min-h-6 cursor-pointer rounded px-1.5 py-1 text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 max-md:min-h-11">{studies.length} outputs</summary>
                      <div className="flex max-h-36 min-w-0 max-w-full flex-wrap gap-2 overflow-y-auto py-2 [&>button]:max-md:min-h-11">{buttons}</div>
                    </details>
                  </div>;
                })}
                {indicatorInstances.filter((indicator) => indicator.visible !== false && indicator.customQuantSemantics != null && indicator.customQuantSemantics.probabilityPlotName == null).map((indicator) => (
                  <span className="chart-study-pill" key={`probability-${indicator.id}`} title={`${indicator.customQuantSemantics!.probabilitySemantics} · ${indicator.customQuantSemantics!.modelProvenance}`}>
                    <span className="h-2 w-2 rounded-sm bg-slate-500" />
                    <span>{indicator.customQuantSemantics!.probabilityLabel}</span>
                    <strong>Not calibrated</strong>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="chart-stage-notices">
        <PineChartNotices studies={customNoticeStudies} include={viewportSizedPricePlot ? "warnings" : "all"} />
      </div>
      <div
        className={`chart-canvas-grid ${
          chartSettings.scalePlacement === "left" ? "chart-canvas-grid-rail-right" : ""
        } ${showDrawingRail && drawingControlsActive ? "" : "chart-canvas-grid-no-rail"}`}
      >
        {showDrawingRail && drawingControlsActive ? (
          <DrawingRail
            activeTool={drawingTool}
            canUndoDrawingChange={canUndoDrawingChange}
            clearableDrawingsCount={unlockedDrawingsCount}
            drawingsCount={drawings.length}
            magnetMode={magnetMode}
            onClearDrawings={onClearDrawings}
            onMagnetModeChange={onMagnetModeChange}
            onToolChange={onDrawingToolChange}
            onUndoDrawingChange={onUndoDrawingChange}
            undoShortcutLabel={undoShortcutLabel}
          />
        ) : null}

        <div className="chart-plot-column relative min-w-0">
          <div
            ref={chartFrameRef}
            className="chart-frame"
            onContextMenu={handleChartContextMenu}
            onMouseDown={handleDrawingClick}
            onMouseLeave={handleMagnetCrosshairLeave}
            onMouseMove={handleMagnetCrosshairMove}
            onMouseUp={finishDrawingInteraction}
            onDoubleClickCapture={schedulePriceScaleSettle}
            onPointerCancelCapture={schedulePriceScaleSettle}
            onPointerMove={schedulePriceScaleSync}
            onPointerUpCapture={schedulePriceScaleSettle}
            onTouchEndCapture={schedulePriceScaleSettle}
            onWheel={schedulePriceScaleSync}
            style={{ backgroundColor: chartSettings.backgroundColor }}
          >
            <div
              ref={chartContainerRef}
              className="chart-container-surface"
              style={{ backgroundColor: chartSettings.backgroundColor }}
            />
            {chartSettings.tradingHoursMode === "extended" && sessionShadeElements.length > 0 ? (
              <svg
                aria-label={`${sessionTemplate.label} background sessions. Pre-market, post-market, and closed periods use distinct labeled shading.`}
                className="pointer-events-none absolute left-0 top-0 z-[1] overflow-hidden"
                height={Math.max(0, drawingPlotHeight)}
                role="img"
                width={Math.max(0, drawingPlotWidth)}
              >
                <title>{`${sessionTemplate.exchange} session backgrounds in ${sessionTemplate.timeZone}`}</title>
                {sessionShadeElements}
              </svg>
            ) : null}
            {orderFlowCanvasReady ? (
              <svg
                aria-label={
                  chartStyle === "footprint"
                    ? `Footprint chart using ${chartSettings.footprintDisplayMode} cells from aggressor-side trade aggregates.`
                    : `TPO Market Profile with ${chartSettings.tpoBracketMinutes}-minute brackets and ${chartSettings.tpoValueAreaPercent} percent value area.`
                }
                className="pointer-events-none absolute left-0 top-0 z-[2] overflow-hidden"
                height={Math.max(0, drawingPlotHeight)}
                role="img"
                width={Math.max(0, drawingPlotWidth)}
              >
                <title>
                  {chartStyle === "footprint"
                    ? "Trade-level footprint"
                    : "TPO Market Profile"}
                </title>
                {chartStyle === "footprint"
                  ? footprintPresentation.elements
                  : marketProfileElements}
              </svg>
            ) : null}
            {(chartStyle === "footprint" || chartStyle === "tpo") &&
            displayBars.length > 0 &&
            !orderFlowCanvasReady ? (
              <div
                className="pointer-events-none absolute inset-0 z-20 grid place-items-center px-6 text-center"
                role="status"
              >
                <div className="max-w-md rounded-md border border-amber-300/20 bg-slate-950/95 px-4 py-3 text-sm text-slate-200 shadow-lg">
                  <strong className="block text-amber-100">
                    {orderFlowAvailability.status === "insufficient"
                      ? "Aggressor side unavailable"
                      : "Trade-level data unavailable"}
                  </strong>
                  <span className="mt-1 block text-xs leading-5 text-slate-400">
                    {orderFlowAvailability.detail}
                  </span>
                </div>
              </div>
            ) : null}
            {chartStyle === "footprint" &&
            orderFlowCanvasReady &&
            !footprintPresentation.detailVisible ? (
              <div className="pointer-events-none absolute bottom-2 left-2 z-[3] rounded bg-slate-950/85 px-2 py-1 text-xs text-slate-300">
                Summary profile · zoom in for price-level cells
              </div>
            ) : null}
            {(chartStyle === "footprint" || chartStyle === "tpo") &&
            orderFlowCanvasReady &&
            orderFlowAvailability.status === "partial" ? (
              <div
                className="pointer-events-none absolute bottom-2 right-2 z-[3] max-w-72 rounded bg-amber-950/90 px-2 py-1 text-xs text-amber-100"
                role="status"
              >
                Partial order-flow coverage · missing bars remain blank
              </div>
            ) : null}
            {(chartStyle === "footprint" || chartStyle === "tpo") &&
            chartSettings.footprintShowStats ? (
              <SubscribedOrderFlowStats
                captureMode={captureMode}
                fallbackCandle={displayBars.at(-1) ?? null}
                metric={chartSettings.footprintStatsMetric}
                orderFlowByTime={orderFlowByTime}
                store={candleSnapshotStore}
              />
            ) : null}
            {bars.length === 0 && dataState && dataState.status !== "available" ? (
              <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center px-6 text-center" role="status">
                <div className="max-w-sm rounded-md border border-white/10 bg-slate-950/95 px-4 py-3 text-sm text-slate-200 shadow-lg">
                  <strong className="block text-slate-100">
                    {dataState.status === "unavailable" ? "No pane data subscription" : "No chart data"}
                  </strong>
                  <span className="mt-1 block text-xs leading-5 text-slate-400">{dataState.detail}</span>
                </div>
              </div>
            ) : null}
            {bars.length > 0 && dataState && (dataState.status === "stale" || dataState.status === "gapped") ? (
              <div className="pointer-events-none absolute right-2 top-2 z-20 max-w-xs rounded bg-amber-950/90 px-2 py-1 text-xs text-amber-100" role="status">
                {dataState.detail}
              </div>
            ) : null}
            {bars.length > 0 && displayBars.length === 0 ? (
              <div
                className="pointer-events-none absolute inset-0 z-20 grid place-items-center px-6 text-center"
                role="status"
              >
                <div className="max-w-sm rounded-md border border-white/10 bg-slate-950/90 px-4 py-3 text-sm text-slate-200 shadow-lg">
                  No regular-session bars in this range. Switch this pane to ETH to view
                  every published bar.
                </div>
              </div>
            ) : null}
            <div
              className={`absolute left-0 top-0 z-10 ${drawingLayerCapturesPointer ? "pointer-events-auto" : "pointer-events-none"} ${isDrawingPlacementMode || isCrosshairTool ? "cursor-crosshair" : "cursor-default"}`}
              onMouseLeave={finishDrawingInteraction}
              onMouseMove={handleDrawingMove}
              onMouseUp={stopDrawingDrag}
              style={{
                height: Math.max(0, drawingPlotHeight),
                width: Math.max(0, drawingPlotWidth),
              }}
            >
              <svg className="h-full w-full overflow-hidden pointer-events-none">
                <defs>
                  <clipPath id={drawingClipIdRef.current}>
                    <rect
                      height={Math.max(0, drawingPlotHeight)}
                      width={Math.max(0, drawingPlotWidth)}
                      x={0}
                      y={0}
                    />
                  </clipPath>
                </defs>
                <g clipPath={`url(#${drawingClipIdRef.current})`}>
                  {chartSettings.sessionBreaks &&
                    buildSessionBreakElements(
                      displayBars,
                      chartFrameRef.current,
                      chartRef.current,
                      colorWithOpacity(chartSettings.sessionBreakColor, 0.72),
                      chartSettings.sessionBreakLineStyle,
                      chartSettings.sessionBreakLineWidth,
                      sessionTemplate,
                    )}
                  {fvgZoneElements}
                  {drawingElements}
                </g>
              </svg>
            </div>
            {showOrderOverlays && orderEditLines.length > 0 && (
              <div
                className="chart-order-edit-layer"
                style={{
                  height: Math.max(0, drawingPlotHeight),
                  width: Math.max(0, drawingPlotWidth),
                }}
              >
                {orderEditLines.map((line) => {
                  const y = primarySeriesRef.current?.priceToCoordinate(line.price);
                  if (
                    y == null ||
                    y < -12 ||
                    y > Math.max(0, drawingPlotHeight) + 12
                  ) {
                    return null;
                  }
                  const linePreview =
                    orderLineDragPreview &&
                    orderLineTargetsEqual(line.target, orderLineDragPreview.target)
                      ? orderLineDragPreview.stats
                      : null;
                  return (
                    <button
                      className="chart-order-edit-row"
                      key={line.key}
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) =>
                        startOrderLineDrag(line.target, line.price, event)
                      }
                      style={{ top: y }}
                      title={`Drag ${line.label}`}
                      type="button"
                    >
                      <span
                        className="chart-order-edit-track"
                        style={{ backgroundColor: line.color }}
                      />
                      <span
                        className="chart-order-edit-label"
                        style={{ borderColor: colorWithOpacity(line.color, 0.58) }}
                      >
                        <span className="chart-order-edit-label-main">
                          <span>{line.label}</span>
                          <strong>{formatPrice(line.price)}</strong>
                        </span>
                        {linePreview && (
                          <span className="chart-order-edit-preview">
                            <span
                              className={
                                linePreview.pnl == null || linePreview.pnl === 0
                                  ? "text-slate-300"
                                  : linePreview.pnl > 0
                                    ? "text-emerald-200"
                                    : "text-rose-200"
                              }
                            >
                              {linePreview.pnlLabel}{" "}
                              {linePreview.pnl == null
                                ? "-"
                                : formatMoney(linePreview.pnl, currency)}
                            </span>
                            <span>{formatRr(linePreview.rr)}</span>
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {!captureMode && selectedDrawing && floatingToolbarPosition && isNeutralTool && (
              <FloatingDrawingToolbar
                key={selectedDrawing.id}
                drawing={selectedDrawing}
                onChange={updateSelectedDrawing}
                onDelete={() => {
                  onDeleteDrawing(selectedDrawing.id);
                  onSelectDrawing(null);
                  setDrawingToolbarOpen(false);
                }}
                position={floatingToolbarPosition}
              />
            )}
            {activePosition && positionOverlayPosition && showOrderOverlays && (
              <PositionLineOverlay
                currency={currency}
                open={captureMode ? false : positionActionsOpen}
                onCloseFraction={(fraction) => {
                  onClosePositionFraction(fraction);
                  setPositionActionsOpen(false);
                }}
                onToggleOpen={() => setPositionActionsOpen((value) => !value)}
                position={activePosition}
                x={positionOverlayPosition.x}
                y={positionOverlayPosition.y}
              />
            )}
            {chartContextMenuPosition && (
              <div
                className="chart-context-menu"
                data-chart-capture-exclude="true"
                onClick={(event) => event.stopPropagation()}
                onContextMenu={(event) => event.preventDefault()}
                onKeyDown={handleChartContextMenuKeyDown}
                onMouseDown={(event) => event.stopPropagation()}
                onMouseUp={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                role="menu"
                ref={chartContextMenuRef}
                style={{
                  left: chartContextMenuPosition.x,
                  top: chartContextMenuPosition.y,
                }}
              >
                {onCaptureChart ? (
                  <button
                    className="chart-context-menu-row"
                    onClick={(event) => runChartContextMenuAction(onCaptureChart, event)}
                    role="menuitem"
                    type="button"
                  >
                    <Camera size={17} />
                    <span>Capture layout as PNG</span>
                  </button>
                ) : null}
                {onOpenChartSettings ? (
                  <button
                    className="chart-context-menu-row"
                    onClick={(event) =>
                      runChartContextMenuAction(onOpenChartSettings, event, false)
                    }
                    role="menuitem"
                    type="button"
                  >
                    <Settings2 size={17} />
                    <span>Chart settings</span>
                  </button>
                ) : null}
                <button
                  className="chart-context-menu-row"
                  onClick={(event) => runChartContextMenuAction(resetChartView, event)}
                  role="menuitem"
                  type="button"
                >
                  <RotateCcw size={17} />
                  <span>Reset chart view</span>
                </button>
                <button
                  className="chart-context-menu-row"
                  disabled={removableDrawingsCount === 0}
                  onClick={(event) => runChartContextMenuAction(onClearDrawings, event)}
                  role="menuitem"
                  type="button"
                >
                  <Trash2 size={17} />
                  <span>Remove drawings</span>
                </button>
                <button
                  className="chart-context-menu-row"
                  disabled={indicatorInstances.length === 0}
                  onClick={(event) => runChartContextMenuAction(removeAllIndicators, event)}
                  role="menuitem"
                  type="button"
                >
                  <Layers size={17} />
                  <span>Remove indicators</span>
                </button>
              </div>
            )}
            {pendingOrderLineModification && (
              <OrderLineModificationDialog
                currency={currency}
                draft={pendingOrderLineModification}
                onCancel={() => setPendingOrderLineModification(null)}
                onConfirm={confirmPendingOrderLineModification}
              />
            )}
          </div>
          {viewportSizedPricePlot && <PineChartNotices studies={customNoticeStudies} include="assumptions" />}
          {rsiStudies.map((study) => (
            <RsiPanel
              color={study.color}
              data={study.data}
              key={study.id}
              label={study.label}
              lineStyle={study.lineStyle}
              lineWidth={study.lineWidth}
              onOpenSettings={(event) => openIndicatorToolbar(study.id, event)}
              selected={renderedSelectedIndicatorId === study.id}
            />
          ))}
          {macdStudies.map((study) => (
            <MacdPanel
              color={study.color}
              data={study.data}
              histogramColor={study.histogramColor}
              key={study.id}
              label={study.label}
              lineStyle={study.lineStyle}
              lineWidth={study.lineWidth}
              onOpenSettings={(event) => openIndicatorToolbar(study.id, event)}
              selected={renderedSelectedIndicatorId === study.id}
              signalColor={study.signalColor}
            />
          ))}
          {atrStudies.map((study) => (
            <StudyLinePanel
              color={study.color}
              data={study.data}
              key={study.id}
              label={study.label}
              lineStyle={study.lineStyle}
              lineWidth={study.lineWidth}
              onOpenSettings={(event) => openIndicatorToolbar(study.id, event)}
              selected={renderedSelectedIndicatorId === study.id}
              valueDigits={5}
            />
          ))}
          {momentumStudies.map((study) => (
            <StudyLinePanel
              color={study.color}
              data={study.data}
              key={study.id}
              label={study.label}
              lineStyle={study.lineStyle}
              lineWidth={study.lineWidth}
              onOpenSettings={(event) => openIndicatorToolbar(study.id, event)}
              selected={renderedSelectedIndicatorId === study.id}
              valueDigits={5}
              zeroLine
            />
          ))}
          {orderFlowStudies.map((study) => (
            <StudyLinePanel
              color={study.color}
              data={study.data}
              emptyMessage={orderFlowAvailability.detail}
              key={study.id}
              label={study.label}
              lineStyle={study.lineStyle}
              lineWidth={study.lineWidth}
              onOpenSettings={(event) => openIndicatorToolbar(study.id, event)}
              selected={renderedSelectedIndicatorId === study.id}
              valueDigits={2}
              zeroLine
            />
          ))}
          {customRuntimeStudies.filter((study) => (!study.overlay || study.error) && !study.pinePlot).map((study) => (
            <StudyLinePanel
              color={study.color}
              data={study.data}
              emptyMessage={study.error ?? "The script has not produced a finite value yet."}
              key={study.id}
              label={study.label}
              lineStyle="solid"
              lineWidth={2}
              onOpenSettings={(event) => openIndicatorToolbar(study.sourceId, event)}
              selected={renderedSelectedIndicatorId === study.sourceId}
              valueDigits={4}
              zeroLine={!study.overlay}
            />
          ))}
          {[...pinePaneGroups].map(([sourceId, plots]) => {
            const indicator = indicatorInstances.find((item) => item.id === sourceId && item.visible !== false);
            return indicator ? <NativePineStudyPanel key={indicator.id} label={indicator.customScriptName ?? "Pine script"} plots={plots} priceChart={chartRef.current} onOpenSettings={(event) => openIndicatorToolbar(indicator.id, event)} selected={renderedSelectedIndicatorId === indicator.id} /> : null;
          })}
        </div>
      </div>

      {!captureMode && selectedIndicator && indicatorToolbarPosition && (
        <FloatingIndicatorToolbar
          key={selectedIndicator.id}
          indicator={selectedIndicator}
          onChange={(settings) => onUpdateIndicatorSettings(selectedIndicator.id, settings)}
          onClose={closeIndicatorToolbar}
          onRemove={() => {
            onRemoveIndicator(selectedIndicator.id);
            closeIndicatorToolbar();
          }}
          onPositionChange={(position) =>
            setIndicatorToolbarPosition(clampIndicatorToolbarPosition(position))
          }
          onToggleVisibility={() => {
            onToggleIndicatorVisibility(selectedIndicator.id);
            if (selectedIndicator.visible !== false) closeIndicatorToolbar();
          }}
          position={indicatorToolbarPosition}
        />
      )}

      {!captureMode && drawingTool !== "cursor" && drawingTool !== "crosshair" && (
        <div className="absolute left-20 top-20 z-20 rounded-md border border-cyan-300/20 bg-ink-950/95 px-3 py-2 text-xs text-cyan-100 shadow-panel">
          {draftDrawing
            ? drawingTool === "brush"
              ? "Drag to draw, then release"
              : `Place anchor ${draftDrawing.points.length + 1}${drawingRequiredPoints(drawingTool) ? ` of ${drawingRequiredPoints(drawingTool)}` : ""}`
            : drawingTool === "eraser"
              ? "Click an unlocked drawing to erase it"
              : `Click to place ${toolLabel(drawingTool)}`}
        </div>
      )}

    </section>
  );
}

function useHeaderCandle(
  store: ChartCandleSnapshotStore,
  fallbackCandle: Candle | null,
  captureMode: boolean,
) {
  const hoveredCandle = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  return (captureMode ? null : hoveredCandle) ?? fallbackCandle;
}

function SubscribedSessionPhase({
  captureMode,
  fallbackCandle,
  sessionTemplate,
  store,
}: {
  captureMode: boolean;
  fallbackCandle: Candle | null;
  sessionTemplate: ChartSessionTemplate;
  store: ChartCandleSnapshotStore;
}) {
  const candle = useHeaderCandle(store, fallbackCandle, captureMode);
  const phase = candle ? sessionPhaseAt(candle.time, sessionTemplate) : null;
  if (!phase) return null;
  const label = chartSessionPhaseLabel(phase);
  return <span aria-label={`Current bar session: ${label}`}>· {label}</span>;
}

function SubscribedOhlcvStrip({
  captureMode,
  chartSettings,
  fallbackCandle,
  pricePrecision,
  showChange,
  showOhlc,
  showVolume,
  store,
}: {
  captureMode: boolean;
  chartSettings: ChartVisualSettings;
  fallbackCandle: Candle | null;
  pricePrecision: number;
  showChange: boolean;
  showOhlc: boolean;
  showVolume: boolean;
  store: ChartCandleSnapshotStore;
}) {
  const candle = useHeaderCandle(store, fallbackCandle, captureMode);
  return (
    <OhlcvStrip
      candle={candle}
      chartSettings={chartSettings}
      pricePrecision={pricePrecision}
      showChange={showChange}
      showOhlc={showOhlc}
      showVolume={showVolume}
      tone={candleChangeTone(candle)}
    />
  );
}

function SubscribedOrderFlowStats({
  captureMode,
  fallbackCandle,
  metric,
  orderFlowByTime,
  store,
}: {
  captureMode: boolean;
  fallbackCandle: Candle | null;
  metric: OrderFlowStatsMetric;
  orderFlowByTime: ReadonlyMap<number, OrderFlowBarAggregate>;
  store: ChartCandleSnapshotStore;
}) {
  const candle = useHeaderCandle(store, fallbackCandle, captureMode);
  const bar = candle ? orderFlowByTime.get(candle.time) ?? null : null;
  return bar ? <OrderFlowStatsTable bar={bar} metric={metric} /> : null;
}

function OhlcvStrip({
  candle,
  chartSettings,
  pricePrecision,
  showChange,
  showOhlc,
  showVolume,
  tone,
}: {
  candle: Candle | null;
  chartSettings: ChartVisualSettings;
  pricePrecision: number;
  showChange: boolean;
  showOhlc: boolean;
  showVolume: boolean;
  tone: string;
}) {
  const change =
    candle == null || candle.open === 0
      ? null
      : ((candle.close - candle.open) / candle.open) * 100;
  const hasVolume = hasRenderableVolume(candle);

  return (
    <div aria-label="Data Window" className="chart-ohlcv-row" data-ui-panel="data-window" role="region">
      <span className="chart-ohlcv-time">
        {candle ? formatChartDateTime(candle.timestamp, chartSettings) : "No candle"}
      </span>
      {showOhlc && (
        <>
          <OhlcvValue
            label="O"
            tone={tone}
            value={formatPrice(candle?.open, { precision: pricePrecision })}
          />
          <OhlcvValue
            label="H"
            tone={tone}
            value={formatPrice(candle?.high, { precision: pricePrecision })}
          />
          <OhlcvValue
            label="L"
            tone={tone}
            value={formatPrice(candle?.low, { precision: pricePrecision })}
          />
          <OhlcvValue
            label="C"
            tone={tone}
            value={formatPrice(candle?.close, { precision: pricePrecision })}
          />
        </>
      )}
      {showVolume && hasVolume && candle != null && (
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

function hasRenderableVolume(candle: Pick<Candle, "volume"> | null | undefined) {
  return candle != null && Number.isFinite(candle.volume) && candle.volume > 0;
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

function PositionLineOverlay({
  currency,
  onCloseFraction,
  onToggleOpen,
  open,
  position,
  x,
  y,
}: {
  currency: string;
  onCloseFraction: (fraction: number) => void;
  onToggleOpen: () => void;
  open: boolean;
  position: Position;
  x: number;
  y: number;
}) {
  const pnlTone = position.unrealized_pnl >= 0 ? "text-emerald-200" : "text-rose-200";

  return (
    <div
      className={`chart-position-overlay ${open ? "chart-position-overlay-open" : ""}`}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      style={{ left: x, top: y }}
    >
      <button
        className="chart-position-chip"
        onClick={onToggleOpen}
        title="Position quick actions"
        type="button"
      >
        <span className="chart-position-side">{position.side}</span>
        <strong className={pnlTone}>{formatMoney(position.unrealized_pnl, currency)}</strong>
      </button>
      {open && (
        <div className="chart-position-actions">
          <button onClick={() => onCloseFraction(0.25)} type="button">
            <ArrowDownToLine size={14} />
            25%
          </button>
          <button onClick={() => onCloseFraction(0.5)} type="button">
            <ArrowDownToLine size={14} />
            50%
          </button>
          <button onClick={() => onCloseFraction(1)} type="button">
            <ArrowUpToLine size={14} />
            Close
          </button>
        </div>
      )}
    </div>
  );
}

function OrderLineModificationDialog({
  currency,
  draft,
  onCancel,
  onConfirm,
}: {
  currency: string;
  draft: OrderLineModificationDraft;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const pnl = draft.stats?.pnl ?? null;
  const pnlTone =
    pnl == null || pnl === 0 ? "text-slate-100" : pnl > 0 ? "text-emerald-300" : "text-rose-300";

  return (
    <div
      className="chart-order-confirm-backdrop"
      onClick={onCancel}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="chart-order-confirm-card" onClick={(event) => event.stopPropagation()}>
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200/70">
            Confirm modification
          </div>
          <div className="mt-1 text-base font-semibold text-white">{draft.label}</div>
        </div>
        <div className="chart-order-confirm-grid">
          <span>From</span>
          <strong>{formatPrice(draft.previousPrice)}</strong>
          <span>To</span>
          <strong>{formatPrice(draft.nextPrice)}</strong>
          <span>{draft.stats?.pnlLabel ?? "P&L"}</span>
          <strong className={pnlTone}>{pnl == null ? "-" : formatMoney(pnl, currency)}</strong>
          <span>RR</span>
          <strong>{formatRr(draft.stats?.rr ?? null)}</strong>
        </div>
        <div className="chart-order-confirm-actions">
          <button onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="chart-order-confirm-primary" onClick={onConfirm} type="button">
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function isEditableTarget(target: HTMLElement | null) {
  return Boolean(
    target &&
      (target.isContentEditable ||
        target.matches("input, textarea, select") ||
        target.closest("input, textarea, select, [contenteditable='true']")),
  );
}

function chartAcceptsRadialToolbox(stage: HTMLElement | null) {
  if (!stage || document.visibilityState !== "visible") {
    return false;
  }
  const chartEngaged = stage.matches(":hover") || stage.contains(document.activeElement);
  if (!chartEngaged) {
    return false;
  }
  const paneShell = stage.closest(".chart-pane-shell");
  if (!paneShell) {
    return true;
  }
  if (!paneShell.classList.contains("chart-pane-shell-with-header")) {
    return true;
  }
  return paneShell.classList.contains("chart-pane-shell-active");
}

function radialToolboxAnchor(
  stage: HTMLElement | null,
  pointer: { x: number; y: number } | null,
) {
  const rect = stage?.getBoundingClientRect();
  const pointerInside =
    rect &&
    pointer &&
    pointer.x >= rect.left &&
    pointer.x <= rect.right &&
    pointer.y >= rect.top &&
    pointer.y <= rect.bottom;
  const desiredX = pointerInside && pointer ? pointer.x : rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const desiredY = pointerInside && pointer ? pointer.y : rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
  const horizontalPadding = Math.min(RADIAL_TOOLBOX_EDGE_PADDING, Math.max(16, window.innerWidth / 2 - 12));
  const verticalPadding = Math.min(RADIAL_TOOLBOX_EDGE_PADDING, Math.max(16, window.innerHeight / 2 - 12));
  return {
    x: Math.min(window.innerWidth - horizontalPadding, Math.max(horizontalPadding, desiredX)),
    y: Math.min(window.innerHeight - verticalPadding, Math.max(verticalPadding, desiredY)),
  };
}

function RadialDrawingToolbox({
  anchor,
  favorites,
  highlightedIndex,
  onHighlight,
  onSelect,
}: {
  anchor: { x: number; y: number };
  favorites: FavoriteDrawingTool[];
  highlightedIndex: number | null;
  onHighlight: (index: number) => void;
  onSelect: (tool: FavoriteDrawingTool) => void;
}) {
  if (typeof document === "undefined") {
    return null;
  }
  const highlightedTool = highlightedIndex == null ? null : favorites[highlightedIndex];
  const highlightedDefinition = DRAWING_RAIL_TOOLS.find((item) => item.tool === highlightedTool);

  return <PointOverlaySurface label="Circular drawing toolbox" role="toolbar" className="chart-radial-toolbox" x={anchor.x} y={anchor.y}>
      <div aria-hidden="true" className="chart-radial-toolbox-ring" />
      {favorites.map((tool, index) => {
        const definition = DRAWING_RAIL_TOOLS.find((item) => item.tool === tool);
        if (!definition) {
          return null;
        }
        const Icon = definition.icon;
        const angle = -Math.PI / 2 + (Math.PI * 2 * index) / favorites.length;
        return (
          <button
            aria-label={`${index + 1}. ${definition.label}`}
            className={`chart-radial-toolbox-button ${highlightedIndex === index ? "chart-radial-toolbox-button-active" : ""}`}
            key={tool}
            onClick={() => onSelect(tool)}
            onPointerEnter={() => onHighlight(index)}
            style={{
              left: RADIAL_TOOLBOX_RADIUS + Math.cos(angle) * RADIAL_TOOLBOX_RADIUS,
              top: RADIAL_TOOLBOX_RADIUS + Math.sin(angle) * RADIAL_TOOLBOX_RADIUS,
            }}
            title={`${index + 1}. ${definition.label}`}
            type="button"
          >
            <Icon size={18} />
            <span>{index + 1}</span>
          </button>
        );
      })}
      <div aria-live="polite" className="chart-radial-toolbox-center">
        <strong>{highlightedDefinition?.label ?? "Quick wheel"}</strong>
        <span>{highlightedDefinition ? "Release to select" : "Move or use 1–8"}</span>
      </div>
      <span className="sr-only">
        Use arrow keys and Enter, number keys 1 through 8, or move to a tool and release Alt or Option.
      </span>
    </PointOverlaySurface>;
}

function DrawingRail({
  activeTool,
  canUndoDrawingChange,
  clearableDrawingsCount,
  drawingsCount,
  magnetMode,
  onClearDrawings,
  onMagnetModeChange,
  onToolChange,
  onUndoDrawingChange,
  undoShortcutLabel,
}: {
  activeTool: DrawingTool;
  canUndoDrawingChange: boolean;
  clearableDrawingsCount: number;
  drawingsCount: number;
  magnetMode: MagnetMode;
  onClearDrawings: () => void;
  onMagnetModeChange: (mode: MagnetMode) => void;
  onToolChange: (tool: DrawingTool) => void;
  onUndoDrawingChange: () => void;
  undoShortcutLabel: string;
}) {
  const nextMagnetMode: MagnetMode =
    magnetMode === "off" ? "weak" : magnetMode === "weak" ? "strong" : "off";
  const magnetLabel =
    magnetMode === "off"
      ? "Magnet off. Click for weak magnet"
      : magnetMode === "weak"
        ? "Weak magnet. Click for strong magnet"
        : "Strong magnet. Click to turn magnet off";

  return (
    <aside className="drawing-rail">
      {DRAWING_RAIL_TOOLS.slice(0, 2).map((item) => {
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
        className={`drawing-rail-button magnet-rail-button ${magnetMode !== "off" ? "drawing-rail-button-active" : ""}`}
        onClick={() => onMagnetModeChange(nextMagnetMode)}
        title={magnetLabel}
        type="button"
      >
        <Magnet size={17} />
        {magnetMode !== "off" && (
          <span className="drawing-rail-mode-badge">
            {magnetMode === "weak" ? "W" : "S"}
          </span>
        )}
      </button>
      <div className="my-1 h-px w-8 bg-white/10" />
      {DRAWING_RAIL_TOOLS.slice(2).map((item) => {
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
        disabled={!canUndoDrawingChange}
        onClick={onUndoDrawingChange}
        title={
          canUndoDrawingChange
            ? `Undo last drawing change (${undoShortcutLabel})`
            : `Nothing to undo (${undoShortcutLabel})`
        }
        type="button"
      >
        <Undo2 size={16} />
      </button>
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

function primarySeriesKindForStyle(chartStyle: ChartStyle): PrimarySeriesKind {
  if (chartStyle === "line") return "line";
  if (chartStyle === "area") return "area";
  return "candlestick";
}

function applyCandlestickDataPlan(
  series: ISeriesApi<"Candlestick">,
  plan: SeriesDataUpdatePlan<CandlestickData>,
) {
  if (plan.mode === "setData") {
    series.setData(plan.points);
  } else if (plan.mode === "update") {
    plan.points.forEach((point) => series.update(point));
  }
}

function applyLineDataPlan(
  series: ISeriesApi<"Line">,
  plan: SeriesDataUpdatePlan<LineData>,
) {
  if (plan.mode === "setData") {
    series.setData(plan.points);
  } else if (plan.mode === "update") {
    plan.points.forEach((point) => series.update(point));
  }
}

function applyAreaDataPlan(
  series: ISeriesApi<"Area">,
  plan: SeriesDataUpdatePlan<LineData>,
) {
  if (plan.mode === "setData") {
    series.setData(plan.points);
  } else if (plan.mode === "update") {
    plan.points.forEach((point) => series.update(point));
  }
}

function applyHistogramDataPlan(
  series: ISeriesApi<"Histogram">,
  plan: SeriesDataUpdatePlan<HistogramData>,
) {
  if (plan.mode === "setData") {
    series.setData(plan.points);
  } else if (plan.mode === "update") {
    plan.points.forEach((point) => series.update(point));
  }
}

function removePriceLineSafely(series: PrimaryChartSeries, line: IPriceLine) {
  try {
    series.removePriceLine(line);
  } catch {
    // Price lines can already be detached during series or chart teardown.
  }
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
      color: settings.bodyVisible ? bodyColor : TRANSPARENT_COLOR,
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

function primaryPriceScaleIdForPlacement(
  placement: ChartVisualSettings["scalePlacement"],
) {
  return placement === "left" ? "left" : "right";
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
  return formatChartDateTime(date, settings);
}

function formatChartTickMark(
  time: Time,
  tickMarkType: TickMarkType,
  settings: ChartVisualSettings,
) {
  const date = timeToDate(time);
  return date
    ? formatChartAxisTick(date, chartTickGranularity(tickMarkType), settings)
    : null;
}

function chartTickGranularity(tickMarkType: TickMarkType): ChartTickGranularity {
  if (tickMarkType === TickMarkType.Year) {
    return "year";
  }
  if (tickMarkType === TickMarkType.Month) {
    return "month";
  }
  if (tickMarkType === TickMarkType.DayOfMonth) {
    return "day";
  }
  return tickMarkType === TickMarkType.TimeWithSeconds
    ? "time-with-seconds"
    : "time";
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

function previousDayClose(bars: Candle[], template: ChartSessionTemplate) {
  const latest = bars.at(-1);
  if (!latest) {
    return null;
  }
  const latestDay = sessionTradingDayKey(latest.time, template);
  if (!latestDay) {
    return null;
  }
  for (let index = bars.length - 2; index >= 0; index -= 1) {
    if (sessionTradingDayKey(bars[index].time, template) !== latestDay) {
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

const SESSION_SHADE_STYLES: Record<
  Exclude<ChartSessionPhase, "regular">,
  { fill: string; text: string }
> = {
  closed: { fill: "rgba(71, 85, 105, 0.16)", text: "#CBD5E1" },
  postmarket: { fill: "rgba(168, 85, 247, 0.09)", text: "#D8B4FE" },
  premarket: { fill: "rgba(14, 165, 233, 0.09)", text: "#7DD3FC" },
};

function buildFootprintElements({
  alignment,
  askColor,
  bars,
  bidColor,
  chart,
  displayMode,
  frame,
  imbalanceRatio,
  neutralColor,
  series,
  showAverageTradeSize,
  showImbalances,
  showUnfinishedAuctions,
  stackedImbalanceCount,
}: {
  alignment: ChartVisualSettings["footprintAlignment"];
  askColor: string;
  bars: OrderFlowBarAggregate[];
  bidColor: string;
  chart: IChartApi | null;
  displayMode: OrderFlowDisplayMode;
  frame: HTMLDivElement | null;
  imbalanceRatio: number;
  neutralColor: string;
  series: PrimaryChartSeries | null;
  showAverageTradeSize: boolean;
  showImbalances: boolean;
  showUnfinishedAuctions: boolean;
  stackedImbalanceCount: number;
}) {
  if (!chart || !frame || !series || bars.length === 0) {
    return { detailVisible: false, elements: [] };
  }
  const plotWidth = chartPlotWidth(chart, frame);
  const plotHeight = chartPlotHeight(chart, frame);
  const coordinates = bars.map((bar) =>
    chart.timeScale().timeToCoordinate(bar.time as UTCTimestamp),
  );
  const spacings = coordinates.flatMap((coordinate, index) => {
    const next = coordinates[index + 1];
    return coordinate != null && next != null ? [Math.abs(next - coordinate)] : [];
  });
  const typicalSpacing =
    spacings.length > 0
      ? [...spacings].sort((left, right) => left - right)[
          Math.floor(spacings.length / 2)
        ]
      : 80;
  const detailVisible = typicalSpacing >= 48;
  const maxTotal = Math.max(
    1,
    ...bars.flatMap((bar) => bar.levels.map((level) => level.totalVolume)),
  );
  const maxDelta = Math.max(
    1,
    ...bars.flatMap((bar) => bar.levels.map((level) => Math.abs(level.delta))),
  );
  const maxBarMetric = Math.max(
    1,
    ...bars.map((bar) =>
      displayMode === "volume-profile" ? bar.totalVolume : Math.abs(bar.delta),
    ),
  );
  const elements: ReactNode[] = [];

  bars.forEach((bar, barIndex) => {
    const centerX = coordinates[barIndex];
    if (centerX == null || centerX < -120 || centerX > plotWidth + 120) {
      return;
    }
    const barWidth = Math.min(120, Math.max(10, typicalSpacing * 0.86));
    if (!detailVisible) {
      const top = series.priceToCoordinate(Math.max(...bar.levels.map((level) => level.price)));
      const bottom = series.priceToCoordinate(Math.min(...bar.levels.map((level) => level.price)));
      if (top == null || bottom == null) {
        return;
      }
      const y = clamp((top + bottom) / 2, 3, Math.max(3, plotHeight - 3));
      const metric =
        displayMode === "volume-profile" ? bar.totalVolume : Math.abs(bar.delta);
      const width = Math.max(2, barWidth * (metric / maxBarMetric));
      const x = alignedProfileX(centerX, barWidth, width, alignment);
      const color =
        displayMode === "volume-profile"
          ? neutralColor
          : bar.delta >= 0
            ? askColor
            : bidColor;
      elements.push(
        <rect
          fill={colorWithOpacity(color, 0.7)}
          height={4}
          key={`footprint-summary-${bar.time}`}
          rx={2}
          width={width}
          x={x}
          y={y - 2}
        />,
      );
      return;
    }

    const analysis = analyzeOrderFlowBar(
      bar,
      imbalanceRatio,
      stackedImbalanceCount,
    );
    const buyPrices = new Set(analysis.buyPrices);
    const sellPrices = new Set(analysis.sellPrices);
    const stackedBuyPrices = new Set(analysis.stackedBuyPrices);
    const stackedSellPrices = new Set(analysis.stackedSellPrices);

    bar.levels.forEach((level) => {
      const y = series.priceToCoordinate(level.price);
      if (y == null || y < -30 || y > plotHeight + 30) {
        return;
      }
      const adjacentY = series.priceToCoordinate(level.price + bar.tickSize);
      const rowHeight = Math.min(
        24,
        Math.max(8, adjacentY == null ? 12 : Math.abs(adjacentY - y)),
      );
      const top = y - rowHeight / 2;
      const key = `${bar.time}-${level.price}`;

      if (displayMode === "bid-ask") {
        const halfWidth = barWidth / 2;
        elements.push(
          <g key={`cell-${key}`}>
            <rect
              fill={colorWithOpacity(
                bidColor,
                0.12 + 0.58 * (level.bidVolume / maxTotal),
              )}
              height={rowHeight - 1}
              width={halfWidth - 0.5}
              x={centerX - halfWidth}
              y={top}
            />
            <rect
              fill={colorWithOpacity(
                askColor,
                0.12 + 0.58 * (level.askVolume / maxTotal),
              )}
              height={rowHeight - 1}
              width={halfWidth - 0.5}
              x={centerX + 0.5}
              y={top}
            />
            {level.unknownVolume > 0 ? (
              <rect
                fill={colorWithOpacity(neutralColor, 0.75)}
                height={2}
                width={Math.max(2, barWidth * (level.unknownVolume / maxTotal))}
                x={centerX - barWidth / 2}
                y={top + rowHeight - 3}
              />
            ) : null}
            {barWidth >= 72 && rowHeight >= 10 ? (
              <text
                fill="#F8FAFC"
                fontSize={Math.min(10, rowHeight - 2)}
                textAnchor="middle"
                x={centerX}
                y={top + rowHeight - 2.5}
              >
                {`${formatOrderFlowMetric(level.bidVolume)} × ${formatOrderFlowMetric(level.askVolume)}`}
              </text>
            ) : null}
          </g>,
        );
      } else {
        const maximum = displayMode === "volume-profile" ? maxTotal : maxDelta;
        const magnitude =
          displayMode === "volume-profile"
            ? level.totalVolume
            : Math.abs(level.delta);
        const width = Math.max(1, barWidth * (magnitude / maximum));
        const x = alignedProfileX(centerX, barWidth, width, alignment);
        const color =
          displayMode === "volume-profile"
            ? neutralColor
            : level.delta >= 0
              ? askColor
              : bidColor;
        elements.push(
          <rect
            fill={colorWithOpacity(color, displayMode === "absolute-delta" ? 0.72 : 0.56)}
            height={rowHeight - 1}
            key={`profile-${key}`}
            width={width}
            x={x}
            y={top}
          />,
        );
      }

      if (showAverageTradeSize && barWidth >= 84 && rowHeight >= 18) {
        elements.push(
          <text
            fill={colorWithOpacity(neutralColor, 0.95)}
            fontSize={8}
            key={`average-${key}`}
            textAnchor="middle"
            x={centerX}
            y={top + 8}
          >
            {`AVG ${formatOrderFlowMetric(level.averageTradeSize)}`}
          </text>,
        );
      }

      if (showImbalances && (buyPrices.has(level.price) || sellPrices.has(level.price))) {
        const stacked =
          stackedBuyPrices.has(level.price) || stackedSellPrices.has(level.price);
        const color = buyPrices.has(level.price) ? askColor : bidColor;
        elements.push(
          <rect
            fill="none"
            height={Math.max(1, rowHeight - 1)}
            key={`imbalance-${key}`}
            stroke={color}
            strokeWidth={stacked ? 2.5 : 1}
            width={barWidth}
            x={centerX - barWidth / 2}
            y={top}
          />,
        );
      }
    });

    if (showUnfinishedAuctions) {
      const highY = series.priceToCoordinate(bar.levels.at(-1)?.price ?? 0);
      const lowY = series.priceToCoordinate(bar.levels[0]?.price ?? 0);
      if (analysis.unfinishedHigh && highY != null) {
        elements.push(
          <circle
            cx={centerX}
            cy={highY}
            fill={chartSettingsColor(neutralColor)}
            key={`unfinished-high-${bar.time}`}
            r={3}
            stroke="#0F172A"
          />,
        );
      }
      if (analysis.unfinishedLow && lowY != null) {
        elements.push(
          <circle
            cx={centerX}
            cy={lowY}
            fill={chartSettingsColor(neutralColor)}
            key={`unfinished-low-${bar.time}`}
            r={3}
            stroke="#0F172A"
          />,
        );
      }
    }
  });

  return { detailVisible, elements };
}

function buildMarketProfileElements({
  askColor,
  bidColor,
  chart,
  frame,
  profile,
  series,
  showPointOfControl,
  showValueArea,
}: {
  askColor: string;
  bidColor: string;
  chart: IChartApi | null;
  frame: HTMLDivElement | null;
  profile: MarketProfile;
  series: PrimaryChartSeries | null;
  showPointOfControl: boolean;
  showValueArea: boolean;
}) {
  if (!chart || !frame || !series || profile.rows.length === 0) {
    return [];
  }
  const plotWidth = chartPlotWidth(chart, frame);
  const plotHeight = chartPlotHeight(chart, frame);
  const profileWidth = Math.min(340, Math.max(110, plotWidth * 0.42));
  const right = Math.max(0, plotWidth - 6);
  const left = Math.max(0, right - profileWidth);
  const maxCount = Math.max(1, ...profile.rows.map((row) => row.tpoCount));
  const elements: ReactNode[] = [];

  profile.rows.forEach((row, index) => {
    const y = series.priceToCoordinate(row.price);
    if (y == null || y < -24 || y > plotHeight + 24) {
      return;
    }
    const adjacentPrice = profile.rows[index + 1]?.price ?? profile.rows[index - 1]?.price;
    const adjacentY = adjacentPrice == null ? null : series.priceToCoordinate(adjacentPrice);
    const rowHeight = Math.min(
      22,
      Math.max(6, adjacentY == null ? 12 : Math.abs(adjacentY - y)),
    );
    const top = y - rowHeight / 2;
    if (showValueArea && row.inValueArea) {
      elements.push(
        <rect
          fill={colorWithOpacity(askColor, 0.08)}
          height={rowHeight - 0.5}
          key={`tpo-value-area-${row.price}`}
          width={profileWidth}
          x={left}
          y={top}
        />,
      );
    }
    if (rowHeight >= 9 && profileWidth >= 150) {
      const maximumCharacters = Math.max(1, Math.floor((profileWidth - 12) / 7));
      const letters = row.letters.slice(-maximumCharacters);
      elements.push(
        <text
          fill={row.delta >= 0 ? askColor : bidColor}
          fontFamily="JetBrains Mono, ui-monospace, monospace"
          fontSize={Math.min(10, rowHeight - 1)}
          key={`tpo-letters-${row.price}`}
          textAnchor="end"
          x={right - 4}
          y={top + rowHeight - 2}
        >
          {letters}
        </text>,
      );
    } else {
      const width = profileWidth * (row.tpoCount / maxCount);
      elements.push(
        <rect
          fill={colorWithOpacity(row.delta >= 0 ? askColor : bidColor, 0.52)}
          height={Math.max(2, rowHeight - 1)}
          key={`tpo-profile-${row.price}`}
          width={width}
          x={right - width}
          y={top}
        />,
      );
    }
    if (showPointOfControl && row.isPointOfControl) {
      elements.push(
        <line
          key={`tpo-poc-${row.price}`}
          stroke="#F59E0B"
          strokeDasharray="4 3"
          strokeWidth={1.5}
          x1={left}
          x2={right}
          y1={y}
          y2={y}
        />,
      );
    }
  });

  return elements;
}

function OrderFlowStatsTable({
  bar,
  metric,
}: {
  bar: OrderFlowBarAggregate;
  metric: OrderFlowStatsMetric;
}) {
  const rows: Array<{ id: OrderFlowStatsMetric | "bid" | "ask" | "unknown"; label: string; value: number }> = [
    { id: "bid", label: "Bid", value: bar.bidVolume },
    { id: "ask", label: "Ask", value: bar.askVolume },
    { id: "volume", label: "Volume", value: bar.totalVolume },
    { id: "delta", label: "Delta", value: bar.delta },
    { id: "trades", label: "Trades", value: bar.tradeCount },
    { id: "average-size", label: "Average", value: bar.averageTradeSize },
    ...(bar.unknownVolume > 0
      ? [{ id: "unknown" as const, label: "Unknown", value: bar.unknownVolume }]
      : []),
  ];
  return (
    <div
      aria-label="Order-flow statistics for selected bar"
      className="pointer-events-none absolute right-2 top-2 z-[3] min-w-36 rounded-md border border-white/10 bg-slate-950/90 p-2 text-xs text-slate-300 shadow-lg"
      role="table"
    >
      <div className="mb-1 font-semibold text-white" role="row">
        Order flow
      </div>
      {rows.map((row) => (
        <div
          className={`flex items-center justify-between gap-4 py-0.5 ${row.id === metric ? "font-semibold text-cyan-100" : ""}`}
          key={row.id}
          role="row"
        >
          <span role="rowheader">{row.label}</span>
          <span className="tabular-nums" role="cell">
            {formatOrderFlowMetric(row.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function alignedProfileX(
  center: number,
  availableWidth: number,
  width: number,
  alignment: ChartVisualSettings["footprintAlignment"],
) {
  if (alignment === "left") {
    return center - availableWidth / 2;
  }
  if (alignment === "right") {
    return center + availableWidth / 2 - width;
  }
  return center - width / 2;
}

function chartSettingsColor(value: string) {
  return value || "#94A3B8";
}

function buildSessionShadeElements({
  bars,
  chart,
  closedVisible,
  frame,
  postMarketVisible,
  preMarketVisible,
  template,
}: {
  bars: Candle[];
  chart: IChartApi | null;
  closedVisible: boolean;
  frame: HTMLDivElement | null;
  postMarketVisible: boolean;
  preMarketVisible: boolean;
  template: ChartSessionTemplate;
}) {
  if (!frame || !chart || bars.length === 0) {
    return [];
  }
  const plotWidth = chartPlotWidth(chart, frame);
  const plotHeight = chartPlotHeight(chart, frame);
  if (plotWidth <= 0 || plotHeight <= 0) {
    return [];
  }
  const coordinates = bars.map((bar) =>
    chart.timeScale().timeToCoordinate(bar.time as UTCTimestamp),
  );
  const phases = bars.map((bar) => sessionPhaseAt(bar.time, template));
  const elements = [];

  for (let startIndex = 0; startIndex < bars.length; ) {
    const phase = phases[startIndex];
    let endIndex = startIndex;
    while (endIndex + 1 < bars.length && phases[endIndex + 1] === phase) {
      endIndex += 1;
    }
    const visible =
      (phase === "premarket" && preMarketVisible) ||
      (phase === "postmarket" && postMarketVisible) ||
      (phase === "closed" && closedVisible);
    if (phase !== "regular" && visible) {
      const startCoordinate = sessionBarEdge(coordinates, startIndex, "start");
      const endCoordinate = sessionBarEdge(coordinates, endIndex, "end");
      if (startCoordinate != null && endCoordinate != null) {
        const left = Math.max(0, Math.min(plotWidth, startCoordinate));
        const right = Math.max(0, Math.min(plotWidth, endCoordinate));
        const width = right - left;
        if (width > 0) {
          const style = SESSION_SHADE_STYLES[phase];
          const label = chartSessionPhaseLabel(phase);
          elements.push(
            <g key={`${phase}-${bars[startIndex].time}`}>
              <rect fill={style.fill} height={plotHeight} width={width} x={left} y={0} />
              {width >= 58 && plotHeight >= 28 ? (
                <text
                  fill={style.text}
                  fontSize={10}
                  fontWeight={700}
                  letterSpacing="0.08em"
                  x={left + 6}
                  y={16}
                >
                  {label.toUpperCase()}
                </text>
              ) : null}
            </g>,
          );
        }
      }
    }
    startIndex = endIndex + 1;
  }

  return elements;
}

function sessionBarEdge(
  coordinates: Array<number | null>,
  index: number,
  edge: "end" | "start",
) {
  const coordinate = coordinates[index];
  if (coordinate == null) {
    return null;
  }
  const neighbor =
    edge === "start"
      ? coordinates[index - 1] ?? coordinates[index + 1]
      : coordinates[index + 1] ?? coordinates[index - 1];
  const spacing = neighbor == null ? 6 : Math.abs(coordinate - neighbor);
  const halfSpacing = Math.min(40, Math.max(2, spacing / 2));
  return coordinate + (edge === "start" ? -halfSpacing : halfSpacing);
}

function buildSessionBreakElements(
  bars: Candle[],
  frame: HTMLDivElement | null,
  chart: IChartApi | null,
  color: string,
  lineStyle: DrawingLineStyle,
  lineWidth: number,
  template: ChartSessionTemplate,
) {
  if (!frame || !chart || bars.length < 2) {
    return null;
  }
  const height = chartPlotHeight(chart, frame);
  return bars.flatMap((bar, index) => {
    if (
      index === 0 ||
      sessionTradingDayKey(bar.time, template) ===
        sessionTradingDayKey(bars[index - 1].time, template)
    ) {
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
        strokeDasharray={lineStyleDasharray(lineStyle)}
        strokeLinecap={lineStyle === "dotted" ? "round" : "butt"}
        strokeWidth={lineWidth}
        x1={x}
        x2={x}
        y1={0}
        y2={height}
      />
    );
  });
}

function sourceIndicatorIdForSeries(
  hoveredSeries: unknown,
  definitions: IndicatorDefinition[],
  seriesById: Record<string, ISeriesApi<"Line">>,
) {
  if (!hoveredSeries) {
    return null;
  }
  const definitionId = Object.entries(seriesById).find(
    ([, series]) => series === hoveredSeries,
  )?.[0];
  if (!definitionId) {
    return null;
  }
  return definitions.find((definition) => definition.id === definitionId)?.sourceId ?? null;
}

function findNearestOverlayIndicator({
  chart,
  definitions,
  frame,
  point,
  seriesById,
}: {
  chart: IChartApi | null;
  definitions: IndicatorDefinition[];
  frame: HTMLDivElement | null;
  point: { x: number; y: number };
  seriesById: Record<string, ISeriesApi<"Line">>;
}) {
  if (!chart || !frame || definitions.length === 0) {
    return null;
  }

  const plotWidth = chartPlotWidth(chart, frame);
  const plotHeight = chartPlotHeight(chart, frame);
  const visibleRange = chartVisibleLogicalRange(chart, plotWidth);
  if (point.x < 0 || point.y < 0 || point.x > plotWidth || point.y > plotHeight) {
    return null;
  }

  let nearest: { distance: number; indicatorId: string; point: { x: number; y: number } } | null =
    null;

  for (const definition of definitions) {
    const series = seriesById[definition.id];
    if (!series || definition.data.length === 0) {
      continue;
    }
    const threshold = Math.max(14, (definition.lineWidth ?? 2) + 10);
    let previous: { x: number; y: number } | null = null;

    for (const dataPoint of definition.data) {
      const value = Number(dataPoint.value);
      if (!Number.isFinite(value)) {
        previous = null;
        continue;
      }
      const x = chart.timeScale().timeToCoordinate(dataPoint.time);
      const y = series.priceToCoordinate(value);
      if (x == null || y == null) {
        previous = null;
        continue;
      }
      const current = { x, y };
      if (x >= -24 && x <= plotWidth + 24 && y >= -24 && y <= plotHeight + 24) {
        const distanceToPoint = Math.hypot(point.x - x, point.y - y);
        const distanceToSegment = previous
          ? pointSegmentDistance(point, previous, current)
          : distanceToPoint;
        const distance = Math.min(distanceToPoint, distanceToSegment);
        if (distance <= threshold && (!nearest || distance < nearest.distance)) {
          nearest = {
            distance,
            indicatorId: definition.sourceId,
            point: current,
          };
        }
      }
      previous = current;
    }
  }

  return nearest;
}

function findNearestFvgZone({
  chart,
  definitions,
  frame,
  point,
  series,
}: {
  chart: IChartApi | null;
  definitions: FvgZoneDefinition[];
  frame: HTMLDivElement | null;
  point: { x: number; y: number };
  series: PrimaryChartSeries | null;
}) {
  if (!chart || !frame || !series || definitions.length === 0) {
    return null;
  }

  const plotWidth = chartPlotWidth(chart, frame);
  const plotHeight = chartPlotHeight(chart, frame);
  const visibleRange = chart.timeScale().getVisibleLogicalRange();
  if (point.x < 0 || point.y < 0 || point.x > plotWidth || point.y > plotHeight) {
    return null;
  }

  let nearest: { distance: number; indicatorId: string; point: { x: number; y: number } } | null =
    null;
  for (const definition of definitions) {
    const visibleSpan = fvgZoneVisibleSpan(definition, visibleRange);
    if (!visibleSpan) {
      continue;
    }
    const startTop = pixelFromPoint(
      { logical: visibleSpan.startLogical, price: definition.high, time: 0 },
      chart,
      series,
    );
    const endBottom = pixelFromPoint(
      { logical: visibleSpan.endLogical, price: definition.low, time: 0 },
      chart,
      series,
    );
    if (!startTop || !endBottom) {
      continue;
    }
    const box = normalizePixelBox(startTop, endBottom);
    const expanded = expandBox(box, 8);
    if (!pointInsideBox(point, expanded)) {
      continue;
    }
    const dx =
      point.x < box.left ? box.left - point.x : point.x > box.right ? point.x - box.right : 0;
    const dy =
      point.y < box.top ? box.top - point.y : point.y > box.bottom ? point.y - box.bottom : 0;
    const distance = Math.hypot(dx, dy);
    if (!nearest || distance < nearest.distance) {
      nearest = {
        distance,
        indicatorId: definition.sourceId,
        point: {
          x: clamp(box.left + 12, 0, plotWidth),
          y: clamp(box.top + 12, 0, plotHeight),
        },
      };
    }
  }

  return nearest;
}

function pointSegmentDistance(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function indicatorDasharray(style: IndicatorDefinition["lineStyle"]) {
  if (style === 1) {
    return "2 4";
  }
  if (style === 2) {
    return "6 5";
  }
  return undefined;
}

function RsiPanel({
  color,
  data,
  label,
  lineStyle,
  lineWidth,
  onOpenSettings,
  selected,
}: {
  color: string;
  data: LineData[];
  label: string;
  lineStyle: DrawingLineStyle;
  lineWidth: number;
  onOpenSettings: (event: MouseEvent<HTMLElement>) => void;
  selected: boolean;
}) {
  const visible = data.slice(-160);
  const path = toRsiPath(visible, 960, 96);
  const latest = latestIndicatorValue(data);

  return (
    <div className="border-t border-white/10 bg-ink-950 px-4 py-3">
      <div className="mb-2 flex items-center justify-between text-xs">
        <button
          className={`indicator-pane-title ${selected ? "indicator-pane-title-active" : ""}`}
          onClick={onOpenSettings}
          type="button"
        >
          {label}
        </button>
        <span style={{ color }}>{latest == null ? "—" : latest.toFixed(1)}</span>
      </div>
      <div
        className={`indicator-pane-plot h-24 ${selected ? "indicator-pane-plot-active" : ""}`}
        onClick={onOpenSettings}
      >
        {visible.length > 1 ? (
          <svg className="h-full w-full" preserveAspectRatio="none" viewBox="0 0 960 96">
            <path d="M 0 28.8 L 960 28.8" stroke="rgba(34, 197, 94, 0.26)" strokeWidth="1" />
            <path d="M 0 67.2 L 960 67.2" stroke="rgba(251, 113, 133, 0.26)" strokeWidth="1" />
            <path
              d={path}
              fill="none"
              stroke={color}
              strokeDasharray={lineStyleDasharray(lineStyle)}
              strokeLinecap={lineStyle === "dotted" ? "round" : "butt"}
              strokeWidth={lineWidth}
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

function MacdPanel({
  color,
  data,
  histogramColor,
  label,
  lineStyle,
  lineWidth,
  onOpenSettings,
  selected,
  signalColor,
}: {
  color: string;
  data: MacdData;
  histogramColor: string;
  label: string;
  lineStyle: DrawingLineStyle;
  lineWidth: number;
  onOpenSettings: (event: MouseEvent<HTMLElement>) => void;
  selected: boolean;
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
        <button
          className={`indicator-pane-title ${selected ? "indicator-pane-title-active" : ""}`}
          onClick={onOpenSettings}
          type="button"
        >
          {label}
        </button>
        <span className="text-slate-300">
          {latest == null ? "—" : Number(latest).toFixed(5)} / {signalLatest == null ? "—" : Number(signalLatest).toFixed(5)}
        </span>
      </div>
      <div
        className={`indicator-pane-plot h-28 ${selected ? "indicator-pane-plot-active" : ""}`}
        onClick={onOpenSettings}
      >
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
            <path
              d={toOscillatorPath(visibleMacd, 960, 112, maxAbs)}
              fill="none"
              stroke={color}
              strokeDasharray={lineStyleDasharray(lineStyle)}
              strokeLinecap={lineStyle === "dotted" ? "round" : "butt"}
              strokeWidth={lineWidth}
            />
            <path
              d={toOscillatorPath(visibleSignal, 960, 112, maxAbs)}
              fill="none"
              stroke={signalColor}
              strokeDasharray={lineStyleDasharray(lineStyle)}
              strokeLinecap={lineStyle === "dotted" ? "round" : "butt"}
              strokeWidth={Math.max(1, lineWidth - 0.25)}
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

function StudyLinePanel({
  color,
  data,
  emptyMessage = "Waiting for enough candles",
  label,
  lineStyle,
  lineWidth,
  onOpenSettings,
  selected,
  valueDigits = 2,
  zeroLine = false,
}: {
  color: string;
  data: LineData[];
  emptyMessage?: string;
  label: string;
  lineStyle: DrawingLineStyle;
  lineWidth: number;
  onOpenSettings: (event: MouseEvent<HTMLElement>) => void;
  selected: boolean;
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
        <button
          className={`indicator-pane-title ${selected ? "indicator-pane-title-active" : ""}`}
          onClick={onOpenSettings}
          type="button"
        >
          {label}
        </button>
        <span className="text-slate-300">
          {latest == null ? "—" : latest.toFixed(valueDigits)}
        </span>
      </div>
      <div
        className={`indicator-pane-plot h-24 ${selected ? "indicator-pane-plot-active" : ""}`}
        onClick={onOpenSettings}
      >
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
              strokeDasharray={lineStyleDasharray(lineStyle)}
              strokeLinecap={lineStyle === "dotted" ? "round" : "butt"}
              strokeWidth={lineWidth}
            />
          </svg>
        ) : (
          <div className="grid h-full place-items-center px-4 text-center text-xs leading-5 text-slate-500">
            {emptyMessage}
          </div>
        )}
      </div>
    </div>
  );
}

function NativePineStudyPanel({ label, plots, priceChart, onOpenSettings, selected }: {
  label: string; plots: PineChartPlot[]; priceChart: IChartApi | null;
  onOpenSettings: (event: MouseEvent<HTMLElement>) => void; selected: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const tableOnly = plots.every(plot => plot.kind === "table");
  useLayoutEffect(() => {
    if (!container.current) return;
    const chart = createChart(container.current, {
      autoSize: false, width: Math.max(1, container.current.clientWidth), height: Math.max(1, container.current.clientHeight),
      layout: { background: { type: ColorType.Solid, color: "#060a0f" }, textColor: "#94a3b8", fontFamily: "Instrument Sans Variable" },
      grid: { vertLines: { visible: false }, horzLines: { color: "rgba(148,163,184,0.12)" } },
      timeScale: { visible: false, lockVisibleTimeRangeOnResize: true }, rightPriceScale: { borderVisible: false },
      handleScroll: false, handleScale: false,
    });
    const installed = installPineChartPlots(chart, plots);
    const stopObservingSize = observeSharedChartSize(container.current, ({ width, height }) => chart.resize(width, height));
    const syncRange = () => {
      if (tableOnly) return;
      const range = priceChart?.timeScale().getVisibleRange();
      if (range) chart.timeScale().setVisibleRange(range);
      else chart.timeScale().fitContent();
    };
    syncRange();
    priceChart?.timeScale().subscribeVisibleTimeRangeChange(syncRange);
    return () => {
      priceChart?.timeScale().unsubscribeVisibleTimeRangeChange(syncRange);
      stopObservingSize();
      installed.dispose();
      chart.remove();
    };
  }, [plots, priceChart, tableOnly]);
  return <section className="border-t border-white/10 bg-ink-950 px-4 py-3" aria-label={`${label} native Pine pane`}>
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
      <button className={`indicator-pane-title ${selected ? "indicator-pane-title-active" : ""}`} onClick={onOpenSettings} type="button">{label}</button>
      {plots.length <= 8 ? <span className="text-slate-400">Native Pine · {plots.map((plot) => plot.name).join(" · ")}</span> : <details className="min-w-0 max-w-full text-slate-400">
        <summary className="min-h-6 cursor-pointer rounded px-1.5 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 max-md:min-h-11">Native Pine · {plots.length} outputs</summary>
        <p className="max-h-24 overflow-y-auto py-2 leading-5">{plots.map((plot) => plot.name).join(" · ")}</p>
      </details>}
    </div>
    <div ref={container} className={`${tableOnly ? "h-48" : "h-32"} w-full`} />
    <p className="sr-only">{plots.map((plot) => plot.kind === "table" ? `${plot.name}: ${plot.table?.tables.length ?? 0} current tables` : `${plot.name}: ${latestPineChartPoint(plot)?.value ?? "No numeric value"}`).join(". ")}</p>
  </section>;
}

function useFloatingToolbarPlacement(
  position: { x: number; y: number },
  onPositionChange?: (position: { x: number; y: number }) => void,
) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [fittedPosition, setFittedPosition] = useState(position);
  const placementRef = useRef({ position, onPositionChange });
  placementRef.current = { position, onPositionChange };
  const [availableHeight, setAvailableHeight] = useState<number>();
  const placeToolbarRef = useRef<() => void>();
  // Controls can grow after preparation or validation. Measure the actual menu,
  // and keep every field reachable within the chart instead of using a fixed estimate.
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    const boundary = toolbar?.offsetParent;
    if (!toolbar || !(boundary instanceof HTMLElement)) return;
    const place = () => {
      const rect = boundary.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      let viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const navigation = document.querySelector('nav[aria-label="Primary workspace"]')?.getBoundingClientRect();
      if (navigation && navigation.height > 0) viewportBottom = Math.min(viewportBottom, navigation.top);
      const top = Math.max(12, viewportTop - rect.top + 12);
      const bottom = Math.min(boundary.clientHeight - 12, viewportBottom - rect.top - 12);
      const heightLimit = Math.max(1, bottom - top);
      setAvailableHeight(current => current === heightLimit ? current : heightLimit);
      const { position: current, onPositionChange: publish } = placementRef.current;
      const next = {
        x: clamp(current.x, 12, Math.max(12, boundary.clientWidth - toolbar.offsetWidth - 12)),
        y: clamp(current.y, top, Math.max(top, bottom - Math.min(toolbar.offsetHeight, heightLimit))),
      };
      setFittedPosition(previous => previous.x === next.x && previous.y === next.y ? previous : next);
      if (next.x !== current.x || next.y !== current.y) publish?.(next);
    };
    const observer = new ResizeObserver(place);
    observer.observe(boundary); observer.observe(toolbar);
    placeToolbarRef.current = place;
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    place();
    return () => {
      observer.disconnect(); placeToolbarRef.current = undefined;
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, []);
  useLayoutEffect(() => { placeToolbarRef.current?.(); }, [position.x, position.y]);
  return { toolbarRef, fittedPosition, availableHeight };
}

function FloatingIndicatorToolbar({
  indicator,
  onChange,
  onClose,
  onRemove,
  onPositionChange,
  onToggleVisibility,
  position,
}: {
  indicator: ChartIndicatorInstance;
  onChange: (settings: Partial<IndicatorSettings>) => void;
  onClose: () => void;
  onRemove: () => void;
  onPositionChange: (position: { x: number; y: number }) => void;
  onToggleVisibility: () => void;
  position: { x: number; y: number };
}) {
  const { toolbarRef, fittedPosition, availableHeight } = useFloatingToolbarPlacement(position, onPositionChange);
  const settings = mergeIndicatorSettings(indicator.kind, indicator.settings);
  const lineStyle = defaultIndicatorLineStyle(indicator.kind, settings);
  const lineWidth = defaultIndicatorLineWidth(indicator.kind, settings);
  const isMacd = indicator.kind === "macd";
  const isVwap = indicator.kind === "vwap";
  const isGapStudy = indicator.kind === "fvg" || indicator.kind === "ifvg";
  const nativePine = indicator.kind === "custom" && !!indicator.customScriptSource && isPineScriptSource(indicator.customScriptSource);
  const savedPrepared = nativePine ? sanitizePinePrepared(settings.pineInputPrepared, indicator.customScriptSource!) ?? sanitizePinePrepared(indicator.customPinePrepared, indicator.customScriptSource!) : undefined;
  const pinePrepared = usePineInputMetadata(nativePine ? indicator.customScriptSource : undefined, savedPrepared);
  const effectivePineInputs = usePineInputMigration(savedPrepared, pinePrepared, settings.customInputs, settings.pineInputRecovery, (migration) =>
    onChange({ customInputs: migration.inputs, pineInputPrepared: migration.prepared, pineInputRecovery: migration.recovery }));
  const pineInputs = pinePrepared?.inputDefinitions ?? [];
  const customInputs = indicator.kind === "custom" && indicator.customScriptSource && !nativePine
    ? parseEdgeIndicator(indicator.customScriptSource).program?.inputs ?? []
    : [];
  const hasDeviation =
    indicator.kind === "bb" || indicator.kind === "keltner" || indicator.kind === "supertrend";
  const isVisible = indicator.visible !== false;
  const lineStyles: DrawingLineStyle[] = ["solid", "dashed", "dotted"];

  const stopToolbarEvent = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  const startToolbarDrag = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const startX = position.x;
    const startY = position.y;

    const moveToolbar = (moveEvent: globalThis.MouseEvent) => {
      onPositionChange({
        x: startX + moveEvent.clientX - startClientX,
        y: startY + moveEvent.clientY - startClientY,
      });
    };
    const stopToolbarDrag = () => {
      document.removeEventListener("mousemove", moveToolbar);
      document.removeEventListener("mouseup", stopToolbarDrag);
    };

    document.addEventListener("mousemove", moveToolbar);
    document.addEventListener("mouseup", stopToolbarDrag);
  };

  return (
    <div
      aria-label="Indicator settings"
      className={`chart-object-floating-toolbar indicator-floating-toolbar overflow-y-auto overscroll-contain ${isGapStudy ? "indicator-floating-toolbar-gap" : ""}`}
      ref={toolbarRef}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={stopToolbarEvent}
      role="group"
      style={{ left: fittedPosition.x, top: fittedPosition.y, maxHeight: availableHeight }}
    >
      <div
        className="indicator-floating-title indicator-floating-title-draggable"
        onMouseDown={startToolbarDrag}
        title="Drag indicator controls"
      >
        {nativePine ? <Activity aria-hidden="true" className="shrink-0 text-[var(--text-secondary)]" size={15} /> : <span
          className="h-2.5 w-2.5 rounded-sm"
          style={{ backgroundColor: settings.color }}
        />}
        <span>{indicatorDisplayName({ ...indicator, settings })}</span>
      </div>

      {isGapStudy ? (
        <>
          <div className="indicator-floating-field">
            <span className="indicator-floating-field-label">Bullish</span>
            <ThemedColorPicker
              ariaLabel="Bullish zone color"
              className="chart-object-floating-picker"
              compact
              onChange={(color) => onChange({ color })}
              value={settings.color}
            />
          </div>
          <div className="indicator-floating-field">
            <span className="indicator-floating-field-label">Bearish</span>
            <ThemedColorPicker
              ariaLabel="Bearish zone color"
              className="chart-object-floating-picker"
              compact
              onChange={(secondaryColor) => onChange({ secondaryColor, signalColor: secondaryColor })}
              value={settings.secondaryColor ?? settings.signalColor ?? "#f43f5e"}
            />
          </div>
        </>
      ) : !nativePine ? (
        <ThemedColorPicker
          ariaLabel="Indicator color"
          className="chart-object-floating-picker"
          compact
          onChange={(color) => onChange({ color })}
          value={settings.color}
        />
      ) : null}

      {isMacd ? (
        <div className="indicator-floating-grid">
          <IndicatorNumberInput
            label="Fast"
            onChange={(value) => onChange({ fastPeriod: Math.max(1, Math.round(value)) })}
            value={settings.fastPeriod ?? 12}
          />
          <IndicatorNumberInput
            label="Slow"
            onChange={(value) => onChange({ slowPeriod: Math.max(1, Math.round(value)) })}
            value={settings.slowPeriod ?? 26}
          />
          <IndicatorNumberInput
            label="Sig"
            onChange={(value) => onChange({ signalPeriod: Math.max(1, Math.round(value)) })}
            value={settings.signalPeriod ?? 9}
          />
          <ThemedColorPicker
            ariaLabel="Signal color"
            className="chart-object-floating-picker"
            compact
            onChange={(signalColor) => onChange({ signalColor })}
            value={settings.signalColor ?? "#f59e0b"}
          />
          <ThemedColorPicker
            ariaLabel="Histogram color"
            className="chart-object-floating-picker"
            compact
            onChange={(histogramColor) => onChange({ histogramColor })}
            value={settings.histogramColor ?? "#94a3b8"}
          />
        </div>
      ) : !isGapStudy && !isVwap && indicator.kind !== "custom" ? (
        <IndicatorNumberInput
          label="Period"
          onChange={(value) => onChange({ period: Math.max(1, Math.round(value)) })}
          value={settings.period}
        />
      ) : null}

      {nativePine ? <div className="flex max-w-lg flex-wrap gap-3">
        {pineInputs.map((definition) => <PineInputControl scopeKey={`${indicator.id}:${indicator.customScriptSource}`} key={definition.id} definitions={pineInputs} inputs={effectivePineInputs.inputs} definition={definition} value={effectivePineInputs.inputs[definition.id]} recoveryLabel={effectivePineInputs.recovery[definition.id]} onChange={(value) => onChange({ customInputs: { ...effectivePineInputs.inputs, [definition.id]: value }, pineInputPrepared: pinePrepared, pineInputRecovery: Object.fromEntries(Object.entries(effectivePineInputs.recovery).filter(([id]) => id !== definition.id)) })} />)}
        {!pineInputs.length ? <span className="text-xs text-slate-400">{indicator.customPinePrepared ? "No configurable Pine inputs." : "Prepare and save this Pine script in the editor to configure its inputs."}</span> : null}
      </div> : null}
      {nativePine && indicator.customPinePrepared?.declaration === "strategy" ? <PineStrategySettingsControl scope="chart" value={settings.pineStrategySettings ?? {}} onChange={(pineStrategySettings) => onChange({ pineStrategySettings })} /> : null}
      {indicator.kind === "custom" && customInputs.length > 0 ? (
        <div className="indicator-floating-grid">
          {customInputs.map((input) => {
            const value = settings.customInputs?.[input.name] ?? input.defaultValue;
            if (input.type === "boolean") {
              return (
                <button
                  aria-pressed={Boolean(value)}
                  className={`chart-object-floating-toggle ${Boolean(value) ? "active" : ""}`}
                  key={input.name}
                  onClick={() => onChange({ customInputs: { ...settings.customInputs, [input.name]: !Boolean(value) } })}
                  type="button"
                >
                  {input.name}
                </button>
              );
            }
            if (input.type === "source") {
              return (
                <ThemedSelect
                  ariaLabel={`${input.name} source`}
                  className="h-8 w-28"
                  key={input.name}
                  onChange={(next) => onChange({ customInputs: { ...settings.customInputs, [input.name]: next } })}
                  options={["open", "high", "low", "close", "volume", "hl2", "hlc3", "ohlc4"].map((source) => ({ label: source, value: source }))}
                  value={String(value)}
                />
              );
            }
            return (
              <IndicatorNumberInput
                key={input.name}
                label={input.name}
                min={input.min ?? null}
                max={input.max}
                step="any"
                onChange={(next) => onChange({ customInputs: { ...settings.customInputs, [input.name]: next } })}
                value={Number(value)}
              />
            );
          })}
        </div>
      ) : null}

      {hasDeviation && (
        <IndicatorNumberInput
          label={indicator.kind === "supertrend" ? "Mult" : "Dev"}
          min={0.1}
          onChange={(value) => onChange({ stdDev: Math.max(0.1, Number(value.toFixed(2))) })}
          step={0.1}
          value={settings.stdDev ?? (indicator.kind === "supertrend" ? 3 : 2)}
        />
      )}

      {isGapStudy && (
        <label className="chart-object-floating-width indicator-floating-width-wide" title="Zone opacity">
          <span>Opacity {Math.round((settings.fillOpacity ?? 0.22) * 100)}%</span>
          <input
            max={1}
            min={0.05}
            onChange={(event) => onChange({ fillOpacity: Number(event.target.value) })}
            step={0.01}
            type="range"
            value={settings.fillOpacity ?? 0.22}
          />
        </label>
      )}

      {!isGapStudy && !nativePine && (
        <>
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
            <span>{lineWidth}px</span>
            <input
              max={4}
              min={1}
              onChange={(event) => onChange({ lineWidth: Number(event.target.value) })}
              step={1}
              type="range"
              value={lineWidth}
            />
          </label>
        </>
      )}

      {isGapStudy && (
        <div className="indicator-floating-actions">
          <button
            className={`chart-object-floating-toggle ${isVisible ? "active" : ""}`}
            onClick={onToggleVisibility}
            title={isVisible ? "Hide indicator" : "Show indicator"}
            type="button"
          >
            {isVisible ? <Eye size={14} /> : <EyeOff size={14} />}
            <span>{isVisible ? "Visible" : "Hidden"}</span>
          </button>
          <button
            className={`chart-object-floating-toggle ${settings.showLabels !== false ? "active" : ""}`}
            onClick={() => onChange({ showLabels: settings.showLabels === false })}
            title={settings.showLabels === false ? "Show labels" : "Hide labels"}
            type="button"
          >
            {settings.showLabels === false ? "Labels hidden" : "Labels shown"}
          </button>
          <button
            className={`chart-object-floating-toggle ${settings.unmitigatedOnly === true ? "active" : ""}`}
            onClick={() =>
              onChange({
                unmitigatedOnly: settings.unmitigatedOnly !== true,
                unmitigatedOnlyUserSet: true,
              })
            }
            title="Show only zones that no later candle has touched"
            type="button"
          >
            Only unmitigated
          </button>
          <button
            className="chart-object-floating-toggle danger"
            onClick={onRemove}
            title="Remove indicator"
            type="button"
          >
            <Trash2 size={14} />
            <span>Remove</span>
          </button>
        </div>
      )}
      {!isGapStudy && (
        <>
          <button
            className={`chart-object-floating-button ${isVisible ? "active" : ""}`}
            onClick={onToggleVisibility}
            title={isVisible ? "Hide indicator" : "Show indicator"}
            type="button"
          >
            {isVisible ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          <button
            className="chart-object-floating-button danger"
            onClick={onRemove}
            title="Remove indicator"
            type="button"
          >
            <Trash2 size={14} />
          </button>
        </>
      )}
      <button
        aria-label="Close indicator settings"
        className="chart-object-floating-button"
        onClick={onClose}
        title="Close indicator settings"
        type="button"
      >
        <X aria-hidden="true" size={14} />
      </button>
    </div>
  );
}

function IndicatorNumberInput({
  label,
  max,
  min = 1,
  onChange,
  step = 1,
  value,
}: {
  label: string;
  max?: number;
  min?: number | null;
  onChange: (value: number) => void;
  step?: number | "any";
  value: number;
}) {
  return (
    <label className="indicator-floating-number">
      <span>{label}</span>
      <NumericDraftInput compact label={label} min={min ?? undefined} max={max} integer={step === 1} step={step} value={value} onChange={onChange} />
    </label>
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
  const { toolbarRef, fittedPosition, availableHeight } = useFloatingToolbarPlacement(position);
  const lineStyle = drawing.lineStyle ?? "solid";
  const lineWidth = drawing.lineWidth ?? 2;
  const fillOpacity = Math.round((drawing.fillOpacity ?? 0.16) * 100);
  const labelBackgroundOpacity = Math.round(
    (drawing.labelBackgroundOpacity ?? DEFAULT_LABEL_BACKGROUND_OPACITY) * 100,
  );
  const presetState = useChartPresets("drawing", sanitizeDrawingPresets, isLabelableDrawingTool(drawing.tool));
  const presets = presetState.presets;
  const drawingSnapshot = JSON.stringify(drawing);
  const latestDrawing = useRef(drawingSnapshot); latestDrawing.current = drawingSnapshot;
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const canFill = isFillableDrawingTool(drawing.tool);
  const canDelete = !drawing.locked;
  const isFib = isFibDrawingTool(drawing.tool);
  const isPositionTool = isRiskRewardTool(drawing.tool);
  const canLabel = drawing.tool === "text" || isLabelableDrawingTool(drawing.tool);
  const hasRenderedLabel =
    drawing.tool === "text" ||
    Boolean(drawing.label?.trim()) ||
    isRiskRewardTool(drawing.tool);
  const drawingPresets = isLabelableDrawingTool(drawing.tool)
    ? presets.filter((preset) => preset.tool === drawing.tool)
    : [];
  const lineStyles: DrawingLineStyle[] = ["solid", "dashed", "dotted"];

  useEffect(() => {
    if (!selectedPresetId) {
      return;
    }
    if (!drawingPresets.some((preset) => preset.id === selectedPresetId)) {
      setSelectedPresetId("");
    }
  }, [drawing.tool, drawingPresets, selectedPresetId]);

  const stopToolbarEvent = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  function saveCurrentPreset() {
    if (!isLabelableDrawingTool(drawing.tool)) {
      return;
    }
    const preset = makeDrawingPreset(drawing);
    void presetState.execute({ action: "save", preset, name: preset.name }, () => {
      if (latestDrawing.current !== drawingSnapshot) return false;
      setSelectedPresetId(preset.id);
      return true;
    });
  }

  function applyPreset(presetId: string) {
    const preset = presets.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }
    setSelectedPresetId(preset.id);
    onChange({
      color: preset.color,
      fillOpacity: canFill ? preset.fillOpacity ?? drawing.fillOpacity : drawing.fillOpacity,
      label: preset.label,
      labelBackgroundOpacity: preset.labelBackgroundOpacity,
      lineStyle: preset.lineStyle,
      lineWidth: preset.lineWidth,
      rewardColor: isPositionTool ? preset.rewardColor ?? drawing.rewardColor : drawing.rewardColor,
      riskColor: isPositionTool ? preset.riskColor ?? drawing.riskColor : drawing.riskColor,
    });
  }

  function deletePreset(presetId: string) {
    const preset = presets.find((item) => item.id === presetId);
    if (!preset) return Promise.resolve(false);
    return presetState.execute({ action: "delete", id: presetId, name: preset.name }, () => {
      setSelectedPresetId((current) => current === presetId ? "" : current);
      return true;
    });
  }

  return (
    <div
      aria-label="Drawing settings"
      className="chart-object-floating-toolbar overflow-y-auto overscroll-contain"
      ref={toolbarRef}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={stopToolbarEvent}
      role="group"
      style={{ left: fittedPosition.x, top: fittedPosition.y, maxHeight: availableHeight }}
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
          <PresetApplyDropdown
            ariaLabel="Drawing presets"
            className="min-h-8 w-40"
            disabled={!presetState.loaded || drawingPresets.length === 0}
            deleteDisabled={Boolean(presetState.pending)}
            items={drawingPresets.map((preset) => ({
              id: preset.id,
              name: preset.name,
              sublabel: preset.label || `${preset.lineStyle ?? "solid"} · ${preset.lineWidth ?? 2}px`,
            }))}
            onApply={applyPreset}
            onDelete={deletePreset}
            placeholder={drawingPresets.length === 0 ? "No presets" : "Apply preset"}
            selectedId={selectedPresetId}
          />
          <button
            className="chart-object-floating-button"
            disabled={!presetState.loaded || Boolean(presetState.pending)}
            onClick={saveCurrentPreset}
            title="Save label/style preset"
            type="button"
          >
            <Save size={14} />
          </button>
        </div>
      )}

      {isLabelableDrawingTool(drawing.tool) && <ChartPresetFeedback kind="Drawing" {...presetState} />}

      {isPositionTool ? (
        <div className="position-color-controls" aria-label="Position colors">
          <label className="position-color-control">
            <span>Entry</span>
            <ThemedColorPicker
              allowAlpha
              ariaLabel="Entry color"
              className="chart-object-floating-picker"
              compact
              onChange={(color) => onChange({ color })}
              value={drawing.color}
            />
          </label>
          <label className="position-color-control">
            <span>Target</span>
            <ThemedColorPicker
              allowAlpha
              ariaLabel="Target color"
              className="chart-object-floating-picker"
              compact
              onChange={(rewardColor) => onChange({ rewardColor })}
              value={positionRewardColor(drawing)}
            />
          </label>
          <label className="position-color-control">
            <span>Stop</span>
            <ThemedColorPicker
              allowAlpha
              ariaLabel="Stop color"
              className="chart-object-floating-picker"
              compact
              onChange={(riskColor) => onChange({ riskColor })}
              value={positionRiskColor(drawing)}
            />
          </label>
        </div>
      ) : (
        <ThemedColorPicker
          allowAlpha
          ariaLabel="Drawing color"
          className="chart-object-floating-picker"
          compact
          onChange={(color) => onChange({ color })}
          value={drawing.color}
        />
      )}

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
        <Trash2 size={14} />
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
  const presetState = useChartPresets("fib", sanitizeFibPresets);
  const presets = presetState.presets;
  const [presetName, setPresetName] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [inputRevision, setInputRevision] = useState(0);
  const draftSnapshot = JSON.stringify({ drawing, presetName });
  const latestDraft = useRef({ snapshot: draftSnapshot, name: presetName, selected: selectedPresetId });
  latestDraft.current = { snapshot: draftSnapshot, name: presetName, selected: selectedPresetId };
  const lineStyles: DrawingLineStyle[] = ["solid", "dashed", "dotted"];

  useEffect(() => {
    if (!selectedPresetId) {
      return;
    }
    if (!presets.some((preset) => preset.id === selectedPresetId)) {
      setSelectedPresetId("");
    }
  }, [presets, selectedPresetId]);

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
    if (levels.length >= 64) return;
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
    void presetState.execute({ action: "save", preset, name: preset.name }, () => {
      if (latestDraft.current.snapshot !== draftSnapshot) return false;
      setPresetName(preset.name);
      setSelectedPresetId(preset.id);
      return true;
    });
  }

  function applyPreset(presetId: string) {
    const preset = presets.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }
    setSelectedPresetId(preset.id);
    setInputRevision(current => current + 1);
    onChange({
      fibExtendLeft: preset.extendLeft,
      fibExtendRight: preset.extendRight,
      fibLevels: normalizeFibLevels(preset.levels, drawing.color),
    });
    setPresetName(preset.name);
  }

  function deletePreset(presetId: string) {
    const preset = presets.find((item) => item.id === presetId);
    if (!preset) return Promise.resolve(false);
    return presetState.execute({ action: "delete", id: presetId, name: preset.name }, () => {
      if (latestDraft.current.selected === presetId && latestDraft.current.snapshot === draftSnapshot) setPresetName("");
      setSelectedPresetId((current) => current === presetId ? "" : current);
      return true;
    });
  }

  return (
    <div className="fib-level-editor">
      <ChartPresetFeedback kind="Fib" {...presetState} />
      <div className="fib-level-editor-header">
        <span>Fib Levels</span>
        <div className="fib-preset-controls">
          <input
            aria-label="Fib preset name"
            className="fib-preset-name"
            onChange={(event) => setPresetName(event.target.value)}
            maxLength={48}
            placeholder="Preset name"
            value={presetName}
          />
          <PresetApplyDropdown
            ariaLabel="Fib presets"
            className="min-h-8 w-36"
            disabled={!presetState.loaded || presets.length === 0}
            deleteDisabled={Boolean(presetState.pending)}
            items={presets.map((preset) => ({
              id: preset.id,
              name: preset.name,
              sublabel: `${preset.levels.length} levels`,
            }))}
            onApply={applyPreset}
            onDelete={deletePreset}
            placeholder={presets.length === 0 ? "No presets" : "Apply"}
            selectedId={selectedPresetId}
          />
          <button
            className="fib-icon-button"
            disabled={!presetState.loaded || Boolean(presetState.pending)}
            onClick={savePreset}
            title="Save fib preset"
            type="button"
          >
            <Save size={12} />
          </button>
          <button
            className="fib-icon-button"
            onClick={() => {
              setInputRevision(current => current + 1);
              setSelectedPresetId("");
              onChange({
                fibExtendLeft: false,
                fibExtendRight: true,
                fibLevels: normalizeFibLevels(DEFAULT_FIB_LEVELS, drawing.color),
              });
            }}
            title="Reset default levels"
            type="button"
          >
            <RotateCcw size={12} />
          </button>
          <button aria-label="Add Fibonacci level" disabled={levels.length >= 64} className="fib-icon-button" onClick={addLevel} title="Add level" type="button">
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
                allowAlpha
                ariaLabel={`${level.label ?? level.value} color`}
                className="fib-level-color"
                compact
                onChange={(color) => updateLevel(level.id, { color })}
                value={level.color}
              />
              <NumericDraftInput
                label="Fib ratio"
                className="fib-level-value"
                min={-2}
                max={4.236}
                onChange={(value) => updateLevel(level.id, { label: String(value), value })}
                resetKey={`${drawing.id}:${inputRevision}`}
                step={0.001}
                value={level.value}
              />
              <ThemedSelect
                ariaLabel="Fib level line style"
                className="fib-level-style"
                menuClassName="w-28"
                portal
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

function buildFvgZoneElements({
  chart,
  definitions,
  frame,
  onOpenSettings,
  selectedIndicatorId,
  series,
}: {
  chart: IChartApi | null;
  definitions: FvgZoneDefinition[];
  frame: HTMLDivElement | null;
  onOpenSettings: (indicatorId: string, point: { x: number; y: number }) => void;
  selectedIndicatorId: string | null;
  series: PrimaryChartSeries | null;
}) {
  if (!chart || !series || !frame || definitions.length === 0) {
    return null;
  }

  const plotWidth = chartPlotWidth(chart, frame);
  const plotHeight = chartPlotHeight(chart, frame);
  const visibleRange = chartVisibleLogicalRange(chart, plotWidth);
  return definitions.map((definition) =>
    renderFvgZone({
      definition,
      onOpenSettings,
      plotHeight,
      plotWidth,
      selected: definition.sourceId === selectedIndicatorId,
      visibleRange,
      toPixel: (logical, price) =>
        pixelFromPoint({ logical, price, time: 0 }, chart, series),
    }),
  );
}

function formatFibLevelInput(value: number) {
  return Number(value.toFixed(3)).toString();
}

function buildDrawingElements({
  chart,
  chartSettings,
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
  chartSettings: ChartVisualSettings;
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
  onSelectDrawing: (drawingId: string, event: MouseEvent<SVGElement>) => void;
  interactive: boolean;
  selectedDrawingId: string | null;
  series: PrimaryChartSeries | null;
  version: number;
}) {
  if (!chart || !series || !frame) {
    return null;
  }

  const width = chartPlotWidth(chart, frame);
  const height = chartPlotHeight(chart, frame);
  const toPixel = (point: DrawingPoint) => {
    return pixelFromPoint(point, chart, series);
  };

  return (
    <>
      {drawings.filter((drawing) => drawing.visible !== false).map((drawing) =>
        renderDrawing(drawing, toPixel, width, height, chartSettings, {
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
                points: [...draftDrawing.points, hoverPoint],
                createdAt: "",
              },
              toPixel,
              width,
              height,
              chartSettings,
              {
                onDeleteDrawing,
                onDragStart,
                onSelectDrawing,
                interactive: false,
                selected: false,
              },
            )}
          {draftDrawing.points.map((point, index) => (
            <circle
              cx={toPixel(point)?.x ?? 0}
              cy={toPixel(point)?.y ?? 0}
              fill={DRAWING_COLORS[draftDrawing.tool]}
              key={`draft-anchor-${index}`}
              opacity={0.9}
              r={4}
            />
          ))}
        </g>
      )}
    </>
  );
}

function chartPlotWidth(chart: IChartApi, frame: HTMLDivElement) {
  const paneWidth = chart.paneSize().width;
  if (Number.isFinite(paneWidth) && paneWidth > 0) {
    return Math.min(frame.clientWidth, paneWidth);
  }
  return frame.clientWidth;
}

function chartPlotHeight(chart: IChartApi, frame: HTMLDivElement | null) {
  const paneHeight = chart.paneSize().height;
  if (Number.isFinite(paneHeight) && paneHeight > 0) {
    return frame ? Math.min(frame.clientHeight, paneHeight) : paneHeight;
  }
  return frame?.clientHeight ?? 0;
}

function chartVisibleLogicalRange(chart: IChartApi, plotWidth: number) {
  const visibleRange = chart.timeScale().getVisibleLogicalRange();
  if (visibleRange) {
    return visibleRange;
  }

  const from = chart.timeScale().coordinateToLogical(0);
  const to = chart.timeScale().coordinateToLogical(plotWidth);
  if (from == null || to == null) {
    return null;
  }
  return {
    from: Math.min(from, to),
    to: Math.max(from, to),
  };
}

function renderFvgZone({
  definition,
  onOpenSettings,
  plotHeight,
  plotWidth,
  selected,
  toPixel,
  visibleRange,
}: {
  definition: FvgZoneDefinition;
  onOpenSettings: (indicatorId: string, point: { x: number; y: number }) => void;
  plotHeight: number;
  plotWidth: number;
  selected: boolean;
  toPixel: (logical: number, price: number) => { x: number; y: number } | null;
  visibleRange: { from: number; to: number } | null;
}) {
  const visibleSpan = fvgZoneVisibleSpan(definition, visibleRange);
  if (!visibleSpan) {
    return null;
  }

  const startTop = toPixel(visibleSpan.startLogical, definition.high);
  const endBottom = toPixel(visibleSpan.endLogical, definition.low);
  if (!startTop || !endBottom) {
    return null;
  }

  const box = normalizePixelBox(startTop, endBottom);
  if (
    box.right < -24 ||
    box.left > plotWidth + 24 ||
    box.bottom < -24 ||
    box.top > plotHeight + 24
  ) {
    return null;
  }

  const boxWidth = Math.max(2, box.right - box.left);
  const compactLabel = definition.label
    .replace("Bullish", "Bull")
    .replace("Bearish", "Bear")
    .replace("Inverse ", "Inv ");
  const labelText = boxWidth >= 76 ? definition.label : compactLabel;
  const labelWidth = Math.max(50, Math.ceil(labelText.length * 6.2 + 14));
  const showZoneLabel = definition.showLabel && plotWidth >= labelWidth + 8;
  const labelX = Math.min(
    Math.max(box.left + 3, 0),
    Math.max(0, plotWidth - labelWidth - 3),
  );
  const labelY = clamp(box.top + 3, 3, Math.max(3, plotHeight - 18));
  const handleMouseDown = (event: MouseEvent<SVGElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onOpenSettings(definition.sourceId, {
      x: clamp(box.left + 14, 0, plotWidth),
      y: clamp(box.top + 14, 0, plotHeight),
    });
  };

  return (
    <g
      key={definition.id}
      onMouseDown={handleMouseDown}
      style={{ cursor: "pointer", pointerEvents: "all" }}
    >
      <rect
        fill={colorWithOpacity(
          definition.color,
          definition.mitigated ? definition.fillOpacity * 0.55 : definition.fillOpacity,
        )}
        height={Math.max(2, box.bottom - box.top)}
        rx={2}
        ry={2}
        stroke={definition.color}
        strokeDasharray={indicatorDasharray(definition.lineStyle)}
        strokeOpacity={definition.mitigated ? 0.6 : 1}
        strokeWidth={selected ? Math.min((definition.lineWidth ?? 1) + 1, 4) : definition.lineWidth ?? 1}
        width={boxWidth}
        x={box.left}
        y={box.top}
      />
      {showZoneLabel && (
        <>
          <rect
            fill={colorWithOpacity(definition.color, selected ? 0.28 : 0.16)}
            height={18}
            rx={3}
            ry={3}
            width={labelWidth}
            x={labelX}
            y={labelY}
          />
          <text
            fill="#f8fafc"
            fontSize={10}
            fontWeight={700}
            x={labelX + 9}
            y={labelY + 12}
          >
            {labelText}
          </text>
        </>
      )}
    </g>
  );
}

function buildOrderEditLines(
  activePosition: Position | null,
  orders: Order[],
  drag: OrderLineDragState | null,
): OrderEditLine[] {
  const lines: OrderEditLine[] = [];

  if (activePosition) {
    addOrderEditLine(lines, {
      color: "#fb7185",
      key: "position-stop-loss",
      label: "SL",
      price: activePosition.stop_loss,
      target: { kind: "position", field: "stop_loss" },
    }, drag);
    addOrderEditLine(lines, {
      color: "#22c55e",
      key: "position-take-profit",
      label: "TP",
      price: activePosition.take_profit,
      target: { kind: "position", field: "take_profit" },
    }, drag);
  }

  orders
    .filter((order) => order.status === "PENDING")
    .forEach((order) => {
      const entryField = pendingOrderEntryField(order);
      const labelPrefix = `P#${order.id}`;
      if (entryField) {
        addOrderEditLine(lines, {
          color: order.side === "BUY" ? "#32d3ee" : "#f59e0b",
          key: `order-${order.id}-entry`,
          label: `${labelPrefix} ${order.order_type}`,
          price: order[entryField],
          target: { kind: "order", orderId: order.id, field: entryField },
        }, drag);
      }
      addOrderEditLine(lines, {
        color: "#fb7185",
        key: `order-${order.id}-stop-loss`,
        label: `${labelPrefix} SL`,
        price: order.stop_loss,
        target: { kind: "order", orderId: order.id, field: "stop_loss" },
      }, drag);
      addOrderEditLine(lines, {
        color: "#22c55e",
        key: `order-${order.id}-take-profit`,
        label: `${labelPrefix} TP`,
        price: order.take_profit,
        target: { kind: "order", orderId: order.id, field: "take_profit" },
      }, drag);
    });

  return lines;
}

function buildOrderLineModificationDraft({
  activePosition,
  nextPrice,
  orders,
  pnlMultiplier,
  target,
}: {
  activePosition: Position | null;
  nextPrice: number;
  orders: Order[];
  pnlMultiplier: number;
  target: OrderLineDragTarget;
}): OrderLineModificationDraft | null {
  if (!Number.isFinite(nextPrice) || nextPrice <= 0) {
    return null;
  }

  if (target.kind === "position") {
    if (!activePosition) {
      return null;
    }
    const previousPrice = activePosition[target.field];
    if (previousPrice == null) {
      return null;
    }
    const nextStopLoss = target.field === "stop_loss" ? nextPrice : activePosition.stop_loss;
    const nextTakeProfit =
      target.field === "take_profit" ? nextPrice : activePosition.take_profit;
    return {
      label: target.field === "stop_loss" ? "Position SL" : "Position TP",
      nextPrice,
      previousPrice,
      stats: orderLineModificationStats({
        entryPrice: activePosition.avg_price,
        modifiedField: target.field,
        pnlMultiplier,
        quantity: activePosition.quantity,
        side: activePosition.side === "SHORT" ? "SHORT" : "LONG",
        stopLoss: nextStopLoss,
        takeProfit: nextTakeProfit,
      }),
      target,
    };
  }

  const order = orders.find((item) => item.id === target.orderId);
  if (!order) {
    return null;
  }
  const previousPrice = order[target.field];
  if (previousPrice == null) {
    return null;
  }
  const entryField = pendingOrderEntryField(order);
  const nextEntryPrice =
    target.field === "limit_price" || target.field === "stop_price"
      ? nextPrice
      : entryField
        ? order[entryField]
        : null;
  if (nextEntryPrice == null) {
    return null;
  }
  const nextStopLoss = target.field === "stop_loss" ? nextPrice : order.stop_loss;
  const nextTakeProfit = target.field === "take_profit" ? nextPrice : order.take_profit;
  const side = order.side === "BUY" ? "LONG" : "SHORT";

  return {
    label: `P#${order.id} ${orderLineFieldLabel(target.field)}`,
    nextPrice,
    previousPrice,
    stats: orderLineModificationStats({
      entryPrice: nextEntryPrice,
      modifiedField: target.field,
      pnlMultiplier,
      quantity: order.quantity ?? 0,
      side,
      stopLoss: nextStopLoss,
      takeProfit: nextTakeProfit,
    }),
    target,
  };
}

function orderLineModificationStats({
  entryPrice,
  modifiedField,
  pnlMultiplier,
  quantity,
  side,
  stopLoss,
  takeProfit,
}: {
  entryPrice: number;
  modifiedField: PendingOrderField | PositionOrderField;
  pnlMultiplier: number;
  quantity: number;
  side: "LONG" | "SHORT";
  stopLoss: number | null;
  takeProfit: number | null;
}): OrderLineModificationStats {
  const stopPnl =
    stopLoss == null
      ? null
      : projectedPnl(entryPrice, stopLoss, quantity, side, pnlMultiplier);
  const targetPnl =
    takeProfit == null
      ? null
      : projectedPnl(entryPrice, takeProfit, quantity, side, pnlMultiplier);
  const risk = stopPnl == null ? null : Math.abs(stopPnl);
  const rr =
    risk != null && risk > 0 && targetPnl != null
      ? targetPnl / risk
      : null;

  if (modifiedField === "stop_loss") {
    return { pnl: stopPnl, pnlLabel: "SL P&L", rr };
  }
  if (modifiedField === "take_profit") {
    return { pnl: targetPnl, pnlLabel: "TP P&L", rr };
  }
  return {
    pnl: targetPnl ?? stopPnl,
    pnlLabel: targetPnl == null ? "SL P&L" : "TP P&L",
    rr,
  };
}

function projectedPnl(
  entryPrice: number,
  exitPrice: number,
  quantity: number,
  side: "LONG" | "SHORT",
  pnlMultiplier: number,
) {
  if (![entryPrice, exitPrice, quantity, pnlMultiplier].every(Number.isFinite)) {
    return null;
  }
  const direction = side === "LONG" ? 1 : -1;
  return (exitPrice - entryPrice) * quantity * direction * pnlMultiplier;
}

function addOrderEditLine(
  lines: OrderEditLine[],
  line: Omit<OrderEditLine, "price"> & { price: number | null | undefined },
  drag: OrderLineDragState | null,
) {
  const price = draggedOrderLinePrice(line.target, line.price, drag);
  if (price == null || !Number.isFinite(price) || price <= 0) {
    return;
  }
  lines.push({ ...line, price });
}

function draggedOrderLinePrice(
  target: OrderLineDragTarget,
  price: number | null | undefined,
  drag: OrderLineDragState | null,
) {
  return drag && orderLineTargetsEqual(target, drag.target) ? drag.price : price;
}

function orderLineTargetsEqual(left: OrderLineDragTarget, right: OrderLineDragTarget) {
  if (left.kind !== right.kind || left.field !== right.field) {
    return false;
  }
  if (left.kind === "position") {
    return true;
  }
  return right.kind === "order" && left.orderId === right.orderId;
}

function pendingOrderEntryField(order: Order): "limit_price" | "stop_price" | null {
  if (order.order_type === "LIMIT") {
    return "limit_price";
  }
  if (order.order_type === "STOP") {
    return "stop_price";
  }
  if (order.limit_price != null) {
    return "limit_price";
  }
  if (order.stop_price != null) {
    return "stop_price";
  }
  return null;
}

function orderLineFieldLabel(field: PendingOrderField | PositionOrderField) {
  switch (field) {
    case "limit_price":
      return "Entry";
    case "stop_price":
      return "Entry";
    case "stop_loss":
      return "SL";
    case "take_profit":
      return "TP";
  }
}

function positionOverlayFromPrice(
  price: number,
  frame: HTMLDivElement | null,
  chart: IChartApi | null,
  series: PrimaryChartSeries | null,
) {
  if (!frame || !chart || !series) {
    return null;
  }
  const y = series.priceToCoordinate(price);
  if (y == null) {
    return null;
  }
  const plotWidth = chartPlotWidth(chart, frame);
  const plotHeight = chartPlotHeight(chart, frame);
  return {
    x: clamp(plotWidth - 156, 12, Math.max(12, plotWidth - 96)),
    y: clamp(y, 22, Math.max(22, plotHeight - 22)),
  };
}

function isOpenPosition(position: Position | null | undefined): position is Position {
  return position != null && position.side !== "FLAT" && position.quantity > 1e-9;
}

function hitTestDrawingAtPoint({
  chart,
  drawings,
  frame,
  point,
  selectedDrawingId,
  series,
}: {
  chart: IChartApi | null;
  drawings: ChartDrawing[];
  frame: HTMLDivElement | null;
  point: { x: number; y: number };
  selectedDrawingId: string | null;
  series: PrimaryChartSeries | null;
}): DrawingHit | null {
  if (!chart || !series || !frame) {
    return null;
  }
  const width = chartPlotWidth(chart, frame);
  const height = chartPlotHeight(chart, frame);
  const threshold = 10;
  const toPixel = (drawingPoint: DrawingPoint) =>
    pixelFromPoint(drawingPoint, chart, series);

  for (const drawing of [...drawings].reverse()) {
    if (drawing.visible === false) {
      continue;
    }
    const normalizedDrawing = normalizeRiskRewardDrawing(drawing);
    const pixels = normalizedDrawing.points.map(toPixel);
    const selected = drawing.id === selectedDrawingId;

    if (selected) {
      const anchorIndex = pixels.findIndex(
        (pixel) => pixel && Math.hypot(point.x - pixel.x, point.y - pixel.y) <= 12,
      );
      if (anchorIndex >= 0) {
        return { drawing, mode: "anchor", pointIndex: anchorIndex };
      }
    }

    const first = pixels[0];
    if (!first) {
      continue;
    }

    if (drawing.tool === "horizontal") {
      if (point.x >= 0 && point.x <= width && Math.abs(point.y - first.y) <= threshold) {
        return { drawing, mode: "body", pointIndex: null };
      }
      continue;
    }

    if (drawing.tool === "vertical") {
      if (point.y >= 0 && point.y <= height && Math.abs(point.x - first.x) <= threshold) {
        return { drawing, mode: "body", pointIndex: null };
      }
      continue;
    }

    if (drawing.tool === "text") {
      const textLines = normalizeTextLines(drawing.label);
      const labelMetrics = textLabelMetrics(textLines);
      const labelX = first.x + 14;
      const labelY = first.y - labelMetrics.height - 16;
      const labelBox = {
        bottom: labelY + labelMetrics.height + 8,
        left: Math.min(first.x - 8, labelX),
        right: labelX + labelMetrics.width + 8,
        top: labelY - 8,
      };
      if (
        pointInsideBox(point, labelBox) ||
        Math.hypot(point.x - first.x, point.y - first.y) <= threshold
      ) {
        return { drawing, mode: "body", pointIndex: null };
      }
      continue;
    }

    if (drawing.tool === "flag" || drawing.tool === "icon") {
      if (Math.hypot(point.x - first.x, point.y - first.y) <= 18) {
        return { drawing, mode: "body", pointIndex: null };
      }
      continue;
    }

    const second = pixels[1];
    if (!second) {
      continue;
    }

    if (drawing.tool === "rectangle") {
      const box = normalizePixelBox(first, second);
      if (pointInsideBox(point, expandBox(box, threshold))) {
        if (selected) {
          const edgeHit = rectangleEdgeHit(point, box, threshold);
          if (edgeHit != null) {
            return { drawing, mode: "anchor", pointIndex: edgeHit };
          }
        }
        return { drawing, mode: "body", pointIndex: null };
      }
      continue;
    }

    if (isFibDrawingTool(drawing.tool)) {
      const anchorLeft = Math.min(first.x, second.x);
      const anchorRight = Math.max(first.x, second.x);
      const lineLeft = drawing.fibExtendLeft === true ? 0 : anchorLeft;
      const lineEnd = drawing.fibExtendRight === false ? anchorRight : width;
      const levels = normalizeFibLevels(drawing.fibLevels, drawing.color).filter(
        (level) => level.visible !== false,
      );
      const visibleLevelYs = levels.map((level) => first.y + (second.y - first.y) * level.value);
      const hitTop = Math.min(first.y, second.y, ...visibleLevelYs);
      const hitBottom = Math.max(first.y, second.y, ...visibleLevelYs);
      const levelHit = visibleLevelYs.some((y) => {
        return (
          point.x >= lineLeft - threshold &&
          point.x <= lineEnd + threshold &&
          Math.abs(point.y - y) <= threshold
        );
      });
      if (
        levelHit ||
        pointSegmentDistance(point, first, second) <= threshold ||
        pointInsideBox(
          point,
          expandBox(
            {
              bottom: hitBottom,
              left: Math.min(lineLeft, lineEnd),
              right: Math.max(lineLeft, lineEnd),
              top: hitTop,
            },
            threshold,
          ),
        )
      ) {
        return { drawing, mode: "body", pointIndex: null };
      }
      continue;
    }

    if (drawing.tool === "longPosition" || drawing.tool === "shortPosition") {
      const third = pixels[2];
      if (!third) {
        continue;
      }
      const positionBox = positionBoxGeometry(first, second, third, width);
      if (selected) {
        const positionHandle = positionCornerHit(point, positionBox, threshold + 2);
        if (positionHandle != null) {
          return { drawing, mode: "anchor", pointIndex: positionHandle };
        }
      }
      const box = expandBox(
        {
          bottom: positionBox.hitBottom,
          left: positionBox.left - 16,
          right: positionBox.boxRight + 32,
          top: positionBox.hitTop - 12,
        },
        threshold,
      );
      if (pointInsideBox(point, box)) {
        return { drawing, mode: "body", pointIndex: null };
      }
      continue;
    }

    if (pointSegmentDistance(point, first, second) <= threshold) {
      return { drawing, mode: "body", pointIndex: null };
    }
  }

  return null;
}

function normalizePixelBox(
  first: { x: number; y: number },
  second: { x: number; y: number },
) {
  return {
    bottom: Math.max(first.y, second.y),
    left: Math.min(first.x, second.x),
    right: Math.max(first.x, second.x),
    top: Math.min(first.y, second.y),
  };
}

function expandBox(
  box: { bottom: number; left: number; right: number; top: number },
  padding: number,
) {
  return {
    bottom: box.bottom + padding,
    left: box.left - padding,
    right: box.right + padding,
    top: box.top - padding,
  };
}

function pointInsideBox(
  point: { x: number; y: number },
  box: { bottom: number; left: number; right: number; top: number },
) {
  return (
    point.x >= box.left &&
    point.x <= box.right &&
    point.y >= box.top &&
    point.y <= box.bottom
  );
}

function rectangleEdgeHit(
  point: { x: number; y: number },
  box: { bottom: number; left: number; right: number; top: number },
  threshold: number,
) {
  const nearLeft = Math.abs(point.x - box.left) <= threshold;
  const nearRight = Math.abs(point.x - box.right) <= threshold;
  const nearTop = Math.abs(point.y - box.top) <= threshold;
  const nearBottom = Math.abs(point.y - box.bottom) <= threshold;
  const withinY = point.y >= box.top - threshold && point.y <= box.bottom + threshold;
  const withinX = point.x >= box.left - threshold && point.x <= box.right + threshold;
  if (nearLeft && withinY) {
    return RECTANGLE_EDGE_HANDLE.left;
  }
  if (nearRight && withinY) {
    return RECTANGLE_EDGE_HANDLE.right;
  }
  if (nearTop && withinX) {
    return RECTANGLE_EDGE_HANDLE.top;
  }
  if (nearBottom && withinX) {
    return RECTANGLE_EDGE_HANDLE.bottom;
  }
  return null;
}

function positionCornerHit(
  point: { x: number; y: number },
  box: ReturnType<typeof positionBoxGeometry>,
  threshold: number,
) {
  const corners = [
    { id: POSITION_HANDLE.topLeft, x: box.left, y: box.hitTop },
    { id: POSITION_HANDLE.topRight, x: box.boxRight, y: box.hitTop },
    { id: POSITION_HANDLE.bottomLeft, x: box.left, y: box.hitBottom },
    { id: POSITION_HANDLE.bottomRight, x: box.boxRight, y: box.hitBottom },
  ];
  const hit = corners.find(
    (corner) => Math.hypot(point.x - corner.x, point.y - corner.y) <= threshold,
  );
  return hit?.id ?? null;
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

function verticalTimeLabelGeometry(
  label: string,
  plotWidth: number,
  plotHeight: number,
  x: number,
) {
  const paddingX = 16;
  const estimatedTextWidth = label.length * 6.6;
  const maxWidth = Math.max(72, plotWidth - 16);
  const labelWidth = clamp(
    Math.ceil(estimatedTextWidth + paddingX),
    86,
    Math.min(190, maxWidth),
  );
  const textWidth = Math.max(12, labelWidth - paddingX);

  return {
    squeeze: estimatedTextWidth > textWidth,
    textWidth,
    width: labelWidth,
    x: clamp(x - labelWidth / 2, 8, Math.max(8, plotWidth - labelWidth - 8)),
    y: clamp(plotHeight - 26, 4, Math.max(4, plotHeight - 24)),
  };
}

function renderDrawing(
  drawing: ChartDrawing,
  toPixel: (point: DrawingPoint) => { x: number; y: number } | null,
  width: number,
  height: number,
  chartSettings: ChartVisualSettings,
  options: {
    onDeleteDrawing: (drawingId: string) => void;
    onDragStart: (
      drawing: ChartDrawing,
      mode: DragState["mode"],
      pointIndex: number | null,
      event: MouseEvent<SVGElement>,
    ) => void;
    onSelectDrawing: (drawingId: string, event: MouseEvent<SVGElement>) => void;
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
    options.onSelectDrawing(drawing.id, event);
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

  if (drawing.tool === "vertical") {
    const point = toPixel(drawing.points[0]);
    if (!point) {
      return null;
    }
    const label = formatChartTime(drawing.points[0].time as UTCTimestamp, chartSettings);
    const labelGeometry = verticalTimeLabelGeometry(label, width, height, point.x);
    return (
      <g key={drawing.id}>
        <line
          cursor={isLocked ? "default" : "ew-resize"}
          onMouseDown={handleBodyDown}
          onClick={handleSelect}
          pointerEvents={hitTargetPointerEvents}
          stroke="transparent"
          strokeWidth="14"
          x1={point.x}
          x2={point.x}
          y1={0}
          y2={height}
        />
        <line
          stroke={color}
          strokeDasharray={strokeDasharray}
          strokeOpacity={isSelected ? 1 : 0.82}
          strokeWidth={selectedStrokeWidth}
          x1={point.x}
          x2={point.x}
          y1={0}
          y2={height}
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
          x: point.x + 10,
          y: 10,
        })}
        {isSelected && !isLocked && renderAnchors(drawing, [point], options)}
      </g>
    );
  }

  if (drawing.tool === "flag" || drawing.tool === "icon") {
    const point = toPixel(drawing.points[0]);
    if (!point) return null;
    const marker = (drawing.marker?.trim() || (drawing.tool === "flag" ? "⚑" : "★")).slice(0, 3);
    return (
      <g
        cursor={isLocked ? "default" : "move"}
        key={drawing.id}
        onClick={handleSelect}
        onMouseDown={handleBodyDown}
        pointerEvents={hitTargetPointerEvents}
      >
        <circle cx={point.x} cy={point.y} fill="rgba(8, 12, 17, 0.92)" r={14} stroke={color} strokeWidth={selectedStrokeWidth} />
        <text dominantBaseline="central" fill={color} fontSize={16} fontWeight="800" textAnchor="middle" x={point.x} y={point.y}>{marker}</text>
        {renderDrawingLabel({
          backgroundOpacity: drawing.labelBackgroundOpacity,
          color,
          id: `${drawing.id}-label`,
          label: drawing.label,
          plotWidth: width,
          x: point.x + 18,
          y: point.y - 12,
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

  if (
    drawing.tool === "brush" ||
    drawing.tool === "chartPattern" ||
    drawing.tool === "elliottWave" ||
    drawing.tool === "harmonicPattern" ||
    drawing.tool === "angle"
  ) {
    const pixels = drawing.points
      .map(toPixel)
      .filter((point): point is { x: number; y: number } => point != null);
    if (pixels.length < 2) return null;
    const pointText = pixels.map((point) => `${point.x},${point.y}`).join(" ");
    const closePattern = drawing.tool === "harmonicPattern";
    const labels =
      drawing.tool === "elliottWave"
        ? ["0", "1", "2", "3", "4"]
        : drawing.tool === "harmonicPattern"
          ? ["X", "A", "B", "C", "D"]
          : drawing.tool === "chartPattern"
            ? ["1", "2", "3", "4"]
            : [];
    return (
      <g key={drawing.id}>
        {closePattern ? (
          <polygon fill={colorWithOpacity(color, drawing.fillOpacity ?? 0.08)} points={pointText} stroke="none" />
        ) : null}
        <polyline
          cursor={isLocked ? "default" : "move"}
          fill="none"
          onClick={handleSelect}
          onMouseDown={handleBodyDown}
          pointerEvents={hitTargetPointerEvents}
          points={pointText}
          stroke="transparent"
          strokeWidth={14}
        />
        <polyline
          fill="none"
          points={pointText}
          stroke={color}
          strokeDasharray={strokeDasharray}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeOpacity={isSelected ? 1 : 0.9}
          strokeWidth={selectedStrokeWidth}
        />
        {labels.map((label, index) => pixels[index] ? (
          <g key={`${drawing.id}-point-${label}`} pointerEvents="none">
            <circle cx={pixels[index].x} cy={pixels[index].y} fill="rgba(8,12,17,.92)" r={9} stroke={color} />
            <text dominantBaseline="central" fill={color} fontSize={9} fontWeight="800" textAnchor="middle" x={pixels[index].x} y={pixels[index].y}>{label}</text>
          </g>
        ) : null)}
        {drawing.tool === "angle" && pixels.length >= 3 ? (
          <text fill={color} fontSize={11} fontWeight="800" x={pixels[1].x + 10} y={pixels[1].y - 10}>
            {screenAngleDegrees(pixels[0], pixels[1], pixels[2]).toFixed(1)}°
          </text>
        ) : null}
        {renderDrawingLabel({
          backgroundOpacity: drawing.labelBackgroundOpacity,
          color,
          id: `${drawing.id}-label`,
          label: drawing.label,
          plotWidth: width,
          x: pixels[0].x + 10,
          y: pixels[0].y - 30,
        })}
        {isSelected && !isLocked && renderAnchors(drawing, pixels, options)}
      </g>
    );
  }

  if (drawing.tool === "triangle") {
    const third = toPixel(drawing.points[2]);
    if (!third) return null;
    const points = `${first.x},${first.y} ${second.x},${second.y} ${third.x},${third.y}`;
    return (
      <g key={drawing.id}>
        <polygon
          cursor={isLocked ? "default" : "move"}
          fill={colorWithOpacity(color, drawing.fillOpacity ?? 0.12)}
          onClick={handleSelect}
          onMouseDown={handleBodyDown}
          pointerEvents={hitTargetPointerEvents}
          points={points}
          stroke={color}
          strokeDasharray={strokeDasharray}
          strokeWidth={selectedStrokeWidth}
        />
        {isSelected && !isLocked && renderAnchors(drawing, [first, second, third], options)}
      </g>
    );
  }

  if (drawing.tool === "ellipse") {
    const centerX = (first.x + second.x) / 2;
    const centerY = (first.y + second.y) / 2;
    return (
      <g key={drawing.id}>
        <ellipse
          cursor={isLocked ? "default" : "move"}
          cx={centerX}
          cy={centerY}
          fill={colorWithOpacity(color, drawing.fillOpacity ?? 0.12)}
          onClick={handleSelect}
          onMouseDown={handleBodyDown}
          pointerEvents={hitTargetPointerEvents}
          rx={Math.abs(second.x - first.x) / 2}
          ry={Math.abs(second.y - first.y) / 2}
          stroke={color}
          strokeDasharray={strokeDasharray}
          strokeWidth={selectedStrokeWidth}
        />
        {isSelected && !isLocked && renderAnchors(drawing, [first, second], options)}
      </g>
    );
  }

  if (drawing.tool === "parallelChannel" || drawing.tool === "fibChannel") {
    const third = toPixel(drawing.points[2]);
    if (!third) return null;
    const offsetX = third.x - first.x;
    const offsetY = third.y - first.y;
    const levels = drawing.tool === "fibChannel"
      ? normalizeFibLevels(drawing.fibLevels, color).filter((level) => level.visible !== false)
      : [{ id: "edge", value: 1, color }];
    return (
      <g key={drawing.id}>
        <polygon fill={colorWithOpacity(color, drawing.fillOpacity ?? 0.08)} points={`${first.x},${first.y} ${second.x},${second.y} ${second.x + offsetX},${second.y + offsetY} ${first.x + offsetX},${first.y + offsetY}`} />
        {[{ id: "base", value: 0, color }, ...levels].map((level) => (
          <line
            key={`${drawing.id}-${level.id}`}
            onClick={handleSelect}
            onMouseDown={handleBodyDown}
            pointerEvents={hitTargetPointerEvents}
            stroke={level.color}
            strokeDasharray={strokeDasharray}
            strokeWidth={selectedStrokeWidth}
            x1={first.x + offsetX * level.value}
            x2={second.x + offsetX * level.value}
            y1={first.y + offsetY * level.value}
            y2={second.y + offsetY * level.value}
          />
        ))}
        {isSelected && !isLocked && renderAnchors(drawing, [first, second, third], options)}
      </g>
    );
  }

  if (drawing.tool === "fibTime") {
    const levels = normalizeFibLevels(drawing.fibLevels, color).filter((level) => level.visible !== false);
    return (
      <g key={drawing.id}>
        {levels.map((level) => {
          const x = first.x + (second.x - first.x) * level.value;
          return <line key={`${drawing.id}-${level.id}`} onClick={handleSelect} onMouseDown={handleBodyDown} pointerEvents={hitTargetPointerEvents} stroke={level.color} strokeDasharray={lineStyleDasharray(level.lineStyle ?? "solid")} strokeWidth={selectedStrokeWidth} x1={x} x2={x} y1={0} y2={height} />;
        })}
        {isSelected && !isLocked && renderAnchors(drawing, [first, second], options)}
      </g>
    );
  }

  if (drawing.tool === "fibFan") {
    const third = toPixel(drawing.points[2]);
    if (!third) return null;
    const levels = normalizeFibLevels(drawing.fibLevels, color).filter((level) => level.visible !== false);
    return (
      <g key={drawing.id}>
        {levels.map((level) => {
          const target = { x: second.x + (third.x - second.x) * level.value, y: second.y + (third.y - second.y) * level.value };
          const end = extendLineToBounds(first, target, width, height, false);
          return <line key={`${drawing.id}-${level.id}`} onClick={handleSelect} onMouseDown={handleBodyDown} pointerEvents={hitTargetPointerEvents} stroke={level.color} strokeDasharray={lineStyleDasharray(level.lineStyle ?? "solid")} strokeWidth={selectedStrokeWidth} x1={first.x} x2={end.to.x} y1={first.y} y2={end.to.y} />;
        })}
        {isSelected && !isLocked && renderAnchors(drawing, [first, second, third], options)}
      </g>
    );
  }

  if (drawing.tool === "fibExtension") {
    const sourceTool = drawing.tool;
    return renderDrawing(
      {
        ...drawing,
        tool: "fib",
        fibExtendRight: true,
        fibLevels: normalizeFibLevels(drawing.fibLevels, color),
      },
      toPixel,
      width,
      height,
      chartSettings,
      {
        ...options,
        onDragStart: (renderedDrawing, mode, pointIndex, event) =>
          options.onDragStart({ ...renderedDrawing, tool: sourceTool }, mode, pointIndex, event),
      },
    );
  }

  if (drawing.tool === "measure" || drawing.tool === "quickMeasure") {
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
    const visibleLevelYs = bandLevels.map((level) => level.y);
    const hitTop = Math.min(first.y, second.y, ...visibleLevelYs);
    const hitBottom = Math.max(first.y, second.y, ...visibleLevelYs);
    return (
      <g key={drawing.id}>
        <rect
          cursor={isLocked ? "default" : "move"}
          fill="transparent"
          height={hitBottom - hitTop + 20}
          onClick={handleSelect}
          onMouseDown={handleBodyDown}
          pointerEvents={hitTargetPointerEvents}
          width={Math.max(0, lineEnd - lineLeft) + 20}
          x={lineLeft - 10}
          y={hitTop - 10}
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

  if (drawing.tool === "callout") {
    const text = compactDrawingLabel(drawing.label) || "Callout";
    const boxWidth = clamp(text.length * 7.2 + 24, 92, 240);
    const boxX = clamp(second.x, 6, Math.max(6, width - boxWidth - 6));
    const boxY = clamp(second.y - 18, 6, Math.max(6, height - 42));
    return (
      <g key={drawing.id}>
        <line stroke={color} strokeWidth={selectedStrokeWidth} x1={first.x} x2={boxX} y1={first.y} y2={boxY + 18} />
        <rect
          cursor={isLocked ? "default" : "move"}
          fill={drawingLabelBackgroundFill(drawing.labelBackgroundOpacity)}
          height={36}
          onClick={handleSelect}
          onMouseDown={handleBodyDown}
          pointerEvents={hitTargetPointerEvents}
          rx={6}
          stroke={color}
          strokeWidth={selectedStrokeWidth}
          width={boxWidth}
          x={boxX}
          y={boxY}
        />
        <text fill={color} fontSize={11} fontWeight="700" x={boxX + 12} y={boxY + 22}>{text}</text>
        {isSelected && !isLocked && renderAnchors(drawing, [first, second], options)}
      </g>
    );
  }

  const lineGeometry =
    drawing.tool === "horizontalRay"
      ? { from: first, to: { x: width, y: first.y } }
      : drawing.tool === "ray"
        ? extendLineToBounds(first, second, width, height, false)
        : drawing.tool === "extendedLine"
          ? extendLineToBounds(first, second, width, height, true)
          : { from: first, to: second };
  const arrowHead = drawing.tool === "arrow"
    ? arrowHeadPoints(lineGeometry.from, lineGeometry.to, 10)
    : null;

  return (
    <g key={drawing.id}>
      <line
        cursor={isLocked ? "default" : "move"}
        onClick={handleSelect}
        onMouseDown={handleBodyDown}
        pointerEvents={hitTargetPointerEvents}
        stroke="transparent"
        strokeWidth="14"
        x1={lineGeometry.from.x}
        x2={lineGeometry.to.x}
        y1={lineGeometry.from.y}
        y2={lineGeometry.to.y}
      />
      <line
        stroke={color}
        strokeDasharray={strokeDasharray}
        strokeLinecap="round"
        strokeOpacity={isSelected ? 1 : 0.9}
        strokeWidth={selectedStrokeWidth}
        x1={lineGeometry.from.x}
        x2={lineGeometry.to.x}
        y1={lineGeometry.from.y}
        y2={lineGeometry.to.y}
      />
      {arrowHead ? <polygon fill={color} points={arrowHead} /> : null}
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
    onSelectDrawing: (drawingId: string, event: MouseEvent<SVGElement>) => void;
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
    onSelectDrawing: (drawingId: string, event: MouseEvent<SVGElement>) => void;
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
  const lineCap = drawing.lineStyle === "dotted" ? "round" : "butt";
  const fillOpacity = clamp(drawing.fillOpacity ?? 0.16, 0, 0.6);
  const accentColor = drawing.color;
  const rewardColor = positionRewardColor(drawing);
  const riskColor = positionRiskColor(drawing);
  const entryPrice = drawing.points[0].price;
  const targetPrice = drawing.points[1].price;
  const stopPrice = drawing.points[2].price;
  const reward = Math.abs(targetPrice - entryPrice);
  const box = positionBoxGeometry(first, second, stop, width);
  const { boxRight, boxWidth, hitBottom, hitTop, left } = box;
  const targetTop = Math.min(first.y, second.y);
  const targetHeight = Math.abs(second.y - first.y);
  const stopTop = Math.min(first.y, stop.y);
  const stopHeight = Math.abs(stop.y - first.y);
  const risk = Math.abs(entryPrice - stopPrice);
  const ratio = risk === 0 ? 0 : reward / risk;
  const labelText = [
    compactDrawingLabel(drawing.label) ?? (isLong ? "Long position" : "Short position"),
    `RR ${ratio.toFixed(2)}`,
  ].join(" · ");
  const labelX = boxRight + 10;
  const labelY = clamp(hitTop, 10, Math.max(10, hitBottom - 32));

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
    options.onSelectDrawing(drawing.id, event);
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
        fill={colorWithOpacity(rewardColor, fillOpacity)}
        height={targetHeight}
        stroke={rewardColor}
        strokeDasharray={dash}
        strokeOpacity={isSelected ? 0.95 : 0.65}
        strokeWidth={strokeWidth}
        width={boxWidth}
        x={left}
        y={targetTop}
      />
      <rect
        fill={colorWithOpacity(riskColor, fillOpacity)}
        height={stopHeight}
        stroke={riskColor}
        strokeDasharray={dash}
        strokeOpacity={isSelected ? 0.95 : 0.65}
        strokeWidth={strokeWidth}
        width={boxWidth}
        x={left}
        y={stopTop}
      />
      <line
        stroke={accentColor}
        strokeDasharray={dash}
        strokeLinecap={lineCap}
        strokeOpacity={isSelected ? 1 : 0.88}
        strokeWidth={strokeWidth}
        x1={left}
        x2={boxRight}
        y1={first.y}
        y2={first.y}
      />
      <line
        stroke={rewardColor}
        strokeDasharray={dash}
        strokeLinecap={lineCap}
        strokeOpacity={isSelected ? 1 : 0.82}
        strokeWidth={strokeWidth}
        x1={left}
        x2={boxRight}
        y1={second.y}
        y2={second.y}
      />
      <line
        stroke={riskColor}
        strokeDasharray={dash}
        strokeLinecap={lineCap}
        strokeOpacity={isSelected ? 1 : 0.82}
        strokeWidth={strokeWidth}
        x1={left}
        x2={boxRight}
        y1={stop.y}
        y2={stop.y}
      />
      {renderPositionPriceTag({
        color: accentColor,
        id: `${drawing.id}-entry`,
        label: "Entry",
        plotWidth: width,
        price: entryPrice,
        x: left + 8,
        y: first.y,
      })}
      {renderPositionPriceTag({
        color: rewardColor,
        id: `${drawing.id}-target`,
        label: "TP",
        plotWidth: width,
        price: targetPrice,
        x: left + 8,
        y: second.y,
      })}
      {renderPositionPriceTag({
        color: riskColor,
        id: `${drawing.id}-stop`,
        label: "SL",
        plotWidth: width,
        price: stopPrice,
        x: left + 8,
        y: stop.y,
      })}
      {renderDrawingLabel({
        backgroundOpacity: drawing.labelBackgroundOpacity,
        color: accentColor,
        id: `${drawing.id}-label`,
        label: labelText,
        plotWidth: width,
        x: labelX,
        y: labelY,
      })}
      {isSelected && !isLocked && (
        <>
          {renderPositionCornerHandles(drawing, box, options)}
          {renderAnchors(drawing, [first, second, stop], options)}
        </>
      )}
    </g>
  );
}

function positionBoxGeometry(
  first: { x: number; y: number },
  second: { x: number; y: number },
  stop: { x: number; y: number },
  width: number,
) {
  const left = Math.min(first.x, second.x, stop.x);
  const right = Math.max(first.x, second.x, stop.x);
  const boxRight = clamp(Math.max(right, left + 72), left + 24, Math.max(left + 24, width - 4));
  const hitTop = Math.min(first.y, second.y, stop.y);
  const hitBottom = Math.max(first.y, second.y, stop.y);
  return {
    boxRight,
    boxWidth: Math.max(24, boxRight - left),
    hitBottom,
    hitTop,
    left,
  };
}

function renderPositionCornerHandles(
  drawing: ChartDrawing,
  box: ReturnType<typeof positionBoxGeometry>,
  options: {
    onDragStart: (
      drawing: ChartDrawing,
      mode: DragState["mode"],
      pointIndex: number | null,
      event: MouseEvent<SVGElement>,
    ) => void;
  },
) {
  const handles = [
    {
      cursor: "nwse-resize",
      id: POSITION_HANDLE.topLeft,
      x: box.left,
      y: box.hitTop,
    },
    {
      cursor: "nesw-resize",
      id: POSITION_HANDLE.topRight,
      x: box.boxRight,
      y: box.hitTop,
    },
    {
      cursor: "nesw-resize",
      id: POSITION_HANDLE.bottomLeft,
      x: box.left,
      y: box.hitBottom,
    },
    {
      cursor: "nwse-resize",
      id: POSITION_HANDLE.bottomRight,
      x: box.boxRight,
      y: box.hitBottom,
    },
  ];

  return (
    <g>
      {handles.map((handle) => (
        <g
          cursor={handle.cursor}
          key={`${drawing.id}-position-handle-${handle.id}`}
          onMouseDown={(event) =>
            options.onDragStart(drawing, "anchor", handle.id, event)
          }
          pointerEvents="all"
        >
          <rect
            fill="transparent"
            height={22}
            width={22}
            x={handle.x - 11}
            y={handle.y - 11}
          />
          <rect
            fill="#05070a"
            height={9}
            rx={2}
            stroke={drawing.color}
            strokeOpacity={0.95}
            strokeWidth={1.5}
            width={9}
            x={handle.x - 4.5}
            y={handle.y - 4.5}
          />
        </g>
      ))}
    </g>
  );
}

function renderPositionPriceTag({
  color,
  id,
  label,
  plotWidth,
  price,
  x,
  y,
}: {
  color: string;
  id: string;
  label: string;
  plotWidth: number;
  price: number;
  x: number;
  y: number;
}) {
  const text = `${label} ${formatPrice(price)}`;
  const labelWidth = clamp(Math.ceil(text.length * 6.7 + 18), 72, 156);
  const labelX = clamp(x, 6, Math.max(6, plotWidth - labelWidth - 6));
  const labelY = Math.max(4, y - 25);
  const squeeze = text.length * 6.7 > labelWidth - 18;

  return (
    <g key={id} pointerEvents="none">
      <rect
        fill="rgba(8, 12, 17, 0.9)"
        height={20}
        rx={4}
        stroke={color}
        strokeOpacity="0.46"
        width={labelWidth}
        x={labelX}
        y={labelY}
      />
      <text
        fill={color}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
        fontSize="10"
        fontWeight="800"
        lengthAdjust={squeeze ? "spacingAndGlyphs" : undefined}
        textLength={squeeze ? labelWidth - 14 : undefined}
        x={labelX + 7}
        y={labelY + 13}
      >
        {text}
      </text>
    </g>
  );
}

function toolbarPositionFromDrawing(
  drawing: ChartDrawing,
  frame: HTMLDivElement | null,
  chart: IChartApi | null,
  series: PrimaryChartSeries | null,
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

  const toolbarWidth = drawing.tool === "text" ? 380 : isRiskRewardTool(drawing.tool) ? 680 : 332;
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

  if (drawing.tool === "vertical") {
    return {
      x: clamp(minX - toolbarWidth / 2, 12, maxLeft),
      y: 12,
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
  return (
    tool === "horizontal" ||
    tool === "vertical" ||
    tool === "rectangle" ||
    tool === "ellipse" ||
    tool === "triangle" ||
    tool === "trendline" ||
    tool === "ray" ||
    tool === "extendedLine" ||
    tool === "segment" ||
    tool === "angle" ||
    tool === "horizontalRay" ||
    tool === "parallelChannel" ||
    tool === "arrow" ||
    tool === "callout" ||
    tool === "flag" ||
    tool === "icon" ||
    tool === "longPosition" ||
    tool === "shortPosition"
  );
}

function isFillableDrawingTool(
  tool: ChartDrawing["tool"] | DrawingTool,
): tool is FillableDrawingTool {
  return (
    tool === "rectangle" ||
    tool === "ellipse" ||
    tool === "triangle" ||
    tool === "callout" ||
    tool === "longPosition" ||
    tool === "shortPosition"
  );
}

function shouldAutoOpenDrawingToolbar(drawing: ChartDrawing) {
  return !isFibDrawingTool(drawing.tool);
}

function positionRewardColor(drawing: ChartDrawing) {
  return drawing.rewardColor?.trim() || POSITION_REWARD_COLOR;
}

function positionRiskColor(drawing: ChartDrawing) {
  return drawing.riskColor?.trim() || POSITION_RISK_COLOR;
}

function sanitizeDrawingPresets(value: unknown): DrawingPreset[] {
  try {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
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
          rewardColor:
            typeof candidate.rewardColor === "string"
              ? candidate.rewardColor
              : undefined,
          riskColor:
            typeof candidate.riskColor === "string"
              ? candidate.riskColor
              : undefined,
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

function sanitizeFibPresets(value: unknown): FibPreset[] {
  try {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
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
    fillOpacity: isFillableDrawingTool(tool) ? drawing.fillOpacity ?? 0.16 : undefined,
    label,
    labelBackgroundOpacity: drawing.labelBackgroundOpacity ?? DEFAULT_LABEL_BACKGROUND_OPACITY,
    lineStyle: drawing.lineStyle ?? "solid",
    lineWidth: drawing.lineWidth ?? 2,
    name,
    rewardColor: isRiskRewardTool(tool) ? positionRewardColor(drawing) : undefined,
    riskColor: isRiskRewardTool(tool) ? positionRiskColor(drawing) : undefined,
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
    case "vertical":
      return "Vertical";
    case "rectangle":
      return "Rectangle";
    case "trendline":
      return "Trendline";
    case "ray":
      return "Ray";
    case "extendedLine":
      return "Extended line";
    case "segment":
      return "Segment";
    case "angle":
      return "Angle";
    case "horizontalRay":
      return "Horizontal ray";
    case "parallelChannel":
      return "Parallel channel";
    case "ellipse":
      return "Ellipse";
    case "triangle":
      return "Triangle";
    case "arrow":
      return "Arrow";
    case "callout":
      return "Callout";
    case "flag":
      return "Flag";
    case "icon":
      return "Icon";
    case "longPosition":
      return "Long position";
    case "shortPosition":
      return "Short position";
  }
}

function pointFromClient(
  clientX: number,
  clientY: number,
  frame: HTMLDivElement | null,
  chart: IChartApi | null,
  series: PrimaryChartSeries | null,
  bars: Candle[] = [],
  magnetMode: MagnetMode = "off",
): DrawingPoint | null {
  const pixel = pixelFromClient(clientX, clientY, frame);
  if (!pixel) {
    return null;
  }
  const point = pointFromPixel(pixel.x, pixel.y, frame, chart, series, bars);
  if (!point || magnetMode === "off") {
    return point;
  }
  return resolveOhlcSnapPoint(point, pixel, chart, series, bars, magnetMode) ?? point;
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
  series: PrimaryChartSeries | null,
  bars: Candle[] = [],
): DrawingPoint | null {
  if (!chart || !series || !frame) {
    return null;
  }
  const plotWidth = chartPlotWidth(chart, frame);
  const plotHeight = chartPlotHeight(chart, frame);
  const clampedX = clamp(x, 0, Math.max(0, plotWidth - 1));
  const clampedY = clamp(y, 0, Math.max(0, plotHeight - 1));
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
  series: PrimaryChartSeries | null,
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

function priceScaleCoordinateFingerprint(
  series: PrimaryChartSeries | null,
  bars: Candle[],
) {
  const latest = bars.at(-1);
  if (!series || !latest || !Number.isFinite(latest.close)) {
    return null;
  }
  const basePrice = latest.close;
  let comparisonPrice = Number.isFinite(latest.high) ? latest.high : basePrice;
  if (Math.abs(comparisonPrice - basePrice) <= Number.EPSILON) {
    comparisonPrice = Number.isFinite(latest.low) ? latest.low : basePrice;
  }
  if (Math.abs(comparisonPrice - basePrice) <= Number.EPSILON) {
    comparisonPrice = basePrice + Math.max(Math.abs(basePrice) * 0.001, 0.00001);
  }
  const baseY = series.priceToCoordinate(basePrice);
  const comparisonY = series.priceToCoordinate(comparisonPrice);
  if (baseY == null || comparisonY == null) {
    return null;
  }
  return `${roundCoordinate(baseY)}:${roundCoordinate(comparisonY)}`;
}

function roundCoordinate(value: number) {
  return Math.round(value * 100) / 100;
}

function resolveOhlcSnapPoint(
  point: DrawingPoint,
  cursorPixel: { x: number; y: number },
  chart: IChartApi | null,
  series: PrimaryChartSeries | null,
  bars: Candle[],
  magnetMode: MagnetMode,
): DrawingPoint | null {
  if (magnetMode === "off" || !chart || !series || bars.length === 0) {
    return null;
  }

  const index = nearestBarIndexForPoint(point, bars);
  const bar = bars[index];
  if (!bar) {
    return null;
  }

  const logical = index;
  const x =
    chart.timeScale().logicalToCoordinate(logical as Logical) ??
    chart.timeScale().timeToCoordinate(bar.time as UTCTimestamp);
  if (x == null) {
    return null;
  }

  const candidates: OhlcSnapCandidate[] = [];
  for (const price of [bar.open, bar.high, bar.low, bar.close]) {
    const y = series.priceToCoordinate(price);
    if (y == null) {
      continue;
    }
    candidates.push({
      distance: Math.hypot(cursorPixel.x - x, cursorPixel.y - y),
      point: {
        logical,
        price,
        time: bar.time,
      },
    });
  }

  const best = candidates.sort((left, right) => left.distance - right.distance)[0];
  if (!best) {
    return null;
  }

  if (magnetMode === "weak" && best.distance > WEAK_MAGNET_THRESHOLD_PX) {
    return null;
  }

  return best.point;
}

function nearestBarIndexForPoint(point: DrawingPoint, bars: Candle[]) {
  if (Number.isFinite(point.logical)) {
    return clamp(Math.round(point.logical ?? 0), 0, bars.length - 1);
  }

  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  bars.forEach((bar, index) => {
    const distance = Math.abs(bar.time - point.time);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  return nearestIndex;
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
  series: PrimaryChartSeries | null,
  bars: Candle[] = [],
): ChartDrawing | null {
  if (dragState.mode === "anchor" && dragState.pointIndex != null) {
    if (dragState.drawing.tool === "rectangle" && dragState.pointIndex < 0) {
      return resizeRectangleAxisLocked(dragState, point);
    }
    if (
      isRiskRewardTool(dragState.drawing.tool) &&
      isPositionResizeHandle(dragState.pointIndex)
    ) {
      return resizePositionFromHandle(dragState, pixel, frame, chart, series, bars);
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
      if (dragState.drawing.tool === "vertical") {
        return {
          ...originalPoint,
          logical: point.logical,
          time: point.time,
        };
      }
      const priceDelta = point.price - dragState.startPoint.price;
      return {
        time: originalPoint.time,
        price: originalPoint.price + priceDelta,
      };
    }
    const moved = pointFromPixel(
      dragState.drawing.tool === "horizontal" ? originalPixel.x : originalPixel.x + xDelta,
      dragState.drawing.tool === "vertical" ? originalPixel.y : originalPixel.y + yDelta,
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

function isPositionResizeHandle(pointIndex: number) {
  return Object.values(POSITION_HANDLE).some((handle) => handle === pointIndex);
}

function resizePositionFromHandle(
  dragState: DragState,
  pixel: { x: number; y: number },
  frame: HTMLDivElement | null,
  chart: IChartApi | null,
  series: PrimaryChartSeries | null,
  bars: Candle[] = [],
): ChartDrawing {
  const originalPixels = dragState.originalPixels;
  if (originalPixels.length < 3 || originalPixels.some((item) => item == null)) {
    return dragState.drawing;
  }
  const pixels = originalPixels as Array<{ x: number; y: number }>;
  const minX = Math.min(...pixels.map((item) => item.x));
  const maxX = Math.max(...pixels.map((item) => item.x));
  const minY = Math.min(...pixels.map((item) => item.y));
  const maxY = Math.max(...pixels.map((item) => item.y));
  const handle = dragState.pointIndex;
  const isLeftHandle =
    handle === POSITION_HANDLE.topLeft || handle === POSITION_HANDLE.bottomLeft;
  const isRightHandle =
    handle === POSITION_HANDLE.topRight || handle === POSITION_HANDLE.bottomRight;
  const isTopHandle =
    handle === POSITION_HANDLE.topLeft || handle === POSITION_HANDLE.topRight;
  const isBottomHandle =
    handle === POSITION_HANDLE.bottomLeft || handle === POSITION_HANDLE.bottomRight;
  const horizontalEdge = isLeftHandle ? minX : isRightHandle ? maxX : null;
  const horizontalIndexes =
    horizontalEdge == null
      ? []
      : pixels
          .map((item, index) => (Math.abs(item.x - horizontalEdge) <= 2 ? index : -1))
          .filter((index) => index >= 0);
  const verticalIndex =
    isTopHandle
      ? pixels.findIndex((item) => Math.abs(item.y - minY) <= 2)
      : isBottomHandle
      ? pixels.findIndex((item) => Math.abs(item.y - maxY) <= 2)
      : -1;

  const points = dragState.originalPoints.map((originalPoint, index) => {
    const originalPixel = pixels[index];
    const nextX = horizontalIndexes.includes(index) ? pixel.x : originalPixel.x;
    const nextY = index === verticalIndex ? pixel.y : originalPixel.y;
    const nextPoint = pointFromPixel(nextX, nextY, frame, chart, series, bars);
    return nextPoint ?? originalPoint;
  });

  return normalizeDraggedDrawing({ ...dragState.drawing, points });
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
  marker?: string,
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
    fibExtendLeft: isFibDrawingTool(tool) ? false : undefined,
    fibExtendRight: isFibDrawingTool(tool) ? true : undefined,
    fibLevels:
      isFibDrawingTool(tool)
        ? [
            ...DEFAULT_FIB_LEVELS.map((level) => ({ ...level })),
            ...(tool === "fibExtension"
              ? [
                  { id: "fib-1-272", value: 1.272, color: "#38bdf8", label: "1.272", visible: true },
                  { id: "fib-1-618", value: 1.618, color: "#a78bfa", label: "1.618", visible: true },
                ]
              : []),
          ]
        : undefined,
    fillOpacity: isFillableDrawingTool(tool) ? 0.16 : undefined,
    labelBackgroundOpacity:
      tool === "text" || isLabelableDrawingTool(tool)
        ? DEFAULT_LABEL_BACKGROUND_OPACITY
        : undefined,
    lineStyle: "solid",
    lineWidth: tool === "horizontal" || tool === "vertical" ? 1.5 : 2,
    locked: false,
    points: normalizedPoints,
    rewardColor: isRiskRewardTool(tool) ? POSITION_REWARD_COLOR : undefined,
    riskColor: isRiskRewardTool(tool) ? POSITION_RISK_COLOR : undefined,
    label,
    marker,
    createdAt: new Date().toISOString(),
    visible: true,
  };
}

function drawingStrokeDasharray(drawing: ChartDrawing) {
  return lineStyleDasharray(drawing.lineStyle);
}

function defaultIndicatorLineStyle(
  kind: ChartIndicatorInstance["kind"],
  settings: IndicatorSettings,
): DrawingLineStyle {
  if (settings.lineStyle) {
    return settings.lineStyle;
  }
  if (kind === "vwap" || kind === "bb" || kind === "donchian" || kind === "supertrend") {
    return kind === "supertrend" ? "dotted" : "dashed";
  }
  if (kind === "fvg") {
    return "solid";
  }
  if (kind === "ifvg") {
    return "dashed";
  }
  return "solid";
}

function selectedIndicatorLineWidth(
  width: IndicatorDefinition["lineWidth"],
  selected: boolean,
): 1 | 2 | 3 | 4 {
  return lightweightIndicatorLineWidth((width ?? 2) + (selected ? 1 : 0));
}

function lightweightIndicatorLineWidth(width: number): 1 | 2 | 3 | 4 {
  const rounded = Math.round(width);
  if (rounded <= 1) {
    return 1;
  }
  if (rounded === 2) {
    return 2;
  }
  if (rounded === 3) {
    return 3;
  }
  return 4;
}

function defaultIndicatorLineWidth(
  kind: ChartIndicatorInstance["kind"],
  settings: IndicatorSettings,
) {
  const fallback =
    kind === "bb" ||
    kind === "donchian" ||
    kind === "fvg" ||
    kind === "ifvg" ||
    kind === "keltner"
      ? 1
      : 2;
  return indicatorPanelLineWidth(settings.lineWidth, fallback);
}

function indicatorPanelLineWidth(width: number | undefined, fallback: number) {
  if (typeof width !== "number" || !Number.isFinite(width)) {
    return fallback;
  }
  return clamp(Math.round(width), 1, 4);
}

function customStudiesFromResult(
  indicator: ChartIndicatorInstance,
  result: EdgeIndicatorExecutionResult,
): CustomRuntimeStudy[] {
  return result.plots.map((plot, index) => ({
    color: indicator.settings.color || plot.color,
    data: plot.points.map((point) => ({
      time: point.time as UTCTimestamp,
      value: point.value,
    })),
    error: null,
    id: `${indicator.id}-plot-${index}`,
    label: result.plots.length === 1 ? result.name : `${result.name} · ${plot.name}`,
    overlay: result.overlay,
    plotName: plot.name,
    sourceId: indicator.id,
  }));
}

function emptyCustomRuntimeStudy(
  indicator: ChartIndicatorInstance,
  error: string,
): CustomRuntimeStudy {
  return {
    color: indicator.settings.color,
    data: [],
    error,
    id: `${indicator.id}-runtime-error`,
    label: indicator.customScriptName ?? "EdgeLab Script",
    overlay: indicator.customOverlay ?? false,
    plotName: "Runtime error",
    sourceId: indicator.id,
  };
}

function isOverlayIndicatorKind(kind: ChartIndicatorInstance["kind"]) {
  return (
    kind === "bb" ||
    kind === "dema" ||
    kind === "donchian" ||
    kind === "ema" ||
    kind === "fvg" ||
    kind === "hma" ||
    kind === "ifvg" ||
    kind === "keltner" ||
    kind === "sma" ||
    kind === "supertrend" ||
    kind === "tema" ||
    kind === "vwap" ||
    kind === "wma"
  );
}

function isOrderFlowIndicatorInstance(
  indicator: ChartIndicatorInstance,
): indicator is ChartIndicatorInstance & {
  kind: "bar-delta" | "cumulative-delta" | "order-flow-imbalance";
} {
  return (
    indicator.kind === "bar-delta" ||
    indicator.kind === "cumulative-delta" ||
    indicator.kind === "order-flow-imbalance"
  );
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

function drawingPointDistance(left: DrawingPoint | undefined, right: DrawingPoint) {
  if (!left) return Number.POSITIVE_INFINITY;
  const horizontal = Math.abs((left.logical ?? left.time) - (right.logical ?? right.time));
  const priceScale = Math.max(1, Math.abs(left.price), Math.abs(right.price));
  return horizontal + (Math.abs(left.price - right.price) / priceScale) * 100;
}

function extendLineToBounds(
  from: { x: number; y: number },
  through: { x: number; y: number },
  width: number,
  height: number,
  bothDirections: boolean,
) {
  const dx = through.x - from.x;
  const dy = through.y - from.y;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return { from, to: through };
  const endpoint = (direction: 1 | -1) => {
    const candidates: number[] = [];
    if (Math.abs(dx) > 0.001) {
      candidates.push((0 - from.x) / dx, (width - from.x) / dx);
    }
    if (Math.abs(dy) > 0.001) {
      candidates.push((0 - from.y) / dy, (height - from.y) / dy);
    }
    const valid = candidates
      .filter((value) => value * direction > 0.0001)
      .map((value) => ({ value, x: from.x + dx * value, y: from.y + dy * value }))
      .filter((point) => point.x >= -0.5 && point.x <= width + 0.5 && point.y >= -0.5 && point.y <= height + 0.5)
      .sort((left, right) => Math.abs(left.value) - Math.abs(right.value));
    return valid[0] ? { x: valid[0].x, y: valid[0].y } : through;
  };
  return { from: bothDirections ? endpoint(-1) : from, to: endpoint(1) };
}

function arrowHeadPoints(
  from: { x: number; y: number },
  to: { x: number; y: number },
  size: number,
) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const left = { x: to.x - Math.cos(angle - Math.PI / 6) * size, y: to.y - Math.sin(angle - Math.PI / 6) * size };
  const right = { x: to.x - Math.cos(angle + Math.PI / 6) * size, y: to.y - Math.sin(angle + Math.PI / 6) * size };
  return `${to.x},${to.y} ${left.x},${left.y} ${right.x},${right.y}`;
}

function screenAngleDegrees(
  start: { x: number; y: number },
  pivot: { x: number; y: number },
  end: { x: number; y: number },
) {
  const left = Math.atan2(start.y - pivot.y, start.x - pivot.x);
  const right = Math.atan2(end.y - pivot.y, end.x - pivot.x);
  const delta = Math.abs((right - left) * 180 / Math.PI) % 360;
  return delta > 180 ? 360 - delta : delta;
}

function resolveCandleAtTime(
  value: Time | number | null | undefined,
  barsByTime: ReadonlyMap<number, Candle>,
): Candle | null {
  if (value == null) {
    return null;
  }
  const time = Number(value);
  return barsByTime.get(time) ?? null;
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
    case "ray":
      return "a ray";
    case "extendedLine":
      return "an extended line";
    case "segment":
      return "a line segment";
    case "angle":
      return "an angle";
    case "horizontalRay":
      return "a horizontal ray";
    case "parallelChannel":
      return "a parallel channel";
    case "horizontal":
      return "a horizontal level";
    case "vertical":
      return "a vertical level";
    case "rectangle":
      return "a zone";
    case "ellipse":
      return "an ellipse";
    case "triangle":
      return "a triangle";
    case "fib":
      return "fib anchors";
    case "fibExtension":
    case "fibChannel":
    case "fibTime":
    case "fibFan":
      return "Fibonacci anchors";
    case "chartPattern":
      return "a chart pattern";
    case "elliottWave":
      return "an Elliott wave";
    case "harmonicPattern":
      return "a harmonic pattern";
    case "brush":
      return "a freehand path";
    case "arrow":
      return "an arrow";
    case "longPosition":
      return "long position anchors";
    case "measure":
    case "quickMeasure":
      return "measurement anchors";
    case "shortPosition":
      return "short position anchors";
    case "text":
      return "a text label";
    case "callout":
      return "a callout";
    case "flag":
      return "a flag marker";
    case "icon":
      return "an icon marker";
    case "eraser":
      return "the eraser";
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
    case "footprint":
      return "Footprint";
    case "line":
      return "Line";
    case "tpo":
      return "TPO Profile";
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

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    currency,
    maximumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function formatRr(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return "RR -";
  }
  return `RR ${value.toFixed(2)}`;
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
