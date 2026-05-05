import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowRight,
  BadgeDollarSign,
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Clock3,
  Copy,
  Database,
  Download,
  Eye,
  FileText,
  Filter,
  FolderPlus,
  Gauge,
  Grid2X2,
  Info,
  LineChart,
  List,
  MoreHorizontal,
  NotebookPen,
  PieChart,
  Plus,
  Search,
  Settings,
  Share2,
  SlidersHorizontal,
  Star,
  Target,
  TrendingDown,
  TrendingUp,
  WalletCards,
  X,
} from "lucide-react";
import type {
  BacktestSession,
  DatasetCatalog,
  Playbook,
  Trade,
} from "../lib/api";
import { formatDateTime, formatMoney, formatPercent, formatPrice } from "../lib/format";
import { formatTradingViewSymbol, symbolBadge } from "../lib/symbols";
import { sessionStrategyName, tradeStrategyName } from "../lib/strategy";
import type { WorkspaceView } from "../lib/workspace";
import { TradeLog } from "./TradeLog";

type WorkspacePageView = Exclude<WorkspaceView, "backtest" | "sessions">;

type Props = {
  activeSession: BacktestSession | null;
  datasets: DatasetCatalog | null;
  onEditTrade: (trade: Trade) => void;
  onInspectTrade: (trade: Trade) => void;
  onNavigateBacktest: () => void;
  onNavigateSessions: () => void;
  onResumeSession: (sessionId?: number) => Promise<void> | void;
  playbooks: Playbook[];
  sessions: BacktestSession[];
  trades: Trade[];
  view: WorkspacePageView;
};

type Aggregate = {
  averageHoldMinutes: number | null;
  averageLoss: number;
  averageR: number | null;
  averageWin: number;
  breakeven: number;
  closed: Trade[];
  grossLosses: number;
  grossWins: number;
  largestLoss: number | null;
  largestWin: number | null;
  losses: number;
  maxDrawdown: number;
  netPnl: number;
  profitFactor: number | null;
  recoveryFactor: number | null;
  totalCommissions: number;
  totalTrades: number;
  winRate: number;
  wins: number;
};

type DayGroup = {
  date: string;
  label: string;
  trades: Trade[];
  aggregate: Aggregate;
};

type StrategyGroup = {
  aggregate: Aggregate;
  name: string;
  sessions: BacktestSession[];
  trades: Trade[];
};

export function TradeZellaWorkspace({
  activeSession,
  datasets,
  onEditTrade,
  onInspectTrade,
  onNavigateBacktest,
  onNavigateSessions,
  onResumeSession,
  playbooks,
  sessions,
  trades,
  view,
}: Props) {
  const sessionById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  );
  const closedTrades = useMemo(
    () =>
      trades
        .filter((trade) => trade.status === "CLOSED")
        .slice()
        .sort(compareTradesAscending),
    [trades],
  );
  const aggregate = useMemo(() => aggregateTrades(closedTrades), [closedTrades]);
  const openTrades = useMemo(
    () => trades.filter((trade) => trade.status === "OPEN"),
    [trades],
  );
  const days = useMemo(() => groupTradesByDay(closedTrades), [closedTrades]);
  const strategies = useMemo(
    () => groupByStrategy(sessions, trades, sessionById),
    [sessionById, sessions, trades],
  );

  const shared = {
    activeSession,
    aggregate,
    closedTrades,
    datasets,
    days,
    onEditTrade,
    onInspectTrade,
    onNavigateBacktest,
    onNavigateSessions,
    onResumeSession,
    openTrades,
    playbooks,
    sessionById,
    sessions,
    strategies,
    trades,
  };

  switch (view) {
    case "accounts":
      return <AccountsPage {...shared} />;
    case "dashboard":
      return <DashboardPage {...shared} />;
    case "dayView":
      return <DayViewPage {...shared} />;
    case "notebook":
      return <NotebookPage {...shared} />;
    case "reports":
      return <ReportsPage {...shared} />;
    case "settings":
      return <SettingsPage {...shared} />;
    case "strategies":
      return <StrategiesPage {...shared} />;
    case "tradeView":
      return <TradeViewPage {...shared} />;
    default:
      return null;
  }
}

type SharedPageProps = {
  activeSession: BacktestSession | null;
  aggregate: Aggregate;
  closedTrades: Trade[];
  datasets: DatasetCatalog | null;
  days: DayGroup[];
  onEditTrade: (trade: Trade) => void;
  onInspectTrade: (trade: Trade) => void;
  onNavigateBacktest: () => void;
  onNavigateSessions: () => void;
  onResumeSession: (sessionId?: number) => Promise<void> | void;
  openTrades: Trade[];
  playbooks: Playbook[];
  sessionById: Map<number, BacktestSession>;
  sessions: BacktestSession[];
  strategies: StrategyGroup[];
  trades: Trade[];
};

