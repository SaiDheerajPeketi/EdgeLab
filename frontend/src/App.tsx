import { useEffect, useState } from "react";
import {
  AlertTriangle,
  BadgeDollarSign,
  CircleDot,
  Clock3,
  Database,
  ListOrdered,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  ShoppingCart,
  WalletCards,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CandleInspector } from "./components/CandleInspector";
import { ChartObjectsPanel } from "./components/ChartObjectsPanel";
import { ChartToolbar } from "./components/ChartToolbar";
import { ExecutionTape } from "./components/ExecutionTape";
import { JournalEntryModal } from "./components/JournalEntryModal";
import { MarketStrip } from "./components/MarketStrip";
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
  ChartTimeframe,
  DrawingTool,
} from "./lib/charting";
import { useBacktestStore } from "./store/backtestStore";

const CHART_LAYOUT_KEY = "tradezella.chart-layout.v1";

export default function App() {
  const {
    bars,
    meta,
    state,
    playbooks,
    error,
    isLoading,
    isPlaying,
    speedMs,
    loadInitial,
    stepForward,
  } = useBacktestStore();
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const [reviewTrade, setReviewTrade] = useState<Trade | null>(null);
  const [leftPaneOpen, setLeftPaneOpen] = useState(true);
  const [chartLayoutSavedAt, setChartLayoutSavedAt] = useState<number | null>(null);
  const [timeframe, setTimeframe] = useState<ChartTimeframe>(() => {
    const saved = loadChartLayout();
    return saved?.timeframe ?? "1m";
  });
  const [activeIndicators, setActiveIndicators] = useState<ChartIndicatorId[]>(() => {
    const saved = loadChartLayout();
    return saved?.activeIndicators ?? ["ema20", "ema50"];
  });
  const [drawingTool, setDrawingTool] = useState<DrawingTool>("cursor");
  const [drawings, setDrawings] = useState<ChartDrawing[]>(() => {
    const saved = loadChartLayout();
    return saved?.drawings ?? [];
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
    if (!isPlaying) {
      return;
    }
    const timer = window.setInterval(() => {
      void stepForward(1);
    }, speedMs);
    return () => window.clearInterval(timer);
  }, [isPlaying, speedMs, stepForward]);

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

  function saveChartLayout() {
    const payload: StoredChartLayout = {
      activeIndicators,
      drawings,
      showOrderOverlays,
      smoothCandles,
      timeframe,
    };
    window.localStorage.setItem(CHART_LAYOUT_KEY, JSON.stringify(payload));
    setChartLayoutSavedAt(Date.now());
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#05070a] text-slate-100">
      <div className="flex min-h-screen max-w-full overflow-x-hidden">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-x-hidden p-3 sm:p-4 xl:p-5">
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
                    EURUSD M1
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

          <MarketStrip current={current} position={position} />

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
              <div className="min-w-0 space-y-4 2xl:order-2">
                <ReplayController />
                <ChartToolbar
                  activeIndicators={activeIndicators}
                  drawingTool={drawingTool}
                  drawingsCount={drawings.length}
                  onClearDrawings={() => setDrawings([])}
                  onDrawingToolChange={setDrawingTool}
                  onSaveLayout={saveChartLayout}
                  onTimeframeChange={setTimeframe}
                  onToggleIndicator={toggleIndicator}
                  onToggleOrderOverlays={() => setShowOrderOverlays((value) => !value)}
                  onSmoothCandlesChange={setSmoothCandles}
                  orderOverlaysVisible={showOrderOverlays}
                  savedLabel={savedLayoutLabel}
                  smoothCandles={smoothCandles}
                  timeframe={timeframe}
                />
                <div className="chart-studio-layout">
                  <div className="min-w-0 space-y-3">
                    <CandleInspector candle={current} orders={orders} position={position} />
                    <TradingChart
                      activeIndicators={activeIndicators}
                      bars={bars}
                      drawingTool={drawingTool}
                      drawings={drawings}
                      executions={executions}
                      onAddDrawing={(drawing) =>
                        setDrawings((currentDrawings) => [...currentDrawings, drawing])
                      }
                      onClearDrawings={() => setDrawings([])}
                      onDrawingToolChange={setDrawingTool}
                      orders={orders}
                      position={position}
                      showOrderOverlays={showOrderOverlays}
                      smoothCandles={smoothCandles}
                      timeframe={timeframe}
                    />
                  </div>
                  <ChartObjectsPanel
                    activeIndicators={activeIndicators}
                    drawings={drawings}
                    onClearDrawings={() => setDrawings([])}
                    onToggleIndicator={toggleIndicator}
                    onToggleOrderOverlays={() => setShowOrderOverlays((value) => !value)}
                    orderOverlaysVisible={showOrderOverlays}
                    smoothCandles={smoothCandles}
                  />
                </div>
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
  drawings: ChartDrawing[];
  showOrderOverlays: boolean;
  smoothCandles: boolean;
  timeframe: ChartTimeframe;
};

function loadChartLayout(): StoredChartLayout | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(CHART_LAYOUT_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as StoredChartLayout;
  } catch {
    return null;
  }
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
