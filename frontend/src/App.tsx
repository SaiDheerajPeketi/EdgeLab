import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { SetStateAction } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ClipboardCheck,
  Clock3,
  Database,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PencilRuler,
  Radio,
  Settings2,
  LineChart,
  ScrollText,
  WalletCards,
} from "lucide-react";
import { ExecutionTape } from "./components/ExecutionTape";
import { FilteredTradeReview } from "./components/FilteredTradeReview";
import { JournalEntryModal } from "./components/JournalEntryModal";
import { OrderTicket } from "./components/OrderTicket";
import { PendingOrders } from "./components/PendingOrders";
import { PlaybookBoard } from "./components/PlaybookBoard";
import { PositionPanel } from "./components/PositionPanel";
import { ReplayController } from "./components/ReplayController";
import type {
  ResultsPanelView,
  ResultsTradeOutcomeFilter,
  ResultsTradeScroll,
} from "./components/ResultsPanel";
import { Sidebar } from "./components/Sidebar";
import { SessionGateway } from "./components/SessionGateway";
import { TradeDetailDrawer } from "./components/TradeDetailDrawer";
import {
  getApiWebSocketUrl,
  type BacktestCreatePayload,
  type BacktestSessionUpdatePayload,
  type DatasetCatalog,
  type Trade,
} from "./lib/api";
import type {
  ChartDrawing,
  ChartIndicatorId,
  ChartIndicatorInstance,
  ChartIndicatorKind,
  ChartStyle,
  ChartTimeframe,
  DrawingTool,
  IndicatorSettings,
  MagnetMode,
} from "./lib/charting";
import {
  canAggregateTimeframe,
  createIndicatorInstance,
  createLegacyIndicatorInstance,
  formatChartTimeframeLabel,
  getTimeframeSeconds,
  isIndicatorKind,
  mergeIndicatorSettings,
  nextIndicatorInstanceColor,
  normalizeChartTimeframe,
  normalizeFibLevels,
  TIMEFRAMES,
} from "./lib/charting";
import {
  DEFAULT_CHART_PANE_LAYOUT,
  chartPaneLayoutById,
  sanitizeChartPaneLayout,
  type ChartPaneLayoutId,
} from "./lib/chartLayouts";
import {
  DEFAULT_CHART_VISUAL_SETTINGS,
  hydrateChartSettingsPresets,
  loadActiveChartSettingsPreset,
  loadActiveChartSettingsPresetName,
  sanitizeChartVisualSettings,
  type ChartVisualSettings,
} from "./lib/chartSettings";
import {
  hydrateOrderLineModificationConfirmation,
  loadOrderLineModificationConfirmation,
  subscribeOrderLineModificationConfirmation,
} from "./lib/backtestSettings";
import { currencyForSession } from "./lib/currency";
import {
  getCachedAppStorageItem,
  loadAppStorageItem,
  saveAppStorageItem,
  subscribeAppStorageItem,
} from "./lib/serverStorage";
import { formatMarketSymbol } from "./lib/symbols";
import { tradeStrategyName } from "./lib/strategy";
import type { WorkspaceView } from "./lib/workspace";
import { useBacktestStore } from "./store/backtestStore";
import { shallow } from "zustand/shallow";

const CHART_LAYOUT_STORAGE_KEY = "chart-layout.v1";
const CHART_LAYOUTS_STORAGE_KEY = "chart-layouts.v1";
const ACTIVE_CHART_LAYOUT_STORAGE_KEY = "active-chart-layout.v1";
const DRAWING_UNDO_LIMIT = 50;
const DRAWING_UNDO_COALESCE_MS = 350;
const TIMEFRAME_SHORTCUT_CLEAR_MS = 1200;
const CHART_SETTINGS_DEFAULTS_VERSION = 2;
const TRADE_REPLAY_CONTEXT_BARS = 30;
const STALE_SINGLE_HORIZONTAL_PURGE_KEY =
  "edgelab.chart-layout-cleared-single-horizontal.v1";
const EdgeLabWorkspace = lazy(() =>
  import("./components/EdgeLabWorkspace").then((module) => ({
    default: module.EdgeLabWorkspace,
  })),
);
const ChartObjectsPanel = lazy(() =>
  import("./components/ChartObjectsPanel").then((module) => ({
    default: module.ChartObjectsPanel,
  })),
);
const ChartToolbar = lazy(() =>
  import("./components/ChartToolbar").then((module) => ({
    default: module.ChartToolbar,
  })),
);
const ResultsPanel = lazy(() =>
  import("./components/ResultsPanel").then((module) => ({
    default: module.ResultsPanel,
  })),
);
const TradingChart = lazy(() =>
  import("./components/TradingChart").then((module) => ({
    default: module.TradingChart,
  })),
);

function WorkspaceLoadingPanel() {
  return (
    <div className="grid gap-3">
      <div className="h-12 animate-pulse rounded-md border border-white/10 bg-white/[0.04]" />
      <div className="grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="h-[calc(100vh-8rem)] animate-pulse rounded-md border border-white/10 bg-white/[0.04]" />
        <div className="h-[calc(100vh-8rem)] animate-pulse rounded-md border border-white/10 bg-white/[0.04]" />
      </div>
    </div>
  );
}

function BacktestLoadingPanel() {
  return (
    <div className="mb-4 grid gap-2 rounded-md border border-cyan-300/20 bg-cyan-300/10 p-3">
      <div className="h-3 w-32 animate-pulse rounded bg-cyan-100/30" />
      <div className="h-2 w-full max-w-md animate-pulse rounded bg-cyan-100/15" />
      <div className="h-2 w-2/3 max-w-sm animate-pulse rounded bg-cyan-100/10" />
    </div>
  );
}