function DashboardPage({
  aggregate,
  closedTrades,
  days,
  onInspectTrade,
  onNavigateSessions,
  openTrades,
  sessionById,
  sessions,
}: SharedPageProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [recentMode, setRecentMode] = useState<"closed" | "open">("closed");
  const latestDay = days[0];
  const startingBalance =
    sessions[0]?.initial_balance ?? 100000;
  const accountBalance = startingBalance + aggregate.netPnl;

  return (
    <PageScaffold
      eyebrow="Backtest Dashboard"
      title="Backtest Command Center"
      description="Replay performance, recent simulated activity, account balance, and calendar review from backtest sessions only. Live Journal metrics stay separate."
      actions={
        <div className="relative">
          <button
            className={`control-button ${filtersOpen ? "workspace-tab-active" : ""}`}
            onClick={() => setFiltersOpen((value) => !value)}
            type="button"
          >
            <Filter size={15} />
            Filters
          </button>
          {filtersOpen && <DashboardFilters onClose={() => setFiltersOpen(false)} />}
        </div>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(360px,1fr)_minmax(300px,0.75fr)]">
        <FeatureCard>
          <div className="flex items-center justify-between gap-3">
            <CardLabel icon={TrendingUp} label="Backtest daily P&L" />
            <span className="status-pill">{latestDay?.label ?? "No trade day"}</span>
          </div>
          <div className={`mt-6 text-4xl font-semibold tabular-nums ${toneForNumber(latestDay?.aggregate.netPnl)}`}>
            {formatMoney(latestDay?.aggregate.netPnl ?? 0)}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <CompactMetric label="Trades" value={String(latestDay?.aggregate.totalTrades ?? 0)} />
            <CompactMetric label="Win" value={formatPercent(latestDay?.aggregate.winRate ?? 0)} />
            <CompactMetric label="Avg R" value={formatOptionalNumber(latestDay?.aggregate.averageR)} />
          </div>
        </FeatureCard>

        <FeatureCard>
          <div className="flex items-center justify-between gap-3">
            <CardLabel icon={Activity} label="Recent activity" />
            <div className="flex rounded-md border border-white/10 bg-black/20 p-1">
              <TinyTab active={recentMode === "closed"} onClick={() => setRecentMode("closed")}>
                Recent trades
              </TinyTab>
              <TinyTab active={recentMode === "open"} onClick={() => setRecentMode("open")}>
                Open positions
              </TinyTab>
            </div>
          </div>
          <div className="mt-4 grid max-h-72 gap-2 overflow-auto">
            {(recentMode === "closed" ? closedTrades.slice(-8).reverse() : openTrades).map((trade) => (
              <button
                className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-white/10 bg-black/20 px-3 py-2 text-left transition hover:border-cyan-300/25 hover:bg-cyan-300/5"
                key={trade.id}
                onClick={() => onInspectTrade(trade)}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-white">
                    {tradeSymbol(trade, sessionById)} {trade.side}
                  </span>
                  <span className="text-xs text-slate-500">
                    {formatDateTime(trade.exit_time ?? trade.entry_time)}
                  </span>
                </span>
                <span className={`shrink-0 text-sm font-semibold ${toneForNumber(trade.realized_pnl)}`}>
                  {formatMoney(trade.realized_pnl ?? 0)}
                </span>
              </button>
            ))}
            {(recentMode === "closed" ? closedTrades.length : openTrades.length) === 0 && (
              <EmptyState
                icon={ClipboardList}
                message={recentMode === "closed" ? "Closed trades will appear here." : "No open positions right now."}
              />
            )}
          </div>
        </FeatureCard>

        <FeatureCard>
          <div className="flex items-center justify-between gap-3">
            <CardLabel icon={WalletCards} label="Simulated account balance" />
            <button className="icon-button h-8 w-8" title="Copy balance" type="button">
              <Copy size={14} />
            </button>
          </div>
          <div className="mt-6 text-4xl font-semibold tabular-nums text-white">
            {formatMoney(accountBalance)}
          </div>
          <p className="mt-3 text-sm text-slate-500">
            Simulated from starting balance plus closed replay trade P&L.
          </p>
          <button className="control-button mt-5 w-full" onClick={onNavigateSessions} type="button">
            Manage sessions
            <ArrowRight size={15} />
          </button>
        </FeatureCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.55fr)]">
        <FeatureCard>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <CardLabel icon={CalendarDays} label="Backtest calendar" />
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <button className="icon-button h-8 w-8" type="button">
                <Share2 size={14} />
              </button>
              <button className="icon-button h-8 w-8" type="button">
                <Info size={14} />
              </button>
            </div>
          </div>
          <CalendarHeatmap days={days} />
          <div className="mt-4 grid gap-2 md:grid-cols-4">
            <CompactMetric label="Month P&L" value={formatMoney(aggregate.netPnl)} tone={toneForNumber(aggregate.netPnl)} />
            <CompactMetric label="Trading days" value={String(days.length)} />
            <CompactMetric label="Win rate" value={formatPercent(aggregate.winRate)} />
            <CompactMetric label="Profit factor" value={formatRatio(aggregate.profitFactor)} />
          </div>
        </FeatureCard>
        <FeatureCard>
          <CardLabel icon={TrendingDown} label="Drawdown" />
          <div className="mt-4">
            <AreaSparkline values={drawdownValues(closedTrades)} height={220} tone="rose" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <CompactMetric label="Max DD" value={formatMoney(aggregate.maxDrawdown)} tone="text-rose-300" />
            <CompactMetric label="Recovery" value={formatRatio(aggregate.recoveryFactor)} />
          </div>
        </FeatureCard>
      </div>
    </PageScaffold>
  );
}

function AccountsPage({ aggregate, datasets, sessions }: SharedPageProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [accounts, setAccounts] = useState(() => [
    {
      id: "manual",
      balance: sessions[0]?.initial_balance ?? 100000,
      broker: "Manual",
      name: "Backtesting Account",
      type: "Manual",
      updated: new Date().toISOString(),
    },
  ]);

  function addAccount() {
    setAccounts((current) => [
      ...current,
      {
        id: `account-${current.length + 1}`,
        balance: 10000,
        broker: "CSV",
        name: `CSV Account ${current.length + 1}`,
        type: "CSV Upload",
        updated: new Date().toISOString(),
      },
    ]);
    setModalOpen(false);
  }

  return (
    <PageScaffold
      eyebrow="Backtest Accounts"
      title="Simulated Account Management"
      description="Manual balances and imported CSV sources for replay/backtest sessions. Live brokerage Journal balances are not aggregated here."
      actions={
        <button className="control-button workspace-tab-active" onClick={() => setModalOpen(true)} type="button">
          <Plus size={15} />
          Add new account
        </button>
      }
    >
      <FeatureCard>
        <div className="overflow-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <th className="px-3 py-3 font-medium">Account name</th>
                <th className="px-3 py-3 font-medium">Broker</th>
                <th className="px-3 py-3 font-medium">Balance</th>
                <th className="px-3 py-3 font-medium">Last update</th>
                <th className="px-3 py-3 font-medium">Type</th>
                <th className="px-3 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr className="border-t border-white/10 text-slate-300" key={account.id}>
                  <td className="px-3 py-4 font-semibold text-white">{account.name}</td>
                  <td className="px-3 py-4">{account.broker}</td>
                  <td className="px-3 py-4">
                    <button className="font-semibold text-cyan-100" type="button">
                      {formatMoney(account.balance + aggregate.netPnl)}
                    </button>
                  </td>
                  <td className="px-3 py-4 text-slate-500">{formatDateTime(account.updated)}</td>
                  <td className="px-3 py-4">
                    <span className="status-pill">{account.type}</span>
                  </td>
                  <td className="px-3 py-4">
                    <div className="flex gap-2">
                      <button className="icon-button h-9 w-9" title="Add balance" type="button">
                        <Plus size={14} />
                      </button>
                      <button className="icon-button h-9 w-9" title="More actions" type="button">
                        <MoreHorizontal size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </FeatureCard>
      <FeatureCard>
        <CardLabel icon={Database} label="CSV instruments connected" />
        <div className="mt-4 grid gap-2 md:grid-cols-3">
          {(datasets?.instruments ?? []).map((instrument) => (
            <div className="rounded-md border border-white/10 bg-black/20 px-3 py-3" key={instrument.id}>
              <div className="flex items-center gap-3">
                <span className="session-instrument-badge">{symbolBadge(instrument.symbol)}</span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-white">{instrument.name}</span>
                  <span className="text-xs text-slate-500">
                    {instrument.timeframes.length} timeframes
                  </span>
                </span>
              </div>
            </div>
          ))}
        </div>
      </FeatureCard>
      {modalOpen && (
        <ModalFrame title="Add new account" onClose={() => setModalOpen(false)}>
          <div className="grid gap-3">
            <label className="form-field">
              Account name
              <input className="input-control h-10 normal-case tracking-normal" defaultValue="Manual account" />
            </label>
            <label className="form-field">
              Type
              <select className="input-control h-10 normal-case tracking-normal" defaultValue="Manual">
                <option>Manual</option>
                <option>CSV Upload</option>
              </select>
            </label>
            <label className="form-field">
              Starting balance
              <input className="input-control h-10 normal-case tracking-normal" defaultValue="10000" type="number" />
            </label>
            <label className="form-field">
              Currency
              <select className="input-control h-10 normal-case tracking-normal" defaultValue="USD">
                <option>USD</option>
                <option>INR</option>
              </select>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button className="control-button" onClick={() => setModalOpen(false)} type="button">
                Cancel
              </button>
              <button className="control-button workspace-tab-active" onClick={addAccount} type="button">
                Save account
              </button>
            </div>
          </div>
        </ModalFrame>
      )}
    </PageScaffold>
  );
}

