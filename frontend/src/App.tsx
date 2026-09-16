import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { SetStateAction } from "react";
import { Link, useLocation } from "react-router-dom";
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
  Share2,
  Settings2,
  LineChart,
  ScrollText,
  WalletCards,
} from "lucide-react";
import { ExecutionTape } from "./components/ExecutionTape";
import { FilteredTradeReview } from "./components/FilteredTradeReview";
import { GlobalCommandPalette } from "./components/GlobalCommandPalette";
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
import { SessionGatewayUnavailable } from "./components/SessionGatewayUnavailable";
import { TradeDetailDrawer } from "./components/TradeDetailDrawer";
import { WorkspaceMobileNav } from "./components/WorkspaceMobileNav";
import { WorkspaceContextHeader } from "./components/WorkspaceContextHeader";
import { WorkspaceShareDialog } from "./components/WorkspaceShareDialog";
import { EdgePulseLoader } from "./components/EdgePulseLoader";
import { ChartWorkspaceFrame } from "./components/chart/ChartWorkspaceFrame";
import { usePaneMarketData } from "./components/chart/usePaneMarketData";
import type { JournalChartFocusRequest } from "./components/journal/JournalReviewDrawer";
import {
  buildMarketingNavItems,
  MarketingShell,
} from "./components/marketing/MarketingShell";
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
  isDrawingTool,
  TIMEFRAMES,
} from "./lib/charting";
import {
  DEFAULT_CHART_SYNC_SETTINGS,
  buildChartSymbolUniverse,
  chartSymbolsEqual,
  chartSymbolTypeaheadQuery,
  mapDrawingToPane,
  nextWorkspaceRevision,
  normalizeChartCandles,
  normalizeChartSymbol,
  sanitizeChartSyncSettings,
  shouldMapDrawingToPane,
  type ChartSyncSettings,
  type SyncedChartCrosshair,
  type SyncedChartVisibleRange,
} from "./lib/chartWorkspace";
import {
  DEFAULT_CHART_PANE_LAYOUT,
  chartPaneLayoutById,
  sanitizeChartPaneLayout,
  shouldMountPaneDrawingControls,
  type ChartPaneLayoutId,
} from "./lib/chartLayouts";
import {
  captureVisibleChartGridPng,
  type ChartCaptureStatus,
} from "./lib/chartCapture";
import {
  hydrateChartInteractionPreferences,
  loadCachedChartInteractionPreferences,
  persistChartInteractionPreferences,
  subscribeChartInteractionPreferences,
} from "./lib/chartInteractionPreferences";
import {
  FIRST_PARTY_EDGE_INDICATORS,
  appendIndicatorAudit,
  createCustomIndicatorInstance,
  hydrateCustomIndicators,
  loadCachedCustomIndicators,
  persistCustomIndicators,
  saveCustomIndicator,
  subscribeCustomIndicators,
  type CustomIndicatorScript,
} from "./lib/customIndicators";
import type { EdgeIndicatorInputValue } from "./lib/indicatorDsl";
import {
  appendQuantAudit,
  snapshotQuantChartContext,
  type QuantCaptureAttachment,
  type QuantChartContext,
  type QuantGeneratedIndicator,
  type QuantSelectedRegion,
} from "./lib/quantAssistant";
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
import {
  listCanonicalTrades,
  listJournalAccounts,
  listJournalDailyNotes,
  type CanonicalTrade,
  type JournalAccount,
  type JournalDailyNote,
} from "./lib/journalApi";
import { journalDeepLink } from "./lib/journalWorkspaceState";
import {
  applyJournalFocusDrawings,
  journalFocusMatchesSymbol,
  journalFocusVisibleRange,
} from "./lib/journalChartFocus";
import { trackDiagnosticWebSocket } from "./lib/browserDiagnostics";
import type { SearchableCommandEntity } from "./lib/uiFoundation";
import {
  buildWorkspaceSharePayload,
  sanitizeWorkspaceShareCopyArtifact,
  workspaceShareCopyStorageKey,
  workspaceShareScopeLabel,
  type WorkspaceShareCandle,
  type WorkspaceShareCopyArtifact,
  type WorkspaceShareMetrics,
  type WorkspaceShareScope,
} from "./lib/workspaceShare";
import type { WorkspaceView } from "./lib/workspace";
import { workspaceViewFromPath } from "./lib/workspaceRoute";
import { rememberWindowScroll, restoreWindowScroll } from "./lib/navigationState";
import {
  loadWorkspaceSidebarCollapsed,
  saveWorkspaceSidebarCollapsed,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EXPANDED_WIDTH,
} from "./lib/workspaceNavigation";
import { useBacktestStore } from "./store/backtestStore";
import { shallow } from "zustand/shallow";

