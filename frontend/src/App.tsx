import { useEffect, useState } from "react";
import {
  AlertTriangle,
  BadgeDollarSign,
  CircleDot,
  Clock3,
  Database,
  Layers,
  ListOrdered,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Radio,
  ShoppingCart,
  WalletCards,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ChartObjectsPanel } from "./components/ChartObjectsPanel";
import { ChartToolbar } from "./components/ChartToolbar";
import { DatasetSessionPanel } from "./components/DatasetSessionPanel";
import { ExecutionTape } from "./components/ExecutionTape";
import { JournalEntryModal } from "./components/JournalEntryModal";
import { MetricsBar } from "./components/MetricsBar";
import { OrderTicket } from "./components/OrderTicket";
import { PendingOrders } from "./components/PendingOrders";
import { PlaybookBoard } from "./components/PlaybookBoard";
import { PositionPanel } from "./components/PositionPanel";
import { ReplayController } from "./components/ReplayController";
import { ReportsPanel } from "./components/ReportsPanel";
import { Sidebar } from "./components/Sidebar";
import { TradeDetailDrawer } from "./components/TradeDetailDrawer";
import { TradeLog } from "./components/TradeLog";
import { TradingChart } from "./components/TradingChart";
import type { Position, Trade } from "./lib/api";
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
    error,
    isLoading,
    isPlaying,
    speedMs,
    loadInitial,
    newSession,
    jumpToOffset,
    setPlaying,
    stepForward,
  } = useBacktestStore();
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const [reviewTrade, setReviewTrade] = useState<Trade | null>(null);
  const [leftPaneOpen, setLeftPaneOpen] = useState(true);
  const [layersPanelOpen, setLayersPanelOpen] = useState(false);
  const [isChartFullscreen, setIsChartFullscreen] = useState(false);
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
          setLeftPaneOpen(true);
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
  }, [isPlaying, jumpToOffset, selectedDrawingId, setPlaying, state, stepForward]);

  const current = state?.current_candle;
  const metrics = state?.metrics ?? null;
  const orders = state?.orders ?? [];
  const executions = state?.executions ?? [];
  const trades = state?.trades ?? [];
  const position = state?.position ?? null;
  const pendingOrders = orders.filter((order) => order.status === "PENDING").length;
  const workspaceGridClass = leftPaneOpen
    ? "grid gap-4 2xl:grid-cols-[minmax(300px,340px)_minmax(0,1fr)_minmax(300px,360px)]"
    : "grid gap-4 2xl:grid-cols-[68px_minmax(0,1fr)_minmax(300px,360px)]";
  const savedLayoutLabel =
    chartLayoutSavedAt == null
      ? null
      : `Saved ${new Date(chartLayoutSavedAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}`;

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

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#05070a] text-slate-100">
      <div className="flex min-h-screen max-w-full overflow-x-hidden">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-x-hidden p-3 sm:p-4 xl:p-5">
          <DatasetSessionPanel
            datasets={datasets}
            isLoading={isLoading}
            onCreateSession={newSession}
            playbooks={playbooks}
            session={state?.session ?? null}
          />
          <header className="command-header mb-4">
            <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div className="min-w-0">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="status-pill text-emerald-100">
                    <Radio size={14} />
                    Live Replay
                  </span>
                  <span className="status-pill">
                    <Database size={14} />
                    {meta ? `${meta.rows.toLocaleString()} bars` : "Dataset loading"}
                  </span>
                  {state && (
                    <span className="status-pill">
                      <WalletCards size={14} />
                      Session #{state.session.id}
                    </span>
                  )}
                </div>
                <h1 className="text-3xl font-semibold tracking-normal text-white xl:text-4xl">
                  Replay Command Center
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-400">
                  <span className="inline-flex items-center gap-2">
                    <CircleDot size={14} className="text-cyan-200" />
                    {state?.session.symbol ?? "EURUSD"} {state?.session.timeframe ?? "M1"}
                  </span>
                  {current && (
                    <span className="inline-flex items-center gap-2">
                      <Clock3 size={14} />
                      {new Date(current.timestamp).toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <HeaderStat label="Balance" value={money(state?.session.initial_balance ?? 100000)} />
                <HeaderStat label="Realized" value={money(state?.session.realized_pnl ?? 0)} tone={(state?.session.realized_pnl ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"} />
                <HeaderStat label="Mode" value={isPlaying ? "Playing" : "Paused"} tone={isPlaying ? "text-emerald-300" : "text-amber-200"} />
                <HeaderStat label="Offset" value={(state?.session.current_offset ?? 0).toLocaleString()} />
              </div>
            </div>
            <div className="mt-5 flex gap-2 overflow-x-auto">
              <button
                className="workspace-tab inline-flex items-center justify-center gap-2"
                onClick={() => setLeftPaneOpen((value) => !value)}
                type="button"
              >
                {leftPaneOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
                Ticket
              </button>
              {["Replay", "Orders", "Reports", "Journal", "Playbook"].map((item, index) => (
                <button
                  className={`workspace-tab ${index === 0 ? "workspace-tab-active" : ""}`}
                  key={item}
                  type="button"
                >
                  {item}
                </button>
              ))}
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

          <div className="space-y-4">
            <MetricsBar metrics={metrics} />
            <div className={workspaceGridClass}>
              <div className="min-w-0 space-y-4 2xl:order-1">
                {leftPaneOpen ? (
                  <>
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
                        title="Collapse order ticket"
                        type="button"
                      >
                        <PanelLeftClose size={15} />
                      </button>
                    </section>
                    <OrderTicket playbooks={playbooks} />
                    <PositionPanel position={position} />
                  </>
                ) : (
                  <CollapsedExecutionPane
                    executionCount={executions.length}
                    onExpand={() => setLeftPaneOpen(true)}
                    pendingCount={pendingOrders}
                    position={position}
                  />
                )}
              </div>
              <div className={isChartFullscreen ? "chart-fullscreen-shell" : "min-w-0 space-y-4 2xl:order-2"}>
                <ReplayController />
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
                  onToggleFullscreen={() => setIsChartFullscreen((value) => !value)}
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
                <div className={`chart-studio-layout ${layersPanelOpen ? "" : "chart-studio-layout-collapsed"}`}>
                  <div className="min-w-0 space-y-3">
                    <TradingChart
                      activeIndicators={activeIndicators}
                      bars={bars}
                      chartStyle={chartStyle}
                      drawingTool={drawingTool}
                      drawings={drawings}
                      executions={executions}
                      indicatorSettings={indicatorSettings}
                      onAddDrawing={(drawing) => {
                        setDrawings((currentDrawings) => [...currentDrawings, drawing]);
                        setSelectedDrawingId(drawing.id);
                      }}
                      onClearDrawings={clearDrawings}
                      onDeleteDrawing={deleteDrawing}
                      onDrawingToolChange={setDrawingTool}
                      onSelectDrawing={setSelectedDrawingId}
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
                  ) : (
                    <CollapsedLayersPanel
                      activeIndicatorCount={activeIndicators.length}
                      drawingCount={drawings.length}
                      onExpand={() => setLayersPanelOpen(true)}
                      overlaysVisible={showOrderOverlays}
                    />
                  )}
                </div>
                {isChartFullscreen && (
                  <div className="chart-fullscreen-dock">
                    <OrderTicket playbooks={playbooks} />
                    <PositionPanel position={position} />
                    <PendingOrders orders={orders} />
                    <ExecutionTape executions={executions} />
                  </div>
                )}
              </div>
              <div className="min-w-0 space-y-4 2xl:order-3">
                <PendingOrders orders={orders} />
                <ExecutionTape executions={executions} />
              </div>
            </div>
            <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(300px,460px)]">
              <ReportsPanel metrics={metrics} />
              <div className="min-w-0 space-y-4">
                <PlaybookBoard playbooks={playbooks} trades={trades} />
                <TradeLog
                  trades={trades}
                  onEdit={setEditingTrade}
                  onInspect={setReviewTrade}
                />
              </div>
            </div>
          </div>
        </main>
      </div>

      {editingTrade && (
        <JournalEntryModal
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
          trade={reviewTrade}
        />
      )}
    </div>
  );
}

function CollapsedExecutionPane({
  executionCount,
  onExpand,
  pendingCount,
  position,
}: {
  executionCount: number;
  onExpand: () => void;
  pendingCount: number;
  position: Position | null;
}) {
  const isLivePosition = Boolean(position && position.side !== "FLAT" && position.quantity > 0);
  const positionSide = isLivePosition ? (position?.side ?? "Flat") : "Flat";
  const positionSize = isLivePosition
    ? Math.round(position?.quantity ?? 0).toLocaleString()
    : null;
  const positionTone = positionSide === "Flat"
    ? "text-slate-500"
    : positionSide === "LONG"
      ? "text-emerald-300"
      : "text-rose-300";

  return (
    <section className="terminal-panel flex min-w-0 items-center gap-2 p-2 2xl:min-h-[620px] 2xl:flex-col">
      <button
        className="icon-button shrink-0"
        onClick={onExpand}
        title="Expand order ticket"
        type="button"
      >
        <PanelLeftOpen size={17} />
      </button>
      <div className="hidden h-px w-full bg-white/10 2xl:block" />
      <CollapsedAction icon={ShoppingCart} label="Ticket" tone="text-cyan-200" />
      <CollapsedAction
        badge={pendingCount}
        icon={ListOrdered}
        label="Pending"
        tone="text-amber-200"
      />
      <CollapsedAction
        badge={executionCount}
        icon={BadgeDollarSign}
        label={positionSide}
        tone={positionTone}
      />
      <div className="ml-auto hidden min-w-0 flex-1 items-center justify-end gap-2 text-xs text-slate-400 sm:flex 2xl:hidden">
        <span className="truncate">{positionSize ? `${positionSide} ${positionSize}` : "Flat"}</span>
        <span>{pendingCount} pending</span>
      </div>
    </section>
  );
}

function CollapsedLayersPanel({
  activeIndicatorCount,
  drawingCount,
  onExpand,
  overlaysVisible,
}: {
  activeIndicatorCount: number;
  drawingCount: number;
  onExpand: () => void;
  overlaysVisible: boolean;
}) {
  return (
    <aside className="collapsed-layers-panel">
      <button
        className="icon-button h-10 w-10"
        onClick={onExpand}
        title="Expand layers"
        type="button"
      >
        <PanelRightOpen size={17} />
      </button>
      <div className="h-px w-8 bg-white/10" />
      <CollapsedAction
        badge={drawingCount}
        icon={Layers}
        label="Drawings"
        tone="text-cyan-200"
      />
      <CollapsedAction
        badge={activeIndicatorCount}
        icon={ListOrdered}
        label="Studies"
        tone="text-fuchsia-200"
      />
      <CollapsedAction
        icon={overlaysVisible ? BadgeDollarSign : PanelRightClose}
        label={overlaysVisible ? "Overlays On" : "Overlays Off"}
        tone={overlaysVisible ? "text-emerald-300" : "text-slate-500"}
      />
    </aside>
  );
}

function CollapsedAction({
  badge,
  icon: Icon,
  label,
  tone,
}: {
  badge?: number;
  icon: LucideIcon;
  label: string;
  tone: string;
}) {
  return (
    <div
      className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-md border border-white/10 bg-white/5 ${tone}`}
      title={label}
    >
      <Icon size={17} />
      {badge != null && badge > 0 && (
        <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full border border-ink-900 bg-cyan-300 px-1 text-[10px] font-bold text-ink-950">
          {badge > 99 ? "99+" : badge}
        </span>
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