function DayViewPage({ days, onInspectTrade, sessionById }: SharedPageProps) {
  const [mode, setMode] = useState<"day" | "week">("day");
  const visibleDays = days.length > 0 ? days : [];

  return (
    <PageScaffold
      eyebrow="Backtest Day View"
      title="Backtest Daily Review"
      description="Review each replay day with backtest summary stats, mini equity, and the simulated trades inside that day."
      actions={
        <div className="flex rounded-md border border-white/10 bg-black/20 p-1">
          <TinyTab active={mode === "day"} onClick={() => setMode("day")}>Day</TinyTab>
          <TinyTab active={mode === "week"} onClick={() => setMode("week")}>Week</TinyTab>
        </div>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-3">
          {visibleDays.map((day) => (
            <FeatureCard key={day.date}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">{day.label}</div>
                  <div className={`mt-1 text-sm font-semibold ${toneForNumber(day.aggregate.netPnl)}`}>
                    Net P&L {formatMoney(day.aggregate.netPnl)}
                  </div>
                </div>
                <button className="control-button h-9" type="button">
                  <Plus size={14} />
                  Add note
                </button>
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.55fr)_minmax(0,0.45fr)]">
                <AreaSparkline values={cumulativeValues(day.trades)} height={150} />
                <div className="grid grid-cols-2 gap-2">
                  <CompactMetric label="Total trades" value={String(day.aggregate.totalTrades)} />
                  <CompactMetric label="Gross P&L" value={formatMoney(day.aggregate.netPnl)} tone={toneForNumber(day.aggregate.netPnl)} />
                  <CompactMetric label="Winners" value={String(day.aggregate.wins)} tone="text-emerald-300" />
                  <CompactMetric label="Losers" value={String(day.aggregate.losses)} tone="text-rose-300" />
                  <CompactMetric label="Win rate" value={formatPercent(day.aggregate.winRate)} />
                  <CompactMetric label="Profit factor" value={formatRatio(day.aggregate.profitFactor)} />
                </div>
              </div>
              <div className="mt-3 grid gap-2">
                {day.trades.map((trade) => (
                  <button
                    className="flex items-center justify-between rounded-md border border-white/10 bg-black/20 px-3 py-2 text-left text-sm hover:border-cyan-300/25"
                    key={trade.id}
                    onClick={() => onInspectTrade(trade)}
                    type="button"
                  >
                    <span className="text-slate-300">
                      {tradeSymbol(trade, sessionById)} - {trade.side} - {formatDateTime(trade.entry_time)}
                    </span>
                    <span className={toneForNumber(trade.realized_pnl)}>
                      {formatMoney(trade.realized_pnl)}
                    </span>
                  </button>
                ))}
              </div>
            </FeatureCard>
          ))}
          {visibleDays.length === 0 && <EmptyState icon={CalendarDays} message="Closed trades will create daily review cards." />}
        </div>
        <FeatureCard>
          <CardLabel icon={CalendarDays} label="Calendar navigator" />
          <div className="mt-4">
            <CalendarHeatmap compact days={days} />
          </div>
        </FeatureCard>
      </div>
    </PageScaffold>
  );
}

function TradeViewPage({
  closedTrades,
  onEditTrade,
  onInspectTrade,
}: SharedPageProps) {
  return (
    <PageScaffold
      eyebrow="Backtest Trade View"
      title="Backtest Trade Log"
      description="Closed replay trades only, with review notes and tagging. Live actual trades belong in the separate Journal scope."
      actions={
        <button className="control-button" type="button">
          <Download size={15} />
          Export CSV
        </button>
      }
    >
      <FeatureCard>
        <div className="mb-4 grid gap-2 md:grid-cols-5">
          {["Symbol", "Direction", "Strategy", "Tags", "Date range"].map((label) => (
            <label className="form-field" key={label}>
              {label}
              <select className="input-control h-10 normal-case tracking-normal">
                <option>All {label.toLowerCase()}</option>
              </select>
            </label>
          ))}
        </div>
        <TradeLog trades={closedTrades} onEdit={onEditTrade} onInspect={onInspectTrade} />
      </FeatureCard>
    </PageScaffold>
  );
}