const CHART_LAYOUT_STORAGE_KEY = "chart-layout.v1";
const CHART_LAYOUTS_STORAGE_KEY = "chart-layouts.v1";
const ACTIVE_CHART_LAYOUT_STORAGE_KEY = "active-chart-layout.v1";
const DRAWING_UNDO_LIMIT = 50;
const DRAWING_UNDO_COALESCE_MS = 350;
const TIMEFRAME_SHORTCUT_CLEAR_MS = 1200;
const CHART_SETTINGS_DEFAULTS_VERSION = 2;
const CHART_WORKSPACE_SCHEMA_VERSION = 2;
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
const IndicatorEditorPanel = lazy(() =>
  import("./components/IndicatorEditorPanel").then((module) => ({
    default: module.IndicatorEditorPanel,
  })),
);
const QuantPanel = lazy(() =>
  import("./components/QuantPanel").then((module) => ({
    default: module.QuantPanel,
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

function AppLoadingSpinner({ className = "", label = "Loading" }: { className?: string; label?: string }) {
  return (
    <div
      aria-label={label}
      className={`grid min-h-32 place-items-center ${className}`}
      role="status"
    >
      <EdgePulseLoader label={label} labelClassName="text-slate-400" showLabel size="lg" />
    </div>
  );
}

function WorkspaceLoadingPanel() {
  return <AppLoadingSpinner className="min-h-screen bg-[#05070a]" label="Opening workspace" />;
}

function BacktestLoadingPanel() {
  return <AppLoadingSpinner className="mb-4 rounded-md bg-[#050b11]/70 py-10" label="Loading session" />;
}

function LazyPanelFallback({ className = "" }: { className?: string }) {
  return <AppLoadingSpinner className={className} label="Loading panel" />;
}

function ChartChunkFallback() {
  return (
    <div className="chart-studio-layout chart-studio-layout-focus">
      <AppLoadingSpinner className="min-h-[520px] rounded-md bg-[#050b11]/70" label="Loading chart" />
    </div>
  );
}

export function NotFoundPage() {
  return (
    <MarketingShell
      navItems={buildMarketingNavItems("inner")}
      pageDescription="The requested EdgeLab page is unavailable. Return to the public site or review current beta access."
      pageTitle="Page not found"
    >
      <section className="px-3 py-16 sm:px-6 sm:py-24 lg:px-8 lg:py-32">
        <div className="mx-auto grid max-w-6xl border-y border-edgelab-border lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.55fr)]">
          <div className="py-12 lg:pr-16 lg:py-20">
            <div className="flex items-center gap-3 font-data text-xs uppercase tracking-[0.18em] text-amber-100">
              <AlertTriangle aria-hidden="true" size={17} />
              404 / route unavailable
            </div>
            <h1 className="mt-6 max-w-3xl text-balance text-[clamp(3rem,7vw,5.75rem)] font-medium leading-[0.92] tracking-[-0.04em] text-edgelab-text-primary">
              Page not found.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-8 text-edgelab-text-secondary sm:text-lg">
              EdgeLab does not have a public route for this address. Nothing in your workspace was
              changed.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                className="inline-flex min-h-12 items-center justify-center rounded-el-md bg-edgelab-accent px-5 py-3 text-sm font-semibold text-ink-950 transition-colors hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100"
                to="/"
              >
                Return to EdgeLab home
              </Link>
              <Link
                className="inline-flex min-h-12 items-center justify-center rounded-el-md border border-edgelab-border bg-edgelab-surface px-5 py-3 text-sm font-medium text-edgelab-text-primary transition-colors hover:border-cyan-300/40 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
                to="/pricing"
              >
                Review beta access
              </Link>
            </div>
          </div>
          <aside className="border-t border-edgelab-border py-10 lg:border-l lg:border-t-0 lg:px-10 lg:py-20">
            <p className="font-data text-xs uppercase tracking-[0.18em] text-cyan-100">
              Safe next step
            </p>
            <h2 className="mt-4 text-xl font-medium tracking-[-0.02em] text-edgelab-text-primary">
              Start from a known route.
            </h2>
            <p className="mt-4 text-sm leading-7 text-edgelab-text-secondary">
              Use the home page for the product overview, or pricing for current beta availability
              and limits. A valid workspace link will ask you to sign in before opening account
              data.
            </p>
          </aside>
        </div>
      </section>
    </MarketingShell>
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
  symbol: string;
  dataSourceId: string | null;
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
const VALID_CHART_STYLES: ChartStyle[] = [
  "area",
  "candles",
  "footprint",
  "heikinAshi",
  "line",
  "tpo",
];

export function WorkspaceApp() {
  const location = useLocation();
  const {
    bars,
    barOffset,
    datasets,
    meta,
    state,
    replaySeekVersion,
    playbooks,
    resultSessions,
    resultSessionsHasMore,
    resultSessionsLoadError,
    strategySummaries,
    resultTrades,
    resultTradesLoading,
    resultTradesLoadError,
    ensureResultTradesLoaded,
    ensureLatestReplayLoaded,
    error,
    isLoading,
    isLoadingMoreSessions,
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
    loadMoreSessions,
    jumpToOffset,
    amendOrder,
    placeOrder,
    setPlaying,
    stepBackward,
    stepForward,
    updatePosition,
  } = useBacktestStore(
    (store) => ({
      bars: store.bars,
      barOffset: store.barOffset,
      datasets: store.datasets,
      meta: store.meta,
      state: store.state,
      replaySeekVersion: store.replaySeekVersion,
      playbooks: store.playbooks,
      resultSessions: store.resultSessions,
      resultSessionsHasMore: store.resultSessionsHasMore,
      resultSessionsLoadError: store.resultSessionsLoadError,
      strategySummaries: store.strategySummaries,
      resultTrades: store.resultTrades,
      resultTradesLoading: store.resultTradesLoading,
      resultTradesLoadError: store.resultTradesLoadError,
      ensureResultTradesLoaded: store.ensureResultTradesLoaded,
      ensureLatestReplayLoaded: store.ensureLatestReplayLoaded,
      error: store.error,
      isLoading: store.isLoading,
      isLoadingMoreSessions: store.isLoadingMoreSessions,
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
      loadMoreSessions: store.loadMoreSessions,
      jumpToOffset: store.jumpToOffset,
      amendOrder: store.amendOrder,
      placeOrder: store.placeOrder,
      setPlaying: store.setPlaying,
      stepBackward: store.stepBackward,
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
  const [journalChartFocus, setJournalChartFocus] = useState<JournalChartFocusRequest | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceView>(() =>
    workspaceViewFromPath(window.location.pathname),
  );
  const [commandJournalData, setCommandJournalData] = useState<{
    accounts: JournalAccount[];
    notes: JournalDailyNote[];
    trades: CanonicalTrade[];
  }>({ accounts: [], notes: [], trades: [] });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadWorkspaceSidebarCollapsed);
  const [sessionGateOpen, setSessionGateOpen] = useState(
    () => workspaceViewFromPath(window.location.pathname) !== "backtest",
  );
  const [leftPaneOpen, setLeftPaneOpen] = useState(false);
  const [orderTicketSide, setOrderTicketSide] = useState<"BUY" | "SELL" | null>(null);
  const [chartToolsOpen, setChartToolsOpen] = useState(false);
  const [chartSettingsPanelOpen, setChartSettingsPanelOpen] = useState(false);
  const [chartSettingsOpenSignal, setChartSettingsOpenSignal] = useState(0);
  const [layersPanelOpen, setLayersPanelOpen] = useState(false);
  const [workspacePanel, setWorkspacePanel] = useState<"none" | "tape" | "review" | "results">("none");
  const [workspaceShareOpen, setWorkspaceShareOpen] = useState(false);
  const [sharedCopyNotice, setSharedCopyNotice] = useState<string | null>(null);
  const [activeSharedCopy, setActiveSharedCopy] = useState<WorkspaceShareCopyArtifact | null>(null);
  const [activeSharedCopyLocalOnly, setActiveSharedCopyLocalOnly] = useState(false);
  const [sharedCopyResolving, setSharedCopyResolving] = useState(() => {
    if (typeof window === "undefined") return false;
    const params = new URL(window.location.href).searchParams;
    return params.has("workspaceCopy");
  });
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
  const chartPaneGridRef = useRef<HTMLDivElement | null>(null);
  const skipNextToolsClickRef = useRef(false);
  const [chartCapture, setChartCapture] = useState<{
    message: string;
    status: ChartCaptureStatus;
  }>({ message: "", status: "idle" });
  const [chartCaptureMode, setChartCaptureMode] = useState(false);
  const [customIndicatorScripts, setCustomIndicatorScripts] = useState<CustomIndicatorScript[]>(
    loadCachedCustomIndicators,
  );
  const [indicatorEditorRequest, setIndicatorEditorRequest] = useState<{
    nonce: number;
    scriptId?: string;
    source?: string;
  } | null>(null);
  const [quantOpen, setQuantOpen] = useState(
    () => typeof window !== "undefined" && window.location.pathname === "/app/quant",
  );
  const [quantAttachment, setQuantAttachment] = useState<QuantCaptureAttachment | null>(null);
  const [quantRegionSelecting, setQuantRegionSelecting] = useState(false);
  const [quantRegionDraft, setQuantRegionDraft] = useState<{
    currentX: number;
    currentY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const [chartInteractionPreferences, setChartInteractionPreferences] = useState(
    loadCachedChartInteractionPreferences,
  );
  const [chartLayoutSavedAt, setChartLayoutSavedAt] = useState<number | null>(null);
  const [layoutName, setLayoutName] = useState(() =>
    loadChartLayoutRecords().find((record) => record.isStartup)?.name ?? loadActiveLayoutName(),
  );
  const [availableLayouts, setAvailableLayouts] = useState(() => loadSavedLayoutNames());
  const [defaultLayoutName, setDefaultLayoutName] = useState<string | null>(() =>
    loadChartLayoutRecords().find((record) => record.isDefault)?.name ?? null,
  );
  const [startupLayoutName, setStartupLayoutName] = useState<string | null>(() =>
    loadChartLayoutRecords().find((record) => record.isStartup)?.name ?? null,
  );
  const [workspaceRecoveryMessage, setWorkspaceRecoveryMessage] = useState<string | null>(null);
  const [chartPersistenceHydrated, setChartPersistenceHydrated] = useState(false);
  const [chartSyncSettings, setChartSyncSettings] = useState<ChartSyncSettings>(() =>
    sanitizeChartSyncSettings(loadChartLayout()?.syncSettings),
  );
  const [syncedCrosshair, setSyncedCrosshair] = useState<SyncedChartCrosshair | null>(null);
  const [syncedVisibleRange, setSyncedVisibleRange] = useState<SyncedChartVisibleRange | null>(null);
  const [journalFocusRange, setJournalFocusRange] = useState<SyncedChartVisibleRange | null>(null);
  const [drawingMarker, setDrawingMarker] = useState("★");
  const workspaceRevisionRef = useRef(loadChartLayout()?.revision ?? 0);
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
  const replayPaneMarketData = usePaneMarketData(
    visibleChartPanes
      .filter((pane) => !chartSymbolsEqual(pane.symbol, state?.session.symbol))
      .map((pane) => ({ id: pane.id, symbol: pane.symbol, timeframe: pane.timeframe })),
    activeWorkspace === "backtest" && !sessionGateOpen,
  );
  const isMultiChartLayout = visibleChartPanes.length > 1;
  const chartPaneLayoutDefinition = chartPaneLayoutById(chartPaneLayout);
  const chartSymbolOptions = useMemo(
    () => buildChartSymbolUniverse(datasets, state?.session.symbol),
    [datasets, state?.session.symbol],
  );
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
  const maxReplayTimeframe = coerceTimeframeToSource(timeframe, sourceTimeframe);
  const replayTimeframeOptions = useMemo(
    () => buildReplayTimeframeOptions(visibleChartPanes, sourceTimeframe, maxReplayTimeframe),
    [maxReplayTimeframe, sourceTimeframe, visibleChartPanes],
  );
  const [replayTimeframe, setReplayTimeframe] = useState<ChartTimeframe>(() =>
    loadInitialReplayTimeframe(),
  );
  const normalizedReplayTimeframe =
    replayTimeframeOptions.find((option) => option.value === replayTimeframe)?.value ??
    replayTimeframeOptions[0]?.value ??
    effectiveSourceFallbackTimeframe(sourceTimeframe);
  const replayStepBars = getReplayStepBars(normalizedReplayTimeframe, sourceTimeframe);
  const normalizedVisibleData = useMemo(() => {
    const currentOffset = state?.session.current_offset;
    const visibleCount = currentOffset == null
      ? bars.length
      : Math.max(0, Math.min(bars.length, currentOffset - barOffset + 1));
    return normalizeChartCandles(
      bars.slice(0, visibleCount),
      getTimeframeSeconds(sourceTimeframe ?? "1m"),
      { live: false },
    );
  }, [barOffset, bars, sourceTimeframe, state?.session.current_offset]);
  const visibleBars = normalizedVisibleData.bars;
  const allCustomIndicatorScripts = useMemo(
    () => [...FIRST_PARTY_EDGE_INDICATORS, ...customIndicatorScripts],
    [customIndicatorScripts],
  );
  const quantContext: QuantChartContext = {
    activeIndicators: indicatorInstances,
    chartSettings,
    drawings,
    history: {
      barCount: visibleBars.length,
      firstTimestamp: visibleBars[0]?.timestamp ?? null,
      lastTimestamp: visibleBars.at(-1)?.timestamp ?? null,
      sampled: visibleBars.length > 2_000,
    },
    provider: activeChartPane.dataSourceId
      ? `dataset:${activeChartPane.dataSourceId}`
      : `backtest:${state?.session.id ?? "draft"}`,
    selectedObjectId: selectedDrawingId,
    selectedRegion: quantAttachment?.region ?? null,
    sessionMode: chartSettings.tradingHoursMode,
    symbol: activeChartPane.symbol,
    timeframe: coerceTimeframeToSource(timeframe, sourceTimeframe),
    timezone: chartSettings.timeZone,
    visibleBars: visibleBars.slice(-2_000),
  };
  const playbackStepBars = replayStepBars;
  const playbackTickMs = Math.max(
    16,
    Math.round(speedMs / Math.max(replayStepBars, 1)),
  );

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
    const next = resolveStateAction(action, activeChartPane.timeframe);
    const visibleIds = new Set(visibleChartPanes.map((pane) => pane.id));
    setChartPanes((current) => current.map((pane) =>
      pane.id === activeChartPane.id || (chartSyncSettings.interval && visibleIds.has(pane.id))
        ? { ...pane, timeframe: next }
        : pane,
    ));
  }

  function setChartStyle(action: SetStateAction<ChartStyle>) {
    const next = resolveStateAction(action, activeChartPane.chartStyle);
    const visibleIds = new Set(visibleChartPanes.map((pane) => pane.id));
    setChartPanes((current) => current.map((pane) =>
      pane.id === activeChartPane.id || (chartSyncSettings.style && visibleIds.has(pane.id))
        ? { ...pane, chartStyle: next, smoothCandles: next === "heikinAshi" }
        : pane,
    ));
  }

  function applyChartSettingsToCurrentScope(
    action: SetStateAction<ChartVisualSettings>,
  ) {
    const resolveSettings = (previous: ChartVisualSettings) =>
      sanitizeChartVisualSettings(resolveStateAction(action, previous));
    const next = resolveSettings(activeChartPane.chartSettings);
    const visibleIds = new Set(visibleChartPanes.map((pane) => pane.id));
    setChartPanes((current) => current.map((pane) =>
      pane.id === activeChartPane.id || (chartSyncSettings.style && visibleIds.has(pane.id))
        ? { ...pane, chartSettings: next }
        : pane,
    ));
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
    const next = resolveStateAction(action, activeChartPane.smoothCandles);
    const visibleIds = new Set(visibleChartPanes.map((pane) => pane.id));
    setChartPanes((current) => current.map((pane) =>
      pane.id === activeChartPane.id || (chartSyncSettings.style && visibleIds.has(pane.id))
        ? { ...pane, smoothCandles: next }
        : pane,
    ));
  }

  function changeChartSymbol(symbol: string) {
    const option = chartSymbolOptions.find((item) => chartSymbolsEqual(item.symbol, symbol));
    const nextSymbol = option?.symbol ?? symbol.trim().toUpperCase();
    if (!normalizeChartSymbol(nextSymbol)) return;
    const visibleIds = new Set(visibleChartPanes.map((pane) => pane.id));
    setChartPanes((current) => current.map((pane) =>
      pane.id === activeChartPane.id || (chartSyncSettings.symbol && visibleIds.has(pane.id))
        ? { ...pane, symbol: nextSymbol, dataSourceId: option?.sourceId ?? null }
        : pane,
    ));
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
    setActiveWorkspace(workspaceViewFromPath(location.pathname));
    if (location.pathname === "/app/replay") setSessionGateOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    let active = true;
    void hydrateChartInteractionPreferences().then((preferences) => {
      if (active) {
        setChartInteractionPreferences(preferences);
      }
    });
    const unsubscribe = subscribeChartInteractionPreferences((preferences) => {
      if (active) {
        setChartInteractionPreferences(preferences);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    void hydrateCustomIndicators().then((scripts) => {
      if (active) setCustomIndicatorScripts(scripts);
    });
    const unsubscribe = subscribeCustomIndicators((scripts) => {
      if (active) setCustomIndicatorScripts(scripts);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!quantRegionSelecting) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setQuantRegionDraft(null);
      setQuantRegionSelecting(false);
      setChartCapture({ message: "Chart region selection cancelled.", status: "idle" });
    };
    document.addEventListener("keydown", cancel, true);
    return () => document.removeEventListener("keydown", cancel, true);
  }, [quantRegionSelecting]);

  useEffect(() => {
    saveWorkspaceSidebarCollapsed(sidebarCollapsed);
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (activeWorkspace === "sessions" || activeWorkspace === "backtest") {
      return;
    }
    void ensureResultTradesLoaded();
  }, [activeWorkspace, ensureResultTradesLoaded]);

  useEffect(() => {
    if (activeWorkspace !== "backtest" || sessionGateOpen || state != null || isLoading) {
      return;
    }
    void ensureLatestReplayLoaded();
  }, [activeWorkspace, ensureLatestReplayLoaded, isLoading, sessionGateOpen, state]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let stopped = false;

    const connect = () => {
      if (stopped) {
        return;
      }
      const socketUrl = getApiWebSocketUrl("/datasets/stream");
      socket = new WebSocket(socketUrl);
      trackDiagnosticWebSocket(socket, socketUrl);
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
    void hydrateChartPersistence().then(async () => {
      if (!active) {
        return;
      }
      const saved = loadChartLayout();
      if (saved) {
        applyChartLayout(saved);
      }
      const hydratedRecords = loadChartLayoutRecords();
      setLayoutName(hydratedRecords.find((record) => record.isStartup)?.name ?? loadActiveLayoutName());
      setAvailableLayouts(hydratedRecords.map((record) => record.name));
      setDefaultLayoutName(hydratedRecords.find((record) => record.isDefault)?.name ?? null);
      setStartupLayoutName(hydratedRecords.find((record) => record.isStartup)?.name ?? null);
      const activeSettingsPreset = loadActiveChartSettingsPreset();
      if (activeSettingsPreset) {
        applyChartSettingsToCurrentScope(activeSettingsPreset.settings);
      }
      setChartPersistenceHydrated(true);

      const url = new URL(window.location.href);
      const requestedCopyId = url.searchParams.get("workspaceCopy");
      if (!requestedCopyId) {
        setSharedCopyResolving(false);
        return;
      }
      let copyStorageKey: string;
      try {
        copyStorageKey = workspaceShareCopyStorageKey(requestedCopyId);
      } catch {
        setSharedCopyNotice("That copied snapshot link is invalid.");
        url.searchParams.delete("workspaceCopy");
        url.searchParams.delete("copyPersistence");
        window.history.replaceState(
          window.history.state,
          "",
          `${url.pathname}${url.search}${url.hash}`,
        );
        setSharedCopyResolving(false);
        return;
      }
      const requestedCopy = sanitizeWorkspaceShareCopyArtifact(
        await loadAppStorageItem<unknown>(copyStorageKey, null),
      );
      if (!active) {
        return;
      }
      if (requestedCopy?.id === requestedCopyId) {
        setActiveSharedCopy(requestedCopy);
        setActiveSharedCopyLocalOnly(url.searchParams.get("copyPersistence") === "local");
        setSharedCopyNotice(null);
      } else {
        setSharedCopyNotice("That copied snapshot is no longer available in this account.");
        url.searchParams.delete("workspaceCopy");
        url.searchParams.delete("copyPersistence");
        window.history.replaceState(
          window.history.state,
          "",
          `${url.pathname}${url.search}${url.hash}`,
        );
      }
      setSharedCopyResolving(false);
    }).catch(() => {
      if (active) {
        setChartPersistenceHydrated(true);
        setSharedCopyResolving(false);
        setSharedCopyNotice("The copied snapshot could not be loaded from this account.");
      }
    });
    const unsubscribeLayouts = subscribeAppStorageItem<unknown>(
      CHART_LAYOUTS_STORAGE_KEY,
      () => {
        const records = loadChartLayoutRecords();
        setAvailableLayouts(records.map((record) => record.name));
        setDefaultLayoutName(records.find((record) => record.isDefault)?.name ?? null);
        setStartupLayoutName(records.find((record) => record.isStartup)?.name ?? null);
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
    if (!chartPersistenceHydrated || !availableLayouts.includes(normalizeLayoutName(layoutName))) {
      return;
    }
    const timer = window.setTimeout(() => {
      persistWorkspaceRecord(normalizeLayoutName(layoutName), buildChartLayoutPayload(drawingsRef.current));
      setChartLayoutSavedAt(Date.now());
    }, 700);
    return () => window.clearTimeout(timer);
  }, [
    chartPersistenceHydrated,
    chartPaneLayout,
    chartPanes,
    chartSyncSettings,
    fullscreenOrderPanelOpen,
    layersPanelOpen,
    leftPaneOpen,
    layoutName,
    sidebarCollapsed,
    workspacePanel,
  ]);

  useEffect(() => {
    if (sourceTimeframe) {
      setChartPanes((current) =>
        current.map((pane, index) => ({
          ...pane,
          symbol: index === 0 && state?.session.symbol ? state.session.symbol : pane.symbol,
          dataSourceId: index === 0 ? null : pane.dataSourceId,
          timeframe:
            index === 0
              ? sourceTimeframe
              : coerceTimeframeToSource(pane.timeframe, sourceTimeframe),
        })),
      );
      setReplayTimeframe(sourceTimeframe);
    }
  }, [state?.session.id, state?.session.symbol, sourceTimeframe]);

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
      replayTimeframeOptions.find((option) => option.value === maxReplayTimeframe)?.value ??
        replayTimeframeOptions[0]?.value ??
        effectiveSourceFallbackTimeframe(sourceTimeframe),
    );
  }, [maxReplayTimeframe, replayTimeframe, replayTimeframeOptions, sourceTimeframe]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }
    const timer = window.setInterval(() => {
      if (useBacktestStore.getState().isStepping) {
        return;
      }
      void stepForward(playbackStepBars);
    }, playbackTickMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [isPlaying, playbackStepBars, playbackTickMs, stepForward]);

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

      const symbolSearchQuery = chartSymbolTypeaheadQuery(event);
      if (symbolSearchQuery != null) {
        event.preventDefault();
        setChartSettingsPanelOpen(false);
        setChartToolsOpen(true);
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent("edgelab:open-symbol-search", { detail: { query: symbolSearchQuery } }));
        }, 0);
        return;
      }

      switch (event.key) {
        case "ArrowRight":
          event.preventDefault();
          void stepForward(playbackStepBars);
          break;
        case "ArrowLeft":
          event.preventDefault();
          void stepBackward(playbackStepBars);
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
  }, [drawingTool, isChartFullscreen, isPlaying, playbackStepBars, removeLastUnlockedDrawing, selectedDrawingId, setPlaying, sourceTimeframe, stepBackward, stepForward, undoLastDrawingChange]);

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
  useEffect(() => {
    if (activeWorkspace === "backtest" || activeWorkspace === "notebook") return;
    return restoreWindowScroll(activeWorkspace);
  }, [activeWorkspace]);
  useEffect(() => {
    let cancelled = false;
    const loadCommandJournalData = () => {
      void Promise.all([
        listJournalAccounts(),
        listCanonicalTrades({ limit: 200 }),
        listJournalDailyNotes(),
      ]).then(([accounts, canonicalTrades, notes]) => {
        if (!cancelled) setCommandJournalData({ accounts, notes, trades: canonicalTrades });
      }).catch(() => {
        // The public/auth routes share this root. Journal commands appear after authentication succeeds.
      });
    };
    loadCommandJournalData();
    window.addEventListener("edgelab:command-palette-open", loadCommandJournalData);
    return () => {
      cancelled = true;
      window.removeEventListener("edgelab:command-palette-open", loadCommandJournalData);
    };
  }, []);
  const commandEntities = useMemo<SearchableCommandEntity[]>(() => {
    const tradeCommands = resultTrades.slice(0, 100).map((trade) => {
      const session = resultSessions.find((candidate) => candidate.id === trade.session_id);
      return {
        id: String(trade.id),
        kind: "trade" as const,
        label: `${session?.symbol ?? "Trade"} · ${trade.side} · ${new Date(trade.entry_time).toLocaleDateString()}`,
        detail: `${trade.status === "CLOSED" ? "Closed" : "Open"} trade${trade.strategy_name ? ` · ${trade.strategy_name}` : ""}`,
        keywords: `${trade.notes ?? ""} ${trade.mistake_tags.join(" ")} ${trade.emotional_state ?? ""}`,
        run: () => { setReviewTrade(trade); },
      };
    });
    const noteCommands = resultTrades.filter((trade) => trade.notes?.trim()).slice(0, 50).map((trade) => ({
      id: String(trade.id),
      kind: "note" as const,
      label: trade.notes!.split(/\r?\n/)[0].slice(0, 80),
      detail: `Replay note · trade ${trade.id}`,
      keywords: trade.notes!,
      run: () => openTradeNoteFromLog(trade),
    }));
    const workspaceCommands = availableLayouts.map((name) => ({
      id: name,
      kind: "workspace" as const,
      label: name,
      detail: name === layoutName ? "Current chart workspace" : "Load saved chart workspace",
      keywords: "layout panes chart saved",
      run: () => { loadNamedChartLayout(name); navigateWorkspace("backtest"); },
    }));
    const accountCommands = commandJournalData.accounts.map((account) => ({
      id: String(account.id),
      kind: "account" as const,
      label: account.name,
      detail: `${account.provider} · ${account.currency} · ${account.status === "ACTIVE" ? "Active account" : "Archived account"}`,
      keywords: `${account.source_type} ${account.timezone} trading journal`,
      run: () => {
        window.history.pushState(null, "", journalDeepLink({ surface: "accounts", tradeId: null, date: null, accountId: account.id, segment: null, returnTo: null }));
        navigateWorkspace("journalAccounts");
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      },
    }));
    const canonicalTradeCommands = commandJournalData.trades.map((trade) => ({
      id: String(trade.id),
      kind: "trade" as const,
      label: `${trade.symbol} · ${trade.side} · ${new Date(trade.entry_time).toLocaleDateString()}`,
      detail: `${trade.reviewed ? "Reviewed" : "Awaiting review"}${trade.strategy_name ? ` · ${trade.strategy_name}` : ""}`,
      keywords: `${trade.status} ${trade.entry_type} ${trade.tags.map((tag) => tag.name).join(" ")} ${trade.notes.map((note) => note.body).join(" ")}`,
      run: () => {
        window.history.pushState(null, "", journalDeepLink({ surface: "trades", tradeId: trade.id, date: null, accountId: trade.account_id, segment: null, returnTo: null }));
        navigateWorkspace("journalTrades");
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      },
    }));
    const dailyNoteCommands = commandJournalData.notes.filter((note) => note.body.trim()).map((note) => ({
      id: String(note.id),
      kind: "note" as const,
      label: note.body.split(/\r?\n/)[0].slice(0, 80),
      detail: `Daily note · ${new Date(`${note.note_date}T00:00:00`).toLocaleDateString()}`,
      keywords: `${note.note_date} ${note.body}`,
      run: () => {
        window.history.pushState(null, "", journalDeepLink({ surface: "calendar", tradeId: null, date: note.note_date, accountId: note.account_id, segment: null, returnTo: null }));
        navigateWorkspace("journalNotes");
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      },
    }));
    const safeActions: SearchableCommandEntity[] = [
      { id: "new-replay", kind: "safe-action", label: "Start a replay session", detail: "Open replay sessions without changing the current session", keywords: "create practice", run: () => navigateWorkspace("sessions") },
      { id: "settings", kind: "safe-action", label: "Open workspace settings", detail: "Review account, chart, data, and privacy preferences", keywords: "preferences configuration", run: () => navigateWorkspace("globalSettings") },
    ];
    return [...accountCommands, ...canonicalTradeCommands, ...dailyNoteCommands, ...tradeCommands, ...noteCommands, ...workspaceCommands, ...safeActions];
  }, [availableLayouts, commandJournalData, layoutName, resultSessions, resultTrades]);

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
    rememberWindowScroll(activeWorkspace);
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

  function focusJournalTradeOnChart(request: JournalChartFocusRequest) {
    if (!request.symbol.trim() || !Array.isArray(request.markers)) return;
    setJournalChartFocus(request);
    setReplayFocusTrade(null);
    setPlaying(false);
    setSessionGateOpen(false);
    setSelectedDrawingId(null);

    const sessionSymbol = state?.session.symbol ?? "";
    const sessionMatches = chartSymbolsEqual(request.symbol, sessionSymbol)
      || journalFocusMatchesSymbol(request.symbol, sessionSymbol);
    if (!state?.session || !sessionMatches) {
      setJournalFocusRange(null);
      setActiveWorkspace("live");
      return;
    }

    setActiveWorkspace("backtest");
    const option = chartSymbolOptions.find((item) => chartSymbolsEqual(item.symbol, sessionSymbol));
    setChartPanes((currentPanes) => currentPanes.map((pane) => pane.id === activeChartPane.id
      ? {
          ...pane,
          dataSourceId: option?.sourceId ?? pane.dataSourceId,
          drawings: applyJournalFocusDrawings(pane.drawings, request),
          symbol: sessionSymbol,
        }
      : pane));
    const range = journalFocusVisibleRange(request, Date.now());
    setJournalFocusRange(range);
    if (range && bars.length) {
      const endIndex = bars.findIndex((bar) => bar.time >= range.to);
      const targetIndex = endIndex >= 0 ? endIndex : bars.length - 1;
      void jumpToOffset(Math.max(state.session.start_offset, barOffset + targetIndex));
    }
  }

  useEffect(() => {
    const onChartFocus = (event: Event) => {
      const request = (event as CustomEvent<JournalChartFocusRequest>).detail;
      if (!request || typeof request.symbol !== "string" || !Array.isArray(request.markers)) return;
      focusJournalTradeOnChart(request);
    };
    window.addEventListener("edgelab:journal-show-on-chart", onChartFocus);
    return () => window.removeEventListener("edgelab:journal-show-on-chart", onChartFocus);
  }, [activeChartPane.id, barOffset, bars, chartSymbolOptions, state?.session]);

  useEffect(() => {
    const openJournalDeepLink = () => {
      if (window.location.hash.replace(/^#/, "") !== "journal/trades") return;
      setActiveWorkspace("journalTrades");
      setSessionGateOpen(false);
    };
    openJournalDeepLink();
    window.addEventListener("hashchange", openJournalDeepLink);
    return () => window.removeEventListener("hashchange", openJournalDeepLink);
  }, []);

  function addIndicator(kind: ChartIndicatorKind) {
    setIndicatorInstances((current) => {
      if (
        (kind === "fvg" || kind === "ifvg") &&
        current.some((indicator) => indicator.kind === kind && indicator.visible !== false)
      ) {
        return current;
      }
      return [
        ...current,
        createIndicatorInstance(kind, {
          color: nextIndicatorInstanceColor(kind, current),
        }),
      ];
    });
  }

  function changeCustomIndicatorScripts(scripts: CustomIndicatorScript[]) {
    setCustomIndicatorScripts(scripts);
    void persistCustomIndicators(scripts);
  }

  function addCustomIndicator(
    script: CustomIndicatorScript,
    inputs: Record<string, EdgeIndicatorInputValue> = script.inputs,
  ) {
    setIndicatorInstances((current) => [
      ...current,
      createCustomIndicatorInstance(script, inputs),
    ]);
    appendIndicatorAudit({
      action: "add-to-chart",
      detail: `Added revision ${script.revision} to ${activeChartPaneLabel}.`,
      scriptId: script.id,
      status: "completed",
    });
  }

  function openIndicatorEditor(scriptId?: string, source?: string) {
    setIndicatorEditorRequest({ nonce: Date.now(), scriptId, source });
  }

  function saveGeneratedIndicator(artifact: QuantGeneratedIndicator, addToChart: boolean) {
    const saved = saveCustomIndicator(customIndicatorScripts, {
      category: "custom",
      color: "#32d3ee",
      description: "Indicator generated through Quant and saved as inspectable EdgeLab DSL.",
      id: "",
      inputs: {},
      name: artifact.name,
      preview: "oscillator",
      source: artifact.source,
      synonyms: ["quant", "generated"],
      quantSemantics: artifact.scorePlotName && artifact.scoreLabel && artifact.scoreSemantics
        ? {
            modelProvenance: artifact.modelProvenance ?? "Unknown provider",
            probabilityLabel: artifact.probabilityLabel ?? "Probability unavailable",
            probabilityCalibrated: artifact.probabilityCalibrated === true,
            probabilityPlotName: artifact.probabilityPlotName ?? null,
            probabilitySemantics: artifact.probabilitySemantics ?? "No calibrated outcome probability is available.",
            scoreLabel: artifact.scoreLabel,
            scorePlotName: artifact.scorePlotName,
            scoreSemantics: artifact.scoreSemantics,
          }
        : undefined,
    });
    if (!saved.script) {
      openIndicatorEditor(undefined, artifact.source);
      return;
    }
    changeCustomIndicatorScripts(saved.scripts);
    if (addToChart) addCustomIndicator(saved.script);
  }

  function updateIndicatorRuntimeStateForPane(
    paneId: string,
    instanceId: string,
    runtimeError: string | null,
  ) {
    updateChartPane(paneId, (pane) => {
      const current = pane.indicatorInstances.find((indicator) => indicator.id === instanceId);
      if (!current || (current.runtimeError ?? null) === runtimeError) return pane;
      return {
        ...pane,
        indicatorInstances: pane.indicatorInstances.map((indicator) =>
          indicator.id === instanceId ? { ...indicator, runtimeError } : indicator,
        ),
      };
    });
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
    const synchronizedDrawing = { ...drawing, syncKey: drawing.syncKey ?? drawing.id };
    commitDrawingsChange([...drawingsRef.current, synchronizedDrawing]);
    setSelectedDrawingId(synchronizedDrawing.id);
    if (chartSyncSettings.drawings) {
      const visibleIds = new Set(visibleChartPanes.map((pane) => pane.id));
      setChartPanes((current) => current.map((pane) => {
        if (
          pane.id === activeChartPane.id ||
          !visibleIds.has(pane.id) ||
          !shouldMapDrawingToPane(chartSyncSettings.drawingMappingPolicy, activeChartPane, pane)
        ) return pane;
        return { ...pane, drawings: sanitizeDrawings([...pane.drawings, mapDrawingToPane(synchronizedDrawing, pane.id)]) };
      }));
    }
  }

  function addDrawingToPane(paneId: string, drawing: ChartDrawing) {
    if (paneId === activeChartPane.id) {
      addDrawing(drawing);
      return;
    }
    const synchronizedDrawing = { ...drawing, syncKey: drawing.syncKey ?? drawing.id };
    setActiveChartPaneId(paneId);
    setSelectedDrawingId(synchronizedDrawing.id);
    const visibleIds = new Set(visibleChartPanes.map((pane) => pane.id));
    setChartPanes((current) => {
      const sourcePane = current.find((pane) => pane.id === paneId);
      if (!sourcePane) return current;
      return current.map((pane) => {
        if (pane.id === paneId) {
          return { ...pane, drawings: sanitizeDrawings([...pane.drawings, synchronizedDrawing]) };
        }
        if (
          !chartSyncSettings.drawings ||
          !visibleIds.has(pane.id) ||
          !shouldMapDrawingToPane(chartSyncSettings.drawingMappingPolicy, sourcePane, pane)
        ) return pane;
        return { ...pane, drawings: sanitizeDrawings([...pane.drawings, mapDrawingToPane(synchronizedDrawing, pane.id)]) };
      });
    });
  }

  function updateDrawing(updatedDrawing: ChartDrawing, coalesceUndo = false) {
    commitDrawingsChange(
      drawingsRef.current.map((drawing) =>
        drawing.id === updatedDrawing.id ? updatedDrawing : drawing,
      ),
      { coalesceUndo },
    );
    if (chartSyncSettings.drawings && updatedDrawing.syncKey) {
      const visibleIds = new Set(visibleChartPanes.map((pane) => pane.id));
      setChartPanes((current) => current.map((pane) => {
        if (
          pane.id === activeChartPane.id ||
          !visibleIds.has(pane.id) ||
          !shouldMapDrawingToPane(chartSyncSettings.drawingMappingPolicy, activeChartPane, pane)
        ) return pane;
        return {
          ...pane,
          drawings: pane.drawings.map((drawing) =>
            drawing.syncKey === updatedDrawing.syncKey
              ? { ...mapDrawingToPane(updatedDrawing, pane.id), id: drawing.id }
              : drawing,
          ),
        };
      }));
    }
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
    const visibleIds = new Set(visibleChartPanes.map((pane) => pane.id));
    setChartPanes((current) => {
      const sourcePane = current.find((pane) => pane.id === paneId);
      if (!sourcePane) return current;
      return current.map((pane) => {
        if (pane.id === paneId) {
          return { ...pane, drawings: sanitizeDrawings(pane.drawings.map((drawing) => drawing.id === updatedDrawing.id ? updatedDrawing : drawing)) };
        }
        if (
          !chartSyncSettings.drawings ||
          !updatedDrawing.syncKey ||
          !visibleIds.has(pane.id) ||
          !shouldMapDrawingToPane(chartSyncSettings.drawingMappingPolicy, sourcePane, pane)
        ) return pane;
        return { ...pane, drawings: pane.drawings.map((drawing) => drawing.syncKey === updatedDrawing.syncKey ? { ...mapDrawingToPane(updatedDrawing, pane.id), id: drawing.id } : drawing) };
      });
    });
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
    if (chartSyncSettings.drawings && targetDrawing.syncKey) {
      setChartPanes((current) => current.map((pane) => pane.id === activeChartPane.id
        ? pane
        : { ...pane, drawings: pane.drawings.filter((drawing) => drawing.syncKey !== targetDrawing.syncKey) },
      ));
    }
    setSelectedDrawingId(null);
  }

  function deleteDrawingForPane(paneId: string, drawingId: string) {
    if (paneId === activeChartPane.id) {
      deleteDrawing(drawingId);
      return;
    }
    setChartPanes((current) => {
      const sourcePane = current.find((pane) => pane.id === paneId);
      const targetDrawing = sourcePane?.drawings.find((drawing) => drawing.id === drawingId);
      if (!sourcePane || !targetDrawing || targetDrawing.locked) return current;
      return current.map((pane) => {
        if (pane.id === paneId) return { ...pane, drawings: pane.drawings.filter((drawing) => drawing.id !== drawingId) };
        if (!chartSyncSettings.drawings || !targetDrawing.syncKey) return pane;
        return { ...pane, drawings: pane.drawings.filter((drawing) => drawing.syncKey !== targetDrawing.syncKey) };
      });
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

  function reorderDrawing(sourceId: string, targetId: string) {
    const sourceIndex = drawingsRef.current.findIndex((drawing) => drawing.id === sourceId);
    const targetIndex = drawingsRef.current.findIndex((drawing) => drawing.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    const next = [...drawingsRef.current];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    commitDrawingsChange(next);
  }

  function moveDrawingLayer(
    drawingId: string,
    action: "back" | "backward" | "forward" | "front",
  ) {
    const currentIndex = drawingsRef.current.findIndex((drawing) => drawing.id === drawingId);
    if (currentIndex < 0 || drawingsRef.current[currentIndex].locked) return;
    const targetIndex =
      action === "back"
        ? 0
        : action === "front"
          ? drawingsRef.current.length - 1
          : action === "backward"
            ? Math.max(0, currentIndex - 1)
            : Math.min(drawingsRef.current.length - 1, currentIndex + 1);
    if (targetIndex === currentIndex) return;
    const next = [...drawingsRef.current];
    const [moved] = next.splice(currentIndex, 1);
    next.splice(targetIndex, 0, moved);
    commitDrawingsChange(next);
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
    persistWorkspaceRecord(name, payload);
    setChartLayoutSavedAt(Date.now());
  }

  function persistChartLayoutWithDrawings(nextDrawings: ChartDrawing[]) {
    if (typeof window === "undefined") {
      return;
    }
    const payload = buildChartLayoutPayload(nextDrawings);
    const name = normalizeLayoutName(layoutName);
    persistWorkspaceRecord(name, payload);
    setChartLayoutSavedAt(Date.now());
  }

  function persistWorkspaceRecord(name: string, payload: StoredChartLayout) {
    const result = saveNamedChartLayout(name, payload, workspaceRevisionRef.current);
    workspaceRevisionRef.current = result.record.revision;
    void saveAppStorageItem(CHART_LAYOUT_STORAGE_KEY, result.record.layout);
    void saveAppStorageItem(ACTIVE_CHART_LAYOUT_STORAGE_KEY, result.record.name);
    setLayoutName(result.record.name);
    setAvailableLayouts(result.names);
    setWorkspaceRecoveryMessage(
      result.conflict
        ? `A newer revision was preserved. Your edits were recovered as “${result.record.name}”.`
        : null,
    );
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
      revision: workspaceRevisionRef.current,
      schemaVersion: CHART_WORKSPACE_SCHEMA_VERSION,
      settingsDefaultsVersion: CHART_SETTINGS_DEFAULTS_VERSION,
      showOrderOverlays: activePane?.showOrderOverlays ?? true,
      smoothCandles: activePane?.smoothCandles ?? false,
      timeframe: coerceTimeframeToSource(
        sanitizeTimeframe(activePane?.timeframe),
        sourceTimeframe,
      ),
      syncSettings: sanitizeChartSyncSettings(chartSyncSettings),
      panelState: {
        activePanel: workspacePanel,
        layersPanelOpen,
        orderPanelOpen: leftPaneOpen || fullscreenOrderPanelOpen,
        sidebarCollapsed,
      },
      watchlistSelection: {
        id: null,
        symbol: activePane?.symbol ?? state?.session.symbol ?? "MARKET",
      },
    };
  }

  function loadNamedChartLayout(name: string) {
    const record = loadChartLayoutRecord(name);
    if (!record) {
      return;
    }
    applyChartLayout(record.layout);
    workspaceRevisionRef.current = record.revision;
    void saveAppStorageItem(ACTIVE_CHART_LAYOUT_STORAGE_KEY, record.name);
    setLayoutName(record.name);
    setChartLayoutSavedAt(Date.now());
  }

  function deleteNamedChartLayout(name: string) {
    const nextNames = deleteChartLayoutRecord(name);
    setAvailableLayouts(nextNames);
    if (normalizeLayoutName(defaultLayoutName ?? "") === normalizeLayoutName(name)) setDefaultLayoutName(null);
    if (normalizeLayoutName(startupLayoutName ?? "") === normalizeLayoutName(name)) setStartupLayoutName(null);
    if (normalizeLayoutName(name) === normalizeLayoutName(layoutName)) {
      setLayoutName(nextNames[0] ?? "Default");
      void saveAppStorageItem(ACTIVE_CHART_LAYOUT_STORAGE_KEY, nextNames[0] ?? null);
    }
  }

  function duplicateNamedChartLayout(name: string) {
    const record = loadChartLayoutRecord(name);
    if (!record) return;
    const existing = new Set(loadSavedLayoutNames().map((item) => normalizeLayoutName(item)));
    let copyName = normalizeLayoutName(`${record.name} copy`);
    let suffix = 2;
    while (existing.has(copyName)) copyName = normalizeLayoutName(`${record.name} copy ${suffix++}`);
    workspaceRevisionRef.current = 0;
    const result = saveNamedChartLayout(copyName, { ...record.layout, revision: 0 }, 0);
    workspaceRevisionRef.current = result.record.revision;
    setAvailableLayouts(result.names);
    setLayoutName(result.record.name);
    void saveAppStorageItem(ACTIVE_CHART_LAYOUT_STORAGE_KEY, result.record.name);
    applyChartLayout(result.record.layout);
  }

  function renameNamedChartLayout(from: string, to: string) {
    const record = loadChartLayoutRecord(from);
    const nextName = normalizeLayoutName(to);
    if (!record || normalizeLayoutName(from) === nextName || loadChartLayoutRecord(nextName)) return;
    const records = loadChartLayoutRecords().map((item) =>
      normalizeLayoutName(item.name) === normalizeLayoutName(from)
        ? { ...item, name: nextName, updatedAt: new Date().toISOString() }
        : item,
    );
    void saveAppStorageItem(CHART_LAYOUTS_STORAGE_KEY, records);
    void saveAppStorageItem(ACTIVE_CHART_LAYOUT_STORAGE_KEY, nextName);
    setAvailableLayouts(records.map((item) => item.name));
    setLayoutName(nextName);
    if (record.isDefault) setDefaultLayoutName(nextName);
    if (record.isStartup) setStartupLayoutName(nextName);
  }

  function setNamedLayoutFlag(name: string, flag: "isDefault" | "isStartup") {
    const normalized = normalizeLayoutName(name);
    const records = loadChartLayoutRecords().map((record) => ({
      ...record,
      [flag]: normalizeLayoutName(record.name) === normalized,
    }));
    void saveAppStorageItem(CHART_LAYOUTS_STORAGE_KEY, records);
    setAvailableLayouts(records.map((record) => record.name));
    if (flag === "isDefault") setDefaultLayoutName(normalized);
    else setStartupLayoutName(normalized);
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
    setChartSyncSettings(sanitizeChartSyncSettings(layout.syncSettings));
    workspaceRevisionRef.current = Math.max(0, Math.floor(layout.revision ?? 0));
    if (layout.panelState) {
      setWorkspacePanel(layout.panelState.activePanel);
      setLayersPanelOpen(layout.panelState.layersPanelOpen === true);
      setLeftPaneOpen(layout.panelState.orderPanelOpen === true);
      setSidebarCollapsed(layout.panelState.sidebarCollapsed === true);
    }
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
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>('[data-chart-header-control="settings"]')
        ?.focus({ preventScroll: true });
    });
  }

  function updateChartInteractionPreference(
    patch: Partial<typeof chartInteractionPreferences>,
  ) {
    setChartInteractionPreferences((current) => {
      const next = { ...current, ...patch };
      void persistChartInteractionPreferences(next);
      return next;
    });
  }

  async function captureChartGrid() {
    if (chartCapture.status === "capturing") {
      return;
    }
    const target = chartPaneGridRef.current;
    if (!target) {
      setChartCapture({
        message: "The chart is still loading. Try the capture again.",
        status: "error",
      });
      return;
    }
    setChartCapture({ message: "Preparing the visible chart layout…", status: "capturing" });
    setChartCaptureMode(true);
    try {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
      });
      const result = await captureVisibleChartGridPng(target, {
        layout: chartPaneLayout,
        symbol: state?.session.symbol ?? "chart",
        timeframe: isMultiChartLayout ? "multi" : effectiveTimeframe,
      });
      setChartCapture({
        message: `Saved ${result.fileName} · ${result.width} × ${result.height}`,
        status: "success",
      });
    } catch {
      setChartCapture({
        message: "PNG capture could not be created. Check browser download permissions and retry.",
        status: "error",
      });
    } finally {
      setChartCaptureMode(false);
    }
  }

  async function captureChartForQuant(region: QuantSelectedRegion | null = null) {
    const target = chartPaneGridRef.current;
    if (!target) {
      setChartCapture({ message: "The chart is still loading. Try the attachment again.", status: "error" });
      return;
    }
    const contextSnapshot = snapshotQuantChartContext(quantContext, region);
    setChartCapture({ message: region ? "Capturing the selected chart region…" : "Attaching the visible chart…", status: "capturing" });
    setChartCaptureMode(true);
    try {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
      });
      await document.fonts?.ready.catch(() => undefined);
      const { toPng } = await import("html-to-image");
      const bounds = target.getBoundingClientRect();
      const width = Math.max(1, Math.ceil(target.scrollWidth || bounds.width));
      const height = Math.max(1, Math.ceil(target.scrollHeight || bounds.height));
      const pixelRatio = Math.min(1, 1_600 / width, 1_200 / height);
      const fullDataUrl = await toPng(target, {
        backgroundColor: "#05070a",
        cacheBust: true,
        filter: (node) =>
          !(node instanceof HTMLElement) ||
          !node.matches(".chart-context-menu,.chart-object-floating-toolbar,.chart-order-confirm-backdrop,.chart-radial-toolbox,[data-chart-capture-exclude='true']"),
        height,
        pixelRatio,
        width,
      });
      const capture = region
        ? await cropQuantCapture(fullDataUrl, region)
        : {
            dataUrl: fullDataUrl,
            height: Math.max(1, Math.round(height * pixelRatio)),
            width: Math.max(1, Math.round(width * pixelRatio)),
          };
      if (capture.dataUrl.length > 5_500_000) {
        throw new Error("The chart attachment exceeds the 4 MB safety limit.");
      }
      setQuantAttachment({
        ...capture,
        contextSnapshot,
        id: `quant-capture-${Date.now().toString(36)}`,
        kind: region ? "region" : "chart",
        region,
      });
      setQuantOpen(true);
      setChartCapture({
        message: `${region ? "Selected region" : "Visible chart"} attached to Quant · ${capture.width} × ${capture.height}`,
        status: "success",
      });
      appendQuantAudit({ action: "capture", contextFields: [region ? "selectedRegion" : "visibleChart"], modelId: null, status: "completed" });
    } catch (failure) {
      setChartCapture({
        message: failure instanceof Error ? failure.message : "The chart attachment could not be created.",
        status: "error",
      });
      appendQuantAudit({ action: "capture", contextFields: [], modelId: null, status: "failed" });
    } finally {
      setChartCaptureMode(false);
    }
  }

  function beginQuantRegionCapture() {
    setQuantRegionDraft(null);
    setQuantRegionSelecting(true);
    setChartCapture({ message: "Drag over the chart to attach a region. Press Escape to cancel.", status: "capturing" });
  }

  function updateQuantRegionPointer(
    event: ReactPointerEvent<HTMLDivElement>,
    phase: "down" | "move" | "up",
  ) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = clampRatio((event.clientX - bounds.left) / Math.max(bounds.width, 1));
    const y = clampRatio((event.clientY - bounds.top) / Math.max(bounds.height, 1));
    if (phase === "down") {
      event.currentTarget.setPointerCapture(event.pointerId);
      setQuantRegionDraft({ currentX: x, currentY: y, startX: x, startY: y });
      return;
    }
    if (!quantRegionDraft) return;
    if (phase === "move") {
      setQuantRegionDraft((current) => current ? { ...current, currentX: x, currentY: y } : null);
      return;
    }
    const region: QuantSelectedRegion = {
      heightRatio: Math.abs(y - quantRegionDraft.startY),
      widthRatio: Math.abs(x - quantRegionDraft.startX),
      xRatio: Math.min(x, quantRegionDraft.startX),
      yRatio: Math.min(y, quantRegionDraft.startY),
    };
    setQuantRegionDraft(null);
    setQuantRegionSelecting(false);
    if (region.widthRatio < 0.02 || region.heightRatio < 0.02) {
      setChartCapture({ message: "Select a larger chart region.", status: "error" });
      return;
    }
    window.requestAnimationFrame(() => void captureChartForQuant(region));
  }

  async function createSessionFromGateway(payload: BacktestCreatePayload) {
    await newSession(payload);
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
    } else {
      await ensureLatestReplayLoaded();
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
        <button
          className="workspace-tab inline-flex items-center justify-center gap-2"
          onClick={() => setWorkspaceShareOpen(true)}
          type="button"
        >
          <Share2 aria-hidden="true" size={14} />
          Share copy
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

  function closeSharedCopy() {
    setActiveSharedCopy(null);
    setActiveSharedCopyLocalOnly(false);
    setActiveWorkspace("sessions");
    setSessionGateOpen(true);
    const url = new URL(window.location.href);
    url.searchParams.delete("workspaceCopy");
    url.searchParams.delete("copyPersistence");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }

  if (sharedCopyResolving) {
    return <AppLoadingSpinner className="min-h-screen bg-[#05070a]" label="Opening copied workspace" />;
  }

  if (activeSharedCopy) {
    return (
      <SharedWorkspaceCopySurface
        artifact={activeSharedCopy}
        localOnly={activeSharedCopyLocalOnly}
        onClose={closeSharedCopy}
      />
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#05070a] text-slate-100">
      <a
        className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-xl bg-cyan-300 px-4 py-3 text-sm font-bold text-slate-950 shadow-panel outline-none transition focus:translate-y-0 focus:ring-2 focus:ring-white/70"
        href="#workspace-content"
      >
        Skip to workspace
      </a>
      <div className="flex min-h-screen max-w-full overflow-x-hidden">
        <Sidebar
          activeView={activeWorkspace}
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
          onNavigate={navigateWorkspace}
        />
        <div
          aria-hidden="true"
          className="hidden shrink-0 transition-[width] duration-200 ease-el-out lg:block"
          style={{ width: sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH }}
        />
        <main
          className="min-w-0 flex-1 overflow-x-hidden p-3 pb-[calc(6.25rem+env(safe-area-inset-bottom))] outline-none sm:p-4 sm:pb-[calc(6.25rem+env(safe-area-inset-bottom))] lg:pb-4 xl:p-5 xl:pb-5"
          id="workspace-content"
          tabIndex={-1}
        >
          {sharedCopyNotice ? (
            <div className="mb-4 flex flex-col gap-3 rounded-xl bg-cyan-300/[0.08] px-4 py-3 text-sm text-cyan-50 sm:flex-row sm:items-center sm:justify-between" role="status">
              <span>{sharedCopyNotice}</span>
              <button
                className="min-h-10 shrink-0 rounded-lg px-3 text-sm font-semibold text-cyan-100 outline-none hover:bg-cyan-300/10 focus-visible:ring-2 focus-visible:ring-cyan-300/50"
                onClick={() => setSharedCopyNotice(null)}
                type="button"
              >
                Dismiss
              </button>
            </div>
          ) : null}
          {activeWorkspace !== "sessions" && activeWorkspace !== "backtest" ? (
            <Suspense fallback={<WorkspaceLoadingPanel />}>
              <WorkspaceContextHeader
                activeView={activeWorkspace}
                connection={activeWorkspace === "live" ? "connected" : "local"}
                onBack={() => navigateWorkspace("sessions")}
                onOpenSettings={() => navigateWorkspace("globalSettings")}
                scope={activeWorkspace === "live" ? `${activeChartPane.symbol} · ${formatChartTimeframeLabel(activeChartPane.timeframe)}` : undefined}
              />
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
                reportsLoading={resultTradesLoading}
                reportsError={resultTradesLoadError}
                onRetryReports={() => void ensureResultTradesLoaded()}
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
                journalChartFocus={journalChartFocus}
              />
            </Suspense>
          ) : sessionGateOpen || activeWorkspace === "sessions" ? (
            <>
              <WorkspaceContextHeader
                activeView="sessions"
                connection={state?.session ? "local" : "offline"}
                onOpenSettings={() => navigateWorkspace("globalSettings")}
                scope={state?.session ? `${formatMarketSymbol(state.session.symbol)} · Session #${state.session.id}` : "Choose or create a replay session"}
              />
              {error && !resultSessionsLoadError && (
                <div className="mb-4 flex items-center gap-2 rounded-md border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                  <AlertTriangle size={18} />
                  {error}
                </div>
              )}
              {resultSessionsLoadError ? (
                <SessionGatewayUnavailable
                  isRetrying={isLoading}
                  onRetry={() => void loadInitial()}
                />
              ) : (
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
                  sessionsHasMore={resultSessionsHasMore}
                  isLoadingMoreSessions={isLoadingMoreSessions}
                  strategySummaries={strategySummaries}
                  trades={resultTrades}
                  onLoadMoreSessions={loadMoreSessions}
                />
              )}
            </>
          ) : (
            <ChartWorkspaceFrame
              onChartFocus={focusJournalTradeOnChart}
              symbol={activeChartPane.symbol}
            >
          {error && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100" role="alert">
              <AlertTriangle size={18} />
              <span className="min-w-0 flex-1">{error}</span>
              <button className="control-button h-9 px-3 text-xs" disabled={isLoading} onClick={() => void loadInitial()} type="button">
                Retry
              </button>
            </div>
          )}
          {isLoading && <BacktestLoadingPanel />}

          <div className="space-y-3">
            {leftPaneOpen && (
              <aside
                className="focus-side-drawer"
                style={{
                  "--edge-sidebar-width": `${
                    sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH
                  }px`,
                } as CSSProperties}
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
                  replayTimeframe={normalizedReplayTimeframe}
                  replayTimeframeLabel={formatChartTimeframeLabel(normalizedReplayTimeframe)}
                  replayTimeframeOptions={replayTimeframeOptions}
                  showOrderToggle={false}
                  timeHoursFormat={chartSettings.timeHoursFormat}
                />
                {(chartToolsOpen || chartSettingsPanelOpen) && (
                  <Suspense fallback={<LazyPanelFallback />}>
                    <ChartToolbar
                      key={chartToolsOpen ? "chart-tools" : "chart-settings"}
                      activePaneLabel={activeChartPaneLabel}
                      captureMessage={chartCapture.message}
                      captureStatus={chartCapture.status}
                      chartSettings={chartSettings}
                      chartStyle={chartStyle}
                      defaultLayoutName={defaultLayoutName}
                      clearableDrawingsCount={unlockedDrawingsCount}
                      drawingTool={drawingTool}
                      drawingsCount={drawings.length}
                      customIndicatorScripts={allCustomIndicatorScripts}
                      indicatorInstances={indicatorInstances}
                      onAddIndicator={addIndicator}
                      onAddCustomIndicator={addCustomIndicator}
                      onEditCustomIndicator={(script) => openIndicatorEditor(script.id)}
                      onOpenIndicatorEditor={() => openIndicatorEditor()}
                      onOpenQuant={() => setQuantOpen(true)}
                      onCaptureRegionForQuant={beginQuantRegionCapture}
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
                      startupLayoutName={startupLayoutName}
                      workspaceRecoveryMessage={workspaceRecoveryMessage}
                      onDrawingToolChange={changeDrawingTool}
                      onDeleteLayout={deleteNamedChartLayout}
                      onDuplicateLayout={duplicateNamedChartLayout}
                      onLayoutNameChange={setLayoutName}
                      onRenameLayout={renameNamedChartLayout}
                      onSetDefaultLayout={(name) => setNamedLayoutFlag(name, "isDefault")}
                      onSetStartupLayout={(name) => setNamedLayoutFlag(name, "isStartup")}
                      onLoadLayout={loadNamedChartLayout}
                      magnetMode={magnetMode}
                      keepDrawingAfterPlacement={
                        chartInteractionPreferences.keepDrawingAfterPlacement
                      }
                      onCaptureChart={() => void captureChartGrid()}
                      onKeepDrawingAfterPlacementChange={(keepDrawingAfterPlacement) =>
                        updateChartInteractionPreference({ keepDrawingAfterPlacement })
                      }
                      onMagnetModeChange={setMagnetMode}
                      onPaneLayoutChange={changeChartPaneLayout}
                      onReplayTimeframeChange={changeReplayTimeframe}
                      onSaveLayout={saveChartLayout}
                      onTimeframeChange={changeTimeframe}
                      onSymbolChange={changeChartSymbol}
                      onSyncSettingsChange={setChartSyncSettings}
                      onDrawingMarkerChange={setDrawingMarker}
                      onToggleOrderOverlays={() => setShowOrderOverlays((value) => !value)}
                      onRemoveIndicator={removeIndicator}
                      onUpdateIndicatorSettings={updateIndicatorSettings}
                      onSettingsClose={handleChartSettingsClose}
                      onShowDrawingRailChange={(showDrawingRail) =>
                        updateChartInteractionPreference({ showDrawingRail })
                      }
                      onSmoothCandlesChange={setSmoothCandles}
                      orderOverlaysVisible={showOrderOverlays}
                      paneLayout={chartPaneLayout}
                      replayTimeframe={normalizedReplayTimeframe}
                      replayTimeframeOptions={replayTimeframeOptions}
                      savedLabel={savedLayoutLabel}
                      settingsOpenSignal={chartSettingsOpenSignal}
                      showDrawingRail={chartInteractionPreferences.showDrawingRail}
                      smoothCandles={smoothCandles}
                      sourceTimeframe={sourceTimeframe}
                      symbol={activeChartPane.symbol}
                      symbolOptions={chartSymbolOptions}
                      syncSettings={chartSyncSettings}
                      drawingMarker={drawingMarker}
                      timeframe={effectiveTimeframe}
                      toolsOpen={chartToolsOpen}
                    />
                  </Suspense>
                )}
                <Suspense fallback={<ChartChunkFallback />}>
                  <div className={`chart-studio-layout ${layersPanelOpen ? "" : "chart-studio-layout-focus"}`}>
                  <div className="min-w-0 space-y-3">
                    {chartCapture.status !== "idle" ? (
                      <div
                        aria-live="polite"
                        className={`chart-capture-feedback chart-capture-feedback-${chartCapture.status}`}
                        data-chart-capture-exclude="true"
                        role={chartCapture.status === "error" ? "alert" : "status"}
                      >
                        <span aria-hidden="true" className="chart-capture-feedback-mark" />
                        <span className="min-w-0 flex-1 truncate">{chartCapture.message}</span>
                        {chartCapture.status === "error" ? (
                          <button onClick={() => void captureChartGrid()} type="button">
                            Retry
                          </button>
                        ) : chartCapture.status === "success" ? (
                          <button
                            aria-label="Dismiss capture confirmation"
                            onClick={() => setChartCapture({ message: "", status: "idle" })}
                            type="button"
                          >
                            Dismiss
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    <div
                      className={`chart-pane-grid relative ${chartPaneLayoutDefinition.className}`}
                      ref={chartPaneGridRef}
                    >
                      {visibleChartPanes.map((pane, index) => {
                        const paneActive = pane.id === activeChartPane.id;
                        const paneDrawingControlsActive = shouldMountPaneDrawingControls(
                          chartPaneLayoutDefinition.panes,
                          paneActive,
                        );
                        const paneHasSessionData = chartSymbolsEqual(pane.symbol, state?.session.symbol);
                        const normalizedPane = replayPaneMarketData[pane.id];
                        const paneBars = paneHasSessionData ? visibleBars : normalizedPane?.bars ?? [];
                        const paneDataState = paneHasSessionData
                          ? normalizedVisibleData.continuity.status === "gapped"
                            ? {
                                status: "gapped" as const,
                                detail: `${normalizedVisibleData.continuity.gapCount} feed gap${normalizedVisibleData.continuity.gapCount === 1 ? "" : "s"} detected; ${normalizedVisibleData.continuity.missingBars} candle${normalizedVisibleData.continuity.missingBars === 1 ? "" : "s"} missing.`,
                              }
                            : {
                                status: (paneBars.length > 0 ? "available" : "empty") as "available" | "empty",
                                detail: paneBars.length > 0 ? "Session data is continuous." : "This session has not published candles yet.",
                              }
                          : {
                              status: normalizedPane?.status === "available"
                                ? "available" as const
                                : normalizedPane?.status === "empty"
                                  ? "empty" as const
                                  : "unavailable" as const,
                              detail: normalizedPane?.detail ?? `Subscribing ${pane.symbol} through normalized market data.`,
                            };
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
                            onFocusCapture={paneDrawingControlsActive ? undefined : () => selectChartPane(pane.id)}
                            onPointerEnter={paneDrawingControlsActive ? undefined : () => selectChartPane(pane.id)}
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
                                <span>{pane.symbol} · {formatChartTimeframeLabel(paneTimeframe)}</span>
                              </div>
                            )}
                            <TradingChart
                              bars={paneBars}
                              canUndoDrawingChange={paneActive && drawingUndoDepth > 0}
                              captureMode={chartCaptureMode}
                              chartSettings={pane.chartSettings}
                              chartStyle={pane.chartStyle}
                              confirmOrderLineModifications={confirmOrderLineModifications}
                              drawingTool={pane.drawingTool}
                              drawingMarker={drawingMarker}
                              drawings={pane.drawings}
                              executions={paneHasSessionData ? executions : []}
                              indicatorInstances={pane.indicatorInstances}
                              magnetMode={pane.magnetMode}
                              keepDrawingAfterPlacement={
                                chartInteractionPreferences.keepDrawingAfterPlacement
                              }
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
                              onIndicatorRuntimeState={(instanceId, runtimeError) =>
                                updateIndicatorRuntimeStateForPane(pane.id, instanceId, runtimeError)
                              }
                              onCaptureChart={() => void captureChartGrid()}
                              onCrosshairSync={chartSyncSettings.crosshair ? (value) =>
                                setSyncedCrosshair((current) => ({ ...value, revision: (current?.revision ?? 0) + 1 })) : undefined}
                              onOpenChartSettings={openChartSettings}
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
                              onVisibleRangeSync={chartSyncSettings.visibleRange ? (value) =>
                                setSyncedVisibleRange((current) => ({ ...value, revision: (current?.revision ?? 0) + 1 })) : undefined}
                              onUndoDrawingChange={
                                paneActive ? undoLastDrawingChange : () => selectChartPane(pane.id)
                              }
                              onUpdateDrawing={(nextDrawing, coalesceUndo) =>
                                updateDrawingForPane(pane.id, nextDrawing, coalesceUndo)
                              }
                              onUpdateIndicatorSettings={(instanceId, settings) =>
                                updateIndicatorSettingsForPane(pane.id, instanceId, settings)
                              }
                              orders={paneHasSessionData ? orders : []}
                              position={paneHasSessionData ? position : null}
                              pnlMultiplier={state?.session.pnl_multiplier ?? 1}
                              replayFocusTrade={
                                replayFocusTrade?.session_id === state?.session.id
                                  ? replayFocusTrade
                                  : null
                              }
                              replaySeekVersion={replaySeekVersion}
                              selectedDrawingId={paneActive ? selectedDrawingId : null}
                              showDrawingRail={chartInteractionPreferences.showDrawingRail}
                              drawingControlsActive={paneDrawingControlsActive}
                              showOrderOverlays={pane.showOrderOverlays}
                              paneId={pane.id}
                              dataState={paneDataState}
                              syncedCrosshair={chartSyncSettings.crosshair ? syncedCrosshair : null}
                              syncedVisibleRange={journalFocusRange
                                ? { ...journalFocusRange, revision: journalFocusRange.revision + paneBars.length }
                                : chartSyncSettings.visibleRange ? syncedVisibleRange : null}
                              symbol={pane.symbol}
                              currency={sessionCurrency}
                              datasetTimeframe={state?.session.timeframe}
                              timeframe={paneTimeframe}
                              undoShortcutLabel={undoShortcutLabel}
                            />
                          </div>
                        );
                      })}
                      {quantRegionSelecting ? (
                        <div
                          aria-label="Select a chart region for Quant. Drag to select; press Escape to cancel."
                          className="absolute inset-0 z-50 cursor-crosshair touch-none bg-cyan-950/10"
                          data-chart-capture-exclude="true"
                          onPointerDown={(event) => updateQuantRegionPointer(event, "down")}
                          onPointerMove={(event) => updateQuantRegionPointer(event, "move")}
                          onPointerUp={(event) => updateQuantRegionPointer(event, "up")}
                          role="application"
                        >
                          <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md border border-cyan-300/20 bg-[#071018]/95 px-3 py-1.5 text-xs font-medium text-cyan-100 shadow-xl">
                            Drag to attach a region · Esc cancels
                          </div>
                          {quantRegionDraft ? (
                            <div
                              className="pointer-events-none absolute border border-cyan-300 bg-cyan-300/10 shadow-[0_0_0_1px_rgba(34,211,238,0.15)]"
                              style={{
                                height: `${Math.abs(quantRegionDraft.currentY - quantRegionDraft.startY) * 100}%`,
                                left: `${Math.min(quantRegionDraft.currentX, quantRegionDraft.startX) * 100}%`,
                                top: `${Math.min(quantRegionDraft.currentY, quantRegionDraft.startY) * 100}%`,
                                width: `${Math.abs(quantRegionDraft.currentX - quantRegionDraft.startX) * 100}%`,
                              }}
                            />
                          ) : null}
                        </div>
                      ) : null}
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
                      onMoveDrawingLayer={moveDrawingLayer}
                      onReorderDrawing={reorderDrawing}
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
                    metrics={state?.metrics ?? null}
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
            </ChartWorkspaceFrame>
          )}
        </main>
      </div>

      <GlobalCommandPalette
        commandEntities={commandEntities}
        onNavigate={navigateWorkspace}
        onSelectSymbol={changeChartSymbol}
        symbols={activeWorkspace === "backtest" ? chartSymbolOptions.map((option) => option.symbol) : []}
      />

      {indicatorEditorRequest ? (
        <Suspense fallback={<LazyPanelFallback className="fixed inset-4 z-[90] rounded-xl bg-[#071018]" />}>
          <IndicatorEditorPanel
            bars={visibleBars}
            onAddToChart={addCustomIndicator}
            onClose={() => setIndicatorEditorRequest(null)}
            onScriptsChange={changeCustomIndicatorScripts}
            request={indicatorEditorRequest}
            scripts={allCustomIndicatorScripts}
          />
        </Suspense>
      ) : null}

      {quantOpen ? (
        <Suspense fallback={<LazyPanelFallback className="fixed bottom-3 right-3 z-[80] h-72 w-96 rounded-xl bg-[#071018]" />}>
          <QuantPanel
            attachment={quantAttachment}
            bars={visibleBars}
            context={quantContext}
            onAddGeneratedIndicator={(artifact) => saveGeneratedIndicator(artifact, true)}
            onCaptureChart={() => captureChartForQuant()}
            onCaptureRegion={beginQuantRegionCapture}
            onClearAttachment={() => setQuantAttachment(null)}
            onClose={() => {
              setQuantOpen(false);
              setQuantRegionSelecting(false);
              setQuantRegionDraft(null);
            }}
            onOpenIndicatorEditor={(artifact) => openIndicatorEditor(undefined, artifact.source)}
            scripts={allCustomIndicatorScripts}
          />
        </Suspense>
      ) : null}

      {!isChartFullscreen && !editingTrade && !reviewTrade ? (
        <WorkspaceMobileNav activeView={activeWorkspace} onNavigate={navigateWorkspace} />
      ) : null}

      {workspaceShareOpen ? (
        <WorkspaceShareDialog
          buildPayload={(scope: WorkspaceShareScope) =>
            buildWorkspaceSharePayload(scope, {
              activePanel: workspacePanel,
              activePaneId: activeChartPane.id,
              candles: chartSymbolsEqual(activeChartPane.symbol, state?.session.symbol) ? visibleBars : [],
              currentTimestamp: current?.timestamp ?? null,
              layoutName,
              metrics: state?.metrics ?? null,
              paneLayout: chartPaneLayout,
              panes: chartPanes,
              sidebarCollapsed,
              symbol: activeChartPane.symbol,
              timeframe: state?.session.timeframe ?? effectiveTimeframe,
              timezone: state?.session.timezone ?? null,
            })
          }
          onClose={() => setWorkspaceShareOpen(false)}
          suggestedTitle={`${state?.session.strategy_name ?? formatMarketSymbol(state?.session.symbol) ?? "Trading"} workspace`}
          workspaceKey={`backtest:${state?.session.id ?? "draft"}`}
        />
      ) : null}

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

function clampRatio(value: number) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

async function cropQuantCapture(dataUrl: string, region: QuantSelectedRegion) {
  const image = new Image();
  image.decoding = "async";
  image.src = dataUrl;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("The selected chart region could not be decoded."));
  });
  const sourceX = Math.floor(image.naturalWidth * clampRatio(region.xRatio));
  const sourceY = Math.floor(image.naturalHeight * clampRatio(region.yRatio));
  const width = Math.max(1, Math.min(image.naturalWidth - sourceX, Math.round(image.naturalWidth * clampRatio(region.widthRatio))));
  const height = Math.max(1, Math.min(image.naturalHeight - sourceY, Math.round(image.naturalHeight * clampRatio(region.heightRatio))));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot create a chart-region attachment.");
  context.drawImage(image, sourceX, sourceY, width, height, 0, 0, width, height);
  return { dataUrl: canvas.toDataURL("image/png"), height, width };
}

function SharedWorkspaceCopySurface({
  artifact,
  localOnly,
  onClose,
}: {
  artifact: WorkspaceShareCopyArtifact;
  localOnly: boolean;
  onClose: () => void;
}) {
  const chart = artifact.payload.chart;
  const panels = artifact.payload.panels;
  const workspace = artifact.payload.workspace;
  return (
    <div
      className="min-h-screen overflow-x-hidden bg-[#05070a] text-slate-100"
      data-workspace-share-copy={artifact.id}
    >
      <a
        className="fixed left-3 top-3 z-50 -translate-y-20 rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-[#041217] outline-none transition focus:translate-y-0 focus:ring-2 focus:ring-white"
        href="#copied-workspace-content"
      >
        Skip to copied workspace
      </a>
      <header className="border-b border-white/10 bg-[#080d13]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cyan-300/10 text-cyan-200">
              <ClipboardCheck aria-hidden="true" size={20} />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">
                Independent snapshot copy
              </div>
              <div className="truncate text-sm text-slate-400">{artifact.title}</div>
            </div>
          </div>
          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 px-4 text-sm font-semibold text-slate-200 outline-none hover:border-cyan-300/40 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-300"
            onClick={onClose}
            type="button"
          >
            <ArrowLeft aria-hidden="true" size={16} />
            Back to sessions
          </button>
        </div>
      </header>

      <main
        className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 sm:py-10 lg:px-8"
        id="copied-workspace-content"
        tabIndex={-1}
      >
        {localOnly ? (
          <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm leading-6 text-amber-100" role="status">
            This copy is saved only on this device because account sync was unavailable. Keep this browser data to retain the copy.
          </div>
        ) : null}
        <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="break-words text-3xl font-semibold tracking-[-0.025em] text-white sm:text-4xl">
              {artifact.title}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-400">
              <span>{workspaceShareScopeLabel(artifact.scope)}</span>
              <span aria-hidden="true" className="h-1 w-1 rounded-full bg-slate-600" />
              <span className="inline-flex items-center gap-2">
                <Clock3 aria-hidden="true" size={15} />
                Copied <time dateTime={artifact.copiedAt}>{formatSharedCopyDate(artifact.copiedAt)}</time>
              </span>
            </div>
          </div>
          <div className="max-w-xl rounded-xl bg-cyan-300/[0.07] px-4 py-3 text-sm leading-6 text-cyan-50" role="status">
            This saved copy is isolated from every backtest session. Its chart and aggregate results come only from the sanitized snapshot.
          </div>
        </section>

        {chart ? (
          <section aria-labelledby="copied-chart-title" className="overflow-hidden rounded-2xl bg-[#080d13] shadow-[0_24px_70px_rgba(0,0,0,0.38)]">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 px-4 py-4 sm:px-5">
              <div>
                <h2 className="text-lg font-semibold text-white" id="copied-chart-title">
                  {chart.symbol} · {chart.timeframe}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  {chart.candles.length.toLocaleString()} candle{chart.candles.length === 1 ? "" : "s"} · {chart.panes.length} pane{chart.panes.length === 1 ? "" : "s"}
                </p>
              </div>
              <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400">
                <LineChart aria-hidden="true" size={15} />
                Copied market view
              </span>
            </div>
            <SharedCopyCandlestickPreview candles={chart.candles} />
            <dl className="grid gap-px border-t border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
              <SharedCopyDetail label="Symbol" value={chart.symbol} />
              <SharedCopyDetail label="Chart interval" value={chart.timeframe} />
              <SharedCopyDetail label="Pane grid" value={chart.paneLayout} />
              <SharedCopyDetail
                label="Snapshot time"
                value={chart.currentTimestamp ? formatSharedCopyDate(chart.currentTimestamp) : "Not set"}
              />
            </dl>
            <div className="border-t border-white/10 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-white">Copied chart panes</h3>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {chart.panes.map((pane) => (
                  <article className="rounded-xl border border-white/10 bg-black/20 p-4" key={pane.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="truncate text-sm font-semibold text-white">{pane.id}</h4>
                        <p className="mt-1 text-xs text-slate-500">{pane.timeframe} · {pane.chartStyle}</p>
                      </div>
                      {pane.id === chart.activePaneId ? (
                        <span className="rounded-full bg-cyan-300/10 px-2 py-1 text-[11px] font-semibold text-cyan-200">Active</span>
                      ) : null}
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                      <SharedCopyPaneDetail label="Cursor" value={pane.drawingTool} />
                      <SharedCopyPaneDetail label="Magnet" value={pane.magnetMode} />
                      <SharedCopyPaneDetail label="Smoothing" value={pane.smoothCandles ? "On" : "Off"} />
                      <SharedCopyPaneDetail label="Drawings" value={String(pane.drawings.length)} />
                    </dl>
                    <div className="mt-3 rounded-lg bg-white/[0.035] px-3 py-2 text-xs leading-5 text-slate-400">
                      <span className="font-semibold text-slate-300">Indicators:</span>{" "}
                      {pane.indicatorInstances.length > 0
                        ? pane.indicatorInstances.map((indicator) => indicator.kind).join(", ")
                        : "None"}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {panels ? <SharedCopyMetrics metrics={panels.metrics} activePanel={panels.activePanel} /> : null}

        {workspace ? (
          <section aria-labelledby="copied-workspace-config" className="rounded-2xl bg-[#080d13] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.28)]">
            <div className="flex items-center gap-2">
              <Database aria-hidden="true" className="text-cyan-300" size={17} />
              <h2 className="text-base font-semibold text-white" id="copied-workspace-config">Workspace configuration</h2>
            </div>
            <dl className="mt-4 grid gap-px overflow-hidden rounded-xl bg-white/10 sm:grid-cols-2 lg:grid-cols-5">
              <SharedCopyDetail label="Layout" value={workspace.layoutName} />
              <SharedCopyDetail label="View" value={workspace.activeView === "backtest" ? "Backtest" : workspace.activeView} />
              <SharedCopyDetail label="Sidebar" value={workspace.sidebarCollapsed ? "Collapsed" : "Expanded"} />
              <SharedCopyDetail label="Timezone" value={workspace.timezone ?? "Workspace default"} />
              <SharedCopyDetail label="Pane grid" value={workspace.paneLayout} />
            </dl>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function SharedCopyCandlestickPreview({ candles }: { candles: WorkspaceShareCandle[] }) {
  const geometry = useMemo(() => buildSharedCopyCandleGeometry(candles), [candles]);
  if (geometry.items.length === 0) {
    return <div className="grid min-h-72 place-items-center px-5 text-sm text-slate-500">No candle data was included in this copy.</div>;
  }
  return (
    <div className="overflow-hidden p-3 sm:p-5">
      <svg
        aria-label={`Copied candlestick chart from ${geometry.low} to ${geometry.high}`}
        className="h-72 w-full"
        preserveAspectRatio="none"
        role="img"
        viewBox="0 0 1000 320"
      >
        <g stroke="#1E293B" strokeWidth="1">
          {[40, 100, 160, 220, 280].map((y) => <line key={y} x1="0" x2="1000" y1={y} y2={y} />)}
        </g>
        {geometry.items.map((item) => (
          <g key={`${item.x}-${item.time}`}>
            <line stroke={item.up ? "#22C55E" : "#EF4444"} strokeWidth="2" x1={item.x} x2={item.x} y1={item.high} y2={item.low} />
            <rect fill={item.up ? "#22C55E" : "#EF4444"} height={Math.max(2, item.bottom - item.top)} rx="1" width={Math.max(2, geometry.width * 0.62)} x={item.x - geometry.width * 0.31} y={item.top} />
          </g>
        ))}
      </svg>
    </div>
  );
}

function buildSharedCopyCandleGeometry(candles: WorkspaceShareCandle[]) {
  const clean = candles.filter((candle) =>
    [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite),
  );
  const high = clean.length > 0 ? Math.max(...clean.map((candle) => candle.high)) : 0;
  const low = clean.length > 0 ? Math.min(...clean.map((candle) => candle.low)) : 0;
  const range = Math.max(high - low, 0.000001);
  const width = clean.length > 0 ? 960 / clean.length : 12;
  const y = (value: number) => 20 + ((high - value) / range) * 280;
  return {
    high,
    low,
    width,
    items: clean.map((candle, index) => ({
      x: 20 + index * width + width / 2,
      high: y(candle.high),
      low: y(candle.low),
      top: y(Math.max(candle.open, candle.close)),
      bottom: y(Math.min(candle.open, candle.close)),
      time: candle.time,
      up: candle.close >= candle.open,
    })),
  };
}

function SharedCopyMetrics({
  activePanel,
  metrics,
}: {
  activePanel: "none" | "review" | "results";
  metrics: WorkspaceShareMetrics;
}) {
  const values = [
    ["Net P&L", formatSharedCopyNumber(metrics.netPnl)],
    ["Win rate", `${metrics.winRate.toFixed(1)}%`],
    ["Total trades", metrics.totalTrades.toLocaleString()],
    ["Winning trades", metrics.winningTrades.toLocaleString()],
    ["Breakeven trades", metrics.breakevenTrades.toLocaleString()],
    ["Profit factor", formatSharedCopyOptional(metrics.profitFactor)],
    ["Max drawdown", formatSharedCopyNumber(metrics.maxDrawdown)],
    ["Average R", formatSharedCopyOptional(metrics.averageR)],
    ["Expectancy", formatSharedCopyOptional(metrics.expectancy)],
  ];
  return (
    <section aria-labelledby="copied-panel-metrics">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-white" id="copied-panel-metrics">Copied aggregate results</h2>
        <span className="text-xs font-semibold text-slate-500">Selected panel: {activePanel}</span>
      </div>
      <dl className="mt-4 grid gap-px overflow-hidden rounded-2xl bg-white/10 sm:grid-cols-2 lg:grid-cols-3">
        {values.map(([label, value]) => (
          <div className="bg-[#080d13] px-4 py-5" key={label}>
            <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</dt>
            <dd className="mt-2 font-data text-xl font-semibold tabular-nums text-white">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function SharedCopyDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-[#080d13] px-4 py-4">
      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</dt>
      <dd className="mt-2 break-words text-sm text-slate-200">{value}</dd>
    </div>
  );
}

function SharedCopyPaneDetail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-slate-500">{label}</dt><dd className="mt-1 font-semibold text-slate-200">{value}</dd></div>;
}

function formatSharedCopyDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatSharedCopyNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, signDisplay: "exceptZero" }).format(value);
}

function formatSharedCopyOptional(value: number | null) {
  return value == null ? "—" : formatSharedCopyNumber(value);
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
  revision?: number;
  schemaVersion?: number;
  settingsDefaultsVersion?: number;
  showOrderOverlays: boolean;
  smoothCandles: boolean;
  timeframe: ChartTimeframe;
  syncSettings?: ChartSyncSettings;
  panelState?: {
    activePanel: "none" | "tape" | "review" | "results";
    layersPanelOpen: boolean;
    orderPanelOpen: boolean;
    sidebarCollapsed: boolean;
  };
  watchlistSelection?: {
    id: string | null;
    symbol: string;
  };
};

type StoredChartLayoutRecord = {
  isDefault?: boolean;
  isStartup?: boolean;
  layout: StoredChartLayout;
  name: string;
  revision: number;
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
    const records = loadChartLayoutRecords();
    const startupRecord = records.find((record) => record.isStartup);
    if (startupRecord) {
      return upgradeStoredChartLayout(startupRecord.layout);
    }
    const activeName = getCachedAppStorageItem<string | null>(
      ACTIVE_CHART_LAYOUT_STORAGE_KEY,
      null,
    );
    const activeRecord = activeName ? loadChartLayoutRecord(activeName) : null;
    if (activeRecord) {
      return upgradeStoredChartLayout(activeRecord.layout);
    }
    const defaultRecord = records.find((record) => record.isDefault);
    if (defaultRecord) return upgradeStoredChartLayout(defaultRecord.layout);

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
  const activeName = getCachedAppStorageItem<string | null>(ACTIVE_CHART_LAYOUT_STORAGE_KEY, null);
  const activeRecord = activeName ? loadChartLayoutRecord(activeName) : null;
  return normalizeLayoutName(
    activeRecord?.name ?? loadChartLayoutRecords().find((record) => record.isDefault)?.name ?? "Default",
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
        revision: Math.max(0, Math.floor(record.revision ?? record.layout.revision ?? 0)),
      }));
  } catch {
    return [];
  }
}

function saveNamedChartLayout(
  name: string,
  layout: StoredChartLayout,
  expectedRevision = 0,
) {
  const normalizedName = normalizeLayoutName(name);
  const allRecords = loadChartLayoutRecords();
  const existing = allRecords.find(
    (record) => normalizeLayoutName(record.name) === normalizedName,
  );
  const revisionState = nextWorkspaceRevision(existing?.revision ?? 0, expectedRevision);
  const recoverySuffix = Date.now().toString(36);
  const savedName = revisionState.conflict
    ? normalizeLayoutName(`${normalizedName.slice(0, 27)} recovered ${recoverySuffix}`)
    : normalizedName;
  const records = allRecords.filter(
    (record) => normalizeLayoutName(record.name) !== savedName &&
      (!revisionState.conflict || normalizeLayoutName(record.name) !== normalizedName),
  );
  if (revisionState.conflict && existing) records.unshift(existing);
  const savedLayout = { ...layout, revision: revisionState.revision, schemaVersion: CHART_WORKSPACE_SCHEMA_VERSION };
  const previousMetadata = revisionState.conflict ? null : existing;
  const savedRecord: StoredChartLayoutRecord = {
    isDefault: previousMetadata?.isDefault === true,
    isStartup: previousMetadata?.isStartup === true,
    layout: savedLayout,
    name: savedName,
    revision: revisionState.revision,
    updatedAt: new Date().toISOString(),
  };
  const nextRecords = [
    savedRecord,
    ...records,
  ].slice(0, 12);
  void saveAppStorageItem(CHART_LAYOUTS_STORAGE_KEY, nextRecords);
  return {
    conflict: revisionState.conflict,
    names: nextRecords.map((record) => record.name),
    record: savedRecord,
  };
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
  const common: ChartIndicatorInstance = {
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
  if (candidate.kind !== "custom") return common;
  if (
    typeof candidate.customScriptId !== "string" ||
    typeof candidate.customScriptSource !== "string" ||
    candidate.customScriptSource.trim().length === 0
  ) {
    return null;
  }
  return {
    ...common,
    customOverlay: candidate.customOverlay === true,
    customScriptId: candidate.customScriptId.trim().slice(0, 96),
    customScriptName:
      typeof candidate.customScriptName === "string"
        ? candidate.customScriptName.trim().slice(0, 80)
        : "EdgeLab Script",
    customScriptSource: candidate.customScriptSource.slice(0, 20_000),
    customScriptVersion:
      typeof candidate.customScriptVersion === "number" &&
      Number.isFinite(candidate.customScriptVersion)
        ? Math.max(1, Math.floor(candidate.customScriptVersion))
        : 1,
    runtimeError:
      typeof candidate.runtimeError === "string"
        ? candidate.runtimeError.slice(0, 320)
        : null,
    settings: {
      ...common.settings,
      customInputs: sanitizeCustomIndicatorInputs(candidate.settings?.customInputs),
    },
  };
}

function sanitizeCustomIndicatorInputs(value: unknown): Record<string, EdgeIndicatorInputValue> {
  if (typeof value !== "object" || value == null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) =>
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) &&
      (typeof item === "boolean" || typeof item === "number" || typeof item === "string") &&
      (typeof item !== "number" || Number.isFinite(item))
        ? [[key, item]]
        : [],
    ),
  );
}

function sanitizeTimeframe(value: unknown): ChartTimeframe {
  return normalizeChartTimeframe(value) ?? "1m";
}

function sanitizePaneSymbol(value: unknown, fallback = "MARKET") {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9:/.!_-]/g, "").slice(0, 48);
  return normalized || fallback;
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
  return isDrawingTool(value) ? value : "crosshair";
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
    symbol: sanitizePaneSymbol(template?.symbol),
    dataSourceId:
      typeof template?.dataSourceId === "string" && template.dataSourceId.trim()
        ? template.dataSourceId.trim().slice(0, 96)
        : null,
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
    symbol: sanitizePaneSymbol(candidate.symbol, fallback.symbol),
    dataSourceId:
      typeof candidate.dataSourceId === "string" && candidate.dataSourceId.trim()
        ? candidate.dataSourceId.trim().slice(0, 96)
        : null,
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
    symbol: layout.watchlistSelection?.symbol ?? "MARKET",
    dataSourceId: null,
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
  maxReplayTimeframe: ChartTimeframe,
): ReplayTimeframeOption[] {
  const source = effectiveSourceFallbackTimeframe(sourceTimeframe);
  const maxSeconds = getTimeframeSeconds(maxReplayTimeframe);
  const candidateTimeframes = [
    source,
    ...panes.map((pane) => coerceTimeframeToSource(pane.timeframe, sourceTimeframe)),
    ...TIMEFRAMES.map((timeframe) => timeframe.id),
  ];
  const seen = new Set<string>();
  return candidateTimeframes
    .flatMap((timeframe) => {
      const normalized = normalizeChartTimeframe(timeframe);
      if (
        !normalized ||
        seen.has(normalized) ||
        !canAggregateTimeframe(normalized, sourceTimeframe) ||
        getTimeframeSeconds(normalized) > maxSeconds
      ) {
        return [];
      }
      seen.add(normalized);
      return [normalized];
    })
    .sort((left, right) => getTimeframeSeconds(left) - getTimeframeSeconds(right) || left.localeCompare(right))
    .map((normalized) => {
      const stepBars = getReplayStepBars(normalized, sourceTimeframe);
      return {
        label: `${formatChartTimeframeLabel(normalized)} bars`,
        sublabel: stepBars === 1 ? "Source step" : `${stepBars} source bars`,
        value: normalized,
      };
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
      isDrawingTool(candidate.tool) &&
      candidate.tool !== "eraser" &&
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
      (candidate.marker == null || typeof candidate.marker === "string") &&
      (candidate.syncKey == null || typeof candidate.syncKey === "string") &&
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
      candidate.tool && ["fib", "fibExtension", "fibChannel", "fibTime", "fibFan"].includes(candidate.tool)
        ? ({
            ...candidate,
            fibExtendLeft: candidate.fibExtendLeft === true,
            fibExtendRight: candidate.fibExtendRight !== false,
            fibLevels: normalizeFibLevels(candidate.fibLevels, candidate.color),
          } as ChartDrawing)
        : (candidate as ChartDrawing);
    return [
      (normalized.tool === "measure" || normalized.tool === "quickMeasure") && normalized.lineStyle === "dashed"
        ? { ...normalized, lineStyle: "solid" }
        : normalized,
    ];
  });
}

function cloneDrawingsForHistory(drawings: ChartDrawing[]) {
  return drawings.map((drawing) => ({
    ...drawing,
    fibLevels: drawing.fibLevels?.map((level) => ({ ...level })),
    syncKey: drawing.syncKey,
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
