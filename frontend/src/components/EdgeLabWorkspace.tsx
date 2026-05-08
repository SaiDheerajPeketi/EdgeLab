import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowRight,
  BadgeDollarSign,
  BarChart3,
  BookOpen,
  Bold,
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
  Globe2,
  Grid2X2,
  Image,
  Info,
  Italic,
  Link2,
  LineChart,
  List,
  ListOrdered,
  MoreHorizontal,
  NotebookPen,
  Palette,
  Pencil,
  PieChart,
  PlaySquare,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Share2,
  SlidersHorizontal,
  Star,
  Strikethrough,
  Target,
  TrendingDown,
  TrendingUp,
  Trash2,
  Underline,
  WalletCards,
  X,
} from "lucide-react";
import type {
  BacktestSession,
  DatasetCatalog,
  DatasetRefreshResponse,
  DatasetRefreshStatus,
  DatasetTimeframe,
  Playbook,
  PlaybookPayload,
  Trade,
} from "../lib/api";
import {
  hydrateOrderLineModificationConfirmation,
  loadOrderLineModificationConfirmation,
  saveOrderLineModificationConfirmation,
  subscribeOrderLineModificationConfirmation,
} from "../lib/backtestSettings";
import { currencyForSession, currencyForSessions } from "../lib/currency";
import { formatDateTime, formatMoney, formatPercent, formatPrice } from "../lib/format";
import {
  DEFAULT_MISTAKE_TAGS,
  hydrateStrategyMistakeTags,
  isDefaultMistakeTag,
  loadStrategyMistakeTags,
  mergeTags,
  parseTagInput,
  persistStrategyMistakeTags,
  removeStrategyMistakeTag,
  strategyTagScope,
  subscribeStrategyMistakeTags,
} from "../lib/mistakeTags";
import {
  escapeHtml,
  isRichTextEmpty,
  normalizeStoredNoteHtml,
  richTextToPlainText,
  sanitizeRichTextHtml,
  textToRichHtml,
} from "../lib/richText";
import {
  getCachedAppStorageItem,
  loadAppStorageItem,
  saveAppStorageItem,
  subscribeAppStorageItem,
} from "../lib/serverStorage";
import { formatMarketSymbol, symbolBadge } from "../lib/symbols";
import { sessionStrategyName, tradeStrategyName } from "../lib/strategy";
import {
  copyTradeSnapshotToClipboard,
  createTradeSnapshotDataUrl,
  shouldRegenerateTradeSnapshotForCurrency,
} from "../lib/tradeSnapshot";
import type { WorkspaceView } from "../lib/workspace";
import { useBacktestStore } from "../store/backtestStore";
import { ThemedDatePicker } from "./ThemedDatePicker";
import { ThemedSelect } from "./ThemedSelect";
import { TradeLog } from "./TradeLog";

type WorkspacePageView = Exclude<WorkspaceView, "backtest" | "sessions">;

type Props = {
  activeSession: BacktestSession | null;
  datasets: DatasetCatalog | null;
  onEditTrade: (trade: Trade) => void;
  onInspectTrade: (trade: Trade) => void;
  onOpenTradeNote: (trade: Trade) => void;
  onCreatePlaybook: (payload: PlaybookPayload) => Promise<Playbook>;
  onNavigateBacktest: () => void;
  onNavigateSessions: () => void;
  onReplayTrade: (trade: Trade) => Promise<void> | void;
  onRefreshDatasets: () => Promise<DatasetRefreshResponse>;
  onGetDatasetRefreshStatus: () => Promise<DatasetRefreshStatus>;
  onResumeSession: (sessionId?: number) => Promise<void> | void;
  onUpdateDatasetAsset: (
    assetId: string,
    payload: { currency?: string | null; timezone?: string | null; pnl_multiplier?: number | null },
  ) => Promise<void>;
  onUpdateDatasetSettings: (payload: { root_path: string }) => Promise<void>;
  playbooks: Playbook[];
  sessions: BacktestSession[];
  trades: Trade[];
  view: WorkspacePageView;
  notebookFocusTradeId: number | null;
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

type LiveJournalSession = {
  account: string;
  created_at: string;
  currency: string;
  id: number;
  initial_balance: number;
  instrument: string;
  name: string;
  notes: string;
  playbook_id: number | null;
  status: "ACTIVE" | "ARCHIVED";
  strategy_name: string;
};

type LiveJournalData = {
  playbooks: Playbook[];
  sessions: LiveJournalSession[];
  trades: Trade[];
};

type LiveStrategyGroup = {
  aggregate: Aggregate;
  name: string;
  sessions: LiveJournalSession[];
  trades: Trade[];
};

type LiveJournalController = {
  addPlaybook: (payload: PlaybookPayload) => Playbook;
  addSession: (payload: Omit<LiveJournalSession, "created_at" | "id" | "status">) => void;
  addTrade: (payload: LiveTradeInput) => void;
  data: LiveJournalData;
};

type LiveTradeInput = {
  emotionalState: string | null;
  entryPrice: number;
  entryTime: string;
  exitPrice: number;
  exitTime: string;
  mistakeTags: string[];
  notes: string | null;
  quantity: number;
  screenshotUrl: string | null;
  sessionId: number;
  side: "LONG" | "SHORT";
  stopLoss: number | null;
  strategyName: string | null;
  takeProfit: number | null;
};

type NotebookAlignMode = "center" | "left" | "right";

type NotebookEditorState = {
  align: NotebookAlignMode;
  bold: boolean;
  bulletList: boolean;
  color: string | null;
  italic: boolean;
  link: boolean;
  orderedList: boolean;
  strike: boolean;
  underline: boolean;
};

const LIVE_JOURNAL_STORAGE_KEY = "live-journal.v1";
const BACKTEST_STRATEGIES_STORAGE_KEY = "backtest-strategies.v1";
const NOTEBOOK_FAVORITES_STORAGE_KEY = "notebook-favorites.v1";
const NOTEBOOK_TEMPLATE_STORAGE_KEY = "notebook-template.v1";
const DEFAULT_NOTEBOOK_TEMPLATE = [
  "Setup",
  "- Context:",
  "- Trigger:",
  "",
  "Execution",
  "- Side: {side}",
  "- Quantity: {quantity}",
  "- Entry: {entry}",
  "- Exit: {exit}",
  "- Result: {pnl} ({r}R)",
  "",
  "Review",
  "- What worked:",
  "- What needs correction:",
  "- Next action:",
].join("\n");
const DEFAULT_NOTEBOOK_EDITOR_STATE: NotebookEditorState = {
  align: "left",
  bold: false,
  bulletList: false,
  color: null,
  italic: false,
  link: false,
  orderedList: false,
  strike: false,
  underline: false,
};
const NOTE_COLOR_OPTIONS = [
  { label: "Cyan", value: "#67e8f9" },
  { label: "Green", value: "#86efac" },
  { label: "Rose", value: "#fda4af" },
  { label: "Amber", value: "#fcd34d" },
  { label: "Slate", value: "#cbd5e1" },
  { label: "White", value: "#f8fafc" },
];
const NOTE_ALIGN_OPTIONS: Array<{
  command: "justifyCenter" | "justifyLeft" | "justifyRight";
  icon: LucideIcon;
  label: string;
  value: NotebookAlignMode;
}> = [
  { command: "justifyLeft", icon: AlignLeft, label: "Left", value: "left" },
  { command: "justifyCenter", icon: AlignCenter, label: "Center", value: "center" },
  { command: "justifyRight", icon: AlignRight, label: "Right", value: "right" },
];
const LIVE_EMOTIONS = ["Calm", "Confident", "Focused", "Fearful", "Impulsive", "Frustrated", "Other"] as const;
const CURRENCY_OPTIONS = [
  "USD",
  "EUR",
  "GBP",
  "INR",
  "JPY",
  "AUD",
  "CAD",
  "CHF",
  "NZD",
  "SGD",
  "HKD",
  "AED",
].map((currency) => ({ label: currency, value: currency }));
const TIMEZONE_IDS = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Zurich",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Australia/Sydney",
];
const TIMEZONE_OPTIONS = TIMEZONE_IDS.map(timezoneOption);

export function EdgeLabWorkspace({
  activeSession,
  datasets,
  onEditTrade,
  onInspectTrade,
  onOpenTradeNote,
  onCreatePlaybook,
  onNavigateBacktest,
  onNavigateSessions,
  onReplayTrade,
  onRefreshDatasets,
  onGetDatasetRefreshStatus,
  onResumeSession,
  onUpdateDatasetAsset,
  onUpdateDatasetSettings,
  playbooks,
  sessions,
  trades,
  view,
  notebookFocusTradeId,
}: Props) {
  const liveJournal = useLiveJournalData();
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
  const currency = currencyForSessions(
    activeSession ? [activeSession] : sessions,
    datasets,
  );

  const shared = {
    activeSession,
    aggregate,
    closedTrades,
    currency,
    datasets,
    days,
    onEditTrade,
    onInspectTrade,
    onOpenTradeNote,
    onCreatePlaybook,
    onNavigateBacktest,
    onNavigateSessions,
    onReplayTrade,
    onRefreshDatasets,
    onGetDatasetRefreshStatus,
    onResumeSession,
    onUpdateDatasetAsset,
    onUpdateDatasetSettings,
    openTrades,
    playbooks,
    sessionById,
    sessions,
    strategies,
    trades,
    notebookFocusTradeId,
  };

  switch (view) {
    case "accounts":
      return <AccountsPage {...shared} />;
    case "dashboard":
      return <DashboardPage {...shared} />;
    case "dayView":
      return <DayViewPage {...shared} />;
    case "journal":
    case "journalTrades":
      return <JournalWorkspacePage journal={liveJournal} view="journalTrades" />;
    case "journalAccounts":
    case "journalDashboard":
    case "journalDayView":
    case "journalNotes":
    case "journalPlaybooks":
    case "journalReports":
    case "journalSessions":
    case "journalSettings":
    case "journalStrategies":
      return <JournalWorkspacePage journal={liveJournal} view={view} />;
    case "notebook":
      return <NotebookPage {...shared} />;
    case "playbooks":
      return <BacktestPlaybooksPage {...shared} />;
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
  currency: string;
  datasets: DatasetCatalog | null;
  days: DayGroup[];
  onEditTrade: (trade: Trade) => void;
  onInspectTrade: (trade: Trade) => void;
  onOpenTradeNote: (trade: Trade) => void;
  onCreatePlaybook: (payload: PlaybookPayload) => Promise<Playbook>;
  onNavigateBacktest: () => void;
  onNavigateSessions: () => void;
  onReplayTrade: (trade: Trade) => Promise<void> | void;
  onRefreshDatasets: () => Promise<DatasetRefreshResponse>;
  onGetDatasetRefreshStatus: () => Promise<DatasetRefreshStatus>;
  onResumeSession: (sessionId?: number) => Promise<void> | void;
  onUpdateDatasetAsset: (
    assetId: string,
    payload: { currency?: string | null; timezone?: string | null; pnl_multiplier?: number | null },
  ) => Promise<void>;
  onUpdateDatasetSettings: (payload: { root_path: string }) => Promise<void>;
  openTrades: Trade[];
  playbooks: Playbook[];
  sessionById: Map<number, BacktestSession>;
  sessions: BacktestSession[];
  strategies: StrategyGroup[];
  trades: Trade[];
  notebookFocusTradeId: number | null;
};

function DashboardPage({
  aggregate,
  closedTrades,
  currency,
  datasets,
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
            {formatMoney(latestDay?.aggregate.netPnl ?? 0, currency)}
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
                  {formatMoney(
                    trade.realized_pnl ?? 0,
                    currencyForSession(sessionById.get(trade.session_id), datasets),
                  )}
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
            {formatMoney(accountBalance, currency)}
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
          <CalendarHeatmap currency={currency} days={days} />
          <div className="mt-4 grid gap-2 md:grid-cols-4">
            <CompactMetric label="Month P&L" value={formatMoney(aggregate.netPnl, currency)} tone={toneForNumber(aggregate.netPnl)} />
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
            <CompactMetric label="Max DD" value={formatMoney(aggregate.maxDrawdown, currency)} tone="text-rose-300" />
            <CompactMetric label="Recovery" value={formatRatio(aggregate.recoveryFactor)} />
          </div>
        </FeatureCard>
      </div>
    </PageScaffold>
  );
}

function AccountsPage({ aggregate, currency, datasets, sessions }: SharedPageProps) {
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
                      {formatMoney(account.balance + aggregate.netPnl, currency)}
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
              <ThemedSelect
                className="h-10"
                defaultValue="Manual"
                options={[
                  { label: "Manual", value: "Manual" },
                  { label: "CSV Upload", value: "CSV Upload" },
                ]}
              />
            </label>
            <label className="form-field">
              Starting balance
              <input className="input-control h-10 normal-case tracking-normal" defaultValue="10000" type="number" />
            </label>
            <label className="form-field">
              Currency
              <ThemedSelect
                className="h-10"
                defaultValue="USD"
                options={[
                  { label: "USD", value: "USD" },
                  { label: "INR", value: "INR" },
                ]}
              />
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

function DayViewPage({ currency, datasets, days, onInspectTrade, sessionById }: SharedPageProps) {
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
                    Net P&L {formatMoney(day.aggregate.netPnl, currency)}
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
                  <CompactMetric label="Gross P&L" value={formatMoney(day.aggregate.netPnl, currency)} tone={toneForNumber(day.aggregate.netPnl)} />
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
                      {formatMoney(
                        trade.realized_pnl,
                        currencyForSession(sessionById.get(trade.session_id), datasets),
                      )}
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
            <CalendarHeatmap compact currency={currency} days={days} />
          </div>
        </FeatureCard>
      </div>
    </PageScaffold>
  );
}

function TradeViewPage({
  closedTrades,
  currency,
  datasets,
  onOpenTradeNote,
  sessionById,
  strategies,
}: SharedPageProps) {
  const [sessionFilter, setSessionFilter] = useState("ALL");
  const [instrumentFilter, setInstrumentFilter] = useState("ALL");
  const [sideFilter, setSideFilter] = useState("ALL");
  const [strategyFilter, setStrategyFilter] = useState("ALL");
  const [tagFilter, setTagFilter] = useState("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const savedStrategyNames = useBacktestStrategyNames();
  const sessionOptions = useMemo(
    () => buildTradeSessionOptions(closedTrades, sessionById),
    [closedTrades, sessionById],
  );
  const instrumentOptions = useMemo(
    () => buildTradeInstrumentOptions(closedTrades, sessionById),
    [closedTrades, sessionById],
  );
  const strategyOptions = useMemo(
    () => [
      { label: "All strategies", value: "ALL" },
      ...buildStrategySelectOptions(mergeStrategyGroups(strategies, savedStrategyNames)),
    ],
    [savedStrategyNames, strategies],
  );
  const tagOptions = useMemo(
    () => [
      { label: "All tags", value: "ALL" },
      ...buildTradeNoteTagOptions(closedTrades).map((tag) => ({
        label: tag,
        value: tag,
      })),
    ],
    [closedTrades],
  );
  const filteredTrades = useMemo(
    () =>
      closedTrades.filter((trade) => {
        const session = sessionById.get(trade.session_id);
        const strategyName = tradeStrategyName(trade, session);
        const entryDate = trade.entry_time.slice(0, 10);
        if (sessionFilter !== "ALL" && String(trade.session_id) !== sessionFilter) {
          return false;
        }
        if (instrumentFilter !== "ALL" && tradeInstrumentFilterValue(trade, session) !== instrumentFilter) {
          return false;
        }
        if (sideFilter !== "ALL" && trade.side !== sideFilter) {
          return false;
        }
        if (strategyFilter !== "ALL" && !sameStrategyName(strategyName, strategyFilter)) {
          return false;
        }
        if (tagFilter !== "ALL" && !tradeHasNoteTag(trade, tagFilter)) {
          return false;
        }
        if (dateFrom && entryDate < dateFrom) {
          return false;
        }
        if (dateTo && entryDate > dateTo) {
          return false;
        }
        if (!searchTerm.trim()) {
          return true;
        }
        return tradeMatchesLogSearch(trade, session, searchTerm, strategyName);
      }),
    [closedTrades, dateFrom, dateTo, instrumentFilter, searchTerm, sessionById, sessionFilter, sideFilter, strategyFilter, tagFilter],
  );
  const filteredAggregate = useMemo(() => aggregateTrades(filteredTrades), [filteredTrades]);
  const filtersActive =
    sessionFilter !== "ALL" ||
    instrumentFilter !== "ALL" ||
    sideFilter !== "ALL" ||
    strategyFilter !== "ALL" ||
    tagFilter !== "ALL" ||
    Boolean(dateFrom || dateTo || searchTerm.trim());

  function resetFilters() {
    setSessionFilter("ALL");
    setInstrumentFilter("ALL");
    setSideFilter("ALL");
    setStrategyFilter("ALL");
    setTagFilter("ALL");
    setDateFrom("");
    setDateTo("");
    setSearchTerm("");
  }

  function exportFilteredTradesCsv() {
    exportTradeLogCsv(filteredTrades, sessionById, datasets);
  }

  return (
    <PageScaffold
      eyebrow="Backtest Trade View"
      title="Backtest Trade Log"
      description="Closed replay trades only, with review notes and tagging. Live actual trades belong in the separate Journal scope."
      actions={
        <button className="control-button" disabled={filteredTrades.length === 0} onClick={exportFilteredTradesCsv} type="button">
          <Download size={15} />
          Export CSV
        </button>
      }
    >
      <FeatureCard>
        <div className="mb-4 grid gap-3">
          <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.1fr)_repeat(4,minmax(140px,0.7fr))]">
            <label className="form-field lg:col-span-2 xl:col-span-1">
              Search
              <div className="flex h-10 items-center gap-2 rounded-md border border-white/10 bg-black/20 px-3 text-sm focus-within:border-cyan-300/40 focus-within:ring-2 focus-within:ring-cyan-300/10">
                <Search className="shrink-0 text-slate-500" size={15} />
                <input
                  className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-600"
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Instrument, strategy, note, tag..."
                  value={searchTerm}
                />
              </div>
            </label>
            <label className="form-field">
              Session
              <ThemedSelect className="h-10" onChange={setSessionFilter} options={sessionOptions} portal value={sessionFilter} />
            </label>
            <label className="form-field">
              Instrument
              <ThemedSelect className="h-10" onChange={setInstrumentFilter} options={instrumentOptions} portal value={instrumentFilter} />
            </label>
            <label className="form-field">
              Direction
              <ThemedSelect
                className="h-10"
                onChange={setSideFilter}
                options={[
                  { label: "All directions", value: "ALL" },
                  { label: "Long", value: "LONG" },
                  { label: "Short", value: "SHORT" },
                ]}
                portal
                value={sideFilter}
              />
            </label>
            <label className="form-field">
              Strategy
              <ThemedSelect className="h-10" onChange={setStrategyFilter} options={strategyOptions} portal value={strategyFilter} />
            </label>
          </div>
          <div className="grid gap-2 md:grid-cols-[minmax(160px,0.75fr)_repeat(2,minmax(140px,0.55fr))_auto]">
            <label className="form-field">
              Tags
              <ThemedSelect className="h-10" onChange={setTagFilter} options={tagOptions} portal value={tagFilter} />
            </label>
            <label className="form-field">
              From
              <ThemedDatePicker ariaLabel="Filter trades from date" onChange={setDateFrom} placeholder="From date" value={dateFrom} />
            </label>
            <label className="form-field">
              To
              <ThemedDatePicker ariaLabel="Filter trades to date" onChange={setDateTo} placeholder="To date" value={dateTo} />
            </label>
            <div className="flex items-end">
              <button className="control-button h-10" disabled={!filtersActive} onClick={resetFilters} type="button">
                <RefreshCw size={15} />
                Reset
              </button>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <CompactMetric label="Visible trades" value={`${filteredTrades.length}/${closedTrades.length}`} />
            <CompactMetric label="Net P&L" value={formatMoney(filteredAggregate.netPnl, currency)} tone={toneForNumber(filteredAggregate.netPnl)} />
            <CompactMetric label="Win rate" value={formatPercent(filteredAggregate.winRate)} />
            <CompactMetric label="Avg R" value={formatOptionalNumber(filteredAggregate.averageR)} />
            <CompactMetric label="Profit factor" value={formatRatio(filteredAggregate.profitFactor)} />
          </div>
        </div>
        <TradeLog
          currency={currency}
          tradeContext={(trade) => buildTradeLogContext(trade, sessionById, datasets)}
          trades={filteredTrades}
          onInspect={onOpenTradeNote}
        />
      </FeatureCard>
    </PageScaffold>
  );
}