function NotebookPage({
  closedTrades,
  onInspectTrade,
  sessionById,
}: SharedPageProps) {
  const [selectedTradeId, setSelectedTradeId] = useState<number | null>(
    closedTrades.at(-1)?.id ?? null,
  );
  const selectedTrade =
    closedTrades.find((trade) => trade.id === selectedTradeId) ??
    closedTrades.at(-1) ??
    null;

  return (
    <PageScaffold
      eyebrow="Backtest Notebook"
      title="Backtest Trade Notes"
      description="A TradeZella-style notebook linked to closed replay trades and session review."
      actions={
        <button className="control-button workspace-tab-active" type="button">
          <FolderPlus size={15} />
          Add folder
        </button>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <FeatureCard className="p-0">
          <div className="border-b border-white/10 p-3">
            <div className="flex items-center gap-2">
              <Search size={15} className="text-slate-500" />
              <input className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-600" placeholder="Search notes" />
              <button className="icon-button h-8 w-8" type="button">
                <Filter size={14} />
              </button>
            </div>
          </div>
          <div className="grid gap-2 p-3">
            <NotebookFolder label={`All notes (${closedTrades.length})`} active />
            <NotebookFolder label="Favorites (0)" />
            <div className="mt-2 flex items-center justify-between text-xs uppercase tracking-[0.16em] text-slate-500">
              Trade Notes
              <button className="icon-button h-7 w-7" type="button">
                <Plus size={13} />
              </button>
            </div>
            {closedTrades.slice().reverse().map((trade) => (
              <button
                className={`flex min-w-0 items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition ${
                  selectedTrade?.id === trade.id
                    ? "border-cyan-300/30 bg-cyan-300/10"
                    : "border-white/10 bg-black/20 hover:border-white/20"
                }`}
                key={trade.id}
                onClick={() => setSelectedTradeId(trade.id)}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-white">
                    {tradeSymbol(trade, sessionById)} : {shortDate(trade.entry_time)}
                  </span>
                  <span className="text-xs text-slate-500">{tradeStrategyName(trade, sessionById.get(trade.session_id))}</span>
                </span>
                <span className={`shrink-0 text-xs font-semibold ${toneForNumber(trade.realized_pnl)}`}>
                  {formatMoney(trade.realized_pnl)}
                </span>
              </button>
            ))}
          </div>
        </FeatureCard>
        <FeatureCard>
          {selectedTrade ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-white">
                    {tradeSymbol(selectedTrade, sessionById)} : {shortDate(selectedTrade.entry_time)}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Created: {formatDateTime(selectedTrade.entry_time)} - Last updated: {formatDateTime(selectedTrade.exit_time)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button className="icon-button h-9 w-9" type="button"><Star size={15} /></button>
                  <button className="icon-button h-9 w-9" type="button"><Share2 size={15} /></button>
                  <button className="icon-button h-9 w-9" type="button"><MoreHorizontal size={15} /></button>
                </div>
              </div>
              <div className="mt-4 rounded-md border border-white/10 bg-black/20 p-4">
                <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Trade summary</div>
                <div className={`mt-2 text-3xl font-semibold ${toneForNumber(selectedTrade.realized_pnl)}`}>
                  {formatMoney(selectedTrade.realized_pnl)}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  <CompactMetric label="Side" value={selectedTrade.side} />
                  <CompactMetric label="Volume" value={formatCompactNumber(selectedTrade.quantity)} />
                  <CompactMetric label="R multiple" value={formatOptionalNumber(selectedTrade.r_multiple)} />
                  <CompactMetric label="Gross P&L" value={formatMoney(selectedTrade.realized_pnl)} tone={toneForNumber(selectedTrade.realized_pnl)} />
                </div>
                <button className="control-button mt-4 workspace-tab-active" onClick={() => onInspectTrade(selectedTrade)} type="button">
                  View trade details
                </button>
              </div>
              <RichTextEditorStub />
            </>
          ) : (
            <EmptyState icon={NotebookPen} message="Close a trade to start a linked note." />
          )}
        </FeatureCard>
      </div>
    </PageScaffold>
  );
}

function ReportsPage({
  aggregate,
  closedTrades,
  days,
  sessionById,
  strategies,
}: SharedPageProps) {
  const [tab, setTab] = useState<
    "calendar" | "daytime" | "overview" | "performance" | "recaps" | "risk" | "tags" | "winsLosses"
  >("performance");
  const tagRows = useMemo(() => groupByTag(closedTrades), [closedTrades]);
  const rRows = useMemo(() => groupByRMultiple(closedTrades), [closedTrades]);
  const hourRows = useMemo(() => groupByHour(closedTrades), [closedTrades]);

  return (
    <PageScaffold
      eyebrow="Backtest Reports"
      title="Backtest Performance Reports"
      description="Performance, overview, day/time, risk, tags, calendar, and recaps from replay/backtest trades only."
      actions={
        <button className="control-button" type="button">
          <Filter size={15} />
          Filters
        </button>
      }
    >
      <div className="flex gap-2 overflow-x-auto rounded-md border border-white/10 bg-black/20 p-1">
        {[
          ["performance", "Performance"],
          ["overview", "Overview"],
          ["daytime", "Day & Time"],
          ["risk", "Risk"],
          ["tags", "Tags"],
          ["winsLosses", "Wins vs Losses"],
          ["calendar", "Calendar"],
          ["recaps", "Recaps & Insights"],
        ].map(([id, label]) => (
          <TinyTab active={tab === id} key={id} onClick={() => setTab(id as typeof tab)}>
            {label}
          </TinyTab>
        ))}
      </div>

      {tab === "performance" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <FeatureCard>
            <CardLabel icon={LineChart} label="Net P&L" />
            <AreaSparkline values={cumulativeValues(closedTrades)} height={260} />
          </FeatureCard>
          <FeatureCard>
            <CardLabel icon={BarChart3} label="Avg daily win/loss" />
            <BarBreakdown rows={days.map((day) => ({ label: day.date.slice(5), value: day.aggregate.netPnl }))} />
          </FeatureCard>
          <FeatureCard className="xl:col-span-2">
            <StatsGrid aggregate={aggregate} />
          </FeatureCard>
        </div>
      )}

      {tab === "overview" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.45fr)_minmax(0,0.55fr)]">
          <FeatureCard>
            <CardLabel icon={Gauge} label="Your stats" />
            <div className="mt-4 grid gap-2">
              <CompactMetric label="Best month" value={formatMoney(bestMonth(closedTrades).pnl)} tone="text-emerald-300" />
              <CompactMetric label="Lowest month" value={formatMoney(worstMonth(closedTrades).pnl)} tone="text-rose-300" />
            </div>
          </FeatureCard>
          <FeatureCard>
            <StatsGrid aggregate={aggregate} />
          </FeatureCard>
        </div>
      )}

      {tab === "daytime" && (
        <ReportBreakdown
          leftTitle="Net P&L by hour"
          rightTitle="Win % by hour"
          rows={hourRows}
        />
      )}

      {tab === "risk" && (
        <div className="grid gap-4">
          <ReportBreakdown
            leftTitle="Net P&L by R multiple"
            rightTitle="Win % by R bucket"
            rows={rRows}
          />
          <FeatureCard>
            <CardLabel icon={Grid2X2} label="R-multiple cross analysis" />
            <CrossAnalysis rows={rRows} sessionById={sessionById} trades={closedTrades} />
          </FeatureCard>
        </div>
      )}

      {tab === "tags" && (
        <ReportBreakdown
          leftTitle="Net P&L by tag"
          rightTitle="Win % by tag"
          rows={tagRows}
        />
      )}

      {tab === "winsLosses" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <FeatureCard>
            <CardLabel icon={TrendingUp} label={`Wins (${aggregate.wins} trades matched)`} />
            <StatsGrid aggregate={aggregateTrades(closedTrades.filter((trade) => trade.realized_pnl > 0))} />
          </FeatureCard>
          <FeatureCard>
            <CardLabel icon={TrendingDown} label={`Losses (${aggregate.losses} trades matched)`} />
            <StatsGrid aggregate={aggregateTrades(closedTrades.filter((trade) => trade.realized_pnl < 0))} />
          </FeatureCard>
        </div>
      )}

      {tab === "calendar" && (
        <FeatureCard>
          <CalendarHeatmap days={days} />
        </FeatureCard>
      )}

      {tab === "recaps" && (
        <div className="grid gap-3">
          <InsightCard
            title="Monthly recap"
            body={closedTrades.length > 0 ? `Net ${formatMoney(aggregate.netPnl)} across ${closedTrades.length} closed backtest trades. Best trade ${formatMoney(aggregate.largestWin ?? 0)}, worst trade ${formatMoney(aggregate.largestLoss ?? 0)}.` : "Backtest reports will appear here after your first closed replay trade."}
          />
          <InsightCard
            title="Strategy pattern"
            body={strategies[0] ? `${strategies[0].name} is currently the most visible strategy with ${strategies[0].aggregate.totalTrades} closed trades.` : "Strategy recaps unlock once trades are linked to strategies."}
          />
        </div>
      )}
    </PageScaffold>
  );
}