function LazyPanelFallback({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-md border border-white/10 bg-white/[0.03] p-3 ${className}`}>
      <div className="h-3 w-32 animate-pulse rounded bg-white/15" />
      <div className="mt-3 h-2 w-full max-w-md animate-pulse rounded bg-white/10" />
    </div>
  );
}

function ChartChunkFallback() {
  return (
    <div className="chart-studio-layout chart-studio-layout-focus">
      <div className="min-h-[520px] rounded-md border border-white/10 bg-white/[0.03]" />
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="min-h-screen bg-[#05070a] p-6 text-slate-100">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-3xl flex-col justify-center">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md border border-amber-300/25 bg-amber-300/10 text-amber-100">
          <AlertTriangle size={20} />
        </div>
        <h1 className="text-2xl font-bold text-white">Page not found</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">
          This workspace does not have a route for the requested URL.
        </p>
        <a className="mt-5 inline-flex h-10 w-fit items-center rounded-md bg-cyan-300 px-4 text-sm font-bold text-slate-950" href="/">
          Open workspace
        </a>
      </div>
    </div>
  );
}

type NeutralDrawingTool = Extract<DrawingTool, "cursor" | "crosshair">;
type TimeframeShortcutFeedback = {
  description: string;
  status: "ready" | "unavailable" | "invalid";
  timeframe?: ChartTimeframe;
  value: string;
};
type ReplayTimeframeOption = {
  label: string;
  sublabel?: string;
  value: ChartTimeframe;
};
type NotebookReturnTarget = WorkspaceView | "backtestReview" | "backtestResults" | null;
type ChartPaneState = {
  chartSettings: ChartVisualSettings;
  chartStyle: ChartStyle;
  drawingTool: DrawingTool;
  drawings: ChartDrawing[];
  id: string;
  indicatorInstances: ChartIndicatorInstance[];
  magnetMode: MagnetMode;
  showOrderOverlays: boolean;
  smoothCandles: boolean;
  timeframe: ChartTimeframe;
};
const VALID_LEGACY_INDICATORS: ChartIndicatorId[] = [
  "atr14",
  "bb20",
  "dema20",
  "donchian20",
  "ema20",
  "ema50",
  "hma20",
  "keltner20",
  "macd",
  "momentum10",
  "rsi14",
  "sma200",
  "supertrend10",
  "tema20",
  "vwap",
  "wma20",
];
const VALID_CHART_STYLES: ChartStyle[] = ["area", "candles", "heikinAshi", "line"];

export default function App() {
  const isUnknownPath =
    typeof window !== "undefined" &&
    !["/", "/index.html"].includes(window.location.pathname);

  if (isUnknownPath) {
    return <NotFoundPage />;
  }

  return <WorkspaceApp />;
}

function WorkspaceApp() {
  const {
    bars,
    datasets,
    meta,
    state,
    replaySeekVersion,
    playbooks,
    resultSessions,
    resultTrades,
    error,
    isLoading,
    isPlaying,
    speedMs,
    createPlaybook,
    updatePlaybook,
    deletePlaybook,
    loadSession,
    loadInitial,
    newSession,
    updateSession,
    deleteSession,
    refreshDatasets,
    applyDatasetCatalog,
    refreshDatasetStatus,
    updateDatasetAsset,
    updateDatasetSettings,
    jumpToOffset,
    amendOrder,
    placeOrder,
    setPlaying,
    stepForward,
    updatePosition,
  } = useBacktestStore(
    (store) => ({
      bars: store.bars,
      datasets: store.datasets,
      meta: store.meta,
      state: store.state,
      replaySeekVersion: store.replaySeekVersion,
      playbooks: store.playbooks,
      resultSessions: store.resultSessions,
      resultTrades: store.resultTrades,
      error: store.error,
      isLoading: store.isLoading,
      isPlaying: store.isPlaying,
      speedMs: store.speedMs,
      createPlaybook: store.createPlaybook,
      updatePlaybook: store.updatePlaybook,
      deletePlaybook: store.deletePlaybook,
      loadSession: store.loadSession,
      loadInitial: store.loadInitial,
      newSession: store.newSession,
      updateSession: store.updateSession,
      deleteSession: store.deleteSession,
      refreshDatasets: store.refreshDatasets,
      applyDatasetCatalog: store.applyDatasetCatalog,
      refreshDatasetStatus: store.refreshDatasetStatus,
      updateDatasetAsset: store.updateDatasetAsset,
      updateDatasetSettings: store.updateDatasetSettings,
      jumpToOffset: store.jumpToOffset,
      amendOrder: store.amendOrder,
      placeOrder: store.placeOrder,
      setPlaying: store.setPlaying,
      stepForward: store.stepForward,
      updatePosition: store.updatePosition,
    }),
    shallow,
  );
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const [reviewTrade, setReviewTrade] = useState<Trade | null>(null);
  const [notebookFocusTradeId, setNotebookFocusTradeId] = useState<number | null>(null);
  const [notebookReturnTarget, setNotebookReturnTarget] = useState<NotebookReturnTarget>(null);
  const [resultsPanelView, setResultsPanelView] = useState<ResultsPanelView>("overview");
  const [resultsPanelSearch, setResultsPanelSearch] = useState("");
  const [resultsPanelFilter, setResultsPanelFilter] = useState<ResultsTradeOutcomeFilter>("ALL");
  const [replayFocusTrade, setReplayFocusTrade] = useState<Trade | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceView>("sessions");
  const sidebarCollapsed = true;
  const [sessionGateOpen, setSessionGateOpen] = useState(true);
  const [leftPaneOpen, setLeftPaneOpen] = useState(false);
  const [orderTicketSide, setOrderTicketSide] = useState<"BUY" | "SELL" | null>(null);
  const [chartToolsOpen, setChartToolsOpen] = useState(false);
  const [chartSettingsPanelOpen, setChartSettingsPanelOpen] = useState(false);
  const [chartSettingsOpenSignal, setChartSettingsOpenSignal] = useState(0);
  const [layersPanelOpen, setLayersPanelOpen] = useState(false);
  const [workspacePanel, setWorkspacePanel] = useState<"none" | "tape" | "review" | "results">("none");
  const [isChartFullscreen, setIsChartFullscreen] = useState(false);
  const [fullscreenOrderPanelOpen, setFullscreenOrderPanelOpen] = useState(false);
  const [backtestHeaderVisible, setBacktestHeaderVisible] = useState(true);
  const [replayOverlayOpen, setReplayOverlayOpen] = useState(false);
  const [timeframeShortcutFeedback, setTimeframeShortcutFeedback] =
    useState<TimeframeShortcutFeedback | null>(null);
  const [confirmOrderLineModifications, setConfirmOrderLineModifications] =
    useState(loadOrderLineModificationConfirmation);
  const backtestHeaderRef = useRef<HTMLElement | null>(null);
  const backtestHeaderActionsRef = useRef<HTMLDivElement | null>(null);
  const backtestPanelScrollRef = useRef(0);
  const pendingBacktestPanelScrollRestoreRef = useRef<number | null>(null);
  const resultsPanelTradeScrollRef = useRef<ResultsTradeScroll>({ left: 0, top: 0 });
  const pendingResultsPanelTradeScrollRestoreRef = useRef<ResultsTradeScroll | null>(null);
  const pendingNotebookScrollResetRef = useRef(false);
  const chartShellRef = useRef<HTMLDivElement | null>(null);
  const skipNextToolsClickRef = useRef(false);
  const [chartLayoutSavedAt, setChartLayoutSavedAt] = useState<number | null>(null);
  const [layoutName, setLayoutName] = useState(() => loadActiveLayoutName());
  const [availableLayouts, setAvailableLayouts] = useState(() => loadSavedLayoutNames());
  const sourceTimeframe = toChartTimeframe(state?.session.timeframe);
  const [chartPaneLayout, setChartPaneLayout] = useState<ChartPaneLayoutId>(() =>
    sanitizeChartPaneLayout(loadChartLayout()?.paneLayout),
  );
  const [chartPanes, setChartPanes] = useState<ChartPaneState[]>(() =>
    loadInitialChartPanes(),
  );
  const [activeChartPaneId, setActiveChartPaneId] = useState(() => "chart-pane-1");
  const activeChartPaneIndex = Math.max(
    0,
    chartPanes.findIndex((pane) => pane.id === activeChartPaneId),
  );
  const activeChartPane = chartPanes[activeChartPaneIndex] ?? chartPanes[0] ?? createDefaultChartPane(0);
  const activeChartPaneCount = chartPaneLayoutById(chartPaneLayout).panes;
  const visibleChartPanes = chartPanes.slice(0, activeChartPaneCount);
  const isMultiChartLayout = visibleChartPanes.length > 1;
  const chartPaneLayoutDefinition = chartPaneLayoutById(chartPaneLayout);
  const activeChartPaneLabel = `Pane ${activeChartPaneIndex + 1}`;
  const timeframe = activeChartPane.timeframe;
  const chartStyle = activeChartPane.chartStyle;
  const chartSettings = activeChartPane.chartSettings;
  const indicatorInstances = activeChartPane.indicatorInstances;
  const drawingTool = activeChartPane.drawingTool;
  const lastNeutralDrawingToolRef = useRef<NeutralDrawingTool>("crosshair");
  const magnetMode = activeChartPane.magnetMode;
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const drawings = activeChartPane.drawings;
  const drawingsRef = useRef<ChartDrawing[]>(drawings);
  const drawingUndoStackRef = useRef<ChartDrawing[][]>([]);
  const drawingUndoBatchOpenRef = useRef(false);
  const drawingUndoBatchTimerRef = useRef<number | null>(null);
  const drawingPersistTimerRef = useRef<number | null>(null);
  const timeframeShortcutBufferRef = useRef("");
  const timeframeShortcutTimerRef = useRef<number | null>(null);
  const [drawingUndoDepth, setDrawingUndoDepth] = useState(0);
  const undoShortcutLabel = systemUndoShortcutLabel();
  const showOrderOverlays = activeChartPane.showOrderOverlays;
  const smoothCandles = activeChartPane.smoothCandles;
  const replayTimeframeOptions = useMemo(
    () => buildReplayTimeframeOptions(visibleChartPanes, sourceTimeframe),
    [sourceTimeframe, visibleChartPanes],
  );
  const [replayTimeframe, setReplayTimeframe] = useState<ChartTimeframe>(() =>
    loadInitialReplayTimeframe(),
  );
  const normalizedReplayTimeframe =
    replayTimeframeOptions.find((option) => option.value === replayTimeframe)?.value ??
    replayTimeframeOptions[0]?.value ??
    effectiveSourceFallbackTimeframe(sourceTimeframe);
  const replayStepBars = getReplayStepBars(normalizedReplayTimeframe, sourceTimeframe);
  const playbackStepBars = isMultiChartLayout ? replayStepBars : 1;

  function updateChartPane(
    paneId: string,
    updater: (pane: ChartPaneState) => ChartPaneState,
  ) {
    setChartPanes((current) =>
      current.map((pane) => (pane.id === paneId ? updater(pane) : pane)),
    );
  }

  function updateActiveChartPane(updater: (pane: ChartPaneState) => ChartPaneState) {
    updateChartPane(activeChartPane.id, updater);
  }

  function setPaneField<K extends keyof ChartPaneState>(
    key: K,
    action: SetStateAction<ChartPaneState[K]>,
  ) {
    updateActiveChartPane((pane) => ({
      ...pane,
      [key]: resolveStateAction(action, pane[key]),
    }));
  }

  function setTimeframe(action: SetStateAction<ChartTimeframe>) {
    setPaneField("timeframe", action);
  }

  function setChartStyle(action: SetStateAction<ChartStyle>) {
    setPaneField("chartStyle", action);
  }

  function applyChartSettingsToCurrentScope(
    action: SetStateAction<ChartVisualSettings>,
  ) {
    const resolveSettings = (previous: ChartVisualSettings) =>
      sanitizeChartVisualSettings(resolveStateAction(action, previous));
    if (isMultiChartLayout) {
      updateActiveChartPane((pane) => ({
        ...pane,
        chartSettings: resolveSettings(pane.chartSettings),
      }));
      return;
    }
    updateChartPane(activeChartPane.id, (pane) => ({
      ...pane,
      chartSettings: resolveSettings(pane.chartSettings),
    }));
  }

  function setIndicatorInstances(action: SetStateAction<ChartIndicatorInstance[]>) {
    setPaneField("indicatorInstances", action);
  }

  function setDrawingTool(action: SetStateAction<DrawingTool>) {
    setPaneField("drawingTool", action);
  }

  function setMagnetMode(action: SetStateAction<MagnetMode>) {
    setPaneField("magnetMode", action);
  }

  function setDrawings(action: SetStateAction<ChartDrawing[]>) {
    setPaneField("drawings", action);
  }

  function setShowOrderOverlays(action: SetStateAction<boolean>) {
    setPaneField("showOrderOverlays", action);
  }

  function setSmoothCandles(action: SetStateAction<boolean>) {
    setPaneField("smoothCandles", action);
  }

  function changeDrawingTool(tool: DrawingTool) {
    if (tool === "cursor" || tool === "crosshair") {
      lastNeutralDrawingToolRef.current = tool;
    }
    setDrawingTool(tool);
  }

  function changeDrawingToolForPane(paneId: string, tool: DrawingTool) {
    if (tool === "cursor" || tool === "crosshair") {
      lastNeutralDrawingToolRef.current = tool;
    }
    updateChartPane(paneId, (pane) => ({ ...pane, drawingTool: tool }));
  }

  function changeMagnetModeForPane(paneId: string, mode: MagnetMode) {
    updateChartPane(paneId, (pane) => ({ ...pane, magnetMode: mode }));
  }

  function returnToNeutralDrawingTool() {
    setDrawingTool(lastNeutralDrawingToolRef.current);
  }
  const effectiveTimeframe = coerceTimeframeToSource(timeframe, sourceTimeframe);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let stopped = false;

    const connect = () => {
      if (stopped) {
        return;
      }
      socket = new WebSocket(getApiWebSocketUrl("/datasets/stream"));
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string) as {
            catalog?: DatasetCatalog;
            type?: string;
          };
          if (message.type === "catalog" && message.catalog) {
            applyDatasetCatalog(message.catalog);
          }
        } catch {
          // Ignore malformed stream messages and wait for the next catalog update.
        }
      };
      socket.onerror = () => {
        socket?.close();
      };
      socket.onclose = () => {
        if (!stopped) {
          reconnectTimer = window.setTimeout(connect, 5_000);
        }
      };
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer != null) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, [applyDatasetCatalog]);

  useEffect(() => {
    drawingsRef.current = drawings;
  }, [drawings]);

  useEffect(() => {
    return () => {
      if (drawingUndoBatchTimerRef.current != null) {
        window.clearTimeout(drawingUndoBatchTimerRef.current);
      }
      if (drawingPersistTimerRef.current != null) {
        window.clearTimeout(drawingPersistTimerRef.current);
      }
      if (timeframeShortcutTimerRef.current != null) {
        window.clearTimeout(timeframeShortcutTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let active = true;
    void hydrateOrderLineModificationConfirmation().then((enabled) => {
      if (active) {
        setConfirmOrderLineModifications(enabled);
      }
    });
    const unsubscribe = subscribeOrderLineModificationConfirmation((enabled) => {
      setConfirmOrderLineModifications(enabled);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    void hydrateChartPersistence().then(() => {
      if (!active) {
        return;
      }
      const saved = loadChartLayout();
      if (saved) {
        applyChartLayout(saved);
      }
      setLayoutName(loadActiveLayoutName());
      setAvailableLayouts(loadSavedLayoutNames());
      const activeSettingsPreset = loadActiveChartSettingsPreset();
      if (activeSettingsPreset) {
        applyChartSettingsToCurrentScope(activeSettingsPreset.settings);
      }
    });
    const unsubscribeLayouts = subscribeAppStorageItem<unknown>(
      CHART_LAYOUTS_STORAGE_KEY,
      () => {
        setAvailableLayouts(loadSavedLayoutNames());
      },
    );
    const unsubscribeActiveLayout = subscribeAppStorageItem<unknown>(
      ACTIVE_CHART_LAYOUT_STORAGE_KEY,
      () => {
        setLayoutName(loadActiveLayoutName());
      },
    );
    return () => {
      active = false;
      unsubscribeLayouts();
      unsubscribeActiveLayout();
    };
  }, []);

  useEffect(() => {
    if (sourceTimeframe) {
      setChartPanes((current) =>
        current.map((pane, index) => ({
          ...pane,
          timeframe:
            index === 0
              ? sourceTimeframe
              : coerceTimeframeToSource(pane.timeframe, sourceTimeframe),
        })),
      );
      setReplayTimeframe(sourceTimeframe);
    }
  }, [state?.session.id, sourceTimeframe]);

  useEffect(() => {
    let active = true;
    void hydrateChartSettingsPresets().then((presets) => {
      if (!active) {
        return;
      }
      const activeName = loadActiveChartSettingsPresetName(presets);
      const activeSettingsPreset = activeName
        ? presets.find((preset) => preset.name === activeName) ?? null
        : null;
      if (activeSettingsPreset) {
        applyChartSettingsToCurrentScope(activeSettingsPreset.settings);
      }
    });
    return () => {
      active = false;
    };
  }, [state?.session.id]);

  useEffect(() => {
    if (timeframe !== effectiveTimeframe) {
      setTimeframe(effectiveTimeframe);
    }
  }, [effectiveTimeframe, timeframe]);

  useEffect(() => {
    const layout = chartPaneLayoutById(chartPaneLayout);
    if (chartPanes.some((pane) => pane.id === activeChartPaneId) && activeChartPaneIndex < layout.panes) {
      return;
    }
    setActiveChartPaneId(chartPanes[0]?.id ?? "chart-pane-1");
    setSelectedDrawingId(null);
    resetDrawingUndoHistory();
  }, [activeChartPaneId, activeChartPaneIndex, chartPaneLayout, chartPanes]);

  useEffect(() => {
    if (replayTimeframeOptions.some((option) => option.value === replayTimeframe)) {
      return;
    }
    setReplayTimeframe(
      replayTimeframeOptions[0]?.value ?? effectiveSourceFallbackTimeframe(sourceTimeframe),
    );
  }, [replayTimeframe, replayTimeframeOptions, sourceTimeframe]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }
    const timer = window.setInterval(() => {
      void stepForward(playbackStepBars);
    }, speedMs);
    return () => window.clearInterval(timer);
  }, [isPlaying, playbackStepBars, speedMs, stepForward]);

  useEffect(() => {
    function handleHeaderControlPointerDown(event: PointerEvent) {
      if (!document.querySelector(".chart-settings-popover")) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      const hitElements =
        typeof document.elementsFromPoint === "function"
          ? document.elementsFromPoint(event.clientX, event.clientY)
          : [];
      const toolsButton = document.querySelector(
        '[data-chart-header-control="tools"]',
      );
      const toolsRect = toolsButton?.getBoundingClientRect();
      const hitsToolsRect = toolsRect
        ? event.clientX >= toolsRect.left &&
          event.clientX <= toolsRect.right &&
          event.clientY >= toolsRect.top &&
          event.clientY <= toolsRect.bottom
        : false;
      const hitsTools =
        target?.closest('[data-chart-header-control="tools"]') ||
        hitsToolsRect ||
        hitElements.some((element) =>
          element.closest('[data-chart-header-control="tools"]'),
        );

      if (!hitsTools) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      skipNextToolsClickRef.current = true;
      if (toolsButton instanceof HTMLElement) {
        toolsButton.focus({ preventScroll: true });
      }
      setChartSettingsPanelOpen(false);
      setChartToolsOpen(true);
    }

    document.addEventListener("pointerdown", handleHeaderControlPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", handleHeaderControlPointerDown, true);
  }, []);

  useEffect(() => {
    function clearTimeframeShortcutBuffer() {
      timeframeShortcutBufferRef.current = "";
      if (timeframeShortcutTimerRef.current != null) {
        window.clearTimeout(timeframeShortcutTimerRef.current);
        timeframeShortcutTimerRef.current = null;
      }
      setTimeframeShortcutFeedback(null);
    }

    function scheduleTimeframeShortcutClear() {
      if (timeframeShortcutTimerRef.current != null) {
        window.clearTimeout(timeframeShortcutTimerRef.current);
      }
      timeframeShortcutTimerRef.current = window.setTimeout(() => {
        timeframeShortcutBufferRef.current = "";
        timeframeShortcutTimerRef.current = null;
        setTimeframeShortcutFeedback(null);
      }, TIMEFRAME_SHORTCUT_CLEAR_MS);
    }

    function showTimeframeShortcutFeedback(rawValue: string) {
      setTimeframeShortcutFeedback(
        buildTimeframeShortcutFeedback(rawValue, sourceTimeframe),
      );
      scheduleTimeframeShortcutClear();
    }

    function commitTimeframeShortcut(rawValue: string) {
      const feedback = buildTimeframeShortcutFeedback(rawValue, sourceTimeframe);
      if (feedback.status === "ready" && feedback.timeframe) {
        clearTimeframeShortcutBuffer();
        setTimeframe(coerceTimeframeToSource(feedback.timeframe, sourceTimeframe));
        return;
      }
      timeframeShortcutBufferRef.current = "";
      setTimeframeShortcutFeedback(feedback);
      scheduleTimeframeShortcutClear();
    }

    function handleTimeframeShortcut(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        clearTimeframeShortcutBuffer();
        return false;
      }
      if (event.key.length !== 1) {
        if (timeframeShortcutBufferRef.current && event.key !== "Shift") {
          const bufferedValue = timeframeShortcutBufferRef.current;
          timeframeShortcutBufferRef.current = "";
          if (event.key === "Enter") {
            commitTimeframeShortcut(bufferedValue);
            event.preventDefault();
            return true;
          }
          if (["Backspace", "Delete", "Escape"].includes(event.key)) {
            clearTimeframeShortcutBuffer();
            event.preventDefault();
            return true;
          }
          clearTimeframeShortcutBuffer();
        }
        return false;
      }

      if (/^\d$/.test(event.key)) {
        const currentBuffer = timeframeShortcutBufferRef.current;
        timeframeShortcutBufferRef.current = `${currentBuffer}${event.key}`.slice(0, 5);
        showTimeframeShortcutFeedback(timeframeShortcutBufferRef.current);
        event.preventDefault();
        return true;
      }

      if (!timeframeShortcutBufferRef.current) {
        return false;
      }

      if (/^[mMhHdDwW]$/.test(event.key)) {
        const rawValue = `${timeframeShortcutBufferRef.current}${event.key}`;
        timeframeShortcutBufferRef.current = "";
        commitTimeframeShortcut(rawValue);
        event.preventDefault();
        return true;
      }

      const invalidValue = `${timeframeShortcutBufferRef.current}${event.key}`;
      timeframeShortcutBufferRef.current = "";
      showTimeframeShortcutFeedback(invalidValue);
      event.preventDefault();
      return true;
    }

    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if (isTyping) {
        return;
      }

      if (isSystemUndoShortcut(event)) {
        event.preventDefault();
        undoLastDrawingChange();
        return;
      }

      if (handleTimeframeShortcut(event)) {
        return;
      }

      switch (event.key) {
        case "ArrowRight":
          event.preventDefault();
          void stepForward(playbackStepBars);
          break;
        case "ArrowLeft":
          event.preventDefault();
          if (state) {
            void jumpToOffset(
              Math.max(
                state.session.start_offset,
                state.session.current_offset - playbackStepBars,
              ),
            );
          }
          break;
        case " ":
          event.preventDefault();
          setPlaying(!isPlaying);
          break;
        case "b":
        case "B":
          setOrderTicketSide("BUY");
          if (isChartFullscreen) {
            setFullscreenOrderPanelOpen(true);
          } else {
            setLeftPaneOpen(true);
          }
          break;
        case "s":
        case "S":
          setOrderTicketSide("SELL");
          if (isChartFullscreen) {
            setFullscreenOrderPanelOpen(true);
          } else {
            setLeftPaneOpen(true);
          }
          break;
        case "h":
        case "H":
          changeDrawingTool("horizontal");
          break;
        case "v":
        case "V":
          changeDrawingTool("vertical");
          break;
        case "t":
        case "T":
          changeDrawingTool("trendline");
          break;
        case "r":
        case "R":
          changeDrawingTool("rectangle");
          break;
        case "f":
        case "F":
          changeDrawingTool("fib");
          break;
        case "l":
        case "L":
          changeDrawingTool("text");
          break;
        case "m":
        case "M":
          changeDrawingTool("measure");
          break;
        case "Escape":
          event.preventDefault();
          if (drawingTool !== "cursor" && drawingTool !== "crosshair") {
            returnToNeutralDrawingTool();
            setSelectedDrawingId(null);
            break;
          }
          if (isChartFullscreen) {
            exitChartFullscreen();
          }
          break;
        case "Delete":
        case "Backspace":
          event.preventDefault();
          if (selectedDrawingId) {
            deleteDrawing(selectedDrawingId);
          } else {
            removeLastUnlockedDrawing();
          }
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [drawingTool, isChartFullscreen, isPlaying, jumpToOffset, playbackStepBars, removeLastUnlockedDrawing, selectedDrawingId, setPlaying, sourceTimeframe, state, stepForward, undoLastDrawingChange]);

  useEffect(() => {
    function syncNativeFullscreen() {
      if (document.fullscreenElement === chartShellRef.current) {
        setIsChartFullscreen(true);
        return;
      }
      if (!document.fullscreenElement) {
        setIsChartFullscreen(false);
        setFullscreenOrderPanelOpen(false);
      }
    }

    document.addEventListener("fullscreenchange", syncNativeFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncNativeFullscreen);
  }, []);

  useEffect(() => {
    if (activeWorkspace !== "backtest" || sessionGateOpen || isChartFullscreen) {
      setBacktestHeaderVisible(true);
      return;
    }

    const headerTarget = backtestHeaderActionsRef.current ?? backtestHeaderRef.current;
    if (!headerTarget || typeof IntersectionObserver === "undefined") {
      setBacktestHeaderVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setBacktestHeaderVisible(isEntryMoreThanHalfVisible(entry)),
      { threshold: [0, 0.5, 1] },
    );

    observer.observe(headerTarget);
    setBacktestHeaderVisible(isElementMoreThanHalfVisible(headerTarget));
    return () => observer.disconnect();
  }, [activeWorkspace, isChartFullscreen, sessionGateOpen]);

  useEffect(() => {
    if (
      activeWorkspace !== "backtest" ||
      sessionGateOpen ||
      workspacePanel === "none" ||
      pendingBacktestPanelScrollRestoreRef.current == null
    ) {
      return;
    }

    const scrollTop = pendingBacktestPanelScrollRestoreRef.current;
    pendingBacktestPanelScrollRestoreRef.current = null;
    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        window.scrollTo({ top: scrollTop });
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [activeWorkspace, sessionGateOpen, workspacePanel]);

  useEffect(() => {
    if (activeWorkspace !== "notebook" || !pendingNotebookScrollResetRef.current) {
      return;
    }

    pendingNotebookScrollResetRef.current = false;
    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        window.scrollTo({ left: 0, top: 0 });
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [activeWorkspace, notebookFocusTradeId]);

  const current = state?.current_candle;
  const orders = state?.orders ?? [];
  const executions = state?.executions ?? [];
  const trades = state?.trades ?? [];
  const currentSessionTrades = state?.session
    ? trades.filter((trade) => trade.session_id === state.session.id)
    : [];
  const position = state?.position ?? null;
  const sessionCurrency = currencyForSession(state?.session ?? null, datasets);
  const currencyForTrade = (trade: Trade) =>
    currencyForSession(
      resultSessions.find((session) => session.id === trade.session_id) ??
        (state?.session.id === trade.session_id ? state.session : null),
      datasets,
    );
  const pendingOrders = orders.filter((order) => order.status === "PENDING").length;
  const savedLayoutLabel =
    chartLayoutSavedAt == null
      ? null
      : `Saved ${new Date(chartLayoutSavedAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}`;
  const latestRiskRewardDrawing = findLatestRiskRewardDrawing(drawings);

  function closePositionFraction(fraction: number) {
    if (!position || position.side === "FLAT" || position.quantity <= 0) {
      return;
    }
    void placeOrder({
      side: position.side === "LONG" ? "SELL" : "BUY",
      order_type: "MARKET",
      quantity: position.quantity * fraction,
      reduce_only: true,
      commission_mode: state?.session.default_commission_mode ?? "NONE",
      commission_value: costValueForPayload(
        state?.session.default_commission_mode,
        state?.session.default_commission_value,
      ),
      fee_mode: state?.session.default_fee_mode ?? "NONE",
      fee_value: costValueForPayload(state?.session.default_fee_mode, state?.session.default_fee_value),
      strategy_name: position.strategy_name,
      playbook_id: position.playbook_id,
    });
  }

  function navigateWorkspace(view: WorkspaceView) {
    setNotebookReturnTarget(null);
    setActiveWorkspace(view);
    if (view === "sessions") {
      setPlaying(false);
      setReplayFocusTrade(null);
      setSessionGateOpen(true);
      return;
    }
    if (view === "backtest") {
      setReplayFocusTrade(null);
      setSessionGateOpen(false);
    }
  }

  function addIndicator(kind: ChartIndicatorKind) {
    setIndicatorInstances((current) => [
      ...current,
      createIndicatorInstance(kind, {
        color: nextIndicatorInstanceColor(kind, current),
      }),
    ]);
  }

  function removeIndicator(instanceId: string) {
    setIndicatorInstances((current) =>
      current.filter((indicator) => indicator.id !== instanceId),
    );
  }

  function removeIndicatorForPane(paneId: string, instanceId: string) {
    if (paneId === activeChartPane.id) {
      removeIndicator(instanceId);
      return;
    }
    updateChartPane(paneId, (pane) => ({
      ...pane,
      indicatorInstances: pane.indicatorInstances.filter(
        (indicator) => indicator.id !== instanceId,
      ),
    }));
  }

  function toggleIndicatorVisibility(instanceId: string) {
    setIndicatorInstances((current) =>
      current.map((indicator) =>
        indicator.id === instanceId
          ? { ...indicator, visible: indicator.visible === false }
          : indicator,
      ),
    );
  }

  function toggleIndicatorVisibilityForPane(paneId: string, instanceId: string) {
    if (paneId === activeChartPane.id) {
      toggleIndicatorVisibility(instanceId);
      return;
    }
    updateChartPane(paneId, (pane) => ({
      ...pane,
      indicatorInstances: pane.indicatorInstances.map((indicator) =>
        indicator.id === instanceId
          ? { ...indicator, visible: indicator.visible === false }
          : indicator,
      ),
    }));
  }

  function changeTimeframe(nextTimeframe: ChartTimeframe) {
    setTimeframe(coerceTimeframeToSource(nextTimeframe, sourceTimeframe));
  }

  function changeReplayTimeframe(nextTimeframe: ChartTimeframe) {
    const normalized = normalizeChartTimeframe(nextTimeframe);
    if (
      !normalized ||
      !replayTimeframeOptions.some((option) => option.value === normalized)
    ) {
      return;
    }
    setReplayTimeframe(normalized);
  }

  function selectChartPane(paneId: string) {
    if (paneId === activeChartPane.id) {
      return;
    }
    setActiveChartPaneId(paneId);
    setSelectedDrawingId(null);
    resetDrawingUndoHistory();
  }

  function changeChartPaneLayout(nextLayout: ChartPaneLayoutId) {
    const layout = chartPaneLayoutById(nextLayout);
    setChartPaneLayout(layout.id);
    setChartPanes((current) => {
      const nextPanes = [...current];
      while (nextPanes.length < layout.panes) {
        nextPanes.push(
          createDefaultChartPane(nextPanes.length, activeChartPane, sourceTimeframe),
        );
      }
      return nextPanes;
    });
    if (activeChartPaneIndex >= layout.panes) {
      setActiveChartPaneId("chart-pane-1");
      setSelectedDrawingId(null);
      resetDrawingUndoHistory();
    }
    if (layout.panes > 1) {
      setReplayTimeframe(coerceTimeframeToSource(activeChartPane.timeframe, sourceTimeframe));
    }
  }

  function updateIndicatorSettings(
    instanceId: string,
    settings: Partial<IndicatorSettings>,
  ) {
    setIndicatorInstances((current) =>
      current.map((indicator) =>
        indicator.id === instanceId
          ? {
              ...indicator,
              settings: mergeIndicatorSettings(indicator.kind, {
                ...indicator.settings,
                ...settings,
              }),
            }
          : indicator,
      ),
    );
  }

  function updateIndicatorSettingsForPane(
    paneId: string,
    instanceId: string,
    settings: Partial<IndicatorSettings>,
  ) {
    if (paneId === activeChartPane.id) {
      updateIndicatorSettings(instanceId, settings);
      return;
    }
    updateChartPane(paneId, (pane) => ({
      ...pane,
      indicatorInstances: pane.indicatorInstances.map((indicator) =>
        indicator.id === instanceId
          ? {
              ...indicator,
              settings: mergeIndicatorSettings(indicator.kind, {
                ...indicator.settings,
                ...settings,
              }),
            }
          : indicator,
      ),
    }));
  }

  function commitDrawingsChange(
    nextDrawings: ChartDrawing[],
    options: { coalesceUndo?: boolean; recordUndo?: boolean } = {},
  ) {
    const sanitizedDrawings = cloneDrawingsForHistory(sanitizeDrawings(nextDrawings));
    const currentDrawings = drawingsRef.current;
    if (drawingCollectionsEqual(currentDrawings, sanitizedDrawings)) {
      return sanitizedDrawings;
    }

    if (options.recordUndo !== false) {
      captureDrawingUndoSnapshot(currentDrawings, options.coalesceUndo === true);
    } else {
      closeDrawingUndoBatch();
    }

    drawingsRef.current = sanitizedDrawings;
    setDrawings(sanitizedDrawings);
    if (options.coalesceUndo === true) {
      scheduleDrawingLayoutPersist(sanitizedDrawings);
    } else {
      flushPendingDrawingLayoutPersist();
      persistChartLayoutWithDrawings(sanitizedDrawings);
    }
    return sanitizedDrawings;
  }

  function captureDrawingUndoSnapshot(snapshot: ChartDrawing[], coalesce: boolean) {
    if (coalesce && drawingUndoBatchOpenRef.current) {
      scheduleDrawingUndoBatchClose();
      return;
    }
    if (!coalesce) {
      closeDrawingUndoBatch();
    }

    const historyEntry = cloneDrawingsForHistory(snapshot);
    const stack = drawingUndoStackRef.current;
    if (stack.length === 0 || !drawingCollectionsEqual(stack[stack.length - 1], historyEntry)) {
      stack.push(historyEntry);
      if (stack.length > DRAWING_UNDO_LIMIT) {
        stack.shift();
      }
      setDrawingUndoDepth(stack.length);
    }

    if (coalesce) {
      drawingUndoBatchOpenRef.current = true;
      scheduleDrawingUndoBatchClose();
    }
  }

  function scheduleDrawingUndoBatchClose() {
    if (drawingUndoBatchTimerRef.current != null) {
      window.clearTimeout(drawingUndoBatchTimerRef.current);
    }
    drawingUndoBatchTimerRef.current = window.setTimeout(() => {
      drawingUndoBatchOpenRef.current = false;
      drawingUndoBatchTimerRef.current = null;
    }, DRAWING_UNDO_COALESCE_MS);
  }

  function closeDrawingUndoBatch() {
    drawingUndoBatchOpenRef.current = false;
    if (drawingUndoBatchTimerRef.current != null) {
      window.clearTimeout(drawingUndoBatchTimerRef.current);
      drawingUndoBatchTimerRef.current = null;
    }
  }

  function scheduleDrawingLayoutPersist(nextDrawings: ChartDrawing[]) {
    if (drawingPersistTimerRef.current != null) {
      window.clearTimeout(drawingPersistTimerRef.current);
    }
    const persistedDrawings = cloneDrawingsForHistory(nextDrawings);
    drawingPersistTimerRef.current = window.setTimeout(() => {
      drawingPersistTimerRef.current = null;
      persistChartLayoutWithDrawings(persistedDrawings);
    }, DRAWING_UNDO_COALESCE_MS);
  }

  function flushPendingDrawingLayoutPersist() {
    if (drawingPersistTimerRef.current == null) {
      return;
    }
    window.clearTimeout(drawingPersistTimerRef.current);
    drawingPersistTimerRef.current = null;
  }

  function addDrawing(drawing: ChartDrawing) {
    commitDrawingsChange([...drawingsRef.current, drawing]);
    setSelectedDrawingId(drawing.id);
  }

  function addDrawingToPane(paneId: string, drawing: ChartDrawing) {
    if (paneId === activeChartPane.id) {
      addDrawing(drawing);
      return;
    }
    setActiveChartPaneId(paneId);
    setSelectedDrawingId(drawing.id);
    const pane = chartPanes.find((item) => item.id === paneId);
    updateChartPane(paneId, (currentPane) => ({
      ...currentPane,
      drawings: sanitizeDrawings([...(pane?.drawings ?? []), drawing]),
    }));
  }

  function updateDrawing(updatedDrawing: ChartDrawing, coalesceUndo = false) {
    commitDrawingsChange(
      drawingsRef.current.map((drawing) =>
        drawing.id === updatedDrawing.id ? updatedDrawing : drawing,
      ),
      { coalesceUndo },
    );
  }

  function updateDrawingForPane(
    paneId: string,
    updatedDrawing: ChartDrawing,
    coalesceUndo = false,
  ) {
    if (paneId === activeChartPane.id) {
      updateDrawing(updatedDrawing, coalesceUndo);
      return;
    }
    updateChartPane(paneId, (pane) => ({
      ...pane,
      drawings: sanitizeDrawings(
        pane.drawings.map((drawing) =>
          drawing.id === updatedDrawing.id ? updatedDrawing : drawing,
        ),
      ),
    }));
  }

  function undoLastDrawingChange() {
    closeDrawingUndoBatch();
    flushPendingDrawingLayoutPersist();
    const previousDrawings = drawingUndoStackRef.current.pop();
    setDrawingUndoDepth(drawingUndoStackRef.current.length);
    if (!previousDrawings) {
      return;
    }
    const restoredDrawings = cloneDrawingsForHistory(previousDrawings);
    drawingsRef.current = restoredDrawings;
    setDrawings(restoredDrawings);
    if (
      selectedDrawingId &&
      !restoredDrawings.some((drawing) => drawing.id === selectedDrawingId)
    ) {
      setSelectedDrawingId(null);
    }
    persistChartLayoutWithDrawings(restoredDrawings);
  }

  function resetDrawingUndoHistory() {
    closeDrawingUndoBatch();
    flushPendingDrawingLayoutPersist();
    drawingUndoStackRef.current = [];
    setDrawingUndoDepth(0);
  }

  function clearDrawings() {
    const nextDrawings = commitDrawingsChange(
      drawingsRef.current.filter((drawing) => drawing.locked),
    );
    if (!nextDrawings.some((drawing) => drawing.id === selectedDrawingId)) {
      setSelectedDrawingId(null);
    }
  }

  function clearDrawingsForPane(paneId: string) {
    if (paneId === activeChartPane.id) {
      clearDrawings();
      return;
    }
    updateChartPane(paneId, (pane) => ({
      ...pane,
      drawings: pane.drawings.filter((drawing) => drawing.locked),
    }));
  }

  function deleteDrawing(drawingId: string) {
    const targetDrawing = drawingsRef.current.find((drawing) => drawing.id === drawingId);
    if (!targetDrawing || targetDrawing.locked) {
      return;
    }
    commitDrawingsChange(drawingsRef.current.filter((drawing) => drawing.id !== drawingId));
    setSelectedDrawingId(null);
  }

  function deleteDrawingForPane(paneId: string, drawingId: string) {
    if (paneId === activeChartPane.id) {
      deleteDrawing(drawingId);
      return;
    }
    updateChartPane(paneId, (pane) => {
      const targetDrawing = pane.drawings.find((drawing) => drawing.id === drawingId);
      if (!targetDrawing || targetDrawing.locked) {
        return pane;
      }
      return {
        ...pane,
        drawings: pane.drawings.filter((drawing) => drawing.id !== drawingId),
      };
    });
    if (selectedDrawingId === drawingId) {
      setSelectedDrawingId(null);
    }
  }

  function removeLastUnlockedDrawing() {
    const drawing = [...drawingsRef.current].reverse().find((item) => !item.locked);
    if (!drawing) {
      return;
    }
    deleteDrawing(drawing.id);
  }

  function toggleChartFullscreen() {
    if (isChartFullscreen) {
      exitChartFullscreen();
      return;
    }
    setIsChartFullscreen(true);
    const element = chartShellRef.current;
    if (element && document.fullscreenElement !== element && element.requestFullscreen) {
      void element.requestFullscreen().catch(() => {
        // Keep the in-app fullscreen layout as a fallback when native fullscreen is blocked.
      });
    }
  }

  function exitChartFullscreen() {
    setIsChartFullscreen(false);
    setFullscreenOrderPanelOpen(false);
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {
        // Browser fullscreen can already be gone by the time React handles Escape.
      });
    }
  }

  function closeOrderPanels() {
    setLeftPaneOpen(false);
    setFullscreenOrderPanelOpen(false);
  }

  function toggleOrderPanel() {
    if (isChartFullscreen) {
      setFullscreenOrderPanelOpen((value) => !value);
      return;
    }
    setLeftPaneOpen((value) => !value);
  }

  function saveChartLayout() {
    const payload = buildChartLayoutPayload(drawings);
    const name = normalizeLayoutName(layoutName);
    void saveAppStorageItem(CHART_LAYOUT_STORAGE_KEY, payload);
    void saveAppStorageItem(ACTIVE_CHART_LAYOUT_STORAGE_KEY, name);
    setLayoutName(name);
    setAvailableLayouts(saveNamedChartLayout(name, payload));
    setChartLayoutSavedAt(Date.now());
  }

  function persistChartLayoutWithDrawings(nextDrawings: ChartDrawing[]) {
    if (typeof window === "undefined") {
      return;
    }
    const payload = buildChartLayoutPayload(nextDrawings);
    const name = normalizeLayoutName(layoutName);
    void saveAppStorageItem(CHART_LAYOUT_STORAGE_KEY, payload);
    void saveAppStorageItem(ACTIVE_CHART_LAYOUT_STORAGE_KEY, name);
    setLayoutName(name);
    setAvailableLayouts(saveNamedChartLayout(name, payload));
    setChartLayoutSavedAt(Date.now());
  }

  function buildChartLayoutPayload(nextDrawings: ChartDrawing[]): StoredChartLayout {
    const panes = chartPanes.map((pane) =>
      sanitizeChartPaneState(
        pane.id === activeChartPane.id ? { ...pane, drawings: nextDrawings } : pane,
      ),
    );
    const activePane = panes.find((pane) => pane.id === activeChartPane.id) ?? panes[0];
    return {
      activePaneId: activePane?.id,
      chartSettings: sanitizeChartVisualSettings(activePane?.chartSettings),
      chartStyle: sanitizeChartStyle(activePane?.chartStyle),
      drawings: sanitizeDrawings(activePane?.drawings),
      indicatorInstances: sanitizeIndicatorInstances(activePane?.indicatorInstances),
      magnetMode: sanitizeMagnetMode(activePane?.magnetMode),
      paneLayout: chartPaneLayout,
      panes,
      replayTimeframe: normalizedReplayTimeframe,
      settingsDefaultsVersion: CHART_SETTINGS_DEFAULTS_VERSION,
      showOrderOverlays: activePane?.showOrderOverlays ?? true,
      smoothCandles: activePane?.smoothCandles ?? false,
      timeframe: coerceTimeframeToSource(
        sanitizeTimeframe(activePane?.timeframe),
        sourceTimeframe,
      ),
    };
  }

  function loadNamedChartLayout(name: string) {
    const record = loadChartLayoutRecord(name);
    if (!record) {
      return;
    }
    applyChartLayout(record.layout);
    void saveAppStorageItem(ACTIVE_CHART_LAYOUT_STORAGE_KEY, record.name);
    setLayoutName(record.name);
    setChartLayoutSavedAt(Date.now());
  }

  function deleteNamedChartLayout(name: string) {
    const nextNames = deleteChartLayoutRecord(name);
    setAvailableLayouts(nextNames);
    if (normalizeLayoutName(name) === normalizeLayoutName(layoutName)) {
      setLayoutName(nextNames[0] ?? "Default");
      void saveAppStorageItem(ACTIVE_CHART_LAYOUT_STORAGE_KEY, nextNames[0] ?? null);
    }
  }

  function applyChartLayout(layout: Partial<StoredChartLayout>) {
    const nextLayout = sanitizeChartPaneLayout(layout.paneLayout);
    const nextPanes = sanitizeChartPanes(layout);
    const nextActivePane =
      nextPanes.find((pane) => pane.id === layout.activePaneId) ?? nextPanes[0];
    setChartPaneLayout(nextLayout);
    setChartPanes(nextPanes);
    setActiveChartPaneId(nextActivePane?.id ?? "chart-pane-1");
    setReplayTimeframe(sanitizeTimeframe(layout.replayTimeframe ?? nextActivePane?.timeframe));
    drawingsRef.current = nextActivePane?.drawings ?? [];
    resetDrawingUndoHistory();
    setSelectedDrawingId(null);
  }

  function toggleChartTools() {
    setChartSettingsPanelOpen(false);
    setChartToolsOpen((value) => !value);
  }

  function openChartTools() {
    setChartSettingsPanelOpen(false);
    setChartToolsOpen(true);
  }

  function handleChartToolsPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!chartSettingsPanelOpen) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    skipNextToolsClickRef.current = true;
    event.currentTarget.focus({ preventScroll: true });
    openChartTools();
  }

  function handleChartToolsClick() {
    if (skipNextToolsClickRef.current) {
      skipNextToolsClickRef.current = false;
      return;
    }
    if (chartSettingsPanelOpen) {
      openChartTools();
      return;
    }
    toggleChartTools();
  }

  function openChartSettings() {
    setChartToolsOpen(false);
    setChartSettingsPanelOpen(true);
    setChartSettingsOpenSignal((value) => value + 1);
  }

  function handleChartSettingsClose() {
    setChartSettingsPanelOpen(false);
  }

  async function createSessionFromGateway(payload: BacktestCreatePayload) {
    await newSession(payload);
    await loadInitial();
    setReplayFocusTrade(null);
    setActiveWorkspace("backtest");
    setSessionGateOpen(false);
    setLeftPaneOpen(false);
    setChartToolsOpen(false);
    setLayersPanelOpen(false);
    setWorkspacePanel("none");
  }

  async function resumeSessionFromGateway(sessionId?: number) {
    if (sessionId) {
      await loadSession(sessionId);
    }
    setReplayFocusTrade(null);
    setActiveWorkspace("backtest");
    setSessionGateOpen(false);
    setLeftPaneOpen(false);
    setChartToolsOpen(false);
    setLayersPanelOpen(false);
    setWorkspacePanel("none");
  }

  async function updateSessionFromGateway(
    sessionId: number,
    payload: BacktestSessionUpdatePayload,
  ) {
    await updateSession(sessionId, payload);
  }

  async function deleteSessionFromGateway(sessionId: number) {
    const deletingActiveSession = state?.session.id === sessionId;
    await deleteSession(sessionId);
    if (deletingActiveSession) {
      setReplayFocusTrade(null);
      setActiveWorkspace("sessions");
      setSessionGateOpen(true);
      setLeftPaneOpen(false);
      setChartToolsOpen(false);
      setLayersPanelOpen(false);
      setWorkspacePanel("none");
    }
  }

  async function replayTradeFromNotes(trade: Trade) {
    setPlaying(false);
    setReviewTrade(null);
    setEditingTrade(null);
    setReplayFocusTrade(trade);
    setActiveWorkspace("backtest");
    setSessionGateOpen(false);
    setLeftPaneOpen(false);
    setChartToolsOpen(false);
    setLayersPanelOpen(false);
    setWorkspacePanel("none");

    await loadSession(trade.session_id);
    const session = resultSessions.find((item) => item.id === trade.session_id);
    const targetOffset = Math.max(
      session?.start_offset ?? 0,
      trade.entry_offset - TRADE_REPLAY_CONTEXT_BARS,
    );
    await jumpToOffset(targetOffset);
  }

  function openTradeNoteFromLog(trade: Trade) {
    setReviewTrade(null);
    setEditingTrade(null);
    setReplayFocusTrade(null);
    setNotebookFocusTradeId(trade.id);
    setNotebookReturnTarget(activeWorkspace === "tradeView" || activeWorkspace === "dayView" ? activeWorkspace : null);
    pendingNotebookScrollResetRef.current = true;
    setActiveWorkspace("notebook");
    setSessionGateOpen(false);
    setLeftPaneOpen(false);
    setChartToolsOpen(false);
    setLayersPanelOpen(false);
    setWorkspacePanel("none");
  }

  function openTradeNoteFromBacktestPanel(trade: Trade, panel: "review" | "results") {
    setReviewTrade(null);
    setEditingTrade(null);
    setReplayFocusTrade(null);
    setNotebookFocusTradeId(trade.id);
    setNotebookReturnTarget(panel === "results" ? "backtestResults" : "backtestReview");
    backtestPanelScrollRef.current = window.scrollY;
    pendingNotebookScrollResetRef.current = true;
    setActiveWorkspace("notebook");
    setSessionGateOpen(false);
    setLeftPaneOpen(false);
    setChartToolsOpen(false);
    setLayersPanelOpen(false);
    setWorkspacePanel("none");
  }

  function returnToBacktestPanel() {
    const returnPanel = notebookReturnTarget === "backtestResults" ? "results" : "review";
    pendingBacktestPanelScrollRestoreRef.current = backtestPanelScrollRef.current;
    if (returnPanel === "results") {
      pendingResultsPanelTradeScrollRestoreRef.current = resultsPanelTradeScrollRef.current;
    }
    setNotebookReturnTarget(null);
    setReplayFocusTrade(null);
    setActiveWorkspace("backtest");
    setSessionGateOpen(false);
    setWorkspacePanel(returnPanel);
  }

  const unlockedDrawingsCount = drawings.filter((drawing) => !drawing.locked).length;
  const backtestFocusHeader = (
    <header className="backtest-focus-header" ref={backtestHeaderRef}>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <span className="status-pill text-emerald-100">
          <Radio size={14} />
          {isPlaying ? "Playing" : "Replay"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold text-white">
            {state?.session.strategy_name ?? "Strategy"} / {formatMarketSymbol(state?.session.symbol)} {state?.session.timeframe ?? "M1"}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <WalletCards size={13} />
              Session #{state?.session.id ?? "—"}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Database size={13} />
              {meta ? `${meta.rows.toLocaleString()} bars` : "Dataset"}
            </span>
            {current && (
              <span className="inline-flex items-center gap-1.5">
                <Clock3 size={13} />
                {new Date(current.timestamp).toLocaleString()}
              </span>
            )}
          </div>
        </div>
        <div className="hidden gap-2 xl:flex">
          <HeaderStat label="Realized" value={money(state?.session.realized_pnl ?? 0, sessionCurrency)} tone={(state?.session.realized_pnl ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"} />
          <HeaderStat label="Position" value={position && position.side !== "FLAT" && position.quantity > 0 ? position.side : "Flat"} tone={position?.side === "LONG" ? "text-emerald-300" : position?.side === "SHORT" ? "text-rose-300" : "text-slate-300"} />
          <HeaderStat label="Pending" value={String(pendingOrders)} />
        </div>
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto" ref={backtestHeaderActionsRef}>
        <button
          className="workspace-tab inline-flex items-center justify-center gap-2"
          onClick={() => {
            setPlaying(false);
            setActiveWorkspace("sessions");
            setSessionGateOpen(true);
          }}
          type="button"
        >
          <ArrowLeft size={14} />
          Sessions
        </button>
        <button
          className={`workspace-tab inline-flex items-center justify-center gap-2 ${leftPaneOpen ? "workspace-tab-active" : ""}`}
          onClick={() => setLeftPaneOpen((value) => !value)}
          type="button"
        >
          {leftPaneOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
          Ticket
        </button>
        <button
          className={`workspace-tab inline-flex items-center justify-center gap-2 ${layersPanelOpen ? "workspace-tab-active" : ""}`}
          onClick={() => setLayersPanelOpen((value) => !value)}
          type="button"
        >
          {layersPanelOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
          Objects
        </button>
        <button
          className={`workspace-tab inline-flex items-center justify-center gap-2 ${chartToolsOpen ? "workspace-tab-active" : ""}`}
          data-chart-header-control="tools"
          onClick={handleChartToolsClick}
          onPointerDown={handleChartToolsPointerDown}
          type="button"
        >
          <PencilRuler size={14} />
          Tools
        </button>
        <button
          className={`workspace-tab inline-flex items-center justify-center gap-2 ${chartSettingsPanelOpen ? "workspace-tab-active" : ""}`}
          data-chart-header-control="settings"
          onClick={openChartSettings}
          type="button"
        >
          <Settings2 size={14} />
          Settings
        </button>
        {!isChartFullscreen && (
          <button
            className="workspace-tab inline-flex items-center justify-center gap-2"
            onClick={toggleChartFullscreen}
            type="button"
          >
            <Maximize2 size={14} />
            Full Screen
          </button>
        )}
        <button
          className={`workspace-tab inline-flex items-center justify-center gap-2 ${workspacePanel === "tape" ? "workspace-tab-active" : ""}`}
          onClick={() => setWorkspacePanel((value) => value === "tape" ? "none" : "tape")}
          type="button"
        >
          <ScrollText size={14} />
          Orders Tape
        </button>
        <button
          className={`workspace-tab inline-flex items-center justify-center gap-2 ${workspacePanel === "review" ? "workspace-tab-active" : ""}`}
          onClick={() => setWorkspacePanel((value) => value === "review" ? "none" : "review")}
          type="button"
        >
          <ClipboardCheck size={14} />
          Review
        </button>
        <button
          className={`workspace-tab inline-flex items-center justify-center gap-2 ${workspacePanel === "results" ? "workspace-tab-active" : ""}`}
          onClick={() => setWorkspacePanel((value) => value === "results" ? "none" : "results")}
          type="button"
        >
          <LineChart size={14} />
          Results
        </button>
      </div>
    </header>
  );
  const quickOrderPanelOpen = isChartFullscreen ? fullscreenOrderPanelOpen : leftPaneOpen;
  const showChartQuickActions =
    !replayOverlayOpen &&
    (isChartFullscreen ||
      (activeWorkspace === "backtest" && !sessionGateOpen && !backtestHeaderVisible));
  const chartQuickActionBar = showChartQuickActions ? (
    <div
      className={`chart-quick-actionbar ${
        isChartFullscreen
          ? "chart-quick-actionbar-fullscreen"
          : "chart-quick-actionbar-floating"
      }`}
    >
      <button
        className={`chart-quick-action ${quickOrderPanelOpen ? "chart-quick-action-active" : ""}`}
        onClick={toggleOrderPanel}
        type="button"
      >
        {quickOrderPanelOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
        Ticket
      </button>
      <button
        className={`chart-quick-action ${layersPanelOpen ? "chart-quick-action-active" : ""}`}
        onClick={() => setLayersPanelOpen((value) => !value)}
        type="button"
      >
        {layersPanelOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
        Objects
      </button>
      <button
        className={`chart-quick-action ${chartToolsOpen ? "chart-quick-action-active" : ""}`}
        data-chart-header-control="tools"
        onClick={handleChartToolsClick}
        onPointerDown={handleChartToolsPointerDown}
        type="button"
      >
        <PencilRuler size={15} />
        Tools
      </button>
      <button
        className={`chart-quick-action ${chartSettingsPanelOpen ? "chart-quick-action-active" : ""}`}
        data-chart-header-control="settings"
        onClick={openChartSettings}
        type="button"
      >
        <Settings2 size={15} />
        Settings
      </button>
      <button
        className="chart-quick-action"
        onClick={isChartFullscreen ? exitChartFullscreen : toggleChartFullscreen}
        type="button"
      >
        {isChartFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        {isChartFullscreen ? "Exit" : "Full Screen"}
      </button>
    </div>
  ) : null;

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#05070a] text-slate-100">
      <div className="flex min-h-screen max-w-full overflow-x-hidden">
        <Sidebar
          activeView={activeWorkspace}
          collapsed={sidebarCollapsed}
          onNavigate={navigateWorkspace}
        />
        <div
          aria-hidden="true"
          className="hidden shrink-0 lg:block"
          style={{ width: sidebarCollapsed ? 76 : 244 }}
        />
        <main className="min-w-0 flex-1 overflow-x-hidden p-3 sm:p-4 xl:p-5">
          {activeWorkspace !== "sessions" && activeWorkspace !== "backtest" ? (
            <Suspense fallback={<WorkspaceLoadingPanel />}>
              <EdgeLabWorkspace
                activeSession={state?.session ?? null}
                datasets={datasets}
                onEditTrade={setEditingTrade}
                onInspectTrade={setReviewTrade}
                onOpenTradeNote={openTradeNoteFromLog}
                onNavigateBacktest={() => {
                  setNotebookReturnTarget(null);
                  setReplayFocusTrade(null);
                  setActiveWorkspace("backtest");
                  setSessionGateOpen(false);
                }}
                onNavigateDayView={() => {
                  setNotebookReturnTarget(null);
                  setReplayFocusTrade(null);
                  setActiveWorkspace("dayView");
                  setSessionGateOpen(false);
                }}
                onNavigateSessions={() => {
                  setNotebookReturnTarget(null);
                  setReplayFocusTrade(null);
                  setActiveWorkspace("sessions");
                  setSessionGateOpen(true);
                }}
                onNavigateTradeView={() => {
                  setNotebookReturnTarget(null);
                  setReplayFocusTrade(null);
                  setActiveWorkspace("tradeView");
                  setSessionGateOpen(false);
                }}
                onReplayTrade={replayTradeFromNotes}
                onResumeSession={resumeSessionFromGateway}
                onCreatePlaybook={createPlaybook}
                onUpdatePlaybook={updatePlaybook}
                onDeletePlaybook={deletePlaybook}
                onRefreshDatasets={refreshDatasets}
                onGetDatasetRefreshStatus={refreshDatasetStatus}
                onUpdateDatasetAsset={updateDatasetAsset}
                onUpdateDatasetSettings={updateDatasetSettings}
                playbooks={playbooks}
                sessions={resultSessions}
                trades={resultTrades}
                view={activeWorkspace}
                notebookFocusTradeId={notebookFocusTradeId}
                notebookReturnToBacktestPanel={
                  notebookReturnTarget === "backtestReview"
                    ? "review"
                    : notebookReturnTarget === "backtestResults"
                      ? "results"
                      : null
                }
                notebookReturnToDayView={notebookReturnTarget === "dayView"}
                notebookReturnToTradeView={notebookReturnTarget === "tradeView"}
                onReturnToBacktestPanel={returnToBacktestPanel}
              />
            </Suspense>
          ) : sessionGateOpen || activeWorkspace === "sessions" ? (
            <>
              {error && (
                <div className="mb-4 flex items-center gap-2 rounded-md border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                  <AlertTriangle size={18} />
                  {error}
                </div>
              )}
              <SessionGateway
                datasets={datasets}
                isLoading={isLoading}
                onCreateSession={createSessionFromGateway}
                onCreatePlaybook={createPlaybook}
                onDeleteSession={deleteSessionFromGateway}
                onResumeSession={resumeSessionFromGateway}
                onUpdateSession={updateSessionFromGateway}
                playbooks={playbooks}
                session={state?.session ?? null}
                sessions={resultSessions}
                trades={resultTrades}
              />
            </>
          ) : (
            <>
          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
              <AlertTriangle size={18} />
              {error}
            </div>
          )}
          {isLoading && <BacktestLoadingPanel />}

          <div className="space-y-3">
            {leftPaneOpen && (
              <aside
                className="focus-side-drawer"
                style={{ "--edge-sidebar-width": sidebarCollapsed ? "76px" : "244px" } as CSSProperties}
              >
                <section className="terminal-panel flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-500">
                      Execution
                    </div>
                    <div className="truncate text-sm font-semibold text-white">
                      Order ticket and position controls
                    </div>
                  </div>
                  <button
                    className="icon-button h-8 w-8 shrink-0"
                    onClick={() => setLeftPaneOpen(false)}
                    title="Close order ticket"
                    type="button"
                  >
                    <PanelLeftClose size={15} />
                  </button>
                </section>
                <div className="focus-side-drawer-body">
                  <OrderTicket
                    initialSide={orderTicketSide}
                    onOrderPlaced={closeOrderPanels}
                    playbooks={playbooks}
                    riskRewardDrawing={latestRiskRewardDrawing}
                  />
                  <PositionPanel currency={sessionCurrency} position={position} />
                </div>
              </aside>
            )}

              <div
                className={
                  isChartFullscreen
                    ? "chart-fullscreen-shell"
                    : "focus-chart-column"
                }
                ref={chartShellRef}
              >
                {!isChartFullscreen && backtestFocusHeader}
                {chartQuickActionBar}
                {timeframeShortcutFeedback && (
                  <TimeframeShortcutOverlay feedback={timeframeShortcutFeedback} />
                )}
                <ReplayController
                  dateFormat={chartSettings.dateFormat}
                  dayOfWeekLabels={chartSettings.dayOfWeekLabels}
                  isOrderPaneOpen={isChartFullscreen ? fullscreenOrderPanelOpen : leftPaneOpen}
                  onTransientOverlayOpenChange={setReplayOverlayOpen}
                  onToggleOrderPane={toggleOrderPanel}
                  onReplayTimeframeChange={changeReplayTimeframe}
                  replayStepBars={playbackStepBars}
                  replayTimeframe={isMultiChartLayout ? normalizedReplayTimeframe : null}
                  replayTimeframeLabel={
                    isMultiChartLayout
                      ? formatChartTimeframeLabel(normalizedReplayTimeframe)
                      : null
                  }
                  replayTimeframeOptions={replayTimeframeOptions}
                  showOrderToggle={false}
                  timeHoursFormat={chartSettings.timeHoursFormat}
                />
                {(chartToolsOpen || chartSettingsPanelOpen) && (
                  <Suspense fallback={<LazyPanelFallback />}>
                    <ChartToolbar
                      key={chartToolsOpen ? "chart-tools" : "chart-settings"}
                      activePaneLabel={activeChartPaneLabel}
                      chartSettings={chartSettings}
                      chartStyle={chartStyle}
                      clearableDrawingsCount={unlockedDrawingsCount}
                      drawingTool={drawingTool}
                      drawingsCount={drawings.length}
                      indicatorInstances={indicatorInstances}
                      onAddIndicator={addIndicator}
                      onChartSettingsChange={(settings) =>
                        applyChartSettingsToCurrentScope(settings)
                      }
                      onChartSettingsReset={() =>
                        applyChartSettingsToCurrentScope(DEFAULT_CHART_VISUAL_SETTINGS)
                      }
                      onChartStyleChange={setChartStyle}
                      onClearDrawings={clearDrawings}
                      layoutName={layoutName}
                      layoutNames={availableLayouts}
                      onDrawingToolChange={changeDrawingTool}
                      onDeleteLayout={deleteNamedChartLayout}
                      onLayoutNameChange={setLayoutName}
                      onLoadLayout={loadNamedChartLayout}
                      magnetMode={magnetMode}
                      multiChart={isMultiChartLayout}
                      onMagnetModeChange={setMagnetMode}
                      onPaneLayoutChange={changeChartPaneLayout}
                      onReplayTimeframeChange={changeReplayTimeframe}
                      onSaveLayout={saveChartLayout}
                      onTimeframeChange={changeTimeframe}
                      onToggleOrderOverlays={() => setShowOrderOverlays((value) => !value)}
                      onRemoveIndicator={removeIndicator}
                      onUpdateIndicatorSettings={updateIndicatorSettings}
                      onSettingsClose={handleChartSettingsClose}
                      onSmoothCandlesChange={setSmoothCandles}
                      orderOverlaysVisible={showOrderOverlays}
                      paneLayout={chartPaneLayout}
                      replayTimeframe={normalizedReplayTimeframe}
                      replayTimeframeOptions={replayTimeframeOptions}
                      savedLabel={savedLayoutLabel}
                      settingsOpenSignal={chartSettingsOpenSignal}
                      smoothCandles={smoothCandles}
                      sourceTimeframe={sourceTimeframe}
                      timeframe={effectiveTimeframe}
                      toolsOpen={chartToolsOpen}
                    />
                  </Suspense>
                )}
                <Suspense fallback={<ChartChunkFallback />}>
                  <div className={`chart-studio-layout ${layersPanelOpen ? "" : "chart-studio-layout-focus"}`}>
                  <div className="min-w-0 space-y-3">
                    <div
                      className={`chart-pane-grid ${chartPaneLayoutDefinition.className}`}
                    >
                      {visibleChartPanes.map((pane, index) => {
                        const paneActive = pane.id === activeChartPane.id;
                        const paneTimeframe = coerceTimeframeToSource(
                          pane.timeframe,
                          sourceTimeframe,
                        );
                        return (
                          <div
                            className={`chart-pane-shell ${
                              paneActive && isMultiChartLayout ? "chart-pane-shell-active" : ""
                            } ${isMultiChartLayout ? "chart-pane-shell-with-header" : ""}`}
                            key={pane.id}
                            onPointerDownCapture={() => selectChartPane(pane.id)}
                          >
                            {isMultiChartLayout && (
                              <div className="chart-pane-header">
                                <button
                                  className={`chart-pane-select-button ${
                                    paneActive ? "chart-pane-select-button-active" : ""
                                  }`}
                                  onClick={() => selectChartPane(pane.id)}
                                  type="button"
                                >
                                  Pane {index + 1}
                                </button>
                                <span>{formatChartTimeframeLabel(paneTimeframe)}</span>
                              </div>
                            )}
                            <TradingChart
                              bars={bars}
                              canUndoDrawingChange={paneActive && drawingUndoDepth > 0}
                              chartSettings={pane.chartSettings}
                              chartStyle={pane.chartStyle}
                              confirmOrderLineModifications={confirmOrderLineModifications}
                              drawingTool={pane.drawingTool}
                              drawings={pane.drawings}
                              executions={executions}
                              indicatorInstances={pane.indicatorInstances}
                              magnetMode={pane.magnetMode}
                              neutralDrawingTool={lastNeutralDrawingToolRef.current}
                              onAddDrawing={(nextDrawing) =>
                                addDrawingToPane(pane.id, nextDrawing)
                              }
                              onAmendOrder={amendOrder}
                              onClearDrawings={() => clearDrawingsForPane(pane.id)}
                              onClosePositionFraction={closePositionFraction}
                              onDeleteDrawing={(drawingId) =>
                                deleteDrawingForPane(pane.id, drawingId)
                              }
                              onDrawingToolChange={(tool) =>
                                changeDrawingToolForPane(pane.id, tool)
                              }
                              onMagnetModeChange={(mode) =>
                                changeMagnetModeForPane(pane.id, mode)
                              }
                              onRemoveIndicator={(instanceId) =>
                                removeIndicatorForPane(pane.id, instanceId)
                              }
                              onSelectDrawing={(drawingId) => {
                                selectChartPane(pane.id);
                                setSelectedDrawingId(drawingId);
                              }}
                              onToggleIndicatorVisibility={(instanceId) =>
                                toggleIndicatorVisibilityForPane(pane.id, instanceId)
                              }
                              onUpdatePosition={updatePosition}
                              onUndoDrawingChange={
                                paneActive ? undoLastDrawingChange : () => selectChartPane(pane.id)
                              }
                              onUpdateDrawing={(nextDrawing, coalesceUndo) =>
                                updateDrawingForPane(pane.id, nextDrawing, coalesceUndo)
                              }
                              onUpdateIndicatorSettings={(instanceId, settings) =>
                                updateIndicatorSettingsForPane(pane.id, instanceId, settings)
                              }
                              orders={orders}
                              position={position}
                              pnlMultiplier={state?.session.pnl_multiplier ?? 1}
                              replayFocusTrade={
                                replayFocusTrade?.session_id === state?.session.id
                                  ? replayFocusTrade
                                  : null
                              }
                              replaySeekVersion={replaySeekVersion}
                              selectedDrawingId={paneActive ? selectedDrawingId : null}
                              showOrderOverlays={pane.showOrderOverlays}
                              symbol={state?.session.symbol}
                              currency={sessionCurrency}
                              datasetTimeframe={state?.session.timeframe}
                              timeframe={paneTimeframe}
                              undoShortcutLabel={undoShortcutLabel}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {layersPanelOpen ? (
                    <ChartObjectsPanel
                      chartStyle={chartStyle}
                      drawings={drawings}
                      indicatorInstances={indicatorInstances}
                      onClearDrawings={clearDrawings}
                      onCollapse={() => setLayersPanelOpen(false)}
                      onDeleteDrawing={deleteDrawing}
                      onSelectDrawing={setSelectedDrawingId}
                      onRemoveIndicator={removeIndicator}
                      onToggleIndicatorVisibility={toggleIndicatorVisibility}
                      onUpdateDrawing={(updatedDrawing) => updateDrawing(updatedDrawing, false)}
                      onUpdateIndicatorSettings={updateIndicatorSettings}
                      onToggleOrderOverlays={() => setShowOrderOverlays((value) => !value)}
                      orderOverlaysVisible={showOrderOverlays}
                      selectedDrawingId={selectedDrawingId}
                      smoothCandles={smoothCandles}
                    />
                  ) : null}
                  </div>
                </Suspense>
                {isChartFullscreen && fullscreenOrderPanelOpen && (
                  <div className="chart-fullscreen-dock">
                    <div className="chart-fullscreen-dock-header">
                      <div className="min-w-0">
                        <div className="text-xs uppercase tracking-[0.16em] text-cyan-200/70">
                          Execution
                        </div>
                        <div className="truncate text-sm font-semibold text-white">
                          Order ticket and position controls
                        </div>
                      </div>
                      <button
                        className="icon-button h-8 w-8 shrink-0"
                        onClick={() => setFullscreenOrderPanelOpen(false)}
                        title="Close order ticket"
                        type="button"
                      >
                        <PanelLeftClose size={15} />
                      </button>
                    </div>
                    <div className="focus-side-drawer-body">
                      <OrderTicket
                        initialSide={orderTicketSide}
                        onOrderPlaced={closeOrderPanels}
                        playbooks={playbooks}
                        riskRewardDrawing={latestRiskRewardDrawing}
                      />
                      <PositionPanel currency={sessionCurrency} position={position} />
                    </div>
                  </div>
                )}
              </div>

            {workspacePanel === "tape" && (
              <section className="focus-bottom-panel">
                <PositionPanel currency={sessionCurrency} position={position} />
                <PendingOrders orders={orders} />
                <ExecutionTape currency={sessionCurrency} executions={executions} />
              </section>
            )}

            {workspacePanel === "review" && (
              <section className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <PlaybookBoard playbooks={playbooks} trades={trades} />
                <FilteredTradeReview
                  trades={trades}
                  onEdit={setEditingTrade}
                  onInspect={(trade) => openTradeNoteFromBacktestPanel(trade, "review")}
                />
              </section>
            )}

            {workspacePanel === "results" && (
              <section className="min-w-0">
                <Suspense fallback={<LazyPanelFallback className="min-h-40" />}>
                  <ResultsPanel
                    activeSessionId={state?.session.id ?? null}
                    currency={sessionCurrency}
                    filter={resultsPanelFilter}
                    onFilterChange={setResultsPanelFilter}
                    onInspectTrade={(trade) => openTradeNoteFromBacktestPanel(trade, "results")}
                    onSearchChange={setResultsPanelSearch}
                    onTradeScrollChange={(scroll) => {
                      resultsPanelTradeScrollRef.current = scroll;
                    }}
                    onTradeScrollRestored={() => {
                      pendingResultsPanelTradeScrollRestoreRef.current = null;
                    }}
                    onViewChange={setResultsPanelView}
                    restoreTradeScroll={pendingResultsPanelTradeScrollRestoreRef.current}
                    search={resultsPanelSearch}
                    sessions={state?.session ? [state.session] : []}
                    trades={currentSessionTrades}
                    view={resultsPanelView}
                  />
                </Suspense>
              </section>
            )}
          </div>
            </>
          )}
        </main>
      </div>

      {editingTrade && (
        <JournalEntryModal
          currency={currencyForTrade(editingTrade)}
          strategyScope={strategyScopeForTrade(editingTrade, resultSessions, state?.session ?? null)}
          trade={editingTrade}
          onClose={() => setEditingTrade(null)}
        />
      )}

      {reviewTrade && (
        <TradeDetailDrawer
          currency={currencyForTrade(reviewTrade)}
          executions={executions}
          onClose={() => setReviewTrade(null)}
          onJournal={(trade) => {
            setReviewTrade(null);
            setEditingTrade(trade);
          }}
          onReplayTrade={replayTradeFromNotes}
          strategyScope={strategyScopeForTrade(reviewTrade, resultSessions, state?.session ?? null)}
          trade={reviewTrade}
        />
      )}
    </div>
  );
}

function TimeframeShortcutOverlay({
  feedback,
}: {
  feedback: TimeframeShortcutFeedback;
}) {
  return (
    <div
      aria-live="polite"
      className="timeframe-shortcut-overlay"
      role="status"
    >
      <div className={`timeframe-shortcut-dialog timeframe-shortcut-dialog-${feedback.status}`}>
        <span className="timeframe-shortcut-status" aria-hidden="true" />
        <div className="timeframe-shortcut-title">
          Interval
        </div>
        <div className="timeframe-shortcut-input">
          <span className="timeframe-shortcut-value">{feedback.value}</span>
          <span className="timeframe-shortcut-caret" aria-hidden="true" />
        </div>
        <div className="timeframe-shortcut-description">
          {feedback.description}
        </div>
      </div>
    </div>
  );
}

function buildTimeframeShortcutFeedback(
  rawValue: string,
  sourceTimeframe: ChartTimeframe | null,
): TimeframeShortcutFeedback {
  const compactValue = rawValue.trim().replace(/\s+/g, "");
  const digitsOnly = /^\d+$/.test(compactValue);
  const candidateValue = digitsOnly ? `${compactValue}m` : compactValue;
  const normalized = normalizeChartTimeframe(candidateValue);

  if (!normalized) {
    return {
      description: "Invalid interval",
      status: "invalid",
      value: compactValue,
    };
  }

  const value = digitsOnly ? compactValue : formatChartTimeframeLabel(normalized);
  if (!canAggregateTimeframe(normalized, sourceTimeframe)) {
    const sourceLabel = sourceTimeframe
      ? formatChartTimeframeLabel(sourceTimeframe)
      : "source";
    return {
      description: `Unavailable from ${sourceLabel} source`,
      status: "unavailable",
      value,
    };
  }

  return {
    description: formatTimeframeShortcutDescription(normalized),
    status: "ready",
    timeframe: normalized,
    value,
  };
}

function formatTimeframeShortcutDescription(timeframe: ChartTimeframe) {
  if (timeframe === "1M") {
    return "1 month";
  }

  const match = /^(\d+)(m|H|D|W)$/.exec(timeframe);
  if (!match) {
    return formatChartTimeframeLabel(timeframe);
  }

  const value = Number.parseInt(match[1], 10);
  const unit =
    match[2] === "m"
      ? "minute"
      : match[2] === "H"
        ? "hour"
        : match[2] === "D"
          ? "day"
          : "week";
  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

function isEntryMoreThanHalfVisible(entry: IntersectionObserverEntry) {
  return entry.isIntersecting && entry.intersectionRatio > 0.5;
}

function isElementMoreThanHalfVisible(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const visibleTop = Math.max(rect.top, 0);
  const visibleBottom = Math.min(rect.bottom, window.innerHeight);
  const visibleHeight = Math.max(0, visibleBottom - visibleTop);
  return rect.height > 0 && visibleHeight / rect.height > 0.5;
}

type StoredChartLayout = {
  activeIndicators?: ChartIndicatorId[];
  activePaneId?: string;
  chartSettings?: ChartVisualSettings;
  chartStyle: ChartStyle;
  drawings: ChartDrawing[];
  indicatorInstances: ChartIndicatorInstance[];
  indicatorSettings?: Partial<Record<ChartIndicatorId, Partial<IndicatorSettings>>>;
  magnetMode: MagnetMode;
  paneLayout?: ChartPaneLayoutId;
  panes?: ChartPaneState[];
  replayTimeframe?: ChartTimeframe;
  settingsDefaultsVersion?: number;
  showOrderOverlays: boolean;
  smoothCandles: boolean;
  timeframe: ChartTimeframe;
};

type StoredChartLayoutRecord = {
  layout: StoredChartLayout;
  name: string;
  updatedAt: string;
};

async function hydrateChartPersistence() {
  await Promise.all([
    loadAppStorageItem<unknown>(CHART_LAYOUT_STORAGE_KEY, null),
    loadAppStorageItem<unknown>(CHART_LAYOUTS_STORAGE_KEY, []),
    loadAppStorageItem<string | null>(ACTIVE_CHART_LAYOUT_STORAGE_KEY, null),
    loadAppStorageItem<string | null>(STALE_SINGLE_HORIZONTAL_PURGE_KEY, null),
    hydrateChartSettingsPresets(),
  ]);
}

function loadChartLayout(): Partial<StoredChartLayout> | null {
  purgeStaleSingleHorizontalDrawing();
  try {
    const activeName = getCachedAppStorageItem<string | null>(
      ACTIVE_CHART_LAYOUT_STORAGE_KEY,
      null,
    );
    const activeRecord = activeName ? loadChartLayoutRecord(activeName) : null;
    if (activeRecord) {
      return upgradeStoredChartLayout(activeRecord.layout);
    }

    const parsed = getCachedAppStorageItem<unknown>(CHART_LAYOUT_STORAGE_KEY, null);
    if (typeof parsed !== "object" || parsed == null) {
      return null;
    }
    return upgradeStoredChartLayout(parsed as Partial<StoredChartLayout>);
  } catch {
    return null;
  }
}

function upgradeStoredChartLayout(
  layout: Partial<StoredChartLayout>,
): Partial<StoredChartLayout> {
  if ((layout.settingsDefaultsVersion ?? 1) >= CHART_SETTINGS_DEFAULTS_VERSION) {
    return layout;
  }

  const chartSettings =
    layout.chartSettings && typeof layout.chartSettings === "object"
      ? {
          ...layout.chartSettings,
          borderVisible:
            layout.chartSettings.borderVisible === false
              ? true
              : layout.chartSettings.borderVisible ?? true,
        }
      : layout.chartSettings;

  return {
    ...layout,
    chartSettings,
    settingsDefaultsVersion: CHART_SETTINGS_DEFAULTS_VERSION,
  };
}

function purgeStaleSingleHorizontalDrawing() {
  if (getCachedAppStorageItem<string | null>(STALE_SINGLE_HORIZONTAL_PURGE_KEY, null) === "1") {
    return;
  }
  void saveAppStorageItem(STALE_SINGLE_HORIZONTAL_PURGE_KEY, "1");

  try {
    const legacyLayout = getCachedAppStorageItem<Partial<StoredChartLayout> | null>(
      CHART_LAYOUT_STORAGE_KEY,
      null,
    );
    const records = loadChartLayoutRecords();
    const layouts = [
      legacyLayout,
      ...records.map((record) => record.layout),
    ].filter((layout): layout is Partial<StoredChartLayout> => layout != null);

    const hasOnlyStaleHorizontal = layouts.some((layout) => {
      const savedDrawings = sanitizeDrawings(layout.drawings);
      return savedDrawings.length === 1 && savedDrawings[0].tool === "horizontal";
    });
    if (!hasOnlyStaleHorizontal) {
      return;
    }

    if (legacyLayout) {
      void saveAppStorageItem(CHART_LAYOUT_STORAGE_KEY, { ...legacyLayout, drawings: [] });
    }

    if (records.length > 0) {
      void saveAppStorageItem(
        CHART_LAYOUTS_STORAGE_KEY,
        records.map((record) => ({
          ...record,
          layout: {
            ...record.layout,
            drawings: [],
          },
          updatedAt: new Date().toISOString(),
        })),
      );
    }
  } catch {
    // Ignore invalid local layout JSON; normal sanitizers handle the fallback path.
  }
}

function loadActiveLayoutName() {
  return normalizeLayoutName(
    getCachedAppStorageItem<string | null>(ACTIVE_CHART_LAYOUT_STORAGE_KEY, null) ?? "Default",
  );
}

function loadInitialChartSettings() {
  const activeSettingsPreset = loadActiveChartSettingsPreset();
  if (activeSettingsPreset) {
    return activeSettingsPreset.settings;
  }
  const saved = loadChartLayout();
  return sanitizeChartVisualSettings(saved?.chartSettings);
}

function loadInitialChartPanes() {
  return sanitizeChartPanes(loadChartLayout() ?? {});
}

function loadInitialReplayTimeframe() {
  const saved = loadChartLayout();
  const activePane = Array.isArray(saved?.panes)
    ? saved.panes.find((pane) => pane?.id === saved.activePaneId) ?? saved.panes[0]
    : null;
  return sanitizeTimeframe(saved?.replayTimeframe ?? activePane?.timeframe ?? saved?.timeframe);
}

function loadSavedLayoutNames() {
  return loadChartLayoutRecords().map((record) => record.name);
}

function loadChartLayoutRecord(name: string) {
  const normalized = normalizeLayoutName(name);
  return loadChartLayoutRecords().find(
    (record) => normalizeLayoutName(record.name) === normalized,
  );
}

function loadChartLayoutRecords(): StoredChartLayoutRecord[] {
  try {
    const parsed = getCachedAppStorageItem<unknown>(CHART_LAYOUTS_STORAGE_KEY, []);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((record): record is StoredChartLayoutRecord => {
        if (typeof record !== "object" || record == null) {
          return false;
        }
        const candidate = record as Partial<StoredChartLayoutRecord>;
        return (
          typeof candidate.name === "string" &&
          typeof candidate.updatedAt === "string" &&
          typeof candidate.layout === "object" &&
          candidate.layout != null
        );
      })
      .map((record) => ({
        ...record,
        layout: upgradeStoredChartLayout(record.layout) as StoredChartLayout,
        name: normalizeLayoutName(record.name),
      }));
  } catch {
    return [];
  }
}

function saveNamedChartLayout(name: string, layout: StoredChartLayout) {
  const normalizedName = normalizeLayoutName(name);
  const records = loadChartLayoutRecords().filter(
    (record) => normalizeLayoutName(record.name) !== normalizedName,
  );
  const nextRecords = [
    {
      layout,
      name: normalizedName,
      updatedAt: new Date().toISOString(),
    },
    ...records,
  ].slice(0, 12);
  void saveAppStorageItem(CHART_LAYOUTS_STORAGE_KEY, nextRecords);
  return nextRecords.map((record) => record.name);
}

function deleteChartLayoutRecord(name: string) {
  const normalizedName = normalizeLayoutName(name);
  const nextRecords = loadChartLayoutRecords().filter(
    (record) => normalizeLayoutName(record.name) !== normalizedName,
  );
  void saveAppStorageItem(CHART_LAYOUTS_STORAGE_KEY, nextRecords);
  return nextRecords.map((record) => record.name);
}

function normalizeLayoutName(name: string) {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 48) : "Default";
}

function sanitizeMagnetMode(value: unknown): MagnetMode {
  return value === "weak" || value === "strong" ? value : "off";
}

function sanitizeIndicatorInstances(
  value: unknown,
  legacyIndicators?: unknown,
  legacySettings?: Partial<Record<ChartIndicatorId, Partial<IndicatorSettings>>> | null,
): ChartIndicatorInstance[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeIndicatorInstance(item))
      .filter((item): item is ChartIndicatorInstance => item != null);
  }

  if (Array.isArray(legacyIndicators)) {
    const cleanLegacy = legacyIndicators.filter((item): item is ChartIndicatorId =>
      VALID_LEGACY_INDICATORS.includes(item as ChartIndicatorId),
    );
    return Array.from(new Set(cleanLegacy)).map((indicator) =>
      createLegacyIndicatorInstance(indicator, legacySettings),
    );
  }

  return [createIndicatorInstance("ema")];
}

function sanitizeIndicatorInstance(value: unknown): ChartIndicatorInstance | null {
  if (typeof value !== "object" || value == null) {
    return null;
  }
  const candidate = value as Partial<ChartIndicatorInstance>;
  if (!isIndicatorKind(candidate.kind)) {
    return null;
  }
  const base = createIndicatorInstance(candidate.kind, candidate.settings);
  return {
    ...base,
    id:
      typeof candidate.id === "string" && candidate.id.trim().length > 0
        ? candidate.id.trim().slice(0, 96)
        : base.id,
    visible: candidate.visible !== false,
    createdAt:
      typeof candidate.createdAt === "string" && candidate.createdAt.length > 0
        ? candidate.createdAt
        : base.createdAt,
  };
}

function sanitizeTimeframe(value: unknown): ChartTimeframe {
  return normalizeChartTimeframe(value) ?? "1m";
}

function coerceTimeframeToSource(
  requested: ChartTimeframe,
  source: ChartTimeframe | null,
): ChartTimeframe {
  if (!source || canAggregateTimeframe(requested, source)) {
    return requested;
  }
  return source;
}

function sanitizeChartStyle(value: unknown): ChartStyle {
  return VALID_CHART_STYLES.includes(value as ChartStyle)
    ? (value as ChartStyle)
    : "candles";
}

function sanitizeDrawingTool(value: unknown): DrawingTool {
  return [
    "cursor",
    "crosshair",
    "fib",
    "horizontal",
    "longPosition",
    "measure",
    "rectangle",
    "shortPosition",
    "text",
    "trendline",
    "vertical",
  ].includes(value as DrawingTool)
    ? (value as DrawingTool)
    : "crosshair";
}

function createDefaultChartPane(
  index: number,
  template?: Partial<ChartPaneState> | null,
  sourceTimeframe?: ChartTimeframe | null,
): ChartPaneState {
  const fallbackTimeframe = effectiveSourceFallbackTimeframe(sourceTimeframe ?? null);
  return {
    chartSettings: sanitizeChartVisualSettings(template?.chartSettings),
    chartStyle: sanitizeChartStyle(template?.chartStyle),
    drawingTool: sanitizeDrawingTool(template?.drawingTool),
    drawings: [],
    id: `chart-pane-${index + 1}`,
    indicatorInstances: sanitizeIndicatorInstances(template?.indicatorInstances),
    magnetMode: sanitizeMagnetMode(template?.magnetMode),
    showOrderOverlays: template?.showOrderOverlays ?? true,
    smoothCandles: template?.smoothCandles ?? false,
    timeframe: coerceTimeframeToSource(
      sanitizeTimeframe(template?.timeframe ?? fallbackTimeframe),
      sourceTimeframe ?? null,
    ),
  };
}

function sanitizeChartPaneState(
  value: unknown,
  index = 0,
  sourceTimeframe: ChartTimeframe | null = null,
): ChartPaneState {
  const candidate =
    typeof value === "object" && value != null
      ? (value as Partial<ChartPaneState>)
      : {};
  const fallback = createDefaultChartPane(index, null, sourceTimeframe);
  const id =
    typeof candidate.id === "string" && candidate.id.trim().length > 0
      ? candidate.id.trim().slice(0, 80)
      : fallback.id;
  return {
    ...fallback,
    chartSettings: sanitizeChartVisualSettings(candidate.chartSettings),
    chartStyle: sanitizeChartStyle(candidate.chartStyle),
    drawingTool: sanitizeDrawingTool(candidate.drawingTool),
    drawings: sanitizeDrawings(candidate.drawings),
    id,
    indicatorInstances: sanitizeIndicatorInstances(candidate.indicatorInstances),
    magnetMode: sanitizeMagnetMode(candidate.magnetMode),
    showOrderOverlays: candidate.showOrderOverlays !== false,
    smoothCandles: candidate.smoothCandles === true,
    timeframe: coerceTimeframeToSource(
      sanitizeTimeframe(candidate.timeframe),
      sourceTimeframe,
    ),
  };
}

function sanitizeChartPanes(
  layout: Partial<StoredChartLayout>,
  sourceTimeframe: ChartTimeframe | null = null,
): ChartPaneState[] {
  const paneLayout = sanitizeChartPaneLayout(
    layout.paneLayout ?? DEFAULT_CHART_PANE_LAYOUT,
  );
  const paneCount = chartPaneLayoutById(paneLayout).panes;
  const legacyPane = {
    chartSettings: layout.chartSettings,
    chartStyle: layout.chartStyle,
    drawingTool: "crosshair" as DrawingTool,
    drawings: layout.drawings,
    id: "chart-pane-1",
    indicatorInstances: layout.indicatorInstances,
    magnetMode: layout.magnetMode,
    showOrderOverlays: layout.showOrderOverlays,
    smoothCandles: layout.smoothCandles,
    timeframe: layout.timeframe,
  };
  const rawPanes =
    Array.isArray(layout.panes) && layout.panes.length > 0
      ? layout.panes
      : [legacyPane];
  const panes = rawPanes.map((pane, index) =>
    sanitizeChartPaneState(pane, index, sourceTimeframe),
  );
  const seenIds = new Set<string>();
  const uniquePanes = panes.map((pane, index) => {
    const fallbackId = `chart-pane-${index + 1}`;
    const id = seenIds.has(pane.id) ? fallbackId : pane.id;
    seenIds.add(id);
    return { ...pane, id };
  });

  while (uniquePanes.length < paneCount) {
    uniquePanes.push(
      createDefaultChartPane(uniquePanes.length, uniquePanes[0], sourceTimeframe),
    );
  }

  return uniquePanes.slice(0, Math.max(paneCount, uniquePanes.length));
}

function resolveStateAction<T>(action: SetStateAction<T>, previous: T): T {
  return typeof action === "function"
    ? (action as (value: T) => T)(previous)
    : action;
}

function effectiveSourceFallbackTimeframe(sourceTimeframe: ChartTimeframe | null) {
  return sourceTimeframe ?? "1m";
}

function buildReplayTimeframeOptions(
  panes: ChartPaneState[],
  sourceTimeframe: ChartTimeframe | null,
): ReplayTimeframeOption[] {
  const source = effectiveSourceFallbackTimeframe(sourceTimeframe);
  const orderedTimeframes = [
    source,
    ...panes.map((pane) => coerceTimeframeToSource(pane.timeframe, sourceTimeframe)),
    ...TIMEFRAMES.map((timeframe) => timeframe.id),
  ];
  const seen = new Set<string>();
  return orderedTimeframes.flatMap((timeframe) => {
    const normalized = normalizeChartTimeframe(timeframe);
    if (!normalized || seen.has(normalized) || !canAggregateTimeframe(normalized, sourceTimeframe)) {
      return [];
    }
    seen.add(normalized);
    const stepBars = getReplayStepBars(normalized, sourceTimeframe);
    return [
      {
        label: `${formatChartTimeframeLabel(normalized)} bars`,
        sublabel: stepBars === 1 ? "Source step" : `${stepBars} source bars`,
        value: normalized,
      },
    ];
  });
}

function getReplayStepBars(
  replayTimeframe: ChartTimeframe,
  sourceTimeframe: ChartTimeframe | null,
) {
  if (!sourceTimeframe || !canAggregateTimeframe(replayTimeframe, sourceTimeframe)) {
    return 1;
  }
  return Math.max(
    1,
    Math.round(getTimeframeSeconds(replayTimeframe) / getTimeframeSeconds(sourceTimeframe)),
  );
}

function toChartTimeframe(value: string | null | undefined): ChartTimeframe | null {
  return normalizeChartTimeframe(value);
}

function sanitizeDrawings(value: unknown): ChartDrawing[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((drawing): ChartDrawing[] => {
    if (typeof drawing !== "object" || drawing == null) {
      return [];
    }
    const candidate = drawing as Partial<ChartDrawing>;
    const isValid =
      typeof candidate.id === "string" &&
      [
        "fib",
        "horizontal",
        "vertical",
        "longPosition",
        "measure",
        "rectangle",
        "shortPosition",
        "text",
        "trendline",
      ].includes(candidate.tool ?? "") &&
      typeof candidate.color === "string" &&
      typeof candidate.createdAt === "string" &&
      (candidate.fillOpacity == null ||
        (typeof candidate.fillOpacity === "number" &&
          Number.isFinite(candidate.fillOpacity))) &&
      (candidate.fibExtendLeft == null ||
        typeof candidate.fibExtendLeft === "boolean") &&
      (candidate.fibExtendRight == null ||
        typeof candidate.fibExtendRight === "boolean") &&
      (candidate.label == null || typeof candidate.label === "string") &&
      (candidate.labelBackgroundOpacity == null ||
        (typeof candidate.labelBackgroundOpacity === "number" &&
          Number.isFinite(candidate.labelBackgroundOpacity))) &&
      (candidate.lineStyle == null ||
        ["solid", "dashed", "dotted"].includes(candidate.lineStyle)) &&
      (candidate.lineWidth == null ||
        (typeof candidate.lineWidth === "number" && Number.isFinite(candidate.lineWidth))) &&
      (candidate.locked == null || typeof candidate.locked === "boolean") &&
      (candidate.rewardColor == null || typeof candidate.rewardColor === "string") &&
      (candidate.riskColor == null || typeof candidate.riskColor === "string") &&
      (candidate.visible == null || typeof candidate.visible === "boolean") &&
      Array.isArray(candidate.points) &&
      candidate.points.every(
        (point) =>
          typeof point.time === "number" &&
          typeof point.price === "number" &&
          Number.isFinite(point.time) &&
          Number.isFinite(point.price) &&
          (point.logical == null ||
            (typeof point.logical === "number" && Number.isFinite(point.logical))),
      );

    if (!isValid) {
      return [];
    }

    const normalized =
      candidate.tool === "fib"
        ? ({
            ...candidate,
            fibExtendLeft: candidate.fibExtendLeft === true,
            fibExtendRight: candidate.fibExtendRight !== false,
            fibLevels: normalizeFibLevels(candidate.fibLevels, candidate.color),
          } as ChartDrawing)
        : (candidate as ChartDrawing);
    return [
      normalized.tool === "measure" && normalized.lineStyle === "dashed"
        ? { ...normalized, lineStyle: "solid" }
        : normalized,
    ];
  });
}

function cloneDrawingsForHistory(drawings: ChartDrawing[]) {
  return drawings.map((drawing) => ({
    ...drawing,
    fibLevels: drawing.fibLevels?.map((level) => ({ ...level })),
    points: drawing.points.map((point) => ({ ...point })),
  }));
}

function drawingCollectionsEqual(left: ChartDrawing[], right: ChartDrawing[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isSystemUndoShortcut(event: KeyboardEvent) {
  const isUndoKey = event.key.toLowerCase() === "z";
  if (!isUndoKey || event.shiftKey || event.altKey) {
    return false;
  }
  return isApplePlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

function systemUndoShortcutLabel() {
  return isApplePlatform() ? "Cmd+Z" : "Ctrl+Z";
}

function isApplePlatform() {
  if (typeof navigator === "undefined") {
    return false;
  }
  const userAgentDataPlatform =
    "userAgentData" in navigator
      ? (navigator.userAgentData as { platform?: string } | undefined)?.platform
      : undefined;
  const platform = userAgentDataPlatform ?? navigator.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

function HeaderStat({
  label,
  value,
  tone = "text-white",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="min-w-32 rounded-md border border-white/10 bg-black/20 px-3 py-2">
      <div className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function money(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function costValueForPayload(mode: string | null | undefined, value: number | null | undefined) {
  return mode === "FIXED" || mode === "PERCENT" ? Math.max(Number(value) || 0, 0) : 0;
}

function findLatestRiskRewardDrawing(drawings: ChartDrawing[]) {
  for (let index = drawings.length - 1; index >= 0; index -= 1) {
    const drawing = drawings[index];
    if (
      drawing.visible !== false &&
      (drawing.tool === "longPosition" || drawing.tool === "shortPosition") &&
      drawing.points.length >= 2
    ) {
      return drawing;
    }
  }
  return null;
}

function strategyScopeForTrade(
  trade: Trade,
  sessions: { id: number; strategy_name: string | null }[],
  activeSession: { id: number; strategy_name: string | null } | null,
) {
  const session =
    activeSession?.id === trade.session_id
      ? activeSession
      : sessions.find((item) => item.id === trade.session_id);
  return session ? tradeStrategyName(trade, session) : trade.strategy_name;
}