function JournalWorkspacePage({
  journal,
  view,
}: {
  journal: LiveJournalController;
  view:
    | "journalAccounts"
    | "journalDashboard"
    | "journalDayView"
    | "journalNotes"
    | "journalPlaybooks"
    | "journalReports"
    | "journalSessions"
    | "journalSettings"
    | "journalStrategies"
    | "journalTrades";
}) {
  const sessionById = useMemo(
    () => new Map(journal.data.sessions.map((session) => [session.id, session])),
    [journal.data.sessions],
  );
  const closedTrades = useMemo(
    () =>
      journal.data.trades
        .filter((trade) => trade.status === "CLOSED")
        .slice()
        .sort(compareTradesAscending),
    [journal.data.trades],
  );
  const aggregate = useMemo(() => aggregateTrades(closedTrades), [closedTrades]);
  const days = useMemo(() => groupTradesByDay(closedTrades), [closedTrades]);
  const strategies = useMemo(
    () => groupLiveStrategies(journal.data.sessions, journal.data.trades),
    [journal.data.sessions, journal.data.trades],
  );

  const shared = {
    aggregate,
    closedTrades,
    days,
    journal,
    playbooks: journal.data.playbooks,
    sessionById,
    sessions: journal.data.sessions,
    strategies,
  };

  switch (view) {
    case "journalAccounts":
      return <JournalAccountsPage {...shared} />;
    case "journalDashboard":
      return <JournalDashboardPage {...shared} />;
    case "journalDayView":
      return <JournalDayViewPage {...shared} />;
    case "journalNotes":
      return <JournalNotesPage {...shared} />;
    case "journalPlaybooks":
      return <JournalPlaybooksPage {...shared} />;
    case "journalReports":
      return <JournalReportsPage {...shared} />;
    case "journalSessions":
      return <JournalSessionsPage {...shared} />;
    case "journalSettings":
      return <JournalSettingsPage {...shared} />;
    case "journalStrategies":
      return <JournalStrategiesPage {...shared} />;
    case "journalTrades":
      return <JournalTradesPage {...shared} />;
    default:
      return null;
  }
}

type JournalPageProps = {
  aggregate: Aggregate;
  closedTrades: Trade[];
  days: DayGroup[];
  journal: LiveJournalController;
  playbooks: Playbook[];
  sessionById: Map<number, LiveJournalSession>;
  sessions: LiveJournalSession[];
  strategies: LiveStrategyGroup[];
};

function JournalSessionsPage({
  aggregate,
  journal,
  playbooks,
  sessionById,
  sessions,
}: JournalPageProps) {
  const [name, setName] = useState("Live Trading Session");
  const [strategy, setStrategy] = useState("Discretionary");
  const [instrument, setInstrument] = useState("OANDA:EURUSD");
  const [balance, setBalance] = useState("100000");
  const [playbookId, setPlaybookId] = useState("");
  const playbookById = useMemo(
    () => new Map(playbooks.map((playbook) => [playbook.id, playbook])),
    [playbooks],
  );

  function submitSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    journal.addSession({
      account: "Manual",
      currency: "USD",
      initial_balance: Number(balance) || 0,
      instrument: instrument.trim() || "Manual",
      name: name.trim() || "Live Trading Session",
      notes: "",
      playbook_id: playbookId ? Number(playbookId) : null,
      strategy_name: strategy.trim() || "Unassigned",
    });
  }

  return (
    <PageScaffold
      eyebrow="Journal Sessions"
      title="Live Session Management"
      description="Actual-trade sessions are separate from replay sessions. Their metrics are built only from manually recorded live trades."
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <FeatureCard>
          <div className="mb-4 flex items-center justify-between gap-3">
            <CardLabel icon={PlaySquare} label="Live sessions" />
            <span className="status-pill">{sessions.length} sessions</span>
          </div>
          <div className="overflow-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-3 py-3 font-medium">Session</th>
                  <th className="px-3 py-3 font-medium">Instrument</th>
                  <th className="px-3 py-3 font-medium">Strategy</th>
                  <th className="px-3 py-3 font-medium">Playbook</th>
                  <th className="px-3 py-3 font-medium">Trades</th>
                  <th className="px-3 py-3 font-medium">Net P&L</th>
                  <th className="px-3 py-3 font-medium">Win rate</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => {
                  const rowAggregate = aggregateTrades(journal.data.trades.filter((trade) => trade.session_id === session.id));
                  return (
                    <tr className="border-t border-white/10 text-slate-300" key={session.id}>
                      <td className="px-3 py-4 font-semibold text-white">{session.name}</td>
                      <td className="px-3 py-4">{session.instrument}</td>
                      <td className="px-3 py-4">{session.strategy_name}</td>
                      <td className="px-3 py-4">{session.playbook_id ? playbookById.get(session.playbook_id)?.name ?? "Missing rules" : "Unlinked"}</td>
                      <td className="px-3 py-4">{rowAggregate.totalTrades}</td>
                      <td className={`px-3 py-4 font-semibold ${toneForNumber(rowAggregate.netPnl)}`}>{formatMoney(rowAggregate.netPnl)}</td>
                      <td className="px-3 py-4">{formatPercent(rowAggregate.winRate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </FeatureCard>
        <FeatureCard>
          <CardLabel icon={Plus} label="Create live session" />
          <form className="mt-4 grid gap-3" onSubmit={submitSession}>
            <label className="form-field">
              Session name
              <input className="input-control h-10 normal-case tracking-normal" onChange={(event) => setName(event.target.value)} value={name} />
            </label>
            <label className="form-field">
              Strategy
              <input className="input-control h-10 normal-case tracking-normal" onChange={(event) => setStrategy(event.target.value)} value={strategy} />
            </label>
            <label className="form-field">
              Instrument
              <input className="input-control h-10 normal-case tracking-normal" onChange={(event) => setInstrument(event.target.value)} value={instrument} />
            </label>
            <label className="form-field">
              Playbook rules
              <ThemedSelect
                className="h-10"
                onChange={setPlaybookId}
                options={[
                  { label: "No playbook", value: "" },
                  ...playbooks.map((playbook) => ({
                    label: playbook.name,
                    value: String(playbook.id),
                  })),
                ]}
                value={playbookId}
              />
            </label>
            <label className="form-field">
              Starting balance
              <input className="input-control h-10 normal-case tracking-normal" onChange={(event) => setBalance(event.target.value)} type="number" value={balance} />
            </label>
            <button className="control-button workspace-tab-active justify-center" type="submit">
              <Plus size={15} />
              Save session
            </button>
          </form>
          <div className="mt-4 grid gap-2">
            <CompactMetric label="Live total P&L" value={formatMoney(aggregate.netPnl)} tone={toneForNumber(aggregate.netPnl)} />
            <CompactMetric label="Latest session" value={sessionById.get(sessions.at(-1)?.id ?? 0)?.name ?? "-"} />
          </div>
        </FeatureCard>
      </div>
    </PageScaffold>
  );
}

function JournalDashboardPage({
  aggregate,
  closedTrades,
  days,
  sessions,
}: JournalPageProps) {
  const latestDay = days[0];
  const startingBalance = sessions[0]?.initial_balance ?? 0;
  const liveBalance = startingBalance + aggregate.netPnl;

  return (
    <PageScaffold
      eyebrow="Journal Dashboard"
      title="Live Trading Command Center"
      description="Actual taken trade performance only. Backtest sessions and replay trades are not included here."
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(360px,1fr)_minmax(300px,0.75fr)]">
        <FeatureCard>
          <CardLabel icon={TrendingUp} label="Live daily P&L" />
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
          <CardLabel icon={Activity} label="Recent actual trades" />
          <div className="mt-4 grid max-h-72 gap-2 overflow-auto">
            {closedTrades.slice(-8).reverse().map((trade) => (
              <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm" key={trade.id}>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-white">{trade.strategy_name || "Unassigned"} - {trade.side}</span>
                  <span className="text-xs text-slate-500">{formatDateTime(trade.exit_time)}</span>
                </span>
                <span className={`font-semibold ${toneForNumber(trade.realized_pnl)}`}>{formatMoney(trade.realized_pnl)}</span>
              </div>
            ))}
            {closedTrades.length === 0 && <EmptyState icon={ClipboardList} message="Record a live trade to populate Journal activity." />}
          </div>
        </FeatureCard>
        <FeatureCard>
          <CardLabel icon={WalletCards} label="Live account balance" />
          <div className="mt-6 text-4xl font-semibold tabular-nums text-white">{formatMoney(liveBalance)}</div>
          <p className="mt-3 text-sm text-slate-500">Starting balance plus actual recorded trade P&L.</p>
        </FeatureCard>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.55fr)]">
        <FeatureCard>
          <CardLabel icon={CalendarDays} label="Live trading calendar" />
          <div className="mt-4">
            <CalendarHeatmap days={days} />
          </div>
        </FeatureCard>
        <FeatureCard>
          <CardLabel icon={TrendingDown} label="Live drawdown" />
          <div className="mt-4">
            <AreaSparkline values={drawdownValues(closedTrades)} height={220} tone="rose" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <CompactMetric label="Max DD" value={formatMoney(aggregate.maxDrawdown)} tone="text-rose-300" />
            <CompactMetric label="PF" value={formatRatio(aggregate.profitFactor)} />
          </div>
        </FeatureCard>
      </div>
    </PageScaffold>
  );
}

function JournalTradesPage({
  closedTrades,
  journal,
  sessions,
}: JournalPageProps) {
  return (
    <PageScaffold
      eyebrow="Journal Trades"
      title="Live Trade Log"
      description="Manually record actual taken trades here. These entries feed only Journal sessions, strategies, and reports."
    >
      <div className="grid gap-4 2xl:grid-cols-[380px_minmax(0,1fr)]">
        <LiveTradeForm journal={journal} sessions={sessions} />
        <LiveTradeTable sessionById={new Map(sessions.map((session) => [session.id, session]))} trades={closedTrades} />
      </div>
    </PageScaffold>
  );
}

function JournalDayViewPage({ days }: JournalPageProps) {
  return (
    <PageScaffold
      eyebrow="Journal Day View"
      title="Actual Trade Daily Review"
      description="Daily review for live trades only, using the same P&L, win rate, and calendar rhythm as backtesting."
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-3">
          {days.map((day) => (
            <FeatureCard key={day.date}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">{day.label}</div>
                  <div className={`mt-1 text-sm font-semibold ${toneForNumber(day.aggregate.netPnl)}`}>
                    Net P&L {formatMoney(day.aggregate.netPnl)}
                  </div>
                </div>
                <span className="status-pill">{day.aggregate.totalTrades} actual trades</span>
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.55fr)_minmax(0,0.45fr)]">
                <AreaSparkline values={cumulativeValues(day.trades)} height={150} />
                <div className="grid grid-cols-2 gap-2">
                  <CompactMetric label="Win rate" value={formatPercent(day.aggregate.winRate)} />
                  <CompactMetric label="Profit factor" value={formatRatio(day.aggregate.profitFactor)} />
                  <CompactMetric label="Winners" value={String(day.aggregate.wins)} tone="text-emerald-300" />
                  <CompactMetric label="Losers" value={String(day.aggregate.losses)} tone="text-rose-300" />
                </div>
              </div>
            </FeatureCard>
          ))}
          {days.length === 0 && <EmptyState icon={CalendarDays} message="Live trade days appear after recording actual trades." />}
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

function JournalNotesPage({ closedTrades }: JournalPageProps) {
  const [selectedTradeId, setSelectedTradeId] = useState<number | null>(closedTrades.at(-1)?.id ?? null);
  const selectedTrade = closedTrades.find((trade) => trade.id === selectedTradeId) ?? closedTrades.at(-1) ?? null;

  return (
    <PageScaffold
      eyebrow="Journal Notes"
      title="Live Trade Notes"
      description="Notes, tags, and emotional review for actual trades only."
    >
      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <FeatureCard className="p-0">
          <div className="border-b border-white/10 p-3">
            <div className="flex items-center gap-2">
              <Search size={15} className="text-slate-500" />
              <input className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-600" placeholder="Search live notes" />
            </div>
          </div>
          <div className="grid gap-2 p-3">
            <NotebookFolder
              label={`All live notes (${closedTrades.length})`}
              active
              onClick={() => undefined}
            />
            {closedTrades.slice().reverse().map((trade) => (
              <button
                className={`rounded-md border px-3 py-2 text-left text-sm transition ${
                  selectedTrade?.id === trade.id ? "border-cyan-300/30 bg-cyan-300/10" : "border-white/10 bg-black/20 hover:border-white/20"
                }`}
                key={trade.id}
                onClick={() => setSelectedTradeId(trade.id)}
                type="button"
              >
                <span className="block font-semibold text-white">{trade.strategy_name || "Unassigned"} : {shortDate(trade.entry_time)}</span>
                <span className={`text-xs font-semibold ${toneForNumber(trade.realized_pnl)}`}>{formatMoney(trade.realized_pnl)}</span>
              </button>
            ))}
          </div>
        </FeatureCard>
        <FeatureCard>
          {selectedTrade ? (
            <>
              <h2 className="text-xl font-semibold text-white">{selectedTrade.strategy_name || "Live trade"} : {shortDate(selectedTrade.entry_time)}</h2>
              <p className="mt-1 text-xs text-slate-500">
                Entry {formatDateTime(selectedTrade.entry_time)} - Exit {formatDateTime(selectedTrade.exit_time)}
              </p>
              <div className="mt-4 grid gap-2 md:grid-cols-5">
                <CompactMetric label="Side" value={selectedTrade.side} />
                <CompactMetric label="P&L" value={formatMoney(selectedTrade.realized_pnl)} tone={toneForNumber(selectedTrade.realized_pnl)} />
                <CompactMetric label="R multiple" value={formatOptionalNumber(selectedTrade.r_multiple)} />
                <CompactMetric label="Emotion" value={selectedTrade.emotional_state || "-"} />
                <CompactMetric label="Tags" value={selectedTrade.mistake_tags.join(", ") || "-"} />
              </div>
              {selectedTrade.screenshot_url && (
                <div className="mt-4 overflow-hidden rounded-md border border-white/10 bg-black/20">
                  <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                    <CardLabel icon={Eye} label="Screenshot" />
                    <a className="text-xs font-semibold text-cyan-200 hover:text-cyan-100" href={selectedTrade.screenshot_url} rel="noreferrer" target="_blank">
                      Open full size
                    </a>
                  </div>
                  <img alt="Live trade screenshot" className="max-h-80 w-full object-contain" src={selectedTrade.screenshot_url} />
                </div>
              )}
              <RichTextEditorStub />
            </>
          ) : (
            <EmptyState icon={NotebookPen} message="Record a live trade to start live notes." />
          )}
        </FeatureCard>
      </div>
    </PageScaffold>
  );
}

function JournalReportsPage({
  aggregate,
  closedTrades,
  days,
  strategies,
}: JournalPageProps) {
  const [tab, setTab] = useState<"daytime" | "overview" | "performance" | "risk" | "strategies">("performance");
  const rRows = useMemo(() => groupByRMultiple(closedTrades), [closedTrades]);
  const hourRows = useMemo(() => groupByHour(closedTrades), [closedTrades]);

  return (
    <PageScaffold
      eyebrow="Journal Reports"
      title="Live Journal Performance Reports"
      description="Reports calculated from actual manually recorded trades only."
    >
      <div className="flex gap-2 overflow-x-auto rounded-md border border-white/10 bg-black/20 p-1">
        {[
          ["performance", "Performance"],
          ["overview", "Overview"],
          ["daytime", "Day & Time"],
          ["risk", "Risk"],
          ["strategies", "Strategies"],
        ].map(([id, label]) => (
          <TinyTab active={tab === id} key={id} onClick={() => setTab(id as typeof tab)}>
            {label}
          </TinyTab>
        ))}
      </div>
      {tab === "performance" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <FeatureCard>
            <CardLabel icon={LineChart} label="Live equity curve" />
            <AreaSparkline values={cumulativeValues(closedTrades)} height={260} />
          </FeatureCard>
          <FeatureCard>
            <CardLabel icon={BarChart3} label="Live P&L by day" />
            <BarBreakdown
              currency="USD"
              rows={days.map((day) => ({ label: day.date.slice(5), value: day.aggregate.netPnl }))}
            />
          </FeatureCard>
          <FeatureCard className="xl:col-span-2">
            <StatsGrid aggregate={aggregate} currency="USD" />
          </FeatureCard>
        </div>
      )}
      {tab === "overview" && <FeatureCard><StatsGrid aggregate={aggregate} currency="USD" /></FeatureCard>}
      {tab === "daytime" && <ReportBreakdown leftTitle="Live net P&L by hour" rightTitle="Live win % by hour" rows={hourRows} />}
      {tab === "risk" && <ReportBreakdown leftTitle="Live net P&L by R multiple" rightTitle="Live win % by R bucket" rows={rRows} />}
      {tab === "strategies" && (
        <ReportBreakdown
          leftTitle="Live P&L by strategy"
          rightTitle="Live win % by strategy"
          rows={strategies.map((strategy) => ({ aggregate: strategy.aggregate, label: strategy.name }))}
        />
      )}
    </PageScaffold>
  );
}

