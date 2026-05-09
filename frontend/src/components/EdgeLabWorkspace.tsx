import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent,
  Dispatch,
  FormEvent,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  CSSProperties,
  SetStateAction,
} from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  ArrowRight,
  BadgeDollarSign,
  BarChart3,
  BookOpen,
  Bold,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock3,
  Copy,
  Database,
  Eye,
  FileDown,
  FileText,
  FileUp,
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
  Tags,
  Target,
  TrendingDown,
  TrendingUp,
  Trash2,
  Underline,
  WalletCards,
  X,
} from "lucide-react";
import { importBacktestTrades } from "../lib/api";
import type {
  BacktestSession,
  BacktestTradeImportResult,
  DatasetCatalog,
  DatasetRefreshResponse,
  DatasetRefreshStatus,
  DatasetTimeframe,
  Playbook,
  PlaybookPayload,
  PlaybookUpdatePayload,
  Trade,
} from "../lib/api";
import {
  hydrateOrderLineModificationConfirmation,
  loadOrderLineModificationConfirmation,
  saveOrderLineModificationConfirmation,
  subscribeOrderLineModificationConfirmation,
} from "../lib/backtestSettings";
import {
  MIXED_CURRENCY,
  currencyForSession,
  currencyForSessions,
  currencyForTrades,
  normalizeCurrencyCode,
} from "../lib/currency";
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
  hydrateOrderCommissionFixed,
  hydrateOrderCommissionMode,
  hydrateOrderCommissionPercent,
  hydrateOrderDefaultQuantity,
  hydrateOrderDefaultRiskPercent,
  hydrateOrderFeeFixed,
  hydrateOrderFeeMode,
  hydrateOrderFeePercent,
  hydrateOrderRiskBase,
  hydrateOrderSizingMode,
  loadOrderCommissionFixed,
  loadOrderCommissionMode,
  loadOrderCommissionPercent,
  loadOrderDefaultQuantity,
  loadOrderDefaultRiskPercent,
  loadOrderFeeFixed,
  loadOrderFeeMode,
  loadOrderFeePercent,
  loadOrderRiskBase,
  loadOrderSizingMode,
  type OrderCommissionMode,
  type OrderRiskBase,
  type OrderSizingMode,
  saveOrderCommissionFixed,
  saveOrderCommissionMode,
  saveOrderCommissionPercent,
  saveOrderDefaultQuantity,
  saveOrderDefaultRiskPercent,
  saveOrderFeeFixed,
  saveOrderFeeMode,
  saveOrderFeePercent,
  saveOrderRiskBase,
  saveOrderSizingMode,
  subscribeOrderCommissionFixed,
  subscribeOrderCommissionMode,
  subscribeOrderCommissionPercent,
  subscribeOrderDefaultQuantity,
  subscribeOrderDefaultRiskPercent,
  subscribeOrderFeeFixed,
  subscribeOrderFeeMode,
  subscribeOrderFeePercent,
  subscribeOrderRiskBase,
  subscribeOrderSizingMode,
} from "../lib/orderSettings";
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
import { ReplayDateTimePicker } from "./ReplayController";
import { ThemedDatePicker } from "./ThemedDatePicker";
import { ThemedColorPicker } from "./ThemedColorPicker";
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
  onUpdatePlaybook: (playbookId: number, payload: PlaybookUpdatePayload) => Promise<Playbook>;
  onDeletePlaybook: (playbookId: number) => Promise<void>;
  onNavigateBacktest: () => void;
  onNavigateDayView: () => void;
  onNavigateSessions: () => void;
  onNavigateTradeView: () => void;
  onReturnToBacktestPanel: () => void;
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
  notebookReturnToBacktestPanel: "review" | "results" | null;
  notebookReturnToDayView: boolean;
  notebookReturnToTradeView: boolean;
};

type Aggregate = {
  averageHoldMinutes: number | null;
  averageLoss: number;
  averageR: number | null;
  averageWin: number;
  breakeven: number;
  closed: Trade[];
  grossLosses: number;
  grossPnl: number;
  grossWins: number;
  largestLoss: number | null;
  largestWin: number | null;
  losses: number;
  maxDrawdown: number;
  netPnl: number;
  profitFactor: number | null;
  recoveryFactor: number | null;
  totalCommissions: number;
  totalFees: number;
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

type DayViewMode = "day" | "week";

type ReportTab = "calendar" | "daytime" | "overview" | "performance" | "recaps" | "risk" | "tags" | "winsLosses";
type PerformanceDetailTab = "summary" | "days" | "trades";
type TimeBreakdownMode = "duration" | "hour" | "month" | "weekday";
type RiskBreakdownMode = "hold" | "quantity" | "rMultiple" | "side";

type DayViewPeriod = {
  aggregate: Aggregate;
  days: DayGroup[];
  endDate: string;
  id: string;
  label: string;
  startDate: string;
  sublabel: string;
  trades: Trade[];
};

type DayViewNoteMap = Record<string, string>;

type StrategyGroup = {
  aggregate: Aggregate;
  name: string;
  sessions: BacktestSession[];
  trades: Trade[];
};

type LiveJournalSession = {
  account_ids?: number[];
  account: string;
  brokerage_mode: OrderCommissionMode;
  brokerage_value: number;
  commission_mode: OrderCommissionMode;
  commission_value: number;
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

type LiveJournalAccount = {
  broker: string;
  color: string;
  created_at: string;
  currency: string;
  id: number;
  initial_balance: number;
  name: string;
  notes: string;
  status: "ACTIVE" | "ARCHIVED";
};

type JournalEntryType = "MISSED" | "TAKEN";

type JournalTrade = Trade & {
  account_ids?: number[];
  journal_entry_type?: JournalEntryType;
  missed_reason?: string | null;
  planned_entry_price?: number | null;
  planned_exit_price?: number | null;
  planned_stop_loss?: number | null;
  planned_take_profit?: number | null;
};

type MissedJournalTrade = JournalTrade & { journal_entry_type: "MISSED" };
type TakenJournalTrade = JournalTrade & { journal_entry_type?: "TAKEN" };

type LiveJournalSettings = {
  default_commission_mode: OrderCommissionMode;
  default_commission_value: number;
  default_account_ids: number[];
  default_broker: string;
  default_currency: string;
  default_entry_type: JournalEntryType;
  default_fee_mode: OrderCommissionMode;
  default_fee_value: number;
  default_risk_percent: number;
  require_account_for_taken_trades: boolean;
};

type LiveJournalData = {
  accounts: LiveJournalAccount[];
  playbooks: Playbook[];
  sessions: LiveJournalSession[];
  settings: LiveJournalSettings;
  trades: JournalTrade[];
};

type LiveStrategyGroup = {
  aggregate: Aggregate;
  name: string;
  sessions: LiveJournalSession[];
  trades: JournalTrade[];
};

type LiveJournalController = {
  addAccount: (payload: LiveJournalAccountInput) => LiveJournalAccount;
  addPlaybook: (payload: PlaybookPayload) => Playbook;
  addSession: (payload: Omit<LiveJournalSession, "created_at" | "id" | "status">) => void;
  addTrade: (payload: LiveTradeInput) => void;
  deleteAccount: (accountId: number) => void;
  deleteSession: (sessionId: number) => void;
  deleteTrade: (tradeId: number) => void;
  updatePlaybook: (playbookId: number, payload: PlaybookUpdatePayload) => Playbook | null;
  deletePlaybook: (playbookId: number) => void;
  updateAccount: (accountId: number, payload: Partial<LiveJournalAccountInput> & { status?: LiveJournalAccount["status"] }) => LiveJournalAccount | null;
  updateSession: (sessionId: number, payload: Partial<Omit<LiveJournalSession, "created_at" | "id">>) => LiveJournalSession | null;
  updateSettings: (payload: Partial<LiveJournalSettings>) => void;
  updateTrade: (tradeId: number, payload: LiveTradeInput) => void;
  updateTradeStrategy: (tradeId: number, strategyName: string | null) => void;
  data: LiveJournalData;
};

type LiveJournalAccountInput = {
  broker: string;
  color: string;
  currency: string;
  initial_balance: number;
  name: string;
  notes: string;
};

type LiveTradeInput = {
  accountIds: number[];
  brokerageMode?: OrderCommissionMode;
  brokerageValue?: number;
  commissionMode?: OrderCommissionMode;
  commissionValue?: number;
  emotionalState: string | null;
  entryPrice: number | null;
  entryType: JournalEntryType;
  entryTime: string;
  exitPrice: number | null;
  exitTime: string;
  mistakeTags: string[];
  missedReason: string | null;
  notes: string | null;
  playbookId: number | null;
  plannedEntryPrice: number | null;
  plannedExitPrice: number | null;
  plannedStopLoss: number | null;
  plannedTakeProfit: number | null;
  quantity: number | null;
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

type ThemedConfirmTone = "danger" | "default";

type ThemedConfirmOptions = {
  cancelLabel?: string;
  confirmLabel?: string;
  detail?: ReactNode;
  message: ReactNode;
  title: string;
  tone?: ThemedConfirmTone;
};

type ThemedConfirmRequest = ThemedConfirmOptions & {
  resolve: (confirmed: boolean) => void;
};

const LIVE_JOURNAL_STORAGE_KEY = "live-journal.v1";
const LIVE_JOURNAL_STRATEGIES_STORAGE_KEY = "live-journal-strategies.v1";
const BACKTEST_STRATEGIES_STORAGE_KEY = "backtest-strategies.v1";
const NOTEBOOK_FAVORITES_STORAGE_KEY = "notebook-favorites.v1";
const NOTEBOOK_TEMPLATE_STORAGE_KEY = "notebook-template.v1";
const BACKTEST_DAY_NOTES_STORAGE_KEY = "backtest-day-notes.v1";
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

type TradeViewFilterState = {
  dateFrom: string;
  dateTo: string;
  instrumentFilter: string;
  searchTerm: string;
  sessionFilter: string;
  sideFilter: string;
  strategyFilter: string;
  tagFilter: string;
};

const DEFAULT_TRADE_VIEW_FILTERS: TradeViewFilterState = {
  dateFrom: "",
  dateTo: "",
  instrumentFilter: "ALL",
  searchTerm: "",
  sessionFilter: "ALL",
  sideFilter: "ALL",
  strategyFilter: "ALL",
  tagFilter: "ALL",
};

type ResultFilterState = TradeViewFilterState;

const DEFAULT_RESULT_FILTERS: ResultFilterState = DEFAULT_TRADE_VIEW_FILTERS;

type ScrollSnapshot = {
  left: number;
  top: number;
};

export function EdgeLabWorkspace({
  activeSession,
  datasets,
  onEditTrade,
  onInspectTrade,
  onOpenTradeNote,
  onCreatePlaybook,
  onUpdatePlaybook,
  onDeletePlaybook,
  onNavigateBacktest,
  onNavigateDayView,
  onNavigateSessions,
  onNavigateTradeView,
  onReturnToBacktestPanel,
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
  notebookReturnToBacktestPanel,
  notebookReturnToDayView,
  notebookReturnToTradeView,
}: Props) {
  const [tradeViewFilters, setTradeViewFilters] = useState<TradeViewFilterState>(DEFAULT_TRADE_VIEW_FILTERS);
  const tradeViewScrollRef = useRef(0);
  const tradeViewLogScrollRef = useRef(0);
  const pendingTradeViewScrollRestoreRef = useRef<number | null>(null);
  const pendingTradeViewLogScrollRestoreRef = useRef<number | null>(null);
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

  useEffect(() => {
    if (view !== "tradeView" || pendingTradeViewScrollRestoreRef.current == null) {
      return;
    }
    const scrollTop = pendingTradeViewScrollRestoreRef.current;
    pendingTradeViewScrollRestoreRef.current = null;
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
  }, [view]);

  function openTradeNoteFromTradeView(trade: Trade) {
    tradeViewScrollRef.current = window.scrollY;
    onOpenTradeNote(trade);
  }

  function returnToTradeView() {
    pendingTradeViewScrollRestoreRef.current = tradeViewScrollRef.current;
    pendingTradeViewLogScrollRestoreRef.current = tradeViewLogScrollRef.current;
    onNavigateTradeView();
  }

  function handleTradeViewLogScroll(scrollTop: number) {
    tradeViewLogScrollRef.current = scrollTop;
  }

  function clearTradeViewLogScrollRestore() {
    pendingTradeViewLogScrollRestoreRef.current = null;
  }

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
    onUpdatePlaybook,
    onDeletePlaybook,
    onNavigateBacktest,
    onNavigateSessions,
    onNavigateTradeView,
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
    notebookReturnToBacktestPanel,
    notebookReturnToDayView,
    notebookReturnToTradeView,
    onReturnToBacktestPanel: notebookReturnToBacktestPanel ? onReturnToBacktestPanel : undefined,
    onReturnToDayView: notebookReturnToDayView ? onNavigateDayView : undefined,
    onReturnToTradeView: notebookReturnToTradeView ? returnToTradeView : undefined,
    tradeViewFilters,
    onTradeViewFiltersChange: setTradeViewFilters,
    onTradeViewLogScrollChange: handleTradeViewLogScroll,
    onTradeViewLogScrollRestored: clearTradeViewLogScrollRestore,
    tradeViewLogScrollTop: pendingTradeViewLogScrollRestoreRef.current,
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
      return <TradeViewPage {...shared} onOpenTradeNote={openTradeNoteFromTradeView} />;
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
  onUpdatePlaybook: (playbookId: number, payload: PlaybookUpdatePayload) => Promise<Playbook>;
  onDeletePlaybook: (playbookId: number) => Promise<void>;
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
  onReturnToBacktestPanel?: () => void;
  onReturnToDayView?: () => void;
  onReturnToTradeView?: () => void;
  onTradeViewFiltersChange: Dispatch<SetStateAction<TradeViewFilterState>>;
  onTradeViewLogScrollChange: (scrollTop: number) => void;
  onTradeViewLogScrollRestored: () => void;
  openTrades: Trade[];
  playbooks: Playbook[];
  sessionById: Map<number, BacktestSession>;
  sessions: BacktestSession[];
  strategies: StrategyGroup[];
  trades: Trade[];
  notebookFocusTradeId: number | null;
  notebookReturnToBacktestPanel: "review" | "results" | null;
  notebookReturnToDayView: boolean;
  notebookReturnToTradeView: boolean;
  tradeViewFilters: TradeViewFilterState;
  tradeViewLogScrollTop: number | null;
};

function DashboardPage({
  closedTrades,
  currency,
  datasets,
  days,
  onInspectTrade,
  onNavigateSessions,
  openTrades,
  sessionById,
  sessions,
  strategies,
}: SharedPageProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<ResultFilterState>(DEFAULT_RESULT_FILTERS);
  const [recentMode, setRecentMode] = useState<"closed" | "open">("closed");
  const [selectedDayDate, setSelectedDayDate] = useState("");
  const [calendarMonth, setCalendarMonth] = useState(() => monthCursorFromDateKey(days[0]?.date));
  const [calendarInfoOpen, setCalendarInfoOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const filtersMenuRef = useRef<HTMLDivElement | null>(null);
  useCloseOnOutsidePointer(filtersOpen, [filtersMenuRef], () => setFiltersOpen(false));
  const filteredClosedTrades = useMemo(
    () => filterResultTrades(closedTrades, filters, sessionById),
    [closedTrades, filters, sessionById],
  );
  const filteredOpenTrades = useMemo(
    () => filterResultTrades(openTrades, filters, sessionById),
    [filters, openTrades, sessionById],
  );
  const filteredDays = useMemo(() => groupTradesByDay(filteredClosedTrades), [filteredClosedTrades]);
  const filteredAggregate = useMemo(() => aggregateTrades(filteredClosedTrades), [filteredClosedTrades]);
  const filteredCurrency = useMemo(
    () => currencyForFilteredScope(filteredClosedTrades, sessionById, datasets, currency, filters),
    [currency, datasets, filteredClosedTrades, filters, sessionById],
  );
  const selectedDay =
    filteredDays.find((day) => day.date === selectedDayDate) ?? filteredDays[0] ?? null;
  const monthDays = useMemo(
    () => filteredDays.filter((day) => day.date.startsWith(calendarMonth.slice(0, 7))),
    [calendarMonth, filteredDays],
  );
  const monthAggregate = useMemo(
    () => aggregateTrades(monthDays.flatMap((day) => day.trades)),
    [monthDays],
  );
  const selectedDayCurrency = useMemo(
    () =>
      selectedDay
        ? currencyForTrades(selectedDay.trades, sessionById, datasets, filteredCurrency)
        : filteredCurrency,
    [datasets, filteredCurrency, selectedDay, sessionById],
  );
  const monthCurrency = useMemo(
    () => currencyForTrades(monthDays.flatMap((day) => day.trades), sessionById, datasets, filteredCurrency),
    [datasets, filteredCurrency, monthDays, sessionById],
  );
  const filtersActive = resultFiltersActive(filters);
  const startingBalance =
    (filters.sessionFilter !== "ALL"
      ? sessions.find((session) => String(session.id) === filters.sessionFilter)?.initial_balance
      : sessions[0]?.initial_balance) ?? 100000;
  const accountBalance = startingBalance + filteredAggregate.netPnl;

  useEffect(() => {
    if (filteredDays.length === 0) {
      setSelectedDayDate("");
      return;
    }
    if (!filteredDays.some((day) => day.date === selectedDayDate)) {
      setSelectedDayDate(filteredDays[0].date);
      setCalendarMonth(monthCursorFromDateKey(filteredDays[0].date));
    }
  }, [filteredDays, selectedDayDate]);

  useEffect(() => {
    if (!copyStatus) {
      return;
    }
    const timeout = window.setTimeout(() => setCopyStatus(null), 2400);
    return () => window.clearTimeout(timeout);
  }, [copyStatus]);

  function selectDashboardDate(date: string) {
    if (!filteredDays.some((day) => day.date === date)) {
      return;
    }
    setSelectedDayDate(date);
    setCalendarMonth(monthCursorFromDateKey(date));
  }

  async function copyDashboardSummary() {
    await copyTextToClipboard(
      buildResultsSummaryText({
        aggregate: filteredAggregate,
        currency: filteredCurrency,
        label: "Backtest overview",
        trades: filteredClosedTrades.length,
      }),
    );
    setCopyStatus("Summary copied");
  }

  async function copyBalance() {
    await copyTextToClipboard(formatMoney(accountBalance, filteredCurrency));
    setCopyStatus("Balance copied");
  }

  function exportOverviewCsv() {
    exportResultsSummaryCsv({
      aggregate: filteredAggregate,
      currency: filteredCurrency,
      days: filteredDays,
      filenamePrefix: "backtest-overview",
      sessionById,
      strategies: groupByStrategy(sessions, filteredClosedTrades, sessionById).filter(
        (strategy) => strategy.aggregate.totalTrades > 0,
      ),
      trades: filteredClosedTrades,
    });
  }

  return (
    <PageScaffold
      eyebrow="Backtest Dashboard"
      title="Backtest Command Center"
      description="Replay performance, recent simulated activity, account balance, and calendar review from backtest sessions only. Live Journal metrics stay separate."
      actions={
        <div className="relative" ref={filtersMenuRef}>
          <button
            className={`control-button ${filtersOpen ? "workspace-tab-active" : ""}`}
            onClick={() => setFiltersOpen((value) => !value)}
            type="button"
          >
            <Filter size={15} />
            Filters
            {filtersActive && <span className="status-pill h-6 px-2 text-[10px]">On</span>}
          </button>
          {filtersOpen && (
            <ResultFiltersPopover
              closedTrades={closedTrades}
              filters={filters}
              onApply={(nextFilters) => {
                setFilters(nextFilters);
                setFiltersOpen(false);
              }}
              onClose={() => setFiltersOpen(false)}
              onReset={() => setFilters(DEFAULT_RESULT_FILTERS)}
              sessionById={sessionById}
              strategies={strategies}
            />
          )}
        </div>
      }
    >
      {(filtersActive || copyStatus) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-400">
          <span>
            Showing {filteredClosedTrades.length}/{closedTrades.length} closed trades
            {filtersActive ? " with active filters" : ""}.
          </span>
          <div className="flex items-center gap-2">
            {copyStatus && <span className="text-cyan-100">{copyStatus}</span>}
            {filtersActive && (
              <button className="control-button h-8 px-2 text-xs" onClick={() => setFilters(DEFAULT_RESULT_FILTERS)} type="button">
                <RefreshCw size={13} />
                Reset filters
              </button>
            )}
          </div>
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(360px,1fr)_minmax(300px,0.75fr)]">
        <FeatureCard>
          <div className="flex items-center justify-between gap-3">
            <CardLabel icon={TrendingUp} label="Backtest daily P&L" />
            <span className="status-pill">{selectedDay?.label ?? "No trade day"}</span>
          </div>
          <div className={`mt-6 text-4xl font-semibold tabular-nums ${toneForNumber(selectedDay?.aggregate.netPnl)}`}>
            {formatMoney(selectedDay?.aggregate.netPnl ?? 0, selectedDayCurrency)}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <CompactMetric label="Trades" value={String(selectedDay?.aggregate.totalTrades ?? 0)} />
            <CompactMetric label="Win" value={formatPercent(selectedDay?.aggregate.winRate ?? 0)} />
            <CompactMetric label="Avg R" value={formatOptionalNumber(selectedDay?.aggregate.averageR)} />
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
            {(recentMode === "closed" ? filteredClosedTrades.slice(-8).reverse() : filteredOpenTrades).map((trade) => (
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
            {(recentMode === "closed" ? filteredClosedTrades.length : filteredOpenTrades.length) === 0 && (
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
            <button className="icon-button h-8 w-8" onClick={() => void copyBalance()} title="Copy balance" type="button">
              <Copy size={14} />
            </button>
          </div>
          <div className="mt-6 text-4xl font-semibold tabular-nums text-white">
            {formatMoney(accountBalance, filteredCurrency)}
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
              <button className="icon-button h-8 w-8" onClick={() => void copyDashboardSummary()} title="Copy overview summary" type="button">
                <Share2 size={14} />
              </button>
              <button className={`icon-button h-8 w-8 ${calendarInfoOpen ? "workspace-tab-active" : ""}`} onClick={() => setCalendarInfoOpen((value) => !value)} title="Calendar details" type="button">
                <Info size={14} />
              </button>
              <button className="control-button h-8 px-2 text-xs" disabled={filteredClosedTrades.length === 0} onClick={exportOverviewCsv} type="button">
                <FileDown size={13} />
                CSV
              </button>
            </div>
          </div>
          <CalendarHeatmap
            currency={filteredCurrency}
            days={filteredDays}
            month={calendarMonth}
            onMonthChange={setCalendarMonth}
            onSelectDate={selectDashboardDate}
            selectedDate={selectedDay?.date ?? null}
          />
          {calendarInfoOpen && (
            <div className="mt-3 rounded-md border border-white/10 bg-black/20 p-3 text-sm leading-6 text-slate-400">
              Calendar cells use closed trade P&L by exit date. Selecting a trading day updates the daily P&L card, while the month metrics below follow the visible calendar month and active filters.
            </div>
          )}
          <div className="mt-4 grid gap-2 md:grid-cols-4">
            <CompactMetric label="Month P&L" value={formatMoney(monthAggregate.netPnl, monthCurrency)} tone={toneForNumber(monthAggregate.netPnl)} />
            <CompactMetric label="Trading days" value={String(monthDays.length)} />
            <CompactMetric label="Win rate" value={formatPercent(monthAggregate.winRate)} />
            <CompactMetric label="Profit factor" value={formatRatio(monthAggregate.profitFactor)} />
          </div>
        </FeatureCard>
        <FeatureCard>
          <CardLabel icon={TrendingDown} label="Drawdown" />
          <div className="mt-4">
            <AreaSparkline currency={filteredCurrency} values={drawdownValues(filteredClosedTrades)} height={220} tone="rose" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <CompactMetric label="Max DD" value={formatMoney(filteredAggregate.maxDrawdown, filteredCurrency)} tone="text-rose-300" />
            <CompactMetric label="Recovery" value={formatRatio(filteredAggregate.recoveryFactor)} />
          </div>
        </FeatureCard>
      </div>
    </PageScaffold>
  );
}

type ImportMappingField =
  | "entry_time"
  | "exit_time"
  | "side"
  | "entry_price"
  | "exit_price"
  | "quantity"
  | "realized_pnl"
  | "commission_amount"
  | "fee_amount"
  | "symbol"
  | "strategy_name"
  | "stop_loss"
  | "take_profit"
  | "r_multiple"
  | "notes"
  | "tags";

type CsvPreview = {
  headers: string[];
  rows: Record<string, string>[];
};

type ImportFormState = {
  account_name: string;
  source_name: string;
  csv_text: string;
  initial_balance: string;
  currency: string;
  default_commission_mode: OrderCommissionMode;
  default_commission_fixed: string;
  default_commission_percent: string;
  default_fee_mode: OrderCommissionMode;
  default_fee_fixed: string;
  default_fee_percent: string;
  symbol: string;
  instrument: string;
  timeframe: string;
  strategy_name: string;
};

const IMPORT_FIELD_DEFINITIONS: Array<{
  key: ImportMappingField;
  label: string;
  required?: boolean;
}> = [
  { key: "entry_time", label: "Entry time", required: true },
  { key: "exit_time", label: "Exit time" },
  { key: "side", label: "Side", required: true },
  { key: "entry_price", label: "Entry price", required: true },
  { key: "exit_price", label: "Exit price", required: true },
  { key: "quantity", label: "Quantity", required: true },
  { key: "realized_pnl", label: "P&L" },
  { key: "commission_amount", label: "Commission" },
  { key: "fee_amount", label: "Fees" },
  { key: "symbol", label: "Symbol" },
  { key: "strategy_name", label: "Strategy" },
  { key: "stop_loss", label: "Stop loss" },
  { key: "take_profit", label: "Take profit" },
  { key: "r_multiple", label: "R multiple" },
  { key: "notes", label: "Notes" },
  { key: "tags", label: "Tags" },
];

const IMPORT_FIELD_ALIASES: Record<ImportMappingField, string[]> = {
  entry_time: ["entrytime", "entrydate", "entrydatetime", "opentime", "opendate", "entry"],
  exit_time: ["exittime", "exitdate", "exitdatetime", "closetime", "closedate", "exit"],
  side: ["side", "direction", "type", "position", "tradetype", "action", "buysell"],
  entry_price: ["entryprice", "openprice", "pricein", "entryfill", "avgentry", "entry"],
  exit_price: ["exitprice", "closeprice", "priceout", "exitfill", "avgexit", "exit"],
  quantity: ["quantity", "qty", "contracts", "shares", "lots", "volume", "size"],
  realized_pnl: ["pnl", "pl", "profit", "profitloss", "realizedpnl", "netpnl", "netprofit", "result"],
  commission_amount: ["commission", "commissions", "brokercommission", "brokercommissions"],
  fee_amount: ["fee", "fees", "brokerfee", "brokerfees", "transactionfee", "transactionfees", "cost"],
  symbol: ["symbol", "ticker", "instrument", "market", "contract", "asset"],
  strategy_name: ["strategy", "strategyname", "setup", "playbook", "system"],
  stop_loss: ["stoploss", "stop", "sl", "stopprice"],
  take_profit: ["takeprofit", "target", "tp", "targetprice"],
  r_multiple: ["r", "rmultiple", "rvalue", "rr", "riskreward"],
  notes: ["notes", "note", "comment", "comments", "review"],
  tags: ["tags", "tag", "mistakes", "mistaketags", "labels"],
};

const EMPTY_IMPORT_MAPPING = Object.fromEntries(
  IMPORT_FIELD_DEFINITIONS.map((field) => [field.key, ""]),
) as Record<ImportMappingField, string>;

function AccountsPage({
  aggregate,
  currency,
  datasets,
  onResumeSession,
  sessions,
  trades,
}: SharedPageProps) {
  const refreshResults = useBacktestStore((state) => state.refreshResults);
  const deleteSession = useBacktestStore((state) => state.deleteSession);
  const [modalOpen, setModalOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [csvPreview, setCsvPreview] = useState<CsvPreview | null>(null);
  const [importResult, setImportResult] = useState<BacktestTradeImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<number | null>(null);
  const [mapping, setMapping] = useState<Record<ImportMappingField, string>>(EMPTY_IMPORT_MAPPING);
  const { confirm, confirmDialog } = useThemedConfirm();
  const [importForm, setImportForm] = useState<ImportFormState>({
    account_name: "Imported Backtest",
    source_name: "",
    csv_text: "",
    initial_balance: "100000",
    currency,
    default_commission_mode: loadOrderCommissionMode(),
    default_commission_fixed: loadOrderCommissionFixed(),
    default_commission_percent: loadOrderCommissionPercent(),
    default_fee_mode: loadOrderFeeMode(),
    default_fee_fixed: loadOrderFeeFixed(),
    default_fee_percent: loadOrderFeePercent(),
    symbol: "",
    instrument: "",
    timeframe: "Imported",
    strategy_name: "",
  });
  const tradesBySession = useMemo(() => {
    const grouped = new Map<number, Trade[]>();
    for (const trade of trades) {
      grouped.set(trade.session_id, [...(grouped.get(trade.session_id) ?? []), trade]);
    }
    return grouped;
  }, [trades]);
  const sessionRows = useMemo(
    () =>
      sessions.map((session) => {
        const sessionTrades = tradesBySession.get(session.id) ?? [];
        return {
          aggregate: aggregateTrades(sessionTrades),
          session,
          trades: sessionTrades,
        };
      }),
    [sessions, tradesBySession],
  );
  const importedSessionCount = sessions.filter((session) => session.timeframe === "Imported").length;
  const headerOptions = useMemo(
    () => [
      { label: "Auto-detect", value: "" },
      ...(csvPreview?.headers ?? []).map((header) => ({ label: header, value: header })),
    ],
    [csvPreview],
  );

  useEffect(() => {
    let active = true;
    void Promise.all([
      hydrateOrderCommissionMode(),
      hydrateOrderCommissionFixed(),
      hydrateOrderCommissionPercent(),
      hydrateOrderFeeMode(),
      hydrateOrderFeeFixed(),
      hydrateOrderFeePercent(),
    ]).then(([commissionMode, commissionFixed, commissionPercent, feeMode, feeFixed, feePercent]) => {
      if (!active) {
        return;
      }
      setImportForm((current) => ({
        ...current,
        default_commission_mode: commissionMode,
        default_commission_fixed: commissionFixed,
        default_commission_percent: commissionPercent,
        default_fee_mode: feeMode,
        default_fee_fixed: feeFixed,
        default_fee_percent: feePercent,
      }));
    });
    return () => {
      active = false;
    };
  }, []);

  function updateImportField<K extends keyof ImportFormState>(field: K, value: ImportFormState[K]) {
    setImportForm((current) => ({ ...current, [field]: value }));
  }

  async function handleCsvFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const text = await file.text();
    setFileName(file.name);
    setImportResult(null);
    setImportError(null);
    setImportForm((current) => ({
      ...current,
      account_name:
        current.account_name === "Imported Backtest"
          ? file.name.replace(/\.[^.]+$/, "") || current.account_name
          : current.account_name,
      csv_text: text,
      source_name: current.source_name || inferImportSourceName(file.name),
    }));
    const preview = parseCsvPreview(text);
    setCsvPreview(preview);
    setMapping(autoDetectImportMapping(preview?.headers ?? []));
  }

  function handleCsvTextChange(value: string) {
    setImportResult(null);
    setImportError(null);
    updateImportField("csv_text", value);
    const preview = parseCsvPreview(value);
    setCsvPreview(preview);
    setMapping(autoDetectImportMapping(preview?.headers ?? []));
  }

  async function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!importForm.csv_text.trim()) {
      setImportError("Choose a CSV file or paste CSV content first.");
      return;
    }
    setIsImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const result = await importBacktestTrades({
        account_name: importForm.account_name.trim() || "Imported Backtest",
        source_name: importForm.source_name.trim() || null,
        csv_text: importForm.csv_text,
        initial_balance: Number(importForm.initial_balance) || 100000,
        currency: importForm.currency.trim() || null,
        symbol: importForm.symbol.trim() || null,
        instrument: importForm.instrument.trim() || null,
        timeframe: importForm.timeframe.trim() || "Imported",
        strategy_name: importForm.strategy_name.trim() || null,
        default_commission_mode: importForm.default_commission_mode,
        default_commission_value: costValueForPayload(
          importForm.default_commission_mode,
          importForm.default_commission_fixed,
          importForm.default_commission_percent,
        ),
        default_fee_mode: importForm.default_fee_mode,
        default_fee_value: costValueForPayload(
          importForm.default_fee_mode,
          importForm.default_fee_fixed,
          importForm.default_fee_percent,
        ),
        column_mapping: cleanImportMapping(mapping),
      });
      setImportResult(result);
      await refreshResults();
    } catch (error) {
      setImportError(importErrorMessage(error));
    } finally {
      setIsImporting(false);
    }
  }

  async function handleDeleteSession(session: BacktestSession) {
    const confirmed = await confirm({
      confirmLabel: "Delete session",
      message: (
        <>
          Delete <span className="font-semibold text-white">{session.name}</span> and all trades in it?
        </>
      ),
      detail: "This removes the imported/replay session and its trade history from Backtest results.",
      title: "Delete backtest session",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }
    setDeletingSessionId(session.id);
    setImportError(null);
    try {
      await deleteSession(session.id);
      await refreshResults();
    } catch (error) {
      setImportError(importErrorMessage(error));
    } finally {
      setDeletingSessionId(null);
    }
  }

  return (
    <PageScaffold
      eyebrow="Backtest Accounts"
      title="Backtest Accounts & Imports"
      description="Import completed backtests from external CSV exports, store them as replay sessions, and use them across Results, Trades, Notes, and Reports."
      actions={
        <button className="control-button workspace-tab-active" onClick={() => setModalOpen(true)} type="button">
          <FileUp size={15} />
          Import CSV
        </button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-4">
        <FeatureCard>
          <CompactMetric label="Sessions" value={String(sessions.length)} />
        </FeatureCard>
        <FeatureCard>
          <CompactMetric label="CSV Imports" value={String(importedSessionCount)} />
        </FeatureCard>
        <FeatureCard>
          <CompactMetric label="Closed Trades" value={String(aggregate.totalTrades)} />
        </FeatureCard>
        <FeatureCard>
          <CompactMetric label="Net P&L" value={formatMoney(aggregate.netPnl, currency)} tone={toneForNumber(aggregate.netPnl)} />
        </FeatureCard>
      </div>

      {importError && (
        <div className="rounded-md border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {importError}
        </div>
      )}

      <FeatureCard>
        <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
          <CardLabel icon={WalletCards} label="Backtest accounts" />
          <span className="status-pill">{sessionRows.length} sessions</span>
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <th className="px-3 py-3 font-medium">Account / Session</th>
                <th className="px-3 py-3 font-medium">Source</th>
                <th className="px-3 py-3 font-medium">Trades</th>
                <th className="px-3 py-3 font-medium">Net P&L</th>
                <th className="px-3 py-3 font-medium">Balance</th>
                <th className="px-3 py-3 font-medium">Last update</th>
                <th className="px-3 py-3 font-medium">Type</th>
                <th className="px-3 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessionRows.map(({ aggregate: sessionAggregate, session }) => {
                const rowCurrency = currencyForSession(session, datasets);
                const isImported = session.timeframe === "Imported";
                return (
                  <tr className="border-t border-white/10 text-slate-300" key={session.id}>
                    <td className="px-3 py-4">
                      <div className="font-semibold text-white">{session.name}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {formatMarketSymbol(session.symbol)} · {session.timeframe ?? "Replay"}
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <div className="font-semibold text-slate-200">{session.instrument ?? "Replay data"}</div>
                      <div className="mt-1 text-xs text-slate-500">{sessionStrategyName(session)}</div>
                    </td>
                    <td className="px-3 py-4 tabular-nums">{sessionAggregate.totalTrades}</td>
                    <td className={`px-3 py-4 font-semibold ${toneForNumber(sessionAggregate.netPnl)}`}>
                      {formatMoney(sessionAggregate.netPnl, rowCurrency)}
                    </td>
                    <td className="px-3 py-4 font-semibold text-cyan-100">
                      {formatMoney(session.initial_balance + sessionAggregate.netPnl, rowCurrency)}
                    </td>
                    <td className="px-3 py-4 text-slate-500">{formatDateTime(session.updated_at)}</td>
                    <td className="px-3 py-4">
                      <span className="status-pill">{isImported ? "Imported CSV" : "Replay Session"}</span>
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex gap-2">
                        <button
                          className="control-button h-9 px-2 text-xs"
                          onClick={() => void onResumeSession(session.id)}
                          type="button"
                        >
                          <PlaySquare size={14} />
                          Open
                        </button>
                        <button
                          className="icon-button h-9 w-9 text-rose-200 hover:border-rose-300/30 hover:bg-rose-300/10"
                          disabled={deletingSessionId === session.id}
                          onClick={() => void handleDeleteSession(session)}
                          title="Delete account session"
                          type="button"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {sessionRows.length === 0 && (
            <EmptyState icon={WalletCards} message="Import a backtest CSV or create a replay session to populate accounts." />
          )}
        </div>
      </FeatureCard>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
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
            {(datasets?.instruments ?? []).length === 0 && (
              <EmptyState icon={Database} message="No replay instrument CSVs are indexed yet." />
            )}
          </div>
        </FeatureCard>
        <FeatureCard>
          <CardLabel icon={FileUp} label="Supported trade CSVs" />
          <div className="mt-4 grid gap-3 text-sm leading-6 text-slate-400">
            <p>
              Importers accept common exports with entry/exit time, side, prices, quantity, and optional P&L, R, tags, notes, stops, and targets.
            </p>
            <div className="grid gap-2">
              {["TradeZella / journal exports", "TradingView strategy tester", "NinjaTrader, Tradovate, broker logs", "Custom spreadsheets with mapped columns"].map((label) => (
                <div className="flex items-center gap-2 rounded-md border border-white/10 bg-black/20 px-3 py-2" key={label}>
                  <CheckCircle2 className="text-emerald-300" size={14} />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </FeatureCard>
      </div>

      {modalOpen && (
        <ModalFrame maxWidth="wide" title="Import backtest CSV" onClose={() => setModalOpen(false)}>
          <form className="grid gap-4" onSubmit={submitImport}>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="form-field">
                Account / session name
                <input
                  className="input-control h-10 normal-case tracking-normal"
                  onChange={(event) => updateImportField("account_name", event.target.value)}
                  value={importForm.account_name}
                />
              </label>
              <label className="form-field">
                Source app
                <input
                  className="input-control h-10 normal-case tracking-normal"
                  onChange={(event) => updateImportField("source_name", event.target.value)}
                  placeholder="TradeZella, TradingView, NinjaTrader"
                  value={importForm.source_name}
                />
              </label>
              <label className="form-field">
                Starting balance
                <input
                  className="input-control h-10 normal-case tracking-normal"
                  min="1"
                  onChange={(event) => updateImportField("initial_balance", event.target.value)}
                  type="number"
                  value={importForm.initial_balance}
                />
              </label>
              <label className="form-field">
                Currency
                <input
                  className="input-control h-10 uppercase"
                  maxLength={12}
                  onChange={(event) => updateImportField("currency", event.target.value.toUpperCase())}
                  value={importForm.currency}
                />
              </label>
              <label className="form-field">
                Symbol fallback
                <input
                  className="input-control h-10 normal-case tracking-normal"
                  onChange={(event) => updateImportField("symbol", event.target.value)}
                  placeholder="NIFTY50, ES, EURUSD"
                  value={importForm.symbol}
                />
              </label>
              <label className="form-field">
                Default strategy
                <input
                  className="input-control h-10 normal-case tracking-normal"
                  onChange={(event) => updateImportField("strategy_name", event.target.value)}
                  placeholder="Optional"
                  value={importForm.strategy_name}
                />
              </label>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <CostConfigCard
                fixedValue={importForm.default_commission_fixed}
                mode={normalizeCommissionMode(importForm.default_commission_mode)}
                onFixedValueChange={(value) => updateImportField("default_commission_fixed", value)}
                onModeChange={(value) => updateImportField("default_commission_mode", value)}
                onPercentValueChange={(value) => updateImportField("default_commission_percent", value)}
                percentValue={importForm.default_commission_percent}
                title="Default Commissions"
              />
              <CostConfigCard
                fixedValue={importForm.default_fee_fixed}
                mode={normalizeCommissionMode(importForm.default_fee_mode)}
                onFixedValueChange={(value) => updateImportField("default_fee_fixed", value)}
                onModeChange={(value) => updateImportField("default_fee_mode", value)}
                onPercentValueChange={(value) => updateImportField("default_fee_percent", value)}
                percentValue={importForm.default_fee_percent}
                title="Default Fees"
              />
            </div>

            <label className="form-field">
              CSV file
              <input
                accept=".csv,text/csv"
                className="input-control h-10 py-2 normal-case tracking-normal file:mr-3 file:rounded file:border-0 file:bg-cyan-300/10 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-cyan-100"
                onChange={handleCsvFileChange}
                type="file"
              />
            </label>

            <label className="form-field">
              CSV content
              <textarea
                className="input-control min-h-[110px] py-3 normal-case tracking-normal"
                onChange={(event) => handleCsvTextChange(event.target.value)}
                placeholder="Paste CSV content here if you do not want to choose a file."
                value={importForm.csv_text}
              />
            </label>

            <div className="rounded-md border border-white/10 bg-black/20 p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Column mapping</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {fileName || "Auto-detect works for common exports; override any column below."}
                  </div>
                </div>
                {csvPreview && <span className="status-pill">{csvPreview.headers.length} columns</span>}
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {IMPORT_FIELD_DEFINITIONS.map((field) => (
                  <label className="form-field" key={field.key}>
                    {field.label}{field.required ? " *" : ""}
                    <ThemedSelect
                      className="h-10"
                      disabled={!csvPreview}
                      onChange={(value) => setMapping((current) => ({ ...current, [field.key]: value }))}
                      options={headerOptions}
                      portal
                      value={mapping[field.key]}
                    />
                  </label>
                ))}
              </div>
            </div>

            {csvPreview && (
              <div className="overflow-auto rounded-md border border-white/10 bg-black/20">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="uppercase tracking-[0.14em] text-slate-500">
                    <tr>
                      {csvPreview.headers.slice(0, 7).map((header) => (
                        <th className="px-3 py-2 font-medium" key={header}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {csvPreview.rows.slice(0, 4).map((row, index) => (
                      <tr className="border-t border-white/10 text-slate-300" key={index}>
                        {csvPreview.headers.slice(0, 7).map((header) => (
                          <td className="max-w-[180px] truncate px-3 py-2" key={header}>{row[header]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {importError && (
              <div className="rounded-md border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
                {importError}
              </div>
            )}
            {importResult && (
              <div className="rounded-md border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-sm text-emerald-100">
                Imported {importResult.imported_rows} trades into {importResult.session.name}
                {importResult.skipped_rows > 0 ? `, skipped ${importResult.skipped_rows} rows` : ""}.
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button className="control-button" onClick={() => setModalOpen(false)} type="button">
                Close
              </button>
              <button
                className="control-button workspace-tab-active"
                disabled={isImporting || !importForm.csv_text.trim()}
                type="submit"
              >
                <FileUp size={15} />
                {isImporting ? "Importing..." : "Import trades"}
              </button>
            </div>
          </form>
        </ModalFrame>
      )}
      {confirmDialog}
    </PageScaffold>
  );
}

function cleanImportMapping(mapping: Record<ImportMappingField, string>) {
  return Object.fromEntries(
    Object.entries(mapping).filter(([, value]) => value.trim()),
  );
}

function autoDetectImportMapping(headers: string[]) {
  const normalized = new Map(headers.map((header) => [normalizeImportHeader(header), header]));
  const mapping = { ...EMPTY_IMPORT_MAPPING };
  for (const field of IMPORT_FIELD_DEFINITIONS) {
    const match = IMPORT_FIELD_ALIASES[field.key]
      .map((alias) => normalized.get(alias))
      .find((header): header is string => Boolean(header));
    mapping[field.key] = match ?? "";
  }
  return mapping;
}

function parseCsvPreview(text: string): CsvPreview | null {
  const rows = parseCsvRows(text, 6);
  const headers = (rows[0] ?? []).map((header) => header.trim()).filter(Boolean);
  if (headers.length === 0) {
    return null;
  }
  return {
    headers,
    rows: rows.slice(1).map((row) =>
      Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])),
    ),
  };
}

function parseCsvRows(text: string, maxRows: number) {
  const delimiter = detectCsvDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      if (row.some((value) => value.trim())) {
        rows.push(row);
      }
      if (rows.length >= maxRows) {
        return rows;
      }
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }

  row.push(cell);
  if (row.some((value) => value.trim())) {
    rows.push(row);
  }
  return rows.slice(0, maxRows);
}

function detectCsvDelimiter(text: string) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) ?? "";
  const candidates = [",", ";", "\t", "|"];
  return candidates
    .map((delimiter) => ({
      delimiter,
      score: firstLine.split(delimiter).length,
    }))
    .sort((left, right) => right.score - left.score)[0]?.delimiter ?? ",";
}

function normalizeImportHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function inferImportSourceName(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.includes("tradezella")) {
    return "TradeZella";
  }
  if (lower.includes("tradingview")) {
    return "TradingView";
  }
  if (lower.includes("ninjatrader")) {
    return "NinjaTrader";
  }
  if (lower.includes("tradovate")) {
    return "Tradovate";
  }
  return "";
}

function importErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected import error";
}

function DayViewPage({
  currency,
  datasets,
  days,
  onInspectTrade,
  onOpenTradeNote,
  onReplayTrade,
  sessionById,
}: SharedPageProps) {
  const [mode, setMode] = useState<DayViewMode>("day");
  const [selectedDate, setSelectedDate] = useState(() => days[0]?.date ?? "");
  const [calendarMonth, setCalendarMonth] = useState(() => monthCursorFromDateKey(days[0]?.date));
  const [noteEditing, setNoteEditing] = useState(false);
  const [notesByPeriod, setNotesByPeriod] = useState<DayViewNoteMap>(() =>
    sanitizeDayViewNotes(getCachedAppStorageItem<unknown>(BACKTEST_DAY_NOTES_STORAGE_KEY, {})),
  );
  const periods = useMemo(() => buildDayViewPeriods(days, mode), [days, mode]);
  const selectedPeriod = useMemo(
    () => findDayViewPeriod(periods, selectedDate, mode),
    [mode, periods, selectedDate],
  );
  const selectedPeriodCurrency = useMemo(
    () =>
      selectedPeriod
        ? currencyForTrades(selectedPeriod.trades, sessionById, datasets, currency)
        : currency,
    [currency, datasets, selectedPeriod, sessionById],
  );
  const selectedRange =
    mode === "week" && selectedPeriod
      ? { start: selectedPeriod.startDate, end: selectedPeriod.endDate }
      : null;
  const noteKey = selectedPeriod ? `${mode}:${selectedPeriod.startDate}` : "";
  const savedNote = noteKey ? notesByPeriod[noteKey] ?? "" : "";
  const [noteDraft, setNoteDraft] = useState(savedNote);

  useEffect(() => {
    let active = true;
    void loadAppStorageItem<unknown>(BACKTEST_DAY_NOTES_STORAGE_KEY, {}).then((value) => {
      if (active) {
        setNotesByPeriod(sanitizeDayViewNotes(value));
      }
    });
    const unsubscribe = subscribeAppStorageItem<unknown>(
      BACKTEST_DAY_NOTES_STORAGE_KEY,
      (value) => setNotesByPeriod(sanitizeDayViewNotes(value)),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (days.length === 0) {
      if (selectedDate) {
        setSelectedDate("");
      }
      return;
    }
    if (!days.some((day) => day.date === selectedDate)) {
      const nextDate = days[0].date;
      setSelectedDate(nextDate);
      setCalendarMonth(monthCursorFromDateKey(nextDate));
    }
  }, [days, selectedDate]);

  useEffect(() => {
    setNoteDraft(savedNote);
    setNoteEditing(false);
  }, [noteKey, savedNote]);

  function selectDate(date: string) {
    if (!days.some((day) => day.date === date)) {
      return;
    }
    setSelectedDate(date);
    setCalendarMonth(monthCursorFromDateKey(date));
  }

  function selectPeriod(period: DayViewPeriod) {
    selectDate(period.days[0]?.date ?? period.endDate);
  }

  async function persistNote(nextNote: string) {
    if (!noteKey) {
      return;
    }
    const trimmed = nextNote.trim();
    const nextNotes = { ...notesByPeriod };
    if (trimmed) {
      nextNotes[noteKey] = trimmed;
    } else {
      delete nextNotes[noteKey];
    }
    setNotesByPeriod(nextNotes);
    setNoteEditing(false);
    await saveAppStorageItem(BACKTEST_DAY_NOTES_STORAGE_KEY, nextNotes);
  }

  function exportSelectedPeriodCsv() {
    if (!selectedPeriod) {
      return;
    }
    exportTradeLogCsv(selectedPeriod.trades, sessionById, datasets);
  }

  return (
    <PageScaffold
      eyebrow="Backtest Day View"
      title="Backtest Daily Review"
      description="Review replay results by day or week, add persistent review notes, and jump into the trades behind each period."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-white/10 bg-black/20 p-1">
            <TinyTab active={mode === "day"} onClick={() => setMode("day")}>Day</TinyTab>
            <TinyTab active={mode === "week"} onClick={() => setMode("week")}>Week</TinyTab>
          </div>
          <button
            className="control-button"
            disabled={!selectedPeriod || selectedPeriod.trades.length === 0}
            onClick={exportSelectedPeriodCsv}
            type="button"
          >
            <FileDown size={15} />
            Export CSV
          </button>
        </div>
      }
    >
      {selectedPeriod ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <FeatureCard>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                    {mode === "week" ? "Selected week" : "Selected day"}
                  </div>
                  <h2 className="mt-1 truncate text-xl font-semibold text-white">{selectedPeriod.label}</h2>
                  <div className="mt-1 text-sm text-slate-500">{selectedPeriod.sublabel}</div>
                  <div className={`mt-2 text-sm font-semibold ${toneForNumber(selectedPeriod.aggregate.netPnl)}`}>
                    Net P&L {formatMoney(selectedPeriod.aggregate.netPnl, selectedPeriodCurrency)}
                  </div>
                </div>
                <button className="control-button h-9" onClick={() => setNoteEditing(true)} type="button">
                  <NotebookPen size={14} />
                  {savedNote ? "Edit note" : "Add note"}
                </button>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.58fr)_minmax(280px,0.42fr)]">
                <AreaSparkline currency={selectedPeriodCurrency} values={cumulativeValues(selectedPeriod.trades)} height={190} />
                <div className="grid grid-cols-2 gap-2">
                  <CompactMetric label="Trades" value={String(selectedPeriod.aggregate.totalTrades)} />
                  <CompactMetric label="Net P&L" value={formatMoney(selectedPeriod.aggregate.netPnl, selectedPeriodCurrency)} tone={toneForNumber(selectedPeriod.aggregate.netPnl)} />
                  <CompactMetric label="Winners" value={String(selectedPeriod.aggregate.wins)} tone="text-emerald-300" />
                  <CompactMetric label="Losers" value={String(selectedPeriod.aggregate.losses)} tone="text-rose-300" />
                  <CompactMetric label="Win rate" value={formatPercent(selectedPeriod.aggregate.winRate)} />
                  <CompactMetric label="Profit factor" value={formatRatio(selectedPeriod.aggregate.profitFactor)} />
                  <CompactMetric label="Avg R" value={formatOptionalNumber(selectedPeriod.aggregate.averageR)} />
                  <CompactMetric label="Avg hold" value={formatMinutes(selectedPeriod.aggregate.averageHoldMinutes)} />
                </div>
              </div>

              {(noteEditing || savedNote) && (
                <div className="mt-4 rounded-md border border-white/10 bg-black/20 p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <CardLabel icon={NotebookPen} label={`${mode === "week" ? "Weekly" : "Daily"} note`} />
                    {!noteEditing && (
                      <button className="control-button h-8 px-2 text-xs" onClick={() => setNoteEditing(true)} type="button">
                        <Pencil size={13} />
                        Edit
                      </button>
                    )}
                  </div>
                  {noteEditing ? (
                    <div className="grid gap-2">
                      <textarea
                        className="input-control min-h-28 resize-y normal-case leading-6 tracking-normal"
                        onChange={(event) => setNoteDraft(event.target.value)}
                        placeholder="What happened in this period? What should carry into the next replay?"
                        value={noteDraft}
                      />
                      <div className="flex flex-wrap justify-end gap-2">
                        <button className="control-button" onClick={() => {
                          setNoteDraft(savedNote);
                          setNoteEditing(false);
                        }} type="button">
                          Cancel
                        </button>
                        <button className="control-button" disabled={!savedNote} onClick={() => void persistNote("")} type="button">
                          <Trash2 size={14} />
                          Clear
                        </button>
                        <button className="control-button workspace-tab-active" disabled={noteDraft.trim() === savedNote.trim()} onClick={() => void persistNote(noteDraft)} type="button">
                          <Save size={14} />
                          Save note
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">{savedNote}</p>
                  )}
                </div>
              )}
            </FeatureCard>

            {mode === "week" && (
              <FeatureCard>
                <CardLabel icon={CalendarDays} label="Week breakdown" />
                <div className="mt-3 grid gap-2">
                  {selectedPeriod.days.map((day) => (
                    <button
                      className={`grid gap-2 rounded-md border px-3 py-2 text-left transition sm:grid-cols-[minmax(0,1fr)_120px_88px] sm:items-center ${
                        day.date === selectedDate
                          ? "border-cyan-300/30 bg-cyan-300/10"
                          : "border-white/10 bg-black/20 hover:border-white/20"
                      }`}
                      key={day.date}
                      onClick={() => selectDate(day.date)}
                      type="button"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-white">{day.label}</span>
                        <span className="text-xs text-slate-500">{day.aggregate.totalTrades} trades</span>
                      </span>
                      <span className={`text-sm font-semibold tabular-nums ${toneForNumber(day.aggregate.netPnl)}`}>
                        {formatMoney(day.aggregate.netPnl, currencyForTrades(day.trades, sessionById, datasets, selectedPeriodCurrency))}
                      </span>
                      <span className="text-xs text-slate-500">{formatPercent(day.aggregate.winRate)}</span>
                    </button>
                  ))}
                </div>
              </FeatureCard>
            )}

            <FeatureCard>
              <div className="flex items-center justify-between gap-3">
                <CardLabel icon={ClipboardList} label={`${mode === "week" ? "Period" : "Day"} trades`} />
                <span className="status-pill">{selectedPeriod.trades.length} closed</span>
              </div>
              <div className="mt-3 overflow-auto">
                <table className="w-full min-w-[820px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-[0.16em] text-slate-500">
                    <tr>
                      <th className="px-3 py-3 font-medium">Trade</th>
                      <th className="px-3 py-3 font-medium">Entry</th>
                      <th className="px-3 py-3 font-medium">Exit</th>
                      <th className="px-3 py-3 font-medium">P&L</th>
                      <th className="px-3 py-3 font-medium">R</th>
                      <th className="px-3 py-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedPeriod.trades.slice().sort(compareTradesAscending).map((trade) => (
                      <tr className="border-t border-white/10 text-slate-300" key={trade.id}>
                        <td className="px-3 py-3">
                          <div className="font-semibold text-white">
                            {tradeSymbol(trade, sessionById)} {trade.side}
                          </div>
                          <div className="text-xs text-slate-500">{tradeStrategyName(trade, sessionById.get(trade.session_id))}</div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="font-semibold text-slate-100">{formatPrice(trade.entry_price)}</div>
                          <div className="text-xs text-slate-500">{formatDateTime(trade.entry_time)}</div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="font-semibold text-slate-100">{formatPrice(trade.exit_price)}</div>
                          <div className="text-xs text-slate-500">{formatDateTime(trade.exit_time)}</div>
                        </td>
                        <td className={`px-3 py-3 font-semibold ${toneForNumber(trade.realized_pnl)}`}>
                          {formatMoney(
                            trade.realized_pnl,
                            currencyForSession(sessionById.get(trade.session_id), datasets),
                          )}
                        </td>
                        <td className="px-3 py-3 text-slate-200">{formatOptionalNumber(trade.r_multiple)}</td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button className="control-button h-9 px-2 text-xs" onClick={() => onOpenTradeNote(trade)} type="button">
                              <NotebookPen size={13} />
                              Review
                            </button>
                            <button className="control-button h-9 px-2 text-xs" onClick={() => onInspectTrade(trade)} type="button">
                              <Eye size={13} />
                              Snapshot
                            </button>
                            <button className="control-button h-9 px-2 text-xs" onClick={() => void onReplayTrade(trade)} type="button">
                              <PlaySquare size={13} />
                              Replay
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </FeatureCard>
          </div>

          <div className="space-y-4">
            <FeatureCard>
              <CardLabel icon={CalendarDays} label="Calendar navigator" />
              <div className="mt-4">
                <CalendarHeatmap
                  compact
                  currency={currency}
                  days={days}
                  month={calendarMonth}
                  onMonthChange={setCalendarMonth}
                  onSelectDate={selectDate}
                  selectedDate={mode === "day" ? selectedDate : null}
                  selectedRange={selectedRange}
                />
              </div>
            </FeatureCard>

            <FeatureCard>
              <CardLabel icon={mode === "week" ? CalendarDays : ClipboardList} label={mode === "week" ? "Trading weeks" : "Trading days"} />
              <div className="mt-3 grid max-h-[420px] gap-2 overflow-auto pr-1">
                {periods.map((period) => {
                  const active = period.id === selectedPeriod.id;
                  const periodCurrency = currencyForTrades(period.trades, sessionById, datasets, currency);
                  return (
                    <button
                      className={`rounded-md border px-3 py-2 text-left transition ${
                        active
                          ? "border-cyan-300/30 bg-cyan-300/10"
                          : "border-white/10 bg-black/20 hover:border-white/20"
                      }`}
                      key={period.id}
                      onClick={() => selectPeriod(period)}
                      type="button"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-white">{period.label}</span>
                          <span className="text-xs text-slate-500">{period.sublabel}</span>
                        </span>
                        <span className={`shrink-0 text-sm font-semibold tabular-nums ${toneForNumber(period.aggregate.netPnl)}`}>
                          {formatMoney(period.aggregate.netPnl, periodCurrency)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </FeatureCard>
          </div>
        </div>
      ) : (
        <EmptyState icon={CalendarDays} message="Closed trades will create daily review cards." />
      )}
    </PageScaffold>
  );
}

function TradeViewPage({
  closedTrades,
  currency,
  datasets,
  onTradeViewFiltersChange,
  onTradeViewLogScrollChange,
  onTradeViewLogScrollRestored,
  onOpenTradeNote,
  sessionById,
  strategies,
  tradeViewFilters,
  tradeViewLogScrollTop,
}: SharedPageProps) {
  const {
    dateFrom,
    dateTo,
    instrumentFilter,
    searchTerm,
    sessionFilter,
    sideFilter,
    strategyFilter,
    tagFilter,
  } = tradeViewFilters;
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
  const filteredCurrency = useMemo(
    () => currencyForFilteredScope(filteredTrades, sessionById, datasets, currency, tradeViewFilters),
    [currency, datasets, filteredTrades, sessionById, tradeViewFilters],
  );
  const filtersActive =
    sessionFilter !== "ALL" ||
    instrumentFilter !== "ALL" ||
    sideFilter !== "ALL" ||
    strategyFilter !== "ALL" ||
    tagFilter !== "ALL" ||
    Boolean(dateFrom || dateTo || searchTerm.trim());

  function updateFilter<K extends keyof TradeViewFilterState>(
    key: K,
    value: TradeViewFilterState[K],
  ) {
    onTradeViewFiltersChange((current) => ({ ...current, [key]: value }));
  }

  function resetFilters() {
    onTradeViewFiltersChange(DEFAULT_TRADE_VIEW_FILTERS);
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
          <FileDown size={15} />
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
                  onChange={(event) => updateFilter("searchTerm", event.target.value)}
                  placeholder="Instrument, strategy, note, tag..."
                  value={searchTerm}
                />
              </div>
            </label>
            <label className="form-field">
              Session
              <ThemedSelect className="h-10" onChange={(value) => updateFilter("sessionFilter", value)} options={sessionOptions} portal value={sessionFilter} />
            </label>
            <label className="form-field">
              Instrument
              <ThemedSelect className="h-10" onChange={(value) => updateFilter("instrumentFilter", value)} options={instrumentOptions} portal value={instrumentFilter} />
            </label>
            <label className="form-field">
              Direction
              <ThemedSelect
                className="h-10"
                onChange={(value) => updateFilter("sideFilter", value)}
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
              <ThemedSelect className="h-10" onChange={(value) => updateFilter("strategyFilter", value)} options={strategyOptions} portal value={strategyFilter} />
            </label>
          </div>
          <div className="grid gap-2 md:grid-cols-[minmax(160px,0.75fr)_repeat(2,minmax(140px,0.55fr))_auto]">
            <label className="form-field">
              Tags
              <ThemedSelect className="h-10" onChange={(value) => updateFilter("tagFilter", value)} options={tagOptions} portal value={tagFilter} />
            </label>
            <label className="form-field">
              From
              <ThemedDatePicker ariaLabel="Filter trades from date" onChange={(value) => updateFilter("dateFrom", value)} placeholder="From date" value={dateFrom} />
            </label>
            <label className="form-field">
              To
              <ThemedDatePicker ariaLabel="Filter trades to date" onChange={(value) => updateFilter("dateTo", value)} placeholder="To date" value={dateTo} />
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
            <CompactMetric label="Net P&L" value={formatMoney(filteredAggregate.netPnl, filteredCurrency)} tone={toneForNumber(filteredAggregate.netPnl)} />
            <CompactMetric label="Win rate" value={formatPercent(filteredAggregate.winRate)} />
            <CompactMetric label="Avg R" value={formatOptionalNumber(filteredAggregate.averageR)} />
            <CompactMetric label="Profit factor" value={formatRatio(filteredAggregate.profitFactor)} />
          </div>
        </div>
        <TradeLog
          currency={filteredCurrency}
          onScrollTopChange={onTradeViewLogScrollChange}
          onScrollTopRestored={onTradeViewLogScrollRestored}
          restoreScrollTop={tradeViewLogScrollTop}
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
  const [sessionTradeEntryId, setSessionTradeEntryId] = useState<number | null>(null);
  const [focusedJournalNoteTradeId, setFocusedJournalNoteTradeId] = useState<number | null>(null);
  const [journalNoteReturnView, setJournalNoteReturnView] = useState<typeof view | null>(null);
  const journalPageScrollRef = useRef(0);
  const journalLedgerScrollRef = useRef<ScrollSnapshot>({ left: 0, top: 0 });
  const pendingJournalPageScrollRestoreRef = useRef<number | null>(null);
  const pendingJournalLedgerScrollRestoreRef = useRef<ScrollSnapshot | null>(null);
  const sessionById = useMemo(
    () => new Map(journal.data.sessions.map((session) => [session.id, session])),
    [journal.data.sessions],
  );
  const journalEntries = useMemo(
    () =>
      journal.data.trades
        .filter((trade) => trade.status === "CLOSED")
        .slice()
        .sort(compareTradesAscending),
    [journal.data.trades],
  );
  const closedTrades = useMemo(
    () => journalEntries.filter(isTakenJournalTrade),
    [journalEntries],
  );
  const aggregate = useMemo(() => aggregateTrades(closedTrades), [closedTrades]);
  const days = useMemo(() => groupTradesByDay(closedTrades), [closedTrades]);
  const strategies = useMemo(
    () => groupLiveStrategies(journal.data.sessions, journalEntries),
    [journal.data.sessions, journalEntries],
  );

  function openJournalNote(trade: JournalTrade) {
    journalPageScrollRef.current = window.scrollY;
    setFocusedJournalNoteTradeId(trade.id);
    setJournalNoteReturnView(view);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeFocusedJournalNote() {
    pendingJournalPageScrollRestoreRef.current = journalPageScrollRef.current;
    pendingJournalLedgerScrollRestoreRef.current = journalLedgerScrollRef.current;
    setFocusedJournalNoteTradeId(null);
    setJournalNoteReturnView(null);
  }

  function handleJournalLedgerScroll(position: ScrollSnapshot) {
    journalLedgerScrollRef.current = position;
  }

  function clearJournalLedgerScrollRestore() {
    pendingJournalLedgerScrollRestoreRef.current = null;
  }

  const shared = {
    accounts: journal.data.accounts,
    aggregate,
    closedTrades,
    days,
    journal,
    journalLedgerRestoreScroll: pendingJournalLedgerScrollRestoreRef.current,
    journalEntries,
    onJournalLedgerScrollChange: handleJournalLedgerScroll,
    onJournalLedgerScrollRestored: clearJournalLedgerScrollRestore,
    onOpenJournalNote: openJournalNote,
    playbooks: journal.data.playbooks,
    settings: journal.data.settings,
    sessionById,
    sessions: journal.data.sessions,
    strategies,
  };

  useEffect(() => {
    if (view !== "journalSessions") {
      setSessionTradeEntryId(null);
    }
    setFocusedJournalNoteTradeId(null);
    setJournalNoteReturnView(null);
    pendingJournalPageScrollRestoreRef.current = null;
    pendingJournalLedgerScrollRestoreRef.current = null;
  }, [view]);

  useEffect(() => {
    if (sessionTradeEntryId != null && !journal.data.sessions.some((session) => session.id === sessionTradeEntryId)) {
      setSessionTradeEntryId(null);
    }
  }, [journal.data.sessions, sessionTradeEntryId]);

  useEffect(() => {
    if (focusedJournalNoteTradeId != null && !journalEntries.some((trade) => trade.id === focusedJournalNoteTradeId)) {
      setFocusedJournalNoteTradeId(null);
      setJournalNoteReturnView(null);
    }
  }, [focusedJournalNoteTradeId, journalEntries]);

  useEffect(() => {
    if (focusedJournalNoteTradeId != null || pendingJournalPageScrollRestoreRef.current == null) {
      return;
    }
    const scrollTop = pendingJournalPageScrollRestoreRef.current;
    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        window.scrollTo({ top: scrollTop });
        pendingJournalPageScrollRestoreRef.current = null;
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [focusedJournalNoteTradeId, sessionTradeEntryId, view]);

  if (focusedJournalNoteTradeId != null) {
    return (
      <JournalNotesPage
        {...shared}
        backLabel={`Back to ${journalViewLabel(journalNoteReturnView ?? view)}`}
        focusTradeId={focusedJournalNoteTradeId}
        onBack={closeFocusedJournalNote}
      />
    );
  }

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
      return sessionTradeEntryId == null
        ? <JournalSessionsPage {...shared} onOpenSessionTrades={setSessionTradeEntryId} />
        : <JournalSessionTradeEntryPage {...shared} onBack={() => setSessionTradeEntryId(null)} sessionId={sessionTradeEntryId} />;
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
  accounts: LiveJournalAccount[];
  aggregate: Aggregate;
  closedTrades: JournalTrade[];
  days: DayGroup[];
  journal: LiveJournalController;
  journalLedgerRestoreScroll: ScrollSnapshot | null;
  journalEntries: JournalTrade[];
  onJournalLedgerScrollChange: (position: ScrollSnapshot) => void;
  onJournalLedgerScrollRestored: () => void;
  onOpenJournalNote: (trade: JournalTrade) => void;
  playbooks: Playbook[];
  settings: LiveJournalSettings;
  sessionById: Map<number, LiveJournalSession>;
  sessions: LiveJournalSession[];
  strategies: LiveStrategyGroup[];
};

function JournalAccountBadge({
  account,
  compact = false,
}: {
  account: LiveJournalAccount;
  compact?: boolean;
}) {
  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1.5 rounded border border-white/10 bg-black/30 font-semibold text-slate-200 ${
        compact ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-xs"
      }`}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: account.color }} />
      <span className="truncate">{account.name}</span>
      {!compact && <span className="text-slate-600">{account.currency}</span>}
    </span>
  );
}

function JournalAccountToggle({
  account,
  active,
  onClick,
}: {
  account: LiveJournalAccount;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex min-w-0 items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left transition ${
        active
          ? "border-cyan-300/35 bg-cyan-300/10 text-cyan-50 shadow-[0_0_0_1px_rgba(103,232,249,0.08)]"
          : "border-white/10 bg-black/20 text-slate-400 hover:border-white/20 hover:bg-white/5 hover:text-white"
      }`}
      onClick={onClick}
      type="button"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          className="h-3 w-3 shrink-0 rounded-full ring-2 ring-black/40"
          style={{ backgroundColor: account.color }}
        />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{account.name}</span>
          <span className="block truncate text-xs text-slate-500">
            {account.broker || "Manual"} · {account.currency}
          </span>
        </span>
      </span>
      <span
        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
          active ? "border-cyan-200 bg-cyan-200 text-ink-950" : "border-white/15 text-transparent"
        }`}
      >
        <CheckCircle2 size={13} />
      </span>
    </button>
  );
}

function journalViewLabel(view: string) {
  switch (view) {
    case "journalAccounts":
      return "Journal Accounts";
    case "journalDashboard":
      return "Journal Dashboard";
    case "journalDayView":
      return "Journal Day View";
    case "journalNotes":
      return "Journal Notes";
    case "journalPlaybooks":
      return "Journal Playbooks";
    case "journalReports":
      return "Journal Results";
    case "journalSessions":
      return "Journal Sessions";
    case "journalSettings":
      return "Journal Settings";
    case "journalStrategies":
      return "Journal Strategies";
    case "journalTrades":
      return "Journal Trades";
    default:
      return "Journal";
  }
}

function JournalBooleanToggle({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description?: string;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      aria-pressed={checked}
      className={`flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition ${
        checked
          ? "border-cyan-300/35 bg-cyan-300/10 text-cyan-50"
          : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:bg-white/10"
      }`}
      onClick={() => onChange(!checked)}
      type="button"
    >
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-md border ${
          checked ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-100" : "border-white/10 bg-black/20 text-slate-500"
        }`}
      >
        <CheckCircle2 size={16} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-white">{label}</span>
        {description && <span className="mt-0.5 block text-xs leading-5 text-slate-500">{description}</span>}
      </span>
    </button>
  );
}

function journalStrategySelectOptions(strategyNames: string[], value: string) {
  const options = uniqueStrings(["Unassigned", ...strategyNames])
    .filter(Boolean)
    .map((strategyName) => ({ label: strategyName, value: strategyName }));
  return selectOptionsWithValue(options, value || "Unassigned");
}

function normalizeLiveJournalStrategyName(value: string | null | undefined, fallback = "Unassigned") {
  const name = normalizeBacktestStrategyName(value ?? "");
  if (!name || sameStrategyName(name, "Discretionary")) {
    return fallback;
  }
  return name;
}

function costFixedValueForMode(mode: OrderCommissionMode, value: number) {
  return mode === "FIXED" ? formatNumberInput(value) : "0";
}

function costPercentValueForMode(mode: OrderCommissionMode, value: number) {
  return mode === "PERCENT" ? formatNumberInput(value) : "0";
}

function formatCostDefault(mode: OrderCommissionMode, value: number, currency: string) {
  if (mode === "NONE") {
    return "None";
  }
  if (mode === "PERCENT") {
    return `${formatNumberInput(value)}%`;
  }
  return formatMoney(value, currency);
}

function JournalSessionsPage({
  accounts,
  journal,
  journalEntries,
  onOpenSessionTrades,
  playbooks,
  sessions,
  settings,
  strategies,
}: JournalPageProps & { onOpenSessionTrades: (sessionId: number) => void }) {
  const { confirm, confirmDialog } = useThemedConfirm();
  const savedStrategyNames = useLiveJournalStrategyNames();
  const strategyNameOptions = useMemo(
    () => mergeLiveStrategyGroups(strategies, savedStrategyNames).map((strategy) => strategy.name),
    [savedStrategyNames, strategies],
  );
  const [name, setName] = useState("Live Trading Session");
  const [strategy, setStrategy] = useState("Unassigned");
  const [instrument, setInstrument] = useState("OANDA:EURUSD");
  const [currency, setCurrency] = useState(settings.default_currency);
  const [createCommissionMode, setCreateCommissionMode] = useState<OrderCommissionMode>(settings.default_commission_mode);
  const [createCommissionFixed, setCreateCommissionFixed] = useState(costFixedValueForMode(settings.default_commission_mode, settings.default_commission_value));
  const [createCommissionPercent, setCreateCommissionPercent] = useState(costPercentValueForMode(settings.default_commission_mode, settings.default_commission_value));
  const [createBrokerageMode, setCreateBrokerageMode] = useState<OrderCommissionMode>(settings.default_fee_mode);
  const [createBrokerageFixed, setCreateBrokerageFixed] = useState(costFixedValueForMode(settings.default_fee_mode, settings.default_fee_value));
  const [createBrokeragePercent, setCreateBrokeragePercent] = useState(costPercentValueForMode(settings.default_fee_mode, settings.default_fee_value));
  const [playbookId, setPlaybookId] = useState("");
  const [notes, setNotes] = useState("");
  const createStrategyOptions = useMemo(
    () => journalStrategySelectOptions(strategyNameOptions, strategy),
    [strategy, strategyNameOptions],
  );
  const playbookById = useMemo(
    () => new Map(playbooks.map((playbook) => [playbook.id, playbook])),
    [playbooks],
  );
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(sessions[0]?.id ?? null);
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? sessions[0] ?? null;
  const [editDraft, setEditDraft] = useState({
    brokerageFixed: costFixedValueForMode(selectedSession?.brokerage_mode ?? settings.default_fee_mode, selectedSession?.brokerage_value ?? settings.default_fee_value),
    brokerageMode: selectedSession?.brokerage_mode ?? settings.default_fee_mode,
    brokeragePercent: costPercentValueForMode(selectedSession?.brokerage_mode ?? settings.default_fee_mode, selectedSession?.brokerage_value ?? settings.default_fee_value),
    commissionFixed: costFixedValueForMode(selectedSession?.commission_mode ?? settings.default_commission_mode, selectedSession?.commission_value ?? settings.default_commission_value),
    commissionMode: selectedSession?.commission_mode ?? settings.default_commission_mode,
    commissionPercent: costPercentValueForMode(selectedSession?.commission_mode ?? settings.default_commission_mode, selectedSession?.commission_value ?? settings.default_commission_value),
    currency: selectedSession?.currency ?? settings.default_currency,
    instrument: selectedSession?.instrument ?? "Manual",
    name: selectedSession?.name ?? "Live Trading Session",
    notes: selectedSession?.notes ?? "",
    playbookId: selectedSession?.playbook_id == null ? "" : String(selectedSession.playbook_id),
    strategy: selectedSession?.strategy_name ?? "Unassigned",
  });
  const editStrategyOptions = useMemo(
    () => journalStrategySelectOptions(strategyNameOptions, editDraft.strategy),
    [editDraft.strategy, strategyNameOptions],
  );
  const [showSessionSettings, setShowSessionSettings] = useState(false);
  const selectedSessionCardRef = useRef<HTMLDivElement | null>(null);
  const sessionRows = useMemo(
    () =>
      sessions.map((session) => {
        const entries = journalEntries.filter((trade) => trade.session_id === session.id);
        const takenTrades = entries.filter(isTakenJournalTrade);
        const missedTrades = entries.filter(isMissedJournalTrade);
        return {
          aggregate: aggregateTrades(takenTrades),
          entries,
          missedTrades,
          session,
          takenTrades,
        };
      }),
    [journalEntries, sessions],
  );
  const totalTakenTrades = sessionRows.reduce((sum, row) => sum + row.takenTrades.length, 0);
  const totalMissedSetups = sessionRows.reduce((sum, row) => sum + row.missedTrades.length, 0);
  const selectedSessionRow = selectedSession
    ? sessionRows.find((row) => row.session.id === selectedSession.id) ?? null
    : null;
  const selectedSessionCurrency = selectedSession?.currency ?? settings.default_currency;

  useEffect(() => {
    if (!selectedSession && sessions[0]) {
      setSelectedSessionId(sessions[0].id);
    }
  }, [selectedSession, sessions]);

  useEffect(() => {
    if (!selectedSession) {
      return;
    }
    setEditDraft({
      brokerageFixed: costFixedValueForMode(selectedSession.brokerage_mode, selectedSession.brokerage_value),
      brokerageMode: selectedSession.brokerage_mode,
      brokeragePercent: costPercentValueForMode(selectedSession.brokerage_mode, selectedSession.brokerage_value),
      commissionFixed: costFixedValueForMode(selectedSession.commission_mode, selectedSession.commission_value),
      commissionMode: selectedSession.commission_mode,
      commissionPercent: costPercentValueForMode(selectedSession.commission_mode, selectedSession.commission_value),
      currency: selectedSession.currency ?? settings.default_currency,
      instrument: selectedSession.instrument ?? "Manual",
      name: selectedSession.name,
      notes: selectedSession.notes ?? "",
      playbookId: selectedSession.playbook_id == null ? "" : String(selectedSession.playbook_id),
      strategy: selectedSession.strategy_name ?? "Unassigned",
    });
  }, [selectedSession, settings.default_currency]);

  useEffect(() => {
    setCurrency(settings.default_currency);
    setCreateCommissionMode(settings.default_commission_mode);
    setCreateCommissionFixed(costFixedValueForMode(settings.default_commission_mode, settings.default_commission_value));
    setCreateCommissionPercent(costPercentValueForMode(settings.default_commission_mode, settings.default_commission_value));
    setCreateBrokerageMode(settings.default_fee_mode);
    setCreateBrokerageFixed(costFixedValueForMode(settings.default_fee_mode, settings.default_fee_value));
    setCreateBrokeragePercent(costPercentValueForMode(settings.default_fee_mode, settings.default_fee_value));
  }, [
    settings.default_commission_mode,
    settings.default_commission_value,
    settings.default_currency,
    settings.default_fee_mode,
    settings.default_fee_value,
  ]);

  function editSession(sessionId: number) {
    setSelectedSessionId(sessionId);
    setShowSessionSettings(true);
    requestAnimationFrame(() => {
      selectedSessionCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function submitSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    journal.addSession({
      account: "Manual",
      account_ids: [],
      brokerage_mode: createBrokerageMode,
      brokerage_value: costValueForPayload(createBrokerageMode, createBrokerageFixed, createBrokeragePercent),
      commission_mode: createCommissionMode,
      commission_value: costValueForPayload(createCommissionMode, createCommissionFixed, createCommissionPercent),
      currency: normalizeCurrencyCode(currency),
      initial_balance: 0,
      instrument: instrument.trim() || "Manual",
      name: name.trim() || "Live Trading Session",
      notes: notes.trim(),
      playbook_id: playbookId ? Number(playbookId) : null,
      strategy_name: normalizeLiveJournalStrategyName(strategy),
    });
    setName("Live Trading Session");
    setNotes("");
  }

  function saveSelectedSession() {
    if (!selectedSession) {
      return;
    }
    journal.updateSession(selectedSession.id, {
      account: "Manual",
      account_ids: [],
      brokerage_mode: editDraft.brokerageMode,
      brokerage_value: costValueForPayload(editDraft.brokerageMode, editDraft.brokerageFixed, editDraft.brokeragePercent),
      commission_mode: editDraft.commissionMode,
      commission_value: costValueForPayload(editDraft.commissionMode, editDraft.commissionFixed, editDraft.commissionPercent),
      currency: normalizeCurrencyCode(editDraft.currency),
      initial_balance: selectedSession.initial_balance,
      instrument: editDraft.instrument,
      name: editDraft.name,
      notes: editDraft.notes,
      playbook_id: editDraft.playbookId ? Number(editDraft.playbookId) : null,
      strategy_name: editDraft.strategy,
    });
    setShowSessionSettings(false);
  }

  async function handleDeleteSession(session: LiveJournalSession) {
    const row = sessionRows.find((sessionRow) => sessionRow.session.id === session.id);
    const entryCount = row?.entries.length ?? 0;
    const confirmed = await confirm({
      confirmLabel: "Delete session",
      detail: entryCount > 0
        ? `This removes ${entryCount} Journal ${entryCount === 1 ? "entry" : "entries"} attached to this live session.`
        : "This removes the session setup. No Journal entries are attached.",
      message: (
        <>
          Delete <span className="font-semibold text-white">{session.name}</span>?
        </>
      ),
      title: "Delete journal session",
      tone: "danger",
    });
    if (confirmed) {
      journal.deleteSession(session.id);
      setShowSessionSettings((current) => selectedSession?.id === session.id ? false : current);
    }
  }

  return (
    <PageScaffold
      eyebrow="Journal Sessions"
      title="Select a Live Session"
      description="Choose a session to open a focused trade-entry workspace, or manage session setup and defaults here."
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ResultMetricCard icon={PlaySquare} label="Sessions" value={String(sessions.length)} />
        <ResultMetricCard icon={ClipboardList} label="Taken trades" value={String(totalTakenTrades)} />
        <ResultMetricCard icon={Clock3} label="Missed setups" value={String(totalMissedSetups)} />
        <ResultMetricCard icon={WalletCards} label="Trade accounts" value={String(accounts.filter((account) => account.status === "ACTIVE").length)} />
      </div>
      <div className="grid gap-4">
        <FeatureCard>
          <CardLabel icon={Plus} label="Create session" />
          <form className="mt-4 grid gap-4" onSubmit={submitSession}>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <label className="form-field">
                Session name
                <input className="input-control h-10 normal-case tracking-normal" onChange={(event) => setName(event.target.value)} value={name} />
              </label>
              <label className="form-field">
                Strategy
                <ThemedSelect
                  className="h-10"
                  onChange={setStrategy}
                  options={createStrategyOptions}
                  portal
                  value={strategy}
                />
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
                Currency
                <ThemedSelect
                  className="h-10"
                  onChange={setCurrency}
                  options={selectOptionsWithValue(CURRENCY_OPTIONS, currency)}
                  portal
                  value={currency}
                />
              </label>
            </div>
            <div className="rounded-md border border-white/10 bg-black/20 p-3">
              <div className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                Session trade costs
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <CostConfigCard
                  fixedValue={createCommissionFixed}
                  mode={createCommissionMode}
                  onFixedValueChange={setCreateCommissionFixed}
                  onModeChange={setCreateCommissionMode}
                  onPercentValueChange={setCreateCommissionPercent}
                  percentValue={createCommissionPercent}
                  title="Commission default"
                />
                <CostConfigCard
                  fixedValue={createBrokerageFixed}
                  mode={createBrokerageMode}
                  onFixedValueChange={setCreateBrokerageFixed}
                  onModeChange={setCreateBrokerageMode}
                  onPercentValueChange={setCreateBrokeragePercent}
                  percentValue={createBrokeragePercent}
                  title="Brokerage default"
                />
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
              <label className="form-field">
                Notes
                <textarea className="input-control min-h-20 py-3 normal-case tracking-normal" onChange={(event) => setNotes(event.target.value)} value={notes} />
              </label>
              <div className="flex items-end">
                <button className="control-button workspace-tab-active h-10 w-full justify-center" type="submit">
                  <Plus size={15} />
                  Save session
                </button>
              </div>
            </div>
          </form>
        </FeatureCard>
        <FeatureCard>
          <div className="mb-4 flex items-center justify-between gap-3">
            <CardLabel icon={PlaySquare} label="Live sessions" />
          </div>
          <div className="overflow-auto">
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-3 py-3 font-medium">Session</th>
                  <th className="px-3 py-3 font-medium">Instrument</th>
                  <th className="px-3 py-3 font-medium">Strategy</th>
                  <th className="px-3 py-3 font-medium">Playbook</th>
                  <th className="px-3 py-3 font-medium">Trades</th>
                  <th className="px-3 py-3 font-medium">Missed</th>
                  <th className="px-3 py-3 font-medium">Net P&L</th>
                  <th className="px-3 py-3 font-medium">Win rate</th>
                  <th className="px-3 py-3 font-medium">Open / Edit</th>
                </tr>
              </thead>
              <tbody>
                {sessionRows.map(({ aggregate: rowAggregate, missedTrades, session, takenTrades }) => {
                  const rowCurrency = session.currency;
                  return (
                    <tr
                      className={`cursor-pointer border-t border-white/10 text-slate-300 hover:bg-white/5 ${showSessionSettings && selectedSession?.id === session.id ? "bg-cyan-300/10" : ""}`}
                      key={session.id}
                      onClick={() => onOpenSessionTrades(session.id)}
                    >
                      <td className="px-3 py-4">
                        <div className="font-semibold text-white">{session.name}</div>
                        <div className="text-xs text-slate-500">{session.status}</div>
                      </td>
                      <td className="px-3 py-4">{session.instrument}</td>
                      <td className="px-3 py-4">{session.strategy_name}</td>
                      <td className="px-3 py-4">{session.playbook_id ? playbookById.get(session.playbook_id)?.name ?? "Missing rules" : "Unlinked"}</td>
                      <td className="px-3 py-4">{takenTrades.length}</td>
                      <td className="px-3 py-4">{missedTrades.length}</td>
                      <td className={`px-3 py-4 font-semibold ${toneForNumber(rowAggregate.netPnl)}`}>{formatMoney(rowAggregate.netPnl, rowCurrency)}</td>
                      <td className="px-3 py-4">{formatPercent(rowAggregate.winRate)}</td>
                      <td className="px-3 py-4">
                        <div className="flex gap-2">
                          <button
                            className="control-button h-8 whitespace-nowrap px-2 text-xs"
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpenSessionTrades(session.id);
                            }}
                            type="button"
                          >
                            <ArrowRight size={13} />
                            Open
                          </button>
                          <button
                            className="control-button h-8 whitespace-nowrap px-2 text-xs"
                            onClick={(event) => {
                              event.stopPropagation();
                              editSession(session.id);
                            }}
                            type="button"
                          >
                            <Pencil size={13} />
                            Edit
                          </button>
                          <button
                            className="control-button h-8 whitespace-nowrap px-2 text-xs"
                            onClick={(event) => {
                              event.stopPropagation();
                              journal.updateSession(session.id, { status: session.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED" });
                            }}
                            type="button"
                          >
                            {session.status === "ARCHIVED" ? "Restore" : "Archive"}
                          </button>
                          <button
                            className="icon-button h-8 w-8 border-rose-300/20 text-rose-200 hover:bg-rose-300/10 hover:text-rose-100"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleDeleteSession(session);
                            }}
                            title="Delete session"
                            type="button"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {sessionRows.length === 0 && (
                  <tr>
                    <td className="border-t border-white/10 px-3 py-8 text-center text-sm text-slate-500" colSpan={9}>
                      Create a session, then open it to add trades.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </FeatureCard>
      </div>
      {showSessionSettings && selectedSession && (
        <div ref={selectedSessionCardRef}>
          <FeatureCard>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <CardLabel icon={Settings} label="Edit session" />
              <div className="flex flex-wrap items-center gap-2">
                <span className="status-pill">{selectedSession.status}</span>
                <button
                  className="control-button h-9"
                  onClick={() => setShowSessionSettings(false)}
                  type="button"
                >
                  <X size={14} />
                  Close edit
                </button>
              </div>
            </div>
            {selectedSessionRow && (
              <div className="mb-4 grid gap-2 md:grid-cols-4">
                <CompactMetric label="Session P&L" value={formatMoney(selectedSessionRow.aggregate.netPnl, selectedSessionCurrency)} tone={toneForNumber(selectedSessionRow.aggregate.netPnl)} />
                <CompactMetric label="Taken trades" value={String(selectedSessionRow.takenTrades.length)} />
                <CompactMetric label="Missed setups" value={String(selectedSessionRow.missedTrades.length)} />
                <CompactMetric label="Win rate" value={formatPercent(selectedSessionRow.aggregate.winRate)} />
              </div>
            )}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.45fr)]">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="form-field">
                  Session name
                  <input className="input-control h-10 normal-case tracking-normal" onChange={(event) => setEditDraft((current) => ({ ...current, name: event.target.value }))} value={editDraft.name} />
                </label>
                <label className="form-field">
                  Strategy
                  <ThemedSelect
                    className="h-10"
                    onChange={(value) => setEditDraft((current) => ({ ...current, strategy: value }))}
                    options={editStrategyOptions}
                    portal
                    value={editDraft.strategy}
                  />
                </label>
                <label className="form-field">
                  Instrument
                  <input className="input-control h-10 normal-case tracking-normal" onChange={(event) => setEditDraft((current) => ({ ...current, instrument: event.target.value }))} value={editDraft.instrument} />
                </label>
                <label className="form-field">
                  Playbook
                  <ThemedSelect
                    className="h-10"
                    onChange={(value) => setEditDraft((current) => ({ ...current, playbookId: value }))}
                    options={[
                      { label: "No playbook", value: "" },
                      ...playbooks.map((playbook) => ({ label: playbook.name, value: String(playbook.id) })),
                    ]}
                    value={editDraft.playbookId}
                  />
                </label>
                <label className="form-field">
                  Currency
                  <ThemedSelect
                    className="h-10"
                    onChange={(value) => setEditDraft((current) => ({ ...current, currency: value }))}
                    options={selectOptionsWithValue(CURRENCY_OPTIONS, editDraft.currency)}
                    portal
                    value={editDraft.currency}
                  />
                </label>
                <div className="rounded-md border border-white/10 bg-black/20 p-3 md:col-span-2">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <CardLabel icon={BadgeDollarSign} label="Session cost defaults" />
                    <span className="text-xs text-slate-500">Applied to new trades in this session</span>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    <CostConfigCard
                      fixedValue={editDraft.commissionFixed}
                      mode={editDraft.commissionMode}
                      onFixedValueChange={(value) => setEditDraft((current) => ({ ...current, commissionFixed: value }))}
                      onModeChange={(value) => setEditDraft((current) => ({ ...current, commissionMode: value }))}
                      onPercentValueChange={(value) => setEditDraft((current) => ({ ...current, commissionPercent: value }))}
                      percentValue={editDraft.commissionPercent}
                      title="Commission"
                    />
                    <CostConfigCard
                      fixedValue={editDraft.brokerageFixed}
                      mode={editDraft.brokerageMode}
                      onFixedValueChange={(value) => setEditDraft((current) => ({ ...current, brokerageFixed: value }))}
                      onModeChange={(value) => setEditDraft((current) => ({ ...current, brokerageMode: value }))}
                      onPercentValueChange={(value) => setEditDraft((current) => ({ ...current, brokeragePercent: value }))}
                      percentValue={editDraft.brokeragePercent}
                      title="Brokerage"
                    />
                  </div>
                </div>
                <label className="form-field md:col-span-2">
                  Notes
                  <textarea className="input-control min-h-24 py-3 normal-case tracking-normal" onChange={(event) => setEditDraft((current) => ({ ...current, notes: event.target.value }))} value={editDraft.notes} />
                </label>
              </div>
              <div className="grid content-start gap-3">
                {selectedSessionRow && (
                  <div className="rounded-md border border-white/10 bg-black/20 p-3">
                    <div className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Recent entries</div>
                    <div className="grid gap-2">
                      {selectedSessionRow.entries.slice().sort(compareTradesAscending).reverse().slice(0, 4).map((trade) => (
                        <div className="flex items-center justify-between gap-3 rounded-md bg-white/5 px-3 py-2 text-sm" key={trade.id}>
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-white">{trade.strategy_name || selectedSession.strategy_name || "Unassigned"}</span>
                            <span className="text-xs text-slate-500">{shortDate(trade.entry_time)} · {isMissedJournalTrade(trade) ? "Missed" : trade.side}</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <span className={`font-semibold tabular-nums ${isMissedJournalTrade(trade) ? "text-amber-200" : toneForNumber(trade.realized_pnl)}`}>
                              {isMissedJournalTrade(trade) ? "Missed" : formatMoney(trade.realized_pnl, selectedSessionCurrency)}
                            </span>
                            <button
                              className="icon-button h-8 w-8"
                              onClick={() => onOpenSessionTrades(selectedSession.id)}
                              title="Open session trades"
                              type="button"
                            >
                              <ArrowRight size={14} />
                            </button>
                          </span>
                        </div>
                      ))}
                      {selectedSessionRow.entries.length === 0 && <div className="rounded-md border border-dashed border-white/10 px-3 py-4 text-sm text-slate-500">No journal entries in this session yet.</div>}
                    </div>
                  </div>
                )}
                <button className="control-button workspace-tab-active justify-center" onClick={saveSelectedSession} type="button">
                  <Save size={15} />
                  Save session changes
                </button>
              </div>
            </div>
          </FeatureCard>
        </div>
      )}
      {confirmDialog}
    </PageScaffold>
  );
}

function JournalSessionTradeEntryPage({
  accounts,
  journal,
  journalLedgerRestoreScroll,
  journalEntries,
  onBack,
  onJournalLedgerScrollChange,
  onJournalLedgerScrollRestored,
  onOpenJournalNote,
  playbooks,
  sessionById,
  sessionId,
  sessions,
  settings,
  strategies,
}: JournalPageProps & { onBack: () => void; sessionId: number }) {
  const selectedSession = sessions.find((session) => session.id === sessionId) ?? null;
  const [editingTradeId, setEditingTradeId] = useState<number | null>(null);
  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );
  const playbookById = useMemo(
    () => new Map(playbooks.map((playbook) => [playbook.id, playbook])),
    [playbooks],
  );
  const sessionEntries = useMemo(
    () => journalEntries.filter((trade) => trade.session_id === sessionId),
    [journalEntries, sessionId],
  );
  const takenTrades = useMemo(() => sessionEntries.filter(isTakenJournalTrade), [sessionEntries]);
  const missedTrades = useMemo(() => sessionEntries.filter(isMissedJournalTrade), [sessionEntries]);
  const aggregate = useMemo(() => aggregateTrades(takenTrades), [takenTrades]);
  const editingTrade = editingTradeId == null
    ? null
    : sessionEntries.find((trade) => trade.id === editingTradeId) ?? null;
  const sessionCurrency = selectedSession?.currency ?? settings.default_currency;
  const playbookName = selectedSession?.playbook_id
    ? playbookById.get(selectedSession.playbook_id)?.name ?? "Missing rules"
    : "No playbook";

  useEffect(() => {
    setEditingTradeId(null);
  }, [sessionId]);

  useEffect(() => {
    if (editingTradeId != null && !sessionEntries.some((trade) => trade.id === editingTradeId)) {
      setEditingTradeId(null);
    }
  }, [editingTradeId, sessionEntries]);

  if (!selectedSession) {
    return (
      <PageScaffold
        actions={
          <button className="control-button h-10" onClick={onBack} type="button">
            <ArrowLeft size={15} />
            Back to sessions
          </button>
        }
        eyebrow="Journal Session Trades"
        title="Session not found"
        description="The selected Journal session is no longer available."
      >
        <EmptyState icon={PlaySquare} message="Return to Journal Sessions and choose another session." />
      </PageScaffold>
    );
  }

  return (
    <PageScaffold
      actions={
        <button className="control-button h-10" onClick={onBack} type="button">
          <ArrowLeft size={15} />
          Back to sessions
        </button>
      }
      eyebrow="Journal Session Trades"
      title={selectedSession.name}
      description="Add taken trades and missed setups for this selected live session."
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ResultMetricCard icon={BadgeDollarSign} label="Session P&L" tone={toneForNumber(aggregate.netPnl)} value={formatMoney(aggregate.netPnl, sessionCurrency)} />
        <ResultMetricCard icon={ClipboardList} label="Taken trades" value={String(takenTrades.length)} />
        <ResultMetricCard icon={Clock3} label="Missed setups" value={String(missedTrades.length)} />
        <ResultMetricCard icon={Activity} label="Win rate" value={formatPercent(aggregate.winRate)} />
      </div>
      <div className="grid gap-4">
        <LiveTradeForm
          allTrades={journalEntries}
          accounts={accounts}
          fixedSessionId={selectedSession.id}
          initialTrade={editingTrade}
          journal={journal}
          onCancelEdit={() => setEditingTradeId(null)}
          onSaved={() => setEditingTradeId(null)}
          playbooks={playbooks}
          sessions={sessions}
          settings={settings}
          strategies={strategies}
          layout="wide"
          title={editingTrade ? "Edit session trade" : "Add trade to session"}
        />
        <FeatureCard>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <CardLabel icon={PlaySquare} label="Selected session" />
            <span className="status-pill">{selectedSession.status}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <MiniMetric label="Instrument" value={selectedSession.instrument} />
            <MiniMetric label="Currency" value={selectedSession.currency} />
            <MiniMetric label="Strategy" value={selectedSession.strategy_name || "Unassigned"} />
            <MiniMetric label="Playbook" value={playbookName} />
            <MiniMetric label="Commission" value={formatCostDefault(selectedSession.commission_mode, selectedSession.commission_value, sessionCurrency)} />
            <MiniMetric label="Brokerage" value={formatCostDefault(selectedSession.brokerage_mode, selectedSession.brokerage_value, sessionCurrency)} />
          </div>
          {selectedSession.notes && (
            <p className="mt-4 rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm leading-6 text-slate-400">
              {selectedSession.notes}
            </p>
          )}
        </FeatureCard>
      </div>
      <LiveTradeTable
        accountById={accountById}
        onDeleteTrade={(trade) => {
          journal.deleteTrade(trade.id);
          if (editingTradeId === trade.id) {
            setEditingTradeId(null);
          }
        }}
        onEditTrade={(trade) => setEditingTradeId(trade.id)}
        onScrollChange={onJournalLedgerScrollChange}
        onScrollRestored={onJournalLedgerScrollRestored}
        onOpenReview={onOpenJournalNote}
        playbookById={playbookById}
        restoreScroll={journalLedgerRestoreScroll}
        sessionById={sessionById}
        trades={sessionEntries}
      />
    </PageScaffold>
  );
}

function JournalDashboardPage({
  accounts,
  aggregate,
  closedTrades,
  days,
  journalEntries,
  sessionById,
  sessions,
}: JournalPageProps) {
  const latestDay = days[0];
  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );
  const activeAccounts = accounts.filter((account) => account.status === "ACTIVE");
  const currency = currencyForJournalAccounts(activeAccounts, sessions[0]?.currency ?? "USD");
  const startingBalance = activeAccounts.length > 0
    ? activeAccounts.reduce((sum, account) => sum + account.initial_balance, 0)
    : 0;
  const accountLinkedTrades = closedTrades.filter((trade) =>
    liveTradeAccountIds(trade as JournalTrade).length > 0,
  );
  const liveBalance = startingBalance + aggregateTrades(accountLinkedTrades).netPnl;
  const missedEntries = journalEntries.filter(isMissedJournalTrade);
  const latestDayCurrency = latestDay
    ? currencyForJournalTrades(latestDay.trades as JournalTrade[], accountById, sessionById, currency)
    : currency;

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
            {formatMoney(latestDay?.aggregate.netPnl ?? 0, latestDayCurrency)}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <CompactMetric label="Trades" value={String(latestDay?.aggregate.totalTrades ?? 0)} />
            <CompactMetric label="Win" value={formatPercent(latestDay?.aggregate.winRate ?? 0)} />
            <CompactMetric label="Missed" value={String(missedEntries.filter((trade) => (trade.entry_time ?? "").slice(0, 10) === latestDay?.date).length)} />
          </div>
        </FeatureCard>
        <FeatureCard>
          <CardLabel icon={Activity} label="Recent actual trades" />
          <div className="mt-4 grid max-h-72 gap-2 overflow-auto">
            {(closedTrades as JournalTrade[]).slice(-8).reverse().map((trade) => {
              const rowCurrency = currencyForJournalTrade(trade, accountById, sessionById, currency);
              return (
                <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm" key={trade.id}>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-white">{trade.strategy_name || "Unassigned"} - {trade.side}</span>
                    <span className="text-xs text-slate-500">{formatDateTime(trade.exit_time)}</span>
                  </span>
                  <span className={`font-semibold ${toneForNumber(trade.realized_pnl)}`}>{formatMoney(trade.realized_pnl, rowCurrency)}</span>
                </div>
              );
            })}
            {closedTrades.length === 0 && <EmptyState icon={ClipboardList} message="Record a live trade to populate Journal activity." />}
          </div>
        </FeatureCard>
        <FeatureCard>
          <CardLabel icon={WalletCards} label="Live account balance" />
          <div className="mt-6 text-4xl font-semibold tabular-nums text-white">{formatMoney(liveBalance, currency)}</div>
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
            <AreaSparkline currency={currency} values={drawdownValues(closedTrades)} height={220} tone="rose" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <CompactMetric label="Max DD" value={formatMoney(aggregate.maxDrawdown, currency)} tone="text-rose-300" />
            <CompactMetric label="PF" value={formatRatio(aggregate.profitFactor)} />
          </div>
        </FeatureCard>
      </div>
    </PageScaffold>
  );
}

function JournalTradesPage({
  accounts,
  journal,
  journalEntries,
  journalLedgerRestoreScroll,
  onJournalLedgerScrollChange,
  onJournalLedgerScrollRestored,
  onOpenJournalNote,
  playbooks,
  sessions,
}: JournalPageProps) {
  const [accountFilter, setAccountFilter] = useState("ALL");
  const [entryTypeFilter, setEntryTypeFilter] = useState<"ALL" | JournalEntryType>("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [sessionFilter, setSessionFilter] = useState("ALL");
  const [sideFilter, setSideFilter] = useState<"ALL" | "LONG" | "SHORT">("ALL");
  const [strategyFilter, setStrategyFilter] = useState("ALL");
  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );
  const playbookById = useMemo(
    () => new Map(playbooks.map((playbook) => [playbook.id, playbook])),
    [playbooks],
  );
  const sessionById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  );
  const strategyOptions = useMemo(() => {
    const names = uniqueStrings(
      journalEntries.map((trade) => {
        const session = sessionById.get(trade.session_id);
        return trade.strategy_name || session?.strategy_name || "Unassigned";
      }),
    ).sort((left, right) => left.localeCompare(right));
    return [
      { label: "All strategies", value: "ALL" },
      ...names.map((name) => ({ label: name, value: name })),
    ];
  }, [journalEntries, sessionById]);
  const filteredEntries = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return journalEntries.filter((trade) => {
      const session = sessionById.get(trade.session_id);
      const linkedAccountIds = liveTradeAccountIds(trade);
      const linkedAccounts = linkedAccountIds
        .map((accountId) => accountById.get(accountId))
        .filter((account): account is LiveJournalAccount => Boolean(account));
      const playbook = trade.playbook_id ? playbookById.get(trade.playbook_id) : null;
      const strategyName = trade.strategy_name || session?.strategy_name || "Unassigned";
      if (entryTypeFilter === "TAKEN" && !isTakenJournalTrade(trade)) {
        return false;
      }
      if (entryTypeFilter === "MISSED" && !isMissedJournalTrade(trade)) {
        return false;
      }
      if (sessionFilter !== "ALL" && String(trade.session_id) !== sessionFilter) {
        return false;
      }
      if (accountFilter === "UNLINKED" && linkedAccountIds.length > 0) {
        return false;
      }
      if (accountFilter !== "ALL" && accountFilter !== "UNLINKED" && !linkedAccountIds.includes(Number(accountFilter))) {
        return false;
      }
      if (sideFilter !== "ALL" && trade.side !== sideFilter) {
        return false;
      }
      if (strategyFilter !== "ALL" && !sameStrategyName(strategyName, strategyFilter)) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [
        `#${trade.id}`,
        strategyName,
        session?.name,
        session?.instrument,
        trade.side,
        isMissedJournalTrade(trade) ? "missed" : "taken",
        trade.emotional_state,
        trade.missed_reason,
        richTextToPlainText(trade.notes),
        shortDate(trade.entry_time),
        playbook?.name,
        ...trade.mistake_tags,
        ...linkedAccounts.map((account) => account.name),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [accountById, accountFilter, entryTypeFilter, journalEntries, playbookById, searchTerm, sessionById, sessionFilter, sideFilter, strategyFilter]);
  const filtersActive =
    accountFilter !== "ALL" ||
    entryTypeFilter !== "ALL" ||
    sessionFilter !== "ALL" ||
    sideFilter !== "ALL" ||
    strategyFilter !== "ALL" ||
    Boolean(searchTerm.trim());
  const filteredTakenCount = filteredEntries.filter(isTakenJournalTrade).length;
  const filteredMissedCount = filteredEntries.filter(isMissedJournalTrade).length;

  function resetFilters() {
    setAccountFilter("ALL");
    setEntryTypeFilter("ALL");
    setSearchTerm("");
    setSessionFilter("ALL");
    setSideFilter("ALL");
    setStrategyFilter("ALL");
  }

  return (
    <PageScaffold
      eyebrow="Journal Trades"
      title="Live Trade Ledger"
      description="Review recorded Journal entries. New trades are added from the focused session workspace."
    >
      <FeatureCard>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <CardLabel icon={Filter} label="Ledger filters" />
          <div className="flex flex-wrap items-center gap-2">
            <span className="status-pill h-8 px-2 text-[11px]">{filteredEntries.length} entries</span>
            <span className="status-pill h-8 px-2 text-[11px]">{filteredTakenCount} taken</span>
            <span className="status-pill h-8 px-2 text-[11px]">{filteredMissedCount} missed</span>
            <button className="control-button h-8 px-2 text-xs" disabled={!filtersActive} onClick={resetFilters} type="button">
              <X size={13} />
              Reset
            </button>
          </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_repeat(5,minmax(140px,0.72fr))]">
          <label className="form-field lg:col-span-2 xl:col-span-1">
            Search
            <div className="flex h-10 items-center gap-2 rounded-md border border-white/10 bg-black/20 px-3 text-sm focus-within:border-cyan-300/40 focus-within:ring-2 focus-within:ring-cyan-300/10">
              <Search className="shrink-0 text-slate-500" size={15} />
              <input
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-600"
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Strategy, account, session, tag..."
                value={searchTerm}
              />
            </div>
          </label>
          <label className="form-field">
            Type
            <ThemedSelect
              className="h-10"
              onChange={(value) => setEntryTypeFilter(value as "ALL" | JournalEntryType)}
              options={[
                { label: "All entries", value: "ALL" },
                { label: "Taken trades", value: "TAKEN" },
                { label: "Missed setups", value: "MISSED" },
              ]}
              portal
              value={entryTypeFilter}
            />
          </label>
          <label className="form-field">
            Session
            <ThemedSelect
              className="h-10"
              onChange={setSessionFilter}
              options={[
                { label: "All sessions", value: "ALL" },
                ...sessions.map((session) => ({
                  label: session.name,
                  sublabel: `${session.instrument} · ${session.currency}`,
                  value: String(session.id),
                })),
              ]}
              portal
              value={sessionFilter}
            />
          </label>
          <label className="form-field">
            Account
            <ThemedSelect
              className="h-10"
              onChange={setAccountFilter}
              options={[
                { label: "All accounts", value: "ALL" },
                { label: "Unlinked", sublabel: "No account attached", value: "UNLINKED" },
                ...accounts.map((account) => ({
                  label: account.name,
                  sublabel: `${account.broker || "Manual"} · ${account.currency}`,
                  value: String(account.id),
                })),
              ]}
              portal
              value={accountFilter}
            />
          </label>
          <label className="form-field">
            Side
            <ThemedSelect
              className="h-10"
              onChange={(value) => setSideFilter(value as "ALL" | "LONG" | "SHORT")}
              options={[
                { label: "All sides", value: "ALL" },
                { label: "Long", value: "LONG" },
                { label: "Short", value: "SHORT" },
              ]}
              portal
              value={sideFilter}
            />
          </label>
          <label className="form-field">
            Strategy
            <ThemedSelect
              className="h-10"
              onChange={setStrategyFilter}
              options={strategyOptions}
              portal
              value={strategyFilter}
            />
          </label>
        </div>
      </FeatureCard>
      <div className="grid gap-4">
        <LiveTradeTable
          accountById={accountById}
          onDeleteTrade={(trade) => journal.deleteTrade(trade.id)}
          onOpenReview={onOpenJournalNote}
          onScrollChange={onJournalLedgerScrollChange}
          onScrollRestored={onJournalLedgerScrollRestored}
          playbookById={playbookById}
          restoreScroll={journalLedgerRestoreScroll}
          sessionById={sessionById}
          trades={filteredEntries}
        />
      </div>
    </PageScaffold>
  );
}

function JournalDayViewPage({ accounts, days, journal, journalEntries, onOpenJournalNote, playbooks, sessionById }: JournalPageProps) {
  const { confirm, confirmDialog } = useThemedConfirm();
  const [mode, setMode] = useState<DayViewMode>("day");
  const [selectedDate, setSelectedDate] = useState(() => days[0]?.date ?? "");
  const [calendarMonth, setCalendarMonth] = useState(() => monthCursorFromDateKey(days[0]?.date));
  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );
  const playbookById = useMemo(
    () => new Map(playbooks.map((playbook) => [playbook.id, playbook])),
    [playbooks],
  );
  const periods = useMemo(() => buildDayViewPeriods(days, mode), [days, mode]);
  const selectedPeriod = useMemo(
    () => findDayViewPeriod(periods, selectedDate, mode),
    [mode, periods, selectedDate],
  );
  const selectedPeriodCurrency = useMemo(
    () =>
      selectedPeriod
        ? currencyForJournalTrades(selectedPeriod.trades as JournalTrade[], accountById, sessionById)
        : currencyForJournalAccounts(accounts),
    [accountById, accounts, selectedPeriod, sessionById],
  );
  const selectedRange =
    mode === "week" && selectedPeriod
      ? { start: selectedPeriod.startDate, end: selectedPeriod.endDate }
      : null;

  useEffect(() => {
    if (days.length === 0) {
      if (selectedDate) {
        setSelectedDate("");
      }
      return;
    }
    if (!days.some((day) => day.date === selectedDate)) {
      const nextDate = days[0].date;
      setSelectedDate(nextDate);
      setCalendarMonth(monthCursorFromDateKey(nextDate));
    }
  }, [days, selectedDate]);

  function countMissedInRange(startDate: string, endDate: string) {
    return journalEntries.filter((trade) => {
      if (!isMissedJournalTrade(trade)) {
        return false;
      }
      return dateKeyInRange(trade.entry_time.slice(0, 10), startDate, endDate);
    }).length;
  }

  function countMissedOnDate(date: string) {
    return countMissedInRange(date, date);
  }

  function selectDate(date: string) {
    if (!days.some((day) => day.date === date)) {
      return;
    }
    setSelectedDate(date);
    setCalendarMonth(monthCursorFromDateKey(date));
  }

  function selectPeriod(period: DayViewPeriod) {
    selectDate(period.days[0]?.date ?? period.endDate);
  }

  function exportSelectedPeriodCsv() {
    if (!selectedPeriod) {
      return;
    }
    exportJournalTradeLogCsv(selectedPeriod.trades as JournalTrade[], accountById, playbookById, sessionById);
  }

  async function deleteJournalTrade(trade: JournalTrade) {
    const confirmed = await confirm(journalTradeDeleteConfirmOptions(trade));
    if (confirmed) {
      journal.deleteTrade(trade.id);
    }
  }

  return (
    <PageScaffold
      eyebrow="Journal Day View"
      title="Actual Trade Period Review"
      description="Review live Journal results by day or week, with missed setups tracked separately."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-white/10 bg-black/20 p-1">
            <TinyTab active={mode === "day"} onClick={() => setMode("day")}>Day</TinyTab>
            <TinyTab active={mode === "week"} onClick={() => setMode("week")}>Week</TinyTab>
          </div>
          <button
            className="control-button"
            disabled={!selectedPeriod || selectedPeriod.trades.length === 0}
            onClick={exportSelectedPeriodCsv}
            type="button"
          >
            <FileDown size={15} />
            Export CSV
          </button>
        </div>
      }
    >
      {selectedPeriod ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <FeatureCard>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                    {mode === "week" ? "Selected week" : "Selected day"}
                  </div>
                  <h2 className="mt-1 truncate text-xl font-semibold text-white">{selectedPeriod.label}</h2>
                  <div className="mt-1 text-sm text-slate-500">{selectedPeriod.sublabel}</div>
                  <div className={`mt-2 text-sm font-semibold ${toneForNumber(selectedPeriod.aggregate.netPnl)}`}>
                    Net P&L {formatMoney(selectedPeriod.aggregate.netPnl, selectedPeriodCurrency)}
                  </div>
                </div>
                <span className="status-pill">
                  {selectedPeriod.aggregate.totalTrades} taken · {countMissedInRange(selectedPeriod.startDate, selectedPeriod.endDate)} missed
                </span>
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.55fr)_minmax(0,0.45fr)]">
                <AreaSparkline currency={selectedPeriodCurrency} values={cumulativeValues(selectedPeriod.trades)} height={190} />
                <div className="grid grid-cols-2 gap-2">
                  <CompactMetric label="Trades" value={String(selectedPeriod.aggregate.totalTrades)} />
                  <CompactMetric label="Net P&L" value={formatMoney(selectedPeriod.aggregate.netPnl, selectedPeriodCurrency)} tone={toneForNumber(selectedPeriod.aggregate.netPnl)} />
                  <CompactMetric label="Winners" value={String(selectedPeriod.aggregate.wins)} tone="text-emerald-300" />
                  <CompactMetric label="Losers" value={String(selectedPeriod.aggregate.losses)} tone="text-rose-300" />
                  <CompactMetric label="Win rate" value={formatPercent(selectedPeriod.aggregate.winRate)} />
                  <CompactMetric label="Profit factor" value={formatRatio(selectedPeriod.aggregate.profitFactor)} />
                  <CompactMetric label="Avg R" value={formatOptionalNumber(selectedPeriod.aggregate.averageR)} />
                  <CompactMetric label="Avg hold" value={formatMinutes(selectedPeriod.aggregate.averageHoldMinutes)} />
                </div>
              </div>
            </FeatureCard>

            {mode === "week" && (
              <FeatureCard>
                <CardLabel icon={CalendarDays} label="Week breakdown" />
                <div className="mt-3 grid gap-2">
                  {selectedPeriod.days.map((day) => {
                    const dayCurrency = currencyForJournalTrades(day.trades as JournalTrade[], accountById, sessionById, selectedPeriodCurrency);
                    return (
                      <button
                        className={`grid gap-2 rounded-md border px-3 py-2 text-left transition sm:grid-cols-[minmax(0,1fr)_120px_88px_88px] sm:items-center ${
                          day.date === selectedDate
                            ? "border-cyan-300/30 bg-cyan-300/10"
                            : "border-white/10 bg-black/20 hover:border-white/20"
                        }`}
                        key={day.date}
                        onClick={() => selectDate(day.date)}
                        type="button"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-white">{day.label}</span>
                          <span className="text-xs text-slate-500">{day.aggregate.totalTrades} taken · {countMissedOnDate(day.date)} missed</span>
                        </span>
                        <span className={`text-sm font-semibold tabular-nums ${toneForNumber(day.aggregate.netPnl)}`}>
                          {formatMoney(day.aggregate.netPnl, dayCurrency)}
                        </span>
                        <span className="text-xs text-slate-500">{formatPercent(day.aggregate.winRate)}</span>
                        <span className="text-xs text-slate-500">{formatOptionalNumber(day.aggregate.averageR)}R</span>
                      </button>
                    );
                  })}
                </div>
              </FeatureCard>
            )}

            <FeatureCard>
              <div className="flex items-center justify-between gap-3">
                <CardLabel icon={ClipboardList} label={`${mode === "week" ? "Period" : "Day"} trades`} />
                <span className="status-pill">{selectedPeriod.trades.length} taken</span>
              </div>
              <div className="mt-3 overflow-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-[0.16em] text-slate-500">
                    <tr>
                      <th className="px-3 py-3 font-medium">Trade</th>
                      <th className="px-3 py-3 font-medium">Accounts</th>
                      <th className="px-3 py-3 font-medium">Entry</th>
                      <th className="px-3 py-3 font-medium">Exit</th>
                      <th className="px-3 py-3 font-medium">P&L</th>
                      <th className="px-3 py-3 font-medium">R</th>
                      <th className="px-3 py-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedPeriod.trades.slice().sort(compareTradesAscending).map((trade) => {
                      const journalTrade = trade as JournalTrade;
                      const session = sessionById.get(journalTrade.session_id);
                      const accountNames = liveTradeAccountIds(journalTrade)
                        .map((accountId) => accountById.get(accountId)?.name)
                        .filter(Boolean)
                        .join(", ");
                      const tradeCurrency = currencyForJournalTrade(journalTrade, accountById, sessionById, selectedPeriodCurrency);
                      return (
                        <tr className="border-t border-white/10 text-slate-300" key={journalTrade.id}>
                          <td className="px-3 py-3">
                            <div className="font-semibold text-white">{journalTrade.strategy_name || session?.strategy_name || "Live trade"}</div>
                            <div className="text-xs text-slate-500">{session?.name ?? "Live session"} · {journalTrade.side}</div>
                          </td>
                          <td className="px-3 py-3 text-slate-400">{accountNames || "Unlinked"}</td>
                          <td className="px-3 py-3">
                            <div className="font-semibold text-slate-100">{formatPrice(journalTrade.entry_price)}</div>
                            <div className="text-xs text-slate-500">{formatDateTime(journalTrade.entry_time)}</div>
                          </td>
                          <td className="px-3 py-3">
                            <div className="font-semibold text-slate-100">{formatPrice(journalTrade.exit_price)}</div>
                            <div className="text-xs text-slate-500">{formatDateTime(journalTrade.exit_time)}</div>
                          </td>
                          <td className={`px-3 py-3 font-semibold ${toneForNumber(journalTrade.realized_pnl)}`}>
                            {formatMoney(journalTrade.realized_pnl, tradeCurrency)}
                          </td>
                          <td className="px-3 py-3 text-slate-200">{formatOptionalNumber(journalTrade.r_multiple)}</td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap gap-2">
                              <button className="control-button h-9 px-2 text-xs" onClick={() => onOpenJournalNote(journalTrade)} type="button">
                                <NotebookPen size={13} />
                                Trade notes
                              </button>
                              <button
                                className="control-button h-9 border-rose-300/20 px-2 text-xs text-rose-200 hover:bg-rose-300/10 hover:text-rose-100"
                                onClick={() => void deleteJournalTrade(journalTrade)}
                                type="button"
                              >
                                <Trash2 size={13} />
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </FeatureCard>
          </div>

          <div className="space-y-4">
            <FeatureCard>
              <CardLabel icon={CalendarDays} label="Calendar navigator" />
              <div className="mt-4">
                <CalendarHeatmap
                  compact
                  currency={selectedPeriodCurrency}
                  days={days}
                  month={calendarMonth}
                  onMonthChange={setCalendarMonth}
                  onSelectDate={selectDate}
                  selectedDate={mode === "day" ? selectedDate : null}
                  selectedRange={selectedRange}
                />
              </div>
            </FeatureCard>

            <FeatureCard>
              <CardLabel icon={mode === "week" ? CalendarDays : ClipboardList} label={mode === "week" ? "Trading weeks" : "Trading days"} />
              <div className="mt-3 grid max-h-[420px] gap-2 overflow-auto pr-1">
                {periods.map((period) => {
                  const active = period.id === selectedPeriod.id;
                  const periodCurrency = currencyForJournalTrades(period.trades as JournalTrade[], accountById, sessionById, selectedPeriodCurrency);
                  return (
                    <button
                      className={`rounded-md border px-3 py-2 text-left transition ${
                        active
                          ? "border-cyan-300/30 bg-cyan-300/10"
                          : "border-white/10 bg-black/20 hover:border-white/20"
                      }`}
                      key={period.id}
                      onClick={() => selectPeriod(period)}
                      type="button"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-white">{period.label}</span>
                          <span className="text-xs text-slate-500">
                            {period.aggregate.totalTrades} taken · {countMissedInRange(period.startDate, period.endDate)} missed
                          </span>
                        </span>
                        <span className={`shrink-0 text-sm font-semibold tabular-nums ${toneForNumber(period.aggregate.netPnl)}`}>
                          {formatMoney(period.aggregate.netPnl, periodCurrency)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </FeatureCard>
          </div>
        </div>
      ) : (
        <EmptyState icon={CalendarDays} message="Taken-trade days appear after recording Journal trades." />
      )}
      {confirmDialog}
    </PageScaffold>
  );
}

function JournalNotesPage({
  accounts,
  backLabel = "Back",
  focusTradeId = null,
  journal,
  journalEntries,
  onBack,
  playbooks,
  sessionById,
}: JournalPageProps & {
  backLabel?: string;
  focusTradeId?: number | null;
  onBack?: () => void;
}) {
  const { confirm, confirmDialog } = useThemedConfirm();
  const [selectedTradeId, setSelectedTradeId] = useState<number | null>(focusTradeId ?? journalEntries.at(-1)?.id ?? null);
  const [searchTerm, setSearchTerm] = useState("");
  const [screenshotActionStatus, setScreenshotActionStatus] = useState<string | null>(null);
  const selectedTrade = journalEntries.find((trade) => trade.id === selectedTradeId) ?? journalEntries.at(-1) ?? null;
  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );
  const playbookById = useMemo(
    () => new Map(playbooks.map((playbook) => [playbook.id, playbook])),
    [playbooks],
  );
  const filteredEntries = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) {
      return journalEntries;
    }
    return journalEntries.filter((trade) => {
      const session = sessionById.get(trade.session_id);
      const linkedAccounts = liveTradeAccountIds(trade)
        .map((accountId) => accountById.get(accountId))
        .filter((account): account is LiveJournalAccount => Boolean(account));
      return [
        trade.strategy_name,
        session?.name,
        session?.instrument,
        trade.side,
        trade.emotional_state,
        trade.notes,
        trade.missed_reason,
        shortDate(trade.entry_time),
        ...trade.mistake_tags,
        ...linkedAccounts.map((account) => account.name),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [accountById, journalEntries, searchTerm, sessionById]);
  const selectedCurrency = selectedTrade
    ? currencyForJournalTrade(selectedTrade, accountById, sessionById)
    : "USD";
  const selectedAccounts = selectedTrade
    ? liveTradeAccountIds(selectedTrade)
      .map((accountId) => accountById.get(accountId))
      .filter((account): account is LiveJournalAccount => Boolean(account))
    : [];
  const selectedSession = selectedTrade ? sessionById.get(selectedTrade.session_id) ?? null : null;
  const selectedPlaybook = selectedTrade?.playbook_id
    ? playbookById.get(selectedTrade.playbook_id) ?? null
    : selectedSession?.playbook_id
      ? playbookById.get(selectedSession.playbook_id) ?? null
      : null;
  const selectedNotesHtml = selectedTrade ? normalizeStoredNoteHtml(selectedTrade.notes) : "";
  const selectedHasNotes = Boolean(selectedTrade) && !isRichTextEmpty(selectedNotesHtml);
  const selectedIsMissed = selectedTrade ? isMissedJournalTrade(selectedTrade) : false;
  const selectedScreenshotUrl = selectedTrade?.screenshot_url ?? "";

  useEffect(() => {
    if (focusTradeId != null && journalEntries.some((trade) => trade.id === focusTradeId)) {
      setSelectedTradeId(focusTradeId);
    }
  }, [focusTradeId, journalEntries]);

  useEffect(() => {
    if (selectedTradeId != null && journalEntries.some((trade) => trade.id === selectedTradeId)) {
      return;
    }
    setSelectedTradeId(journalEntries.at(-1)?.id ?? null);
  }, [journalEntries, selectedTradeId]);

  useEffect(() => {
    setScreenshotActionStatus(null);
  }, [selectedTradeId]);

  function exportFilteredNotesCsv() {
    exportJournalTradeLogCsv(filteredEntries, accountById, playbookById, sessionById);
  }

  async function deleteSelectedTrade() {
    if (!selectedTrade) {
      return;
    }
    const confirmed = await confirm(journalTradeDeleteConfirmOptions(selectedTrade));
    if (!confirmed) {
      return;
    }
    journal.deleteTrade(selectedTrade.id);
    if (onBack) {
      onBack();
      return;
    }
    setSelectedTradeId(journalEntries.filter((trade) => trade.id !== selectedTrade.id).at(-1)?.id ?? null);
  }

  function openSelectedScreenshot() {
    if (!selectedScreenshotUrl) {
      setScreenshotActionStatus("No screenshot attached");
      return;
    }
    setScreenshotActionStatus(openScreenshotFullSize(selectedScreenshotUrl) ? "Screenshot opened" : "Could not open screenshot");
  }

  async function copySelectedScreenshot() {
    if (!selectedScreenshotUrl) {
      setScreenshotActionStatus("No screenshot attached");
      return;
    }
    setScreenshotActionStatus(null);
    try {
      await copyTradeSnapshotToClipboard(selectedScreenshotUrl);
      setScreenshotActionStatus("Screenshot copied");
    } catch {
      try {
        await navigator.clipboard?.writeText(selectedScreenshotUrl);
        setScreenshotActionStatus("Screenshot link copied");
      } catch {
        setScreenshotActionStatus("Screenshot could not be copied");
      }
    }
  }

  return (
    <PageScaffold
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {onBack && (
            <button className="control-button h-10" onClick={onBack} type="button">
              <ArrowLeft size={15} />
              {backLabel}
            </button>
          )}
          <button
            className="control-button h-10 border-rose-300/20 text-rose-200 hover:bg-rose-300/10 hover:text-rose-100"
            disabled={!selectedTrade}
            onClick={() => void deleteSelectedTrade()}
            type="button"
          >
            <Trash2 size={15} />
            Delete
          </button>
          <button className="control-button h-10" disabled={filteredEntries.length === 0} onClick={exportFilteredNotesCsv} type="button">
            <FileDown size={15} />
            Export CSV
          </button>
        </div>
      }
      eyebrow="Journal Notes"
      title="Live Trade Notes"
      description="Notes, tags, missed reasons, and emotional review for Journal entries."
    >
      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <FeatureCard className="p-0">
          <div className="border-b border-white/10 p-3">
            <div className="flex items-center gap-2">
              <Search size={15} className="text-slate-500" />
              <input
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-600"
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search live notes"
                value={searchTerm}
              />
            </div>
          </div>
          <div className="grid gap-2 p-3">
              <NotebookFolder
                label={`Live notes (${filteredEntries.length})`}
                active
                onClick={() => undefined}
              />
              {filteredEntries.slice().reverse().map((trade) => (
                <button
                  className={`rounded-md border px-3 py-2 text-left text-sm transition ${
                    selectedTrade?.id === trade.id ? "border-cyan-300/30 bg-cyan-300/10" : "border-white/10 bg-black/20 hover:border-white/20"
                  }`}
                key={trade.id}
                onClick={() => setSelectedTradeId(trade.id)}
                  type="button"
                >
                  <span className="block font-semibold text-white">{trade.strategy_name || "Unassigned"} : {shortDate(trade.entry_time)}</span>
                  <span className={`text-xs font-semibold ${isMissedJournalTrade(trade) ? "text-amber-200" : toneForNumber(trade.realized_pnl)}`}>
                    {isMissedJournalTrade(trade) ? "Missed setup" : formatMoney(trade.realized_pnl, currencyForJournalTrade(trade, accountById, sessionById))}
                  </span>
                </button>
              ))}
              {filteredEntries.length === 0 && <EmptyState icon={Search} message="No live notes match this search." />}
          </div>
        </FeatureCard>
        <FeatureCard>
          {selectedTrade ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold text-white">{selectedTrade.strategy_name || selectedSession?.strategy_name || "Live trade"}</h2>
                    <span className={`rounded px-2 py-1 text-xs font-semibold ${selectedIsMissed ? "bg-amber-300/10 text-amber-200" : "bg-cyan-300/10 text-cyan-100"}`}>
                      {selectedIsMissed ? "MISSED" : "TAKEN"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    #{selectedTrade.id} · {selectedSession?.name ?? "Live session"} · {selectedSession?.instrument ?? "Manual"}
                  </p>
                </div>
                <span className={`text-lg font-semibold tabular-nums ${selectedIsMissed ? "text-amber-200" : toneForNumber(selectedTrade.realized_pnl)}`}>
                  {selectedIsMissed ? "Missed setup" : formatMoney(selectedTrade.realized_pnl, selectedCurrency)}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {selectedAccounts.map((account) => (
                  <JournalAccountBadge account={account} key={account.id} />
                ))}
                {selectedAccounts.length === 0 && <span className="status-pill h-7 px-2 text-[10px]">No account link</span>}
              </div>
              <div className="mt-4 grid gap-3">
                <div className="rounded-md border border-white/10 bg-black/20 p-3">
                  <CardLabel icon={PlaySquare} label="Session and plan" />
                  <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                    <MiniMetric label="Session" value={selectedSession?.name ?? "Live session"} />
                    <MiniMetric label="Instrument" value={selectedSession?.instrument ?? "Manual"} />
                    <MiniMetric label="Strategy" value={selectedTrade.strategy_name || selectedSession?.strategy_name || "Unassigned"} />
                    <MiniMetric label="Playbook" value={selectedPlaybook?.name ?? "No playbook"} />
                    <MiniMetric label="Session currency" value={selectedSession?.currency ?? selectedCurrency} />
                    <MiniMetric label="Session status" value={selectedSession?.status ?? "-"} />
                    <MiniMetric label="Entry type" value={selectedIsMissed ? "Missed setup" : "Taken trade"} />
                    <MiniMetric label="Trade status" value={selectedTrade.status} />
                  </div>
                </div>
                <div className="rounded-md border border-white/10 bg-black/20 p-3">
                  <CardLabel icon={Activity} label="Execution" />
                  <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                    <MiniMetric label="Side" value={selectedTrade.side} />
                    <MiniMetric label="Size" value={selectedIsMissed && selectedTrade.quantity === 0 ? "-" : formatCompactNumber(selectedTrade.quantity)} />
                    <MiniMetric label="Entry time" value={formatDateTime(selectedTrade.entry_time)} />
                    <MiniMetric label="Exit time" value={selectedIsMissed ? "-" : formatDateTime(selectedTrade.exit_time)} />
                    <MiniMetric label={selectedIsMissed ? "Planned entry" : "Entry price"} value={formatPrice(selectedIsMissed ? selectedTrade.planned_entry_price : selectedTrade.entry_price)} />
                    <MiniMetric label={selectedIsMissed ? "Planned exit" : "Exit price"} value={formatPrice(selectedIsMissed ? selectedTrade.planned_exit_price : selectedTrade.exit_price)} />
                    <MiniMetric label={selectedIsMissed ? "Planned stop" : "Stop loss"} value={formatPrice(selectedIsMissed ? selectedTrade.planned_stop_loss : selectedTrade.stop_loss)} />
                    <MiniMetric label={selectedIsMissed ? "Planned target" : "Take profit"} value={formatPrice(selectedIsMissed ? selectedTrade.planned_take_profit : selectedTrade.take_profit)} />
                  </div>
                </div>
                <div className="rounded-md border border-white/10 bg-black/20 p-3">
                  <CardLabel icon={BadgeDollarSign} label="P&L and costs" />
                  <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                    <CompactMetric label="Gross P&L" value={selectedIsMissed ? "-" : formatMoney(selectedTrade.gross_pnl, selectedCurrency)} tone={selectedIsMissed ? "text-slate-500" : toneForNumber(selectedTrade.gross_pnl)} />
                    <CompactMetric label="Net P&L" value={selectedIsMissed ? "-" : formatMoney(selectedTrade.realized_pnl, selectedCurrency)} tone={selectedIsMissed ? "text-slate-500" : toneForNumber(selectedTrade.realized_pnl)} />
                    <CompactMetric label="R multiple" value={selectedIsMissed ? "-" : formatOptionalNumber(selectedTrade.r_multiple)} />
                    <CompactMetric label="Currency" value={selectedCurrency} />
                    <MiniMetric label="Commission setting" value={selectedIsMissed ? "None" : formatCostDefault(normalizeCommissionMode(selectedTrade.commission_mode), selectedTrade.commission_value, selectedCurrency)} />
                    <MiniMetric label="Commission charged" value={selectedIsMissed ? "-" : formatMoney(selectedTrade.commission_amount ?? 0, selectedCurrency)} />
                    <MiniMetric label="Brokerage setting" value={selectedIsMissed ? "None" : formatCostDefault(normalizeCommissionMode(selectedTrade.fee_mode), selectedTrade.fee_value, selectedCurrency)} />
                    <MiniMetric label="Brokerage charged" value={selectedIsMissed ? "-" : formatMoney(selectedTrade.fee_amount ?? 0, selectedCurrency)} />
                  </div>
                </div>
                <div className="rounded-md border border-white/10 bg-black/20 p-3">
                  <CardLabel icon={Tags} label="Review context" />
                  <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                    <MiniMetric label="Emotion" value={selectedTrade.emotional_state || "-"} />
                    <MiniMetric label="Tags" value={selectedTrade.mistake_tags.join(", ") || "-"} />
                    <MiniMetric label="Accounts" value={selectedAccounts.map((account) => account.name).join(", ") || "Unlinked"} />
                    <MiniMetric label="Screenshot" value={selectedTrade.screenshot_url ? "Attached" : "None"} />
                  </div>
                </div>
              </div>
              {selectedIsMissed && selectedTrade.missed_reason && (
                <div className="mt-4 rounded-md border border-amber-300/20 bg-amber-300/10 px-3 py-3 text-sm text-amber-50">
                  {selectedTrade.missed_reason}
                </div>
              )}
              <div className="mt-4 rounded-md border border-white/10 bg-black/20">
                <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                  <CardLabel icon={NotebookPen} label="Review notes" />
                  <span className="text-xs text-slate-600">{selectedHasNotes ? "Saved note" : "No note yet"}</span>
                </div>
                {selectedHasNotes ? (
                  <div
                    className="notebook-rich-editor min-h-32 px-4 py-3 text-sm leading-6 text-slate-300"
                    dangerouslySetInnerHTML={{ __html: selectedNotesHtml }}
                  />
                ) : (
                  <div className="px-4 py-6 text-sm text-slate-500">
                    No review notes have been saved for this Journal entry.
                  </div>
                )}
              </div>
              {selectedScreenshotUrl && (
                <div className="mt-4 overflow-hidden rounded-md border border-white/10 bg-black/20">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
                    <CardLabel icon={Eye} label="Screenshot" />
                    <div className="flex flex-wrap justify-end gap-2">
                      <button className="control-button h-8 px-2 text-xs" onClick={() => void copySelectedScreenshot()} type="button">
                        <Copy size={13} />
                        Copy screenshot
                      </button>
                      <button className="control-button h-8 px-2 text-xs" onClick={openSelectedScreenshot} type="button">
                        <Eye size={13} />
                        Open full size
                      </button>
                    </div>
                  </div>
                  <img alt="Live trade screenshot" className="max-h-80 w-full object-contain" src={selectedScreenshotUrl} />
                  {screenshotActionStatus && (
                    <div className="border-t border-white/10 px-3 py-2 text-xs font-semibold text-cyan-100">
                      {screenshotActionStatus}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <EmptyState icon={NotebookPen} message="Record a live trade to start live notes." />
          )}
        </FeatureCard>
      </div>
      {confirmDialog}
    </PageScaffold>
  );
}

function JournalReportsPage({
  accounts,
  journal,
  journalLedgerRestoreScroll,
  journalEntries,
  onJournalLedgerScrollChange,
  onJournalLedgerScrollRestored,
  onOpenJournalNote,
  playbooks,
  sessionById,
  sessions,
  strategies,
}: JournalPageProps) {
  const [tab, setTab] = useState<"accounts" | "daytime" | "missed" | "overview" | "performance" | "risk" | "strategies">("performance");
  const [accountFilter, setAccountFilter] = useState("ALL");
  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );
  const playbookById = useMemo(
    () => new Map(playbooks.map((playbook) => [playbook.id, playbook])),
    [playbooks],
  );
  const scopedEntries = useMemo(() => {
    if (accountFilter === "ALL") {
      return journalEntries;
    }
    const accountId = Number(accountFilter);
    return journalEntries.filter((trade) =>
      liveTradeAccountIds(trade).includes(accountId),
    );
  }, [accountFilter, journalEntries]);
  const takenTrades = useMemo(() => scopedEntries.filter(isTakenJournalTrade), [scopedEntries]);
  const missedTrades = useMemo(() => scopedEntries.filter(isMissedJournalTrade), [scopedEntries]);
  const aggregate = useMemo(() => aggregateTrades(takenTrades), [takenTrades]);
  const days = useMemo(() => groupTradesByDay(takenTrades), [takenTrades]);
  const reportCurrency = useMemo(() => {
    if (accountFilter !== "ALL") {
      return accountById.get(Number(accountFilter))?.currency ?? "USD";
    }
    return currencyForJournalTrades(takenTrades, accountById, sessionById, currencyForJournalAccounts(accounts));
  }, [accountById, accountFilter, accounts, sessionById, takenTrades]);
  const rRows = useMemo(() => groupByRMultiple(takenTrades), [takenTrades]);
  const hourRows = useMemo(() => groupByHour(takenTrades), [takenTrades]);
  const weekdayRows = useMemo(() => groupByWeekday(takenTrades), [takenTrades]);
  const accountRows = useMemo(
    () => {
      const scopedAccounts = accountFilter === "ALL"
        ? accounts
        : accounts.filter((account) => account.id === Number(accountFilter));
      const sourceTrades = accountFilter === "ALL" ? journalEntries : scopedEntries;
      return scopedAccounts
        .map((account) => {
          const trades = sourceTrades.filter((trade) =>
            isTakenJournalTrade(trade) &&
            liveTradeAccountIds(trade).includes(account.id),
          );
          return {
            account,
            aggregate: aggregateTrades(trades),
            label: account.name,
          };
        })
        .filter((row) => row.aggregate.totalTrades > 0 || (accountFilter === "ALL" && row.account.status === "ACTIVE"));
    },
    [accountFilter, accounts, journalEntries, scopedEntries],
  );
  const strategyRows = useMemo(
    () => groupLiveStrategies(sessions, scopedEntries).filter((strategy) => strategy.aggregate.totalTrades > 0),
    [scopedEntries, sessions],
  );
  const missedByStrategy = useMemo(() => {
    const grouped = new Map<string, JournalTrade[]>();
    for (const trade of missedTrades) {
      const session = sessionById.get(trade.session_id);
      const label = trade.strategy_name || session?.strategy_name || "Unassigned";
      grouped.set(label, [...(grouped.get(label) ?? []), trade]);
    }
    return Array.from(grouped.entries())
      .map(([label, trades]) => ({ label, trades }))
      .sort((a, b) => b.trades.length - a.trades.length);
  }, [missedTrades, sessionById]);

  return (
    <PageScaffold
      eyebrow="Journal Reports"
      title="Live Journal Performance Reports"
      description="Performance reports for taken trades with missed setups tracked separately."
      actions={
        <ThemedSelect
          className="h-10 min-w-56"
          onChange={setAccountFilter}
          options={[
            { label: "All journal accounts", value: "ALL" },
            ...accounts.map((account) => ({
              label: account.name,
              sublabel: `${account.broker || "Manual"} · ${account.currency}`,
              value: String(account.id),
            })),
          ]}
          value={accountFilter}
        />
      }
    >
      <div className="terminal-panel p-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap gap-1">
            {[
              ["performance", "Performance"],
              ["overview", "Overview"],
              ["accounts", "Accounts"],
              ["daytime", "Day & Time"],
              ["risk", "Risk"],
              ["strategies", "Strategies"],
              ["missed", "Missed"],
            ].map(([id, label]) => (
              <button
                className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-xs font-semibold transition ${
                  tab === id ? "bg-cyan-300/10 text-cyan-100 ring-1 ring-cyan-300/20" : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`}
                key={id}
                onClick={() => setTab(id as typeof tab)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="status-pill h-8 px-2 text-[11px]">{takenTrades.length} taken</span>
            <span className="status-pill h-8 px-2 text-[11px]">{missedTrades.length} missed</span>
            {reportCurrency === MIXED_CURRENCY && <span className="status-pill h-8 px-2 text-[11px]">Mixed currencies</span>}
          </div>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <ResultMetricCard icon={BadgeDollarSign} label="Net P&L" tone={toneForNumber(aggregate.netPnl)} value={formatMoney(aggregate.netPnl, reportCurrency)} />
        <ResultMetricCard icon={BadgeDollarSign} label="Gross P&L" tone={toneForNumber(aggregate.grossPnl)} value={formatMoney(aggregate.grossPnl, reportCurrency)} />
        <ResultMetricCard icon={WalletCards} label="Commissions" value={formatMoney(aggregate.totalCommissions, reportCurrency)} />
        <ResultMetricCard icon={WalletCards} label="Brokerage" value={formatMoney(aggregate.totalFees, reportCurrency)} />
        <ResultMetricCard icon={Activity} label="Win rate" value={formatPercent(aggregate.winRate)} />
        <ResultMetricCard icon={Target} label="Taken" value={String(aggregate.totalTrades)} />
        <ResultMetricCard icon={Clock3} label="Missed" value={String(missedTrades.length)} />
        <ResultMetricCard icon={TrendingDown} label="Max DD" tone="text-rose-300" value={formatMoney(aggregate.maxDrawdown, reportCurrency)} />
      </div>
      {tab === "performance" && (
        <div className="grid gap-4">
          {takenTrades.length > 0 ? (
            <>
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.12fr)_minmax(360px,0.88fr)]">
                <FeatureCard className="overflow-hidden p-0">
                  <MetricChartHeader icon={LineChart} label="Journal equity" meta={`${takenTrades.length} taken trades`} tone={toneForNumber(aggregate.netPnl)} value={formatMoney(aggregate.netPnl, reportCurrency)} />
                  <div className="px-4 pb-4">
                    <AreaSparkline currency={reportCurrency} height={288} values={cumulativeValues(takenTrades)} />
                  </div>
                </FeatureCard>
                <FeatureCard className="overflow-hidden p-0">
                  <MetricChartHeader icon={BarChart3} label="Daily P&L" meta={`${days.length} trading days`} tone={toneForNumber(bestRow(days.map((day) => ({ aggregate: day.aggregate, label: day.label })))?.aggregate.netPnl)} value={formatMoney(bestRow(days.map((day) => ({ aggregate: day.aggregate, label: day.label })))?.aggregate.netPnl ?? 0, reportCurrency)} />
                  <div className="px-4 pb-4">
                    <BarBreakdown chartHeight={288} currency={reportCurrency} maxItems={18} rows={days.slice().reverse().map((day) => ({ label: day.date.slice(5), value: day.aggregate.netPnl }))} />
                  </div>
                </FeatureCard>
              </div>
              <FeatureCard>
                <StatsGrid aggregate={aggregate} currency={reportCurrency} />
              </FeatureCard>
            </>
          ) : (
            <EmptyState icon={LineChart} message="Record a taken Journal trade to unlock performance charts." />
          )}
        </div>
      )}
      {tab === "overview" && (
        <div className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <InsightMetric currency={reportCurrency} row={bestRow(days.map((day) => ({ aggregate: day.aggregate, label: day.label })))} title="Best day" />
            <InsightMetric currency={reportCurrency} row={worstRow(days.map((day) => ({ aggregate: day.aggregate, label: day.label })))} title="Weakest day" />
            <InsightMetric currency={reportCurrency} row={bestWinRateRow(strategyRows.map((strategy) => ({ aggregate: strategy.aggregate, label: strategy.name })))} title="Best win rate" />
            <InsightMetric currency={reportCurrency} row={mostActiveRow(strategyRows.map((strategy) => ({ aggregate: strategy.aggregate, label: strategy.name })))} title="Most active" />
          </div>
          <FeatureCard><StatsGrid aggregate={aggregate} currency={reportCurrency} /></FeatureCard>
          <LiveTradeTable
            accountById={accountById}
            onDeleteTrade={(trade) => journal.deleteTrade(trade.id)}
            onOpenReview={onOpenJournalNote}
            onScrollChange={onJournalLedgerScrollChange}
            onScrollRestored={onJournalLedgerScrollRestored}
            playbookById={playbookById}
            restoreScroll={journalLedgerRestoreScroll}
            sessionById={sessionById}
            trades={scopedEntries.slice(-20)}
          />
        </div>
      )}
      {tab === "accounts" && (
        <ReportBreakdown
          currency={reportCurrency}
          leftTitle="Net P&L by account"
          rightTitle="Win % by account"
          rows={accountRows.map((row) => ({ aggregate: row.aggregate, label: row.account.name }))}
        />
      )}
      {tab === "daytime" && (
        <div className="grid gap-4">
          <ReportBreakdown currency={reportCurrency} leftTitle="Net P&L by hour" rightTitle="Win % by hour" rows={hourRows} />
          <ReportBreakdown currency={reportCurrency} leftTitle="Net P&L by weekday" rightTitle="Win % by weekday" rows={weekdayRows} />
        </div>
      )}
      {tab === "risk" && <ReportBreakdown currency={reportCurrency} leftTitle="Net P&L by R multiple" rightTitle="Win % by R bucket" rows={rRows} />}
      {tab === "strategies" && (
        <ReportBreakdown
          currency={reportCurrency}
          leftTitle="P&L by strategy"
          rightTitle="Win % by strategy"
          rows={strategyRows.map((strategy) => ({ aggregate: strategy.aggregate, label: strategy.name }))}
        />
      )}
      {tab === "missed" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.58fr)_minmax(0,0.42fr)]">
          <FeatureCard>
            <CardLabel icon={Clock3} label="Missed setup clusters" />
            <div className="mt-4 grid gap-2">
              {missedByStrategy.map((row) => (
                <button className="rounded-md border border-white/10 bg-black/20 px-3 py-3 text-left transition hover:border-cyan-300/30 hover:bg-cyan-300/10" key={row.label} onClick={() => onOpenJournalNote(row.trades[0])} type="button">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-semibold text-white">{row.label}</span>
                    <span className="status-pill">{row.trades.length} missed</span>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    {row.trades.slice(0, 3).map((trade) => journalTradeReviewText(trade, "No reason logged")).join(" · ")}
                  </div>
                </button>
              ))}
              {missedByStrategy.length === 0 && <EmptyState icon={Clock3} message="Missed setups appear here when logged." />}
            </div>
          </FeatureCard>
          <FeatureCard>
            <CardLabel icon={ClipboardList} label="Recent missed entries" />
            <div className="mt-4 grid gap-2">
              {missedTrades.slice().reverse().slice(0, 8).map((trade) => (
                <button className="rounded-md border border-white/10 bg-black/20 px-3 py-3 text-left text-sm transition hover:border-cyan-300/30 hover:bg-cyan-300/10" key={trade.id} onClick={() => onOpenJournalNote(trade)} type="button">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-white">{trade.strategy_name || sessionById.get(trade.session_id)?.strategy_name || "Unassigned"}</span>
                    <span className="text-xs text-slate-500">{shortDate(trade.entry_time)}</span>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">{journalTradeReviewText(trade, "No reason logged")}</div>
                </button>
              ))}
              {missedTrades.length === 0 && <EmptyState icon={ClipboardList} message="No missed setups in this scope." />}
            </div>
          </FeatureCard>
        </div>
      )}
    </PageScaffold>
  );
}

function JournalStrategiesPage({
  closedTrades,
  journal,
  playbooks,
  sessions,
  strategies,
}: JournalPageProps) {
  const savedStrategyNames = useLiveJournalStrategyNames();
  const strategyRows = useMemo(
    () => mergeLiveStrategyGroups(strategies, savedStrategyNames),
    [savedStrategyNames, strategies],
  );
  const [selectedName, setSelectedName] = useState<string | null>(strategyRows[0]?.name ?? null);
  const [dialogMode, setDialogMode] = useState<"create" | "edit" | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LiveStrategyGroup | null>(null);
  const [mutatingName, setMutatingName] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const playbookById = useMemo(
    () => new Map(playbooks.map((playbook) => [playbook.id, playbook])),
    [playbooks],
  );
  const selected = strategyRows.find((strategy) => strategy.name === selectedName) ?? strategyRows[0] ?? null;
  const selectedCurrency = selected ? currencyForLiveSessions(selected.sessions) : "USD";
  const selectedDays = useMemo(
    () => groupTradesByDay(selected?.trades ?? []),
    [selected],
  );

  useEffect(() => {
    if (strategyRows.length === 0) {
      if (selectedName !== null) {
        setSelectedName(null);
      }
      return;
    }
    if (!selectedName || !strategyRows.some((strategy) => sameStrategyName(strategy.name, selectedName))) {
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
    await persistLiveJournalStrategyNames([...savedStrategyNames, nextName]);
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
      await persistLiveJournalStrategyNames(renameSavedStrategyName(savedStrategyNames, currentName, nextName));
      applyJournalStrategyNameChange(currentName, nextName);
      setSelectedName(nextName);
    } finally {
      setMutatingName(null);
    }
  }

  async function deleteStrategy(strategy: LiveStrategyGroup) {
    setMutatingName(strategy.name);
    setMutationError(null);
    try {
      await persistLiveJournalStrategyNames(removeSavedStrategyName(savedStrategyNames, strategy.name));
      applyJournalStrategyNameChange(strategy.name, "Unassigned");
      setSelectedName("Unassigned");
      setDeleteTarget(null);
    } finally {
      setMutatingName(null);
    }
  }

  function applyJournalStrategyNameChange(currentName: string, nextName: string) {
    const sessionById = new Map(sessions.map((session) => [session.id, session]));
    for (const session of sessions) {
      if (sameStrategyName(session.strategy_name || "Unassigned", currentName)) {
        journal.updateSession(session.id, { strategy_name: nextName });
      }
    }
    for (const trade of closedTrades) {
      const session = sessionById.get(trade.session_id);
      const strategyName = trade.strategy_name || session?.strategy_name || "Unassigned";
      if (sameStrategyName(strategyName, currentName)) {
        journal.updateTradeStrategy(trade.id, nextName);
      }
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
      eyebrow="Journal Strategies"
      title="Live Strategy Performance"
      description="Strategy analytics from actual trades only. Backtest strategy stats remain in Backtesting."
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
          <CardLabel icon={Target} label={`Journal strategies (${strategyRows.length})`} />
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="status-pill">{sessions.length} sessions</span>
            <span className="status-pill">{closedTrades.length} trades</span>
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
                <th className="px-3 py-3 font-medium">Net P&L</th>
                <th className="px-3 py-3 font-medium">Win rate</th>
                <th className="px-3 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {strategyRows.map((strategy) => {
                const strategyCurrency = currencyForLiveSessions(strategy.sessions);
                return (
                  <tr
                    className={`cursor-pointer border-t border-white/10 text-slate-300 hover:bg-white/5 ${selected?.name === strategy.name ? "bg-cyan-300/10" : ""}`}
                    key={strategy.name}
                    onClick={() => setSelectedName(strategy.name)}
                  >
                    <td className="px-3 py-4 font-semibold text-white">{strategy.name}</td>
                    <td className="px-3 py-4">{strategy.sessions.length}</td>
                    <td className="px-3 py-4">{strategy.aggregate.totalTrades}</td>
                    <td className="px-3 py-4 text-rose-300">{formatMoney(strategy.aggregate.averageLoss, strategyCurrency)}</td>
                    <td className="px-3 py-4 text-emerald-300">{formatMoney(strategy.aggregate.averageWin, strategyCurrency)}</td>
                    <td className={`px-3 py-4 font-semibold ${toneForNumber(strategy.aggregate.netPnl)}`}>{formatMoney(strategy.aggregate.netPnl, strategyCurrency)}</td>
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
                );
              })}
            </tbody>
          </table>
          {strategyRows.length === 0 && <EmptyState icon={Target} message="Create a live strategy or record trades with strategy names." />}
        </div>
      </FeatureCard>
      <FeatureCard>
        {selected ? (
          <div className="grid gap-4 2xl:grid-cols-[minmax(0,0.58fr)_minmax(0,0.42fr)]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardLabel icon={Target} label="Live strategy detail" />
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
              <div className="mt-4 grid gap-2 md:grid-cols-3">
                <CompactMetric label="Net P&L" value={formatMoney(selected.aggregate.netPnl, selectedCurrency)} tone={toneForNumber(selected.aggregate.netPnl)} />
                <CompactMetric label="Win rate" value={formatPercent(selected.aggregate.winRate)} />
                <CompactMetric label="Profit factor" value={formatRatio(selected.aggregate.profitFactor)} />
                <CompactMetric label="Avg R" value={formatOptionalNumber(selected.aggregate.averageR)} />
                <CompactMetric label="Max DD" value={formatMoney(selected.aggregate.maxDrawdown, selectedCurrency)} tone="text-rose-300" />
                <CompactMetric label="Sessions" value={String(selected.sessions.length)} />
              </div>
              {selected.trades.length > 0 ? (
                <div className="mt-4 grid gap-4 xl:grid-cols-2">
                  <div className="rounded-md border border-white/10 bg-black/20 p-3">
                    <CardLabel icon={LineChart} label="Live equity curve" />
                    <div className="mt-3">
                      <AreaSparkline currency={selectedCurrency} height={190} values={cumulativeValues(selected.trades)} />
                    </div>
                  </div>
                  <div className="rounded-md border border-white/10 bg-black/20 p-3">
                    <CardLabel icon={BarChart3} label="Daily P&L" />
                    <BarBreakdown
                      chartHeight={190}
                      currency={selectedCurrency}
                      maxItems={8}
                      rows={selectedDays.map((day) => ({ label: day.date.slice(5), value: day.aggregate.netPnl }))}
                    />
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-md border border-dashed border-cyan-300/20 bg-cyan-300/[0.04] px-4 py-5 text-sm text-slate-400">
                  Record a taken Journal trade with this strategy and the equity curve, daily P&L, and trade stream will appear here.
                </div>
              )}
              <div className="mt-4 rounded-md border border-white/10 bg-black/20 p-3">
                <CardLabel icon={ClipboardList} label="Recent trades" />
                <div className="mt-3 grid gap-2">
                  {selected.trades.slice().sort(compareTradesAscending).reverse().slice(0, 6).map((trade) => (
                    <div className="grid gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto]" key={trade.id}>
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-white">{formatDateTime(trade.exit_time ?? trade.entry_time)}</div>
                        <div className="text-xs text-slate-500">{trade.side} · {formatCompactNumber(trade.quantity)}</div>
                      </div>
                      <div className={`font-semibold tabular-nums ${toneForNumber(trade.realized_pnl)}`}>{formatMoney(trade.realized_pnl, selectedCurrency)}</div>
                      <div className="text-slate-500 tabular-nums">{formatOptionalNumber(trade.r_multiple)}R</div>
                    </div>
                  ))}
                  {selected.trades.length === 0 && <div className="rounded-md border border-dashed border-white/10 px-3 py-4 text-sm text-slate-500">No live trades linked yet.</div>}
                </div>
              </div>
            </div>
            <div className="min-w-0 rounded-md border border-white/10 bg-black/20 p-3">
              <CardLabel icon={PlaySquare} label="Linked live sessions" />
              <div className="mt-3 grid gap-2">
                {selected.sessions.map((session) => (
                  <div className="rounded-md bg-white/5 px-3 py-2" key={session.id}>
                    <div className="font-semibold text-white">{session.name}</div>
                    <div className="text-xs text-slate-500">{session.instrument} · {session.currency} · {session.status}</div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <MiniMetric label="Trades" value={String(selected.trades.filter((trade) => trade.session_id === session.id).length)} />
                      <MiniMetric label="Playbook" value={session.playbook_id == null ? "None" : playbookById.get(session.playbook_id)?.name ?? "Missing"} />
                    </div>
                  </div>
                ))}
                {selected.sessions.length === 0 && <div className="text-sm text-slate-500">No sessions linked yet.</div>}
              </div>
            </div>
          </div>
        ) : (
          <EmptyState icon={Target} message="No live strategy selected." />
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
              Delete <span className="font-semibold text-white">{deleteTarget.name}</span>? Linked live sessions and trades will stay intact and move to Unassigned.
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

function JournalPlaybooksPage({
  closedTrades,
  journal,
  playbooks,
  sessions,
}: JournalPageProps) {
  const currency = currencyForLiveSessions(sessions);

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
        onDeletePlaybook={journal.deletePlaybook}
        onUpdatePlaybook={journal.updatePlaybook}
        playbooks={playbooks}
        currency={currency}
        sessions={sessions}
        trades={closedTrades}
      />
    </PageScaffold>
  );
}

function JournalAccountsPage({
  accounts,
  journal,
  journalEntries,
  sessionById,
  sessions,
  settings,
}: JournalPageProps) {
  const { confirm, confirmDialog } = useThemedConfirm();
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(accounts[0]?.id ?? null);
  const [name, setName] = useState("Primary Account");
  const [broker, setBroker] = useState(settings.default_broker);
  const [currency, setCurrency] = useState(settings.default_currency);
  const [initialBalance, setInitialBalance] = useState("100000");
  const [color, setColor] = useState("#22d3ee");
  const [notes, setNotes] = useState("");
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) ?? accounts[0] ?? null;
  const [editDraft, setEditDraft] = useState({
    broker: selectedAccount?.broker ?? settings.default_broker,
    color: selectedAccount?.color ?? "#22d3ee",
    currency: selectedAccount?.currency ?? settings.default_currency,
    initialBalance: String(selectedAccount?.initial_balance ?? 0),
    name: selectedAccount?.name ?? "Journal Account",
    notes: selectedAccount?.notes ?? "",
  });
  const accountRows = useMemo(
    () =>
      accounts.map((account) => {
        const takenTrades = journalEntries.filter((trade) =>
          isTakenJournalTrade(trade) &&
          liveTradeAccountIds(trade).includes(account.id),
        );
        const missedTrades = journalEntries.filter((trade) =>
          isMissedJournalTrade(trade) &&
          liveTradeAccountIds(trade).includes(account.id),
        );
        const accountAggregate = aggregateTrades(takenTrades);
        return {
          account,
          aggregate: accountAggregate,
          balance: account.initial_balance + accountAggregate.netPnl,
          days: groupTradesByDay(takenTrades),
          missedTrades,
          trades: takenTrades,
        };
      }),
    [accounts, journalEntries],
  );
  const selectedRow = accountRows.find((row) => row.account.id === selectedAccount?.id) ?? accountRows[0] ?? null;
  const activeRows = accountRows.filter((row) => row.account.status === "ACTIVE");
  const activeAccountTrades = activeRows.flatMap((row) => row.trades);
  const accountAggregate = aggregateTrades(activeAccountTrades);
  const totalBalance = activeRows.reduce((sum, row) => sum + row.balance, 0);
  const accountCurrency = currencyForJournalAccounts(activeRows.map((row) => row.account), settings.default_currency);

  useEffect(() => {
    if (!selectedAccount && accounts[0]) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, selectedAccount]);

  useEffect(() => {
    if (!selectedAccount) {
      return;
    }
    setEditDraft({
      broker: selectedAccount.broker,
      color: selectedAccount.color,
      currency: selectedAccount.currency,
      initialBalance: String(selectedAccount.initial_balance),
      name: selectedAccount.name,
      notes: selectedAccount.notes,
    });
  }, [selectedAccount]);

  function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const account = journal.addAccount({
      broker,
      color,
      currency,
      initial_balance: Number(initialBalance) || 0,
      name,
      notes,
    });
    setSelectedAccountId(account.id);
    setName("Journal Account");
    setNotes("");
  }

  function saveSelectedAccount() {
    if (!selectedAccount) {
      return;
    }
    journal.updateAccount(selectedAccount.id, {
      broker: editDraft.broker,
      color: editDraft.color,
      currency: editDraft.currency,
      initial_balance: Number(editDraft.initialBalance) || 0,
      name: editDraft.name,
      notes: editDraft.notes,
    });
  }

  async function handleDeleteSelectedAccount() {
    if (!selectedRow) {
      return;
    }
    const linkedCount = selectedRow.trades.length + selectedRow.missedTrades.length;
    const confirmed = await confirm({
      confirmLabel: "Delete account",
      detail: linkedCount > 0
        ? `This unlinks ${linkedCount} Journal ${linkedCount === 1 ? "record" : "records"} from this account. Trades and missed setups stay in the Journal.`
        : "This removes the account profile. Journal entries stay intact.",
      message: (
        <>
          Delete <span className="font-semibold text-white">{selectedRow.account.name}</span>?
        </>
      ),
      title: "Delete journal account",
      tone: "danger",
    });
    if (confirmed) {
      journal.deleteAccount(selectedRow.account.id);
    }
  }

  return (
    <PageScaffold
      eyebrow="Journal Accounts"
      title="Journal Account Management"
      description="Manage live accounts used by Journal entries while keeping missed setups account-optional."
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ResultMetricCard icon={WalletCards} label="Active accounts" value={String(activeRows.length)} />
        <ResultMetricCard icon={BadgeDollarSign} label="Account balance" tone={toneForNumber(totalBalance)} value={formatMoney(totalBalance, accountCurrency)} />
        <ResultMetricCard icon={TrendingUp} label="Account P&L" tone={toneForNumber(accountAggregate.netPnl)} value={formatMoney(accountAggregate.netPnl, accountCurrency)} />
        <ResultMetricCard icon={Clock3} label="Unlinked missed" value={String(journalEntries.filter((trade) => isMissedJournalTrade(trade) && liveTradeAccountIds(trade).length === 0).length)} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <FeatureCard>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <CardLabel icon={WalletCards} label="Journal accounts" />
            <span className="status-pill">{accounts.length} accounts</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {accountRows.map((row) => (
              <button
                className={`rounded-md border p-3 text-left transition ${
                  selectedAccount?.id === row.account.id
                    ? "border-cyan-300/35 bg-cyan-300/10"
                    : "border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/5"
                }`}
                key={row.account.id}
                onClick={() => setSelectedAccountId(row.account.id)}
                type="button"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-white">{row.account.name}</span>
                    <span className="mt-1 block text-xs text-slate-500">{row.account.broker || "Manual"} · {row.account.currency}</span>
                  </span>
                  <span
                    className="h-3 w-3 shrink-0 rounded-full ring-2 ring-black/40"
                    style={{ backgroundColor: row.account.color, boxShadow: `0 0 18px ${row.account.color}` }}
                  />
                </div>
                <div className={`mt-4 text-xl font-semibold tabular-nums ${toneForNumber(row.balance)}`}>
                  {formatMoney(row.balance, row.account.currency)}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <MiniMetric label="Trades" value={String(row.aggregate.totalTrades)} />
                  <MiniMetric label="Win" value={formatPercent(row.aggregate.winRate)} />
                  <MiniMetric label="Missed" value={String(row.missedTrades.length)} />
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="status-pill">{row.account.status}</span>
                  <span className={`text-xs font-semibold ${toneForNumber(row.aggregate.netPnl)}`}>
                    {formatMoney(row.aggregate.netPnl, row.account.currency)}
                  </span>
                </div>
              </button>
            ))}
            {accountRows.length === 0 && <EmptyState icon={WalletCards} message="Create a Journal account to link live trades." />}
          </div>
        </FeatureCard>
        <FeatureCard>
          <CardLabel icon={Plus} label="Create account" />
          <form className="mt-4 grid gap-3" onSubmit={submitAccount}>
            <label className="form-field">
              Account name
              <input className="input-control h-10 normal-case tracking-normal" onChange={(event) => setName(event.target.value)} value={name} />
            </label>
            <label className="form-field">
              Broker
              <input className="input-control h-10 normal-case tracking-normal" onChange={(event) => setBroker(event.target.value)} value={broker} />
            </label>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(128px,150px)]">
              <label className="form-field">
                Currency
                <ThemedSelect
                  className="h-10"
                  onChange={setCurrency}
                  options={selectOptionsWithValue(CURRENCY_OPTIONS, currency)}
                  portal
                  value={currency}
                />
              </label>
              <label className="form-field min-w-0">
                Accent
                <ThemedColorPicker ariaLabel="Account color" compact onChange={setColor} value={color} />
              </label>
            </div>
            <label className="form-field">
              Starting balance
              <input className="input-control h-10 normal-case tracking-normal" min="0" onChange={(event) => setInitialBalance(event.target.value)} type="number" value={initialBalance} />
            </label>
            <label className="form-field">
              Notes
              <textarea className="input-control min-h-20 py-3 normal-case tracking-normal" onChange={(event) => setNotes(event.target.value)} value={notes} />
            </label>
            <button className="control-button workspace-tab-active justify-center" type="submit">
              <Plus size={15} />
              Save account
            </button>
          </form>
        </FeatureCard>
      </div>
      {selectedRow && (
        <FeatureCard>
          <div className="grid gap-4 2xl:grid-cols-[minmax(0,0.58fr)_minmax(0,0.42fr)]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardLabel icon={WalletCards} label="Account detail" />
                  <h3 className="mt-3 flex items-center gap-2 text-xl font-semibold text-white">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{
                        backgroundColor: selectedRow.account.color,
                        boxShadow: `0 0 18px ${selectedRow.account.color}`,
                      } as CSSProperties}
                    />
                    {selectedRow.account.name}
                  </h3>
                  <div className="mt-1 text-xs text-slate-500">{selectedRow.account.broker || "Manual"} · {selectedRow.account.currency}</div>
                </div>
                <div className="flex gap-2">
                  <button
                    className="control-button h-9"
                    onClick={() =>
                      journal.updateAccount(selectedRow.account.id, {
                        status: selectedRow.account.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED",
                      })
                    }
                    type="button"
                  >
                    {selectedRow.account.status === "ARCHIVED" ? "Restore" : "Archive"}
                  </button>
                  <button
                    className="icon-button h-9 w-9 border-rose-300/20 text-rose-200 hover:bg-rose-300/10 hover:text-rose-100"
                    onClick={() => void handleDeleteSelectedAccount()}
                    title="Delete account"
                    type="button"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-4">
                <CompactMetric label="Balance" value={formatMoney(selectedRow.balance, selectedRow.account.currency)} tone={toneForNumber(selectedRow.balance)} />
                <CompactMetric label="Net P&L" value={formatMoney(selectedRow.aggregate.netPnl, selectedRow.account.currency)} tone={toneForNumber(selectedRow.aggregate.netPnl)} />
                <CompactMetric label="Win rate" value={formatPercent(selectedRow.aggregate.winRate)} />
                <CompactMetric label="Max DD" value={formatMoney(selectedRow.aggregate.maxDrawdown, selectedRow.account.currency)} tone="text-rose-300" />
              </div>
              {selectedRow.trades.length > 0 ? (
                <>
                  <div className="mt-4 grid gap-4 xl:grid-cols-2">
                    <div className="rounded-md border border-white/10 bg-black/20 p-3">
                      <CardLabel icon={LineChart} label="Account equity" />
                      <div className="mt-3">
                        <AreaSparkline currency={selectedRow.account.currency} height={190} values={cumulativeValues(selectedRow.trades)} />
                      </div>
                    </div>
                    <div className="rounded-md border border-white/10 bg-black/20 p-3">
                      <CardLabel icon={BarChart3} label="Daily P&L" />
                      <BarBreakdown
                        chartHeight={190}
                        currency={selectedRow.account.currency}
                        maxItems={10}
                        rows={selectedRow.days.map((day) => ({ label: day.date.slice(5), value: day.aggregate.netPnl }))}
                      />
                    </div>
                  </div>
                  <div className="mt-4 rounded-md border border-white/10 bg-black/20 p-3">
                    <CardLabel icon={ClipboardList} label="Recent account trades" />
                    <div className="mt-3 grid gap-2">
                      {selectedRow.trades.slice().sort(compareTradesAscending).reverse().slice(0, 6).map((trade) => (
                        <div className="grid gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto]" key={trade.id}>
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-white">{trade.strategy_name || sessionById.get(trade.session_id)?.strategy_name || "Unassigned"}</div>
                            <div className="text-xs text-slate-500">{formatDateTime(trade.exit_time ?? trade.entry_time)} · {trade.side}</div>
                          </div>
                          <div className={`font-semibold tabular-nums ${toneForNumber(trade.realized_pnl)}`}>{formatMoney(trade.realized_pnl, selectedRow.account.currency)}</div>
                          <div className="text-slate-500 tabular-nums">{formatOptionalNumber(trade.r_multiple)}R</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="mt-4 rounded-md border border-dashed border-cyan-300/20 bg-cyan-300/[0.04] px-4 py-5">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0">
                      <CardLabel icon={ClipboardList} label="No taken trades linked" />
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                        Link this account while recording a taken Journal trade and the balance, equity curve, daily P&L, and recent trade stream will appear here.
                      </p>
                    </div>
                    <div className="grid min-w-56 grid-cols-3 gap-2">
                      <MiniMetric label="Missed" value={String(selectedRow.missedTrades.length)} />
                      <MiniMetric label="Currency" value={selectedRow.account.currency} />
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="grid content-start gap-4">
              <div className="rounded-md border border-white/10 bg-black/20 p-3">
                <CardLabel icon={Pencil} label="Edit account" />
                <div className="mt-3 grid gap-3">
                  <label className="form-field">
                    Name
                    <input className="input-control h-10 normal-case tracking-normal" onChange={(event) => setEditDraft((current) => ({ ...current, name: event.target.value }))} value={editDraft.name} />
                  </label>
                  <label className="form-field">
                    Broker
                    <input className="input-control h-10 normal-case tracking-normal" onChange={(event) => setEditDraft((current) => ({ ...current, broker: event.target.value }))} value={editDraft.broker} />
                  </label>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(128px,150px)]">
                    <label className="form-field">
                      Currency
                      <ThemedSelect
                        className="h-10"
                        onChange={(value) => setEditDraft((current) => ({ ...current, currency: value }))}
                        options={selectOptionsWithValue(CURRENCY_OPTIONS, editDraft.currency)}
                        portal
                        value={editDraft.currency}
                      />
                    </label>
                    <label className="form-field min-w-0">
                      Accent
                      <ThemedColorPicker
                        ariaLabel="Account color"
                        compact
                        onChange={(value) => setEditDraft((current) => ({ ...current, color: value }))}
                        value={editDraft.color}
                      />
                    </label>
                  </div>
                  <label className="form-field">
                    Starting balance
                    <input className="input-control h-10 normal-case tracking-normal" min="0" onChange={(event) => setEditDraft((current) => ({ ...current, initialBalance: event.target.value }))} type="number" value={editDraft.initialBalance} />
                  </label>
                  <label className="form-field">
                    Notes
                    <textarea className="input-control min-h-24 py-3 normal-case tracking-normal" onChange={(event) => setEditDraft((current) => ({ ...current, notes: event.target.value }))} value={editDraft.notes} />
                  </label>
                  <button className="control-button workspace-tab-active justify-center" onClick={saveSelectedAccount} type="button">
                    <Save size={15} />
                    Save account changes
                  </button>
                </div>
              </div>
            </div>
          </div>
        </FeatureCard>
      )}
      {confirmDialog}
    </PageScaffold>
  );
}

function JournalSettingsPage({
  accounts,
  journal,
  journalEntries,
  sessions,
  settings,
}: JournalPageProps) {
  const [defaultBroker, setDefaultBroker] = useState(settings.default_broker);
  const [defaultCurrency, setDefaultCurrency] = useState(settings.default_currency);
  const [defaultEntryType, setDefaultEntryType] = useState<JournalEntryType>(settings.default_entry_type);
  const [defaultRiskPercent, setDefaultRiskPercent] = useState(String(settings.default_risk_percent));
  const [defaultAccountIds, setDefaultAccountIds] = useState<number[]>(settings.default_account_ids);
  const [requireAccount, setRequireAccount] = useState(settings.require_account_for_taken_trades);
  const [commissionMode, setCommissionMode] = useState<OrderCommissionMode>(settings.default_commission_mode);
  const [commissionFixed, setCommissionFixed] = useState(settings.default_commission_mode === "FIXED" ? formatNumberInput(settings.default_commission_value) : "0");
  const [commissionPercent, setCommissionPercent] = useState(settings.default_commission_mode === "PERCENT" ? formatNumberInput(settings.default_commission_value) : "0");
  const [feeMode, setFeeMode] = useState<OrderCommissionMode>(settings.default_fee_mode);
  const [feeFixed, setFeeFixed] = useState(settings.default_fee_mode === "FIXED" ? formatNumberInput(settings.default_fee_value) : "0");
  const [feePercent, setFeePercent] = useState(settings.default_fee_mode === "PERCENT" ? formatNumberInput(settings.default_fee_value) : "0");
  const [status, setStatus] = useState<string | null>(null);
  const activeAccounts = accounts.filter((account) => account.status === "ACTIVE");

  useEffect(() => {
    setDefaultBroker(settings.default_broker);
    setDefaultCurrency(settings.default_currency);
    setDefaultEntryType(settings.default_entry_type);
    setDefaultRiskPercent(String(settings.default_risk_percent));
    setDefaultAccountIds(settings.default_account_ids);
    setRequireAccount(settings.require_account_for_taken_trades);
    setCommissionMode(settings.default_commission_mode);
    setCommissionFixed(settings.default_commission_mode === "FIXED" ? formatNumberInput(settings.default_commission_value) : "0");
    setCommissionPercent(settings.default_commission_mode === "PERCENT" ? formatNumberInput(settings.default_commission_value) : "0");
    setFeeMode(settings.default_fee_mode);
    setFeeFixed(settings.default_fee_mode === "FIXED" ? formatNumberInput(settings.default_fee_value) : "0");
    setFeePercent(settings.default_fee_mode === "PERCENT" ? formatNumberInput(settings.default_fee_value) : "0");
  }, [settings]);

  function toggleDefaultAccount(accountId: number) {
    setDefaultAccountIds((current) =>
      current.includes(accountId) ? current.filter((id) => id !== accountId) : [...current, accountId],
    );
  }

  function saveSettings() {
    journal.updateSettings({
      default_account_ids: defaultAccountIds,
      default_broker: defaultBroker,
      default_commission_mode: commissionMode,
      default_commission_value: costValueForPayload(commissionMode, commissionFixed, commissionPercent),
      default_currency: defaultCurrency,
      default_entry_type: defaultEntryType,
      default_fee_mode: feeMode,
      default_fee_value: costValueForPayload(feeMode, feeFixed, feePercent),
      default_risk_percent: numberFromTextOrZero(defaultRiskPercent),
      require_account_for_taken_trades: requireAccount,
    });
    setStatus("Saved");
    window.setTimeout(() => setStatus(null), 1800);
  }

  return (
    <PageScaffold
      eyebrow="Journal Settings"
      title="Live Journal Settings"
      description="Personal defaults for new Journal accounts, sessions, and entries."
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ResultMetricCard icon={WalletCards} label="Accounts" value={String(accounts.length)} />
        <ResultMetricCard icon={PlaySquare} label="Sessions" value={String(sessions.length)} />
        <ResultMetricCard icon={ClipboardList} label="Journal entries" value={String(journalEntries.length)} />
        <ResultMetricCard icon={Clock3} label="Missed setups" value={String(journalEntries.filter(isMissedJournalTrade).length)} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.58fr)_minmax(0,0.42fr)]">
        <FeatureCard>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <CardLabel icon={Settings} label="Entry defaults" />
            {status && <span className="status-pill">{status}</span>}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="form-field">
              Default broker
              <input className="input-control h-10 normal-case tracking-normal" onChange={(event) => setDefaultBroker(event.target.value)} value={defaultBroker} />
            </label>
            <label className="form-field">
              Default currency
              <ThemedSelect
                className="h-10"
                onChange={setDefaultCurrency}
                options={selectOptionsWithValue(CURRENCY_OPTIONS, defaultCurrency)}
                portal
                value={defaultCurrency}
              />
            </label>
            <label className="form-field">
              Default live risk %
              <input className="input-control h-10 normal-case tracking-normal" min="0" onChange={(event) => setDefaultRiskPercent(event.target.value)} type="number" value={defaultRiskPercent} />
            </label>
            <label className="form-field">
              Default entry type
              <ThemedSelect
                className="h-10"
                onChange={(value) => setDefaultEntryType(value as JournalEntryType)}
                options={[
                  { label: "Taken trade", value: "TAKEN" },
                  { label: "Missed setup", value: "MISSED" },
                ]}
                value={defaultEntryType}
              />
            </label>
          </div>
          <div className="mt-4 rounded-md border border-white/10 bg-black/20 p-3">
            <div className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Default accounts</div>
            <div className="grid gap-2 md:grid-cols-2">
              {activeAccounts.map((account) => (
                <JournalAccountToggle
                  account={account}
                  active={defaultAccountIds.includes(account.id)}
                  key={account.id}
                  onClick={() => toggleDefaultAccount(account.id)}
                />
              ))}
              {activeAccounts.length === 0 && <div className="rounded-md border border-dashed border-white/10 px-3 py-4 text-sm text-slate-500 md:col-span-2">Create a Journal account to set account defaults.</div>}
            </div>
            <div className="mt-3">
              <JournalBooleanToggle
                checked={requireAccount}
                description="Missed setups can still stay account-optional."
                label="Require at least one account for taken trades"
                onChange={setRequireAccount}
              />
            </div>
          </div>
        </FeatureCard>
        <FeatureCard>
          <CardLabel icon={BadgeDollarSign} label="Global trade cost defaults" />
          <div className="mt-4 grid gap-3">
            <CostConfigCard
              fixedValue={commissionFixed}
              mode={commissionMode}
              onFixedValueChange={setCommissionFixed}
              onModeChange={setCommissionMode}
              onPercentValueChange={setCommissionPercent}
              percentValue={commissionPercent}
              title="Default commissions"
            />
            <CostConfigCard
              fixedValue={feeFixed}
              mode={feeMode}
              onFixedValueChange={setFeeFixed}
              onModeChange={setFeeMode}
              onPercentValueChange={setFeePercent}
              percentValue={feePercent}
              title="Default brokerage"
            />
            <button className="control-button workspace-tab-active justify-center" onClick={saveSettings} type="button">
              <Save size={15} />
              Save journal defaults
            </button>
          </div>
        </FeatureCard>
      </div>
      <FeatureCard>
        <CardLabel icon={Database} label="Journal data summary" />
        <div className="mt-4 grid gap-2 md:grid-cols-4">
          <CompactMetric label="Taken trades" value={String(journalEntries.filter(isTakenJournalTrade).length)} />
          <CompactMetric label="Missed setups" value={String(journalEntries.filter(isMissedJournalTrade).length)} />
          <CompactMetric label="Trade accounts" value={String(accounts.filter((account) => account.status === "ACTIVE").length)} />
          <CompactMetric label="Default currency" value={defaultCurrency} />
        </div>
      </FeatureCard>
    </PageScaffold>
  );
}

function JournalTagPicker({
  attachedMistakeTags,
  customTag,
  mistakeOptions,
  onAddTags,
  onCustomTagChange,
  onCustomTagKeyDown,
  onDeleteSuggestion,
  onRemoveTag,
  onToggleTag,
  tags,
}: {
  attachedMistakeTags: Set<string>;
  customTag: string;
  mistakeOptions: string[];
  onAddTags: (value: string) => void;
  onCustomTagChange: (value: string) => void;
  onCustomTagKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onDeleteSuggestion: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onToggleTag: (tag: string) => void;
  tags: string[];
}) {
  return (
    <section className="rounded-md border border-white/10 bg-black/20 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <CardLabel icon={Tags} label="Mistake tags" />
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
              <button className="px-3 py-2" onClick={() => onToggleTag(option)} type="button">
                {option}
              </button>
              {canDeleteSuggestion && (
                <button
                  className="border-l border-white/10 px-2 text-slate-500 hover:bg-rose-300/10 hover:text-rose-100"
                  onClick={() => onDeleteSuggestion(option)}
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
          onChange={(event) => onCustomTagChange(event.target.value)}
          onKeyDown={onCustomTagKeyDown}
          placeholder="Add custom tag"
          value={customTag}
        />
        <button
          className="control-button"
          disabled={!customTag.trim()}
          onClick={() => onAddTags(customTag)}
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
              onClick={() => onRemoveTag(tag)}
              type="button"
            >
              {tag}
              <X size={12} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function JournalScreenshotInput({
  onChange,
  value,
}: {
  onChange: (value: string) => void;
  value: string;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const uploaded = value.startsWith("data:");

  function readFile(file: File | undefined) {
    if (!file || !file.type.startsWith("image/")) {
      setUploadMessage("Choose an image file.");
      return;
    }
    setUploadMessage(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        onChange(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  function handleDrop(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    readFile(event.dataTransfer.files?.[0]);
  }

  function handlePaste(event: ReactClipboardEvent<HTMLDivElement>) {
    const pastedImage = Array.from(event.clipboardData.files).find((file) => file.type.startsWith("image/"));
    if (!pastedImage) {
      return;
    }
    event.preventDefault();
    readFile(pastedImage);
  }

  return (
    <section className="rounded-md border border-white/10 bg-black/20 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <CardLabel icon={Image} label="Screenshot" />
        {value && (
          <button className="control-button h-8 px-2 text-xs" onClick={() => onChange("")} type="button">
            <X size={13} />
            Clear
          </button>
        )}
      </div>
      <div
        className={`grid min-h-28 cursor-pointer place-items-center rounded-md border border-dashed px-4 py-4 text-center transition focus:outline-none focus:ring-2 focus:ring-cyan-300/35 ${
          dragActive ? "border-cyan-300/50 bg-cyan-300/10" : "border-white/10 bg-white/[0.03] hover:border-white/20"
        }`}
        onClick={() => fileInputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget;
          if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
            setDragActive(false);
          }
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        onPaste={handlePaste}
        role="button"
        tabIndex={0}
      >
        {value ? (
          <div className="grid w-full gap-3">
            <img alt="Trade screenshot preview" className="max-h-40 w-full rounded-md object-contain" src={value} />
            <div className="text-xs text-slate-500">{uploaded ? "Uploaded image attached" : "Linked screenshot URL"}</div>
          </div>
        ) : (
          <div>
            <div className="mx-auto grid h-10 w-10 place-items-center rounded-md border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
              <Image size={17} />
            </div>
            <p className="mt-2 text-sm font-semibold text-slate-200">Click or drop screenshot</p>
            <p className="mt-1 text-xs text-slate-500">Paste also works</p>
          </div>
        )}
      </div>
      <div className="mt-3">
        <input
          className="input-control h-10 normal-case tracking-normal"
          onChange={(event) => onChange(event.target.value)}
          placeholder="Paste screenshot URL"
          value={uploaded ? "" : value}
        />
      </div>
      <input
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          readFile(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
        ref={fileInputRef}
        type="file"
      />
      {uploadMessage && <div className="mt-2 text-xs text-rose-200">{uploadMessage}</div>}
    </section>
  );
}

function JournalDateTimeInput({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <div className="grid gap-2">
      <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <ReplayDateTimePicker
        currentTimestamp={null}
        dateFormat="MMM dd yyyy"
        dayOfWeekLabels={false}
        dialogLabel={`${label} Time`}
        disabled={false}
        onChange={onChange}
        placeholder={`Select ${label.toLowerCase()} time`}
        timeHoursFormat="24-hour"
        value={value}
      />
    </div>
  );
}

function JournalRichNoteEditor({
  onChange,
  placeholder = "Write the trade review notes...",
  value,
}: {
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  const noteRef = useRef<HTMLDivElement | null>(null);
  const editorToolbarRef = useRef<HTMLDivElement | null>(null);
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const lastInternalValueRef = useRef<string | null>(null);
  const savedSelectionRef = useRef<Range | null>(null);
  const editingLinkRef = useRef<HTMLAnchorElement | null>(null);
  const [noteFocused, setNoteFocused] = useState(false);
  const [editorState, setEditorState] = useState<NotebookEditorState>(DEFAULT_NOTEBOOK_EDITOR_STATE);
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const [alignMenuOpen, setAlignMenuOpen] = useState(false);

  function closeEditorPopovers() {
    setLinkPopoverOpen(false);
    setLinkText("");
    setLinkUrl("");
    setColorMenuOpen(false);
    setAlignMenuOpen(false);
    editingLinkRef.current = null;
  }

  useCloseOnOutsidePointer(linkPopoverOpen || colorMenuOpen || alignMenuOpen, [editorToolbarRef], closeEditorPopovers);

  useEffect(() => {
    if (value === lastInternalValueRef.current) {
      return;
    }
    const nextValue = normalizeStoredNoteHtml(value);
    if (noteRef.current && noteRef.current.innerHTML !== nextValue) {
      noteRef.current.innerHTML = nextValue;
    }
    lastInternalValueRef.current = value;
  }, [value]);

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

  function handleEditorInput(event: FormEvent<HTMLDivElement>) {
    pushEditorValue(sanitizeRichTextHtml(event.currentTarget.innerHTML));
    updateEditorState();
  }

  function syncNotesFromEditor() {
    pushEditorValue(sanitizeRichTextHtml(noteRef.current?.innerHTML ?? ""));
    updateEditorState();
  }

  function pushEditorValue(nextValue: string) {
    lastInternalValueRef.current = nextValue;
    onChange(nextValue);
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

  function runEditorCommand(command: string, commandValue?: string) {
    if (typeof document === "undefined") {
      return;
    }
    restoreEditorSelection();
    if (!selectionIsInEditor()) {
      focusNoteEditor();
    }
    document.execCommand(command, false, commandValue);
    saveEditorSelection();
    syncNotesFromEditor();
    requestAnimationFrame(updateEditorState);
  }

  function insertRichHtml(html: string) {
    if (typeof document === "undefined") {
      pushEditorValue(`${value}${value ? "<br>" : ""}${html}`);
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

  return (
    <section className="rounded-md border border-white/10 bg-black/20">
      <div className="relative flex flex-wrap items-center gap-1 border-b border-white/10 p-2" ref={editorToolbarRef}>
        {[
          { active: editorState.bold, action: "bold", icon: Bold, label: "Bold" },
          { active: editorState.italic, action: "italic", icon: Italic, label: "Italic" },
          { active: editorState.underline, action: "underline", icon: Underline, label: "Underline" },
          { active: editorState.strike, action: "strikeThrough", icon: Strikethrough, label: "Strikethrough" },
          { active: editorState.bulletList, action: "insertUnorderedList", icon: List, label: "Bullet list" },
          { active: editorState.orderedList, action: "insertOrderedList", icon: ListOrdered, label: "Numbered list" },
        ].map(({ active, action, icon: Icon, label }) => (
          <button
            aria-pressed={active}
            className={`notebook-editor-button ${active ? "notebook-editor-button-active" : ""}`}
            key={action}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runEditorCommand(action)}
            title={label}
            type="button"
          >
            <Icon size={14} />
          </button>
        ))}
        <button
          aria-pressed={linkPopoverOpen}
          className={`notebook-editor-button ${linkPopoverOpen ? "notebook-editor-button-active" : ""}`}
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
              <div className="notebook-popover-title">Text color</div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {NOTE_COLOR_OPTIONS.map((option) => {
                  const active = editorState.color === option.value.toLowerCase();
                  return (
                    <button
                      className={`notebook-color-option ${active ? "notebook-color-option-active" : ""}`}
                      key={option.value}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        runEditorCommand("foreColor", option.value);
                        setColorMenuOpen(false);
                      }}
                      title={option.label}
                      type="button"
                    >
                      <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/20" style={{ backgroundColor: option.value }} />
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
            {editorState.align === "right" ? <AlignRight size={14} /> : editorState.align === "center" ? <AlignCenter size={14} /> : <AlignLeft size={14} />}
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
                      onClick={() => {
                        runEditorCommand(option.command);
                        setAlignMenuOpen(false);
                      }}
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
                <input className="notebook-link-input" onChange={(event) => setLinkText(event.target.value)} placeholder="Display text" value={linkText} />
              </label>
              <label className="notebook-link-field">
                <span>URL</span>
                <input className="notebook-link-input" onChange={(event) => setLinkUrl(event.target.value)} placeholder="example.com" ref={linkInputRef} value={linkUrl} />
              </label>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button className="icon-button h-8 w-8" onClick={closeEditorPopovers} title="Cancel" type="button">
                <X size={14} />
              </button>
              <button className="control-button h-8 border-cyan-300/30 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20" disabled={!normalizeLinkUrl(linkUrl)} type="submit">
                {editingLinkRef.current ? "Update" : "Apply"}
              </button>
            </div>
          </form>
        )}
      </div>
      <div className="relative">
        {isRichTextEmpty(value) && !noteFocused && (
          <span className="pointer-events-none absolute left-4 top-3 text-sm text-slate-600">{placeholder}</span>
        )}
        <div
          className="notebook-rich-editor min-h-40 w-full resize-y overflow-auto bg-transparent px-4 py-3 text-sm text-slate-300 outline-none"
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
  );
}

function LiveTradeForm({
  allTrades = [],
  accounts,
  fixedSessionId,
  initialTrade = null,
  journal,
  onCancelEdit,
  onSaved,
  playbooks,
  sessions,
  settings,
  strategies,
  layout = "compact",
  title = "Record actual trade",
}: {
  allTrades?: JournalTrade[];
  accounts: LiveJournalAccount[];
  fixedSessionId?: number;
  initialTrade?: JournalTrade | null;
  journal: LiveJournalController;
  layout?: "compact" | "wide";
  onCancelEdit?: () => void;
  onSaved?: () => void;
  playbooks: Playbook[];
  sessions: LiveJournalSession[];
  settings: LiveJournalSettings;
  strategies: LiveStrategyGroup[];
  title?: string;
}) {
  const savedStrategyNames = useLiveJournalStrategyNames();
  const strategyNameOptions = useMemo(
    () => mergeLiveStrategyGroups(strategies, savedStrategyNames).map((strategy) => strategy.name),
    [savedStrategyNames, strategies],
  );
  const activeAccounts = useMemo(
    () => accounts.filter((account) => account.status === "ACTIVE"),
    [accounts],
  );
  const fixedSession = fixedSessionId == null
    ? null
    : sessions.find((session) => session.id === fixedSessionId) ?? null;
  const defaultSession = fixedSession ?? sessions[0];
  const defaultSessionId = String(defaultSession?.id ?? 1);
  const defaultAccountIds = useMemo(
    () =>
      settings.default_account_ids.filter((accountId) =>
        activeAccounts.some((account) => account.id === accountId),
      ),
    [activeAccounts, settings.default_account_ids],
  );
  const [sessionId, setSessionId] = useState(defaultSessionId);
  const [entryType, setEntryType] = useState<JournalEntryType>(settings.default_entry_type);
  const [accountIds, setAccountIds] = useState<number[]>(defaultAccountIds);
  const [playbookId, setPlaybookId] = useState(defaultSession?.playbook_id == null ? "" : String(defaultSession.playbook_id));
  const [side, setSide] = useState<"LONG" | "SHORT">("LONG");
  const [strategy, setStrategy] = useState(normalizeLiveJournalStrategyName(defaultSession?.strategy_name));
  const [entryTime, setEntryTime] = useState(defaultDateTimeLocal(-60));
  const [exitTime, setExitTime] = useState(defaultDateTimeLocal(0));
  const [entryPrice, setEntryPrice] = useState("1.00000");
  const [exitPrice, setExitPrice] = useState("1.00100");
  const [quantity, setQuantity] = useState("10000");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [emotion, setEmotion] = useState<string>("Calm");
  const [screenshotUrl, setScreenshotUrl] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState("");
  const [notes, setNotes] = useState("");
  const [missedReason, setMissedReason] = useState("");
  const [commissionMode, setCommissionMode] = useState<OrderCommissionMode>(defaultSession?.commission_mode ?? settings.default_commission_mode);
  const [commissionFixed, setCommissionFixed] = useState(costFixedValueForMode(defaultSession?.commission_mode ?? settings.default_commission_mode, defaultSession?.commission_value ?? settings.default_commission_value));
  const [commissionPercent, setCommissionPercent] = useState(costPercentValueForMode(defaultSession?.commission_mode ?? settings.default_commission_mode, defaultSession?.commission_value ?? settings.default_commission_value));
  const [brokerageMode, setBrokerageMode] = useState<OrderCommissionMode>(defaultSession?.brokerage_mode ?? settings.default_fee_mode);
  const [brokerageFixed, setBrokerageFixed] = useState(costFixedValueForMode(defaultSession?.brokerage_mode ?? settings.default_fee_mode, defaultSession?.brokerage_value ?? settings.default_fee_value));
  const [brokeragePercent, setBrokeragePercent] = useState(costPercentValueForMode(defaultSession?.brokerage_mode ?? settings.default_fee_mode, defaultSession?.brokerage_value ?? settings.default_fee_value));
  const [formError, setFormError] = useState<string | null>(null);
  const submitInFlightRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const selectedSession = useMemo(
    () => sessions.find((session) => String(session.id) === sessionId) ?? sessions[0] ?? null,
    [sessionId, sessions],
  );
  const selectedAccounts = useMemo(
    () => activeAccounts.filter((account) => accountIds.includes(account.id)),
    [accountIds, activeAccounts],
  );
  const selectedTradeCurrency = selectedAccounts.length > 0
    ? currencyForJournalAccounts(selectedAccounts, selectedSession?.currency ?? settings.default_currency)
    : normalizeCurrencyCode(selectedSession?.currency ?? settings.default_currency);
  const strategyOptions = useMemo(
    () => journalStrategySelectOptions(strategyNameOptions, strategy),
    [strategy, strategyNameOptions],
  );
  const activeStrategyScope = strategyTagScope(strategy || selectedSession?.strategy_name || "Unassigned");
  const [strategyCustomTags, setStrategyCustomTags] = useState<string[]>(() =>
    loadStrategyMistakeTags(activeStrategyScope),
  );
  const mistakeOptions = useMemo(
    () => mergeTags(DEFAULT_MISTAKE_TAGS, strategyCustomTags),
    [strategyCustomTags],
  );
  const attachedMistakeTags = useMemo(
    () => new Set(allTrades.flatMap((trade) => trade.mistake_tags.map((tag) => tag.toLowerCase()))),
    [allTrades],
  );
  const pnlPreview = useMemo(() => {
    const parsedEntry = parseOptionalFloat(entryPrice) ?? 0;
    const parsedExit = parseOptionalFloat(exitPrice);
    const parsedQuantity = parseOptionalFloat(quantity) ?? 0;
    const gross =
      entryType === "TAKEN" && parsedExit != null
        ? side === "LONG"
          ? (parsedExit - parsedEntry) * parsedQuantity
          : (parsedEntry - parsedExit) * parsedQuantity
        : 0;
    const notional = Math.abs(parsedEntry * parsedQuantity);
    const commissionValue = costValueForPayload(commissionMode, commissionFixed, commissionPercent);
    const brokerageValue = costValueForPayload(brokerageMode, brokerageFixed, brokeragePercent);
    const commissions = entryType === "TAKEN"
      ? journalCostAmount(commissionMode, commissionValue, notional)
      : 0;
    const brokerage = entryType === "TAKEN"
      ? journalCostAmount(brokerageMode, brokerageValue, notional)
      : 0;
    return {
      brokerage,
      commissions,
      gross,
      net: gross - commissions - brokerage,
      notional,
    };
  }, [
    brokerageFixed,
    brokerageMode,
    brokeragePercent,
    commissionFixed,
    commissionMode,
    commissionPercent,
    entryPrice,
    entryType,
    exitPrice,
    quantity,
    side,
  ]);
  const parsedEntryForSubmit = parseOptionalFloat(entryPrice);
  const parsedExitForSubmit = parseOptionalFloat(exitPrice);
  const parsedQuantityForSubmit = parseOptionalFloat(quantity);
  const missedDraftHasDetails =
    missedReason.trim().length > 0 ||
    !isRichTextEmpty(notes) ||
    screenshotUrl.trim().length > 0 ||
    tags.length > 0 ||
    parsedEntryForSubmit != null ||
    parsedExitForSubmit != null ||
    parseOptionalFloat(stopLoss) != null ||
    parseOptionalFloat(takeProfit) != null;
  const canSubmitTrade =
    !submitting &&
    (initialTrade != null ||
      (entryType === "TAKEN"
        ? parsedEntryForSubmit != null &&
          parsedExitForSubmit != null &&
          parsedQuantityForSubmit != null &&
          parsedQuantityForSubmit > 0
        : missedDraftHasDetails));
  const accountCopyCount = selectedAccounts.length;
  const saveTradeLabel = initialTrade
    ? "Save trade changes"
    : entryType === "MISSED"
      ? accountCopyCount > 1
        ? `Save ${accountCopyCount} missed entries`
        : "Save missed setup"
      : accountCopyCount > 1
        ? `Save ${accountCopyCount} account trades`
        : "Save actual trade";
  const wideLayout = layout === "wide";
  const formClassName = wideLayout
    ? "mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-12"
    : "mt-4 grid gap-3";
  const fullSpanClass = wideLayout ? "lg:col-span-2 xl:col-span-12" : "";
  const halfSpanClass = wideLayout ? "lg:col-span-1 xl:col-span-6" : "";
  const thirdSpanClass = wideLayout ? "lg:col-span-1 xl:col-span-4" : "";

  useEffect(() => {
    if (initialTrade) {
      const tradeSession = sessions.find((session) => session.id === initialTrade.session_id) ?? defaultSession;
      const nextEntryType: JournalEntryType = isMissedJournalTrade(initialTrade) ? "MISSED" : "TAKEN";
      const tradeAccounts = liveTradeAccountIds(initialTrade);
      const commission = normalizeCommissionMode(initialTrade.commission_mode);
      const brokerage = normalizeCommissionMode(initialTrade.fee_mode);
      setSessionId(String(tradeSession?.id ?? initialTrade.session_id));
      setEntryType(nextEntryType);
      setAccountIds(filterLiveAccountIds(tradeAccounts, activeAccounts));
      setPlaybookId(initialTrade.playbook_id == null ? "" : String(initialTrade.playbook_id));
      setSide(initialTrade.side);
      setStrategy(normalizeLiveJournalStrategyName(initialTrade.strategy_name || tradeSession?.strategy_name));
      setEntryTime(dateTimeLocalFromIso(initialTrade.entry_time));
      setExitTime(dateTimeLocalFromIso(initialTrade.exit_time ?? initialTrade.entry_time));
      setEntryPrice(formatNumberInput(nextEntryType === "MISSED" ? initialTrade.planned_entry_price ?? initialTrade.entry_price : initialTrade.entry_price));
      setExitPrice(formatNumberInput(nextEntryType === "MISSED" ? initialTrade.planned_exit_price ?? initialTrade.exit_price : initialTrade.exit_price));
      setQuantity(formatNumberInput(initialTrade.quantity));
      setStopLoss(formatNumberInput(nextEntryType === "MISSED" ? initialTrade.planned_stop_loss : initialTrade.stop_loss));
      setTakeProfit(formatNumberInput(nextEntryType === "MISSED" ? initialTrade.planned_take_profit : initialTrade.take_profit));
      setEmotion(initialTrade.emotional_state || "Calm");
      setScreenshotUrl(initialTrade.screenshot_url ?? "");
      setTags(initialTrade.mistake_tags);
      setCustomTag("");
      setNotes(normalizeStoredNoteHtml(initialTrade.notes));
      setMissedReason(initialTrade.missed_reason ?? "");
      setCommissionMode(commission);
      setCommissionFixed(costFixedValueForMode(commission, initialTrade.commission_value ?? 0));
      setCommissionPercent(costPercentValueForMode(commission, initialTrade.commission_value ?? 0));
      setBrokerageMode(brokerage);
      setBrokerageFixed(costFixedValueForMode(brokerage, initialTrade.fee_value ?? 0));
      setBrokeragePercent(costPercentValueForMode(brokerage, initialTrade.fee_value ?? 0));
      setFormError(null);
      return;
    }

    const selectedSession = fixedSession ?? sessions.find((session) => String(session.id) === sessionId) ?? defaultSession;
    if (!selectedSession) {
      return;
    }
    if (fixedSessionId != null && String(selectedSession.id) !== sessionId) {
      setSessionId(String(selectedSession.id));
    }
    setStrategy(normalizeLiveJournalStrategyName(selectedSession.strategy_name));
    setPlaybookId(selectedSession.playbook_id == null ? "" : String(selectedSession.playbook_id));
    setAccountIds(defaultAccountIds);
    setCommissionMode(selectedSession.commission_mode);
    setCommissionFixed(costFixedValueForMode(selectedSession.commission_mode, selectedSession.commission_value));
    setCommissionPercent(costPercentValueForMode(selectedSession.commission_mode, selectedSession.commission_value));
    setBrokerageMode(selectedSession.brokerage_mode);
    setBrokerageFixed(costFixedValueForMode(selectedSession.brokerage_mode, selectedSession.brokerage_value));
    setBrokeragePercent(costPercentValueForMode(selectedSession.brokerage_mode, selectedSession.brokerage_value));
  }, [activeAccounts, defaultAccountIds, defaultSession, fixedSession, fixedSessionId, initialTrade, sessionId, sessions]);

  useEffect(() => {
    if (!initialTrade) {
      setEntryType(settings.default_entry_type);
    }
  }, [initialTrade, settings.default_entry_type]);

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

  function toggleAccount(accountId: number) {
    setAccountIds((current) =>
      current.includes(accountId)
        ? current.filter((id) => id !== accountId)
        : [...current, accountId],
    );
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

  function resetTradeDraft() {
    const draftSession = fixedSession ?? selectedSession ?? defaultSession;
    if (draftSession) {
      setSessionId(String(draftSession.id));
      setStrategy(normalizeLiveJournalStrategyName(draftSession.strategy_name));
      setPlaybookId(draftSession.playbook_id == null ? "" : String(draftSession.playbook_id));
      setCommissionMode(draftSession.commission_mode);
      setCommissionFixed(costFixedValueForMode(draftSession.commission_mode, draftSession.commission_value));
      setCommissionPercent(costPercentValueForMode(draftSession.commission_mode, draftSession.commission_value));
      setBrokerageMode(draftSession.brokerage_mode);
      setBrokerageFixed(costFixedValueForMode(draftSession.brokerage_mode, draftSession.brokerage_value));
      setBrokeragePercent(costPercentValueForMode(draftSession.brokerage_mode, draftSession.brokerage_value));
    }
    setEntryType(settings.default_entry_type);
    setAccountIds(defaultAccountIds);
    setSide("LONG");
    setEntryTime("");
    setExitTime("");
    setEntryPrice("");
    setExitPrice("");
    setQuantity("");
    setStopLoss("");
    setTakeProfit("");
    setEmotion("Calm");
    setScreenshotUrl("");
    setTags([]);
    setCustomTag("");
    setNotes("");
    setMissedReason("");
    setFormError(null);
  }

  function releaseSubmitLock(delay = 0) {
    const release = () => {
      submitInFlightRef.current = false;
      setSubmitting(false);
    };
    if (delay > 0 && typeof window !== "undefined") {
      window.setTimeout(release, delay);
      return;
    }
    release();
  }

  function submitTrade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitInFlightRef.current) {
      return;
    }
    submitInFlightRef.current = true;
    setSubmitting(true);
    const parsedEntry = parseOptionalFloat(entryPrice);
    const parsedExit = parseOptionalFloat(exitPrice);
    const parsedQuantity = parseOptionalFloat(quantity);
    const parsedStopLoss = parseOptionalFloat(stopLoss);
    const parsedTakeProfit = parseOptionalFloat(takeProfit);
    if (entryType === "TAKEN" && (parsedEntry == null || parsedExit == null || parsedQuantity == null || parsedQuantity <= 0)) {
      setFormError("Taken trades need entry, exit, and size.");
      releaseSubmitLock();
      return;
    }
    if (entryType === "TAKEN" && settings.require_account_for_taken_trades && accountIds.length === 0) {
      setFormError("Select at least one account for a taken trade, or mark the entry as missed.");
      releaseSubmitLock();
      return;
    }
    if (entryType === "MISSED" && !missedDraftHasDetails) {
      setFormError("Add a missed reason, note, screenshot, tag, or planned level before saving.");
      releaseSubmitLock();
      return;
    }
    setFormError(null);
    const payload: LiveTradeInput = {
      accountIds: entryType === "MISSED" ? accountIds : accountIds,
      brokerageMode,
      brokerageValue: costValueForPayload(brokerageMode, brokerageFixed, brokeragePercent),
      commissionMode,
      commissionValue: costValueForPayload(commissionMode, commissionFixed, commissionPercent),
      emotionalState: emotion || null,
      entryPrice: entryType === "TAKEN" ? parsedEntry : null,
      entryType,
      entryTime,
      exitPrice: entryType === "TAKEN" ? parsedExit : null,
      exitTime,
      mistakeTags: tags,
      missedReason: entryType === "MISSED" ? missedReason.trim() || null : null,
      notes: isRichTextEmpty(notes) ? null : sanitizeRichTextHtml(notes),
      playbookId: playbookId ? Number(playbookId) : null,
      plannedEntryPrice: entryType === "MISSED" ? parsedEntry : null,
      plannedExitPrice: entryType === "MISSED" ? parsedExit : null,
      plannedStopLoss: entryType === "MISSED" ? parsedStopLoss : null,
      plannedTakeProfit: entryType === "MISSED" ? parsedTakeProfit : null,
      quantity: parsedQuantity,
      screenshotUrl: screenshotUrl.trim() || null,
      sessionId: Number(sessionId) || sessions[0]?.id || 1,
      side,
      stopLoss: entryType === "TAKEN" ? parsedStopLoss : null,
      strategyName: normalizeLiveJournalStrategyName(strategy),
      takeProfit: entryType === "TAKEN" ? parsedTakeProfit : null,
    };
    if (initialTrade) {
      journal.updateTrade(initialTrade.id, payload);
    } else {
      journal.addTrade(payload);
    }
    persistStrategyMistakeTags(activeStrategyScope, tags);
    resetTradeDraft();
    onSaved?.();
    releaseSubmitLock(350);
  }

  return (
    <FeatureCard>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardLabel icon={initialTrade ? Pencil : Plus} label={title} />
        {initialTrade && (
          <button className="control-button h-8 px-2 text-xs" onClick={onCancelEdit} type="button">
            <X size={13} />
            Cancel edit
          </button>
        )}
      </div>
      <form className={formClassName} onSubmit={submitTrade}>
        <div className={`grid grid-cols-2 gap-2 ${thirdSpanClass}`}>
          <button
            className={`control-button justify-center ${entryType === "TAKEN" ? "workspace-tab-active" : ""}`}
            onClick={() => setEntryType("TAKEN")}
            type="button"
          >
            Taken
          </button>
          <button
            className={`control-button justify-center ${entryType === "MISSED" ? "workspace-tab-active" : ""}`}
            onClick={() => setEntryType("MISSED")}
            type="button"
          >
            Missed
          </button>
        </div>
        {fixedSessionId == null ? (
          <label className={`form-field ${thirdSpanClass}`}>
            Live session
            <ThemedSelect
              className="h-10"
              onChange={setSessionId}
              options={sessions.map((session) => ({
                label: session.name,
                sublabel: `${session.instrument} · ${session.currency}`,
                value: String(session.id),
              }))}
              portal
              value={sessionId}
            />
          </label>
        ) : selectedSession ? (
          <div className={`rounded-md border border-white/10 bg-black/20 px-3 py-2 ${thirdSpanClass}`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600">Session</div>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-white">{selectedSession.name}</span>
              <span className="text-xs text-slate-500">{selectedSession.instrument} · {selectedSession.currency}</span>
            </div>
          </div>
        ) : null}
        <div className={`grid grid-cols-2 gap-2 ${thirdSpanClass}`}>
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
        <label className={`form-field ${halfSpanClass}`}>
          Strategy
          <ThemedSelect
            className="h-10"
            onChange={setStrategy}
            options={strategyOptions}
            portal
            value={strategy}
          />
        </label>
        <label className={`form-field ${halfSpanClass}`}>
          Playbook
          <ThemedSelect
            className="h-10"
            onChange={setPlaybookId}
            options={[
              { label: "No playbook", value: "" },
              ...playbooks.map((playbook) => ({
                label: playbook.name,
                sublabel: playbook.description ?? undefined,
                value: String(playbook.id),
              })),
            ]}
            value={playbookId}
          />
        </label>
        <div className={`grid gap-2 ${fullSpanClass}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
              Accounts
            </div>
            <span className="text-[11px] text-slate-600">
              {entryType === "MISSED"
                ? accountCopyCount > 1
                  ? `Creates ${accountCopyCount} missed entries`
                  : "Optional for missed entries"
                : accountCopyCount > 1
                  ? `Creates ${accountCopyCount} account trades`
                  : "Select multiple for copied trades"}
            </span>
          </div>
          <div className={`grid gap-2 ${wideLayout ? "md:grid-cols-2 xl:grid-cols-3" : ""}`}>
            {activeAccounts.map((account) => {
              const active = accountIds.includes(account.id);
              return (
                <JournalAccountToggle
                  account={account}
                  active={active}
                  key={account.id}
                  onClick={() => toggleAccount(account.id)}
                />
              );
            })}
            {activeAccounts.length === 0 && (
              <div className="rounded-md border border-dashed border-white/10 px-3 py-4 text-sm text-slate-500">
                Create an account from Journal Accounts, or save a missed entry without one.
              </div>
            )}
          </div>
        </div>
        <div className={`grid gap-3 ${fullSpanClass}`}>
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Trade details</div>
          <div className={`grid gap-3 ${wideLayout ? "xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)_minmax(0,1.45fr)]" : ""}`}>
            <div className="rounded-md border border-white/10 bg-black/20 p-3">
              <div className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Mindset</div>
              <div className="flex flex-wrap gap-1.5">
                {LIVE_EMOTIONS.map((item) => (
                  <button
                    className={`h-8 rounded border px-2.5 text-xs font-semibold transition ${
                      emotion === item
                        ? "border-cyan-200 bg-white text-ink-950"
                        : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:bg-white/10 hover:text-white"
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
            <div className="rounded-md border border-white/10 bg-black/20 p-3">
              <div className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Timing</div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <JournalDateTimeInput label="Entry" onChange={setEntryTime} value={entryTime} />
                <JournalDateTimeInput label="Exit" onChange={setExitTime} value={exitTime} />
              </div>
            </div>
            <div className="rounded-md border border-white/10 bg-black/20 p-3">
              <div className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Price and size</div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                <label className="form-field">
                  {entryType === "MISSED" ? "Planned entry" : "Entry"}
                  <input className="input-control h-10 normal-case tracking-normal" onChange={(event) => setEntryPrice(event.target.value)} value={entryPrice} />
                </label>
                <label className="form-field">
                  {entryType === "MISSED" ? "Planned exit" : "Exit"}
                  <input className="input-control h-10 normal-case tracking-normal" onChange={(event) => setExitPrice(event.target.value)} value={exitPrice} />
                </label>
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
            </div>
          </div>
        </div>
        {entryType === "TAKEN" && (
          <div className={`grid gap-3 ${fullSpanClass}`}>
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Costs and preview</div>
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(320px,0.9fr)]">
              <CostConfigCard
                fixedValue={commissionFixed}
                mode={commissionMode}
                onFixedValueChange={setCommissionFixed}
                onModeChange={setCommissionMode}
                onPercentValueChange={setCommissionPercent}
                percentValue={commissionPercent}
                title="Trade commission"
              />
              <CostConfigCard
                fixedValue={brokerageFixed}
                mode={brokerageMode}
                onFixedValueChange={setBrokerageFixed}
                onModeChange={setBrokerageMode}
                onPercentValueChange={setBrokeragePercent}
                percentValue={brokeragePercent}
                title="Trade brokerage"
              />
              <div className="rounded-md border border-white/10 bg-black/20 p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <CardLabel icon={BadgeDollarSign} label="Trade preview" />
                  <span className="status-pill h-7 px-2 text-[10px]">{selectedTradeCurrency}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <MiniMetric label="Gross" value={formatMoney(pnlPreview.gross, selectedTradeCurrency)} />
                  <MiniMetric label="Net" value={formatMoney(pnlPreview.net, selectedTradeCurrency)} />
                  <MiniMetric label="Commissions" value={formatMoney(pnlPreview.commissions, selectedTradeCurrency)} />
                  <MiniMetric label="Brokerage" value={formatMoney(pnlPreview.brokerage, selectedTradeCurrency)} />
                </div>
              </div>
            </div>
          </div>
        )}
        <div className={`grid gap-3 ${fullSpanClass}`}>
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Review assets</div>
          <div className={`grid gap-3 ${wideLayout ? "xl:grid-cols-[minmax(0,0.9fr)_minmax(360px,0.7fr)]" : ""}`}>
            <JournalTagPicker
              attachedMistakeTags={attachedMistakeTags}
              customTag={customTag}
              mistakeOptions={mistakeOptions}
              onAddTags={addTags}
              onCustomTagChange={setCustomTag}
              onCustomTagKeyDown={handleCustomTagKeyDown}
              onDeleteSuggestion={deleteMistakeSuggestion}
              onRemoveTag={removeTag}
              onToggleTag={(tag) =>
                setTags((current) =>
                  current.includes(tag) ? current.filter((currentTag) => currentTag !== tag) : [...current, tag],
                )
              }
              tags={tags}
            />
            <JournalScreenshotInput onChange={setScreenshotUrl} value={screenshotUrl} />
          </div>
        </div>
        {entryType === "MISSED" && (
          <label className={`form-field ${fullSpanClass}`}>
            Missed reason
            <textarea
              className="input-control min-h-20 py-3 normal-case tracking-normal"
              onChange={(event) => setMissedReason(event.target.value)}
              placeholder="Why was the setup missed?"
              value={missedReason}
            />
          </label>
        )}
        <div className={`grid gap-2 ${fullSpanClass}`}>
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Notes</div>
          <JournalRichNoteEditor onChange={setNotes} value={notes} />
        </div>
        {formError && (
          <div className={`rounded-md border border-rose-300/20 bg-rose-300/10 px-3 py-2 text-sm text-rose-100 ${fullSpanClass}`}>
            {formError}
          </div>
        )}
        <button className={`control-button workspace-tab-active justify-center ${fullSpanClass}`} disabled={!canSubmitTrade} type="submit">
          {submitting ? "Saving..." : saveTradeLabel}
        </button>
      </form>
    </FeatureCard>
  );
}

function LiveTradeTable({
  accountById,
  onDeleteTrade,
  onEditTrade,
  onOpenReview,
  onScrollChange,
  onScrollRestored,
  playbookById,
  restoreScroll,
  sessionById,
  trades,
}: {
  accountById: Map<number, LiveJournalAccount>;
  onDeleteTrade?: (trade: JournalTrade) => void;
  onEditTrade?: (trade: JournalTrade) => void;
  onOpenReview?: (trade: JournalTrade) => void;
  onScrollChange?: (position: ScrollSnapshot) => void;
  onScrollRestored?: () => void;
  playbookById: Map<number, Playbook>;
  restoreScroll?: ScrollSnapshot | null;
  sessionById: Map<number, LiveJournalSession>;
  trades: JournalTrade[];
}) {
  const { confirm, confirmDialog } = useThemedConfirm();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const sortedTrades = trades.slice().sort(compareTradesAscending).reverse();

  async function confirmAndDeleteTrade(trade: JournalTrade) {
    if (!onDeleteTrade) {
      return;
    }
    const confirmed = await confirm(journalTradeDeleteConfirmOptions(trade));
    if (confirmed) {
      onDeleteTrade(trade);
    }
  }

  useEffect(() => {
    if (!restoreScroll || !scrollerRef.current) {
      return;
    }
    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const scroller = scrollerRef.current;
        if (scroller) {
          scroller.scrollLeft = restoreScroll.left;
          scroller.scrollTop = restoreScroll.top;
        }
        onScrollRestored?.();
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [onScrollRestored, restoreScroll]);

  return (
    <FeatureCard>
      <div className="mb-4 flex items-center justify-between gap-3">
        <CardLabel icon={ClipboardList} label="Journal ledger" />
        <span className="text-xs text-slate-500">
          {trades.filter(isTakenJournalTrade).length} taken · {trades.filter(isMissedJournalTrade).length} missed
        </span>
      </div>
      <div
        className="overflow-auto"
        onScroll={(event) => {
          onScrollChange?.({
            left: event.currentTarget.scrollLeft,
            top: event.currentTarget.scrollTop,
          });
        }}
        ref={scrollerRef}
      >
        <table className="w-full min-w-[1260px] text-left text-sm">
          <thead className="text-xs uppercase tracking-[0.16em] text-slate-500">
            <tr>
              <th className="px-3 py-3 font-medium">Type</th>
              <th className="px-3 py-3 font-medium">Session</th>
              <th className="px-3 py-3 font-medium">Accounts</th>
              <th className="px-3 py-3 font-medium">Entry / Plan</th>
              <th className="px-3 py-3 font-medium">Exit / Target</th>
              <th className="px-3 py-3 font-medium">Side</th>
              <th className="px-3 py-3 font-medium">Size</th>
              <th className="px-3 py-3 font-medium">P&L</th>
              <th className="px-3 py-3 font-medium">Costs</th>
              <th className="px-3 py-3 font-medium">R</th>
              <th className="px-3 py-3 font-medium">Strategy</th>
              <th className="px-3 py-3 font-medium">Playbook</th>
              <th className="px-3 py-3 font-medium">Emotion</th>
              <th className="px-3 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedTrades.map((trade) => {
              const session = sessionById.get(trade.session_id);
              const accountIds = liveTradeAccountIds(trade);
              const accounts = accountIds
                .map((accountId) => accountById.get(accountId))
                .filter((account): account is LiveJournalAccount => Boolean(account));
              const currency = currencyForJournalTrade(trade, accountById, sessionById);
              const missed = isMissedJournalTrade(trade);
              const reviewText = journalTradeReviewText(trade);
              return (
                <tr className="border-t border-white/10 text-slate-300" key={trade.id}>
                  <td className="px-3 py-4">
                    <span className={`rounded px-2 py-1 text-xs font-semibold ${missed ? "bg-amber-300/10 text-amber-200" : "bg-cyan-300/10 text-cyan-100"}`}>
                      {missed ? "MISSED" : "TAKEN"}
                    </span>
                  </td>
                  <td className="px-3 py-4">
                    <div className="font-semibold text-white">{session?.name ?? "Live session"}</div>
                    <div className="text-xs text-slate-500">{session?.instrument ?? "Manual"}</div>
                  </td>
                  <td className="px-3 py-4">
                    <div className="flex max-w-44 flex-wrap gap-1">
                      {accounts.map((account) => (
                        <JournalAccountBadge account={account} compact key={account.id} />
                      ))}
                      {accounts.length === 0 && <span className="text-xs text-slate-600">Unlinked</span>}
                    </div>
                  </td>
                  <td className="px-3 py-4">
                    <div className="font-semibold text-white">{formatPrice(missed ? trade.planned_entry_price : trade.entry_price)}</div>
                    <div className="text-xs text-slate-500">{formatDateTime(trade.entry_time)}</div>
                  </td>
                  <td className="px-3 py-4">
                    <div className="font-semibold text-white">{formatPrice(missed ? trade.planned_exit_price : trade.exit_price)}</div>
                    <div className="text-xs text-slate-500">{missed ? `Stop ${formatPrice(trade.planned_stop_loss)} · TP ${formatPrice(trade.planned_take_profit)}` : formatDateTime(trade.exit_time)}</div>
                  </td>
                  <td className="px-3 py-4">
                    <span className={`rounded px-2 py-1 text-xs font-semibold ${trade.side === "LONG" ? "bg-emerald-300/10 text-emerald-200" : "bg-rose-300/10 text-rose-200"}`}>
                      {trade.side}
                    </span>
                  </td>
                  <td className="px-3 py-4">{missed && trade.quantity === 0 ? "-" : formatCompactNumber(trade.quantity)}</td>
                  <td className={`px-3 py-4 font-semibold ${missed ? "text-slate-500" : toneForNumber(trade.realized_pnl)}`}>
                    {missed ? "Missed" : formatMoney(trade.realized_pnl, currency)}
                  </td>
                  <td className="px-3 py-4 text-xs text-slate-500">
                    {missed ? "-" : `${formatMoney(trade.commission_amount ?? 0, currency)} / ${formatMoney(trade.fee_amount ?? 0, currency)}`}
                  </td>
                  <td className="px-3 py-4">{missed ? "-" : formatOptionalNumber(trade.r_multiple)}</td>
                  <td className="px-3 py-4">{trade.strategy_name || session?.strategy_name || "-"}</td>
                  <td className="px-3 py-4">{trade.playbook_id ? playbookById.get(trade.playbook_id)?.name ?? "Missing" : "-"}</td>
                  <td className="px-3 py-4">{trade.emotional_state || "-"}</td>
                  <td className="px-3 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {onOpenReview ? (
                        <button
                          className="control-button h-8 whitespace-nowrap px-2 text-xs"
                          onClick={() => onOpenReview(trade)}
                          title={reviewText}
                          type="button"
                        >
                          <NotebookPen size={13} />
                          Trade notes
                        </button>
                      ) : (
                        <div className="max-w-52 truncate text-xs text-slate-500" title={reviewText}>{reviewText}</div>
                      )}
                      {onEditTrade && (
                        <button className="control-button h-8 whitespace-nowrap px-2 text-xs" onClick={() => onEditTrade(trade)} title="Edit trade" type="button">
                          <Pencil size={13} />
                          Edit
                        </button>
                      )}
                      {onDeleteTrade && (
                        <button
                          className="control-button h-8 whitespace-nowrap border-rose-300/20 px-2 text-xs text-rose-200 hover:bg-rose-300/10 hover:text-rose-100"
                          onClick={() => void confirmAndDeleteTrade(trade)}
                          title="Delete journal entry"
                          type="button"
                        >
                          <Trash2 size={13} />
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {trades.length === 0 && <EmptyState icon={ClipboardList} message="Record a Journal entry to populate the ledger." />}
      </div>
      {confirmDialog}
    </FeatureCard>
  );
}

function NotebookPage({
  closedTrades,
  datasets,
  notebookFocusTradeId,
  notebookReturnToBacktestPanel,
  onReturnToBacktestPanel,
  onReturnToDayView,
  onReturnToTradeView,
  onReplayTrade,
  sessionById,
  strategies,
}: SharedPageProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "favorites">("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const filterMenuRef = useRef<HTMLDivElement | null>(null);
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
  useCloseOnOutsidePointer(filterOpen, [filterMenuRef], () => setFilterOpen(false));
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

  function exportVisibleNotesCsv() {
    exportTradeLogCsv(visibleTrades, sessionById, datasets);
  }

  const returnAction = onReturnToTradeView ? (
    <button className="control-button" onClick={onReturnToTradeView} type="button">
      <ArrowLeft size={15} />
      Back to Trades
    </button>
  ) : onReturnToDayView ? (
    <button className="control-button" onClick={onReturnToDayView} type="button">
      <ArrowLeft size={15} />
      Back to Day View
    </button>
  ) : onReturnToBacktestPanel ? (
    <button className="control-button" onClick={onReturnToBacktestPanel} type="button">
      <ArrowLeft size={15} />
      {notebookReturnToBacktestPanel === "results" ? "Back to Results" : "Back to Review"}
    </button>
  ) : null;

  return (
    <PageScaffold
      eyebrow="Backtest Notebook"
      title="Backtest Trade Notes"
      description="An EdgeLab notebook linked to closed replay trades and session review."
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {returnAction}
          <button className="control-button" disabled={visibleTrades.length === 0} onClick={exportVisibleNotesCsv} type="button">
            <FileDown size={15} />
            Export CSV
          </button>
        </div>
      }
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
              <div className="relative" ref={filterMenuRef}>
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
  const editorToolbarRef = useRef<HTMLDivElement | null>(null);
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
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
  const [commissionMode, setCommissionMode] = useState<OrderCommissionMode>(() =>
    normalizeCommissionMode(trade.commission_mode),
  );
  const [commissionValue, setCommissionValue] = useState(() =>
    formatNumberInput(trade.commission_value),
  );
  const [feeMode, setFeeMode] = useState<OrderCommissionMode>(() =>
    normalizeCommissionMode(trade.fee_mode),
  );
  const [feeValue, setFeeValue] = useState(() => formatNumberInput(trade.fee_value));
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
  const savedCommissionMode = normalizeCommissionMode(trade.commission_mode);
  const savedCommissionValue = formatNumberInput(trade.commission_value);
  const savedFeeMode = normalizeCommissionMode(trade.fee_mode);
  const savedFeeValue = formatNumberInput(trade.fee_value);
  const hasChanges =
    notes !== savedNotes ||
    strategy !== savedStrategy ||
    emotion !== (trade.emotional_state ?? "") ||
    commissionMode !== savedCommissionMode ||
    (commissionMode !== "NONE" && commissionValue !== savedCommissionValue) ||
    feeMode !== savedFeeMode ||
    (feeMode !== "NONE" && feeValue !== savedFeeValue) ||
    snapshotUrl !== (trade.screenshot_url ?? "") ||
    !sameStringList(tags, trade.mistake_tags);

  function closeEditorPopovers() {
    setLinkPopoverOpen(false);
    setLinkText("");
    setLinkUrl("");
    setColorMenuOpen(false);
    setAlignMenuOpen(false);
    editingLinkRef.current = null;
  }

  useCloseOnOutsidePointer(moreOpen, [moreMenuRef], () => setMoreOpen(false));
  useCloseOnOutsidePointer(linkPopoverOpen || colorMenuOpen || alignMenuOpen, [editorToolbarRef], closeEditorPopovers);

  useEffect(() => {
    const nextNotes = normalizeStoredNoteHtml(trade.notes);
    setNotes(nextNotes);
    if (noteRef.current && noteRef.current.innerHTML !== nextNotes) {
      noteRef.current.innerHTML = nextNotes;
    }
    setNoteFocused(false);
    setStrategy(tradeStrategyName(trade, session ?? undefined));
    setEmotion(trade.emotional_state ?? "");
    setCommissionMode(normalizeCommissionMode(trade.commission_mode));
    setCommissionValue(formatNumberInput(trade.commission_value));
    setFeeMode(normalizeCommissionMode(trade.fee_mode));
    setFeeValue(formatNumberInput(trade.fee_value));
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

  function openSnapshotFullSize() {
    const url = snapshotUrl || trade.screenshot_url;
    if (!url) {
      setSnapshotActionStatus("Snapshot is not ready");
      return;
    }
    setSnapshotActionStatus(openScreenshotFullSize(url) ? "Snapshot opened" : "Could not open snapshot");
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
        commission_mode: commissionMode,
        commission_value: commissionMode === "NONE" ? 0 : numberFromTextOrZero(commissionValue),
        fee_mode: feeMode,
        fee_value: feeMode === "NONE" ? 0 : numberFromTextOrZero(feeValue),
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
      trade.commission_amount > 0 ? `Commission: ${formatMoney(trade.commission_amount, currency)}` : null,
      trade.fee_amount > 0 ? `Fees: ${formatMoney(trade.fee_amount, currency)}` : null,
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
        <div className="flex gap-2">
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
          <div className="relative" ref={moreMenuRef}>
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
            label="Net P&L"
            value={formatMoney(trade.realized_pnl, currency)}
            tone={toneForNumber(trade.realized_pnl)}
          />
          <CompactMetric
            label="Gross P&L"
            value={formatMoney(trade.gross_pnl ?? trade.realized_pnl, currency)}
            tone={toneForNumber(trade.gross_pnl ?? trade.realized_pnl)}
          />
          <CompactMetric label="Commission" value={formatMoney(trade.commission_amount ?? 0, currency)} />
          <CompactMetric label="Fees" value={formatMoney(trade.fee_amount ?? 0, currency)} />
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
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(220px,0.7fr)_minmax(220px,0.7fr)]">
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
            <section className="rounded-md border border-white/10 bg-black/20 p-2">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Commissions
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  { label: "None", value: "NONE" },
                  { label: "Fixed", value: "FIXED" },
                  { label: "Percent", value: "PERCENT" },
                ] as Array<{ label: string; value: OrderCommissionMode }>).map((option) => (
                  <button
                    className={`segmented px-2 text-xs ${commissionMode === option.value ? "segmented-active" : ""}`}
                    key={option.value}
                    onClick={() => setCommissionMode(option.value)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {commissionMode !== "NONE" && (
                <label className="form-field mt-2">
                  <span>{commissionMode === "FIXED" ? "Fixed commission" : "Percent commission"}</span>
                  <input
                    className="input-control h-10"
                    min="0"
                    onChange={(event) => setCommissionValue(event.target.value)}
                    step={commissionMode === "FIXED" ? "0.01" : "0.0001"}
                    type="number"
                    value={commissionValue}
                  />
                </label>
              )}
            </section>
            <section className="rounded-md border border-white/10 bg-black/20 p-2">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Fees
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  { label: "None", value: "NONE" },
                  { label: "Fixed", value: "FIXED" },
                  { label: "Percent", value: "PERCENT" },
                ] as Array<{ label: string; value: OrderCommissionMode }>).map((option) => (
                  <button
                    className={`segmented px-2 text-xs ${feeMode === option.value ? "segmented-active" : ""}`}
                    key={option.value}
                    onClick={() => setFeeMode(option.value)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {feeMode !== "NONE" && (
                <label className="form-field mt-2">
                  <span>{feeMode === "FIXED" ? "Fixed fee" : "Percent fee"}</span>
                  <input
                    className="input-control h-10"
                    min="0"
                    onChange={(event) => setFeeValue(event.target.value)}
                    step={feeMode === "FIXED" ? "0.01" : "0.0001"}
                    type="number"
                    value={feeValue}
                  />
                </label>
              )}
            </section>
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
            <div className="relative flex flex-wrap items-center gap-1 border-b border-white/10 p-2" ref={editorToolbarRef}>
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
                aria-pressed={linkPopoverOpen}
                className={`notebook-editor-button ${linkPopoverOpen ? "notebook-editor-button-active" : ""}`}
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
                  disabled={!snapshotUrl && !trade.screenshot_url}
                  onClick={openSnapshotFullSize}
                  type="button"
                >
                  <Eye size={14} />
                  Open
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

function normalizeCommissionMode(value: unknown): OrderCommissionMode {
  return value === "FIXED" || value === "PERCENT" ? value : "NONE";
}

function CostConfigCard({
  fixedValue,
  mode,
  onFixedValueChange,
  onModeChange,
  onPercentValueChange,
  percentValue,
  title,
}: {
  fixedValue: string;
  mode: OrderCommissionMode;
  onFixedValueChange: (value: string) => void;
  onModeChange: (value: OrderCommissionMode) => void;
  onPercentValueChange: (value: string) => void;
  percentValue: string;
  title: string;
}) {
  return (
    <section className="rounded-md border border-white/10 bg-black/20 p-3">
      <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        {title}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {([
          { label: "None", value: "NONE" },
          { label: "Fixed", value: "FIXED" },
          { label: "Percent", value: "PERCENT" },
        ] as Array<{ label: string; value: OrderCommissionMode }>).map((option) => (
          <button
            className={`segmented ${mode === option.value ? "segmented-active" : ""}`}
            key={option.value}
            onClick={() => onModeChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
      {mode !== "NONE" && (
        <label className="form-field mt-3">
          <span>{mode === "FIXED" ? "Fixed amount" : "Percent amount"}</span>
          <input
            className="input-control h-10"
            min="0"
            onChange={(event) =>
              mode === "FIXED"
                ? onFixedValueChange(event.target.value)
                : onPercentValueChange(event.target.value)
            }
            step={mode === "FIXED" ? "0.01" : "0.0001"}
            type="number"
            value={mode === "FIXED" ? fixedValue : percentValue}
          />
        </label>
      )}
    </section>
  );
}

function formatNumberInput(value: number | null | undefined) {
  return Number.isFinite(value) ? String(value) : "0";
}

function numberFromTextOrZero(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function costValueForPayload(mode: OrderCommissionMode, fixedValue: string, percentValue: string) {
  if (mode === "FIXED") {
    return numberFromTextOrZero(fixedValue);
  }
  if (mode === "PERCENT") {
    return numberFromTextOrZero(percentValue);
  }
  return 0;
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
  closedTrades,
  currency,
  datasets,
  sessionById,
  sessions,
  strategies,
}: SharedPageProps) {
  const [tab, setTab] = useState<ReportTab>("performance");
  const [performanceDetailTab, setPerformanceDetailTab] = useState<PerformanceDetailTab>("summary");
  const [timeBreakdown, setTimeBreakdown] = useState<TimeBreakdownMode>("weekday");
  const [riskBreakdown, setRiskBreakdown] = useState<RiskBreakdownMode>("rMultiple");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<ResultFilterState>(DEFAULT_RESULT_FILTERS);
  const filtersMenuRef = useRef<HTMLDivElement | null>(null);
  useCloseOnOutsidePointer(filtersOpen, [filtersMenuRef], () => setFiltersOpen(false));
  const filteredClosedTrades = useMemo(
    () => filterResultTrades(closedTrades, filters, sessionById),
    [closedTrades, filters, sessionById],
  );
  const filteredAggregate = useMemo(() => aggregateTrades(filteredClosedTrades), [filteredClosedTrades]);
  const filteredDays = useMemo(() => groupTradesByDay(filteredClosedTrades), [filteredClosedTrades]);
  const reportCurrency = useMemo(
    () => currencyForFilteredScope(filteredClosedTrades, sessionById, datasets, currency, filters),
    [currency, datasets, filteredClosedTrades, filters, sessionById],
  );
  const filteredStrategies = useMemo(
    () =>
      groupByStrategy(sessions, filteredClosedTrades, sessionById).filter(
        (strategy) => strategy.aggregate.totalTrades > 0,
      ),
    [filteredClosedTrades, sessionById, sessions],
  );
  const tagRows = useMemo(() => groupByTag(filteredClosedTrades), [filteredClosedTrades]);
  const rRows = useMemo(() => groupByRMultiple(filteredClosedTrades), [filteredClosedTrades]);
  const hourRows = useMemo(() => groupByHour(filteredClosedTrades), [filteredClosedTrades]);
  const weekdayRows = useMemo(() => groupByWeekday(filteredClosedTrades), [filteredClosedTrades]);
  const monthRows = useMemo(() => groupByMonth(filteredClosedTrades), [filteredClosedTrades]);
  const durationRows = useMemo(() => groupByHoldDuration(filteredClosedTrades), [filteredClosedTrades]);
  const sideRows = useMemo(() => groupBySide(filteredClosedTrades), [filteredClosedTrades]);
  const quantityRows = useMemo(() => groupByQuantity(filteredClosedTrades), [filteredClosedTrades]);
  const dailyPnlRows = useMemo(
    () => filteredDays.slice().reverse().map((day) => ({ label: day.date.slice(5), value: day.aggregate.netPnl })),
    [filteredDays],
  );
  const timeRows = timeBreakdown === "weekday"
    ? weekdayRows
    : timeBreakdown === "month"
      ? monthRows
      : timeBreakdown === "duration"
        ? durationRows
        : hourRows;
  const timeTitle = timeBreakdown === "weekday"
    ? "Day"
    : timeBreakdown === "month"
      ? "Month"
      : timeBreakdown === "duration"
        ? "Trade duration"
        : "Trade time";
  const riskRows = riskBreakdown === "rMultiple"
    ? rRows
    : riskBreakdown === "side"
      ? sideRows
      : riskBreakdown === "quantity"
        ? quantityRows
        : durationRows;
  const riskTitle = riskBreakdown === "rMultiple"
    ? "R multiple"
    : riskBreakdown === "side"
      ? "Direction"
      : riskBreakdown === "quantity"
        ? "Quantity"
        : "Hold time";
  const filtersActive = resultFiltersActive(filters);
  const reportTabs: Array<{ icon: LucideIcon; id: ReportTab; label: string }> = [
    { icon: LineChart, id: "performance", label: "Performance" },
    { icon: Globe2, id: "overview", label: "Overview" },
    { icon: Clock3, id: "daytime", label: "Day & Time" },
    { icon: Gauge, id: "risk", label: "Risk" },
    { icon: Target, id: "tags", label: "Tags" },
    { icon: TrendingUp, id: "winsLosses", label: "Wins/Losses" },
    { icon: CalendarDays, id: "calendar", label: "Calendar" },
    { icon: FileText, id: "recaps", label: "Recaps" },
  ];

  function exportMetricsCsv() {
    exportResultsSummaryCsv({
      aggregate: filteredAggregate,
      currency: reportCurrency,
      days: filteredDays,
      filenamePrefix: "backtest-metrics",
      sessionById,
      strategies: filteredStrategies,
      trades: filteredClosedTrades,
    });
  }

  return (
    <PageScaffold
      eyebrow="Backtest Reports"
      title="Backtest Performance Reports"
      description="Performance, overview, day/time, risk, tags, calendar, and recaps from replay/backtest trades only."
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="relative" ref={filtersMenuRef}>
            <button
              className={`control-button ${filtersOpen ? "workspace-tab-active" : ""}`}
              onClick={() => setFiltersOpen((value) => !value)}
              type="button"
            >
              <Filter size={15} />
              Filters
              {filtersActive && <span className="status-pill h-6 px-2 text-[10px]">On</span>}
            </button>
            {filtersOpen && (
              <ResultFiltersPopover
                closedTrades={closedTrades}
                filters={filters}
                onApply={(nextFilters) => {
                  setFilters(nextFilters);
                  setFiltersOpen(false);
                }}
                onClose={() => setFiltersOpen(false)}
                onReset={() => setFilters(DEFAULT_RESULT_FILTERS)}
                sessionById={sessionById}
                strategies={strategies}
              />
            )}
          </div>
          <button className="control-button" disabled={filteredClosedTrades.length === 0} onClick={exportMetricsCsv} type="button">
            <FileDown size={15} />
            Export CSV
          </button>
        </div>
      }
    >
      <section className="terminal-panel p-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap gap-1">
            {reportTabs.map(({ icon: Icon, id, label }) => (
              <button
                className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-xs font-semibold transition ${
                  tab === id ? "bg-cyan-300/10 text-cyan-100 ring-1 ring-cyan-300/20" : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`}
                key={id}
                onClick={() => setTab(id)}
                type="button"
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="status-pill h-8 px-2 text-[11px]">
              {filteredClosedTrades.length}/{closedTrades.length} trades
            </span>
            {reportCurrency === MIXED_CURRENCY && (
              <span className="status-pill h-8 px-2 text-[11px]">Mixed currencies</span>
            )}
            {filtersActive && (
              <button className="control-button h-8 px-2 text-xs" onClick={() => setFilters(DEFAULT_RESULT_FILTERS)} type="button">
                <RefreshCw size={13} />
                Reset
              </button>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <ResultMetricCard icon={BadgeDollarSign} label="Net P&L" tone={toneForNumber(filteredAggregate.netPnl)} value={formatMoney(filteredAggregate.netPnl, reportCurrency)} />
        <ResultMetricCard icon={BadgeDollarSign} label="Gross P&L" tone={toneForNumber(filteredAggregate.grossPnl)} value={formatMoney(filteredAggregate.grossPnl, reportCurrency)} />
        <ResultMetricCard icon={WalletCards} label="Commissions" value={formatMoney(filteredAggregate.totalCommissions, reportCurrency)} />
        <ResultMetricCard icon={WalletCards} label="Fees" value={formatMoney(filteredAggregate.totalFees, reportCurrency)} />
        <ResultMetricCard icon={Activity} label="Win rate" value={formatPercent(filteredAggregate.winRate)} />
        <ResultMetricCard icon={Target} label="Trades" value={String(filteredAggregate.totalTrades)} />
        <ResultMetricCard icon={Gauge} label="Avg R" tone={toneForNumber(filteredAggregate.averageR)} value={formatOptionalNumber(filteredAggregate.averageR)} />
        <ResultMetricCard icon={TrendingDown} label="Max DD" tone="text-rose-300" value={formatMoney(filteredAggregate.maxDrawdown, reportCurrency)} />
      </div>

      {tab === "performance" && (
        <div className="grid gap-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.12fr)_minmax(360px,0.88fr)]">
            <FeatureCard className="overflow-hidden p-0">
              <MetricChartHeader
                icon={LineChart}
                label="Net P&L"
                meta={`${filteredAggregate.totalTrades} closed trades`}
                tone={toneForNumber(filteredAggregate.netPnl)}
                value={formatMoney(filteredAggregate.netPnl, reportCurrency)}
              />
              <div className="px-4 pb-4">
                <AreaSparkline currency={reportCurrency} height={288} values={cumulativeValues(filteredClosedTrades)} />
              </div>
            </FeatureCard>
            <FeatureCard className="overflow-hidden p-0">
              <MetricChartHeader
                icon={BarChart3}
                label="Daily P&L"
                meta={`${filteredDays.length} trading days`}
                tone={toneForNumber(bestRow(filteredDays.map((day) => ({ aggregate: day.aggregate, label: day.label })))?.aggregate.netPnl)}
                value={formatMoney(bestRow(filteredDays.map((day) => ({ aggregate: day.aggregate, label: day.label })))?.aggregate.netPnl ?? 0, reportCurrency)}
              />
              <div className="px-4 pb-4">
                <BarBreakdown chartHeight={288} currency={reportCurrency} maxItems={18} rows={dailyPnlRows} />
              </div>
            </FeatureCard>
          </div>

          <FeatureCard>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <CardLabel icon={Gauge} label="Performance detail" />
              <ReportSegmentedTabs
                active={performanceDetailTab}
                options={[
                  { label: "Summary", value: "summary" },
                  { label: "Days", value: "days" },
                  { label: "Trades", value: "trades" },
                ]}
                onChange={(value) => setPerformanceDetailTab(value as PerformanceDetailTab)}
              />
            </div>
            {performanceDetailTab === "summary" && <StatsGrid aggregate={filteredAggregate} currency={reportCurrency} />}
            {performanceDetailTab === "days" && (
              <ResultsDayTable currency={reportCurrency} datasets={datasets} days={filteredDays} sessionById={sessionById} />
            )}
            {performanceDetailTab === "trades" && (
              <ResultsTradeTable currency={reportCurrency} datasets={datasets} sessionById={sessionById} trades={filteredClosedTrades} />
            )}
          </FeatureCard>
        </div>
      )}

      {tab === "overview" && (
        <div className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <InsightMetric currency={reportCurrency} row={bestRow(monthRows)} title="Best month" />
            <InsightMetric currency={reportCurrency} row={worstRow(monthRows)} title="Weakest month" />
            <InsightMetric currency={reportCurrency} row={bestRow(filteredDays.map((day) => ({ aggregate: day.aggregate, label: day.label })))} title="Best day" />
            <InsightMetric currency={reportCurrency} row={worstRow(filteredDays.map((day) => ({ aggregate: day.aggregate, label: day.label })))} title="Weakest day" />
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.66fr)_minmax(320px,0.34fr)]">
            <FeatureCard className="overflow-hidden p-0">
              <MetricChartHeader
                icon={LineChart}
                label="Equity curve"
                meta="Filtered closed trades"
                tone={toneForNumber(filteredAggregate.netPnl)}
                value={formatMoney(filteredAggregate.netPnl, reportCurrency)}
              />
              <div className="px-4 pb-4">
                <AreaSparkline currency={reportCurrency} height={260} values={cumulativeValues(filteredClosedTrades)} />
              </div>
            </FeatureCard>
            <FeatureCard>
              <CardLabel icon={Target} label="Top strategies" />
              <div className="mt-4 grid gap-2">
                {filteredStrategies.slice(0, 5).map((strategy) => (
                  <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2" key={strategy.name}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-semibold text-white">{strategy.name}</span>
                      <span className={`shrink-0 text-sm font-semibold tabular-nums ${toneForNumber(strategy.aggregate.netPnl)}`}>
                        {formatMoney(strategy.aggregate.netPnl, reportCurrency)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {strategy.aggregate.totalTrades} trades · {formatPercent(strategy.aggregate.winRate)} win rate
                    </div>
                  </div>
                ))}
                {filteredStrategies.length === 0 && <EmptyState icon={Target} message="No strategies in this filtered scope." />}
              </div>
            </FeatureCard>
          </div>
          <FeatureCard>
            <CardLabel icon={Gauge} label="Summary metrics" />
            <div className="mt-4">
              <StatsGrid aggregate={filteredAggregate} currency={reportCurrency} />
            </div>
          </FeatureCard>
        </div>
      )}

      {tab === "daytime" && (
        <div className="grid gap-4">
          <ReportSegmentedTabs
            active={timeBreakdown}
            options={[
              { label: "Days", value: "weekday" },
              { label: "Months", value: "month" },
              { label: "Trade time", value: "hour" },
              { label: "Trade duration", value: "duration" },
            ]}
            onChange={(value) => setTimeBreakdown(value as TimeBreakdownMode)}
          />
          <ReportBreakdown
            currency={reportCurrency}
            leftTitle={`${timeTitle} net P&L`}
            rightTitle={`${timeTitle} win rate`}
            rows={timeRows}
          />
        </div>
      )}

      {tab === "risk" && (
        <div className="grid gap-4">
          <ReportSegmentedTabs
            active={riskBreakdown}
            options={[
              { label: "R multiples", value: "rMultiple" },
              { label: "Direction", value: "side" },
              { label: "Quantity", value: "quantity" },
              { label: "Hold time", value: "hold" },
            ]}
            onChange={(value) => setRiskBreakdown(value as RiskBreakdownMode)}
          />
          <ReportBreakdown
            currency={reportCurrency}
            leftTitle={`${riskTitle} net P&L`}
            rightTitle={`${riskTitle} win rate`}
            rows={riskRows}
          />
          {riskBreakdown === "rMultiple" && (
            <FeatureCard>
              <CardLabel icon={Grid2X2} label="R-multiple cross analysis" />
              <CrossAnalysis currency={reportCurrency} rows={rRows} sessionById={sessionById} trades={filteredClosedTrades} />
            </FeatureCard>
          )}
        </div>
      )}

      {tab === "tags" && (
        <ReportBreakdown
          currency={reportCurrency}
          leftTitle="Net P&L by tag"
          rightTitle="Win % by tag"
          rows={tagRows}
        />
      )}

      {tab === "winsLosses" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <FeatureCard>
            <CardLabel icon={TrendingUp} label={`Wins (${filteredAggregate.wins} trades matched)`} />
            <div className="mt-4">
              <StatsGrid aggregate={aggregateTrades(filteredClosedTrades.filter((trade) => trade.realized_pnl > 0))} currency={reportCurrency} />
            </div>
          </FeatureCard>
          <FeatureCard>
            <CardLabel icon={TrendingDown} label={`Losses (${filteredAggregate.losses} trades matched)`} />
            <div className="mt-4">
              <StatsGrid aggregate={aggregateTrades(filteredClosedTrades.filter((trade) => trade.realized_pnl < 0))} currency={reportCurrency} />
            </div>
          </FeatureCard>
          <FeatureCard className="xl:col-span-2">
            <CardLabel icon={ClipboardList} label="Matched trade outcomes" />
            <div className="mt-4">
              <ResultsTradeTable currency={reportCurrency} datasets={datasets} sessionById={sessionById} trades={filteredClosedTrades} />
            </div>
          </FeatureCard>
        </div>
      )}

      {tab === "calendar" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.68fr)_minmax(320px,0.32fr)]">
          <FeatureCard>
            <CardLabel icon={CalendarDays} label="Result calendar" />
            <div className="mt-4">
              <CalendarHeatmap currency={reportCurrency} days={filteredDays} />
            </div>
          </FeatureCard>
          <FeatureCard>
            <CardLabel icon={Activity} label="Calendar summary" />
            <div className="mt-4 grid gap-2">
              <CompactMetric label="Trading days" value={String(filteredDays.length)} />
              <CompactMetric label="Best day" value={formatMoney(bestRow(filteredDays.map((day) => ({ aggregate: day.aggregate, label: day.label })))?.aggregate.netPnl ?? 0, reportCurrency)} tone="text-emerald-300" />
              <CompactMetric label="Weakest day" value={formatMoney(worstRow(filteredDays.map((day) => ({ aggregate: day.aggregate, label: day.label })))?.aggregate.netPnl ?? 0, reportCurrency)} tone="text-rose-300" />
              <CompactMetric label="Avg day" value={formatMoney(filteredDays.length > 0 ? filteredAggregate.netPnl / filteredDays.length : 0, reportCurrency)} tone={toneForNumber(filteredDays.length > 0 ? filteredAggregate.netPnl / filteredDays.length : 0)} />
            </div>
          </FeatureCard>
        </div>
      )}

      {tab === "recaps" && (
        <div className="grid gap-3">
          <InsightCard
            title="Monthly recap"
            body={filteredClosedTrades.length > 0 ? `Net ${formatMoney(filteredAggregate.netPnl, reportCurrency)} across ${filteredClosedTrades.length} closed backtest trades. Best trade ${formatMoney(filteredAggregate.largestWin ?? 0, reportCurrency)}, worst trade ${formatMoney(filteredAggregate.largestLoss ?? 0, reportCurrency)}.` : "Backtest reports will appear here after your first closed replay trade."}
          />
          <InsightCard
            title="Strategy pattern"
            body={filteredStrategies[0] ? `${filteredStrategies[0].name} is currently the most visible strategy with ${filteredStrategies[0].aggregate.totalTrades} closed trades in this scope.` : "Strategy recaps unlock once trades are linked to strategies."}
          />
        </div>
      )}
    </PageScaffold>
  );
}

function StrategiesPage({
  currency,
  datasets,
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
  const selectedCurrency = selected
    ? currencyForSessions(selected.sessions, datasets)
    : currency;

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
              {strategyRows.map((strategy) => {
                const strategyCurrency = currencyForSessions(strategy.sessions, datasets);
                return (
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
                    <td className="px-3 py-4 text-rose-300">{formatMoney(strategy.aggregate.averageLoss, strategyCurrency)}</td>
                    <td className="px-3 py-4 text-emerald-300">{formatMoney(strategy.aggregate.averageWin, strategyCurrency)}</td>
                    <td className={`px-3 py-4 font-semibold ${toneForNumber(strategy.aggregate.netPnl)}`}>{formatMoney(strategy.aggregate.netPnl, strategyCurrency)}</td>
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
                );
              })}
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
                <CompactMetric label="Net P&L" value={formatMoney(selected.aggregate.netPnl, selectedCurrency)} tone={toneForNumber(selected.aggregate.netPnl)} />
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
  onDeletePlaybook,
  onUpdatePlaybook,
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
        onDeletePlaybook={onDeletePlaybook}
        onUpdatePlaybook={onUpdatePlaybook}
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
  onDeletePlaybook,
  onUpdatePlaybook,
  playbooks,
  sessions,
  trades,
}: {
  contextLabel: "Backtesting" | "Journal";
  createLabel: string;
  currency?: string;
  emptyMessage: string;
  onCreatePlaybook: (payload: PlaybookPayload) => Promise<Playbook> | Playbook;
  onDeletePlaybook: (playbookId: number) => Promise<void> | void;
  onUpdatePlaybook: (playbookId: number, payload: PlaybookUpdatePayload) => Promise<Playbook | null> | Playbook | null;
  playbooks: Playbook[];
  sessions: PlaybookUsageSession[];
  trades: Trade[];
}) {
  const [selectedId, setSelectedId] = useState<number | null>(playbooks[0]?.id ?? null);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [entryRules, setEntryRules] = useState("");
  const [exitRules, setExitRules] = useState("");
  const [riskRules, setRiskRules] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (playbooks.length === 0) {
      setSelectedId(null);
      setFormMode("create");
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

  function resetForm() {
    setFormMode("create");
    setName("");
    setDescription("");
    setEntryRules("");
    setExitRules("");
    setRiskRules("");
    setActionError(null);
  }

  function editPlaybook(playbook: Playbook) {
    const parsedRules = splitPlaybookRules(playbook.rules);
    setSelectedId(playbook.id);
    setFormMode("edit");
    setName(playbook.name);
    setDescription(playbook.description ?? "");
    setEntryRules(parsedRules.entry);
    setExitRules(parsedRules.exit);
    setRiskRules(parsedRules.risk);
    setDeleteConfirmId(null);
    setActionError(null);
  }

  async function submitPlaybook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      return;
    }
    setSubmitting(true);
    setActionError(null);
    try {
      const payload = {
        description: description.trim() || null,
        name: name.trim(),
        rules: composePlaybookRules(entryRules, exitRules, riskRules),
      };
      const saved = await Promise.resolve(
        formMode === "edit" && selected
          ? onUpdatePlaybook(selected.id, payload)
          : onCreatePlaybook(payload),
      );
      if (saved) {
        setSelectedId(saved.id);
      }
      resetForm();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not save playbook");
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteSelectedPlaybook() {
    if (!selected) {
      return;
    }
    if (deleteConfirmId !== selected.id) {
      setDeleteConfirmId(selected.id);
      return;
    }
    setSubmitting(true);
    setActionError(null);
    try {
      await Promise.resolve(onDeletePlaybook(selected.id));
      const nextSelection = playbooks.find((playbook) => playbook.id !== selected.id) ?? null;
      setSelectedId(nextSelection?.id ?? null);
      setDeleteConfirmId(null);
      resetForm();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not delete playbook");
    } finally {
      setSubmitting(false);
    }
  }

  const formTitle = formMode === "edit" ? "Edit playbook" : createLabel;

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
          <div className="flex items-center justify-between gap-3">
            <CardLabel icon={formMode === "edit" ? Pencil : Plus} label={formTitle} />
            {formMode === "edit" && (
              <button className="control-button h-8 px-2 text-xs" onClick={resetForm} type="button">
                <X size={14} />
                Cancel
              </button>
            )}
          </div>
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
            {actionError && (
              <div className="rounded-md border border-rose-300/20 bg-rose-300/10 px-3 py-2 text-sm text-rose-100">
                {actionError}
              </div>
            )}
            <button className="control-button workspace-tab-active justify-center" disabled={submitting || !name.trim()} type="submit">
              {formMode === "edit" ? <Save size={15} /> : <Plus size={15} />}
              {submitting ? "Saving..." : formMode === "edit" ? "Save changes" : "Save playbook"}
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
                    onClick={() => {
                      setSelectedId(playbook.id);
                      setDeleteConfirmId(null);
                    }}
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
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    <span className="status-pill">{shortDate(selected.created_at)}</span>
                    <button className="control-button h-9 px-3 text-xs" onClick={() => editPlaybook(selected)} type="button">
                      <Pencil size={14} />
                      Edit
                    </button>
                    <button
                      className={`control-button h-9 px-3 text-xs ${deleteConfirmId === selected.id ? "border-rose-300/30 bg-rose-300/10 text-rose-100" : ""}`}
                      disabled={submitting}
                      onClick={() => void deleteSelectedPlaybook()}
                      type="button"
                    >
                      <Trash2 size={14} />
                      {deleteConfirmId === selected.id ? "Confirm" : "Delete"}
                    </button>
                  </div>
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

/*
 * Keep older free-form playbook rules editable even if they were saved before
 * the sectioned create form existed.
 */
function splitPlaybookRules(value: string | null | undefined) {
  const text = value ?? "";
  const entry = extractRuleSection(text, "Entry Conditions");
  const exit = extractRuleSection(text, "Exit Conditions");
  const risk = extractRuleSection(text, "Risk Conditions");
  if (entry != null || exit != null || risk != null) {
    return {
      entry: normalizeRuleSectionBody(entry),
      exit: normalizeRuleSectionBody(exit),
      risk: normalizeRuleSectionBody(risk),
    };
  }
  return {
    entry: normalizeRuleSectionBody(text),
    exit: "",
    risk: "",
  };
}

function extractRuleSection(text: string, title: string) {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(
    new RegExp(`${escapedTitle}\\s*\\n([\\s\\S]*?)(?=\\n\\n(?:Entry Conditions|Exit Conditions|Risk Conditions)\\s*\\n|$)`, "i"),
  );
  return match?.[1] ?? null;
}

function normalizeRuleSectionBody(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed === "Not defined yet." ? "" : trimmed;
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
  strategies,
}: SharedPageProps) {
  const sections: Array<{
    description: string;
    icon: LucideIcon;
    id: SettingsSectionId;
    label: string;
  }> = [
    {
      description: "Dataset root, asset metadata, and CSV refresh",
      icon: Database,
      id: "data",
      label: "Data imports",
    },
    {
      description: "Order ticket defaults and chart-line confirmations",
      icon: SlidersHorizontal,
      id: "orders",
      label: "Order defaults",
    },
    {
      description: "Default review text inserted in trade notes",
      icon: NotebookPen,
      id: "notes",
      label: "Note template",
    },
    {
      description: "Mistake tag suggestions by strategy",
      icon: Tags,
      id: "tags",
      label: "Tags",
    },
  ];
  const [active, setActive] = useState<SettingsSectionId>("data");
  const [settingsStatus, setSettingsStatus] = useState<string | null>(null);
  const activeSection = sections.find((section) => section.id === active) ?? sections[0];

  useEffect(() => {
    setSettingsStatus(null);
  }, [active]);

  return (
    <PageScaffold
      eyebrow="Backtest Settings"
      title="Backtest Settings"
      description="Personal replay settings only. Everything here is stored locally and synced through app storage."
    >
      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <FeatureCard className="p-2">
          {sections.map((section) => (
            <button
              className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm font-semibold transition ${
                active === section.id ? "bg-cyan-300/10 text-cyan-100" : "text-slate-400 hover:bg-white/5 hover:text-white"
              }`}
              key={section.id}
              onClick={() => setActive(section.id)}
              type="button"
            >
              <span className="flex min-w-0 items-center gap-2">
                <section.icon className="shrink-0" size={15} />
                <span className="truncate">{section.label}</span>
              </span>
              <ArrowRight className="shrink-0" size={13} />
            </button>
          ))}
        </FeatureCard>
        <FeatureCard>
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div>
              <CardLabel icon={activeSection.icon} label={activeSection.label} />
              <p className="mt-2 text-sm text-slate-500">{activeSection.description}</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {active === "orders" && settingsStatus && (
                <span className="status-pill">{settingsStatus}</span>
              )}
              <span className="status-pill">Personal workspace</span>
            </div>
          </div>
          {active === "data" ? (
            <BacktestDataSettings
              datasets={datasets}
              onRefreshDatasets={onRefreshDatasets}
              onGetDatasetRefreshStatus={onGetDatasetRefreshStatus}
              onUpdateDatasetAsset={onUpdateDatasetAsset}
              onUpdateDatasetSettings={onUpdateDatasetSettings}
            />
          ) : active === "orders" ? (
            <BacktestOrderSettings onStatusChange={setSettingsStatus} />
          ) : active === "notes" ? (
            <BacktestNoteTemplateSettings />
          ) : (
            <BacktestTagSettings strategies={strategies} />
          )}
        </FeatureCard>
      </div>
    </PageScaffold>
  );
}

type SettingsSectionId = "data" | "orders" | "notes" | "tags";

function BacktestOrderSettings({ onStatusChange }: { onStatusChange: (status: string | null) => void }) {
  const [confirmOrderLineModifications, setConfirmOrderLineModifications] =
    useState(loadOrderLineModificationConfirmation);
  const [sizingMode, setSizingMode] = useState<OrderSizingMode>(() => loadOrderSizingMode());
  const [riskBase, setRiskBase] = useState<OrderRiskBase>(() => loadOrderRiskBase());
  const [defaultQuantity, setDefaultQuantity] = useState(() => loadOrderDefaultQuantity());
  const [defaultRiskPercent, setDefaultRiskPercent] = useState(() => loadOrderDefaultRiskPercent());
  const [commissionMode, setCommissionMode] = useState<OrderCommissionMode>(() =>
    loadOrderCommissionMode(),
  );
  const [fixedCommission, setFixedCommission] = useState(() => loadOrderCommissionFixed());
  const [percentCommission, setPercentCommission] = useState(() => loadOrderCommissionPercent());
  const [feeMode, setFeeMode] = useState<OrderCommissionMode>(() => loadOrderFeeMode());
  const [fixedFee, setFixedFee] = useState(() => loadOrderFeeFixed());
  const [percentFee, setPercentFee] = useState(() => loadOrderFeePercent());
  const statusTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      hydrateOrderLineModificationConfirmation(),
      hydrateOrderSizingMode(),
      hydrateOrderRiskBase(),
      hydrateOrderDefaultQuantity(),
      hydrateOrderDefaultRiskPercent(),
      hydrateOrderCommissionMode(),
      hydrateOrderCommissionFixed(),
      hydrateOrderCommissionPercent(),
      hydrateOrderFeeMode(),
      hydrateOrderFeeFixed(),
      hydrateOrderFeePercent(),
    ]).then(([confirmLineEdits, nextSizingMode, nextRiskBase, nextQuantity, nextRiskPercent, nextCommissionMode, nextFixedCommission, nextPercentCommission, nextFeeMode, nextFixedFee, nextPercentFee]) => {
      if (!active) {
        return;
      }
      setConfirmOrderLineModifications(confirmLineEdits);
      setSizingMode(nextSizingMode);
      setRiskBase(nextRiskBase);
      setDefaultQuantity(nextQuantity);
      setDefaultRiskPercent(nextRiskPercent);
      setCommissionMode(nextCommissionMode);
      setFixedCommission(nextFixedCommission);
      setPercentCommission(nextPercentCommission);
      setFeeMode(nextFeeMode);
      setFixedFee(nextFixedFee);
      setPercentFee(nextPercentFee);
    });
    const unsubscribers = [
      subscribeOrderLineModificationConfirmation(setConfirmOrderLineModifications),
      subscribeOrderSizingMode(setSizingMode),
      subscribeOrderRiskBase(setRiskBase),
      subscribeOrderDefaultQuantity(setDefaultQuantity),
      subscribeOrderDefaultRiskPercent(setDefaultRiskPercent),
      subscribeOrderCommissionMode(setCommissionMode),
      subscribeOrderCommissionFixed(setFixedCommission),
      subscribeOrderCommissionPercent(setPercentCommission),
      subscribeOrderFeeMode(setFeeMode),
      subscribeOrderFeeFixed(setFixedFee),
      subscribeOrderFeePercent(setPercentFee),
    ];
    return () => {
      active = false;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, []);

  useEffect(() => {
    return () => {
      if (statusTimeoutRef.current != null) {
        window.clearTimeout(statusTimeoutRef.current);
      }
      onStatusChange(null);
    };
  }, [onStatusChange]);

  function markSaved(label = "Saved") {
    if (statusTimeoutRef.current != null) {
      window.clearTimeout(statusTimeoutRef.current);
    }
    onStatusChange(label);
    statusTimeoutRef.current = window.setTimeout(() => {
      onStatusChange(null);
      statusTimeoutRef.current = null;
    }, 1400);
  }

  function updateConfirmation(enabled: boolean) {
    setConfirmOrderLineModifications(enabled);
    void saveOrderLineModificationConfirmation(enabled).then(() => markSaved());
  }

  function updateSizingMode(value: OrderSizingMode) {
    setSizingMode(value);
    void saveOrderSizingMode(value).then(() => markSaved());
  }

  function updateRiskBase(value: OrderRiskBase) {
    setRiskBase(value);
    void saveOrderRiskBase(value).then(() => markSaved());
  }

  function updateDefaultQuantity(value: string) {
    setDefaultQuantity(value);
    if (isPositiveNumberText(value)) {
      void saveOrderDefaultQuantity(value).then(() => markSaved());
    }
  }

  function updateDefaultRiskPercent(value: string) {
    setDefaultRiskPercent(value);
    if (isPositiveNumberText(value)) {
      void saveOrderDefaultRiskPercent(value).then(() => markSaved());
    }
  }

  function updateCommissionMode(value: OrderCommissionMode) {
    setCommissionMode(value);
    void saveOrderCommissionMode(value).then(() => markSaved());
  }

  function updateFixedCommission(value: string) {
    setFixedCommission(value);
    if (isNonNegativeNumberText(value)) {
      void saveOrderCommissionFixed(value).then(() => markSaved());
    }
  }

  function updatePercentCommission(value: string) {
    setPercentCommission(value);
    if (isNonNegativeNumberText(value)) {
      void saveOrderCommissionPercent(value).then(() => markSaved());
    }
  }

  function updateFeeMode(value: OrderCommissionMode) {
    setFeeMode(value);
    void saveOrderFeeMode(value).then(() => markSaved());
  }

  function updateFixedFee(value: string) {
    setFixedFee(value);
    if (isNonNegativeNumberText(value)) {
      void saveOrderFeeFixed(value).then(() => markSaved());
    }
  }

  function updatePercentFee(value: string) {
    setPercentFee(value);
    if (isNonNegativeNumberText(value)) {
      void saveOrderFeePercent(value).then(() => markSaved());
    }
  }

  return (
    <div className="mt-5 grid gap-4">
      <div className="rounded-md border border-white/10 bg-black/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Ticket sizing mode
            </div>
            <div className="mt-1 text-sm text-slate-400">
              New order tickets open with this sizing method.
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button
            className={`segmented ${sizingMode === "quantity" ? "segmented-active" : ""}`}
            onClick={() => updateSizingMode("quantity")}
            type="button"
          >
            Quantity
          </button>
          <button
            className={`segmented ${sizingMode === "risk" ? "segmented-active" : ""}`}
            onClick={() => updateSizingMode("risk")}
            type="button"
          >
            Risk %
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="form-field">
          Default quantity
          <input
            className="input-control h-10 normal-case tracking-normal"
            min="0.000001"
            onChange={(event) => updateDefaultQuantity(event.target.value)}
            type="number"
            value={defaultQuantity}
          />
        </label>
        <label className="form-field">
          Default risk %
          <input
            className="input-control h-10 normal-case tracking-normal"
            min="0.000001"
            onChange={(event) => updateDefaultRiskPercent(event.target.value)}
            step="0.01"
            type="number"
            value={defaultRiskPercent}
          />
        </label>
      </div>

      <div className="rounded-md border border-white/10 bg-black/20 p-3">
        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          Risk % based on
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            className={`segmented ${riskBase === "CURRENT_BALANCE" ? "segmented-active" : ""}`}
            onClick={() => updateRiskBase("CURRENT_BALANCE")}
            type="button"
          >
            Current balance
          </button>
          <button
            className={`segmented ${riskBase === "INITIAL_BALANCE" ? "segmented-active" : ""}`}
            onClick={() => updateRiskBase("INITIAL_BALANCE")}
            type="button"
          >
            Initial balance
          </button>
        </div>
      </div>

      <div className="rounded-md border border-white/10 bg-black/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Session cost defaults
            </div>
            <div className="mt-1 text-sm text-slate-400">
              Used to prefill new session creation. Each session stores its own commission and fee rules.
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <CostConfigCard
            fixedValue={fixedCommission}
            mode={commissionMode}
            onFixedValueChange={updateFixedCommission}
            onModeChange={updateCommissionMode}
            onPercentValueChange={updatePercentCommission}
            percentValue={percentCommission}
            title="Default Commissions"
          />
          <CostConfigCard
            fixedValue={fixedFee}
            mode={feeMode}
            onFixedValueChange={updateFixedFee}
            onModeChange={updateFeeMode}
            onPercentValueChange={updatePercentFee}
            percentValue={percentFee}
            title="Default Fees"
          />
        </div>
      </div>

      <label className="flex min-w-0 items-center justify-between gap-4 rounded-md border border-white/10 bg-black/20 px-3 py-3">
        <span className="min-w-0">
          <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Chart order lines
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
    </div>
  );
}

function BacktestNoteTemplateSettings() {
  const [notebookTemplate, setNotebookTemplate] = useState(() =>
    normalizeNotebookTemplate(getCachedAppStorageItem<unknown>(NOTEBOOK_TEMPLATE_STORAGE_KEY, DEFAULT_NOTEBOOK_TEMPLATE)),
  );
  const [templateDraft, setTemplateDraft] = useState(notebookTemplate);
  const [templateStatus, setTemplateStatus] = useState<string | null>(null);

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
    <div className="mt-5 grid gap-4">
      <section className="rounded-md border border-white/10 bg-black/20 p-3">
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
    </div>
  );
}

function BacktestTagSettings({ strategies }: { strategies: StrategyGroup[] }) {
  const savedStrategyNames = useBacktestStrategyNames();
  const strategyOptions = useMemo(
    () => mergeStrategyGroups(strategies, savedStrategyNames),
    [savedStrategyNames, strategies],
  );
  const [selectedStrategy, setSelectedStrategy] = useState(
    () => strategyOptions[0]?.name ?? "Unassigned",
  );
  const [customTags, setCustomTags] = useState<string[]>(() =>
    loadStrategyMistakeTags(selectedStrategy),
  );
  const [tagDraft, setTagDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const selectedGroup =
    strategyOptions.find((strategy) => sameStrategyName(strategy.name, selectedStrategy)) ?? null;
  const allTags = mergeTags(DEFAULT_MISTAKE_TAGS, customTags);

  useEffect(() => {
    if (strategyOptions.length === 0) {
      setSelectedStrategy("Unassigned");
      return;
    }
    if (
      !sameStrategyName(selectedStrategy, "Unassigned") &&
      !strategyOptions.some((strategy) => sameStrategyName(strategy.name, selectedStrategy))
    ) {
      setSelectedStrategy(strategyOptions[0].name);
    }
  }, [selectedStrategy, strategyOptions]);

  useEffect(() => {
    let active = true;
    void hydrateStrategyMistakeTags(selectedStrategy).then((tags) => {
      if (active) {
        setCustomTags(tags);
      }
    });
    const unsubscribe = subscribeStrategyMistakeTags(selectedStrategy, setCustomTags);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [selectedStrategy]);

  function addTags() {
    const tags = parseTagInput(tagDraft);
    if (tags.length === 0) {
      return;
    }
    const nextTags = mergeTags(customTags, tags);
    setCustomTags(nextTags);
    persistStrategyMistakeTags(selectedStrategy, nextTags);
    setTagDraft("");
    setStatus("Tags saved");
  }

  function removeTag(tag: string) {
    removeStrategyMistakeTag(selectedStrategy, tag);
    setCustomTags((current) => current.filter((item) => item.toLowerCase() !== tag.toLowerCase()));
    setStatus("Tag deleted");
  }

  return (
    <div className="mt-5 grid gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
        <label className="form-field">
          Strategy scope
          <ThemedSelect
            className="h-10"
            onChange={(value) => {
              setSelectedStrategy(value);
              setStatus(null);
            }}
            options={buildStrategySelectOptions(strategyOptions)}
            portal
            value={selectedStrategy}
          />
        </label>
        <label className="form-field">
          Add mistake tags
          <div className="flex gap-2">
            <input
              className="input-control h-10 normal-case tracking-normal"
              onChange={(event) => setTagDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addTags();
                }
              }}
              placeholder="Comma separated, e.g. Chased entry, Missed plan"
              value={tagDraft}
            />
            <button className="control-button h-10" disabled={!tagDraft.trim()} onClick={addTags} type="button">
              <Plus size={15} />
              Add
            </button>
          </div>
        </label>
      </div>

      <div className="rounded-md border border-white/10 bg-black/20 p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Suggestions for {selectedStrategy}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Default tags are always available. Custom tags can be removed here.
            </div>
          </div>
          {status && <span className="status-pill">{status}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {allTags.map((tag) => {
            const defaultTag = isDefaultMistakeTag(tag);
            return (
              <span
                className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-200"
                key={tag}
              >
                {tag}
                {defaultTag ? (
                  <span className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Default</span>
                ) : (
                  <button
                    className="text-slate-500 transition hover:text-rose-200"
                    onClick={() => removeTag(tag)}
                    title="Delete custom tag"
                    type="button"
                  >
                    <X size={13} />
                  </button>
                )}
              </span>
            );
          })}
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <CompactMetric label="Strategy trades" value={String(selectedGroup?.aggregate.totalTrades ?? 0)} />
        <CompactMetric label="Custom tags" value={String(customTags.length)} />
        <CompactMetric label="Suggestions" value={String(allTags.length)} />
      </div>
    </div>
  );
}

function isPositiveNumberText(value: string) {
  const parsed = Number(value);
  return value.trim().length > 0 && Number.isFinite(parsed) && parsed > 0;
}

function isNonNegativeNumberText(value: string) {
  const parsed = Number(value);
  return value.trim().length > 0 && Number.isFinite(parsed) && parsed >= 0;
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

function ResultFiltersPopover({
  closedTrades,
  filters,
  onApply,
  onClose,
  onReset,
  sessionById,
  strategies,
}: {
  closedTrades: Trade[];
  filters: ResultFilterState;
  onApply: (filters: ResultFilterState) => void;
  onClose: () => void;
  onReset: () => void;
  sessionById: Map<number, BacktestSession>;
  strategies: StrategyGroup[];
}) {
  const [draft, setDraft] = useState<ResultFilterState>(filters);
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

  useEffect(() => {
    setDraft(filters);
  }, [filters]);

  function updateDraft<K extends keyof ResultFilterState>(
    key: K,
    value: ResultFilterState[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function resetDraft() {
    setDraft(DEFAULT_RESULT_FILTERS);
    onReset();
  }

  return (
    <div className="absolute right-0 top-full z-50 mt-2 w-[min(760px,calc(100vw-32px))] rounded-md border border-white/10 bg-[#080c11] p-4 shadow-panel">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <label className="form-field md:col-span-2 xl:col-span-3">
          Search
          <div className="flex h-10 items-center gap-2 rounded-md border border-white/10 bg-black/20 px-3 text-sm focus-within:border-cyan-300/40 focus-within:ring-2 focus-within:ring-cyan-300/10">
            <Search className="shrink-0 text-slate-500" size={15} />
            <input
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-600"
              onChange={(event) => updateDraft("searchTerm", event.target.value)}
              placeholder="Instrument, strategy, note, tag..."
              value={draft.searchTerm}
            />
          </div>
        </label>
        <label className="form-field">
          Session
          <ThemedSelect className="h-10" onChange={(value) => updateDraft("sessionFilter", value)} options={sessionOptions} portal value={draft.sessionFilter} />
        </label>
        <label className="form-field">
          Instrument
          <ThemedSelect className="h-10" onChange={(value) => updateDraft("instrumentFilter", value)} options={instrumentOptions} portal value={draft.instrumentFilter} />
        </label>
        <label className="form-field">
          Direction
          <ThemedSelect
            className="h-10"
            onChange={(value) => updateDraft("sideFilter", value)}
            options={[
              { label: "All directions", value: "ALL" },
              { label: "Long", value: "LONG" },
              { label: "Short", value: "SHORT" },
            ]}
            portal
            value={draft.sideFilter}
          />
        </label>
        <label className="form-field">
          Strategy
          <ThemedSelect className="h-10" onChange={(value) => updateDraft("strategyFilter", value)} options={strategyOptions} portal value={draft.strategyFilter} />
        </label>
        <label className="form-field">
          Tags
          <ThemedSelect className="h-10" onChange={(value) => updateDraft("tagFilter", value)} options={tagOptions} portal value={draft.tagFilter} />
        </label>
        <label className="form-field">
          From
          <ThemedDatePicker ariaLabel="Filter results from date" onChange={(value) => updateDraft("dateFrom", value)} placeholder="From date" value={draft.dateFrom} />
        </label>
        <label className="form-field">
          To
          <ThemedDatePicker ariaLabel="Filter results to date" onChange={(value) => updateDraft("dateTo", value)} placeholder="To date" value={draft.dateTo} />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button className="control-button" disabled={!resultFiltersActive(draft)} onClick={resetDraft} type="button">
          <RefreshCw size={15} />
          Reset
        </button>
        <button className="control-button" onClick={onClose} type="button">Cancel</button>
        <button className="control-button workspace-tab-active" onClick={() => onApply(draft)} type="button">Apply filters</button>
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

function ResultMetricCard({
  icon: Icon,
  label,
  tone = "text-slate-100",
  value,
}: {
  icon: LucideIcon;
  label: string;
  tone?: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-white/10 bg-[#090d12] px-3 py-2.5 shadow-panel">
      <div className="flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
        <span className="truncate">{label}</span>
        <Icon className="shrink-0 text-cyan-200/70" size={14} />
      </div>
      <div className={`mt-1.5 truncate text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function MetricChartHeader({
  icon: Icon,
  label,
  meta,
  tone = "text-slate-100",
  value,
}: {
  icon: LucideIcon;
  label: string;
  meta: string;
  tone?: string;
  value: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
      <div>
        <CardLabel icon={Icon} label={label} />
        <div className="mt-1 text-xs text-slate-500">{meta}</div>
      </div>
      <div className={`text-right text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function ReportSegmentedTabs<TValue extends string>({
  active,
  onChange,
  options,
}: {
  active: TValue;
  onChange: (value: TValue) => void;
  options: Array<{ label: string; value: TValue }>;
}) {
  return (
    <div className="inline-flex max-w-full gap-1 overflow-x-auto rounded-md border border-white/10 bg-black/20 p-1">
      {options.map((option) => (
        <button
          className={`h-8 shrink-0 rounded px-3 text-xs font-semibold transition ${
            active === option.value ? "bg-cyan-300/10 text-cyan-100 ring-1 ring-cyan-300/20" : "text-slate-400 hover:bg-white/10 hover:text-white"
          }`}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
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

function ResultsDayTable({
  currency,
  datasets,
  days,
  sessionById,
}: {
  currency: string;
  datasets: DatasetCatalog | null;
  days: DayGroup[];
  sessionById: Map<number, BacktestSession>;
}) {
  if (days.length === 0) {
    return <EmptyState icon={CalendarDays} message="No day results in this filtered scope." />;
  }
  return (
    <div className="overflow-auto rounded-md border border-white/10 bg-black/20">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="text-xs uppercase tracking-[0.16em] text-slate-500">
          <tr>
            <th className="px-3 py-3 font-medium">Day</th>
            <th className="px-3 py-3 font-medium">Trades</th>
            <th className="px-3 py-3 font-medium">Net P&L</th>
            <th className="px-3 py-3 font-medium">Win rate</th>
            <th className="px-3 py-3 font-medium">Avg R</th>
            <th className="px-3 py-3 font-medium">Profit factor</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => {
            const dayCurrency = currencyForTrades(day.trades, sessionById, datasets, currency);
            return (
              <tr className="border-t border-white/10 text-slate-300" key={day.date}>
                <td className="px-3 py-3 font-semibold text-white">{day.label}</td>
                <td className="px-3 py-3">{day.aggregate.totalTrades}</td>
                <td className={`px-3 py-3 font-semibold tabular-nums ${toneForNumber(day.aggregate.netPnl)}`}>
                  {formatMoney(day.aggregate.netPnl, dayCurrency)}
                </td>
                <td className="px-3 py-3 tabular-nums">{formatPercent(day.aggregate.winRate)}</td>
                <td className="px-3 py-3 tabular-nums">{formatOptionalNumber(day.aggregate.averageR)}</td>
                <td className="px-3 py-3 tabular-nums">{formatRatio(day.aggregate.profitFactor)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ResultsTradeTable({
  currency,
  datasets,
  sessionById,
  trades,
}: {
  currency: string;
  datasets: DatasetCatalog | null;
  sessionById: Map<number, BacktestSession>;
  trades: Trade[];
}) {
  const visibleTrades = trades.slice().sort(compareTradesAscending).reverse().slice(0, 16);
  if (visibleTrades.length === 0) {
    return <EmptyState icon={ClipboardList} message="No trades in this filtered scope." />;
  }
  return (
    <div className="overflow-auto rounded-md border border-white/10 bg-black/20">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="text-xs uppercase tracking-[0.16em] text-slate-500">
          <tr>
            <th className="px-3 py-3 font-medium">Trade</th>
            <th className="px-3 py-3 font-medium">Instrument</th>
            <th className="px-3 py-3 font-medium">Strategy</th>
            <th className="px-3 py-3 font-medium">Exit time</th>
            <th className="px-3 py-3 font-medium">Side</th>
            <th className="px-3 py-3 font-medium">P&L</th>
            <th className="px-3 py-3 font-medium">R</th>
          </tr>
        </thead>
        <tbody>
          {visibleTrades.map((trade) => {
            const session = sessionById.get(trade.session_id);
            const rowCurrency = session ? currencyForSession(session, datasets) : currency;
            return (
              <tr className="border-t border-white/10 text-slate-300" key={trade.id}>
                <td className="px-3 py-3 font-semibold text-white">#{trade.id}</td>
                <td className="px-3 py-3">{tradeInstrumentLabel(trade, session)}</td>
                <td className="px-3 py-3">{tradeStrategyName(trade, session)}</td>
                <td className="px-3 py-3 text-slate-500">{formatDateTime(trade.exit_time ?? trade.entry_time)}</td>
                <td className="px-3 py-3">{trade.side}</td>
                <td className={`px-3 py-3 font-semibold tabular-nums ${toneForNumber(trade.realized_pnl)}`}>
                  {formatMoney(trade.realized_pnl ?? 0, rowCurrency)}
                </td>
                <td className="px-3 py-3 tabular-nums">{formatOptionalNumber(trade.r_multiple)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {trades.length > visibleTrades.length && (
        <div className="border-t border-white/10 px-3 py-2 text-xs text-slate-500">
          Showing latest {visibleTrades.length} of {trades.length} matched trades.
        </div>
      )}
    </div>
  );
}

function ModalFrame({
  children,
  maxWidth = "default",
  onClose,
  title,
}: {
  children: ReactNode;
  maxWidth?: "default" | "wide";
  onClose: () => void;
  title: string;
}) {
  const widthClass = maxWidth === "wide" ? "w-[min(760px,100%)]" : "w-[min(520px,100%)]";
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 px-4 py-6">
      <div className={`grid max-h-[calc(100vh-48px)] ${widthClass} grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-md border border-cyan-300/15 bg-[#071018] shadow-panel`}>
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <h2 className="truncate text-lg font-semibold text-white">{title}</h2>
          <button className="icon-button h-9 w-9" onClick={onClose} type="button">
            <X size={15} />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto p-4">
          {children}
        </div>
      </div>
    </div>
  );
}

function useThemedConfirm() {
  const [request, setRequest] = useState<ThemedConfirmRequest | null>(null);
  const requestRef = useRef<ThemedConfirmRequest | null>(null);

  useEffect(() => {
    requestRef.current = request;
  }, [request]);

  useEffect(
    () => () => {
      requestRef.current?.resolve(false);
    },
    [],
  );

  const confirm = useCallback(
    (options: ThemedConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setRequest({ ...options, resolve });
      }),
    [],
  );

  const close = useCallback((confirmed: boolean) => {
    setRequest((current) => {
      current?.resolve(confirmed);
      return null;
    });
  }, []);

  return {
    confirm,
    confirmDialog: request ? (
      <ThemedConfirmDialog
        onCancel={() => close(false)}
        onConfirm={() => close(true)}
        request={request}
      />
    ) : null,
  };
}

function ThemedConfirmDialog({
  onCancel,
  onConfirm,
  request,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  request: ThemedConfirmRequest;
}) {
  const danger = request.tone === "danger";
  return (
    <ModalFrame title={request.title} onClose={onCancel}>
      <div className="grid gap-4">
        <div className="flex gap-3">
          <div
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-md border ${
              danger
                ? "border-rose-300/25 bg-rose-300/10 text-rose-100"
                : "border-cyan-300/25 bg-cyan-300/10 text-cyan-100"
            }`}
          >
            {danger ? <Trash2 size={17} /> : <Info size={17} />}
          </div>
          <div className="min-w-0">
            <div className="text-sm leading-6 text-slate-300">{request.message}</div>
            {request.detail && (
              <div className="mt-3 rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm leading-6 text-slate-400">
                {request.detail}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button className="control-button" onClick={onCancel} type="button">
            {request.cancelLabel ?? "Cancel"}
          </button>
          <button
            className={`control-button ${
              danger
                ? "border-rose-300/25 bg-rose-300/10 text-rose-100 hover:bg-rose-300/20"
                : "workspace-tab-active"
            }`}
            onClick={onConfirm}
            type="button"
          >
            {request.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </ModalFrame>
  );
}

function useCloseOnOutsidePointer(
  active: boolean,
  refs: Array<{ current: HTMLElement | null }>,
  onClose: () => void,
) {
  useEffect(() => {
    if (!active || typeof document === "undefined") {
      return undefined;
    }

    const ignoredPortalSelector = [
      ".themed-select-menu-floating",
      ".replay-date-popover-floating",
      ".themed-color-popover",
    ].join(", ");

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (target instanceof Element && target.closest(ignoredPortalSelector)) {
        return;
      }
      if (refs.some((ref) => ref.current?.contains(target))) {
        return;
      }
      onClose();
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [active, refs, onClose]);
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
    ["Net P&L", formatMoney(aggregate.netPnl, currency), toneForNumber(aggregate.netPnl)],
    ["Gross P&L", formatMoney(aggregate.grossPnl, currency), toneForNumber(aggregate.grossPnl)],
    ["Commissions", formatMoney(aggregate.totalCommissions, currency), "text-slate-100"],
    ["Fees", formatMoney(aggregate.totalFees, currency), "text-slate-100"],
    ["Trades", String(aggregate.totalTrades), "text-slate-100"],
    ["Win rate", formatPercent(aggregate.winRate), "text-slate-100"],
    ["Profit factor", formatRatio(aggregate.profitFactor), "text-amber-100"],
    ["Average winner", formatMoney(aggregate.averageWin, currency), "text-emerald-300"],
    ["Average loser", formatMoney(aggregate.averageLoss, currency), "text-rose-300"],
    ["Largest win", formatMoney(aggregate.largestWin ?? 0, currency), "text-emerald-300"],
    ["Largest loss", formatMoney(aggregate.largestLoss ?? 0, currency), "text-rose-300"],
    ["Max drawdown", formatMoney(aggregate.maxDrawdown, currency), "text-rose-300"],
    ["Average R", formatOptionalNumber(aggregate.averageR), toneForNumber(aggregate.averageR)],
    ["Average hold", formatMinutes(aggregate.averageHoldMinutes), "text-slate-100"],
    ["Break even", String(aggregate.breakeven), "text-slate-100"],
    ["Recovery factor", formatRatio(aggregate.recoveryFactor), "text-slate-100"],
  ];

  return (
    <div className="grid overflow-hidden rounded-md border border-white/10 bg-white/10 md:grid-cols-2 xl:grid-cols-4">
      {rows.map(([label, value, tone]) => (
        <div className="min-w-0 bg-[#080c11] px-3 py-3" key={label}>
          <div className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600">{label}</div>
          <div className={`mt-1 truncate text-sm font-semibold tabular-nums ${tone}`}>{value}</div>
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
  const visibleRows = rows.filter((row) => row.aggregate.totalTrades > 0);
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-4">
        <InsightMetric currency={currency} title="Best performing" row={bestRow(visibleRows)} />
        <InsightMetric currency={currency} title="Least performing" row={worstRow(visibleRows)} />
        <InsightMetric currency={currency} title="Most active" row={mostActiveRow(visibleRows)} />
        <InsightMetric currency={currency} title="Best win rate" row={bestWinRateRow(visibleRows)} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <FeatureCard className="overflow-hidden p-0">
          <MetricChartHeader
            icon={BarChart3}
            label={leftTitle}
            meta={`${visibleRows.length} buckets`}
            tone={toneForNumber(bestRow(visibleRows)?.aggregate.netPnl)}
            value={formatMoney(bestRow(visibleRows)?.aggregate.netPnl ?? 0, currency)}
          />
          <div className="px-4 pb-4">
            <BarBreakdown
              chartHeight={270}
              currency={currency}
              rows={visibleRows.map((row) => ({ label: row.label, value: row.aggregate.netPnl }))}
            />
          </div>
        </FeatureCard>
        <FeatureCard className="overflow-hidden p-0">
          <MetricChartHeader
            icon={PieChart}
            label={rightTitle}
            meta="Win percentage"
            value={formatPercent(bestWinRateRow(visibleRows)?.aggregate.winRate ?? 0)}
          />
          <div className="px-4 pb-4">
            <BarBreakdown
              chartHeight={270}
              percent
              rows={visibleRows.map((row) => ({ label: row.label, value: row.aggregate.winRate * 100 }))}
            />
          </div>
        </FeatureCard>
      </div>
      {visibleRows.length === 0 && <EmptyState icon={BarChart3} message="No breakdown data in this filtered scope." />}
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
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-[0.16em] text-slate-500">{title}</div>
        <span className="status-pill h-7 px-2 text-[10px]">{row?.aggregate.totalTrades ?? 0} trades</span>
      </div>
      <div className="mt-3 truncate text-lg font-semibold text-white">{row?.label ?? "-"}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={`rounded bg-black/30 px-2 py-1 text-sm font-semibold tabular-nums ${toneForNumber(row?.aggregate.netPnl)}`}>
          {formatMoney(row?.aggregate.netPnl ?? 0, currency)}
        </span>
        <span className="rounded bg-black/30 px-2 py-1 text-xs font-semibold text-slate-300">
          {formatPercent(row?.aggregate.winRate ?? 0)} win
        </span>
      </div>
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

function sanitizeDayViewNotes(value: unknown): DayViewNoteMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, note]) => [key, note.trim()])
      .filter(([, note]) => note.length > 0),
  );
}

function buildDayViewPeriods(days: DayGroup[], mode: DayViewMode): DayViewPeriod[] {
  if (mode === "day") {
    return days.map((day) => ({
      aggregate: day.aggregate,
      days: [day],
      endDate: day.date,
      id: `day:${day.date}`,
      label: day.label,
      startDate: day.date,
      sublabel: `${day.aggregate.totalTrades} closed ${day.aggregate.totalTrades === 1 ? "trade" : "trades"}`,
      trades: day.trades.slice().sort(compareTradesAscending),
    }));
  }

  const grouped = new Map<string, DayGroup[]>();
  for (const day of days) {
    const startDate = startOfIsoWeekKey(day.date);
    grouped.set(startDate, [...(grouped.get(startDate) ?? []), day]);
  }

  return Array.from(grouped.entries())
    .map(([startDate, weekDays]) => {
      const sortedDays = weekDays.slice().sort((left, right) => right.date.localeCompare(left.date));
      const endDate = endOfIsoWeekKey(startDate);
      const trades = sortedDays.flatMap((day) => day.trades).sort(compareTradesAscending);
      return {
        aggregate: aggregateTrades(trades),
        days: sortedDays,
        endDate,
        id: `week:${startDate}`,
        label: formatDateRange(startDate, endDate),
        startDate,
        sublabel: `${sortedDays.length} trading ${sortedDays.length === 1 ? "day" : "days"} · ${trades.length} closed ${trades.length === 1 ? "trade" : "trades"}`,
        trades,
      };
    })
    .sort((left, right) => right.startDate.localeCompare(left.startDate));
}

function findDayViewPeriod(periods: DayViewPeriod[], selectedDate: string, mode: DayViewMode) {
  if (periods.length === 0) {
    return null;
  }
  if (mode === "day") {
    return periods.find((period) => period.startDate === selectedDate) ?? periods[0];
  }
  return periods.find((period) => dateKeyInRange(selectedDate, period.startDate, period.endDate)) ?? periods[0];
}

function CalendarHeatmap({
  compact = false,
  currency = "USD",
  days,
  month,
  onMonthChange,
  onSelectDate,
  selectedDate = null,
  selectedRange = null,
}: {
  compact?: boolean;
  currency?: string;
  days: DayGroup[];
  month?: string;
  onMonthChange?: (month: string) => void;
  onSelectDate?: (date: string) => void;
  selectedDate?: string | null;
  selectedRange?: { start: string; end: string } | null;
}) {
  const [internalMonth, setInternalMonth] = useState(() => monthCursorFromDateKey(days[0]?.date));
  const activeMonth = month ?? internalMonth;
  const cells = buildMonthCells(days, activeMonth);

  useEffect(() => {
    if (month == null) {
      setInternalMonth(monthCursorFromDateKey(days[0]?.date));
    }
  }, [days, month]);

  function changeMonth(delta: number) {
    const nextMonth = addMonthsToDateKey(activeMonth, delta);
    if (onMonthChange) {
      onMonthChange(nextMonth);
      return;
    }
    setInternalMonth(nextMonth);
  }

  return (
    <div className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <button className="icon-button h-8 w-8" onClick={() => changeMonth(-1)} title="Previous month" type="button">
          <ChevronLeft size={14} />
        </button>
        <div className="text-sm font-semibold text-white">{calendarTitle(activeMonth)}</div>
        <button className="icon-button h-8 w-8" onClick={() => changeMonth(1)} title="Next month" type="button">
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-[0.12em] text-slate-600">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
          <div key={day}>{compact ? day.slice(0, 1) : day}</div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1">
        {cells.map((cell) => {
          const isRealDay = cell.day != null;
          const isSelectable = Boolean(onSelectDate && isRealDay && cell.trades > 0);
          const isSelected =
            isRealDay &&
            (selectedDate === cell.date ||
              Boolean(selectedRange && dateKeyInRange(cell.date, selectedRange.start, selectedRange.end)));
          const cellClass = `min-h-14 rounded-md border px-2 py-1 text-left text-xs transition ${
            !isRealDay
              ? "border-transparent bg-transparent"
              : isSelected
                ? "border-cyan-300/35 bg-cyan-300/10 text-cyan-50 ring-1 ring-cyan-300/15"
                : cell.pnl > 0
                  ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
                  : cell.pnl < 0
                    ? "border-rose-300/20 bg-rose-300/10 text-rose-100"
                    : "border-white/10 bg-black/20 text-slate-500"
          } ${isSelectable ? "hover:border-cyan-300/30 hover:bg-cyan-300/10" : ""} ${compact ? "min-h-9 px-1" : ""}`;
          const content = (
            <>
              <div>{cell.day ?? ""}</div>
              {!compact && cell.day != null && cell.trades > 0 && (
                <div className="mt-1 truncate font-semibold">{formatMoney(cell.pnl, currency)}</div>
              )}
              {compact && cell.day != null && cell.trades > 0 && (
                <div className="mt-1 h-1 w-1 rounded-full bg-current opacity-80" />
              )}
            </>
          );
          return isSelectable ? (
            <button
              aria-pressed={isSelected}
              className={cellClass}
              key={cell.key}
              onClick={() => onSelectDate?.(cell.date)}
              title={`${cell.date} · ${cell.trades} trades · ${formatMoney(cell.pnl, currency)}`}
              type="button"
            >
              {content}
            </button>
          ) : (
            <div className={cellClass} key={cell.key} title={cell.date}>
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AreaSparkline({
  currency = "USD",
  height = 180,
  tone = "cyan",
  values,
}: {
  currency?: string;
  height?: number;
  tone?: "cyan" | "rose";
  values: number[];
}) {
  const gradientId = useId().replace(/:/g, "");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const width = 900;
  const domain = chartDomain(values);
  const ticks = chartTicks(domain.min, domain.max, 5);
  const yAxisWidth = chartAxisLabelWidth(ticks.map((tick) => formatCompactMoney(tick, currency)));
  const margin = { bottom: 30, left: yAxisWidth, right: 24, top: 18 };
  const points = chartPoints(values, width, height, margin, domain);
  const path = linePath(points);
  const zeroY = chartY(0, height, margin, domain);
  const areaPath = points.length > 1
    ? `${path} L ${points[points.length - 1].x.toFixed(2)} ${zeroY.toFixed(2)} L ${points[0].x.toFixed(2)} ${zeroY.toFixed(2)} Z`
    : "";
  const stroke = tone === "rose" ? "#fb7185" : "#34d399";
  const glow = tone === "rose" ? "rgba(251, 113, 133, 0.22)" : "rgba(52, 211, 153, 0.22)";
  const lastPoint = points[points.length - 1];
  const firstPoint = points[0];
  const activePoint = activeIndex == null ? null : points[activeIndex] ?? null;
  const activeValue = activeIndex == null ? null : values[activeIndex] ?? null;

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * width;
    const plotWidth = width - margin.left - margin.right;
    const rawIndex = ((x - margin.left) / Math.max(plotWidth, 1)) * (values.length - 1);
    setActiveIndex(Math.max(0, Math.min(values.length - 1, Math.round(rawIndex))));
  }

  function moveActiveIndex(delta: number) {
    setActiveIndex((current) => {
      const nextIndex = (current ?? values.length - 1) + delta;
      return Math.max(0, Math.min(values.length - 1, nextIndex));
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveActiveIndex(-1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveActiveIndex(1);
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(values.length - 1);
    }
  }

  return (
    <div
      aria-label="Interactive performance chart"
      className="relative overflow-hidden rounded-md border border-white/10 bg-black/20 outline-none focus-visible:ring-1 focus-visible:ring-cyan-300/40"
      onBlur={() => setActiveIndex(null)}
      onFocus={() => setActiveIndex((current) => current ?? values.length - 1)}
      onKeyDown={handleKeyDown}
      role="img"
      style={{ height }}
      tabIndex={values.length > 1 ? 0 : -1}
    >
      {values.length > 1 ? (
        <>
        <svg
          className="h-full w-full cursor-crosshair"
          onPointerLeave={() => setActiveIndex(null)}
          onPointerMove={handlePointerMove}
          preserveAspectRatio="none"
          viewBox={`0 0 ${width} ${height}`}
        >
          <defs>
            <linearGradient id={`${gradientId}-fill`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.34" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <rect fill="rgba(2, 6, 23, 0.16)" height={height} width={width} />
          {ticks.map((tick) => {
            const y = chartY(tick, height, margin, domain);
            return (
              <g key={tick}>
                <line
                  stroke="rgba(148, 163, 184, 0.14)"
                  strokeDasharray="5 7"
                  strokeWidth="1"
                  x1={margin.left}
                  x2={width - margin.right}
                  y1={y}
                  y2={y}
                />
                <text
                  fill="rgba(203, 213, 225, 0.58)"
                  fontSize="11"
                  fontWeight="600"
                  textAnchor="end"
                  x={margin.left - 10}
                  y={y + 4}
                >
                  {formatCompactMoney(tick, currency)}
                </text>
              </g>
            );
          })}
          <line
            stroke="rgba(203, 213, 225, 0.22)"
            strokeWidth="1"
            x1={margin.left}
            x2={width - margin.right}
            y1={zeroY}
            y2={zeroY}
          />
          <path d={areaPath} fill={`url(#${gradientId}-fill)`} />
          <path d={path} fill="none" stroke={glow} strokeLinecap="round" strokeWidth="7" />
          <path d={path} fill="none" stroke={stroke} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
          {activePoint && (
            <g>
              <line
                stroke="rgba(226, 232, 240, 0.26)"
                strokeDasharray="4 6"
                strokeWidth="1"
                x1={activePoint.x}
                x2={activePoint.x}
                y1={margin.top}
                y2={height - margin.bottom}
              />
              <line
                stroke="rgba(226, 232, 240, 0.18)"
                strokeDasharray="4 6"
                strokeWidth="1"
                x1={margin.left}
                x2={width - margin.right}
                y1={activePoint.y}
                y2={activePoint.y}
              />
              <circle cx={activePoint.x} cy={activePoint.y} fill={stroke} r="5" stroke="#020617" strokeWidth="2.5" />
            </g>
          )}
          {firstPoint && <circle cx={firstPoint.x} cy={firstPoint.y} fill="#0f172a" r="3.5" stroke={stroke} strokeWidth="2" />}
          {lastPoint && (
            <>
              <circle cx={lastPoint.x} cy={lastPoint.y} fill={stroke} r="4" stroke="#020617" strokeWidth="2" />
              <text
                fill="rgba(226, 232, 240, 0.82)"
                fontSize="11"
                fontWeight="700"
                textAnchor="end"
                x={width - margin.right}
                y={Math.max(margin.top + 12, Math.min(height - margin.bottom, lastPoint.y - 10))}
              >
                {formatCompactMoney(values[values.length - 1] ?? 0, currency)}
              </text>
            </>
          )}
          <text fill="rgba(148, 163, 184, 0.55)" fontSize="11" fontWeight="600" x={margin.left} y={height - 8}>
            Start
          </text>
          <text fill="rgba(148, 163, 184, 0.55)" fontSize="11" fontWeight="600" textAnchor="end" x={width - margin.right} y={height - 8}>
            Latest
          </text>
        </svg>
        {activePoint && activeValue != null && (
          <div
            className="pointer-events-none absolute z-10 rounded-md border border-white/10 bg-slate-950/95 px-2.5 py-2 text-xs shadow-xl shadow-black/30 backdrop-blur"
            style={{
              left: `${clampPercent((activePoint.x / width) * 100, 12, 88)}%`,
              top: `${clampPercent((activePoint.y / height) * 100, 16, 84)}%`,
              transform: activePoint.y < height * 0.36 ? "translate(-50%, 14px)" : "translate(-50%, calc(-100% - 12px))",
            }}
          >
            <div className="font-semibold text-white">
              {activeIndex === 0 ? "Start" : activeIndex === values.length - 1 ? "Latest" : `Point ${activeIndex}`}
            </div>
            <div className={`mt-1 font-semibold tabular-nums ${toneForNumber(activeValue)}`}>
              {formatMoney(activeValue, currency)}
            </div>
          </div>
        )}
        </>
      ) : (
        <div className="grid h-full place-items-center text-sm text-slate-500">No chart data</div>
      )}
    </div>
  );
}

function BarBreakdown({
  chartHeight = 240,
  currency = "USD",
  maxItems = 14,
  percent = false,
  rows,
}: {
  chartHeight?: number;
  currency?: string;
  maxItems?: number;
  percent?: boolean;
  rows: Array<{ label: string; value: number }>;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const visibleRows = rows
    .filter((row) => Number.isFinite(row.value))
    .slice(0, maxItems);
  const activeRow = activeIndex == null ? null : visibleRows[activeIndex] ?? null;
  const rawMin = Math.min(0, ...visibleRows.map((row) => row.value));
  const rawMax = Math.max(0, ...visibleRows.map((row) => row.value));
  const domain = percent ? { max: Math.max(100, rawMax), min: 0 } : expandFlatDomain(rawMin, rawMax);
  const range = domain.max - domain.min || 1;
  const zeroBottom = ((0 - domain.min) / range) * 100;
  const ticks = chartTicks(domain.min, domain.max, 5);
  const tickLabels = ticks.map((tick) => (percent ? `${tick.toFixed(0)}%` : formatCompactMoney(tick, currency)));
  const axisWidth = chartAxisLabelWidth(tickLabels, { max: 150, min: 58 });
  const axisLabelWidth = Math.max(46, axisWidth - 12);
  const minWidth = Math.max(360, axisWidth + visibleRows.length * 58);
  const activeLabel = activeRow?.label ?? "";
  const activeValueLabel = activeRow ? (percent ? `${activeRow.value.toFixed(1)}%` : formatMoney(activeRow.value, currency)) : "";
  const activeTooltipLeft = activeIndex == null
    ? 50
    : clampPercent(((activeIndex + 0.5) / Math.max(visibleRows.length, 1)) * 100, 10, 90);
  const activeTooltipStyle = activeRow
    ? {
        [activeRow.value >= 0 ? "top" : "bottom"]: "0.5rem",
        left: `${activeTooltipLeft}%`,
        transform: "translateX(-50%)",
      }
    : undefined;

  if (visibleRows.length === 0) {
    return <EmptyState icon={BarChart3} message="No chart data yet." />;
  }

  return (
    <div className="mt-4 overflow-x-auto rounded-md border border-white/10 bg-black/20 px-3 py-3">
      <div className="grid min-w-0 grid-rows-[minmax(0,1fr)_42px]" style={{ height: chartHeight, minWidth }}>
        <div className="relative" onPointerLeave={() => setActiveIndex(null)}>
          {ticks.map((tick) => {
            const top = ((domain.max - tick) / range) * 100;
            const tickLabel = percent ? `${tick.toFixed(0)}%` : formatCompactMoney(tick, currency);
            return (
              <div className="absolute left-0 right-0" key={tick} style={{ top: `${top}%` }}>
                <div className="border-t border-dashed border-white/10" style={{ marginLeft: axisWidth }} />
                <span
                  className="absolute -top-2 left-0 text-right text-[10px] font-semibold tabular-nums text-slate-600"
                  style={{ width: axisLabelWidth }}
                >
                  {tickLabel}
                </span>
              </div>
            );
          })}
          <div className="absolute right-0 border-t border-white/20" style={{ bottom: `${zeroBottom}%`, left: axisWidth }} />
          <div className="absolute inset-y-0 right-0 flex items-stretch gap-2" style={{ left: axisWidth }}>
            {visibleRows.map((row, rowIndex) => {
              const heightPercent = row.value === 0 ? 1.5 : Math.max(2, (Math.abs(row.value) / range) * 100);
              const bottomPercent = row.value >= 0 ? zeroBottom : zeroBottom - heightPercent;
              const active = activeIndex === rowIndex;
              return (
                <button
                  aria-label={`${row.label}: ${percent ? `${row.value.toFixed(1)}%` : formatMoney(row.value, currency)}`}
                  className="relative min-w-10 flex-1 rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-cyan-300/40"
                  key={row.label}
                  onBlur={() => setActiveIndex(null)}
                  onFocus={() => setActiveIndex(rowIndex)}
                  onPointerEnter={() => setActiveIndex(rowIndex)}
                  title={`${row.label}: ${percent ? `${row.value.toFixed(1)}%` : formatMoney(row.value, currency)}`}
                  type="button"
                >
                  <div
                    className={`absolute left-1/2 w-7 -translate-x-1/2 rounded-t-sm ${
                      row.value >= 0
                        ? active
                          ? "bg-emerald-300 shadow-[0_0_24px_rgba(52,211,153,0.26)]"
                          : "bg-emerald-400/70 shadow-[0_0_20px_rgba(52,211,153,0.16)]"
                        : active
                          ? "bg-rose-300 shadow-[0_0_24px_rgba(251,113,133,0.24)]"
                          : "bg-rose-400/70 shadow-[0_0_20px_rgba(251,113,133,0.14)]"
                    }`}
                    style={{
                      bottom: `${Math.max(0, bottomPercent)}%`,
                      height: `${Math.min(100, heightPercent)}%`,
                    }}
                  />
                </button>
              );
            })}
          </div>
          {activeRow && activeTooltipStyle && (
            <div
              className="pointer-events-none absolute z-20 max-w-48 rounded-md border border-white/10 bg-slate-950/95 px-2.5 py-2 text-xs shadow-xl shadow-black/30 backdrop-blur"
              style={activeTooltipStyle}
            >
              <div className="truncate font-semibold text-white" title={activeLabel}>{activeLabel}</div>
              <div className={`mt-1 font-semibold tabular-nums ${toneForNumber(activeRow.value)}`}>
                {activeValueLabel}
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-2 pt-2" style={{ marginLeft: axisWidth }}>
          {visibleRows.map((row, rowIndex) => (
            <div
              className={`min-w-10 flex-1 rounded px-1 text-center transition ${activeIndex === rowIndex ? "bg-white/5" : ""}`}
              key={row.label}
            >
              <div className="truncate text-[10px] font-semibold text-slate-500" title={row.label}>
                {row.label}
              </div>
              <div className={`mt-0.5 truncate text-[10px] font-semibold tabular-nums ${toneForNumber(row.value)}`}>
                {percent ? `${row.value.toFixed(0)}%` : formatCompactMoney(row.value, currency)}
              </div>
            </div>
          ))}
        </div>
      </div>
      {rows.length > visibleRows.length && (
        <div className="mt-2 text-xs text-slate-600">Showing first {visibleRows.length} of {rows.length} buckets.</div>
      )}
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
  return useStoredStrategyNames(BACKTEST_STRATEGIES_STORAGE_KEY);
}

function useLiveJournalStrategyNames() {
  return useStoredStrategyNames(LIVE_JOURNAL_STRATEGIES_STORAGE_KEY);
}

function useStoredStrategyNames(storageKey: string) {
  const [names, setNames] = useState<string[]>(() =>
    normalizeBacktestStrategyNames(
      getCachedAppStorageItem<unknown>(storageKey, []),
    ),
  );

  useEffect(() => {
    let active = true;
    void loadAppStorageItem<unknown>(storageKey, []).then((value) => {
      if (active) {
        setNames(normalizeBacktestStrategyNames(value));
      }
    });
    const unsubscribe = subscribeAppStorageItem<unknown>(
      storageKey,
      (value) => setNames(normalizeBacktestStrategyNames(value)),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [storageKey]);

  return names;
}

async function persistBacktestStrategyNames(names: string[]) {
  return persistStoredStrategyNames(BACKTEST_STRATEGIES_STORAGE_KEY, names);
}

async function persistLiveJournalStrategyNames(names: string[]) {
  return persistStoredStrategyNames(LIVE_JOURNAL_STRATEGIES_STORAGE_KEY, names);
}

async function persistStoredStrategyNames(storageKey: string, names: string[]) {
  const nextNames = normalizeBacktestStrategyNames(names);
  await saveAppStorageItem(storageKey, nextNames);
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

function mergeLiveStrategyGroups(strategies: LiveStrategyGroup[], savedNames: string[]): LiveStrategyGroup[] {
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
    trade.gross_pnl,
    trade.realized_pnl,
    trade.commission_amount,
    trade.commission_mode,
    trade.fee_amount,
    trade.fee_mode,
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

function filterResultTrades(
  trades: Trade[],
  filters: ResultFilterState,
  sessionById: Map<number, BacktestSession>,
) {
  return trades.filter((trade) => {
    const session = sessionById.get(trade.session_id);
    const strategyName = tradeStrategyName(trade, session);
    const resultDate = (trade.exit_time ?? trade.entry_time).slice(0, 10);
    if (filters.sessionFilter !== "ALL" && String(trade.session_id) !== filters.sessionFilter) {
      return false;
    }
    if (filters.instrumentFilter !== "ALL" && tradeInstrumentFilterValue(trade, session) !== filters.instrumentFilter) {
      return false;
    }
    if (filters.sideFilter !== "ALL" && trade.side !== filters.sideFilter) {
      return false;
    }
    if (filters.strategyFilter !== "ALL" && !sameStrategyName(strategyName, filters.strategyFilter)) {
      return false;
    }
    if (filters.tagFilter !== "ALL" && !tradeHasNoteTag(trade, filters.tagFilter)) {
      return false;
    }
    if (filters.dateFrom && resultDate < filters.dateFrom) {
      return false;
    }
    if (filters.dateTo && resultDate > filters.dateTo) {
      return false;
    }
    return tradeMatchesLogSearch(trade, session, filters.searchTerm, strategyName);
  });
}

function resultFiltersActive(filters: ResultFilterState) {
  return (
    filters.sessionFilter !== "ALL" ||
    filters.instrumentFilter !== "ALL" ||
    filters.sideFilter !== "ALL" ||
    filters.strategyFilter !== "ALL" ||
    filters.tagFilter !== "ALL" ||
    Boolean(filters.dateFrom || filters.dateTo || filters.searchTerm.trim())
  );
}

function currencyForFilteredScope(
  trades: Trade[],
  sessionById: Map<number, BacktestSession>,
  datasets: DatasetCatalog | null,
  fallbackCurrency: string,
  filters: ResultFilterState,
) {
  if (filters.sessionFilter !== "ALL") {
    const session = sessionById.get(Number(filters.sessionFilter));
    if (session) {
      return currencyForSession(session, datasets);
    }
  }
  return currencyForTrades(trades, sessionById, datasets, fallbackCurrency);
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
    "Gross P&L",
    "Commission",
    "Commission Mode",
    "Commission Value",
    "Fees",
    "Fee Mode",
    "Fee Value",
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
      trade.gross_pnl ?? trade.realized_pnl,
      trade.commission_amount ?? 0,
      trade.commission_mode ?? "NONE",
      trade.commission_value ?? 0,
      trade.fee_amount ?? 0,
      trade.fee_mode ?? "NONE",
      trade.fee_value ?? 0,
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

function exportJournalTradeLogCsv(
  trades: JournalTrade[],
  accountById: Map<number, LiveJournalAccount>,
  playbookById: Map<number, Playbook>,
  sessionById: Map<number, LiveJournalSession>,
) {
  const headers = [
    "Trade ID",
    "Entry Type",
    "Session",
    "Instrument",
    "Accounts",
    "Side",
    "Status",
    "Entry Time",
    "Exit Time",
    "Entry Price",
    "Exit Price",
    "Planned Entry",
    "Planned Exit",
    "Planned Stop",
    "Planned Target",
    "Quantity",
    "Currency",
    "Gross P&L",
    "Commission",
    "Commission Mode",
    "Commission Value",
    "Brokerage",
    "Brokerage Mode",
    "Brokerage Value",
    "Net P&L",
    "R Multiple",
    "Strategy",
    "Playbook",
    "Emotion",
    "Tags",
    "Missed Reason",
    "Notes",
    "Screenshot URL",
  ];
  const rows = trades.map((trade) => {
    const session = sessionById.get(trade.session_id);
    const accounts = liveTradeAccountIds(trade)
      .map((accountId) => accountById.get(accountId)?.name)
      .filter(Boolean)
      .join("; ");
    const playbook = trade.playbook_id ? playbookById.get(trade.playbook_id) : null;
    const missed = isMissedJournalTrade(trade);
    const currency = currencyForJournalTrade(trade, accountById, sessionById);
    return [
      trade.id,
      missed ? "MISSED" : "TAKEN",
      session?.name ?? `Session #${trade.session_id}`,
      session?.instrument ?? "",
      accounts,
      trade.side,
      trade.status,
      trade.entry_time,
      missed ? "" : (trade.exit_time ?? ""),
      missed ? "" : (trade.entry_price ?? ""),
      missed ? "" : (trade.exit_price ?? ""),
      trade.planned_entry_price ?? "",
      trade.planned_exit_price ?? "",
      trade.planned_stop_loss ?? "",
      trade.planned_take_profit ?? "",
      missed && trade.quantity === 0 ? "" : trade.quantity,
      currency,
      missed ? "" : (trade.gross_pnl ?? trade.realized_pnl),
      missed ? "" : (trade.commission_amount ?? 0),
      missed ? "" : (trade.commission_mode ?? "NONE"),
      missed ? "" : (trade.commission_value ?? 0),
      missed ? "" : (trade.fee_amount ?? 0),
      missed ? "" : (trade.fee_mode ?? "NONE"),
      missed ? "" : (trade.fee_value ?? 0),
      missed ? "" : trade.realized_pnl,
      missed ? "" : (trade.r_multiple ?? ""),
      trade.strategy_name || session?.strategy_name || "",
      playbook?.name ?? "",
      trade.emotional_state ?? "",
      trade.mistake_tags.join("; "),
      trade.missed_reason ?? "",
      richTextToPlainText(trade.notes),
      trade.screenshot_url ?? "",
    ];
  });
  downloadTextFile(
    `journal-trades-${new Date().toISOString().slice(0, 10)}.csv`,
    [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n"),
    "text/csv;charset=utf-8",
  );
}

function exportResultsSummaryCsv({
  aggregate,
  currency,
  days,
  filenamePrefix,
  sessionById,
  strategies,
  trades,
}: {
  aggregate: Aggregate;
  currency: string;
  days: DayGroup[];
  filenamePrefix: string;
  sessionById: Map<number, BacktestSession>;
  strategies: StrategyGroup[];
  trades: Trade[];
}) {
  const rows: unknown[][] = [
    ["Section", "Metric", "Value", "Extra"],
    ["Summary", "Gross P&L", aggregate.grossPnl, currency],
    ["Summary", "Net P&L", aggregate.netPnl, currency],
    ["Summary", "Commissions", aggregate.totalCommissions, currency],
    ["Summary", "Fees", aggregate.totalFees, currency],
    ["Summary", "Closed trades", aggregate.totalTrades, ""],
    ["Summary", "Win rate", `${(aggregate.winRate * 100).toFixed(1)}%`, ""],
    ["Summary", "Profit factor", formatRatio(aggregate.profitFactor), ""],
    ["Summary", "Average R", formatOptionalNumber(aggregate.averageR), ""],
    ["Summary", "Max drawdown", aggregate.maxDrawdown, currency],
    ["Summary", "Recovery factor", formatRatio(aggregate.recoveryFactor), ""],
    [],
    ["Daily", "Date", "P&L", "Trades"],
    ...days
      .slice()
      .reverse()
      .map((day) => ["Daily", day.date, day.aggregate.netPnl, day.aggregate.totalTrades]),
    [],
    ["Strategy", "Name", "P&L", "Trades"],
    ...strategies.map((strategy) => [
      "Strategy",
      strategy.name,
      strategy.aggregate.netPnl,
      strategy.aggregate.totalTrades,
    ]),
    [],
    ["Trade", "ID", "Instrument", "Gross P&L", "Commission", "Fees", "Net P&L"],
    ...trades.map((trade) => [
      "Trade",
      trade.id,
      tradeInstrumentLabel(trade, sessionById.get(trade.session_id)),
      tradeGrossPnl(trade),
      trade.commission_amount ?? 0,
      trade.fee_amount ?? 0,
      trade.realized_pnl ?? 0,
    ]),
  ];
  downloadTextFile(
    `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv`,
    rows.map((row) => row.map(csvCell).join(",")).join("\n"),
    "text/csv;charset=utf-8",
  );
}

async function copyTextToClipboard(text: string) {
  if (typeof navigator === "undefined") {
    return;
  }
  await navigator.clipboard?.writeText(text);
}

function buildResultsSummaryText({
  aggregate,
  currency,
  label,
  trades,
}: {
  aggregate: Aggregate;
  currency: string;
  label: string;
  trades: number;
}) {
  return [
    label,
    `Net P&L: ${formatMoney(aggregate.netPnl, currency)}`,
    `Trades: ${trades}`,
    `Win rate: ${formatPercent(aggregate.winRate)}`,
    `Profit factor: ${formatRatio(aggregate.profitFactor)}`,
    `Average R: ${formatOptionalNumber(aggregate.averageR)}`,
    `Max drawdown: ${formatMoney(aggregate.maxDrawdown, currency)}`,
  ].join("\n");
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

function dataUrlToBlob(url: string) {
  const commaIndex = url.indexOf(",");
  if (commaIndex === -1) {
    return new Blob([url], { type: "application/octet-stream" });
  }
  const metadata = url.slice(0, commaIndex);
  const payload = url.slice(commaIndex + 1);
  const mime = metadata.match(/^data:([^;,]+)/)?.[1] ?? "application/octet-stream";
  if (metadata.includes(";base64")) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(payload)], { type: mime });
}

function openScreenshotFullSize(url: string) {
  if (typeof window === "undefined") {
    return false;
  }
  const trimmed = url.trim();
  if (!trimmed) {
    return false;
  }
  let objectUrl: string | null = null;
  const targetUrl = trimmed.startsWith("data:")
    ? (() => {
        objectUrl = URL.createObjectURL(dataUrlToBlob(trimmed));
        return objectUrl;
      })()
    : trimmed;
  const opened = window.open(targetUrl, "_blank", "noopener,noreferrer");
  if (objectUrl) {
    const revokableUrl = objectUrl;
    window.setTimeout(() => URL.revokeObjectURL(revokableUrl), 60_000);
  }
  return Boolean(opened);
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

  function addAccount(payload: LiveJournalAccountInput) {
    const account: LiveJournalAccount = {
      broker: payload.broker.trim() || data.settings.default_broker || "Manual",
      color: normalizeAccountColor(payload.color),
      created_at: new Date().toISOString(),
      currency: normalizeCurrencyCode(payload.currency || data.settings.default_currency),
      id: nextNumericId(data.accounts),
      initial_balance: Math.max(0, payload.initial_balance || 0),
      name: payload.name.trim() || "Journal Account",
      notes: payload.notes.trim(),
      status: "ACTIVE",
    };
    setData((current) => ({
      ...current,
      accounts: [...current.accounts, account],
    }));
    return account;
  }

  function updateAccount(
    accountId: number,
    payload: Partial<LiveJournalAccountInput> & { status?: LiveJournalAccount["status"] },
  ) {
    const existing = data.accounts.find((account) => account.id === accountId);
    if (!existing) {
      return null;
    }
    const updated: LiveJournalAccount = {
      ...existing,
      broker: payload.broker == null ? existing.broker : payload.broker.trim() || "Manual",
      color: payload.color == null ? existing.color : normalizeAccountColor(payload.color),
      currency: payload.currency == null ? existing.currency : normalizeCurrencyCode(payload.currency),
      initial_balance:
        payload.initial_balance == null || !Number.isFinite(payload.initial_balance)
          ? existing.initial_balance
          : Math.max(0, payload.initial_balance),
      name: payload.name == null ? existing.name : payload.name.trim() || existing.name,
      notes: payload.notes == null ? existing.notes : payload.notes.trim(),
      status: payload.status ?? existing.status,
    };
    setData((current) => {
      const accounts = current.accounts.map((account) =>
        account.id === accountId ? updated : account,
      );
      return {
        ...current,
        accounts,
        settings: {
          ...current.settings,
          default_account_ids: filterLiveAccountIds(current.settings.default_account_ids, accounts),
        },
      };
    });
    return updated;
  }

  function deleteAccount(accountId: number) {
    setData((current) => {
      const accounts = current.accounts.filter((account) => account.id !== accountId);
      const settings = {
        ...current.settings,
        default_account_ids: filterLiveAccountIds(current.settings.default_account_ids, accounts),
      };
      return {
        ...current,
        accounts,
        settings,
        trades: current.trades.map((trade) => ({
          ...trade,
          account_ids: (trade.account_ids ?? []).filter((id) => id !== accountId),
        })),
      };
    });
  }

  function addSession(payload: Omit<LiveJournalSession, "created_at" | "id" | "status">) {
    setData((current) => ({
      ...current,
      sessions: [
        ...current.sessions,
        normalizeLiveJournalSession(
          {
            ...payload,
            created_at: new Date().toISOString(),
            id: nextNumericId(current.sessions),
            status: "ACTIVE",
          },
          current.accounts,
          current.settings,
        ),
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

  function updatePlaybook(playbookId: number, payload: PlaybookUpdatePayload) {
    const existing = data.playbooks.find((playbook) => playbook.id === playbookId);
    if (!existing) {
      return null;
    }
    const updated: Playbook = {
      ...existing,
      description: payload.description ?? null,
      name: payload.name?.trim() || existing.name,
      rules: payload.rules ?? null,
    };
    setData((current) => ({
      ...current,
      playbooks: current.playbooks.map((playbook) =>
        playbook.id === playbookId ? updated : playbook,
      ),
    }));
    return updated;
  }

  function deletePlaybook(playbookId: number) {
    setData((current) => ({
      ...current,
      playbooks: current.playbooks.filter((playbook) => playbook.id !== playbookId),
      sessions: current.sessions.map((session) =>
        session.playbook_id === playbookId ? { ...session, playbook_id: null } : session,
      ),
      trades: current.trades.map((trade) =>
        trade.playbook_id === playbookId ? { ...trade, playbook_id: null } : trade,
      ),
    }));
  }

  function updateSession(
    sessionId: number,
    payload: Partial<Omit<LiveJournalSession, "created_at" | "id">>,
  ) {
    const existing = data.sessions.find((session) => session.id === sessionId);
    if (!existing) {
      return null;
    }
    const updated: LiveJournalSession = {
      ...existing,
      ...payload,
      name: payload.name?.trim() || existing.name,
      strategy_name: normalizeLiveJournalStrategyName(payload.strategy_name ?? existing.strategy_name),
      instrument: payload.instrument?.trim() || existing.instrument,
      notes: payload.notes ?? existing.notes,
      playbook_id: payload.playbook_id === undefined ? existing.playbook_id : payload.playbook_id,
    };
    setData((current) => ({
      ...current,
      sessions: current.sessions.map((session) =>
        session.id === sessionId ? normalizeLiveJournalSession(updated, current.accounts, current.settings) : session,
      ),
    }));
    return updated;
  }

  function deleteSession(sessionId: number) {
    setData((current) => {
      const sessions = current.sessions.filter((session) => session.id !== sessionId);
      return {
        ...current,
        sessions: sessions.length > 0 ? sessions : [defaultLiveSession(current.accounts, current.settings)],
        trades: current.trades.filter((trade) => trade.session_id !== sessionId),
      };
    });
  }

  function deleteTrade(tradeId: number) {
    setData((current) => ({
      ...current,
      trades: current.trades.filter((trade) => trade.id !== tradeId),
    }));
  }

  function updateSettings(payload: Partial<LiveJournalSettings>) {
    setData((current) => {
      const settings = sanitizeLiveJournalSettings(
        {
          ...current.settings,
          ...payload,
        },
        current.accounts,
      );
      return {
        ...current,
        settings,
        sessions: current.sessions.map((session) =>
          normalizeLiveJournalSession(session, current.accounts, settings),
        ),
      };
    });
  }

  function updateTradeStrategy(tradeId: number, strategyName: string | null) {
    const nextName = strategyName?.trim() || null;
    setData((current) => ({
      ...current,
      trades: current.trades.map((trade) =>
        trade.id === tradeId ? { ...trade, strategy_name: nextName } : trade,
      ),
    }));
  }

  function buildTradesFromPayload(
    current: LiveJournalData,
    payload: LiveTradeInput,
    existing?: JournalTrade,
  ) {
    const session = current.sessions.find((item) => item.id === payload.sessionId) ?? current.sessions[0] ?? defaultLiveSession(current.accounts, current.settings);
    const sessions = current.sessions.length > 0 ? current.sessions : [session];
    const isMissed = payload.entryType === "MISSED";
    const entryPrice = payload.entryPrice ?? payload.plannedEntryPrice ?? 0;
    const exitPrice = isMissed ? payload.plannedExitPrice : payload.exitPrice;
    const quantity = payload.quantity ?? 0;
    const grossPnl =
      !isMissed && exitPrice != null
        ? payload.side === "LONG"
          ? (exitPrice - entryPrice) * quantity
          : (entryPrice - exitPrice) * quantity
        : 0;
    const notional = Math.abs(entryPrice * quantity);
    const commissionMode = normalizeCommissionMode(payload.commissionMode ?? session.commission_mode ?? current.settings.default_commission_mode);
    const commissionValue = safeNonNegativeNumber(payload.commissionValue, session.commission_value ?? current.settings.default_commission_value);
    const brokerageMode = normalizeCommissionMode(payload.brokerageMode ?? session.brokerage_mode ?? current.settings.default_fee_mode);
    const brokerageValue = safeNonNegativeNumber(payload.brokerageValue, session.brokerage_value ?? current.settings.default_fee_value);
    const commissionAmount = isMissed ? 0 : journalCostAmount(commissionMode, commissionValue, notional);
    const brokerageAmount = isMissed ? 0 : journalCostAmount(brokerageMode, brokerageValue, notional);
    const realizedPnl = grossPnl - commissionAmount - brokerageAmount;
    const riskAmount =
      payload.stopLoss == null || isMissed
        ? null
        : Math.abs(entryPrice - payload.stopLoss) * quantity;
    const directAccountIds = filterLiveAccountIds(payload.accountIds, current.accounts);
    const accountTargets: Array<number | null> = directAccountIds.length > 0 ? directAccountIds : [null];
    const usedIds = new Set(current.trades.filter((trade) => trade.id !== existing?.id).map((trade) => trade.id));
    let nextId = nextNumericId(current.trades);
    const allocateId = (index: number) => {
      if (index === 0 && existing) {
        return existing.id;
      }
      while (usedIds.has(nextId)) {
        nextId += 1;
      }
      const id = nextId;
      usedIds.add(id);
      nextId += 1;
      return id;
    };
    const trades = accountTargets.map((accountId, index): JournalTrade => ({
      ...existing,
      account_ids: accountId == null ? [] : [accountId],
      commission_amount: commissionAmount,
      commission_mode: isMissed ? "NONE" : commissionMode,
      commission_value: isMissed ? 0 : commissionValue,
      emotional_state: payload.emotionalState,
      entry_offset: existing?.entry_offset ?? 0,
      entry_price: entryPrice,
      entry_time: toIsoFromDateTimeLocal(payload.entryTime),
      exit_offset: existing?.exit_offset ?? null,
      exit_price: exitPrice,
      exit_time: isMissed ? toIsoFromDateTimeLocal(payload.entryTime) : toIsoFromDateTimeLocal(payload.exitTime),
      fee_amount: brokerageAmount,
      fee_mode: isMissed ? "NONE" : brokerageMode,
      fee_value: isMissed ? 0 : brokerageValue,
      id: allocateId(index),
      gross_pnl: grossPnl,
      journal_entry_type: payload.entryType,
      mistake_tags: payload.mistakeTags,
      missed_reason: isMissed ? payload.missedReason : null,
      notes: payload.notes,
      planned_entry_price: payload.plannedEntryPrice,
      planned_exit_price: payload.plannedExitPrice,
      planned_stop_loss: payload.plannedStopLoss,
      planned_take_profit: payload.plannedTakeProfit,
      playbook_id: payload.playbookId ?? session.playbook_id ?? null,
      quantity,
      r_multiple: riskAmount != null && riskAmount > 0 ? realizedPnl / riskAmount : null,
      realized_pnl: realizedPnl,
      remaining_quantity: 0,
      screenshot_url: payload.screenshotUrl,
      session_id: session.id,
      side: payload.side,
      status: "CLOSED",
      stop_loss: isMissed ? null : payload.stopLoss,
      strategy_name: normalizeLiveJournalStrategyName(payload.strategyName ?? session.strategy_name),
      take_profit: isMissed ? null : payload.takeProfit,
    }));
    return { sessions, trades };
  }

  function addTrade(payload: LiveTradeInput) {
    setData((current) => {
      const { sessions, trades } = buildTradesFromPayload(current, payload);
      return {
        ...current,
        sessions,
        trades: [...current.trades, ...trades],
      };
    });
  }

  function updateTrade(tradeId: number, payload: LiveTradeInput) {
    setData((current) => {
      const existing = current.trades.find((trade) => trade.id === tradeId);
      if (!existing) {
        return current;
      }
      const { sessions, trades } = buildTradesFromPayload(current, payload, existing);
      return {
        ...current,
        sessions,
        trades: current.trades.flatMap((item) => (item.id === tradeId ? trades : [item])),
      };
    });
  }

  return {
    addAccount,
    addPlaybook,
    addSession,
    addTrade,
    deleteAccount,
    deleteSession,
    deleteTrade,
    deletePlaybook,
    updateAccount,
    updatePlaybook,
    updateSession,
    updateSettings,
    updateTrade,
    updateTradeStrategy,
    data,
  };
}

function loadLiveJournalData(): LiveJournalData {
  try {
    return sanitizeLiveJournalData(
      getCachedAppStorageItem<unknown>(LIVE_JOURNAL_STORAGE_KEY, null),
    );
  } catch {
    return defaultLiveJournalData();
  }
}

async function hydrateLiveJournalData(): Promise<LiveJournalData> {
  return sanitizeLiveJournalData(await loadAppStorageItem<unknown>(LIVE_JOURNAL_STORAGE_KEY, null));
}

function sanitizeLiveJournalData(value: unknown): LiveJournalData {
  if (typeof value !== "object" || value == null) {
    return defaultLiveJournalData();
  }
  const candidate = value as Partial<LiveJournalData>;
  const rawSessions = Array.isArray(candidate.sessions)
    ? candidate.sessions
        .filter(isLiveJournalSession)
        .map((session) => ({ ...session, playbook_id: session.playbook_id ?? null }))
    : [];
  const accountsFromStorage = Array.isArray(candidate.accounts)
    ? candidate.accounts.filter(isLiveJournalAccount).map(sanitizeLiveJournalAccount)
    : [];
  const accounts = accountsFromStorage.length > 0
    ? accountsFromStorage
    : buildLegacyJournalAccounts(rawSessions);
  const settings = sanitizeLiveJournalSettings(candidate.settings, accounts);
  const sessions = (rawSessions.length > 0 ? rawSessions : [defaultLiveSession(accounts, settings)]).map((session) =>
    normalizeLiveJournalSession(session, accounts, settings),
  );
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const rawSessionById = new Map(rawSessions.map((session) => [session.id, session]));
  const trades = Array.isArray(candidate.trades)
    ? splitMultiAccountJournalTrades(
      candidate.trades
        .filter(isTradeLike)
        .map((trade) =>
          sanitizeJournalTrade(
            trade as JournalTrade,
            sessionById,
            accounts,
            rawSessionById.get((trade as JournalTrade).session_id),
          ),
        ),
    )
    : [];
  const playbooks = Array.isArray(candidate.playbooks)
    ? candidate.playbooks.filter(isPlaybookLike)
    : [];
  return {
    accounts,
    playbooks,
    settings,
    sessions,
    trades,
  };
}

function defaultLiveJournalData(): LiveJournalData {
  const settings = defaultLiveJournalSettings();
  const account = defaultLiveAccount(settings);
  return {
    accounts: [account],
    playbooks: [],
    sessions: [defaultLiveSession([account], settings)],
    settings: {
      ...settings,
      default_account_ids: [account.id],
    },
    trades: [],
  };
}

function defaultLiveJournalSettings(): LiveJournalSettings {
  return {
    default_account_ids: [1],
    default_broker: "Manual",
    default_commission_mode: normalizeCommissionMode(loadOrderCommissionMode()),
    default_commission_value: costValueForPayload(
      normalizeCommissionMode(loadOrderCommissionMode()),
      loadOrderCommissionFixed(),
      loadOrderCommissionPercent(),
    ),
    default_currency: normalizeCurrencyCode("USD"),
    default_entry_type: "TAKEN",
    default_fee_mode: normalizeCommissionMode(loadOrderFeeMode()),
    default_fee_value: costValueForPayload(
      normalizeCommissionMode(loadOrderFeeMode()),
      loadOrderFeeFixed(),
      loadOrderFeePercent(),
    ),
    default_risk_percent: numberFromTextOrZero(loadOrderDefaultRiskPercent()),
    require_account_for_taken_trades: true,
  };
}

function defaultLiveAccount(settings = defaultLiveJournalSettings()): LiveJournalAccount {
  return {
    broker: settings.default_broker || "Manual",
    color: "#22d3ee",
    created_at: new Date().toISOString(),
    currency: normalizeCurrencyCode(settings.default_currency),
    id: 1,
    initial_balance: 100000,
    name: "Primary Journal Account",
    notes: "",
    status: "ACTIVE",
  };
}

function defaultLiveSession(
  accounts: LiveJournalAccount[] = [defaultLiveAccount()],
  settings = defaultLiveJournalSettings(),
): LiveJournalSession {
  return {
    account: "Manual",
    account_ids: [],
    brokerage_mode: settings.default_fee_mode,
    brokerage_value: settings.default_fee_value,
    commission_mode: settings.default_commission_mode,
    commission_value: settings.default_commission_value,
    created_at: new Date().toISOString(),
    currency: normalizeCurrencyCode(settings.default_currency),
    id: 1,
    initial_balance: 0,
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

function isLiveJournalAccount(value: unknown): value is LiveJournalAccount {
  if (typeof value !== "object" || value == null) {
    return false;
  }
  const candidate = value as Partial<LiveJournalAccount>;
  return (
    typeof candidate.id === "number" &&
    typeof candidate.name === "string" &&
    typeof candidate.currency === "string" &&
    typeof candidate.initial_balance === "number"
  );
}

function sanitizeLiveJournalAccount(account: LiveJournalAccount): LiveJournalAccount {
  return {
    broker: account.broker?.trim() || "Manual",
    color: normalizeAccountColor(account.color),
    created_at: typeof account.created_at === "string" ? account.created_at : new Date().toISOString(),
    currency: normalizeCurrencyCode(account.currency),
    id: account.id,
    initial_balance: Number.isFinite(account.initial_balance) ? Math.max(0, account.initial_balance) : 0,
    name: account.name.trim() || "Journal Account",
    notes: account.notes?.trim() ?? "",
    status: account.status === "ARCHIVED" ? "ARCHIVED" : "ACTIVE",
  };
}

function sanitizeLiveJournalSettings(
  value: unknown,
  accounts: LiveJournalAccount[] = [],
): LiveJournalSettings {
  const defaults = defaultLiveJournalSettings();
  const candidate = typeof value === "object" && value != null
    ? value as Partial<LiveJournalSettings>
    : {};
  const defaultAccountIds = Array.isArray(candidate.default_account_ids)
    ? candidate.default_account_ids
    : defaults.default_account_ids;
  return {
    default_account_ids: filterLiveAccountIds(defaultAccountIds, accounts),
    default_broker: candidate.default_broker?.trim() || defaults.default_broker,
    default_commission_mode: normalizeCommissionMode(candidate.default_commission_mode ?? defaults.default_commission_mode),
    default_commission_value: safeNonNegativeNumber(candidate.default_commission_value, defaults.default_commission_value),
    default_currency: normalizeCurrencyCode(candidate.default_currency ?? defaults.default_currency),
    default_entry_type: candidate.default_entry_type === "MISSED" ? "MISSED" : "TAKEN",
    default_fee_mode: normalizeCommissionMode(candidate.default_fee_mode ?? defaults.default_fee_mode),
    default_fee_value: safeNonNegativeNumber(candidate.default_fee_value, defaults.default_fee_value),
    default_risk_percent: safeNonNegativeNumber(candidate.default_risk_percent, defaults.default_risk_percent),
    require_account_for_taken_trades: Boolean(candidate.require_account_for_taken_trades),
  };
}

function buildLegacyJournalAccounts(sessions: LiveJournalSession[]) {
  if (sessions.length === 0) {
    return [defaultLiveAccount()];
  }
  const palette = ["#22d3ee", "#34d399", "#f59e0b", "#a78bfa", "#fb7185", "#60a5fa"];
  const accounts: LiveJournalAccount[] = [];
  for (const session of sessions) {
    const name = session.account?.trim() || "Manual";
    const currency = normalizeCurrencyCode(session.currency);
    const key = `${name.toLowerCase()}|${currency}`;
    if (accounts.some((account) => `${account.name.toLowerCase()}|${account.currency}` === key)) {
      continue;
    }
    accounts.push({
      broker: name,
      color: palette[accounts.length % palette.length],
      created_at: session.created_at || new Date().toISOString(),
      currency,
      id: accounts.length + 1,
      initial_balance: Number.isFinite(session.initial_balance) ? session.initial_balance : 0,
      name,
      notes: "",
      status: "ACTIVE",
    });
  }
  return accounts.length > 0 ? accounts : [defaultLiveAccount()];
}

function legacyJournalSessionAccountIds(
  session: LiveJournalSession | undefined,
  accounts: LiveJournalAccount[],
) {
  if (!session) {
    return [];
  }
  const explicitIds = filterLiveAccountIds(session.account_ids ?? [], accounts);
  if (explicitIds.length > 0) {
    return explicitIds;
  }
  const sessionCurrency = normalizeCurrencyCode(session.currency);
  const accountNames = (session.account ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (accountNames.length === 0) {
    return [];
  }
  return accounts
    .filter((account) =>
      normalizeCurrencyCode(account.currency) === sessionCurrency &&
      accountNames.some((name) =>
        sameStrategyName(account.name, name) || sameStrategyName(account.broker, name),
      ),
    )
    .map((account) => account.id);
}

function normalizeLiveJournalSession(
  session: LiveJournalSession,
  accounts: LiveJournalAccount[],
  settings: LiveJournalSettings,
): LiveJournalSession {
  return {
    ...session,
    account: "Manual",
    account_ids: [],
    brokerage_mode: normalizeCommissionMode(session.brokerage_mode ?? settings.default_fee_mode),
    brokerage_value: safeNonNegativeNumber(session.brokerage_value, settings.default_fee_value),
    commission_mode: normalizeCommissionMode(session.commission_mode ?? settings.default_commission_mode),
    commission_value: safeNonNegativeNumber(session.commission_value, settings.default_commission_value),
    currency: normalizeCurrencyCode(session.currency || settings.default_currency),
    initial_balance: safeNonNegativeNumber(session.initial_balance, 0),
    instrument: session.instrument?.trim() || "Manual",
    name: session.name?.trim() || "Live Trading Session",
    notes: session.notes ?? "",
    playbook_id: session.playbook_id ?? null,
    status: session.status === "ARCHIVED" ? "ARCHIVED" : "ACTIVE",
    strategy_name: normalizeLiveJournalStrategyName(session.strategy_name),
  };
}

function sanitizeJournalTrade(
  trade: JournalTrade,
  sessionById: Map<number, LiveJournalSession>,
  accounts: LiveJournalAccount[],
  legacySession?: LiveJournalSession,
): JournalTrade {
  const entryType: JournalEntryType = trade.journal_entry_type === "MISSED" ? "MISSED" : "TAKEN";
  const session = sessionById.get(trade.session_id);
  const explicitAccountIds = filterLiveAccountIds(trade.account_ids ?? [], accounts);
  const fallbackAccountIds = entryType === "TAKEN"
    ? legacyJournalSessionAccountIds(legacySession, accounts)
    : [];
  const accountIds = explicitAccountIds.length > 0 ? explicitAccountIds : fallbackAccountIds;
  const realizedPnl = safeFiniteNumber(trade.realized_pnl, 0);
  return {
    ...trade,
    account_ids: accountIds,
    commission_amount: entryType === "MISSED" ? 0 : safeNonNegativeNumber(trade.commission_amount, 0),
    commission_mode: entryType === "MISSED" ? "NONE" : normalizeCommissionMode(trade.commission_mode),
    commission_value: entryType === "MISSED" ? 0 : safeNonNegativeNumber(trade.commission_value, 0),
    emotional_state: trade.emotional_state ?? null,
    entry_price: safeFiniteNumber(trade.entry_price, 0),
    exit_price: trade.exit_price == null ? null : safeFiniteNumber(trade.exit_price, 0),
    fee_amount: entryType === "MISSED" ? 0 : safeNonNegativeNumber(trade.fee_amount, 0),
    fee_mode: entryType === "MISSED" ? "NONE" : normalizeCommissionMode(trade.fee_mode),
    fee_value: entryType === "MISSED" ? 0 : safeNonNegativeNumber(trade.fee_value, 0),
    gross_pnl: entryType === "MISSED" ? 0 : safeFiniteNumber(trade.gross_pnl, realizedPnl),
    journal_entry_type: entryType,
    mistake_tags: Array.isArray(trade.mistake_tags) ? trade.mistake_tags.filter((tag) => typeof tag === "string") : [],
    missed_reason: entryType === "MISSED" ? trade.missed_reason ?? trade.notes ?? null : null,
    notes: trade.notes ?? null,
    planned_entry_price: trade.planned_entry_price ?? (entryType === "MISSED" ? trade.entry_price : null),
    planned_exit_price: trade.planned_exit_price ?? (entryType === "MISSED" ? trade.exit_price : null),
    planned_stop_loss: trade.planned_stop_loss ?? null,
    planned_take_profit: trade.planned_take_profit ?? null,
    playbook_id: trade.playbook_id ?? session?.playbook_id ?? null,
    quantity: safeNonNegativeNumber(trade.quantity, 0),
    realized_pnl: entryType === "MISSED" ? 0 : realizedPnl,
    remaining_quantity: safeNonNegativeNumber(trade.remaining_quantity, 0),
    r_multiple: entryType === "MISSED" ? null : trade.r_multiple ?? null,
    screenshot_url: trade.screenshot_url ?? null,
    status: "CLOSED",
    stop_loss: entryType === "MISSED" ? null : trade.stop_loss ?? null,
    strategy_name: normalizeLiveJournalStrategyName(trade.strategy_name ?? session?.strategy_name),
    take_profit: entryType === "MISSED" ? null : trade.take_profit ?? null,
  };
}

function splitMultiAccountJournalTrades(trades: JournalTrade[]) {
  const usedIds = new Set(trades.map((trade) => safeFiniteNumber(trade.id, 0)));
  let nextId = Math.max(0, ...usedIds) + 1;
  const rows: JournalTrade[] = [];
  for (const trade of trades) {
    const accountIds = Array.from(new Set((trade.account_ids ?? []).filter((id) => typeof id === "number")));
    if (accountIds.length <= 1) {
      rows.push({
        ...trade,
        account_ids: accountIds,
      });
      continue;
    }
    accountIds.forEach((accountId, index) => {
      while (usedIds.has(nextId)) {
        nextId += 1;
      }
      const id = index === 0 ? trade.id : nextId++;
      usedIds.add(id);
      rows.push({
        ...trade,
        account_ids: [accountId],
        id,
      });
    });
  }
  return rows;
}

function filterLiveAccountIds(ids: unknown, accounts: LiveJournalAccount[]) {
  if (!Array.isArray(ids)) {
    return [];
  }
  const validIds = new Set(accounts.map((account) => account.id));
  const filtered: number[] = [];
  for (const id of ids) {
    if (typeof id !== "number" || !validIds.has(id) || filtered.includes(id)) {
      continue;
    }
    filtered.push(id);
  }
  return filtered;
}

function liveTradeAccountIds(trade: JournalTrade) {
  return Array.from(new Set(trade.account_ids ?? []));
}

function isTakenJournalTrade(trade: JournalTrade): trade is TakenJournalTrade {
  return trade.journal_entry_type !== "MISSED";
}

function isMissedJournalTrade(trade: JournalTrade): trade is MissedJournalTrade {
  return trade.journal_entry_type === "MISSED";
}

function journalTradeReviewText(trade: JournalTrade, fallback = "Open review") {
  const notesText = richTextToPlainText(trade.notes).trim();
  if (isMissedJournalTrade(trade)) {
    return trade.missed_reason?.trim() || notesText || fallback;
  }
  return trade.mistake_tags.join(", ") || notesText || fallback;
}

function journalTradeDeleteConfirmOptions(trade: JournalTrade): ThemedConfirmOptions {
  const label = isMissedJournalTrade(trade) ? "missed setup" : "journal trade";
  return {
    confirmLabel: "Delete entry",
    detail: "This removes the entry from the Journal ledger, notes, reports, and account balances.",
    message: (
      <>
        Delete this <span className="font-semibold text-white">{label}</span> entry?
      </>
    ),
    title: "Delete journal entry",
    tone: "danger",
  };
}

function parseOptionalFloat(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function journalCostAmount(mode: OrderCommissionMode, value: number, notional: number) {
  if (mode === "FIXED") {
    return Math.max(0, value);
  }
  if (mode === "PERCENT") {
    return Math.max(0, notional * value / 100);
  }
  return 0;
}

function currencyForJournalAccounts(accounts: LiveJournalAccount[], fallbackCurrency = "USD") {
  const currencies = uniqueStrings(
    accounts.map((account) => normalizeCurrencyCode(account.currency || fallbackCurrency)),
  );
  if (currencies.length === 0) {
    return normalizeCurrencyCode(fallbackCurrency);
  }
  return currencies.length === 1 ? currencies[0] : MIXED_CURRENCY;
}

function currencyForJournalTrade(
  trade: JournalTrade,
  accountById: Map<number, LiveJournalAccount>,
  sessionById: Map<number, LiveJournalSession>,
  fallbackCurrency = "USD",
) {
  const session = sessionById.get(trade.session_id);
  const accounts = liveTradeAccountIds(trade)
    .map((accountId) => accountById.get(accountId))
    .filter((account): account is LiveJournalAccount => Boolean(account));
  if (accounts.length > 0) {
    return currencyForJournalAccounts(accounts, fallbackCurrency);
  }
  return normalizeCurrencyCode(session?.currency || fallbackCurrency);
}

function currencyForJournalTrades(
  trades: JournalTrade[],
  accountById: Map<number, LiveJournalAccount>,
  sessionById: Map<number, LiveJournalSession>,
  fallbackCurrency = "USD",
) {
  const currencies = uniqueStrings(
    trades.map((trade) => currencyForJournalTrade(trade, accountById, sessionById, fallbackCurrency)),
  );
  if (currencies.length === 0) {
    return normalizeCurrencyCode(fallbackCurrency);
  }
  return currencies.length === 1 ? currencies[0] : MIXED_CURRENCY;
}

function normalizeAccountColor(value: string | null | undefined) {
  const color = value?.trim();
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : "#22d3ee";
}

function safeFiniteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function safeNonNegativeNumber(value: unknown, fallback: number) {
  return Math.max(0, safeFiniteNumber(value, fallback));
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
  trades: JournalTrade[],
): LiveStrategyGroup[] {
  const grouped = new Map<string, { sessions: Map<number, LiveJournalSession>; trades: JournalTrade[] }>();
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
    if (isTakenJournalTrade(trade)) {
      grouped.get(name)?.trades.push(trade);
    }
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

function currencyForLiveSessions(sessions: LiveJournalSession[], fallbackCurrency = "USD") {
  const currencies = uniqueStrings(
    sessions.map((session) => normalizeCurrencyCode(session.currency || fallbackCurrency)),
  );
  if (currencies.length === 0) {
    return normalizeCurrencyCode(fallbackCurrency);
  }
  return currencies.length === 1 ? currencies[0] : MIXED_CURRENCY;
}

function nextNumericId(items: Array<{ id: number }>) {
  return Math.max(0, ...items.map((item) => item.id)) + 1;
}

function defaultDateTimeLocal(offsetMinutes: number) {
  const date = new Date(Date.now() + offsetMinutes * 60000);
  const localOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - localOffset).toISOString().slice(0, 16);
}

function dateTimeLocalFromIso(value: string | null | undefined) {
  if (!value) {
    return defaultDateTimeLocal(0);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return defaultDateTimeLocal(0);
  }
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
  const grossPnl = closed.reduce((sum, trade) => sum + tradeGrossPnl(trade), 0);
  const totalCommissions = closed.reduce((sum, trade) => sum + (trade.commission_amount ?? 0), 0);
  const totalFees = closed.reduce((sum, trade) => sum + (trade.fee_amount ?? 0), 0);
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
    grossPnl,
    grossWins,
    largestLoss: closed.length > 0 ? Math.min(...closed.map((trade) => trade.realized_pnl ?? 0)) : null,
    largestWin: closed.length > 0 ? Math.max(...closed.map((trade) => trade.realized_pnl ?? 0)) : null,
    losses: losses.length,
    maxDrawdown,
    netPnl,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : null,
    recoveryFactor: maxDrawdown < 0 ? netPnl / Math.abs(maxDrawdown) : null,
    totalCommissions,
    totalFees,
    totalTrades: closed.length,
    winRate: closed.length > 0 ? wins.length / closed.length : 0,
    wins: wins.length,
  };
}

function tradeGrossPnl(trade: Trade) {
  const grossPnl = trade.gross_pnl;
  if (Number.isFinite(grossPnl)) {
    return grossPnl;
  }
  return (trade.realized_pnl ?? 0) + (trade.commission_amount ?? 0) + (trade.fee_amount ?? 0);
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

function groupByWeekday(trades: Trade[]) {
  const labels = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const rows = labels.map((label) => ({ label, trades: [] as Trade[] }));
  for (const trade of trades) {
    const dayIndex = (new Date(trade.entry_time).getDay() + 6) % 7;
    rows[dayIndex]?.trades.push(trade);
  }
  return rows
    .filter((row) => row.trades.length > 0)
    .map((row) => ({ aggregate: aggregateTrades(row.trades), label: row.label }));
}

function groupByMonth(trades: Trade[]) {
  const grouped = new Map<string, Trade[]>();
  for (const trade of trades) {
    const key = (trade.exit_time ?? trade.entry_time).slice(0, 7);
    grouped.set(key, [...(grouped.get(key) ?? []), trade]);
  }
  return Array.from(grouped.entries())
    .sort(([leftMonth], [rightMonth]) => leftMonth.localeCompare(rightMonth))
    .map(([month, monthTrades]) => ({
      aggregate: aggregateTrades(monthTrades),
      label: dateFromKey(`${month}-01`).toLocaleDateString([], { month: "short", year: "numeric" }),
    }));
}

function groupByHoldDuration(trades: Trade[]) {
  const buckets = [
    { label: "<15m", max: 15, min: 0 },
    { label: "15-59m", max: 60, min: 15 },
    { label: "1-3.9h", max: 240, min: 60 },
    { label: "4-7.9h", max: 480, min: 240 },
    { label: "8h+", max: Infinity, min: 480 },
  ].map((bucket) => ({ ...bucket, trades: [] as Trade[] }));
  for (const trade of trades) {
    const duration = holdMinutes(trade);
    const bucket = buckets.find((item) => duration != null && duration >= item.min && duration < item.max);
    bucket?.trades.push(trade);
  }
  return buckets
    .filter((bucket) => bucket.trades.length > 0)
    .map((bucket) => ({ aggregate: aggregateTrades(bucket.trades), label: bucket.label }));
}

function groupBySide(trades: Trade[]) {
  return ["LONG", "SHORT"]
    .map((side) => ({
      aggregate: aggregateTrades(trades.filter((trade) => trade.side === side)),
      label: side === "LONG" ? "Long" : "Short",
    }))
    .filter((row) => row.aggregate.totalTrades > 0);
}

function groupByQuantity(trades: Trade[]) {
  const buckets = [
    { label: "<1", max: 1, min: 0 },
    { label: "1-9.9", max: 10, min: 1 },
    { label: "10-99", max: 100, min: 10 },
    { label: "100-999", max: 1000, min: 100 },
    { label: "1K+", max: Infinity, min: 1000 },
  ].map((bucket) => ({ ...bucket, trades: [] as Trade[] }));
  for (const trade of trades) {
    const bucket = buckets.find((item) => trade.quantity >= item.min && trade.quantity < item.max);
    bucket?.trades.push(trade);
  }
  return buckets
    .filter((bucket) => bucket.trades.length > 0)
    .map((bucket) => ({ aggregate: aggregateTrades(bucket.trades), label: bucket.label }));
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

function buildMonthCells(days: DayGroup[], monthDate: string) {
  const activeMonth = dateFromKey(monthDate);
  const year = activeMonth.getFullYear();
  const month = activeMonth.getMonth();
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

function calendarTitle(monthDate: string) {
  return dateFromKey(monthDate).toLocaleDateString([], { month: "long", year: "numeric" });
}

function monthCursorFromDateKey(dateKey: string | null | undefined) {
  const date = dateFromKey(dateKey ?? todayDateKey());
  return dateKeyFromDate(new Date(date.getFullYear(), date.getMonth(), 1));
}

function addMonthsToDateKey(dateKey: string, months: number) {
  const date = dateFromKey(dateKey);
  return dateKeyFromDate(new Date(date.getFullYear(), date.getMonth() + months, 1));
}

function startOfIsoWeekKey(dateKey: string) {
  const date = dateFromKey(dateKey);
  const dayIndex = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - dayIndex);
  return dateKeyFromDate(date);
}

function endOfIsoWeekKey(startDateKey: string) {
  const date = dateFromKey(startDateKey);
  date.setDate(date.getDate() + 6);
  return dateKeyFromDate(date);
}

function dateKeyInRange(dateKey: string, startDateKey: string, endDateKey: string) {
  return dateKey >= startDateKey && dateKey <= endDateKey;
}

function formatDateRange(startDateKey: string, endDateKey: string) {
  return `${shortDate(startDateKey)} - ${shortDate(endDateKey)}`;
}

function todayDateKey() {
  return dateKeyFromDate(new Date());
}

function dateFromKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return new Date();
  }
  return new Date(year, month - 1, day);
}

function dateKeyFromDate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
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

function chartDomain(values: number[]) {
  return expandFlatDomain(Math.min(0, ...values), Math.max(0, ...values));
}

function expandFlatDomain(min: number, max: number) {
  if (min === max) {
    const padding = Math.max(1, Math.abs(min) * 0.12);
    return { max: max + padding, min: min - padding };
  }
  const padding = (max - min) * 0.08;
  return { max: max + padding, min: min - padding };
}

function chartPoints(
  values: number[],
  width: number,
  height: number,
  margin: { bottom: number; left: number; right: number; top: number },
  domain: { max: number; min: number },
) {
  if (values.length === 0) {
    return [];
  }
  const plotWidth = width - margin.left - margin.right;
  const step = values.length > 1 ? plotWidth / (values.length - 1) : plotWidth;
  return values.map((value, index) => ({
    x: margin.left + index * step,
    y: chartY(value, height, margin, domain),
  }));
}

function chartY(
  value: number,
  height: number,
  margin: { bottom: number; left: number; right: number; top: number },
  domain: { max: number; min: number },
) {
  const plotHeight = height - margin.top - margin.bottom;
  const range = domain.max - domain.min || 1;
  return margin.top + ((domain.max - value) / range) * plotHeight;
}

function linePath(points: Array<{ x: number; y: number }>) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
}

function chartTicks(min: number, max: number, count: number) {
  if (count <= 1 || min === max) {
    return [min];
  }
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, index) => min + step * index);
}

function chartAxisLabelWidth(
  labels: string[],
  options: { max?: number; min?: number } = {},
) {
  const min = options.min ?? 76;
  const max = options.max ?? 160;
  const longestLabel = labels.reduce((longest, label) => Math.max(longest, label.length), 0);
  return Math.min(max, Math.max(min, Math.ceil(longestLabel * 7.5 + 24)));
}

function clampPercent(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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

function formatCompactMoney(value: number | null | undefined, currency = "USD") {
  if (value == null || !Number.isFinite(value)) {
    return "-";
  }
  const currencyCode = normalizeCurrencyCode(currency);
  const absolute = Math.abs(value);
  if (currencyCode === MIXED_CURRENCY) {
    return `Mixed ${new Intl.NumberFormat("en-US", {
      maximumFractionDigits: absolute < 1000 ? 2 : 1,
      minimumFractionDigits: absolute < 1000 ? 2 : 0,
      notation: absolute < 1000 ? "standard" : "compact",
    }).format(value)}`;
  }
  if (absolute < 1000) {
    return formatMoney(value, currencyCode);
  }
  return new Intl.NumberFormat("en-US", {
    currency: currencyCode,
    maximumFractionDigits: 1,
    notation: "compact",
    style: "currency",
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
