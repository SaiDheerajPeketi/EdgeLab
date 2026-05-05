import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Clock3,
  Database,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Radio,
  LineChart,
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
import { TradingChart } from "./components/TradingChart";
import type { BacktestCreatePayload, Trade } from "./lib/api";
import type {
  ChartDrawing,
  ChartIndicatorId,
  ChartStyle,
  ChartTimeframe,
  DrawingTool,
  IndicatorSettings,
  IndicatorSettingsMap,
} from "./lib/charting";
import { mergeIndicatorSettings } from "./lib/charting";
import { formatTradingViewSymbol } from "./lib/symbols";
import { tradeStrategyName } from "./lib/strategy";
import { useBacktestStore } from "./store/backtestStore";

const CHART_LAYOUT_KEY = "tradezella.chart-layout.v1";
const CHART_LAYOUTS_KEY = "tradezella.chart-layouts.v1";
const ACTIVE_CHART_LAYOUT_KEY = "tradezella.active-chart-layout.v1";
const VALID_INDICATORS: ChartIndicatorId[] = [
  "bb20",
  "ema20",
  "ema50",
  "macd",
  "rsi14",
  "sma200",
  "vwap",
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
    loadSession,
    loadInitial,
    newSession,
    jumpToOffset,
    setPlaying,
    stepForward,
  } = useBacktestStore();
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const [reviewTrade, setReviewTrade] = useState<Trade | null>(null);
  const [sessionGateOpen, setSessionGateOpen] = useState(true);
  const [leftPaneOpen, setLeftPaneOpen] = useState(false);
  const [chartToolsOpen, setChartToolsOpen] = useState(false);
  const [layersPanelOpen, setLayersPanelOpen] = useState(false);
  const [workspacePanel, setWorkspacePanel] = useState<"none" | "orders" | "review" | "results">("none");
  const [isChartFullscreen, setIsChartFullscreen] = useState(false);
  const [fullscreenOrderPanelOpen, setFullscreenOrderPanelOpen] = useState(false);
  const chartFullscreenRef = useRef<HTMLDivElement | null>(null);
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
  const [activeIndicators, setActiveIndicators] = useState<ChartIndicatorId[]>(() => {
    const saved = loadChartLayout();
    return sanitizeIndicators(saved?.activeIndicators);
  });
  const [indicatorSettings, setIndicatorSettings] = useState<IndicatorSettingsMap>(() => {
    const saved = loadChartLayout();
    return mergeIndicatorSettings(saved?.indicatorSettings);
  });
  const [drawingTool, setDrawingTool] = useState<DrawingTool>("cursor");
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

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    const sourceTimeframe = toChartTimeframe(state?.session.timeframe);
    if (sourceTimeframe) {
      setTimeframe(sourceTimeframe);
    }
  }, [state?.session.id, state?.session.timeframe]);

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
        setDrawings((currentDrawings) => currentDrawings.slice(0, -1));
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
        case "s":
        case "S":
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
          setDrawingTool("cursor");
          setIsChartFullscreen(false);
          setFullscreenOrderPanelOpen(false);
          if (document.fullscreenElement) {
            void document.exitFullscreen().catch(() => undefined);
          }
          break;
        case "Delete":
        case "Backspace":
          setDrawings((currentDrawings) =>
            selectedDrawingId
              ? currentDrawings.filter((drawing) => drawing.id !== selectedDrawingId)
              : currentDrawings.slice(0, -1),
          );
          setSelectedDrawingId(null);
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isChartFullscreen, isPlaying, jumpToOffset, selectedDrawingId, setPlaying, state, stepForward]);

  useEffect(() => {
    function handleFullscreenChange() {
      if (!document.fullscreenElement) {
        setIsChartFullscreen(false);
        setFullscreenOrderPanelOpen(false);
      }
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
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

  function toggleIndicator(indicator: ChartIndicatorId) {
    setActiveIndicators((current) =>
      current.includes(indicator)
        ? current.filter((item) => item !== indicator)
        : [...current, indicator],
    );
  }

  function updateIndicatorSettings(
    indicator: ChartIndicatorId,
    settings: Partial<IndicatorSettings>,
  ) {
    setIndicatorSettings((current) => ({
      ...current,
      [indicator]: {
        ...current[indicator],
        ...settings,
      },
    }));
  }

  function clearDrawings() {
    setDrawings([]);
    setSelectedDrawingId(null);
  }

  function deleteDrawing(drawingId: string) {
    setDrawings((currentDrawings) =>
      currentDrawings.filter((drawing) => drawing.id !== drawingId),
    );
    setSelectedDrawingId(null);
  }

  function toggleChartFullscreen() {
    if (isChartFullscreen) {
      setIsChartFullscreen(false);
      setFullscreenOrderPanelOpen(false);
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
      }
      return;
    }

    setIsChartFullscreen(true);
    const fullscreenTarget = chartFullscreenRef.current;
    if (fullscreenTarget?.requestFullscreen && !document.fullscreenElement) {
      void fullscreenTarget.requestFullscreen().catch(() => undefined);
    }
  }

  function closeOrderPanels() {
    setLeftPaneOpen(false);
    setFullscreenOrderPanelOpen(false);
  }

  function saveChartLayout() {
    const payload: StoredChartLayout = {
      activeIndicators: sanitizeIndicators(activeIndicators),
      chartStyle,
      drawings: sanitizeDrawings(drawings),
      indicatorSettings,
      showOrderOverlays,
      smoothCandles,
      timeframe,
    };
    const name = normalizeLayoutName(layoutName);
    window.localStorage.setItem(CHART_LAYOUT_KEY, JSON.stringify(payload));
    window.localStorage.setItem(ACTIVE_CHART_LAYOUT_KEY, name);
    setLayoutName(name);
    setAvailableLayouts(saveNamedChartLayout(name, payload));
    setChartLayoutSavedAt(Date.now());
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
    setActiveIndicators(sanitizeIndicators(layout.activeIndicators));
    setChartStyle(sanitizeChartStyle(layout.chartStyle));
    setDrawings(sanitizeDrawings(layout.drawings));
    setIndicatorSettings(mergeIndicatorSettings(layout.indicatorSettings));
    setShowOrderOverlays(layout.showOrderOverlays ?? true);
    setSmoothCandles(layout.smoothCandles ?? false);
    setTimeframe(sanitizeTimeframe(layout.timeframe));
  }

  async function createSessionFromGateway(payload: BacktestCreatePayload) {
    await newSession(payload);
    await loadInitial();
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
    setSessionGateOpen(false);
    setLeftPaneOpen(false);
    setChartToolsOpen(false);
    setLayersPanelOpen(false);
    setWorkspacePanel("none");
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#05070a] text-slate-100">
      <div className="flex min-h-screen max-w-full overflow-x-hidden">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-x-hidden p-3 sm:p-4 xl:p-5">
          {sessionGateOpen ? (
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
                onResumeSession={resumeSessionFromGateway}
                playbooks={playbooks}
                session={state?.session ?? null}
                sessions={resultSessions}
                trades={resultTrades}
              />
            </>
          ) : (
            <>
          <header className="backtest-focus-header mb-3">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <span className="status-pill text-emerald-100">
                <Radio size={14} />
                {isPlaying ? "Playing" : "Replay"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-semibold text-white">
                  {state?.session.strategy_name ?? "Strategy"} / {formatTradingViewSymbol(state?.session.symbol)} {state?.session.timeframe ?? "M1"}
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
                onClick={() => setChartToolsOpen((value) => !value)}
                type="button"
              >
                <SlidersHorizontal size={14} />
                Tools
              </button>
              <button
                className={`workspace-tab inline-flex items-center justify-center gap-2 ${isChartFullscreen ? "workspace-tab-active" : ""}`}
                onClick={toggleChartFullscreen}
                type="button"
              >
                {isChartFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                {isChartFullscreen ? "Exit Full" : "Full Screen"}
              </button>
              <button
                className={`workspace-tab ${workspacePanel === "orders" ? "workspace-tab-active" : ""}`}
                onClick={() => setWorkspacePanel((value) => value === "orders" ? "none" : "orders")}
                type="button"
              >
                Orders
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
              <aside className="focus-side-drawer">
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
                <OrderTicket
                  onOrderPlaced={closeOrderPanels}
                  playbooks={playbooks}
                  riskRewardDrawing={latestRiskRewardDrawing}
                />
                <PositionPanel position={position} />
              </aside>
            )}

              <div
                ref={chartFullscreenRef}
                className={
                  isChartFullscreen
                    ? "chart-fullscreen-shell"
                    : "focus-chart-column"
                }
              >
                {isChartFullscreen && (
                  <div className="chart-fullscreen-actionbar">
                    <button
                      className={`chart-fullscreen-action ${fullscreenOrderPanelOpen ? "chart-fullscreen-action-active" : ""}`}
                      onClick={() => setFullscreenOrderPanelOpen((value) => !value)}
                      type="button"
                    >
                      {fullscreenOrderPanelOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
                      Order
                    </button>
                    <button
                      className="chart-fullscreen-action"
                      onClick={toggleChartFullscreen}
                      type="button"
                    >
                      <Minimize2 size={16} />
                      Exit
                    </button>
                  </div>
                )}
                <ReplayController />
                {chartToolsOpen && (
                  <ChartToolbar
                    activeIndicators={activeIndicators}
                    chartStyle={chartStyle}
                    drawingTool={drawingTool}
                    drawingsCount={drawings.length}
                    indicatorSettings={indicatorSettings}
                    isFullscreen={isChartFullscreen}
                    onChartStyleChange={setChartStyle}
                    onClearDrawings={clearDrawings}
                    layoutName={layoutName}
                    layoutNames={availableLayouts}
                    onDrawingToolChange={setDrawingTool}
                    onDeleteLayout={deleteNamedChartLayout}
                    onLayoutNameChange={setLayoutName}
                    onLoadLayout={loadNamedChartLayout}
                    onSaveLayout={saveChartLayout}
                    onToggleFullscreen={toggleChartFullscreen}
                    onTimeframeChange={setTimeframe}
                    onToggleIndicator={toggleIndicator}
                    onToggleOrderOverlays={() => setShowOrderOverlays((value) => !value)}
                    onUpdateIndicatorSettings={updateIndicatorSettings}
                    onSmoothCandlesChange={setSmoothCandles}
                    orderOverlaysVisible={showOrderOverlays}
                    savedLabel={savedLayoutLabel}
                    smoothCandles={smoothCandles}
                    timeframe={timeframe}
                  />
                )}
                <div className={`chart-studio-layout ${layersPanelOpen ? "" : "chart-studio-layout-focus"}`}>
                  <div className="min-w-0 space-y-3">
                    <TradingChart
                      activeIndicators={activeIndicators}
                      bars={bars}
                      chartStyle={chartStyle}
                      drawingTool={drawingTool}
                      drawings={drawings}
                      executions={executions}
                      indicatorSettings={indicatorSettings}
                      isFullscreen={isChartFullscreen}
                      onAddDrawing={(drawing) => {
                        setDrawings((currentDrawings) => [...currentDrawings, drawing]);
                        setSelectedDrawingId(drawing.id);
                      }}
                      onClearDrawings={clearDrawings}
                      onDeleteDrawing={deleteDrawing}
                      onDrawingToolChange={setDrawingTool}
                      onSelectDrawing={setSelectedDrawingId}
                      onToggleFullscreen={toggleChartFullscreen}
                      onUpdateDrawing={(updatedDrawing) =>
                        setDrawings((currentDrawings) =>
                          currentDrawings.map((drawing) =>
                            drawing.id === updatedDrawing.id ? updatedDrawing : drawing,
                          ),
                        )
                      }
                      orders={orders}
                      position={position}
                      selectedDrawingId={selectedDrawingId}
                      showOrderOverlays={showOrderOverlays}
                      symbol={state?.session.symbol}
                      datasetTimeframe={state?.session.timeframe}
                      timeframe={timeframe}
                    />
                  </div>
                  {layersPanelOpen ? (
                    <ChartObjectsPanel
                      activeIndicators={activeIndicators}
                      chartStyle={chartStyle}
                      drawings={drawings}
                      indicatorSettings={indicatorSettings}
                      onClearDrawings={clearDrawings}
                      onCollapse={() => setLayersPanelOpen(false)}
                      onDeleteDrawing={deleteDrawing}
                      onSelectDrawing={setSelectedDrawingId}
                      onToggleIndicator={toggleIndicator}
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
                    <OrderTicket
                      onOrderPlaced={closeOrderPanels}
                      playbooks={playbooks}
                      riskRewardDrawing={latestRiskRewardDrawing}
                    />
                    <PositionPanel position={position} />
                  </div>
                )}
              </div>

            {workspacePanel === "orders" && (
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
                  sessions={resultSessions}
                  trades={resultTrades}
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
  activeIndicators: ChartIndicatorId[];
  chartStyle: ChartStyle;
  drawings: ChartDrawing[];
  indicatorSettings?: Partial<Record<ChartIndicatorId, Partial<IndicatorSettings>>>;
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
  try {
    const activeName = window.localStorage.getItem(ACTIVE_CHART_LAYOUT_KEY);
    const activeRecord = activeName ? loadChartLayoutRecord(activeName) : null;
    if (activeRecord) {
      return activeRecord.layout;
    }

    const raw = window.localStorage.getItem(CHART_LAYOUT_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed != null
      ? (parsed as Partial<StoredChartLayout>)
      : null;
  } catch {
    return null;
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

function sanitizeIndicators(value: unknown): ChartIndicatorId[] {
  if (!Array.isArray(value)) {
    return ["ema20", "ema50"];
  }
  const clean = value.filter((item): item is ChartIndicatorId =>
    VALID_INDICATORS.includes(item as ChartIndicatorId),
  );
  return Array.from(new Set(clean));
}

function sanitizeTimeframe(value: unknown): ChartTimeframe {
  return VALID_TIMEFRAMES.includes(value as ChartTimeframe)
    ? (value as ChartTimeframe)
    : "1m";
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
  return value.filter((drawing): drawing is ChartDrawing => {
    if (typeof drawing !== "object" || drawing == null) {
      return false;
    }
    const candidate = drawing as Partial<ChartDrawing>;
    return (
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
      (candidate.label == null || typeof candidate.label === "string") &&
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
      )
    );
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
