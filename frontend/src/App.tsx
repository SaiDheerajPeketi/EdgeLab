import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import {
  AlertTriangle,
  Clock3,
  Database,
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Radio,
  LineChart,
  Settings2,
  SlidersHorizontal,
  WalletCards,
} from "lucide-react";
import { ChartObjectsPanel } from "./components/ChartObjectsPanel";
import { ChartToolbar } from "./components/ChartToolbar";
import { ExecutionTape } from "./components/ExecutionTape";
import { FilteredTradeReview } from "./components/FilteredTradeReview";
import { JournalEntryModal } from "./components/JournalEntryModal";
import { MetricsBar } from "./components/MetricsBar";
import { OrderTicket } from "./components/OrderTicket";
import { PendingOrders } from "./components/PendingOrders";
import { PlaybookBoard } from "./components/PlaybookBoard";
import { PositionPanel } from "./components/PositionPanel";
import { ReplayController } from "./components/ReplayController";
import { ReportsPanel } from "./components/ReportsPanel";
import { ResultsPanel } from "./components/ResultsPanel";
import { Sidebar } from "./components/Sidebar";
import { SessionGateway } from "./components/SessionGateway";
import { TradeDetailDrawer } from "./components/TradeDetailDrawer";
import { EdgeLabWorkspace } from "./components/EdgeLabWorkspace";
import { TradingChart } from "./components/TradingChart";
import type { BacktestCreatePayload, Trade } from "./lib/api";
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
  createIndicatorInstance,
  createLegacyIndicatorInstance,
  getTimeframeSeconds,
  isIndicatorKind,
  mergeIndicatorSettings,
  nextIndicatorInstanceColor,
  normalizeFibLevels,
} from "./lib/charting";
import {
  DEFAULT_CHART_VISUAL_SETTINGS,
  sanitizeChartVisualSettings,
  type ChartVisualSettings,
} from "./lib/chartSettings";
import { formatMarketSymbol } from "./lib/symbols";
import { tradeStrategyName } from "./lib/strategy";
import type { WorkspaceView } from "./lib/workspace";
import { useBacktestStore } from "./store/backtestStore";

const CHART_LAYOUT_KEY = "edgelab.chart-layout.v1";
const CHART_LAYOUTS_KEY = "edgelab.chart-layouts.v1";
const ACTIVE_CHART_LAYOUT_KEY = "edgelab.active-chart-layout.v1";
const CHART_SETTINGS_DEFAULTS_VERSION = 2;
const STALE_SINGLE_HORIZONTAL_PURGE_KEY =
  "edgelab.chart-layout-cleared-single-horizontal.v1";
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
const VALID_TIMEFRAMES: ChartTimeframe[] = [
  "1m",
  "5m",
  "15m",
  "30m",
  "1H",
  "4H",
  "1D",
  "1W",
  "1M",
];
const VALID_CHART_STYLES: ChartStyle[] = ["area", "candles", "heikinAshi", "line"];