function StrategiesPage({
  onNavigateSessions,
  playbooks,
  strategies,
}: SharedPageProps) {
  const [selectedName, setSelectedName] = useState<string | null>(strategies[0]?.name ?? null);
  const selected = strategies.find((strategy) => strategy.name === selectedName) ?? strategies[0] ?? null;

  return (
    <PageScaffold
      eyebrow="Backtest Strategies"
      title="Strategy Playbooks"
      description="Strategy-level metrics from linked backtest sessions only, with playbook rules kept separate from live Journal performance."
      actions={
        <button className="control-button workspace-tab-active" onClick={onNavigateSessions} type="button">
          <Plus size={15} />
          Create strategy session
        </button>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-white/10 bg-black/20 p-2">
        <div className="flex gap-2">
          <TinyTab active>My Strategies ({strategies.length}/{strategies.length})</TinyTab>
          <TinyTab>Shared with me</TinyTab>
          <TinyTab>Templates</TinyTab>
        </div>
        <div className="flex gap-2">
          <button className="icon-button h-9 w-9" title="Grid view" type="button"><Grid2X2 size={15} /></button>
          <button className="icon-button h-9 w-9" title="List view" type="button"><List size={15} /></button>
          <button className="icon-button h-9 w-9" title="Columns" type="button"><Settings size={15} /></button>
        </div>
      </div>
      <FeatureCard>
        <div className="overflow-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <th className="px-3 py-3 font-medium">Title</th>
                <th className="px-3 py-3 font-medium">Sessions</th>
                <th className="px-3 py-3 font-medium">Missed trades</th>
                <th className="px-3 py-3 font-medium">Average loser</th>
                <th className="px-3 py-3 font-medium">Average winner</th>
                <th className="px-3 py-3 font-medium">Total net P&L</th>
                <th className="px-3 py-3 font-medium">Win rate</th>
              </tr>
            </thead>
            <tbody>
              {strategies.map((strategy) => (
                <tr
                  className={`cursor-pointer border-t border-white/10 text-slate-300 hover:bg-white/5 ${
                    selected?.name === strategy.name ? "bg-cyan-300/10" : ""
                  }`}
                  key={strategy.name}
                  onClick={() => setSelectedName(strategy.name)}
                >
                  <td className="px-3 py-4 font-semibold text-white">{strategy.name}</td>
                  <td className="px-3 py-4">{strategy.sessions.length}</td>
                  <td className="px-3 py-4">0</td>
                  <td className="px-3 py-4 text-rose-300">{formatMoney(strategy.aggregate.averageLoss)}</td>
                  <td className="px-3 py-4 text-emerald-300">{formatMoney(strategy.aggregate.averageWin)}</td>
                  <td className={`px-3 py-4 font-semibold ${toneForNumber(strategy.aggregate.netPnl)}`}>{formatMoney(strategy.aggregate.netPnl)}</td>
                  <td className="px-3 py-4">{formatPercent(strategy.aggregate.winRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {strategies.length === 0 && <EmptyState icon={Target} message="Create a session under a strategy to populate this list." />}
        </div>
      </FeatureCard>
      <FeatureCard>
        {selected ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.55fr)_minmax(0,0.45fr)]">
            <div>
              <CardLabel icon={BookOpen} label="Strategy detail" />
              <h3 className="mt-3 text-xl font-semibold text-white">{selected.name}</h3>
              <p className="mt-2 text-sm text-slate-500">
                Attach a playbook to new sessions, then use this page to compare strategy performance.
              </p>
              <div className="mt-4 grid gap-2 md:grid-cols-3">
                <CompactMetric label="Net P&L" value={formatMoney(selected.aggregate.netPnl)} tone={toneForNumber(selected.aggregate.netPnl)} />
                <CompactMetric label="Win rate" value={formatPercent(selected.aggregate.winRate)} />
                <CompactMetric label="Profit factor" value={formatRatio(selected.aggregate.profitFactor)} />
              </div>
            </div>
            <div className="rounded-md border border-white/10 bg-black/20 p-3">
              <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Linked playbooks</div>
              <div className="mt-3 grid gap-2">
                {playbooks.map((playbook) => (
                  <div className="rounded-md bg-white/5 px-3 py-2" key={playbook.id}>
                    <div className="font-semibold text-white">{playbook.name}</div>
                    <div className="text-xs text-slate-500">{playbook.description ?? "No description"}</div>
                  </div>
                ))}
                {playbooks.length === 0 && <div className="text-sm text-slate-500">No playbooks yet.</div>}
              </div>
            </div>
          </div>
        ) : (
          <EmptyState icon={Target} message="No strategy selected." />
        )}
      </FeatureCard>
    </PageScaffold>
  );
}

function SettingsPage({ datasets }: SharedPageProps) {
  const sections = [
    "Profile",
    "Security",
    "Subscription",
    "Accounts",
    "PT / SL settings",
    "Commissions & fees",
    "Trade settings",
    "Global settings",
    "Tags management",
    "Import history",
    "Log history",
  ];
  const [active, setActive] = useState("Global settings");

  return (
    <PageScaffold
      eyebrow="Settings"
      title="Workspace Settings"
      description="Self-hosted settings for chart defaults, risk, commissions, tags, and import history."
    >
      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <FeatureCard className="p-2">
          {sections.map((section) => (
            <button
              className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm font-semibold transition ${
                active === section ? "bg-cyan-300/10 text-cyan-100" : "text-slate-400 hover:bg-white/5 hover:text-white"
              }`}
              key={section}
              onClick={() => setActive(section)}
              type="button"
            >
              {section}
              <ArrowRight size={13} />
            </button>
          ))}
        </FeatureCard>
        <FeatureCard>
          <div className="flex items-center justify-between gap-3">
            <CardLabel icon={SlidersHorizontal} label={active} />
            <span className="status-pill">Self-Hosted - Unlimited</span>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="form-field">
              Default risk %
              <input className="input-control h-10 normal-case tracking-normal" defaultValue="1" type="number" />
            </label>
            <label className="form-field">
              Default currency
              <select className="input-control h-10 normal-case tracking-normal" defaultValue="USD">
                <option>USD</option>
                <option>INR</option>
              </select>
            </label>
            <label className="form-field">
              Commission mode
              <select className="input-control h-10 normal-case tracking-normal" defaultValue="Flat">
                <option>Flat</option>
                <option>Percent of position</option>
              </select>
            </label>
            <label className="form-field">
              Auto-save interval
              <select className="input-control h-10 normal-case tracking-normal" defaultValue="Every 5 candles">
                <option>Every candle</option>
                <option>Every 5 candles</option>
                <option>Manual only</option>
              </select>
            </label>
          </div>
          <div className="mt-5 rounded-md border border-white/10 bg-black/20 p-3">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Import history</div>
            <div className="mt-3 grid gap-2">
              {(datasets?.instruments ?? []).flatMap((instrument) =>
                instrument.timeframes.map((timeframe) => (
                  <div className="flex items-center justify-between gap-3 rounded-md bg-white/5 px-3 py-2 text-sm" key={timeframe.csv_path}>
                    <span className="min-w-0 truncate text-slate-300">
                      {instrument.name} - {timeframe.timeframe}
                    </span>
                    <span className="shrink-0 text-xs text-slate-500">
                      {timeframe.rows.toLocaleString()} candles
                    </span>
                  </div>
                )),
              )}
            </div>
          </div>
        </FeatureCard>
      </div>
    </PageScaffold>
  );
}

function DashboardFilters({ onClose }: { onClose: () => void }) {
  const groups = [
    ["General", "Side", "Symbol", "Status", "Trade rating", "Exit price", "Entry price", "R-Multiple", "Position size", "Volume"],
    ["Tags", "Mistake tags", "Custom tags", "Emotional state"],
    ["Day & Time", "Day of week", "Entry time", "Exit time", "Hold duration"],
    ["Strategy", "Strategy tag", "Playbook", "Session"],
    ["AI Insights", "Not a strong trade", "Profit exceeded drawdown", "Red to Green Trade", "Scale In", "Scale Out"],
  ];

  return (
    <div className="absolute right-0 top-full z-50 mt-2 w-[min(760px,calc(100vw-32px))] rounded-md border border-white/10 bg-[#080c11] p-4 shadow-panel">
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map(([title, ...items]) => (
          <div className="rounded-md border border-white/10 bg-black/20 p-3" key={title}>
            <div className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-cyan-200">
              {title}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {items.map((item) => (
                <button className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300 hover:bg-white/10" key={item} type="button">
                  {item}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="control-button" type="button">Reset all</button>
        <button className="control-button" onClick={onClose} type="button">Cancel</button>
        <button className="control-button workspace-tab-active" onClick={onClose} type="button">Apply filters</button>
      </div>
    </div>
  );
}

function PageScaffold({
  actions,
  children,
  description,
  eyebrow,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4">
      <section className="command-header">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">
              <NetworkMark />
              {eyebrow}
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-white">{title}</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p>
          </div>
          {actions}
        </div>
      </section>
      {children}
    </div>
  );
}

function FeatureCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`terminal-panel min-w-0 p-4 ${className}`}>
      {children}
    </section>
  );
}

function CardLabel({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
      <Icon size={15} />
      {label}
    </div>
  );
}

function CompactMetric({
  label,
  tone = "text-slate-100",
  value,
}: {
  label: string;
  tone?: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-white/10 bg-black/20 px-3 py-2">
      <div className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600">
        {label}
      </div>
      <div className={`mt-1 truncate text-sm font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function TinyTab({
  active = false,
  children,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      className={`h-8 shrink-0 rounded px-3 text-xs font-semibold transition ${
        active ? "bg-white text-ink-950" : "text-slate-400 hover:bg-white/10 hover:text-white"
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function EmptyState({ icon: Icon, message }: { icon: LucideIcon; message: string }) {
  return (
    <div className="grid min-h-36 place-items-center rounded-md border border-dashed border-white/10 bg-black/20 px-4 py-8 text-center">
      <div>
        <div className="mx-auto grid h-11 w-11 place-items-center rounded-md border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
          <Icon size={18} />
        </div>
        <p className="mt-3 text-sm text-slate-500">{message}</p>
      </div>
    </div>
  );
}

function ModalFrame({
  children,
  onClose,
  title,
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-md border border-white/10 bg-[#080c11] p-4 shadow-panel">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button className="icon-button h-8 w-8" onClick={onClose} type="button">
            <X size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function NotebookFolder({ active = false, label }: { active?: boolean; label: string }) {
  return (
    <button
      className={`rounded-md px-3 py-2 text-left text-sm font-semibold ${
        active ? "bg-cyan-300/10 text-cyan-100" : "text-slate-400 hover:bg-white/5 hover:text-white"
      }`}
      type="button"
    >
      {label}
    </button>
  );
}

function RichTextEditorStub() {
  return (
    <div className="mt-4 rounded-md border border-white/10 bg-black/20">
      <div className="flex flex-wrap items-center gap-1 border-b border-white/10 p-2">
        {["Templates", "Add tag", "Write with AI", "B", "I", "U", "S", "Link", "Color", "Align", "+"].map((item) => (
          <button className="h-8 rounded px-2 text-xs font-semibold text-slate-400 hover:bg-white/10 hover:text-white" key={item} type="button">
            {item}
          </button>
        ))}
      </div>
      <div
        className="min-h-52 px-4 py-3 text-sm text-slate-300 outline-none"
        contentEditable
        suppressContentEditableWarning
      >
        Write something, or press "/" for commands
      </div>
    </div>
  );
}

function StatsGrid({ aggregate }: { aggregate: Aggregate }) {
  const rows = [
    ["Total P&L", formatMoney(aggregate.netPnl), toneForNumber(aggregate.netPnl)],
    ["Open trades", "0", "text-slate-100"],
    ["Average winning trade", formatMoney(aggregate.averageWin), "text-emerald-300"],
    ["Average losing trade", formatMoney(aggregate.averageLoss), "text-rose-300"],
    ["Total number of trades", String(aggregate.totalTrades), "text-slate-100"],
    ["Number of winning trades", String(aggregate.wins), "text-emerald-300"],
    ["Number of losing trades", String(aggregate.losses), "text-rose-300"],
    ["Number of break even trades", String(aggregate.breakeven), "text-slate-100"],
    ["Max drawdown", formatMoney(aggregate.maxDrawdown), "text-rose-300"],
    ["Profit factor", formatRatio(aggregate.profitFactor), "text-amber-100"],
    ["Average R", formatOptionalNumber(aggregate.averageR), toneForNumber(aggregate.averageR)],
    ["Average hold", formatMinutes(aggregate.averageHoldMinutes), "text-slate-100"],
    ["Total commissions", formatMoney(aggregate.totalCommissions), "text-slate-100"],
    ["Largest win", formatMoney(aggregate.largestWin ?? 0), "text-emerald-300"],
    ["Largest loss", formatMoney(aggregate.largestLoss ?? 0), "text-rose-300"],
    ["Recovery factor", formatRatio(aggregate.recoveryFactor), "text-slate-100"],
  ];

  return (
    <div className="grid gap-2 md:grid-cols-2">
      {rows.map(([label, value, tone]) => (
        <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm" key={label}>
          <span className="text-slate-500">{label}</span>
          <span className={`font-semibold tabular-nums ${tone}`}>{value}</span>
        </div>
      ))}
    </div>
  );
}

function ReportBreakdown({
  leftTitle,
  rightTitle,
  rows,
}: {
  leftTitle: string;
  rightTitle: string;
  rows: Array<{ aggregate: Aggregate; label: string }>;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-4">
        <InsightMetric title="Best performing" row={bestRow(rows)} />
        <InsightMetric title="Least performing" row={worstRow(rows)} />
        <InsightMetric title="Most active" row={mostActiveRow(rows)} />
        <InsightMetric title="Best win rate" row={bestWinRateRow(rows)} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <FeatureCard>
          <CardLabel icon={LineChart} label={leftTitle} />
          <BarBreakdown rows={rows.map((row) => ({ label: row.label, value: row.aggregate.netPnl }))} />
        </FeatureCard>
        <FeatureCard>
          <CardLabel icon={PieChart} label={rightTitle} />
          <BarBreakdown rows={rows.map((row) => ({ label: row.label, value: row.aggregate.winRate * 100 }))} percent />
        </FeatureCard>
      </div>
    </div>
  );
}

function InsightMetric({
  row,
  title,
}: {
  row: { aggregate: Aggregate; label: string } | null;
  title: string;
}) {
  return (
    <FeatureCard>
      <div className="text-xs uppercase tracking-[0.16em] text-slate-500">{title}</div>
      <div className="mt-2 truncate text-lg font-semibold text-white">{row?.label ?? "-"}</div>
      <div className={`mt-1 text-sm font-semibold ${toneForNumber(row?.aggregate.netPnl)}`}>
        {formatMoney(row?.aggregate.netPnl ?? 0)}
      </div>
      <div className="mt-1 text-xs text-slate-500">{row?.aggregate.totalTrades ?? 0} trades</div>
    </FeatureCard>
  );
}

function InsightCard({ body, title }: { body: string; title: string }) {
  return (
    <FeatureCard>
      <CardLabel icon={FileText} label={title} />
      <p className="mt-3 text-sm leading-6 text-slate-400">{body}</p>
    </FeatureCard>
  );
}

function CalendarHeatmap({ compact = false, days }: { compact?: boolean; days: DayGroup[] }) {
  const cells = buildMonthCells(days);
  return (
    <div className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <button className="control-button h-8" type="button">{"<"}</button>
        <div className="text-sm font-semibold text-white">{calendarTitle(cells)}</div>
        <button className="control-button h-8" type="button">{">"}</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-[0.12em] text-slate-600">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
          <div key={day}>{compact ? day.slice(0, 1) : day}</div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1">
        {cells.map((cell) => (
          <div
            className={`min-h-14 rounded-md border px-2 py-1 text-xs ${
              cell.day == null
                ? "border-transparent bg-transparent"
                : cell.pnl > 0
                  ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
                  : cell.pnl < 0
                    ? "border-rose-300/20 bg-rose-300/10 text-rose-100"
                    : "border-white/10 bg-black/20 text-slate-500"
            } ${compact ? "min-h-9 px-1" : ""}`}
            key={cell.key}
            title={cell.date}
          >
            <div>{cell.day ?? ""}</div>
            {!compact && cell.day != null && cell.trades > 0 && (
              <div className="mt-1 truncate font-semibold">{formatMoney(cell.pnl)}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AreaSparkline({
  height = 180,
  tone = "cyan",
  values,
}: {
  height?: number;
  tone?: "cyan" | "rose";
  values: number[];
}) {
  const path = toPath(values, 900, height);
  const zeroY = zeroLineY(values, height);
  const stroke = tone === "rose" ? "#fb7185" : "#32d3ee";
  const fill = tone === "rose" ? "rgba(251, 113, 133, 0.12)" : "rgba(50, 211, 238, 0.12)";

  return (
    <div className="overflow-hidden rounded-md bg-black/20" style={{ height }}>
      {values.length > 1 ? (
        <svg className="h-full w-full" preserveAspectRatio="none" viewBox={`0 0 900 ${height}`}>
          <path d={`M 0 ${zeroY} L 900 ${zeroY}`} stroke="rgba(148, 163, 184, 0.18)" strokeWidth="1" />
          <path d={`${path} L 900 ${height} L 0 ${height} Z`} fill={fill} />
          <path d={path} fill="none" stroke={stroke} strokeWidth="2.5" />
        </svg>
      ) : (
        <div className="grid h-full place-items-center text-sm text-slate-500">No chart data</div>
      )}
    </div>
  );
}

function BarBreakdown({
  percent = false,
  rows,
}: {
  percent?: boolean;
  rows: Array<{ label: string; value: number }>;
}) {
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.value)));
  return (
    <div className="mt-4 grid gap-2">
      {rows.slice(0, 14).map((row) => (
        <div className="grid grid-cols-[110px_minmax(0,1fr)_86px] items-center gap-3 text-xs" key={row.label}>
          <span className="truncate text-slate-500">{row.label}</span>
          <div className="h-7 overflow-hidden rounded bg-black/30">
            <div
              className={`h-full ${row.value >= 0 ? "bg-emerald-300/35" : "bg-rose-300/35"}`}
              style={{ width: `${Math.max(2, (Math.abs(row.value) / max) * 100)}%` }}
            />
          </div>
          <span className={`text-right font-semibold tabular-nums ${toneForNumber(row.value)}`}>
            {percent ? `${row.value.toFixed(1)}%` : formatMoney(row.value)}
          </span>
        </div>
      ))}
      {rows.length === 0 && <EmptyState icon={BarChart3} message="No breakdown data yet." />}
    </div>
  );
}

function CrossAnalysis({
  rows,
  sessionById,
  trades,
}: {
  rows: Array<{ aggregate: Aggregate; label: string }>;
  sessionById: Map<number, BacktestSession>;
  trades: Trade[];
}) {
  const symbols = Array.from(
    new Set(trades.map((trade) => tradeSymbol(trade, sessionById))),
  ).slice(0, 5);
  return (
    <div className="mt-4 overflow-auto">
      <table className="w-full min-w-[620px] text-left text-sm">
        <thead className="text-xs uppercase tracking-[0.16em] text-slate-500">
          <tr>
            <th className="px-3 py-2">R bucket</th>
            {symbols.map((symbol) => <th className="px-3 py-2" key={symbol}>{symbol}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="border-t border-white/10" key={row.label}>
              <td className="px-3 py-2 text-slate-300">{row.label}</td>
              {symbols.map((symbol) => {
                const pnl = trades
                  .filter((trade) => rBucketLabel(trade.r_multiple) === row.label && tradeSymbol(trade, sessionById) === symbol)
                  .reduce((sum, trade) => sum + trade.realized_pnl, 0);
                return (
                  <td className={`px-3 py-2 font-semibold ${toneForNumber(pnl)}`} key={symbol}>
                    {formatMoney(pnl)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NetworkMark() {
  return <span className="grid h-5 w-5 place-items-center rounded bg-cyan-300/15 text-[10px] text-cyan-100">TZ</span>;
}

function aggregateTrades(trades: Trade[]): Aggregate {
  const closed = trades.filter((trade) => trade.status === "CLOSED").slice().sort(compareTradesAscending);
  const netPnl = closed.reduce((sum, trade) => sum + (trade.realized_pnl ?? 0), 0);
  const wins = closed.filter((trade) => (trade.realized_pnl ?? 0) > 0);
  const losses = closed.filter((trade) => (trade.realized_pnl ?? 0) < 0);
  const breakeven = closed.filter((trade) => (trade.realized_pnl ?? 0) === 0);
  const grossWins = wins.reduce((sum, trade) => sum + (trade.realized_pnl ?? 0), 0);
  const grossLosses = Math.abs(losses.reduce((sum, trade) => sum + (trade.realized_pnl ?? 0), 0));
  const rValues = closed
    .map((trade) => trade.r_multiple)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const holdValues = closed
    .map(holdMinutes)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const maxDrawdown = computeMaxDrawdown(closed);

  return {
    averageHoldMinutes: average(holdValues),
    averageLoss: losses.length > 0 ? losses.reduce((sum, trade) => sum + (trade.realized_pnl ?? 0), 0) / losses.length : 0,
    averageR: average(rValues),
    averageWin: wins.length > 0 ? grossWins / wins.length : 0,
    breakeven: breakeven.length,
    closed,
    grossLosses,
    grossWins,
    largestLoss: closed.length > 0 ? Math.min(...closed.map((trade) => trade.realized_pnl ?? 0)) : null,
    largestWin: closed.length > 0 ? Math.max(...closed.map((trade) => trade.realized_pnl ?? 0)) : null,
    losses: losses.length,
    maxDrawdown,
    netPnl,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : null,
    recoveryFactor: maxDrawdown < 0 ? netPnl / Math.abs(maxDrawdown) : null,
    totalCommissions: 0,
    totalTrades: closed.length,
    winRate: closed.length > 0 ? wins.length / closed.length : 0,
    wins: wins.length,
  };
}

function groupTradesByDay(trades: Trade[]): DayGroup[] {
  const groups = new Map<string, Trade[]>();
  for (const trade of trades) {
    const date = (trade.exit_time ?? trade.entry_time).slice(0, 10);
    groups.set(date, [...(groups.get(date) ?? []), trade]);
  }
  return Array.from(groups.entries())
    .map(([date, dayTrades]) => ({
      aggregate: aggregateTrades(dayTrades),
      date,
      label: new Date(`${date}T00:00:00`).toLocaleDateString([], {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
      trades: dayTrades,
    }))
    .sort((left, right) => right.date.localeCompare(left.date));
}

function groupByStrategy(
  sessions: BacktestSession[],
  trades: Trade[],
  sessionById: Map<number, BacktestSession>,
): StrategyGroup[] {
  const grouped = new Map<string, { sessions: Map<number, BacktestSession>; trades: Trade[] }>();
  for (const session of sessions) {
    const name = sessionStrategyName(session);
    grouped.set(name, grouped.get(name) ?? { sessions: new Map(), trades: [] });
    grouped.get(name)?.sessions.set(session.id, session);
  }
  for (const trade of trades) {
    const session = sessionById.get(trade.session_id);
    const name = tradeStrategyName(trade, session);
    grouped.set(name, grouped.get(name) ?? { sessions: new Map(), trades: [] });
    if (session) {
      grouped.get(name)?.sessions.set(session.id, session);
    }
    grouped.get(name)?.trades.push(trade);
  }
  return Array.from(grouped.entries())
    .map(([name, group]) => ({
      aggregate: aggregateTrades(group.trades),
      name,
      sessions: Array.from(group.sessions.values()).sort((a, b) => b.id - a.id),
      trades: group.trades,
    }))
    .sort((a, b) => b.aggregate.netPnl - a.aggregate.netPnl);
}

function groupByHour(trades: Trade[]) {
  const rows = Array.from({ length: 24 }, (_, hour) => ({
    label: `${String(hour).padStart(2, "0")}:00`,
    trades: [] as Trade[],
  }));
  for (const trade of trades) {
    const hour = new Date(trade.entry_time).getHours();
    rows[hour]?.trades.push(trade);
  }
  return rows
    .filter((row) => row.trades.length > 0)
    .map((row) => ({ aggregate: aggregateTrades(row.trades), label: row.label }));
}

function groupByTag(trades: Trade[]) {
  const grouped = new Map<string, Trade[]>();
  for (const trade of trades) {
    const tags = trade.mistake_tags.length > 0 ? trade.mistake_tags : ["Untagged"];
    for (const tag of tags) {
      grouped.set(tag, [...(grouped.get(tag) ?? []), trade]);
    }
  }
  return Array.from(grouped.entries())
    .map(([label, tagTrades]) => ({ aggregate: aggregateTrades(tagTrades), label }))
    .sort((a, b) => b.aggregate.netPnl - a.aggregate.netPnl);
}

function groupByRMultiple(trades: Trade[]) {
  const grouped = new Map<string, Trade[]>();
  for (const trade of trades) {
    const label = rBucketLabel(trade.r_multiple);
    grouped.set(label, [...(grouped.get(label) ?? []), trade]);
  }
  return Array.from(grouped.entries())
    .map(([label, bucketTrades]) => ({ aggregate: aggregateTrades(bucketTrades), label }))
    .sort((a, b) => bucketSortValue(a.label) - bucketSortValue(b.label));
}

function rBucketLabel(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return "No R";
  }
  if (value < -1) {
    return "-1R to -1.99R";
  }
  if (value < 0) {
    return "0R to -0.99R";
  }
  const lower = Math.floor(value);
  return `+${lower}R to ${lower + 0.99}R`;
}

function bucketSortValue(label: string) {
  if (label === "No R") {
    return 999;
  }
  const match = label.match(/-?\d+/);
  return match ? Number(match[0]) : 0;
}

function buildMonthCells(days: DayGroup[]) {
  const latest = days[0]?.date ? new Date(`${days[0].date}T00:00:00`) : new Date();
  const year = latest.getFullYear();
  const month = latest.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const offset = (first.getDay() + 6) % 7;
  const byDate = new Map(days.map((day) => [day.date, day]));
  const cells: Array<{ date: string; day: number | null; key: string; pnl: number; trades: number }> = [];

  for (let index = 0; index < offset; index += 1) {
    cells.push({ date: "", day: null, key: `blank-${index}`, pnl: 0, trades: 0 });
  }
  for (let day = 1; day <= last.getDate(); day += 1) {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const group = byDate.get(date);
    cells.push({
      date,
      day,
      key: date,
      pnl: group?.aggregate.netPnl ?? 0,
      trades: group?.aggregate.totalTrades ?? 0,
    });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ date: "", day: null, key: `tail-${cells.length}`, pnl: 0, trades: 0 });
  }
  return cells;
}

function calendarTitle(cells: Array<{ date: string }>) {
  const active = cells.find((cell) => cell.date)?.date;
  if (!active) {
    return new Date().toLocaleDateString([], { month: "long", year: "numeric" });
  }
  return new Date(`${active}T00:00:00`).toLocaleDateString([], { month: "long", year: "numeric" });
}

function cumulativeValues(trades: Trade[]) {
  const values = [0];
  let cumulative = 0;
  for (const trade of trades.slice().sort(compareTradesAscending)) {
    cumulative += trade.realized_pnl ?? 0;
    values.push(cumulative);
  }
  return values;
}

function drawdownValues(trades: Trade[]) {
  const values = [0];
  let cumulative = 0;
  let peak = 0;
  for (const trade of trades.slice().sort(compareTradesAscending)) {
    cumulative += trade.realized_pnl ?? 0;
    peak = Math.max(peak, cumulative);
    values.push(cumulative - peak);
  }
  return values;
}

function computeMaxDrawdown(trades: Trade[]) {
  return Math.min(...drawdownValues(trades), 0);
}

function toPath(values: number[], width: number, height: number) {
  if (values.length < 2) {
    return "";
  }
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  return values
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / range) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function zeroLineY(values: number[], height: number) {
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const range = max - min || 1;
  return height - ((0 - min) / range) * height;
}

function bestRow(rows: Array<{ aggregate: Aggregate; label: string }>) {
  return rows.slice().sort((a, b) => b.aggregate.netPnl - a.aggregate.netPnl)[0] ?? null;
}

function worstRow(rows: Array<{ aggregate: Aggregate; label: string }>) {
  return rows.slice().sort((a, b) => a.aggregate.netPnl - b.aggregate.netPnl)[0] ?? null;
}

function mostActiveRow(rows: Array<{ aggregate: Aggregate; label: string }>) {
  return rows.slice().sort((a, b) => b.aggregate.totalTrades - a.aggregate.totalTrades)[0] ?? null;
}

function bestWinRateRow(rows: Array<{ aggregate: Aggregate; label: string }>) {
  return rows.slice().sort((a, b) => b.aggregate.winRate - a.aggregate.winRate)[0] ?? null;
}

function bestMonth(trades: Trade[]) {
  return monthExtrema(trades, "best");
}

function worstMonth(trades: Trade[]) {
  return monthExtrema(trades, "worst");
}

function monthExtrema(trades: Trade[], mode: "best" | "worst") {
  const grouped = new Map<string, number>();
  for (const trade of trades) {
    const key = (trade.exit_time ?? trade.entry_time).slice(0, 7);
    grouped.set(key, (grouped.get(key) ?? 0) + (trade.realized_pnl ?? 0));
  }
  const rows = Array.from(grouped.entries()).map(([month, pnl]) => ({ month, pnl }));
  return rows.sort((a, b) => mode === "best" ? b.pnl - a.pnl : a.pnl - b.pnl)[0] ?? { month: "-", pnl: 0 };
}

function tradeSymbol(trade: Trade, sessionById: Map<number, BacktestSession>) {
  return formatTradingViewSymbol(sessionById.get(trade.session_id)?.symbol ?? "SYMBOL");
}

function compareTradesAscending(a: Trade, b: Trade) {
  return new Date(a.exit_time ?? a.entry_time).getTime() - new Date(b.exit_time ?? b.entry_time).getTime();
}

function holdMinutes(trade: Trade) {
  if (!trade.exit_time) {
    return null;
  }
  const entry = new Date(trade.entry_time).getTime();
  const exit = new Date(trade.exit_time).getTime();
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || exit < entry) {
    return null;
  }
  return (exit - entry) / 60000;
}

function average(values: number[]) {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function toneForNumber(value: number | null | undefined) {
  if (value == null || value === 0) {
    return "text-slate-100";
  }
  return value > 0 ? "text-emerald-300" : "text-rose-300";
}

function formatRatio(value: number | null | undefined) {
  if (value == null) {
    return "-";
  }
  if (!Number.isFinite(value)) {
    return "∞";
  }
  return value.toFixed(2);
}

function formatOptionalNumber(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "-" : value.toFixed(2);
}

function formatMinutes(value: number | null) {
  if (value == null) {
    return "-";
  }
  if (value < 60) {
    return `${value.toFixed(0)}m`;
  }
  return `${(value / 60).toFixed(1)}h`;
}

function formatCompactNumber(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return "-";
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    notation: "compact",
  }).format(value);
}

function shortDate(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleDateString([], {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}