function JournalStrategiesPage({ strategies }: JournalPageProps) {
  const [selectedName, setSelectedName] = useState<string | null>(strategies[0]?.name ?? null);
  const selected = strategies.find((strategy) => strategy.name === selectedName) ?? strategies[0] ?? null;

  return (
    <PageScaffold
      eyebrow="Journal Strategies"
      title="Live Strategy Performance"
      description="Strategy analytics from actual trades only. Backtest strategy stats remain in Backtesting."
    >
      <FeatureCard>
        <div className="overflow-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <th className="px-3 py-3 font-medium">Strategy</th>
                <th className="px-3 py-3 font-medium">Sessions</th>
                <th className="px-3 py-3 font-medium">Trades</th>
                <th className="px-3 py-3 font-medium">Net P&L</th>
                <th className="px-3 py-3 font-medium">Win rate</th>
                <th className="px-3 py-3 font-medium">Avg R</th>
              </tr>
            </thead>
            <tbody>
              {strategies.map((strategy) => (
                <tr
                  className={`cursor-pointer border-t border-white/10 text-slate-300 hover:bg-white/5 ${selected?.name === strategy.name ? "bg-cyan-300/10" : ""}`}
                  key={strategy.name}
                  onClick={() => setSelectedName(strategy.name)}
                >
                  <td className="px-3 py-4 font-semibold text-white">{strategy.name}</td>
                  <td className="px-3 py-4">{strategy.sessions.length}</td>
                  <td className="px-3 py-4">{strategy.aggregate.totalTrades}</td>
                  <td className={`px-3 py-4 font-semibold ${toneForNumber(strategy.aggregate.netPnl)}`}>{formatMoney(strategy.aggregate.netPnl)}</td>
                  <td className="px-3 py-4">{formatPercent(strategy.aggregate.winRate)}</td>
                  <td className="px-3 py-4">{formatOptionalNumber(strategy.aggregate.averageR)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {strategies.length === 0 && <EmptyState icon={Target} message="Record live trades with strategies to populate this list." />}
        </div>
      </FeatureCard>
      <FeatureCard>
        {selected ? (
          <div>
            <CardLabel icon={Target} label="Live strategy detail" />
            <h3 className="mt-3 text-xl font-semibold text-white">{selected.name}</h3>
            <div className="mt-4 grid gap-2 md:grid-cols-4">
              <CompactMetric label="Net P&L" value={formatMoney(selected.aggregate.netPnl)} tone={toneForNumber(selected.aggregate.netPnl)} />
              <CompactMetric label="Win rate" value={formatPercent(selected.aggregate.winRate)} />
              <CompactMetric label="Profit factor" value={formatRatio(selected.aggregate.profitFactor)} />
              <CompactMetric label="Sessions" value={String(selected.sessions.length)} />
            </div>
          </div>
        ) : (
          <EmptyState icon={Target} message="No live strategy selected." />
        )}
      </FeatureCard>
    </PageScaffold>
  );
}

function JournalPlaybooksPage({
  closedTrades,
  journal,
  playbooks,
  sessions,
}: JournalPageProps) {
  return (
    <PageScaffold
      eyebrow="Journal Playbooks"
      title="Live Trade Rule Sets"
      description="Playbooks are written rules and conditions for live trading review. They are separate from Journal strategy performance."
    >
      <PlaybookRuleLibrary
        contextLabel="Journal"
        createLabel="Create live playbook"
        emptyMessage="Create a Journal playbook to keep live-trading rules separate from strategy metrics."
        onCreatePlaybook={journal.addPlaybook}
        playbooks={playbooks}
        sessions={sessions}
        trades={closedTrades}
      />
    </PageScaffold>
  );
}

function JournalAccountsPage({ aggregate, closedTrades, sessions }: JournalPageProps) {
  const startingBalance = sessions[0]?.initial_balance ?? 0;
  return (
    <PageScaffold
      eyebrow="Journal Accounts"
      title="Live Account Management"
      description="Live account metrics are calculated from actual recorded trades only."
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.7fr)_minmax(0,0.3fr)]">
        <FeatureCard>
          <CardLabel icon={WalletCards} label="Manual live accounts" />
          <div className="mt-4 grid gap-2 md:grid-cols-3">
            {sessions.map((session) => (
              <div className="rounded-md border border-white/10 bg-black/20 p-3" key={session.id}>
                <div className="font-semibold text-white">{session.account}</div>
                <div className="mt-1 text-xs text-slate-500">{session.name}</div>
                <div className="mt-3 text-lg font-semibold tabular-nums text-white">
                  {formatMoney(session.initial_balance + aggregateTrades(closedTrades.filter((trade) => trade.session_id === session.id)).netPnl)}
                </div>
              </div>
            ))}
          </div>
        </FeatureCard>
        <FeatureCard>
          <CardLabel icon={Gauge} label="Live account total" />
          <div className="mt-6 text-3xl font-semibold text-white">{formatMoney(startingBalance + aggregate.netPnl)}</div>
          <div className="mt-4 grid gap-2">
            <CompactMetric label="Recorded P&L" value={formatMoney(aggregate.netPnl)} tone={toneForNumber(aggregate.netPnl)} />
            <CompactMetric label="Sessions" value={String(sessions.length)} />
          </div>
        </FeatureCard>
      </div>
    </PageScaffold>
  );
}

function JournalSettingsPage(_: JournalPageProps) {
  return (
    <PageScaffold
      eyebrow="Journal Settings"
      title="Live Journal Settings"
      description="Defaults for manually recorded actual trades."
    >
      <FeatureCard>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="form-field">
            Default live risk %
            <input className="input-control h-10 normal-case tracking-normal" defaultValue="1" type="number" />
          </label>
          <label className="form-field">
            Default account
            <input className="input-control h-10 normal-case tracking-normal" defaultValue="Manual" />
          </label>
          <label className="form-field">
            Commission mode
            <ThemedSelect
              className="h-10"
              defaultValue="Manual entry"
              options={[
                { label: "Manual entry", value: "Manual entry" },
                { label: "Flat per trade", value: "Flat per trade" },
                { label: "Percent of notional", value: "Percent of notional" },
              ]}
            />
          </label>
          <label className="form-field">
            Journal import source
            <ThemedSelect
              className="h-10"
              defaultValue="Manual"
              options={[
                { label: "Manual", value: "Manual" },
                { label: "Broker CSV", value: "Broker CSV" },
              ]}
            />
          </label>
        </div>
      </FeatureCard>
    </PageScaffold>
  );
}

function LiveTradeForm({
  journal,
  sessions,
}: {
  journal: LiveJournalController;
  sessions: LiveJournalSession[];
}) {
  const defaultSessionId = String(sessions[0]?.id ?? 1);
  const defaultSession = sessions[0];
  const [sessionId, setSessionId] = useState(defaultSessionId);
  const [side, setSide] = useState<"LONG" | "SHORT">("LONG");
  const [strategy, setStrategy] = useState(defaultSession?.strategy_name ?? "Discretionary");
  const [entryTime, setEntryTime] = useState(defaultDateTimeLocal(-60));
  const [exitTime, setExitTime] = useState(defaultDateTimeLocal(0));
  const [entryPrice, setEntryPrice] = useState("1.00000");
  const [exitPrice, setExitPrice] = useState("1.00100");
  const [quantity, setQuantity] = useState("10000");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [emotion, setEmotion] = useState<string>("Calm");
  const [screenshotUrl, setScreenshotUrl] = useState("");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");

  function handleScreenshotFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setScreenshotUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  function submitTrade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedEntry = Number(entryPrice);
    const parsedExit = Number(exitPrice);
    const parsedQuantity = Number(quantity);
    if (!Number.isFinite(parsedEntry) || !Number.isFinite(parsedExit) || !Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      return;
    }
    journal.addTrade({
      emotionalState: emotion || null,
      entryPrice: parsedEntry,
      entryTime,
      exitPrice: parsedExit,
      exitTime,
      mistakeTags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      notes: notes.trim() || null,
      quantity: parsedQuantity,
      screenshotUrl: screenshotUrl.trim() || null,
      sessionId: Number(sessionId) || sessions[0]?.id || 1,
      side,
      stopLoss: stopLoss.trim() ? Number(stopLoss) : null,
      strategyName: strategy.trim() || null,
      takeProfit: takeProfit.trim() ? Number(takeProfit) : null,
    });
    setNotes("");
    setScreenshotUrl("");
    setTags("");
  }

  return (
    <FeatureCard>
      <CardLabel icon={Plus} label="Record actual trade" />
      <form className="mt-4 grid gap-3" onSubmit={submitTrade}>
        <label className="form-field">
          Live session
          <ThemedSelect
            className="h-10"
            onChange={setSessionId}
            options={sessions.map((session) => ({
              label: session.name,
              sublabel: session.instrument,
              value: String(session.id),
            }))}
            value={sessionId}
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button
            className={`control-button justify-center ${side === "LONG" ? "workspace-tab-active" : ""}`}
            onClick={() => setSide("LONG")}
            type="button"
          >
            Long
          </button>
          <button
            className={`control-button justify-center ${side === "SHORT" ? "workspace-tab-active" : ""}`}
            onClick={() => setSide("SHORT")}
            type="button"
          >
            Short
          </button>
        </div>
        <label className="form-field">
          Strategy
          <input className="input-control h-10 normal-case tracking-normal" onChange={(event) => setStrategy(event.target.value)} value={strategy} />
        </label>
        <div className="grid gap-2">
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Emotion</div>
          <div className="flex flex-wrap gap-1.5 rounded-md border border-white/10 bg-black/20 p-1">
            {LIVE_EMOTIONS.map((item) => (
              <button
                className={`h-8 rounded px-2.5 text-xs font-semibold transition ${
                  emotion === item ? "bg-white text-ink-950" : "text-slate-400 hover:bg-white/10 hover:text-white"
                }`}
                key={item}
                onClick={() => setEmotion(item)}
                type="button"
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="form-field">
            Entry time
            <input className="input-control h-10 normal-case tracking-normal" onChange={(event) => setEntryTime(event.target.value)} type="datetime-local" value={entryTime} />
          </label>
          <label className="form-field">
            Exit time
            <input className="input-control h-10 normal-case tracking-normal" onChange={(event) => setExitTime(event.target.value)} type="datetime-local" value={exitTime} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="form-field">
            Entry
            <input className="input-control h-10 normal-case tracking-normal" onChange={(event) => setEntryPrice(event.target.value)} value={entryPrice} />
          </label>
          <label className="form-field">
            Exit
            <input className="input-control h-10 normal-case tracking-normal" onChange={(event) => setExitPrice(event.target.value)} value={exitPrice} />
          </label>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <label className="form-field">
            Size
            <input className="input-control h-10 normal-case tracking-normal" onChange={(event) => setQuantity(event.target.value)} value={quantity} />
          </label>
          <label className="form-field">
            SL
            <input className="input-control h-10 normal-case tracking-normal" onChange={(event) => setStopLoss(event.target.value)} placeholder="Optional" value={stopLoss} />
          </label>
          <label className="form-field">
            TP
            <input className="input-control h-10 normal-case tracking-normal" onChange={(event) => setTakeProfit(event.target.value)} placeholder="Optional" value={takeProfit} />
          </label>
        </div>
        <label className="form-field">
          Tags
          <input className="input-control h-10 normal-case tracking-normal" onChange={(event) => setTags(event.target.value)} placeholder="FOMO, Late entry" value={tags} />
        </label>
        <div className="grid gap-2">
          <label className="form-field">
            Screenshot URL
            <input
              className="input-control h-10 normal-case tracking-normal"
              onChange={(event) => setScreenshotUrl(event.target.value)}
              placeholder="Paste image URL or upload below"
              value={screenshotUrl.startsWith("data:") ? "Uploaded image attached" : screenshotUrl}
            />
          </label>
          <label className="form-field">
            Upload screenshot
            <input className="input-control h-10 normal-case tracking-normal file:mr-3 file:rounded file:border-0 file:bg-white/10 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-slate-200" accept="image/*" onChange={handleScreenshotFile} type="file" />
          </label>
          {screenshotUrl && (
            <div className="overflow-hidden rounded-md border border-white/10 bg-black/20">
              <img alt="Trade screenshot preview" className="max-h-36 w-full object-cover" src={screenshotUrl} />
            </div>
          )}
        </div>
        <label className="form-field">
          Notes
          <textarea className="input-control min-h-24 normal-case tracking-normal" onChange={(event) => setNotes(event.target.value)} value={notes} />
        </label>
        <button className="control-button workspace-tab-active justify-center" type="submit">
          Save actual trade
        </button>
      </form>
    </FeatureCard>
  );
}

function LiveTradeTable({
  sessionById,
  trades,
}: {
  sessionById: Map<number, LiveJournalSession>;
  trades: Trade[];
}) {
  return (
    <FeatureCard>
      <div className="mb-4 flex items-center justify-between gap-3">
        <CardLabel icon={ClipboardList} label="Live trade ledger" />
        <span className="text-xs text-slate-500">{trades.length} actual exits</span>
      </div>
      <div className="overflow-auto">
        <table className="w-full min-w-[1120px] text-left text-sm">
          <thead className="text-xs uppercase tracking-[0.16em] text-slate-500">
            <tr>
              <th className="px-3 py-3 font-medium">Session</th>
              <th className="px-3 py-3 font-medium">Entry</th>
              <th className="px-3 py-3 font-medium">Exit</th>
              <th className="px-3 py-3 font-medium">Side</th>
              <th className="px-3 py-3 font-medium">Size</th>
              <th className="px-3 py-3 font-medium">P&L</th>
              <th className="px-3 py-3 font-medium">R</th>
              <th className="px-3 py-3 font-medium">Strategy</th>
              <th className="px-3 py-3 font-medium">Emotion</th>
              <th className="px-3 py-3 font-medium">Tags</th>
              <th className="px-3 py-3 font-medium">Screenshot</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => (
              <tr className="border-t border-white/10 text-slate-300" key={trade.id}>
                <td className="px-3 py-4">
                  <div className="font-semibold text-white">{sessionById.get(trade.session_id)?.name ?? "Live session"}</div>
                  <div className="text-xs text-slate-500">{sessionById.get(trade.session_id)?.instrument ?? "Manual"}</div>
                </td>
                <td className="px-3 py-4">
                  <div className="font-semibold text-white">{formatPrice(trade.entry_price)}</div>
                  <div className="text-xs text-slate-500">{formatDateTime(trade.entry_time)}</div>
                </td>
                <td className="px-3 py-4">
                  <div className="font-semibold text-white">{formatPrice(trade.exit_price)}</div>
                  <div className="text-xs text-slate-500">{formatDateTime(trade.exit_time)}</div>
                </td>
                <td className="px-3 py-4">
                  <span className={`rounded px-2 py-1 text-xs font-semibold ${trade.side === "LONG" ? "bg-emerald-300/10 text-emerald-200" : "bg-rose-300/10 text-rose-200"}`}>
                    {trade.side}
                  </span>
                </td>
                <td className="px-3 py-4">{formatCompactNumber(trade.quantity)}</td>
                <td className={`px-3 py-4 font-semibold ${toneForNumber(trade.realized_pnl)}`}>{formatMoney(trade.realized_pnl)}</td>
                <td className="px-3 py-4">{formatOptionalNumber(trade.r_multiple)}</td>
                <td className="px-3 py-4">{trade.strategy_name || "-"}</td>
                <td className="px-3 py-4">{trade.emotional_state || "-"}</td>
                <td className="px-3 py-4">{trade.mistake_tags.join(", ") || "-"}</td>
                <td className="px-3 py-4">
                  {trade.screenshot_url ? (
                    <a className="font-semibold text-cyan-200 hover:text-cyan-100" href={trade.screenshot_url} rel="noreferrer" target="_blank">
                      View
                    </a>
                  ) : (
                    "-"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {trades.length === 0 && <EmptyState icon={ClipboardList} message="Record an actual trade to populate the live ledger." />}
      </div>
    </FeatureCard>
  );
}

function NotebookPage({
  closedTrades,
  datasets,
  notebookFocusTradeId,
  onReplayTrade,
  sessionById,
  strategies,
}: SharedPageProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "favorites">("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [favoriteTradeIds, setFavoriteTradeIds] = useState<number[]>(() =>
    sanitizeFavoriteIds(getCachedAppStorageItem<unknown>(NOTEBOOK_FAVORITES_STORAGE_KEY, [])),
  );
  const [selectedTradeId, setSelectedTradeId] = useState<number | null>(
    closedTrades.at(-1)?.id ?? null,
  );
  const favoriteTradeIdSet = useMemo(
    () => new Set(favoriteTradeIds),
    [favoriteTradeIds],
  );
  const orderedTrades = useMemo(
    () => closedTrades.slice().reverse(),
    [closedTrades],
  );
  const savedStrategyNames = useBacktestStrategyNames();
  const strategyOptions = useMemo(
    () => buildStrategySelectOptions(mergeStrategyGroups(strategies, savedStrategyNames)),
    [savedStrategyNames, strategies],
  );
  const visibleTrades = useMemo(
    () =>
      orderedTrades.filter((trade) => {
        if (filterMode === "favorites" && !favoriteTradeIdSet.has(trade.id)) {
          return false;
        }
        return matchesNotebookSearch(
          trade,
          searchTerm,
          sessionById.get(trade.session_id),
        );
      }),
    [favoriteTradeIdSet, filterMode, orderedTrades, searchTerm, sessionById],
  );
  const selectedTrade =
    visibleTrades.find((trade) => trade.id === selectedTradeId) ??
    visibleTrades[0] ??
    null;
  const selectedSession = selectedTrade
    ? sessionById.get(selectedTrade.session_id) ?? null
    : null;
  const favoriteCount = favoriteTradeIds.filter((id) =>
    closedTrades.some((trade) => trade.id === id),
  ).length;

  useEffect(() => {
    let active = true;
    void loadAppStorageItem<unknown>(NOTEBOOK_FAVORITES_STORAGE_KEY, []).then((value) => {
      if (active) {
        setFavoriteTradeIds(sanitizeFavoriteIds(value));
      }
    });
    const unsubscribe = subscribeAppStorageItem<unknown>(
      NOTEBOOK_FAVORITES_STORAGE_KEY,
      (value) => setFavoriteTradeIds(sanitizeFavoriteIds(value)),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (notebookFocusTradeId == null || !closedTrades.some((trade) => trade.id === notebookFocusTradeId)) {
      return;
    }
    setSearchTerm("");
    setFilterMode("all");
    setFilterOpen(false);
    setSelectedTradeId(notebookFocusTradeId);
  }, [closedTrades, notebookFocusTradeId]);

  useEffect(() => {
    if (visibleTrades.length === 0) {
      if (selectedTradeId != null) {
        setSelectedTradeId(null);
      }
      return;
    }
    if (!visibleTrades.some((trade) => trade.id === selectedTradeId)) {
      setSelectedTradeId(visibleTrades[0].id);
    }
  }, [selectedTradeId, visibleTrades]);

  function toggleFavorite(tradeId: number) {
    const nextIds = favoriteTradeIdSet.has(tradeId)
      ? favoriteTradeIds.filter((id) => id !== tradeId)
      : [...favoriteTradeIds, tradeId];
    setFavoriteTradeIds(nextIds);
    void saveAppStorageItem(NOTEBOOK_FAVORITES_STORAGE_KEY, nextIds);
  }

  return (
    <PageScaffold
      eyebrow="Backtest Notebook"
      title="Backtest Trade Notes"
      description="An EdgeLab notebook linked to closed replay trades and session review."
    >
      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <FeatureCard className="p-0">
          <div className="border-b border-white/10 p-3">
            <div className="relative flex items-center gap-2">
              <Search size={15} className="text-slate-500" />
              <input
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-600"
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search notes"
                value={searchTerm}
              />
              <button
                className={`control-button h-8 px-2 text-xs ${filterMode === "favorites" ? "workspace-tab-active" : ""}`}
                onClick={() => setFilterOpen((current) => !current)}
                title="Filter note search scope"
                type="button"
              >
                <Filter size={14} />
                {filterMode === "favorites" ? "Favorites" : "All"}
              </button>
              {filterOpen && (
                <div className="absolute right-0 top-10 z-20 grid w-48 gap-1 rounded-md border border-white/10 bg-[#080c11] p-2 shadow-panel">
                  <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Search scope
                  </div>
                  {[
                    { id: "all", label: "All notes" },
                    { id: "favorites", label: "Favorites" },
                  ].map((option) => (
                    <button
                      className={`chart-dropdown-row ${filterMode === option.id ? "chart-dropdown-row-active" : ""}`}
                      key={option.id}
                      onClick={() => {
                        setFilterMode(option.id as "all" | "favorites");
                        setFilterOpen(false);
                      }}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="grid gap-2 p-3">
            <NotebookFolder
              active={filterMode === "all"}
              label={`All notes (${closedTrades.length})`}
              onClick={() => setFilterMode("all")}
            />
            <NotebookFolder
              active={filterMode === "favorites"}
              label={`Favorites (${favoriteCount})`}
              onClick={() => setFilterMode("favorites")}
            />
            <div className="mt-2 flex items-center justify-between text-xs uppercase tracking-[0.16em] text-slate-500">
              Trade Notes
            </div>
            {visibleTrades.map((trade) => (
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
                  {formatMoney(
                    trade.realized_pnl,
                    currencyForSession(sessionById.get(trade.session_id), datasets),
                  )}
                </span>
              </button>
            ))}
            {visibleTrades.length === 0 && (
              <div className="rounded-md border border-dashed border-white/10 bg-black/20 px-3 py-6 text-center text-sm text-slate-500">
                No notes match this view.
              </div>
            )}
          </div>
        </FeatureCard>
        <FeatureCard>
          {selectedTrade ? (
            <NotebookTradeDetail
              allTrades={closedTrades}
              currency={currencyForSession(selectedSession, datasets)}
              favorite={favoriteTradeIdSet.has(selectedTrade.id)}
              onReplayTrade={onReplayTrade}
              onToggleFavorite={() => toggleFavorite(selectedTrade.id)}
              session={selectedSession}
              strategyOptions={strategyOptions}
              trade={selectedTrade}
            />
          ) : (
            <EmptyState icon={NotebookPen} message="Close a trade to start a linked note." />
          )}
        </FeatureCard>
      </div>
    </PageScaffold>
  );
}

function NotebookTradeDetail({
  allTrades,
  currency,
  favorite,
  onReplayTrade,
  onToggleFavorite,
  session,
  strategyOptions,
  trade,
}: {
  allTrades: Trade[];
  currency: string;
  favorite: boolean;
  onReplayTrade: (trade: Trade) => Promise<void> | void;
  onToggleFavorite: () => void;
  session: BacktestSession | null;
  strategyOptions: Array<{ label: string; sublabel?: string; value: string }>;
  trade: Trade;
}) {
  const updateJournal = useBacktestStore((state) => state.updateJournal);
  const noteRef = useRef<HTMLDivElement | null>(null);
  const customTagRef = useRef<HTMLInputElement | null>(null);
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const savedSelectionRef = useRef<Range | null>(null);
  const editingLinkRef = useRef<HTMLAnchorElement | null>(null);
  const [notes, setNotes] = useState(() => normalizeStoredNoteHtml(trade.notes));
  const [noteFocused, setNoteFocused] = useState(false);
  const [editorState, setEditorState] = useState<NotebookEditorState>(DEFAULT_NOTEBOOK_EDITOR_STATE);
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const [alignMenuOpen, setAlignMenuOpen] = useState(false);
  const [strategy, setStrategy] = useState(tradeStrategyName(trade, session ?? undefined));
  const [emotion, setEmotion] = useState(trade.emotional_state ?? "");
  const [tags, setTags] = useState<string[]>(trade.mistake_tags);
  const [customTag, setCustomTag] = useState("");
  const [snapshotUrl, setSnapshotUrl] = useState(trade.screenshot_url ?? "");
  const [snapshotStatus, setSnapshotStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >(trade.screenshot_url ? "ready" : "idle");
  const [snapshotActionStatus, setSnapshotActionStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [notebookTemplate, setNotebookTemplate] = useState(() =>
    normalizeNotebookTemplate(getCachedAppStorageItem<unknown>(NOTEBOOK_TEMPLATE_STORAGE_KEY, DEFAULT_NOTEBOOK_TEMPLATE)),
  );
  const activeStrategyScope = strategyTagScope(strategy || session?.strategy_name || trade.strategy_name);
  const [strategyCustomTags, setStrategyCustomTags] = useState<string[]>(() =>
    loadStrategyMistakeTags(activeStrategyScope),
  );
  const mistakeOptions = useMemo(
    () => mergeTags(DEFAULT_MISTAKE_TAGS, strategyCustomTags),
    [strategyCustomTags],
  );
  const savedNotes = useMemo(() => normalizeStoredNoteHtml(trade.notes), [trade.notes]);
  const attachedMistakeTags = useMemo(
    () => new Set(allTrades.flatMap((item) => item.mistake_tags.map((tag) => tag.toLowerCase()))),
    [allTrades],
  );
  const savedStrategy = tradeStrategyName(trade, session ?? undefined);
  const hasChanges =
    notes !== savedNotes ||
    strategy !== savedStrategy ||
    emotion !== (trade.emotional_state ?? "") ||
    snapshotUrl !== (trade.screenshot_url ?? "") ||
    !sameStringList(tags, trade.mistake_tags);

  useEffect(() => {
    const nextNotes = normalizeStoredNoteHtml(trade.notes);
    setNotes(nextNotes);
    if (noteRef.current && noteRef.current.innerHTML !== nextNotes) {
      noteRef.current.innerHTML = nextNotes;
    }
    setNoteFocused(false);
    setStrategy(tradeStrategyName(trade, session ?? undefined));
    setEmotion(trade.emotional_state ?? "");
    setTags(trade.mistake_tags);
    setCustomTag("");
    setSnapshotUrl(trade.screenshot_url ?? "");
    setSnapshotStatus(trade.screenshot_url ? "ready" : "idle");
    setSnapshotActionStatus(null);
    setMoreOpen(false);
    setLinkPopoverOpen(false);
    setLinkText("");
    setLinkUrl("");
    setColorMenuOpen(false);
    setAlignMenuOpen(false);
    editingLinkRef.current = null;
    setEditorState(DEFAULT_NOTEBOOK_EDITOR_STATE);
  }, [session, trade]);

  useEffect(() => {
    let active = true;
    void loadAppStorageItem<unknown>(NOTEBOOK_TEMPLATE_STORAGE_KEY, DEFAULT_NOTEBOOK_TEMPLATE).then((value) => {
      if (active) {
        setNotebookTemplate(normalizeNotebookTemplate(value));
      }
    });
    const unsubscribe = subscribeAppStorageItem<unknown>(
      NOTEBOOK_TEMPLATE_STORAGE_KEY,
      (value) => setNotebookTemplate(normalizeNotebookTemplate(value)),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    setStrategyCustomTags(loadStrategyMistakeTags(activeStrategyScope));
    void hydrateStrategyMistakeTags(activeStrategyScope).then((nextTags) => {
      if (active) {
        setStrategyCustomTags(nextTags);
      }
    });
    const unsubscribe = subscribeStrategyMistakeTags(activeStrategyScope, setStrategyCustomTags);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [activeStrategyScope]);

  useEffect(() => {
    let cancelled = false;
    if (trade.screenshot_url && !shouldRegenerateTradeSnapshotForCurrency(trade.screenshot_url, currency)) {
      setSnapshotStatus("ready");
      return () => {
        cancelled = true;
      };
    }
    setSnapshotStatus("loading");
    void createTradeSnapshotDataUrl(trade, currency)
      .then((snapshot) => {
        if (cancelled) {
          return;
        }
        setSnapshotUrl(snapshot);
        setSnapshotStatus("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setSnapshotStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currency, trade.id, trade.screenshot_url]);

  useEffect(() => {
    if (!linkPopoverOpen) {
      return;
    }
    const frame = requestAnimationFrame(() => linkInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [linkPopoverOpen]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }
    const handleSelectionChange = () => updateEditorState();
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, []);

  async function regenerateSnapshot() {
    setSnapshotStatus("loading");
    setSnapshotActionStatus(null);
    try {
      const snapshot = await createTradeSnapshotDataUrl(trade, currency);
      setSnapshotUrl(snapshot);
      setSnapshotStatus("ready");
      setSnapshotActionStatus("Snapshot regenerated");
    } catch {
      setSnapshotStatus("error");
      setSnapshotActionStatus("Snapshot could not be generated");
    }
  }

  async function copySnapshot() {
    const url = snapshotUrl || trade.screenshot_url;
    if (!url) {
      setSnapshotActionStatus("Snapshot is not ready");
      return;
    }
    setSnapshotActionStatus(null);
    try {
      await copyTradeSnapshotToClipboard(url);
      setSnapshotActionStatus("Snapshot copied");
    } catch {
      try {
        await navigator.clipboard?.writeText(url);
        setSnapshotActionStatus("Snapshot link copied");
      } catch {
        setSnapshotActionStatus("Snapshot could not be copied");
      }
    }
  }

  function addTags(value: string) {
    const nextTags = parseTagInput(value);
    if (nextTags.length === 0) {
      return;
    }
    persistStrategyMistakeTags(activeStrategyScope, nextTags);
    setStrategyCustomTags((current) => mergeTags(current, nextTags));
    setTags((current) => mergeTags(current, nextTags));
    setCustomTag("");
  }

  function removeTag(tag: string) {
    setTags((current) => current.filter((currentTag) => currentTag !== tag));
  }

  function deleteMistakeSuggestion(tag: string) {
    if (isDefaultMistakeTag(tag) || attachedMistakeTags.has(tag.toLowerCase()) || tags.includes(tag)) {
      return;
    }
    removeStrategyMistakeTag(activeStrategyScope, tag);
    setStrategyCustomTags((current) =>
      current.filter((currentTag) => currentTag.toLowerCase() !== tag.toLowerCase()),
    );
  }

  function handleCustomTagKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    addTags(customTag);
  }

  async function saveDraft() {
    setSaving(true);
    try {
      await updateJournal(trade.id, {
        emotional_state: emotion || null,
        mistake_tags: tags,
        notes: isRichTextEmpty(notes) ? null : sanitizeRichTextHtml(notes),
        screenshot_url: snapshotUrl || null,
        strategy_name: strategy || null,
      });
      persistStrategyMistakeTags(activeStrategyScope, tags);
    } catch (error) {
      setSnapshotActionStatus(error instanceof Error ? error.message : "Could not save note");
    } finally {
      setSaving(false);
    }
  }

  function copySummary() {
    const plainNotes = richTextToPlainText(notes);
    const summary = [
      `${session?.symbol ? formatMarketSymbol(session.symbol) : "Trade"} : ${shortDate(trade.entry_time)}`,
      `${trade.side} ${formatCompactNumber(trade.quantity)} @ ${formatPrice(trade.entry_price)}`,
      `Exit: ${formatPrice(trade.exit_price)} | P&L: ${formatMoney(trade.realized_pnl, currency)} | R: ${formatOptionalNumber(trade.r_multiple)}`,
      strategy ? `Strategy: ${strategy}` : null,
      tags.length > 0 ? `Tags: ${tags.join(", ")}` : null,
      plainNotes ? `Notes:\n${plainNotes}` : null,
    ].filter(Boolean).join("\n");
    void navigator.clipboard?.writeText(summary);
    setMoreOpen(false);
  }

  function clearNote() {
    if (noteRef.current) {
      noteRef.current.innerHTML = "";
    }
    setNotes("");
    setNoteFocused(false);
    setMoreOpen(false);
    setLinkPopoverOpen(false);
    setLinkText("");
    setLinkUrl("");
    setColorMenuOpen(false);
    setAlignMenuOpen(false);
    editingLinkRef.current = null;
    setEditorState(DEFAULT_NOTEBOOK_EDITOR_STATE);
  }

  function handleEditorInput(event: FormEvent<HTMLDivElement>) {
    setNotes(sanitizeRichTextHtml(event.currentTarget.innerHTML));
    updateEditorState();
  }

  function syncNotesFromEditor() {
    setNotes(sanitizeRichTextHtml(noteRef.current?.innerHTML ?? ""));
    updateEditorState();
  }

  function saveEditorSelection() {
    const editor = noteRef.current;
    const selection = typeof window === "undefined" ? null : window.getSelection();
    if (!editor || !selection?.rangeCount || !editor.contains(selection.anchorNode)) {
      return;
    }
    savedSelectionRef.current = selection.getRangeAt(0).cloneRange();
  }

  function restoreEditorSelection() {
    const editor = noteRef.current;
    const range = savedSelectionRef.current;
    const selection = typeof window === "undefined" ? null : window.getSelection();
    if (!editor || !range || !selection) {
      return;
    }
    editor.focus();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function selectionIsInEditor() {
    const editor = noteRef.current;
    const selection = typeof window === "undefined" ? null : window.getSelection();
    return Boolean(editor && selection?.rangeCount && editor.contains(selection.anchorNode));
  }

  function focusNoteEditor() {
    const editor = noteRef.current;
    if (!editor || typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    editor.focus();
    const selection = window.getSelection();
    if (selection?.rangeCount && editor.contains(selection.anchorNode)) {
      saveEditorSelection();
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    saveEditorSelection();
  }

  function runEditorCommand(command: string, value?: string) {
    if (typeof document === "undefined") {
      return;
    }
    restoreEditorSelection();
    if (!selectionIsInEditor()) {
      focusNoteEditor();
    }
    document.execCommand(command, false, value);
    saveEditorSelection();
    syncNotesFromEditor();
    requestAnimationFrame(updateEditorState);
  }

  function insertRichHtml(html: string) {
    if (typeof document === "undefined") {
      setNotes((current) => `${current}${current ? "<br>" : ""}${html}`);
      return;
    }
    restoreEditorSelection();
    if (!selectionIsInEditor()) {
      focusNoteEditor();
    }
    document.execCommand("insertHTML", false, html);
    saveEditorSelection();
    syncNotesFromEditor();
    requestAnimationFrame(updateEditorState);
  }

  function updateEditorState() {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return;
    }
    const editor = noteRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount || !editor.contains(selection.anchorNode)) {
      return;
    }
    const align = document.queryCommandState("justifyCenter")
      ? "center"
      : document.queryCommandState("justifyRight")
        ? "right"
        : "left";
    setEditorState({
      align,
      bold: document.queryCommandState("bold"),
      bulletList: document.queryCommandState("insertUnorderedList"),
      color: normalizeEditorColor(document.queryCommandValue("foreColor")),
      italic: document.queryCommandState("italic"),
      link: Boolean(findEditorAnchor(selection.anchorNode, editor)),
      orderedList: document.queryCommandState("insertOrderedList"),
      strike: document.queryCommandState("strikeThrough"),
      underline: document.queryCommandState("underline"),
    });
  }

  function openLinkPopover() {
    if (linkPopoverOpen) {
      setLinkPopoverOpen(false);
      setLinkText("");
      setLinkUrl("");
      editingLinkRef.current = null;
      return;
    }
    const editor = noteRef.current;
    const selection = typeof window === "undefined" ? null : window.getSelection();
    saveEditorSelection();
    const anchor = editor && selection ? findEditorAnchor(selection.anchorNode, editor) : null;
    editingLinkRef.current = anchor;
    setLinkText(anchor?.textContent?.trim() ?? selection?.toString().trim() ?? "");
    setLinkUrl(anchor?.getAttribute("href") ?? "");
    setLinkPopoverOpen(true);
    setColorMenuOpen(false);
    setAlignMenuOpen(false);
  }

  function applyLink() {
    const url = normalizeLinkUrl(linkUrl);
    if (!url) {
      return;
    }
    const selectedText = savedSelectionRef.current?.toString().trim() ?? "";
    const label = linkText.trim() || selectedText || url;
    const editingLink = editingLinkRef.current;
    if (editingLink && noteRef.current?.contains(editingLink)) {
      editingLink.href = url;
      editingLink.target = "_blank";
      editingLink.rel = "noreferrer";
      editingLink.textContent = label;
      syncNotesFromEditor();
    } else {
      insertRichHtml(`<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`);
    }
    setLinkPopoverOpen(false);
    setLinkText("");
    setLinkUrl("");
    editingLinkRef.current = null;
  }

  function applyNoteColor(color: string) {
    restoreEditorSelection();
    runEditorCommand("foreColor", color);
    setColorMenuOpen(false);
  }

  function applyNoteAlign(command: "justifyCenter" | "justifyLeft" | "justifyRight") {
    restoreEditorSelection();
    runEditorCommand(command);
    setAlignMenuOpen(false);
  }

  function handleEditorClick(event: ReactMouseEvent<HTMLDivElement>) {
    const editor = noteRef.current;
    if (!editor || !(event.target instanceof Node)) {
      return;
    }
    const anchor = findEditorAnchor(event.target, editor);
    if (!anchor?.href) {
      return;
    }
    event.preventDefault();
    window.open(anchor.href, "_blank", "noopener,noreferrer");
  }

  function applyEditorAction(action: string) {
    switch (action) {
      case "Template":
        insertRichHtml(textToRichHtml(notebookTemplateText(trade, currency, notebookTemplate, strategy, session)));
        break;
      case "Generate draft":
        insertRichHtml(textToRichHtml(buildNotebookReviewDraft(trade, currency, strategy)));
        break;
      case "B":
        runEditorCommand("bold");
        break;
      case "I":
        runEditorCommand("italic");
        break;
      case "U":
        runEditorCommand("underline");
        break;
      case "S":
        runEditorCommand("strikeThrough");
        break;
      case "Bullet list":
        runEditorCommand("insertUnorderedList");
        break;
      case "Numbered list":
        runEditorCommand("insertOrderedList");
        break;
      case "Link":
        openLinkPopover();
        break;
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">
            {session?.symbol ? formatMarketSymbol(session.symbol) : "Trade"} : {shortDate(trade.entry_time)}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Created: {formatDateTime(trade.entry_time)} - Last updated: {formatDateTime(trade.exit_time)}
          </p>
        </div>
        <div className="relative flex gap-2">
          <button
            className={`icon-button h-9 w-9 ${favorite ? "workspace-tab-active" : ""}`}
            onClick={onToggleFavorite}
            title={favorite ? "Remove from favorites" : "Add to favorites"}
            type="button"
          >
            <Star fill={favorite ? "currentColor" : "none"} size={15} />
          </button>
          <button className="icon-button h-9 w-9" onClick={copySummary} title="Copy note summary" type="button">
            <Copy size={15} />
          </button>
          <button
            className={`icon-button h-9 w-9 ${moreOpen ? "workspace-tab-active" : ""}`}
            onClick={() => setMoreOpen((current) => !current)}
            title="More note actions"
            type="button"
          >
            <MoreHorizontal size={15} />
          </button>
          {moreOpen && (
            <div className="absolute right-0 top-11 z-20 grid min-w-44 gap-1 rounded-md border border-white/10 bg-[#080c11] p-2 shadow-panel">
              <button
                className="chart-dropdown-row text-rose-100"
                onClick={clearNote}
                type="button"
              >
                <X size={14} />
                Clear note
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-md border border-white/10 bg-black/20 p-4">
        <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Trade summary</div>
        <div className={`mt-2 text-3xl font-semibold ${toneForNumber(trade.realized_pnl)}`}>
          {formatMoney(trade.realized_pnl, currency)}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          <CompactMetric label="Side" value={trade.side} />
          <CompactMetric label="Quantity" value={formatCompactNumber(trade.quantity)} />
          <CompactMetric label="R multiple" value={formatOptionalNumber(trade.r_multiple)} />
          <CompactMetric
            label="Gross P&L"
            value={formatMoney(trade.realized_pnl, currency)}
            tone={toneForNumber(trade.realized_pnl)}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="control-button workspace-tab-active"
            onClick={() => onReplayTrade(trade)}
            type="button"
          >
            <PlaySquare size={15} />
            Replay trade
          </button>
          <button
            className="control-button border-cyan-300/30 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20"
            disabled={saving || !hasChanges}
            onClick={() => void saveDraft()}
            type="button"
          >
            <Save size={15} />
            {saving ? "Saving" : "Save note"}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="form-field">
              <span>Strategy</span>
              <ThemedSelect
                className="h-10"
                onChange={setStrategy}
                options={selectOptionsWithValue(
                  strategyOptions,
                  strategy,
                  (value) => ({ label: value, sublabel: "Current note value", value }),
                )}
                portal
                value={strategy}
              />
            </label>
            <label className="form-field">
              <span>Emotional State</span>
              <ThemedSelect
                className="h-10"
                onChange={setEmotion}
                options={selectOptionsWithValue(
                  [
                    { label: "No emotion", value: "" },
                    ...LIVE_EMOTIONS.map((item) => ({ label: item, value: item })),
                  ],
                  emotion,
                )}
                portal
                value={emotion}
              />
            </label>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <CompactMetric label="Entry time" value={formatDateTime(trade.entry_time)} />
            <CompactMetric label="Exit time" value={formatDateTime(trade.exit_time)} />
            <CompactMetric label="Entry" value={formatPrice(trade.entry_price)} />
            <CompactMetric label="Exit" value={formatPrice(trade.exit_price)} />
            <CompactMetric label="Stop loss" value={formatPrice(trade.stop_loss)} />
            <CompactMetric label="Take profit" value={formatPrice(trade.take_profit)} />
            <CompactMetric label="Remaining" value={formatCompactNumber(trade.remaining_quantity)} />
          </div>

          <section className="rounded-md border border-white/10 bg-black/20 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <CardLabel icon={Filter} label="Mistake tags" />
              <span className="text-xs text-slate-500">{tags.length} selected</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {mistakeOptions.map((option) => {
                const active = tags.includes(option);
                const canDeleteSuggestion =
                  !active &&
                  !isDefaultMistakeTag(option) &&
                  !attachedMistakeTags.has(option.toLowerCase());
                return (
                  <span
                    className={`inline-flex overflow-hidden rounded text-xs font-semibold transition ${
                      active
                        ? "bg-rose-300/10 text-rose-100"
                        : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
                    }`}
                    key={option}
                  >
                    <button
                      className="px-3 py-2"
                      onClick={() =>
                        setTags((current) =>
                          current.includes(option)
                            ? current.filter((tag) => tag !== option)
                            : [...current, option],
                        )
                      }
                      type="button"
                    >
                      {option}
                    </button>
                    {canDeleteSuggestion && (
                      <button
                        className="border-l border-white/10 px-2 text-slate-500 hover:bg-rose-300/10 hover:text-rose-100"
                        onClick={() => deleteMistakeSuggestion(option)}
                        title="Delete unused suggestion"
                        type="button"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input
                className="input-control h-10"
                onChange={(event) => setCustomTag(event.target.value)}
                onKeyDown={handleCustomTagKeyDown}
                placeholder="Add custom tag"
                ref={customTagRef}
                value={customTag}
              />
              <button
                className="control-button"
                disabled={!customTag.trim()}
                onClick={() => addTags(customTag)}
                type="button"
              >
                <Plus size={16} />
                Add
              </button>
            </div>
            {tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <button
                    className="inline-flex items-center gap-1 rounded bg-rose-300/10 px-2 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-300/20"
                    key={tag}
                    onClick={() => removeTag(tag)}
                    type="button"
                  >
                    {tag}
                    <X size={12} />
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-md border border-white/10 bg-black/20">
            <div className="relative flex flex-wrap items-center gap-1 border-b border-white/10 p-2">
              {["Template", "Generate draft"].map((item) => (
                <button
                  className="notebook-editor-button px-2.5"
                  key={item}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyEditorAction(item)}
                  type="button"
                >
                  {item}
                </button>
              ))}
              <span className="mx-1 h-5 w-px bg-white/10" />
              {[
                { active: editorState.bold, action: "B", icon: Bold, label: "Bold" },
                { active: editorState.italic, action: "I", icon: Italic, label: "Italic" },
                { active: editorState.underline, action: "U", icon: Underline, label: "Underline" },
                { active: editorState.strike, action: "S", icon: Strikethrough, label: "Strikethrough" },
                { active: editorState.bulletList, action: "Bullet list", icon: List, label: "Bullet list" },
                { active: editorState.orderedList, action: "Numbered list", icon: ListOrdered, label: "Numbered list" },
              ].map(({ active, action, icon: Icon, label }) => (
                <button
                  aria-pressed={active}
                  className={`notebook-editor-button ${active ? "notebook-editor-button-active" : ""}`}
                  key={action}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyEditorAction(action)}
                  title={label}
                  type="button"
                >
                  <Icon size={14} />
                </button>
              ))}
              <button
                aria-pressed={editorState.link}
                className={`notebook-editor-button ${editorState.link || linkPopoverOpen ? "notebook-editor-button-active" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={openLinkPopover}
                title="Link"
                type="button"
              >
                <Link2 size={14} />
              </button>
              <div className="relative">
                <button
                  className={`notebook-editor-button ${colorMenuOpen ? "notebook-editor-button-active" : ""}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    saveEditorSelection();
                    setColorMenuOpen((current) => !current);
                    setAlignMenuOpen(false);
                    setLinkPopoverOpen(false);
                  }}
                  title="Text color"
                  type="button"
                >
                  <Palette size={14} />
                  <span
                    className="h-2.5 w-2.5 rounded-full border border-white/20"
                    style={{ backgroundColor: editorState.color ?? NOTE_COLOR_OPTIONS[0].value }}
                  />
                </button>
                {colorMenuOpen && (
                  <div className="notebook-editor-popover left-0 top-9 w-56">
                    <div className="notebook-popover-title">
                      <span>Text color</span>
                      <span
                        className="h-3 w-3 rounded-full border border-white/20"
                        style={{ backgroundColor: editorState.color ?? NOTE_COLOR_OPTIONS[0].value }}
                      />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      {NOTE_COLOR_OPTIONS.map((option) => {
                        const active = editorState.color === option.value.toLowerCase();
                        return (
                          <button
                            className={`notebook-color-option ${active ? "notebook-color-option-active" : ""}`}
                            key={option.value}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => applyNoteColor(option.value)}
                            title={option.label}
                            type="button"
                          >
                            <span
                              className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/20"
                              style={{ backgroundColor: option.value }}
                            />
                            <span className="min-w-0 flex-1 truncate text-left">{option.label}</span>
                            {active && <CheckCircle2 className="shrink-0 text-cyan-100" size={13} />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              <div className="relative">
                <button
                  className={`notebook-editor-button ${alignMenuOpen || editorState.align !== "left" ? "notebook-editor-button-active" : ""}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    saveEditorSelection();
                    setAlignMenuOpen((current) => !current);
                    setColorMenuOpen(false);
                    setLinkPopoverOpen(false);
                  }}
                  title="Text alignment"
                  type="button"
                >
                  {editorState.align === "right" ? (
                    <AlignRight size={14} />
                  ) : editorState.align === "center" ? (
                    <AlignCenter size={14} />
                  ) : (
                    <AlignLeft size={14} />
                  )}
                </button>
                {alignMenuOpen && (
                  <div className="notebook-editor-popover left-0 top-9 w-40">
                    <div className="notebook-popover-title">Alignment</div>
                    <div className="mt-2 grid grid-cols-3 gap-1">
                      {NOTE_ALIGN_OPTIONS.map((option) => {
                        const Icon = option.icon;
                        const active = editorState.align === option.value;
                        return (
                          <button
                            aria-label={option.label}
                            aria-pressed={active}
                            className={`notebook-align-option ${active ? "notebook-align-option-active" : ""}`}
                            key={option.value}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => applyNoteAlign(option.command)}
                            title={option.label}
                            type="button"
                          >
                            <Icon size={15} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              {linkPopoverOpen && (
                <form
                  className="notebook-editor-popover left-2 top-12 w-[min(320px,calc(100vw-48px))]"
                  onSubmit={(event) => {
                    event.preventDefault();
                    applyLink();
                  }}
                >
                  <div className="notebook-popover-title">
                    <span className="inline-flex items-center gap-2">
                      <Link2 size={13} />
                      {editingLinkRef.current ? "Edit link" : "Insert link"}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2">
                    <label className="notebook-link-field">
                      <span>Text</span>
                      <input
                        className="notebook-link-input"
                        onChange={(event) => setLinkText(event.target.value)}
                        placeholder="Display text"
                        value={linkText}
                      />
                    </label>
                    <label className="notebook-link-field">
                      <span>URL</span>
                      <input
                        className="notebook-link-input"
                        onChange={(event) => setLinkUrl(event.target.value)}
                        placeholder="example.com"
                        ref={linkInputRef}
                        value={linkUrl}
                      />
                    </label>
                  </div>
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      className="icon-button h-8 w-8"
                      onClick={() => {
                        setLinkPopoverOpen(false);
                        setLinkText("");
                        setLinkUrl("");
                        editingLinkRef.current = null;
                      }}
                      title="Cancel"
                      type="button"
                    >
                      <X size={14} />
                    </button>
                    <button
                      className="control-button h-8 border-cyan-300/30 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20"
                      disabled={!normalizeLinkUrl(linkUrl)}
                      type="submit"
                    >
                      {editingLinkRef.current ? "Update" : "Apply"}
                    </button>
                  </div>
                </form>
              )}
            </div>
            <div className="relative">
              {isRichTextEmpty(notes) && !noteFocused && (
                <span className="pointer-events-none absolute left-4 top-3 text-sm text-slate-600">
                  Write something, or press "/" for commands
                </span>
              )}
              <div
                className="notebook-rich-editor min-h-52 w-full resize-y overflow-auto bg-transparent px-4 py-3 text-sm text-slate-300 outline-none"
                contentEditable
                onBlur={() => setNoteFocused(false)}
                onClick={handleEditorClick}
                onFocus={() => setNoteFocused(true)}
                onInput={handleEditorInput}
                onKeyUp={() => {
                  saveEditorSelection();
                  updateEditorState();
                }}
                onMouseUp={() => {
                  saveEditorSelection();
                  updateEditorState();
                }}
                ref={noteRef}
                suppressContentEditableWarning
              />
            </div>
          </section>
        </div>

        <aside className="grid content-start gap-4">
          <section className="rounded-md border border-white/10 bg-black/20 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <CardLabel icon={Image} label="Trade snapshot" />
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  className="control-button h-9"
                  disabled={!snapshotUrl && !trade.screenshot_url}
                  onClick={() => void copySnapshot()}
                  type="button"
                >
                  <Copy size={14} />
                  Copy
                </button>
                <button
                  className="control-button h-9"
                  disabled={snapshotStatus === "loading"}
                  onClick={() => void regenerateSnapshot()}
                  type="button"
                >
                  <RefreshCw className={snapshotStatus === "loading" ? "animate-spin" : ""} size={14} />
                  Regenerate
                </button>
              </div>
            </div>
            {snapshotUrl ? (
              <img
                alt="Generated trade snapshot"
                className="w-full rounded-md border border-white/10"
                src={snapshotUrl}
              />
            ) : (
              <div className="grid h-44 place-items-center rounded-md bg-ink-950 text-sm text-slate-500">
                {snapshotStatus === "error" ? "Snapshot could not be generated" : "Generating snapshot"}
              </div>
            )}
            {snapshotActionStatus && (
              <div className="mt-2 text-xs font-semibold text-cyan-100">{snapshotActionStatus}</div>
            )}
          </section>

        </aside>
      </div>
    </>
  );
}

function sanitizeFavoriteIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0),
    ),
  );
}

function matchesNotebookSearch(
  trade: Trade,
  searchTerm: string,
  session: BacktestSession | undefined,
) {
  const query = searchTerm.trim().toLowerCase();
  if (!query) {
    return true;
  }
  const haystack = [
    session?.name,
    session?.symbol,
    session?.instrument,
    session?.timeframe,
    trade.side,
    trade.status,
    trade.strategy_name,
    richTextToPlainText(trade.notes),
    trade.emotional_state,
    trade.entry_time,
    trade.exit_time,
    formatMoney(trade.realized_pnl, session?.currency ?? "USD"),
    ...trade.mistake_tags,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function sameStringList(a: string[], b: string[]) {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((item, index) => item === b[index]);
}

function findEditorAnchor(node: Node | null, editor: HTMLElement) {
  let current = node instanceof Element ? node : node?.parentElement ?? null;
  while (current && current !== editor) {
    if (current instanceof HTMLAnchorElement) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function normalizeEditorColor(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("#")) {
    return trimmed.length === 4
      ? `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`
      : trimmed;
  }
  const rgb = trimmed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!rgb) {
    return trimmed;
  }
  return `#${[rgb[1], rgb[2], rgb[3]]
    .map((part) => Number(part).toString(16).padStart(2, "0"))
    .join("")}`;
}

function normalizeLinkUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function normalizeNotebookTemplate(value: unknown) {
  return typeof value === "string" && value.trim() ? value : DEFAULT_NOTEBOOK_TEMPLATE;
}

function notebookTemplateText(
  trade: Trade,
  currency: string,
  template: string,
  strategy: string,
  session: BacktestSession | null,
) {
  const replacements: Record<string, string> = {
    date: shortDate(trade.entry_time),
    entry: formatPrice(trade.entry_price),
    exit: formatPrice(trade.exit_price),
    pnl: formatMoney(trade.realized_pnl, currency),
    quantity: formatCompactNumber(trade.quantity),
    r: formatOptionalNumber(trade.r_multiple),
    side: trade.side,
    strategy: strategy || tradeStrategyName(trade, session ?? undefined),
    symbol: session?.symbol ? formatMarketSymbol(session.symbol) : "Trade",
  };
  return normalizeNotebookTemplate(template).replace(
    /\{([a-z_]+)\}/gi,
    (match, key: string) => replacements[key.toLowerCase()] ?? match,
  );
}

function buildNotebookReviewDraft(trade: Trade, currency: string, strategy: string) {
  const outcome = trade.realized_pnl >= 0 ? "positive" : "negative";
  return [
    `Draft review for ${strategy || "this setup"}:`,
    `The trade closed with a ${outcome} result of ${formatMoney(trade.realized_pnl, currency)} and ${formatOptionalNumber(trade.r_multiple)}R.`,
    `Entry was ${formatPrice(trade.entry_price)} and exit was ${formatPrice(trade.exit_price)}.`,
    "Review whether the entry followed the planned trigger, whether management matched the rulebook, and what one adjustment should carry into the next replay.",
  ].join("\n");
}

function ReportsPage({
  aggregate,
  closedTrades,
  currency,
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
            <StatsGrid aggregate={aggregate} currency={currency} />
          </FeatureCard>
        </div>
      )}

      {tab === "overview" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.45fr)_minmax(0,0.55fr)]">
          <FeatureCard>
            <CardLabel icon={Gauge} label="Your stats" />
            <div className="mt-4 grid gap-2">
              <CompactMetric label="Best month" value={formatMoney(bestMonth(closedTrades).pnl, currency)} tone="text-emerald-300" />
              <CompactMetric label="Lowest month" value={formatMoney(worstMonth(closedTrades).pnl, currency)} tone="text-rose-300" />
            </div>
          </FeatureCard>
          <FeatureCard>
            <StatsGrid aggregate={aggregate} currency={currency} />
          </FeatureCard>
        </div>
      )}

      {tab === "daytime" && (
        <ReportBreakdown
          currency={currency}
          leftTitle="Net P&L by hour"
          rightTitle="Win % by hour"
          rows={hourRows}
        />
      )}

      {tab === "risk" && (
        <div className="grid gap-4">
          <ReportBreakdown
            currency={currency}
            leftTitle="Net P&L by R multiple"
            rightTitle="Win % by R bucket"
            rows={rRows}
          />
          <FeatureCard>
            <CardLabel icon={Grid2X2} label="R-multiple cross analysis" />
            <CrossAnalysis currency={currency} rows={rRows} sessionById={sessionById} trades={closedTrades} />
          </FeatureCard>
        </div>
      )}

      {tab === "tags" && (
        <ReportBreakdown
          currency={currency}
          leftTitle="Net P&L by tag"
          rightTitle="Win % by tag"
          rows={tagRows}
        />
      )}

      {tab === "winsLosses" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <FeatureCard>
            <CardLabel icon={TrendingUp} label={`Wins (${aggregate.wins} trades matched)`} />
            <StatsGrid aggregate={aggregateTrades(closedTrades.filter((trade) => trade.realized_pnl > 0))} currency={currency} />
          </FeatureCard>
          <FeatureCard>
            <CardLabel icon={TrendingDown} label={`Losses (${aggregate.losses} trades matched)`} />
            <StatsGrid aggregate={aggregateTrades(closedTrades.filter((trade) => trade.realized_pnl < 0))} currency={currency} />
          </FeatureCard>
        </div>
      )}

      {tab === "calendar" && (
        <FeatureCard>
          <CalendarHeatmap currency={currency} days={days} />
        </FeatureCard>
      )}

      {tab === "recaps" && (
        <div className="grid gap-3">
          <InsightCard
            title="Monthly recap"
            body={closedTrades.length > 0 ? `Net ${formatMoney(aggregate.netPnl, currency)} across ${closedTrades.length} closed backtest trades. Best trade ${formatMoney(aggregate.largestWin ?? 0, currency)}, worst trade ${formatMoney(aggregate.largestLoss ?? 0, currency)}.` : "Backtest reports will appear here after your first closed replay trade."}
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
  currency,
  sessionById,
  sessions,
  strategies,
  trades,
  onResumeSession,
}: SharedPageProps) {
  const savedStrategyNames = useBacktestStrategyNames();
  const updateSession = useBacktestStore((state) => state.updateSession);
  const updateTradeStrategy = useBacktestStore((state) => state.updateTradeStrategy);
  const strategyRows = useMemo(
    () => mergeStrategyGroups(strategies, savedStrategyNames),
    [savedStrategyNames, strategies],
  );
  const [selectedName, setSelectedName] = useState<string | null>(strategyRows[0]?.name ?? null);
  const [dialogMode, setDialogMode] = useState<"create" | "edit" | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StrategyGroup | null>(null);
  const [mutatingName, setMutatingName] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const selected = strategyRows.find((strategy) => strategy.name === selectedName) ?? strategyRows[0] ?? null;

  useEffect(() => {
    if (strategyRows.length === 0) {
      if (selectedName !== null) {
        setSelectedName(null);
      }
      return;
    }
    if (!selectedName || !strategyRows.some((strategy) => strategy.name === selectedName)) {
      setSelectedName(strategyRows[0].name);
    }
  }, [selectedName, strategyRows]);

  async function createStrategy(name: string) {
    const nextName = normalizeBacktestStrategyName(name);
    if (!nextName) {
      throw new Error("Strategy name is required");
    }
    if (strategyRows.some((strategy) => sameStrategyName(strategy.name, nextName))) {
      throw new Error("A strategy with this name already exists");
    }
    await persistBacktestStrategyNames([...savedStrategyNames, nextName]);
    setSelectedName(nextName);
  }

  async function renameStrategy(currentName: string, nextValue: string) {
    const nextName = normalizeBacktestStrategyName(nextValue);
    if (!nextName) {
      throw new Error("Strategy name is required");
    }
    if (
      !sameStrategyName(currentName, nextName) &&
      strategyRows.some((strategy) => sameStrategyName(strategy.name, nextName))
    ) {
      throw new Error("A strategy with this name already exists");
    }

    setMutatingName(currentName);
    setMutationError(null);
    try {
      await persistBacktestStrategyNames(renameSavedStrategyName(savedStrategyNames, currentName, nextName));
      await applyStrategyNameChange(currentName, nextName);
      setSelectedName(nextName);
    } finally {
      setMutatingName(null);
    }
  }

  async function deleteStrategy(strategy: StrategyGroup) {
    setMutatingName(strategy.name);
    setMutationError(null);
    try {
      await persistBacktestStrategyNames(removeSavedStrategyName(savedStrategyNames, strategy.name));
      await applyStrategyNameChange(strategy.name, "Unassigned");
      setSelectedName("Unassigned");
      setDeleteTarget(null);
    } finally {
      setMutatingName(null);
    }
  }

  async function applyStrategyNameChange(currentName: string, nextName: string) {
    const matchingSessions = sessions.filter((session) => sameStrategyName(sessionStrategyName(session), currentName));
    const matchingTrades = trades.filter((trade) =>
      sameStrategyName(tradeStrategyName(trade, sessionById.get(trade.session_id)), currentName),
    );
    for (const session of matchingSessions) {
      await updateSession(session.id, { strategy_name: nextName });
    }
    for (const trade of matchingTrades) {
      await updateTradeStrategy(trade.id, { strategy_name: nextName });
    }
  }

  function openCreateDialog() {
    setEditingName(null);
    setDialogMode("create");
    setMutationError(null);
  }

  function openEditDialog(name: string) {
    setEditingName(name);
    setDialogMode("edit");
    setMutationError(null);
  }

  function closeDialog() {
    setDialogMode(null);
    setEditingName(null);
  }

  return (
    <PageScaffold
      eyebrow="Backtest Strategies"
      title="Backtest Strategy Performance"
      description="Strategies are performance groupings for replay sessions. Playbook rule sets now live in their own Backtest Playbooks page."
      actions={
        <button className="control-button workspace-tab-active" onClick={openCreateDialog} type="button">
          <Plus size={15} />
          Create strategy
        </button>
      }
    >
      {mutationError && (
        <div className="rounded-md border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {mutationError}
        </div>
      )}
      <FeatureCard>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <CardLabel icon={Target} label={`My strategies (${strategyRows.length})`} />
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="status-pill">{sessions.length} sessions</span>
            <span className="status-pill">{trades.length} trades</span>
          </div>
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <th className="px-3 py-3 font-medium">Strategy</th>
                <th className="px-3 py-3 font-medium">Sessions</th>
                <th className="px-3 py-3 font-medium">Trades</th>
                <th className="px-3 py-3 font-medium">Average loser</th>
                <th className="px-3 py-3 font-medium">Average winner</th>
                <th className="px-3 py-3 font-medium">Total net P&L</th>
                <th className="px-3 py-3 font-medium">Win rate</th>
                <th className="px-3 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {strategyRows.map((strategy) => (
                <tr
                  className={`cursor-pointer border-t border-white/10 text-slate-300 hover:bg-white/5 ${
                    selected?.name === strategy.name ? "bg-cyan-300/10" : ""
                  }`}
                  key={strategy.name}
                  onClick={() => setSelectedName(strategy.name)}
                >
                  <td className="px-3 py-4 font-semibold text-white">{strategy.name}</td>
                  <td className="px-3 py-4">{strategy.sessions.length}</td>
                  <td className="px-3 py-4">{strategy.aggregate.totalTrades}</td>
                  <td className="px-3 py-4 text-rose-300">{formatMoney(strategy.aggregate.averageLoss, currency)}</td>
                  <td className="px-3 py-4 text-emerald-300">{formatMoney(strategy.aggregate.averageWin, currency)}</td>
                  <td className={`px-3 py-4 font-semibold ${toneForNumber(strategy.aggregate.netPnl)}`}>{formatMoney(strategy.aggregate.netPnl, currency)}</td>
                  <td className="px-3 py-4">{formatPercent(strategy.aggregate.winRate)}</td>
                  <td className="px-3 py-4">
                    <div className="flex gap-2">
                      <button
                        className="icon-button h-8 w-8"
                        disabled={mutatingName === strategy.name}
                        onClick={(event) => {
                          event.stopPropagation();
                          openEditDialog(strategy.name);
                        }}
                        title="Edit strategy"
                        type="button"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        className="icon-button h-8 w-8 border-rose-300/20 text-rose-200 hover:bg-rose-300/10 hover:text-rose-100"
                        disabled={mutatingName === strategy.name}
                        onClick={(event) => {
                          event.stopPropagation();
                          setDeleteTarget(strategy);
                          setMutationError(null);
                        }}
                        title="Delete strategy"
                        type="button"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {strategyRows.length === 0 && <EmptyState icon={Target} message="Create a strategy to start organizing backtest sessions." />}
        </div>
      </FeatureCard>
      <FeatureCard>
        {selected ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.55fr)_minmax(0,0.45fr)]">
            <div>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardLabel icon={Target} label="Strategy detail" />
                  <h3 className="mt-3 text-xl font-semibold text-white">{selected.name}</h3>
                </div>
                <div className="flex gap-2">
                  <button className="control-button h-9" disabled={mutatingName === selected.name} onClick={() => openEditDialog(selected.name)} type="button">
                    <Pencil size={14} />
                    Edit
                  </button>
                  <button
                    className="icon-button h-9 w-9 border-rose-300/20 text-rose-200 hover:bg-rose-300/10 hover:text-rose-100"
                    disabled={mutatingName === selected.name}
                    onClick={() => {
                      setDeleteTarget(selected);
                      setMutationError(null);
                    }}
                    title="Delete strategy"
                    type="button"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <p className="mt-2 text-sm text-slate-500">
                Compare session outcomes, win rate, R-multiple, and drawdown for this strategy only.
              </p>
              <div className="mt-4 grid gap-2 md:grid-cols-3">
                <CompactMetric label="Net P&L" value={formatMoney(selected.aggregate.netPnl, currency)} tone={toneForNumber(selected.aggregate.netPnl)} />
                <CompactMetric label="Win rate" value={formatPercent(selected.aggregate.winRate)} />
                <CompactMetric label="Profit factor" value={formatRatio(selected.aggregate.profitFactor)} />
              </div>
            </div>
            <div className="rounded-md border border-white/10 bg-black/20 p-3">
              <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Linked sessions</div>
              <div className="mt-3 grid gap-2">
                {selected.sessions.map((session) => (
                  <button
                    className="rounded-md bg-white/5 px-3 py-2 text-left transition hover:bg-white/10"
                    key={session.id}
                    onClick={() => onResumeSession(session.id)}
                    type="button"
                  >
                    <div className="font-semibold text-white">{session.name}</div>
                    <div className="text-xs text-slate-500">
                      {formatMarketSymbol(session.symbol)} · {session.timeframe ?? "M1"} · {session.status}
                    </div>
                  </button>
                ))}
                {selected.sessions.length === 0 && <div className="text-sm text-slate-500">No sessions linked yet.</div>}
              </div>
            </div>
          </div>
        ) : (
          <EmptyState icon={Target} message="No strategy selected." />
        )}
      </FeatureCard>
      {dialogMode && (
        <StrategyNameDialog
          initialName={dialogMode === "edit" ? editingName ?? "" : ""}
          mode={dialogMode}
          onClose={closeDialog}
          onSave={async (name) => {
            try {
              if (dialogMode === "edit" && editingName) {
                await renameStrategy(editingName, name);
              } else {
                await createStrategy(name);
              }
              closeDialog();
            } catch (error) {
              setMutationError(error instanceof Error ? error.message : "Could not save strategy");
              throw error;
            }
          }}
        />
      )}
      {deleteTarget && (
        <ModalFrame title="Delete strategy" onClose={() => setDeleteTarget(null)}>
          <div className="grid gap-4 text-sm text-slate-300">
            <p>
              Delete <span className="font-semibold text-white">{deleteTarget.name}</span>? Linked sessions and trades will stay intact and move to Unassigned.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <CompactMetric label="Sessions" value={String(deleteTarget.sessions.length)} />
              <CompactMetric label="Trades" value={String(deleteTarget.aggregate.totalTrades)} />
            </div>
            <div className="flex justify-end gap-2">
              <button className="control-button" onClick={() => setDeleteTarget(null)} type="button">
                Cancel
              </button>
              <button
                className="control-button border-rose-300/30 bg-rose-400/10 text-rose-100 hover:bg-rose-400/20"
                disabled={mutatingName === deleteTarget.name}
                onClick={() => {
                  void deleteStrategy(deleteTarget).catch((error) => {
                    setMutationError(error instanceof Error ? error.message : "Could not delete strategy");
                  });
                }}
                type="button"
              >
                <Trash2 size={15} />
                {mutatingName === deleteTarget.name ? "Deleting" : "Delete"}
              </button>
            </div>
          </div>
        </ModalFrame>
      )}
    </PageScaffold>
  );
}

function StrategyNameDialog({
  initialName,
  mode,
  onClose,
  onSave,
}: {
  initialName: string;
  mode: "create" | "edit";
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(initialName);
    setError(null);
  }, [initialName]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave(name);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not save strategy");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalFrame title={mode === "edit" ? "Edit strategy" : "Create strategy"} onClose={onClose}>
      <form className="grid gap-4" onSubmit={(event) => void handleSubmit(event)}>
        <label className="form-field">
          Strategy name
          <input
            autoFocus
            className="input-control h-10 normal-case tracking-normal"
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            placeholder="Opening range reversal"
            value={name}
          />
        </label>
        {error && (
          <div className="rounded-md border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="control-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="control-button workspace-tab-active" disabled={saving} type="submit">
            <Save size={15} />
            {saving ? "Saving" : mode === "edit" ? "Save strategy" : "Create strategy"}
          </button>
        </div>
      </form>
    </ModalFrame>
  );
}

type PlaybookUsageSession = {
  id: number;
  name: string;
  playbook_id: number | null;
  strategy_name: string | null;
};

function BacktestPlaybooksPage({
  currency,
  onCreatePlaybook,
  playbooks,
  sessions,
  trades,
}: SharedPageProps) {
  return (
    <PageScaffold
      eyebrow="Backtest Playbooks"
      title="Backtest Rule Library"
      description="Playbooks are rule sets: entry conditions, exit rules, and risk constraints. Strategy performance stays on the Strategies page."
    >
      <PlaybookRuleLibrary
        contextLabel="Backtesting"
        createLabel="Create backtest playbook"
        emptyMessage="Create a playbook here, then attach it when creating a backtesting session or placing an order."
        onCreatePlaybook={onCreatePlaybook}
        playbooks={playbooks}
        currency={currency}
        sessions={sessions}
        trades={trades}
      />
    </PageScaffold>
  );
}

function PlaybookRuleLibrary({
  contextLabel,
  createLabel,
  currency = "USD",
  emptyMessage,
  onCreatePlaybook,
  playbooks,
  sessions,
  trades,
}: {
  contextLabel: "Backtesting" | "Journal";
  createLabel: string;
  currency?: string;
  emptyMessage: string;
  onCreatePlaybook: (payload: PlaybookPayload) => Promise<Playbook> | Playbook;
  playbooks: Playbook[];
  sessions: PlaybookUsageSession[];
  trades: Trade[];
}) {
  const [selectedId, setSelectedId] = useState<number | null>(playbooks[0]?.id ?? null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [entryRules, setEntryRules] = useState("");
  const [exitRules, setExitRules] = useState("");
  const [riskRules, setRiskRules] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (playbooks.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId == null || !playbooks.some((playbook) => playbook.id === selectedId)) {
      setSelectedId(playbooks[0].id);
    }
  }, [playbooks, selectedId]);

  const selected = playbooks.find((playbook) => playbook.id === selectedId) ?? playbooks[0] ?? null;
  const selectedUsage = selected
    ? computePlaybookUsage(selected, sessions, trades)
    : null;

  async function submitPlaybook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      return;
    }
    setSubmitting(true);
    try {
      const created = await Promise.resolve(
        onCreatePlaybook({
          description: description.trim() || null,
          name: name.trim(),
          rules: composePlaybookRules(entryRules, exitRules, riskRules),
        }),
      );
      setSelectedId(created.id);
      setName("");
      setDescription("");
      setEntryRules("");
      setExitRules("");
      setRiskRules("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <div className="grid content-start gap-4">
        <FeatureCard>
          <CardLabel icon={BookOpen} label={`${contextLabel} rule set`} />
          <p className="mt-3 text-sm leading-6 text-slate-400">
            A strategy groups performance. A playbook stores the actual rules:
            what must be true before entry, where exits belong, and how risk is controlled.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <CompactMetric label="Playbooks" value={String(playbooks.length)} />
            <CompactMetric label="Linked sessions" value={String(sessions.filter((session) => session.playbook_id != null).length)} />
            <CompactMetric label="Linked trades" value={String(trades.filter((trade) => trade.playbook_id != null).length)} />
          </div>
        </FeatureCard>

        <FeatureCard>
          <CardLabel icon={Plus} label={createLabel} />
          <form className="mt-4 grid gap-3" onSubmit={(event) => void submitPlaybook(event)}>
            <label className="form-field">
              Playbook name
              <input
                className="input-control h-10 normal-case tracking-normal"
                onChange={(event) => setName(event.target.value)}
                placeholder="Opening range rules"
                value={name}
              />
            </label>
            <label className="form-field">
              Description
              <input
                className="input-control h-10 normal-case tracking-normal"
                onChange={(event) => setDescription(event.target.value)}
                placeholder="One-line setup context"
                value={description}
              />
            </label>
            <PlaybookRuleTextArea label="Entry conditions" onChange={setEntryRules} value={entryRules} />
            <PlaybookRuleTextArea label="Exit conditions" onChange={setExitRules} value={exitRules} />
            <PlaybookRuleTextArea label="Risk conditions" onChange={setRiskRules} value={riskRules} />
            <button className="control-button workspace-tab-active justify-center" disabled={submitting || !name.trim()} type="submit">
              <Plus size={15} />
              {submitting ? "Saving..." : "Save playbook"}
            </button>
          </form>
        </FeatureCard>
      </div>

      <FeatureCard>
        <div className="mb-4 flex items-center justify-between gap-3">
          <CardLabel icon={BookOpen} label={`${contextLabel} playbooks`} />
          <span className="status-pill">{playbooks.length} rule sets</span>
        </div>
        {playbooks.length === 0 ? (
          <EmptyState icon={BookOpen} message={emptyMessage} />
        ) : (
          <div className="grid gap-4 2xl:grid-cols-[minmax(260px,0.42fr)_minmax(0,1fr)]">
            <div className="grid max-h-[620px] content-start gap-2 overflow-auto pr-1">
              {playbooks.map((playbook) => {
                const usage = computePlaybookUsage(playbook, sessions, trades);
                const active = selected?.id === playbook.id;
                return (
                  <button
                    className={`rounded-md border px-3 py-3 text-left transition ${
                      active
                        ? "border-cyan-300/35 bg-cyan-300/10"
                        : "border-white/10 bg-black/20 hover:border-cyan-300/25 hover:bg-cyan-300/5"
                    }`}
                    key={playbook.id}
                    onClick={() => setSelectedId(playbook.id)}
                    type="button"
                  >
                    <div className="truncate font-semibold text-white">{playbook.name}</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                      {playbook.description || "No description saved."}
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-1.5">
                      <MiniMetric label="Sessions" value={String(usage.sessions.length)} />
                      <MiniMetric label="Trades" value={String(usage.aggregate.totalTrades)} />
                      <MiniMetric label="Win" value={formatPercent(usage.aggregate.winRate)} />
                    </div>
                  </button>
                );
              })}
            </div>

            {selected && selectedUsage ? (
              <div className="min-w-0 rounded-md border border-white/10 bg-black/20 p-4">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Rule details</div>
                    <h3 className="mt-2 truncate text-2xl font-semibold text-white">{selected.name}</h3>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                      {selected.description || "No description saved."}
                    </p>
                  </div>
                  <span className="status-pill">{shortDate(selected.created_at)}</span>
                </div>

                <div className="mt-4 grid gap-2 md:grid-cols-4">
                  <CompactMetric label="Net P&L" value={formatMoney(selectedUsage.aggregate.netPnl, currency)} tone={toneForNumber(selectedUsage.aggregate.netPnl)} />
                  <CompactMetric label="Win rate" value={formatPercent(selectedUsage.aggregate.winRate)} />
                  <CompactMetric label="Avg R" value={formatOptionalNumber(selectedUsage.aggregate.averageR)} />
                  <CompactMetric label="Profit factor" value={formatRatio(selectedUsage.aggregate.profitFactor)} />
                </div>

                <div className="mt-4 rounded-md border border-white/10 bg-[#080c11] p-4">
                  <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Rules</div>
                  <pre className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">
                    {selected.rules || "No written rules saved yet."}
                  </pre>
                </div>

                <div className="mt-4">
                  <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Linked sessions</div>
                  <div className="mt-3 grid gap-2">
                    {selectedUsage.sessions.map((session) => (
                      <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2" key={session.id}>
                        <div className="font-semibold text-white">{session.name}</div>
                        <div className="text-xs text-slate-500">{session.strategy_name || "Unassigned strategy"}</div>
                      </div>
                    ))}
                    {selectedUsage.sessions.length === 0 && (
                      <div className="rounded-md border border-dashed border-white/10 px-3 py-4 text-sm text-slate-500">
                        This playbook has not been attached to a session yet.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState icon={BookOpen} message="Select a playbook to inspect its rules and linked results." />
            )}
          </div>
        )}
      </FeatureCard>
    </div>
  );
}

function PlaybookRuleTextArea({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="form-field">
      {label}
      <textarea
        className="input-control min-h-20 py-3 normal-case tracking-normal"
        onChange={(event) => onChange(event.target.value)}
        placeholder="Write one condition per line"
        value={value}
      />
    </label>
  );
}

function SettingsPage({
  datasets,
  onRefreshDatasets,
  onGetDatasetRefreshStatus,
  onUpdateDatasetAsset,
  onUpdateDatasetSettings,
}: SharedPageProps) {
  const sections = [
    "Profile",
    "Security",
    "Subscription",
    "Accounts",
    "Data imports",
    "PT / SL settings",
    "Commissions & fees",
    "Trade settings",
    "Global settings",
    "Tags management",
    "Log history",
  ];
  const [active, setActive] = useState("Data imports");

  return (
    <PageScaffold
      eyebrow="Backtest Settings"
      title="Backtest Settings"
      description="Data import, replay defaults, risk, commissions, tags, and local workspace settings for backtesting."
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
          {active === "Data imports" ? (
            <BacktestDataSettings
              datasets={datasets}
              onRefreshDatasets={onRefreshDatasets}
              onGetDatasetRefreshStatus={onGetDatasetRefreshStatus}
              onUpdateDatasetAsset={onUpdateDatasetAsset}
              onUpdateDatasetSettings={onUpdateDatasetSettings}
            />
          ) : (
            <BacktestGeneralSettings />
          )}
        </FeatureCard>
      </div>
    </PageScaffold>
  );
}

function BacktestGeneralSettings() {
  const [confirmOrderLineModifications, setConfirmOrderLineModifications] =
    useState(loadOrderLineModificationConfirmation);
  const [notebookTemplate, setNotebookTemplate] = useState(() =>
    normalizeNotebookTemplate(getCachedAppStorageItem<unknown>(NOTEBOOK_TEMPLATE_STORAGE_KEY, DEFAULT_NOTEBOOK_TEMPLATE)),
  );
  const [templateDraft, setTemplateDraft] = useState(notebookTemplate);
  const [templateStatus, setTemplateStatus] = useState<string | null>(null);

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
    void loadAppStorageItem<unknown>(NOTEBOOK_TEMPLATE_STORAGE_KEY, DEFAULT_NOTEBOOK_TEMPLATE).then((value) => {
      if (!active) {
        return;
      }
      const nextTemplate = normalizeNotebookTemplate(value);
      setNotebookTemplate(nextTemplate);
      setTemplateDraft(nextTemplate);
    });
    const unsubscribe = subscribeAppStorageItem<unknown>(
      NOTEBOOK_TEMPLATE_STORAGE_KEY,
      (value) => {
        const nextTemplate = normalizeNotebookTemplate(value);
        setNotebookTemplate(nextTemplate);
        setTemplateDraft((current) => (current === notebookTemplate ? nextTemplate : current));
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [notebookTemplate]);

  function updateConfirmation(enabled: boolean) {
    setConfirmOrderLineModifications(enabled);
    void saveOrderLineModificationConfirmation(enabled);
  }

  async function saveNotebookTemplate() {
    const nextTemplate = normalizeNotebookTemplate(templateDraft);
    setTemplateDraft(nextTemplate);
    setNotebookTemplate(nextTemplate);
    await saveAppStorageItem(NOTEBOOK_TEMPLATE_STORAGE_KEY, nextTemplate);
    setTemplateStatus("Template saved");
  }

  async function resetNotebookTemplate() {
    setTemplateDraft(DEFAULT_NOTEBOOK_TEMPLATE);
    setNotebookTemplate(DEFAULT_NOTEBOOK_TEMPLATE);
    await saveAppStorageItem(NOTEBOOK_TEMPLATE_STORAGE_KEY, DEFAULT_NOTEBOOK_TEMPLATE);
    setTemplateStatus("Template reset");
  }

  return (
    <div className="mt-5 grid gap-4 md:grid-cols-2">
      <label className="md:col-span-2 flex min-w-0 items-center justify-between gap-4 rounded-md border border-white/10 bg-black/20 px-3 py-3">
        <span className="min-w-0">
          <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Order line modifications
          </span>
          <span className="mt-1 block text-sm font-semibold text-white">
            Confirm drag changes before applying
          </span>
        </span>
        <input
          aria-label="Confirm order line modifications"
          checked={confirmOrderLineModifications}
          className="h-5 w-5 accent-cyan-300"
          onChange={(event) => updateConfirmation(event.target.checked)}
          type="checkbox"
        />
      </label>
      <section className="md:col-span-2 rounded-md border border-white/10 bg-black/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Notebook note template
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {"{symbol} {date} {side} {quantity} {entry} {exit} {pnl} {r} {strategy}"}
            </div>
          </div>
          {templateStatus && <span className="status-pill">{templateStatus}</span>}
        </div>
        <textarea
          className="input-control mt-3 min-h-48 py-3 normal-case tracking-normal"
          onChange={(event) => {
            setTemplateDraft(event.target.value);
            setTemplateStatus(null);
          }}
          value={templateDraft}
        />
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button className="control-button" onClick={() => void resetNotebookTemplate()} type="button">
            <RefreshCw size={15} />
            Reset
          </button>
          <button
            className="control-button border-cyan-300/30 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20"
            onClick={() => void saveNotebookTemplate()}
            type="button"
          >
            <Save size={15} />
            Save template
          </button>
        </div>
      </section>
      <label className="form-field">
        Default risk %
        <input className="input-control h-10 normal-case tracking-normal" defaultValue="1" type="number" />
      </label>
      <label className="form-field">
        Default currency
        <ThemedSelect
          className="h-10"
          defaultValue="USD"
          options={[
            { label: "USD", value: "USD" },
            { label: "INR", value: "INR" },
          ]}
        />
      </label>
      <label className="form-field">
        Commission mode
        <ThemedSelect
          className="h-10"
          defaultValue="Flat"
          options={[
            { label: "Flat", value: "Flat" },
            { label: "Percent of position", value: "Percent of position" },
          ]}
        />
      </label>
      <label className="form-field">
        Auto-save interval
        <ThemedSelect
          className="h-10"
          defaultValue="Every 5 candles"
          options={[
            { label: "Every candle", value: "Every candle" },
            { label: "Every 5 candles", value: "Every 5 candles" },
            { label: "Manual only", value: "Manual only" },
          ]}
        />
      </label>
    </div>
  );
}

function BacktestDataSettings({
  datasets,
  onRefreshDatasets,
  onGetDatasetRefreshStatus,
  onUpdateDatasetAsset,
  onUpdateDatasetSettings,
}: {
  datasets: DatasetCatalog | null;
  onRefreshDatasets: () => Promise<DatasetRefreshResponse>;
  onGetDatasetRefreshStatus: () => Promise<DatasetRefreshStatus>;
  onUpdateDatasetAsset: (
    assetId: string,
    payload: { currency?: string | null; timezone?: string | null; pnl_multiplier?: number | null },
  ) => Promise<void>;
  onUpdateDatasetSettings: (payload: { root_path: string }) => Promise<void>;
}) {
  const [rootPath, setRootPath] = useState(datasets?.root ?? "");
  const [assetDrafts, setAssetDrafts] = useState<Record<string, { currency: string; pnlMultiplier: string; timezone: string }>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [savingRoot, setSavingRoot] = useState(false);
  const [savingAssetId, setSavingAssetId] = useState<string | null>(null);

  useEffect(() => {
    setRootPath(datasets?.root ?? "");
  }, [datasets?.root]);

  useEffect(() => {
    setAssetDrafts((current) => {
      const next: Record<string, { currency: string; pnlMultiplier: string; timezone: string }> = {};
      for (const instrument of datasets?.instruments ?? []) {
        next[instrument.id] = current[instrument.id] ?? {
          currency: instrument.currency ?? "USD",
          pnlMultiplier: String(instrument.pnl_multiplier ?? 1),
          timezone: instrument.timezone ?? "UTC",
        };
      }
      return next;
    });
  }, [datasets?.instruments]);

  async function saveRoot() {
    const trimmed = rootPath.trim();
    if (!trimmed) {
      setStatus("Root path is required");
      return;
    }
    setSavingRoot(true);
    try {
      await onUpdateDatasetSettings({ root_path: trimmed });
      setStatus("Dataset root saved");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save dataset root");
    } finally {
      setSavingRoot(false);
    }
  }

  async function refreshData() {
    const trimmed = rootPath.trim();
    setRefreshing(true);
    try {
      if (trimmed && trimmed !== datasets?.root) {
        await onUpdateDatasetSettings({ root_path: trimmed });
      }
      const response = await onRefreshDatasets();
      if (response.status?.running) {
        setStatus(formatDatasetRefreshStatus(response.status));
        await pollDatasetRefreshStatus(onGetDatasetRefreshStatus, setStatus);
      } else {
        setStatus(formatDatasetRefreshSummary(response.summary));
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not refresh datasets");
    } finally {
      setRefreshing(false);
    }
  }

  function updateDraft(assetId: string, field: "currency" | "pnlMultiplier" | "timezone", value: string) {
    setAssetDrafts((current) => ({
      ...current,
      [assetId]: {
        currency: current[assetId]?.currency ?? "USD",
        pnlMultiplier: current[assetId]?.pnlMultiplier ?? "1",
        timezone: current[assetId]?.timezone ?? "UTC",
        [field]: value,
      },
    }));
  }

  async function saveAsset(assetId: string, symbol: string) {
    const draft = assetDrafts[assetId];
    if (!draft) {
      return;
    }
    const pnlMultiplier = Number(draft.pnlMultiplier);
    if (!Number.isFinite(pnlMultiplier) || pnlMultiplier <= 0) {
      setStatus("Calibration must be greater than 0");
      return;
    }
    setSavingAssetId(assetId);
    try {
      await onUpdateDatasetAsset(assetId, {
        currency: draft.currency.trim() || null,
        pnl_multiplier: pnlMultiplier,
        timezone: draft.timezone.trim() || null,
      });
      setStatus(`${formatMarketSymbol(symbol)} metadata saved`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save asset metadata");
    } finally {
      setSavingAssetId(null);
    }
  }

  return (
    <div className="mt-5 grid gap-4">
      <div className="rounded-md border border-white/10 bg-black/20 p-3">
        <div className="flex min-w-0 flex-wrap items-end gap-3">
          <label className="form-field min-w-0 flex-1">
            <span>Datasets root folder</span>
            <input
              className="input-control h-10 normal-case tracking-normal"
              onChange={(event) => setRootPath(event.target.value)}
              placeholder="/absolute/path/to/datasets"
              value={rootPath}
            />
          </label>
          <button
            className="control-button h-10 border-cyan-300/30 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20"
            disabled={savingRoot}
            onClick={saveRoot}
            type="button"
          >
            {savingRoot ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
            Save Root
          </button>
          <button
            className="control-button h-10 border-emerald-300/30 bg-emerald-300/10 text-emerald-100 hover:bg-emerald-300/20"
            disabled={refreshing}
            onClick={refreshData}
            type="button"
          >
            <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
            Refresh Data
          </button>
        </div>
        <div className="mt-3 flex min-w-0 items-center gap-2 text-xs text-slate-500">
          <FolderPlus size={14} />
          <span className="truncate">Place asset folders directly under this root, with timeframe CSV files inside each folder.</span>
        </div>
        {status && <div className="mt-3 text-xs font-semibold text-cyan-100">{status}</div>}
      </div>

      <div className="rounded-md border border-white/10 bg-black/20 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
            <Database size={14} />
            Available assets
          </div>
          <span className="status-pill">{datasets?.instruments.length ?? 0} assets</span>
        </div>
        <div className="mt-3 grid gap-3">
          {(datasets?.instruments ?? []).map((instrument) => {
            const draft = assetDrafts[instrument.id] ?? {
              currency: instrument.currency ?? "USD",
              pnlMultiplier: String(instrument.pnl_multiplier ?? 1),
              timezone: instrument.timezone ?? "UTC",
            };
            return (
              <div className="rounded-md border border-white/10 bg-white/5 p-3" key={instrument.id}>
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="session-instrument-badge">{symbolBadge(instrument.symbol)}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-white">
                        {formatMarketSymbol(instrument.symbol)}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {instrument.folder_path ?? instrument.name}
                      </span>
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    {instrument.timeframes.map((timeframe) => (
                      <span className="rounded border border-white/10 bg-black/20 px-2 py-1" key={timeframe.csv_path}>
                        {formatDatasetTimeframeLabel(timeframe)}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,160px)_minmax(0,1fr)_minmax(0,170px)_auto]">
                  <label className="form-field">
                    <span>Currency</span>
                    <ThemedSelect
                      className="h-10"
                      onChange={(value) => updateDraft(instrument.id, "currency", value)}
                      options={selectOptionsWithValue(CURRENCY_OPTIONS, draft.currency)}
                      portal
                      value={draft.currency}
                    />
                  </label>
                  <label className="form-field">
                    <span>Timestamp Timezone</span>
                    <ThemedSelect
                      className="h-10"
                      menuClassName="max-w-[360px]"
                      onChange={(value) => updateDraft(instrument.id, "timezone", value)}
                      options={selectOptionsWithValue(
                        TIMEZONE_OPTIONS,
                        draft.timezone,
                        timezoneOption,
                      )}
                      portal
                      value={draft.timezone}
                    />
                  </label>
                  <label className="form-field">
                    <span>P&L Calibration</span>
                    <input
                      className="input-control h-10"
                      min="0.000001"
                      onChange={(event) => updateDraft(instrument.id, "pnlMultiplier", event.target.value)}
                      step="0.000001"
                      type="number"
                      value={draft.pnlMultiplier}
                    />
                  </label>
                  <button
                    className="control-button h-10 self-end"
                    disabled={savingAssetId === instrument.id}
                    onClick={() => saveAsset(instrument.id, instrument.symbol)}
                    type="button"
                  >
                    {savingAssetId === instrument.id ? <RefreshCw size={15} className="animate-spin" /> : <Globe2 size={15} />}
                    Save Asset
                  </button>
                </div>
              </div>
            );
          })}
          {(datasets?.instruments.length ?? 0) === 0 && (
            <div className="rounded-md border border-white/10 bg-white/5 px-3 py-4 text-sm text-slate-500">
              No assets found yet. Set the root folder and refresh data.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatDatasetTimeframeLabel(timeframe: DatasetTimeframe) {
  const rows = timeframe.rows > 0 ? timeframe.rows.toLocaleString() : "Rows on import";
  return `${timeframe.timeframe} · ${rows} · CSV direct`;
}

function selectOptionsWithValue(
  options: Array<{ label: string; sublabel?: string; value: string }>,
  value: string,
  makeMissingOption: (value: string) => { label: string; sublabel?: string; value: string } = (
    nextValue,
  ) => ({ label: nextValue, value: nextValue }),
) {
  if (!value || options.some((option) => option.value === value)) {
    return options;
  }
  return [makeMissingOption(value), ...options];
}

function timezoneOption(timezone: string) {
  return {
    label: `${formatTimezoneOffset(timezone)} · ${formatTimezoneDisplayName(timezone)}`,
    sublabel: timezone,
    value: timezone,
  };
}

function formatTimezoneOffset(timezone: string, date = new Date()) {
  const offsetMinutes = timezoneOffsetMinutes(timezone, date);
  if (offsetMinutes == null) {
    return "UTC";
  }
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  return minutes === 0
    ? `UTC${sign}${hours}`
    : `UTC${sign}${hours}:${String(minutes).padStart(2, "0")}`;
}

function formatTimezoneDisplayName(timezone: string) {
  const parts = timezone.split("/");
  return (parts.at(-1) ?? timezone).replace(/_/g, " ");
}

function timezoneOffsetMinutes(timezone: string, date: Date) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      second: "2-digit",
      timeZone: timezone,
      year: "numeric",
    }).formatToParts(date);
    const valueByType = new Map(parts.map((part) => [part.type, part.value]));
    const asUtc = Date.UTC(
      Number(valueByType.get("year")),
      Number(valueByType.get("month")) - 1,
      Number(valueByType.get("day")),
      Number(valueByType.get("hour")),
      Number(valueByType.get("minute")),
      Number(valueByType.get("second")),
    );
    if (!Number.isFinite(asUtc)) {
      return null;
    }
    return Math.round((asUtc - date.getTime()) / 60000);
  } catch {
    return null;
  }
}

function formatDatasetRefreshSummary(summary: DatasetRefreshResponse["summary"]) {
  return `${summary.assets} assets, ${summary.timeframes} timeframe CSVs indexed`;
}

function formatDatasetRefreshStatus(status: DatasetRefreshStatus) {
  if (status.error) {
    return status.error;
  }
  if (!status.running) {
    return formatDatasetRefreshSummary(status.summary);
  }
  const current = status.current ? ` · ${status.current}` : "";
  return `Refresh running${current} · ${status.summary.assets} assets indexed`;
}

async function pollDatasetRefreshStatus(
  getStatus: () => Promise<DatasetRefreshStatus>,
  setStatus: (value: string) => void,
) {
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const status = await getStatus();
    setStatus(formatDatasetRefreshStatus(status));
    if (!status.running) {
      return;
    }
  }
}

function DashboardFilters({ onClose }: { onClose: () => void }) {
  const groups = [
    ["General", "Side", "Symbol", "Status", "Trade rating", "Exit price", "Entry price", "R-Multiple", "Position size", "Quantity"],
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

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded bg-black/30 px-2 py-1">
      <div className="truncate text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600">{label}</div>
      <div className="mt-0.5 truncate text-xs font-semibold tabular-nums text-slate-200">{value}</div>
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

function NotebookFolder({
  active = false,
  label,
  onClick,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`rounded-md px-3 py-2 text-left text-sm font-semibold ${
        active ? "bg-cyan-300/10 text-cyan-100" : "text-slate-400 hover:bg-white/5 hover:text-white"
      }`}
      onClick={onClick}
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
        {["Template", "Generate draft", "B", "I", "U", "S", "Bullets", "Numbers", "Link", "Color", "Align"].map((item) => (
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

function StatsGrid({ aggregate, currency }: { aggregate: Aggregate; currency: string }) {
  const rows = [
    ["Total P&L", formatMoney(aggregate.netPnl, currency), toneForNumber(aggregate.netPnl)],
    ["Open trades", "0", "text-slate-100"],
    ["Average winning trade", formatMoney(aggregate.averageWin, currency), "text-emerald-300"],
    ["Average losing trade", formatMoney(aggregate.averageLoss, currency), "text-rose-300"],
    ["Total number of trades", String(aggregate.totalTrades), "text-slate-100"],
    ["Number of winning trades", String(aggregate.wins), "text-emerald-300"],
    ["Number of losing trades", String(aggregate.losses), "text-rose-300"],
    ["Number of break even trades", String(aggregate.breakeven), "text-slate-100"],
    ["Max drawdown", formatMoney(aggregate.maxDrawdown, currency), "text-rose-300"],
    ["Profit factor", formatRatio(aggregate.profitFactor), "text-amber-100"],
    ["Average R", formatOptionalNumber(aggregate.averageR), toneForNumber(aggregate.averageR)],
    ["Average hold", formatMinutes(aggregate.averageHoldMinutes), "text-slate-100"],
    ["Total commissions", formatMoney(aggregate.totalCommissions, currency), "text-slate-100"],
    ["Largest win", formatMoney(aggregate.largestWin ?? 0, currency), "text-emerald-300"],
    ["Largest loss", formatMoney(aggregate.largestLoss ?? 0, currency), "text-rose-300"],
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
  currency = "USD",
  leftTitle,
  rightTitle,
  rows,
}: {
  currency?: string;
  leftTitle: string;
  rightTitle: string;
  rows: Array<{ aggregate: Aggregate; label: string }>;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-4">
        <InsightMetric currency={currency} title="Best performing" row={bestRow(rows)} />
        <InsightMetric currency={currency} title="Least performing" row={worstRow(rows)} />
        <InsightMetric currency={currency} title="Most active" row={mostActiveRow(rows)} />
        <InsightMetric currency={currency} title="Best win rate" row={bestWinRateRow(rows)} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <FeatureCard>
          <CardLabel icon={LineChart} label={leftTitle} />
          <BarBreakdown
            currency={currency}
            rows={rows.map((row) => ({ label: row.label, value: row.aggregate.netPnl }))}
          />
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
  currency = "USD",
  row,
  title,
}: {
  currency?: string;
  row: { aggregate: Aggregate; label: string } | null;
  title: string;
}) {
  return (
    <FeatureCard>
      <div className="text-xs uppercase tracking-[0.16em] text-slate-500">{title}</div>
      <div className="mt-2 truncate text-lg font-semibold text-white">{row?.label ?? "-"}</div>
      <div className={`mt-1 text-sm font-semibold ${toneForNumber(row?.aggregate.netPnl)}`}>
        {formatMoney(row?.aggregate.netPnl ?? 0, currency)}
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

function CalendarHeatmap({
  compact = false,
  currency = "USD",
  days,
}: {
  compact?: boolean;
  currency?: string;
  days: DayGroup[];
}) {
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
              <div className="mt-1 truncate font-semibold">{formatMoney(cell.pnl, currency)}</div>
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
  currency = "USD",
  percent = false,
  rows,
}: {
  currency?: string;
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
            {percent ? `${row.value.toFixed(1)}%` : formatMoney(row.value, currency)}
          </span>
        </div>
      ))}
      {rows.length === 0 && <EmptyState icon={BarChart3} message="No breakdown data yet." />}
    </div>
  );
}

function CrossAnalysis({
  currency = "USD",
  rows,
  sessionById,
  trades,
}: {
  currency?: string;
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
                    {formatMoney(pnl, currency)}
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
  return <span className="grid h-5 w-5 place-items-center rounded bg-cyan-300/15 text-[10px] text-cyan-100">EL</span>;
}

function useBacktestStrategyNames() {
  const [names, setNames] = useState<string[]>(() =>
    normalizeBacktestStrategyNames(
      getCachedAppStorageItem<unknown>(BACKTEST_STRATEGIES_STORAGE_KEY, []),
    ),
  );

  useEffect(() => {
    let active = true;
    void loadAppStorageItem<unknown>(BACKTEST_STRATEGIES_STORAGE_KEY, []).then((value) => {
      if (active) {
        setNames(normalizeBacktestStrategyNames(value));
      }
    });
    const unsubscribe = subscribeAppStorageItem<unknown>(
      BACKTEST_STRATEGIES_STORAGE_KEY,
      (value) => setNames(normalizeBacktestStrategyNames(value)),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return names;
}

async function persistBacktestStrategyNames(names: string[]) {
  const nextNames = normalizeBacktestStrategyNames(names);
  await saveAppStorageItem(BACKTEST_STRATEGIES_STORAGE_KEY, nextNames);
  return nextNames;
}

function normalizeBacktestStrategyNames(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  const names: string[] = [];
  for (const item of value) {
    const name = normalizeBacktestStrategyName(String(item ?? ""));
    if (!name || names.some((current) => sameStrategyName(current, name))) {
      continue;
    }
    names.push(name);
  }
  return names.sort((left, right) => left.localeCompare(right));
}

function normalizeBacktestStrategyName(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 120);
}

function renameSavedStrategyName(names: string[], currentName: string, nextName: string) {
  const nextNames = names
    .filter((name) => !sameStrategyName(name, currentName) && !sameStrategyName(name, nextName));
  nextNames.push(nextName);
  return nextNames;
}

function removeSavedStrategyName(names: string[], currentName: string) {
  return names.filter((name) => !sameStrategyName(name, currentName));
}

function sameStrategyName(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function mergeStrategyGroups(strategies: StrategyGroup[], savedNames: string[]): StrategyGroup[] {
  const rows = strategies.slice();
  for (const name of savedNames) {
    if (rows.some((strategy) => sameStrategyName(strategy.name, name))) {
      continue;
    }
    rows.push({
      aggregate: aggregateTrades([]),
      name,
      sessions: [],
      trades: [],
    });
  }
  return rows.sort((left, right) => {
    const leftHasActivity = left.sessions.length > 0 || left.aggregate.totalTrades > 0;
    const rightHasActivity = right.sessions.length > 0 || right.aggregate.totalTrades > 0;
    if (leftHasActivity !== rightHasActivity) {
      return leftHasActivity ? -1 : 1;
    }
    if (leftHasActivity && left.aggregate.netPnl !== right.aggregate.netPnl) {
      return right.aggregate.netPnl - left.aggregate.netPnl;
    }
    return left.name.localeCompare(right.name);
  });
}

function buildStrategySelectOptions(strategies: StrategyGroup[]) {
  const options: Array<{ label: string; sublabel?: string; value: string }> = [
    { label: "Unassigned", sublabel: "No strategy", value: "Unassigned" },
  ];
  for (const strategy of strategies) {
    if (options.some((option) => sameStrategyName(option.value, strategy.name))) {
      continue;
    }
    const sessionLabel = `${strategy.sessions.length} session${strategy.sessions.length === 1 ? "" : "s"}`;
    const tradeLabel = `${strategy.aggregate.totalTrades} trade${strategy.aggregate.totalTrades === 1 ? "" : "s"}`;
    options.push({
      label: strategy.name,
      sublabel: `${sessionLabel} · ${tradeLabel}`,
      value: strategy.name,
    });
  }
  return options;
}

function uniqueStrings(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right));
}

function buildTradeNoteTagOptions(trades: Trade[]) {
  return uniqueStrings(trades.flatMap((trade) => tradeNoteTags(trade)));
}

function tradeHasNoteTag(trade: Trade, tag: string) {
  const target = tag.trim().toLowerCase();
  if (!target) {
    return true;
  }
  return tradeNoteTags(trade).some((tradeTag) => tradeTag.trim().toLowerCase() === target);
}

function tradeNoteTags(trade: Trade) {
  return mergeTags(trade.mistake_tags, extractInlineNoteTags(trade.notes));
}

function extractInlineNoteTags(notes: string | null | undefined) {
  const matches = richTextToPlainText(notes).match(/#[A-Za-z0-9][A-Za-z0-9_-]*/g);
  return matches?.map((tag) => tag.slice(1)) ?? [];
}

function buildTradeSessionOptions(
  trades: Trade[],
  sessionById: Map<number, BacktestSession>,
) {
  const options = new Map<string, { label: string; sublabel?: string; value: string }>();
  for (const trade of trades) {
    const value = String(trade.session_id);
    if (options.has(value)) {
      continue;
    }
    const session = sessionById.get(trade.session_id);
    options.set(value, {
      label: session?.name?.trim() || `Session #${trade.session_id}`,
      sublabel: tradeSessionDetail(trade, session),
      value,
    });
  }
  return [
    { label: "All sessions", value: "ALL" },
    ...Array.from(options.values()).sort((left, right) => left.label.localeCompare(right.label)),
  ];
}

function tradeSessionDetail(trade: Trade, session?: BacktestSession) {
  if (!session) {
    return tradeInstrumentLabel(trade);
  }
  return [
    tradeInstrumentLabel(trade, session),
    session.timeframe,
    session.start_at ? shortDate(session.start_at) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function buildTradeInstrumentOptions(
  trades: Trade[],
  sessionById: Map<number, BacktestSession>,
) {
  const options = new Map<string, { label: string; sublabel?: string; value: string }>();
  for (const trade of trades) {
    const session = sessionById.get(trade.session_id);
    const value = tradeInstrumentFilterValue(trade, session);
    if (options.has(value)) {
      continue;
    }
    options.set(value, {
      label: tradeInstrumentLabel(trade, session),
      sublabel: tradeInstrumentDetail(session),
      value,
    });
  }
  return [
    { label: "All instruments", value: "ALL" },
    ...Array.from(options.values()).sort((left, right) => left.label.localeCompare(right.label)),
  ];
}

function buildTradeLogContext(
  trade: Trade,
  sessionById: Map<number, BacktestSession>,
  datasets: DatasetCatalog | null,
) {
  const session = sessionById.get(trade.session_id);
  return {
    currency: currencyForSession(session, datasets),
    instrument: tradeInstrumentLabel(trade, session),
    instrumentDetail: tradeInstrumentDetail(session),
    strategy: tradeStrategyName(trade, session),
  };
}

function tradeInstrumentFilterValue(trade: Trade, session?: BacktestSession) {
  return session?.instrument || session?.symbol || `session-${trade.session_id}`;
}

function tradeInstrumentLabel(trade: Trade, session?: BacktestSession) {
  const label = session?.instrument || session?.symbol;
  return label ? formatMarketSymbol(label) : `Session #${trade.session_id}`;
}

function tradeInstrumentDetail(session?: BacktestSession) {
  if (!session) {
    return undefined;
  }
  return [formatMarketSymbol(session.symbol), session.timeframe ?? null, session.name]
    .filter(Boolean)
    .join(" · ");
}

function tradeMatchesLogSearch(
  trade: Trade,
  session: BacktestSession | undefined,
  query: string,
  strategyName: string,
) {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  const haystack = [
    trade.id,
    trade.side,
    trade.status,
    trade.entry_time,
    trade.exit_time,
    trade.entry_price,
    trade.exit_price,
    trade.realized_pnl,
    trade.r_multiple,
    strategyName,
    session?.name,
    session?.symbol,
    session?.instrument,
    session?.timeframe,
    ...trade.mistake_tags,
    richTextToPlainText(trade.notes),
  ]
    .filter((value) => value != null && value !== "")
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

function exportTradeLogCsv(
  trades: Trade[],
  sessionById: Map<number, BacktestSession>,
  datasets: DatasetCatalog | null,
) {
  const headers = [
    "Trade ID",
    "Instrument",
    "Symbol",
    "Timeframe",
    "Session",
    "Side",
    "Status",
    "Entry Time",
    "Exit Time",
    "Entry Price",
    "Exit Price",
    "Quantity",
    "Remaining Quantity",
    "Stop Loss",
    "Take Profit",
    "Currency",
    "Realized P&L",
    "R Multiple",
    "Strategy",
    "Tags",
    "Notes",
  ];
  const rows = trades.map((trade) => {
    const session = sessionById.get(trade.session_id);
    return [
      trade.id,
      session?.instrument ?? "",
      session?.symbol ?? "",
      session?.timeframe ?? "",
      session?.name ?? `Session #${trade.session_id}`,
      trade.side,
      trade.status,
      trade.entry_time,
      trade.exit_time ?? "",
      trade.entry_price,
      trade.exit_price ?? "",
      trade.quantity,
      trade.remaining_quantity,
      trade.stop_loss ?? "",
      trade.take_profit ?? "",
      currencyForSession(session, datasets),
      trade.realized_pnl,
      trade.r_multiple ?? "",
      tradeStrategyName(trade, session),
      trade.mistake_tags.join("; "),
      richTextToPlainText(trade.notes),
    ];
  });
  downloadTextFile(
    `backtest-trades-${new Date().toISOString().slice(0, 10)}.csv`,
    [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n"),
    "text/csv;charset=utf-8",
  );
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadTextFile(filename: string, contents: string, type: string) {
  if (typeof document === "undefined") {
    return;
  }
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function useLiveJournalData(): LiveJournalController {
  const [data, setData] = useState<LiveJournalData>(() => loadLiveJournalData());
  const hydratedRef = useRef(false);
  const lastSyncedJsonRef = useRef("");

  useEffect(() => {
    let active = true;
    void hydrateLiveJournalData().then((nextData) => {
      if (!active) {
        return;
      }
      lastSyncedJsonRef.current = JSON.stringify(nextData);
      setData(nextData);
      hydratedRef.current = true;
    });
    const unsubscribe = subscribeAppStorageItem<unknown>(
      LIVE_JOURNAL_STORAGE_KEY,
      (value) => {
        const nextData = sanitizeLiveJournalData(value);
        lastSyncedJsonRef.current = JSON.stringify(nextData);
        setData(nextData);
        hydratedRef.current = true;
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) {
      return;
    }
    try {
      const nextJson = JSON.stringify(data);
      if (nextJson === lastSyncedJsonRef.current) {
        return;
      }
      lastSyncedJsonRef.current = nextJson;
      void saveAppStorageItem(LIVE_JOURNAL_STORAGE_KEY, data);
    } catch {
      // Large uploaded screenshots can exceed browser storage. Keep the UI running.
    }
  }, [data]);

  function addSession(payload: Omit<LiveJournalSession, "created_at" | "id" | "status">) {
    setData((current) => ({
      ...current,
      sessions: [
        ...current.sessions,
        {
          ...payload,
          created_at: new Date().toISOString(),
          id: nextNumericId(current.sessions),
          status: "ACTIVE",
        },
      ],
    }));
  }

  function addPlaybook(payload: PlaybookPayload) {
    const playbook: Playbook = {
      created_at: new Date().toISOString(),
      description: payload.description ?? null,
      id: nextNumericId(data.playbooks),
      name: payload.name,
      rules: payload.rules ?? null,
    };
    setData((current) => ({
      ...current,
      playbooks: [...current.playbooks, playbook],
    }));
    return playbook;
  }

  function addTrade(payload: LiveTradeInput) {
    setData((current) => {
      const session = current.sessions.find((item) => item.id === payload.sessionId) ?? current.sessions[0] ?? defaultLiveSession();
      const sessions = current.sessions.length > 0 ? current.sessions : [session];
      const realizedPnl =
        payload.side === "LONG"
          ? (payload.exitPrice - payload.entryPrice) * payload.quantity
          : (payload.entryPrice - payload.exitPrice) * payload.quantity;
      const riskAmount =
        payload.stopLoss == null
          ? null
          : Math.abs(payload.entryPrice - payload.stopLoss) * payload.quantity;
      const trade: Trade = {
        emotional_state: payload.emotionalState,
        entry_offset: 0,
        entry_price: payload.entryPrice,
        entry_time: toIsoFromDateTimeLocal(payload.entryTime),
        exit_offset: null,
        exit_price: payload.exitPrice,
        exit_time: toIsoFromDateTimeLocal(payload.exitTime),
        id: nextNumericId(current.trades),
        mistake_tags: payload.mistakeTags,
        notes: payload.notes,
        playbook_id: session.playbook_id ?? null,
        quantity: payload.quantity,
        r_multiple: riskAmount != null && riskAmount > 0 ? realizedPnl / riskAmount : null,
        realized_pnl: realizedPnl,
        remaining_quantity: 0,
        screenshot_url: payload.screenshotUrl,
        session_id: session.id,
        side: payload.side,
        status: "CLOSED",
        stop_loss: payload.stopLoss,
        strategy_name: payload.strategyName ?? session.strategy_name,
        take_profit: payload.takeProfit,
      };
      return {
        ...current,
        sessions,
        trades: [...current.trades, trade],
      };
    });
  }

  return { addPlaybook, addSession, addTrade, data };
}

function loadLiveJournalData(): LiveJournalData {
  try {
    return sanitizeLiveJournalData(
      getCachedAppStorageItem<unknown>(LIVE_JOURNAL_STORAGE_KEY, null),
    );
  } catch {
    return { playbooks: [], sessions: [defaultLiveSession()], trades: [] };
  }
}

async function hydrateLiveJournalData(): Promise<LiveJournalData> {
  return sanitizeLiveJournalData(await loadAppStorageItem<unknown>(LIVE_JOURNAL_STORAGE_KEY, null));
}

function sanitizeLiveJournalData(value: unknown): LiveJournalData {
  if (typeof value !== "object" || value == null) {
    return { playbooks: [], sessions: [defaultLiveSession()], trades: [] };
  }
  const candidate = value as Partial<LiveJournalData>;
  const sessions = Array.isArray(candidate.sessions)
    ? candidate.sessions
        .filter(isLiveJournalSession)
        .map((session) => ({ ...session, playbook_id: session.playbook_id ?? null }))
    : [];
  const trades = Array.isArray(candidate.trades)
    ? candidate.trades.filter(isTradeLike)
    : [];
  const playbooks = Array.isArray(candidate.playbooks)
    ? candidate.playbooks.filter(isPlaybookLike)
    : [];
  return {
    playbooks,
    sessions: sessions.length > 0 ? sessions : [defaultLiveSession()],
    trades,
  };
}

function defaultLiveSession(): LiveJournalSession {
  return {
    account: "Manual",
    created_at: new Date().toISOString(),
    currency: "USD",
    id: 1,
    initial_balance: 100000,
    instrument: "Manual",
    name: "Primary Live Journal",
    notes: "",
    playbook_id: null,
    status: "ACTIVE",
    strategy_name: "Unassigned",
  };
}

function isLiveJournalSession(value: unknown): value is LiveJournalSession {
  if (typeof value !== "object" || value == null) {
    return false;
  }
  const candidate = value as Partial<LiveJournalSession>;
  return (
    typeof candidate.id === "number" &&
    typeof candidate.name === "string" &&
    typeof candidate.strategy_name === "string" &&
    typeof candidate.instrument === "string" &&
    typeof candidate.initial_balance === "number"
  );
}

function isPlaybookLike(value: unknown): value is Playbook {
  if (typeof value !== "object" || value == null) {
    return false;
  }
  const candidate = value as Partial<Playbook>;
  return typeof candidate.id === "number" && typeof candidate.name === "string";
}

function isTradeLike(value: unknown): value is Trade {
  if (typeof value !== "object" || value == null) {
    return false;
  }
  const candidate = value as Partial<Trade>;
  return (
    typeof candidate.id === "number" &&
    typeof candidate.session_id === "number" &&
    (candidate.side === "LONG" || candidate.side === "SHORT") &&
    typeof candidate.entry_time === "string" &&
    typeof candidate.entry_price === "number" &&
    typeof candidate.quantity === "number" &&
    typeof candidate.realized_pnl === "number"
  );
}

function groupLiveStrategies(
  sessions: LiveJournalSession[],
  trades: Trade[],
): LiveStrategyGroup[] {
  const grouped = new Map<string, { sessions: Map<number, LiveJournalSession>; trades: Trade[] }>();
  for (const session of sessions) {
    const name = session.strategy_name || "Unassigned";
    grouped.set(name, grouped.get(name) ?? { sessions: new Map(), trades: [] });
    grouped.get(name)?.sessions.set(session.id, session);
  }
  for (const trade of trades) {
    const session = sessions.find((item) => item.id === trade.session_id);
    const name = trade.strategy_name || session?.strategy_name || "Unassigned";
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

function nextNumericId(items: Array<{ id: number }>) {
  return Math.max(0, ...items.map((item) => item.id)) + 1;
}

function defaultDateTimeLocal(offsetMinutes: number) {
  const date = new Date(Date.now() + offsetMinutes * 60000);
  const localOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - localOffset).toISOString().slice(0, 16);
}

function toIsoFromDateTimeLocal(value: string) {
  const date = value ? new Date(value) : new Date();
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
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

function computePlaybookUsage(
  playbook: Playbook,
  sessions: PlaybookUsageSession[],
  trades: Trade[],
) {
  const linkedSessions = sessions.filter((session) => session.playbook_id === playbook.id);
  const linkedTrades = trades.filter((trade) => trade.playbook_id === playbook.id);
  return {
    aggregate: aggregateTrades(linkedTrades),
    sessions: linkedSessions,
    trades: linkedTrades,
  };
}

function composePlaybookRules(entryRules: string, exitRules: string, riskRules: string) {
  const sections = [
    ["Entry Conditions", entryRules],
    ["Exit Conditions", exitRules],
    ["Risk Conditions", riskRules],
  ]
    .map(([title, body]) => `${title}\n${body.trim() || "Not defined yet."}`)
    .join("\n\n");
  return sections;
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
  return formatMarketSymbol(sessionById.get(trade.session_id)?.symbol ?? "SYMBOL");
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