export default function App() {
  const {
    bars,
    datasets,
    meta,
    state,
    playbooks,
    resultSessions,
    resultTrades,
    error,
    isLoading,
    isPlaying,
    speedMs,
    createPlaybook,
    loadSession,
    loadInitial,
    newSession,
    jumpToOffset,
    setPlaying,
    stepForward,
  } = useBacktestStore();
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const [reviewTrade, setReviewTrade] = useState<Trade | null>(null);
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
  const chartShellRef = useRef<HTMLDivElement | null>(null);
  const skipNextToolsClickRef = useRef(false);
  const [chartLayoutSavedAt, setChartLayoutSavedAt] = useState<number | null>(null);
  const [layoutName, setLayoutName] = useState(() => loadActiveLayoutName());
  const [availableLayouts, setAvailableLayouts] = useState(() => loadSavedLayoutNames());
  const [timeframe, setTimeframe] = useState<ChartTimeframe>(() => {
    const saved = loadChartLayout();
    return sanitizeTimeframe(saved?.timeframe);
  });
  const [chartStyle, setChartStyle] = useState<ChartStyle>(() => {
    const saved = loadChartLayout();
    return sanitizeChartStyle(saved?.chartStyle);
  });
  const [chartSettings, setChartSettings] = useState<ChartVisualSettings>(() => {
    const saved = loadChartLayout();
    return sanitizeChartVisualSettings(saved?.chartSettings);
  });
  const [indicatorInstances, setIndicatorInstances] = useState<ChartIndicatorInstance[]>(() => {
    const saved = loadChartLayout();
    return sanitizeIndicatorInstances(
      saved?.indicatorInstances,
      saved?.activeIndicators,
      saved?.indicatorSettings,
    );
  });
  const [drawingTool, setDrawingTool] = useState<DrawingTool>("cursor");
  const [magnetMode, setMagnetMode] = useState<MagnetMode>(() => {
    const saved = loadChartLayout();
    return sanitizeMagnetMode(saved?.magnetMode);
  });
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [drawings, setDrawings] = useState<ChartDrawing[]>(() => {
    const saved = loadChartLayout();
    return sanitizeDrawings(saved?.drawings);
  });
  const [showOrderOverlays, setShowOrderOverlays] = useState(() => {
    const saved = loadChartLayout();
    return saved?.showOrderOverlays ?? true;
  });
  const [smoothCandles, setSmoothCandles] = useState(() => {
    const saved = loadChartLayout();
    return saved?.smoothCandles ?? false;
  });
  const sourceTimeframe = toChartTimeframe(state?.session.timeframe);
  const effectiveTimeframe = coerceTimeframeToSource(timeframe, sourceTimeframe);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    if (sourceTimeframe) {
      setTimeframe(sourceTimeframe);
    }
  }, [state?.session.id, sourceTimeframe]);

  useEffect(() => {
    if (timeframe !== effectiveTimeframe) {
      setTimeframe(effectiveTimeframe);
    }
  }, [effectiveTimeframe, timeframe]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }
    const timer = window.setInterval(() => {
      void stepForward(1);
    }, speedMs);
    return () => window.clearInterval(timer);
  }, [isPlaying, speedMs, stepForward]);

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

      if (event.ctrlKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        removeLastUnlockedDrawing();
        return;
      }

      switch (event.key) {
        case "ArrowRight":
          event.preventDefault();
          void stepForward(1);
          break;
        case "ArrowLeft":
          event.preventDefault();
          if (state) {
            void jumpToOffset(Math.max(state.session.start_offset, state.session.current_offset - 1));
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
          setDrawingTool("horizontal");
          break;
        case "t":
        case "T":
          setDrawingTool("trendline");
          break;
        case "r":
        case "R":
          setDrawingTool("rectangle");
          break;
        case "f":
        case "F":
          setDrawingTool("fib");
          break;
        case "l":
        case "L":
          setDrawingTool("text");
          break;
        case "m":
        case "M":
          setDrawingTool("measure");
          break;
        case "Escape":
          event.preventDefault();
          if (drawingTool !== "cursor") {
            setDrawingTool("cursor");
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
  }, [drawingTool, isChartFullscreen, isPlaying, jumpToOffset, removeLastUnlockedDrawing, selectedDrawingId, setPlaying, state, stepForward]);

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

  const current = state?.current_candle;
  const metrics = state?.metrics ?? null;
  const orders = state?.orders ?? [];
  const executions = state?.executions ?? [];
  const trades = state?.trades ?? [];
  const position = state?.position ?? null;
  const pendingOrders = orders.filter((order) => order.status === "PENDING").length;
  const savedLayoutLabel =
    chartLayoutSavedAt == null
      ? null
      : `Saved ${new Date(chartLayoutSavedAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}`;
  const latestRiskRewardDrawing = findLatestRiskRewardDrawing(drawings);
  function navigateWorkspace(view: WorkspaceView) {
    setActiveWorkspace(view);
    if (view === "sessions") {
      setPlaying(false);
      setSessionGateOpen(true);
      return;
    }
    if (view === "backtest") {
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

  function toggleIndicatorVisibility(instanceId: string) {
    setIndicatorInstances((current) =>
      current.map((indicator) =>
        indicator.id === instanceId
          ? { ...indicator, visible: indicator.visible === false }
          : indicator,
      ),
    );
  }

  function changeTimeframe(nextTimeframe: ChartTimeframe) {
    setTimeframe(coerceTimeframeToSource(nextTimeframe, sourceTimeframe));
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

  function clearDrawings() {
    const nextDrawings = drawings.filter((drawing) => drawing.locked);
    setDrawings(nextDrawings);
    if (!nextDrawings.some((drawing) => drawing.id === selectedDrawingId)) {
      setSelectedDrawingId(null);
    }
    persistChartLayoutWithDrawings(nextDrawings);
  }

  function deleteDrawing(drawingId: string) {
    const targetDrawing = drawings.find((drawing) => drawing.id === drawingId);
    if (!targetDrawing || targetDrawing.locked) {
      return;
    }
    const nextDrawings = drawings.filter((drawing) => drawing.id !== drawingId);
    setDrawings(nextDrawings);
    setSelectedDrawingId(null);
    persistChartLayoutWithDrawings(nextDrawings);
  }

  function removeLastUnlockedDrawing() {
    const drawing = [...drawings].reverse().find((item) => !item.locked);
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
    window.localStorage.setItem(CHART_LAYOUT_KEY, JSON.stringify(payload));
    window.localStorage.setItem(ACTIVE_CHART_LAYOUT_KEY, name);
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
    window.localStorage.setItem(CHART_LAYOUT_KEY, JSON.stringify(payload));
    window.localStorage.setItem(ACTIVE_CHART_LAYOUT_KEY, name);
    setLayoutName(name);
    setAvailableLayouts(saveNamedChartLayout(name, payload));
    setChartLayoutSavedAt(Date.now());
  }

  function buildChartLayoutPayload(nextDrawings: ChartDrawing[]): StoredChartLayout {
    return {
      chartSettings: sanitizeChartVisualSettings(chartSettings),
      chartStyle,
      drawings: sanitizeDrawings(nextDrawings),
      indicatorInstances: sanitizeIndicatorInstances(indicatorInstances),
      magnetMode,
      settingsDefaultsVersion: CHART_SETTINGS_DEFAULTS_VERSION,
      showOrderOverlays,
      smoothCandles,
      timeframe: effectiveTimeframe,
    };
  }

  function loadNamedChartLayout(name: string) {
    const record = loadChartLayoutRecord(name);
    if (!record) {
      return;
    }
    applyChartLayout(record.layout);
    window.localStorage.setItem(ACTIVE_CHART_LAYOUT_KEY, record.name);
    setLayoutName(record.name);
    setChartLayoutSavedAt(Date.now());
  }

  function deleteNamedChartLayout(name: string) {
    const nextNames = deleteChartLayoutRecord(name);
    setAvailableLayouts(nextNames);
    if (normalizeLayoutName(name) === normalizeLayoutName(layoutName)) {
      setLayoutName(nextNames[0] ?? "Default");
      window.localStorage.removeItem(ACTIVE_CHART_LAYOUT_KEY);
    }
  }

  function applyChartLayout(layout: Partial<StoredChartLayout>) {
    setIndicatorInstances(
      sanitizeIndicatorInstances(
        layout.indicatorInstances,
        layout.activeIndicators,
        layout.indicatorSettings,
      ),
    );
    setChartStyle(sanitizeChartStyle(layout.chartStyle));
    setChartSettings(sanitizeChartVisualSettings(layout.chartSettings));
    setDrawings(sanitizeDrawings(layout.drawings));
    setMagnetMode(sanitizeMagnetMode(layout.magnetMode));
    setShowOrderOverlays(layout.showOrderOverlays ?? true);
    setSmoothCandles(layout.smoothCandles ?? false);
    setTimeframe(coerceTimeframeToSource(sanitizeTimeframe(layout.timeframe), sourceTimeframe));
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
    setActiveWorkspace("backtest");
    setSessionGateOpen(false);
    setLeftPaneOpen(false);
    setChartToolsOpen(false);
    setLayersPanelOpen(false);
    setWorkspacePanel("none");
  }

  const unlockedDrawingsCount = drawings.filter((drawing) => !drawing.locked).length;
  const backtestFocusHeader = (
    <header className="backtest-focus-header">
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
          <HeaderStat label="Realized" value={money(state?.session.realized_pnl ?? 0)} tone={(state?.session.realized_pnl ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"} />
          <HeaderStat label="Position" value={position && position.side !== "FLAT" && position.quantity > 0 ? position.side : "Flat"} tone={position?.side === "LONG" ? "text-emerald-300" : position?.side === "SHORT" ? "text-rose-300" : "text-slate-300"} />
          <HeaderStat label="Pending" value={String(pendingOrders)} />
        </div>
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto">
        <button
          className="workspace-tab inline-flex items-center justify-center gap-2"
          onClick={() => {
            setPlaying(false);
            setActiveWorkspace("sessions");
            setSessionGateOpen(true);
          }}
          type="button"
        >
          <Database size={14} />
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
          <SlidersHorizontal size={14} />
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
          className={`workspace-tab ${workspacePanel === "tape" ? "workspace-tab-active" : ""}`}
          onClick={() => setWorkspacePanel((value) => value === "tape" ? "none" : "tape")}
          type="button"
        >
          Orders Tape
        </button>
        <button
          className={`workspace-tab ${workspacePanel === "review" ? "workspace-tab-active" : ""}`}
          onClick={() => setWorkspacePanel((value) => value === "review" ? "none" : "review")}
          type="button"
        >
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

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#05070a] text-slate-100">
      <div className="flex min-h-screen max-w-full overflow-x-hidden">
        <Sidebar
          activeView={activeWorkspace}
          collapsed={sidebarCollapsed}
          onNavigate={navigateWorkspace}
        />
        <main className="min-w-0 flex-1 overflow-x-hidden p-3 sm:p-4 xl:p-5">
          {activeWorkspace !== "sessions" && activeWorkspace !== "backtest" ? (
            <EdgeLabWorkspace
              activeSession={state?.session ?? null}
              datasets={datasets}
              onEditTrade={setEditingTrade}
              onInspectTrade={setReviewTrade}
              onNavigateBacktest={() => {
                setActiveWorkspace("backtest");
                setSessionGateOpen(false);
              }}
              onNavigateSessions={() => {
                setActiveWorkspace("sessions");
                setSessionGateOpen(true);
              }}
              onResumeSession={resumeSessionFromGateway}
              onCreatePlaybook={createPlaybook}
              playbooks={playbooks}
              sessions={resultSessions}
              trades={resultTrades}
              view={activeWorkspace}
            />
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
                onResumeSession={resumeSessionFromGateway}
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
          {isLoading && (
            <div className="mb-4 rounded-md border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100">
              Loading workspace
            </div>
          )}

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
                  <PositionPanel position={position} />
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
                {backtestFocusHeader}
                <ReplayController
                  dateFormat={chartSettings.dateFormat}
                  dayOfWeekLabels={chartSettings.dayOfWeekLabels}
                  isOrderPaneOpen={isChartFullscreen ? fullscreenOrderPanelOpen : leftPaneOpen}
                  onToggleOrderPane={toggleOrderPanel}
                  showOrderToggle={isChartFullscreen}
                  timeHoursFormat={chartSettings.timeHoursFormat}
                />
                {(chartToolsOpen || chartSettingsPanelOpen) && (
                  <ChartToolbar
                    key={chartToolsOpen ? "chart-tools" : "chart-settings"}
                    chartSettings={chartSettings}
                    chartStyle={chartStyle}
                    clearableDrawingsCount={unlockedDrawingsCount}
                    drawingTool={drawingTool}
                    drawingsCount={drawings.length}
                    indicatorInstances={indicatorInstances}
                    onAddIndicator={addIndicator}
                    onChartSettingsChange={(settings) =>
                      setChartSettings(sanitizeChartVisualSettings(settings))
                    }
                    onChartSettingsReset={() =>
                      setChartSettings(DEFAULT_CHART_VISUAL_SETTINGS)
                    }
                    onChartStyleChange={setChartStyle}
                    onClearDrawings={clearDrawings}
                    layoutName={layoutName}
                    layoutNames={availableLayouts}
                    onDrawingToolChange={setDrawingTool}
                    onDeleteLayout={deleteNamedChartLayout}
                    onLayoutNameChange={setLayoutName}
                    onLoadLayout={loadNamedChartLayout}
                    magnetMode={magnetMode}
                    onMagnetModeChange={setMagnetMode}
                    onSaveLayout={saveChartLayout}
                    onTimeframeChange={changeTimeframe}
                    onToggleOrderOverlays={() => setShowOrderOverlays((value) => !value)}
                    onRemoveIndicator={removeIndicator}
                    onUpdateIndicatorSettings={updateIndicatorSettings}
                    onSettingsClose={handleChartSettingsClose}
                    onSmoothCandlesChange={setSmoothCandles}
                    orderOverlaysVisible={showOrderOverlays}
                    savedLabel={savedLayoutLabel}
                    settingsOpenSignal={chartSettingsOpenSignal}
                    smoothCandles={smoothCandles}
                    sourceTimeframe={sourceTimeframe}
                    timeframe={effectiveTimeframe}
                    toolsOpen={chartToolsOpen}
                  />
                )}
                <div className={`chart-studio-layout ${layersPanelOpen ? "" : "chart-studio-layout-focus"}`}>
                  <div className="min-w-0 space-y-3">
                    <TradingChart
                      bars={bars}
                      chartSettings={chartSettings}
                      chartStyle={chartStyle}
                      drawingTool={drawingTool}
                      drawings={drawings}
                      executions={executions}
                      indicatorInstances={indicatorInstances}
                      magnetMode={magnetMode}
                      onAddDrawing={(drawing) => {
                        setDrawings((currentDrawings) => [...currentDrawings, drawing]);
                        setSelectedDrawingId(drawing.id);
                      }}
                      onClearDrawings={clearDrawings}
                      onDeleteDrawing={deleteDrawing}
                      onDrawingToolChange={setDrawingTool}
                      onRemoveIndicator={removeIndicator}
                      onSelectDrawing={setSelectedDrawingId}
                      onToggleIndicatorVisibility={toggleIndicatorVisibility}
                      onUpdateDrawing={(updatedDrawing) =>
                        setDrawings((currentDrawings) =>
                          currentDrawings.map((drawing) =>
                            drawing.id === updatedDrawing.id ? updatedDrawing : drawing,
                          ),
                        )
                      }
                      onUpdateIndicatorSettings={updateIndicatorSettings}
                      orders={orders}
                      position={position}
                      selectedDrawingId={selectedDrawingId}
                      showOrderOverlays={showOrderOverlays}
                      symbol={state?.session.symbol}
                      datasetTimeframe={state?.session.timeframe}
                      timeframe={effectiveTimeframe}
                    />
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
                      onUpdateDrawing={(updatedDrawing) =>
                        setDrawings((currentDrawings) =>
                          currentDrawings.map((drawing) =>
                            drawing.id === updatedDrawing.id ? updatedDrawing : drawing,
                          ),
                        )
                      }
                      onUpdateIndicatorSettings={updateIndicatorSettings}
                      onToggleOrderOverlays={() => setShowOrderOverlays((value) => !value)}
                      orderOverlaysVisible={showOrderOverlays}
                      selectedDrawingId={selectedDrawingId}
                      smoothCandles={smoothCandles}
                    />
                  ) : null}
                </div>
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
                      <PositionPanel position={position} />
                    </div>
                  </div>
                )}
              </div>

            {workspacePanel === "tape" && (
              <section className="focus-bottom-panel">
                <PositionPanel position={position} />
                <PendingOrders orders={orders} />
                <ExecutionTape executions={executions} />
              </section>
            )}

            {workspacePanel === "review" && (
              <section className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <PlaybookBoard playbooks={playbooks} trades={trades} />
                <FilteredTradeReview
                  trades={trades}
                  onEdit={setEditingTrade}
                  onInspect={setReviewTrade}
                />
              </section>
            )}

            {workspacePanel === "results" && (
              <section className="min-w-0 space-y-4">
                <ResultsPanel
                  activeSessionId={state?.session.id ?? null}
                  onInspectTrade={setReviewTrade}
                  sessions={state?.session ? [state.session] : []}
                  trades={trades}
                />
                <div className="space-y-4">
                  <div className="terminal-panel px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Active Session Detail
                    </div>
                    <div className="mt-1 text-sm font-semibold text-white">
                      {state?.session.name ?? "Current replay"}
                    </div>
                  </div>
                  <MetricsBar metrics={metrics} />
                  <ReportsPanel metrics={metrics} />
                </div>
              </section>
            )}
          </div>
            </>
          )}
        </main>
      </div>

      {editingTrade && (
        <JournalEntryModal
          strategyScope={strategyScopeForTrade(editingTrade, resultSessions, state?.session ?? null)}
          trade={editingTrade}
          onClose={() => setEditingTrade(null)}
        />
      )}

      {reviewTrade && (
        <TradeDetailDrawer
          executions={executions}
          onClose={() => setReviewTrade(null)}
          onJournal={(trade) => {
            setReviewTrade(null);
            setEditingTrade(trade);
          }}
          strategyScope={strategyScopeForTrade(reviewTrade, resultSessions, state?.session ?? null)}
          trade={reviewTrade}
        />
      )}
    </div>
  );
}

type StoredChartLayout = {
  activeIndicators?: ChartIndicatorId[];
  chartSettings?: ChartVisualSettings;
  chartStyle: ChartStyle;
  drawings: ChartDrawing[];
  indicatorInstances: ChartIndicatorInstance[];
  indicatorSettings?: Partial<Record<ChartIndicatorId, Partial<IndicatorSettings>>>;
  magnetMode: MagnetMode;
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

function loadChartLayout(): Partial<StoredChartLayout> | null {
  if (typeof window === "undefined") {
    return null;
  }
  purgeStaleSingleHorizontalDrawing();
  try {
    const activeName = window.localStorage.getItem(ACTIVE_CHART_LAYOUT_KEY);
    const activeRecord = activeName ? loadChartLayoutRecord(activeName) : null;
    if (activeRecord) {
      return upgradeStoredChartLayout(activeRecord.layout);
    }

    const raw = window.localStorage.getItem(CHART_LAYOUT_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed != null
      ? upgradeStoredChartLayout(parsed as Partial<StoredChartLayout>)
      : null;
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
  if (typeof window === "undefined") {
    return;
  }
  if (window.localStorage.getItem(STALE_SINGLE_HORIZONTAL_PURGE_KEY) === "1") {
    return;
  }
  window.localStorage.setItem(STALE_SINGLE_HORIZONTAL_PURGE_KEY, "1");

  try {
    const rawLegacyLayout = window.localStorage.getItem(CHART_LAYOUT_KEY);
    const legacyLayout = rawLegacyLayout
      ? (JSON.parse(rawLegacyLayout) as Partial<StoredChartLayout>)
      : null;
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
      window.localStorage.setItem(
        CHART_LAYOUT_KEY,
        JSON.stringify({ ...legacyLayout, drawings: [] }),
      );
    }

    if (records.length > 0) {
      window.localStorage.setItem(
        CHART_LAYOUTS_KEY,
        JSON.stringify(
          records.map((record) => ({
            ...record,
            layout: {
              ...record.layout,
              drawings: [],
            },
            updatedAt: new Date().toISOString(),
          })),
        ),
      );
    }
  } catch {
    // Ignore invalid local layout JSON; normal sanitizers handle the fallback path.
  }
}

function loadActiveLayoutName() {
  if (typeof window === "undefined") {
    return "Default";
  }
  return normalizeLayoutName(window.localStorage.getItem(ACTIVE_CHART_LAYOUT_KEY) ?? "Default");
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
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(CHART_LAYOUTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
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
  window.localStorage.setItem(CHART_LAYOUTS_KEY, JSON.stringify(nextRecords));
  return nextRecords.map((record) => record.name);
}

function deleteChartLayoutRecord(name: string) {
  if (typeof window === "undefined") {
    return [];
  }
  const normalizedName = normalizeLayoutName(name);
  const nextRecords = loadChartLayoutRecords().filter(
    (record) => normalizeLayoutName(record.name) !== normalizedName,
  );
  window.localStorage.setItem(CHART_LAYOUTS_KEY, JSON.stringify(nextRecords));
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
  return VALID_TIMEFRAMES.includes(value as ChartTimeframe)
    ? (value as ChartTimeframe)
    : "1m";
}

function coerceTimeframeToSource(
  requested: ChartTimeframe,
  source: ChartTimeframe | null,
): ChartTimeframe {
  if (!source) {
    return requested;
  }
  return getTimeframeSeconds(requested) < getTimeframeSeconds(source)
    ? source
    : requested;
}

function sanitizeChartStyle(value: unknown): ChartStyle {
  return VALID_CHART_STYLES.includes(value as ChartStyle)
    ? (value as ChartStyle)
    : "candles";
}

function toChartTimeframe(value: string | null | undefined): ChartTimeframe | null {
  const normalized = value?.toUpperCase();
  switch (normalized) {
    case "M1":
    case "1MIN":
      return "1m";
    case "M5":
    case "5M":
    case "5MIN":
      return "5m";
    case "M15":
    case "15M":
    case "15MIN":
      return "15m";
    case "M30":
    case "30M":
    case "30MIN":
      return "30m";
    case "H1":
    case "1H":
      return "1H";
    case "H4":
    case "4H":
      return "4H";
    case "D":
    case "DAILY":
    case "1D":
      return "1D";
    case "W":
    case "WEEKLY":
    case "1W":
      return "1W";
    case "MONTHLY":
    case "1M":
      return "1M";
    default:
      return null;
  }
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

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
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
