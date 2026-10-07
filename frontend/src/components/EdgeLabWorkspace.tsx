import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
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
import { curveLinear } from "@visx/curve";
import { downloadSubscribedTextFile } from "../lib/billing";
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
  Calculator,
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
  Layers,
  Lightbulb,
  Link2,
  LineChart,
  List,
  ListOrdered,
  Maximize2,
  MessageSquareQuote,
  Minimize2,
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
  Send,
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
import { Bar as BacklitBar } from "@/components/charts/bar";
import { BarChart as BacklitBarChart } from "@/components/charts/bar-chart";
import { BarXAxis as BacklitBarXAxis } from "@/components/charts/bar-x-axis";
import { Grid as BacklitGrid } from "@/components/charts/grid";
import {
  HeatmapCells as BacklitHeatmapCells,
  HeatmapChart as BacklitHeatmapChart,
  type HeatmapColumn,
  HeatmapTooltip as BacklitHeatmapTooltip,
  HeatmapXAxis as BacklitHeatmapXAxis,
  HeatmapYAxis as BacklitHeatmapYAxis,
} from "@/components/charts/heatmap";
import { Line as BacklitLine, LineChart as BacklitLineChart } from "@/components/charts/line-chart";
import {
  ProfitLossLine,
  profitLossColor,
  resolveProfitLossTooltipLabel,
} from "@/components/charts/profit-loss-line";
import { ChartTooltip as BacklitChartTooltip } from "@/components/charts/tooltip";
import { YAxis as BacklitYAxis } from "@/components/charts/y-axis";
import { Dialog, DialogHeader } from "@/components/ui/Primitives";
import { OrderFlowWorkspace } from "@/components/OrderFlowWorkspace";
import { LiveFeedHealthSurface, type LiveFeedIssue } from "@/components/live/LiveFeedHealthSurface";
import {
  exportAppDataBundle,
  getAngelOneInstruments,
  getApiBearerToken,
  getApiWebSocketUrl,
  getBinanceInstruments,
  getDukascopyCandles,
  getDukascopyInstruments,
  getFeedbackSubmissions,
  getForexFactoryCalendar,
  importAppDataBundle,
  importBacktestTrades,
  postFeedback,
} from "../lib/api";
import type {
  AppDataBundle,
  AngelOneInstrument as ApiAngelOneInstrument,
  BacktestSession,
  BacktestTradeImportResult,
  BinanceInstrument as ApiBinanceInstrument,
  Candle,
  DatasetCatalog,
  DatasetRefreshResponse,
  DatasetRefreshStatus,
  DatasetTimeframe,
  DukascopyInstrument as ApiDukascopyInstrument,
  EconomicCalendarEvent,
  EconomicCalendarResponse,
  FeedbackCategory,
  FeedbackSubmission,
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
  canAggregateTimeframe,
  createIndicatorInstance,
  formatChartTimeframeLabel,
  getTimeframeSeconds,
  isIndicatorKind,
  mergeIndicatorSettings,
  nextIndicatorInstanceColor,
  normalizeChartTimeframe,
  normalizeFibLevels,
  normalizeRiskRewardDrawing,
  TIMEFRAMES,
  type ChartDrawing,
  type ChartIndicatorInstance,
  type ChartIndicatorKind,
  type ChartStyle,
  type ChartTimeframe,
  type DrawingTool,
  type IndicatorSettings,
  type MagnetMode,
} from "../lib/charting";
import {
  chartPaneLayoutById,
  DEFAULT_CHART_PANE_LAYOUT,
  sanitizeChartPaneLayout,
  shouldMountPaneDrawingControls,
  type ChartPaneLayoutId,
} from "../lib/chartLayouts";
import {
  DEFAULT_CHART_VISUAL_SETTINGS,
  sanitizeChartVisualSettings,
  type ChartVisualSettings,
} from "../lib/chartSettings";
import {
  sanitizeChartSyncSettings,
  type ChartSyncSettings,
} from "../lib/chartWorkspace";
import {
  createChartCrosshairSyncBus,
  type ChartCrosshairSyncBus,
} from "../lib/chartCrosshairSync";
import {
  MIXED_CURRENCY,
  currencyForSession,
  currencyForSessions,
  currencyForTrades,
  normalizeCurrencyCode,
} from "../lib/currency";
import { formatDateTime, formatMoney, formatPercent, formatPrice } from "../lib/format";
import { getStoredAuthSession } from "../lib/authSession";
import { loadSettingsPreferences } from "../lib/settingsPreferences";
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
  isAppStorageLocalStorageKey,
  loadAppStorageItem,
  saveAppStorageItem,
  subscribeAppStorageItem,
} from "../lib/serverStorage";
import { formatMarketSymbol, symbolBadge } from "../lib/symbols";
import { sessionStrategyName, tradeStrategyName } from "../lib/strategy";
import { buildDiagnosticsHarSnapshot, trackDiagnosticWebSocket } from "../lib/browserDiagnostics";
import {
  copyTradeSnapshotToClipboard,
  createTradeSnapshotDataUrl,
  shouldRegenerateTradeSnapshotForCurrency,
} from "../lib/tradeSnapshot";
import type { WorkspaceView } from "../lib/workspace";
import { useBacktestStore } from "../store/backtestStore";
import { ChartObjectsPanel } from "./ChartObjectsPanel";
import { ChartWorkspaceFrame } from "./chart/ChartWorkspaceFrame";
import { usePaneMarketData } from "./chart/usePaneMarketData";
import { ChartToolbar } from "./ChartToolbar";
import { ReplayDateTimePicker } from "./ReplayController";
import { ThemedDatePicker } from "./ThemedDatePicker";
import { ThemedColorPicker } from "./ThemedColorPicker";
import { ThemedSelect } from "./ThemedSelect";
import { TradingChart } from "./TradingChart";
import { TradeLog } from "./TradeLog";
import { SettingsCenter } from "./settings/SettingsCenter";
import { RelationalJournalWorkspace } from "./journal/RelationalJournalWorkspace";
import type { JournalChartFocusRequest } from "./journal/JournalReviewDrawer";
import { applyJournalFocusDrawings, journalFocusMatchesSymbol, journalFocusVisibleRange } from "../lib/journalChartFocus";

type WorkspacePageView = Exclude<WorkspaceView, "backtest" | "sessions">;

type Props = {
  activeSession: BacktestSession | null;
  datasets: DatasetCatalog | null;
  journalChartFocus?: JournalChartFocusRequest | null;
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
  reportsLoading: boolean;
  reportsError: string | null;
  onRetryReports: () => void;
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

type FinanceAccountKind = "broker" | "propFirm";
type FinanceAccountStatus = "ACTIVE" | "PAUSED" | "PASSED" | "BREACHED" | "FAILED" | "ARCHIVED";
type FinancePropStage = "phase1" | "phase2" | "verification" | "funded" | "instant" | "live";
type FinanceEntryType = "deposit" | "income" | "expense";

type FinanceTrackerAccount = {
  breach_date: string;
  breach_reason: string;
  breached: boolean;
  challenge_fee: number;
  color: string;
  created_at: string;
  currency: string;
  funded_amount: number;
  id: number;
  journal_account_id: number | null;
  kind: FinanceAccountKind;
  max_loss_limit: number;
  name: string;
  notes: string;
  profit_split_percent: number;
  profit_target: number;
  provider: string;
  stage: FinancePropStage;
  starting_balance: number;
  start_date: string;
  status: FinanceAccountStatus;
};

type FinanceTrackerEntry = {
  account_id: number | null;
  amount: number;
  category: string;
  created_at: string;
  currency: string;
  date: string;
  description: string;
  id: number;
  type: FinanceEntryType;
};

type FinanceTrackerData = {
  accounts: FinanceTrackerAccount[];
  entries: FinanceTrackerEntry[];
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
const FINANCE_TRACKER_STORAGE_KEY = "finance-tracker.v1";
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
const FINANCE_ACCOUNT_KIND_OPTIONS = [
  { label: "Broker account", sublabel: "Normal live broker or personal trading account", value: "broker" },
  { label: "Prop firm account", sublabel: "Challenge, verification, funded phase, or live funded account", value: "propFirm" },
];
const FINANCE_PROP_STAGE_OPTIONS = [
  { label: "Challenge phase 1", value: "phase1" },
  { label: "Challenge phase 2", value: "phase2" },
  { label: "Verification", value: "verification" },
  { label: "Funded", value: "funded" },
  { label: "Instant funded", value: "instant" },
  { label: "Live funded", value: "live" },
];
const FINANCE_STATUS_OPTIONS = [
  { label: "Active", value: "ACTIVE" },
  { label: "Paused", value: "PAUSED" },
  { label: "Passed", value: "PASSED" },
  { label: "Breached", value: "BREACHED" },
  { label: "Failed", value: "FAILED" },
  { label: "Archived", value: "ARCHIVED" },
];
const FINANCE_INCOME_CATEGORIES = ["Payout", "Profit split", "Trading profits", "Rebate", "Refund", "Other income"];
const FINANCE_EXPENSE_CATEGORIES = ["Challenge fee", "Reset fee", "Brokerage", "Commission", "Platform", "Data feed", "Withdrawal fee", "Tax", "Other expense"];
const FINANCE_DEPOSIT_CATEGORIES = ["Initial deposit", "Challenge fee deposit", "Top-up deposit", "Account funding", "Other deposit"];
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
  journalChartFocus,
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
  reportsLoading,
  reportsError,
  onRetryReports,
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
    reportsLoading,
    reportsError,
    onRetryReports,
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

  const settingsCenter = (initialCategory: "backtest" | "global" | "journal", onBack?: () => void, backLabel?: string) => (
    <SettingsCenter
      datasets={datasets}
      initialCategory={initialCategory}
      journalDefaults={{
        default_broker: liveJournal.data.settings.default_broker,
        default_currency: liveJournal.data.settings.default_currency,
        default_entry_type: liveJournal.data.settings.default_entry_type,
        require_account_for_taken_trades: liveJournal.data.settings.require_account_for_taken_trades,
      }}
      onBack={onBack}
      backLabel={backLabel}
      onGetDatasetRefreshStatus={onGetDatasetRefreshStatus}
      onRefreshDatasets={onRefreshDatasets}
      onUpdateDatasetAsset={onUpdateDatasetAsset}
      onUpdateDatasetSettings={onUpdateDatasetSettings}
      onUpdateJournalDefaults={liveJournal.updateSettings}
    />
  );

  switch (view) {
    case "accounts":
      return <AccountsPage {...shared} />;
    case "dashboard":
      return <DashboardPage {...shared} />;
    case "feedback":
      return <FeedbackPage activeSession={activeSession} />;
    case "globalSettings":
      return settingsCenter("global");
    case "dayView":
      return <DayViewPage {...shared} />;
    case "economicCalendar":
      return <EconomicCalendarPage />;
    case "financeTracker":
      return <FinanceTrackerPage journalAccounts={liveJournal.data.accounts} />;
    case "journal":
    case "journalTrades":
      return <RelationalJournalWorkspace view={view} />;
    case "live":
      return <LiveMarketsPage journalChartFocus={journalChartFocus} />;
    case "orderFlow":
      return <OrderFlowWorkspace />;
    case "positionSizeCalculator":
      return <PositionSizeCalculatorPage />;
    case "journalAccounts":
    case "journalDashboard":
    case "journalDayView":
    case "journalNotes":
    case "journalPlaybooks":
    case "journalReports":
    case "journalSessions":
    case "journalStrategies":
      return <RelationalJournalWorkspace view={view} />;
    case "journalSettings":
      return settingsCenter("journal");
    case "notebook":
      return <NotebookPage {...shared} />;
    case "playbooks":
      return <BacktestPlaybooksPage {...shared} />;
    case "reports":
      return <ReportsPage {...shared} />;
    case "settings":
      return settingsCenter("backtest", onNavigateBacktest, "Back to Backtest");
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
  reportsLoading: boolean;
  reportsError: string | null;
  onRetryReports: () => void;
  notebookFocusTradeId: number | null;
  notebookReturnToBacktestPanel: "review" | "results" | null;
  notebookReturnToDayView: boolean;
  notebookReturnToTradeView: boolean;
  tradeViewFilters: TradeViewFilterState;
  tradeViewLogScrollTop: number | null;
};

type LiveFeedProvider = "angelone" | "binance" | "dukascopy";

type LiveAssetClass = "commodity" | "crypto" | "derivative" | "equity" | "etf" | "forex" | "index" | "other";

type LiveWatchlistSymbol = {
  assetClass?: LiveAssetClass;
  color: string;
  description?: string;
  exchange?: string;
  exchangeType?: number;
  feed: LiveFeedProvider;
  instrumentType?: string;
  label: string;
  symbol: string;
  token?: string;
};

type LiveWatchlist = {
  id: string;
  name: string;
  symbols: LiveWatchlistSymbol[];
};

type LiveTicker = {
  change: number;
  changePercent: number;
  high: number;
  last: number;
  low: number;
  quoteVolume: number;
  symbol: string;
  updatedAt: number;
  volume: number;
};

type LiveConnectionStatus = "connecting" | "error" | "idle" | "live";

type DukascopyInstrument = {
  assetClass: LiveAssetClass;
  baseCurrency: string;
  description: string;
  label: string;
  quoteCurrency: string;
  symbol: string;
  tags: string[];
};

type BinanceInstrument = {
  assetClass: "crypto";
  baseAsset: string;
  description: string;
  label: string;
  quoteAsset: string;
  status: string;
  symbol: string;
};

type AngelOneInstrument = {
  assetClass: LiveAssetClass;
  description: string;
  exchange: string;
  exchangeType: number;
  expiry?: string | null;
  instrumentType: string;
  label: string;
  lotSize?: number | null;
  name: string;
  symbol: string;
  tickSize?: number | null;
  token: string;
};

type LiveMarketCatalog = {
  angelone: AngelOneInstrument[];
  binance: BinanceInstrument[];
  dukascopy: DukascopyInstrument[];
  refreshedAt: string | null;
};

type AngelOneCredentials = {
  apiKey: string;
  clientCode: string;
  feedToken: string;
  jwtToken: string;
};

type AngelOneTickPayload = {
  close?: number | null;
  exchangeType?: number;
  high?: number | null;
  last?: number | null;
  low?: number | null;
  open?: number | null;
  timestamp?: number;
  token?: string;
  volume?: number | null;
};

type LiveChartPaneState = {
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
  timeframe: ChartTimeframe;
};

type LiveChartLayout = {
  activePaneId?: string;
  chartSettings?: ChartVisualSettings;
  chartStyle?: ChartStyle;
  drawings?: ChartDrawing[];
  indicatorInstances?: ChartIndicatorInstance[];
  magnetMode?: MagnetMode;
  paneLayout?: ChartPaneLayoutId;
  panes?: LiveChartPaneState[];
  showOrderOverlays?: boolean;
  smoothCandles?: boolean;
  syncSettings?: ChartSyncSettings;
  timeframe?: ChartTimeframe;
};

type LiveChartLayoutRecord = {
  layout: LiveChartLayout;
  name: string;
  updatedAt: string;
};

type TimeframeShortcutFeedback = {
  description: string;
  status: "ready" | "unavailable" | "invalid";
  timeframe?: ChartTimeframe;
  value: string;
};

type BinanceTickerPayload = {
  E?: number;
  P?: string;
  c?: string;
  e?: string;
  h?: string;
  l?: string;
  p?: string;
  q?: string;
  s?: string;
  v?: string;
};

type BinanceRestTickerPayload = {
  closeTime?: number;
  highPrice?: string;
  lastPrice?: string;
  lowPrice?: string;
  priceChange?: string;
  priceChangePercent?: string;
  quoteVolume?: string;
  symbol?: string;
  volume?: string;
};

type BinanceKlinePayload = {
  E?: number;
  e?: string;
  k?: {
    c?: string;
    h?: string;
    i?: string;
    l?: string;
    o?: string;
    t?: number;
    v?: string;
  };
  s?: string;
};

const LIVE_WATCHLIST_STORAGE_KEY = "live-watchlists.v1";
const LIVE_MARKET_CATALOG_STORAGE_KEY = "live-market-catalog.v1";
const ANGELONE_CREDENTIALS_STORAGE_KEY = "live-angelone-smartapi.v1";
const LIVE_CHART_LAYOUT_STORAGE_KEY = "live-chart-layout.v1";
const LIVE_CHART_LAYOUTS_STORAGE_KEY = "live-chart-layouts.v1";
const ACTIVE_LIVE_CHART_LAYOUT_STORAGE_KEY = "active-live-chart-layout.v1";
const LIVE_CHART_SYNC_SETTING_KEYS = ["crosshair"] as const;
const BINANCE_REST_BASE = "https://data-api.binance.vision";
const BINANCE_WS_BASE = "wss://data-stream.binance.vision";
const LIVE_MAX_WATCHLIST_SYMBOLS = 40;
const LIVE_SOURCE_TIMEFRAME: ChartTimeframe = "1m";
const LIVE_DRAWING_UNDO_LIMIT = 50;
const LIVE_DRAWING_UNDO_COALESCE_MS = 350;
const LIVE_HISTORY_TARGET_BARS = 5000;
const LIVE_HISTORY_CACHE_BARS = 5000;
const LIVE_PROVIDER_PAGE_BARS = 1000;
const LIVE_CATALOG_LIMITS = {
  angelone: 4000,
  binance: 3000,
  dukascopy: 800,
};
const TIMEFRAME_SHORTCUT_CLEAR_MS = 1200;

const LIVE_TIMEFRAMES: Array<{
  binanceInterval: "1m";
  dukascopyInterval: "1MIN";
  label: string;
  value: ChartTimeframe;
}> = [
  { binanceInterval: "1m", dukascopyInterval: "1MIN", label: "1m", value: LIVE_SOURCE_TIMEFRAME },
] as const;
const DUKASCOPY_POLL_INTERVAL_MS = 30000;

const BINANCE_FEATURED_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "ADAUSDT",
  "LINKUSDT",
  "AVAXUSDT",
  "POLUSDT",
  "BTCUSDC",
  "ETHUSDC",
];

const BINANCE_QUOTE_ASSET_RANK: Record<string, number> = {
  USDT: 0,
  USDC: 1,
  FDUSD: 2,
  BTC: 3,
  ETH: 4,
  BNB: 5,
  EUR: 6,
  TRY: 7,
};

const DUKASCOPY_FEATURED_SYMBOLS = [
  "EUR/USD",
  "GBP/USD",
  "USD/JPY",
  "XAU/USD",
  "XAG/USD",
  "E_Brent",
  "E_Light",
  "E_SandP-500",
  "E_NQ-100",
  "E_D&J-Ind",
  "E_DAAX",
  "AAPL.US/USD",
  "TSLA.US/USD",
  "SPY.US/USD",
];

const ANGELONE_FEATURED_TOKENS = [
  "1:99926000",
  "1:99926009",
  "3:99919000",
  "1:2885",
  "1:3045",
  "1:11536",
  "1:1594",
  "1:1333",
  "1:4963",
];

const DEFAULT_LIVE_WATCHLISTS: LiveWatchlist[] = [
  {
    id: "crypto-majors",
    name: "Crypto Majors",
    symbols: [
      "BTCUSDT",
      "ETHUSDT",
      "SOLUSDT",
      "BNBUSDT",
      "XRPUSDT",
      "DOGEUSDT",
      "ADAUSDT",
      "LINKUSDT",
      "AVAXUSDT",
      "POLUSDT",
    ].map((symbol) => liveWatchlistSymbol(symbol)),
  },
  {
    id: "dukascopy-cross-asset",
    name: "Dukascopy Cross Asset",
    symbols: [
      { assetClass: "forex", description: "Euro vs US Dollar", label: "EUR/USD", symbol: "EUR/USD" },
      { assetClass: "forex", description: "Pound Sterling vs US Dollar", label: "GBP/USD", symbol: "GBP/USD" },
      { assetClass: "forex", description: "US Dollar vs Japanese Yen", label: "USD/JPY", symbol: "USD/JPY" },
      { assetClass: "commodity", description: "Spot gold", label: "XAU/USD", symbol: "XAU/USD" },
      { assetClass: "commodity", description: "US Brent Crude Oil", label: "BRENT", symbol: "E_Brent" },
      { assetClass: "index", description: "USA 500 Index", label: "S&P 500", symbol: "E_SandP-500" },
      { assetClass: "index", description: "USA 100 Technical Index", label: "NASDAQ 100", symbol: "E_NQ-100" },
      { assetClass: "index", description: "Germany 40 Index", label: "DAX 40", symbol: "E_DAAX" },
      { assetClass: "equity", description: "APPLE INC", label: "AAPL", symbol: "AAPL.US/USD" },
      { assetClass: "etf", description: "SPDR S&P 500 ETF", label: "SPY", symbol: "SPY.US/USD" },
    ].map((instrument) => liveWatchlistSymbol(instrument.symbol, {
      assetClass: instrument.assetClass as LiveAssetClass,
      description: instrument.description,
      feed: "dukascopy",
      label: instrument.label,
    })),
  },
  {
    id: "angelone-india",
    name: "Angel One India",
    symbols: [
      { assetClass: "index", description: "NSE index", exchange: "NSE", exchangeType: 1, label: "Nifty 50", symbol: "Nifty 50", token: "99926000" },
      { assetClass: "index", description: "NSE index", exchange: "NSE", exchangeType: 1, label: "Nifty Bank", symbol: "Nifty Bank", token: "99926009" },
      { assetClass: "index", description: "BSE index", exchange: "BSE", exchangeType: 3, label: "SENSEX", symbol: "SENSEX", token: "99919000" },
      { assetClass: "equity", description: "NSE equity", exchange: "NSE", exchangeType: 1, label: "RELIANCE", symbol: "RELIANCE-EQ", token: "2885" },
      { assetClass: "equity", description: "NSE equity", exchange: "NSE", exchangeType: 1, label: "SBIN", symbol: "SBIN-EQ", token: "3045" },
      { assetClass: "equity", description: "NSE equity", exchange: "NSE", exchangeType: 1, label: "TCS", symbol: "TCS-EQ", token: "11536" },
      { assetClass: "equity", description: "NSE equity", exchange: "NSE", exchangeType: 1, label: "INFY", symbol: "INFY-EQ", token: "1594" },
      { assetClass: "equity", description: "NSE equity", exchange: "NSE", exchangeType: 1, label: "HDFCBANK", symbol: "HDFCBANK-EQ", token: "1333" },
    ].map((instrument) => liveWatchlistSymbol(instrument.symbol, {
      assetClass: instrument.assetClass as LiveAssetClass,
      description: instrument.description,
      exchange: instrument.exchange,
      exchangeType: instrument.exchangeType,
      feed: "angelone",
      label: instrument.label,
      token: instrument.token,
    })),
  },
];

function LiveMarketsPage({ journalChartFocus }: { journalChartFocus?: JournalChartFocusRequest | null }) {
  const { confirm, confirmDialog } = useThemedConfirm();
  const { catalog } = useLiveMarketCatalog();
  const [watchlists, setWatchlists] = useLiveWatchlists();
  const [selectedWatchlistId, setSelectedWatchlistId] = useState(() => watchlists[0]?.id ?? "");
  const selectedWatchlist = watchlists.find((watchlist) => watchlist.id === selectedWatchlistId) ?? watchlists[0] ?? null;
  const symbols = useMemo(() => selectedWatchlist?.symbols ?? [], [selectedWatchlist]);
  const [selectedSymbolKey, setSelectedSymbolKey] = useState(() => liveSymbolKey(symbols[0] ?? liveWatchlistSymbol("BTCUSDT")));
  const selectedLiveSymbol = symbols.find((item) => liveSymbolKey(item) === selectedSymbolKey) ?? symbols[0] ?? null;
  const selectedSymbol = selectedLiveSymbol?.symbol ?? "";
  const selectedFeed = selectedLiveSymbol?.feed ?? "binance";
  const [symbolDraft, setSymbolDraft] = useState("");
  const [feedDraft, setFeedDraft] = useState<LiveFeedProvider>("binance");
  const [binanceSearch, setBinanceSearch] = useState("");
  const [dukascopySearch, setDukascopySearch] = useState("");
  const [angelOneSearch, setAngelOneSearch] = useState("");
  const [isRenamingWatchlist, setIsRenamingWatchlist] = useState(false);
  const [watchlistNameDraft, setWatchlistNameDraft] = useState("");
  const [angelOneCredentials, setAngelOneCredentials] = useState<AngelOneCredentials>(() => defaultAngelOneCredentials());
  const [tickers, setTickers] = useState<Record<string, LiveTicker>>({});
  const [cachedBarsBySymbol, setCachedBarsBySymbol] = useState<Record<string, Candle[]>>({});
  const [liveBars, setLiveBars] = useState<Candle[]>([]);
  const [activeJournalFocus, setActiveJournalFocus] = useState<JournalChartFocusRequest | null>(journalChartFocus ?? null);
  const [connectionStatus, setConnectionStatus] = useState<LiveConnectionStatus>("idle");
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feedIssue, setFeedIssue] = useState<LiveFeedIssue>(null);
  const watchlistNameInputRef = useRef<HTMLInputElement | null>(null);
  const cachedBarsBySymbolRef = useRef(cachedBarsBySymbol);
  const selectedTicker = selectedLiveSymbol ? tickers[liveSymbolKey(selectedLiveSymbol)] ?? null : null;
  const binanceSearchResults = useMemo(
    () => filterBinanceInstruments(catalog.binance, binanceSearch),
    [binanceSearch, catalog.binance],
  );
  const dukascopySearchResults = useMemo(
    () => filterDukascopyInstruments(catalog.dukascopy, dukascopySearch),
    [catalog.dukascopy, dukascopySearch],
  );
  const angelOneSearchResults = useMemo(
    () => filterAngelOneInstruments(catalog.angelone, angelOneSearch),
    [angelOneSearch, catalog.angelone],
  );
  const selectedSourceLabel = liveSourceLabel(selectedFeed);
  const angelOneReady = hasAngelOneCredentials(angelOneCredentials);

  const focusJournalTrade = useCallback((request: JournalChartFocusRequest) => {
    setActiveJournalFocus(request);
    const existing = watchlists.flatMap((watchlist) => watchlist.symbols.map((item) => ({ item, watchlistId: watchlist.id }))).find(({ item }) => journalFocusMatchesSymbol(item.symbol, request.symbol) || journalFocusMatchesSymbol(item.label, request.symbol));
    if (existing) {
      setSelectedWatchlistId(existing.watchlistId);
      setSelectedSymbolKey(liveSymbolKey(existing.item));
      setFeedError(null);
      return;
    }
    const binance = findBinanceInstrument(catalog.binance, request.symbol);
    const dukascopy = findDukascopyInstrument(catalog.dukascopy, request.symbol);
    const angelOne = findAngelOneInstrument(catalog.angelone, request.symbol);
    const nextSymbol = binance ? liveWatchlistSymbol(binance.symbol, { assetClass: binance.assetClass, description: binance.description, feed: "binance", label: binance.label }) : dukascopy ? liveWatchlistSymbol(dukascopy.symbol, { assetClass: dukascopy.assetClass, description: dukascopy.description, feed: "dukascopy", label: dukascopy.label }) : angelOne ? liveWatchlistSymbol(angelOne.symbol, { assetClass: angelOne.assetClass, description: angelOne.description, exchange: angelOne.exchange, exchangeType: angelOne.exchangeType, feed: "angelone", instrumentType: angelOne.instrumentType, label: angelOne.label, token: angelOne.token }) : null;
    if (!nextSymbol || !selectedWatchlist) {
      setFeedError(`${request.symbol} is not in an available Live provider catalog. Open or import a matching Replay dataset to focus this Journal trade.`);
      return;
    }
    if (selectedWatchlist.symbols.length >= LIVE_MAX_WATCHLIST_SYMBOLS) {
      setFeedError(`Add ${request.symbol} to a watchlist with fewer than ${LIVE_MAX_WATCHLIST_SYMBOLS} symbols, then retry Show on chart.`);
      return;
    }
    persistWatchlist({ ...selectedWatchlist, symbols: [...selectedWatchlist.symbols, nextSymbol] });
    setSelectedSymbolKey(liveSymbolKey(nextSymbol));
    setFeedError(null);
  }, [catalog, selectedWatchlist, watchlists]);

  useEffect(() => {
    if (journalChartFocus) focusJournalTrade(journalChartFocus);
  // The parent changes this request for each explicit Journal action. Depending on
  // the watchlist callback would replay the action after the callback mutates it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journalChartFocus]);

  useEffect(() => {
    window.localStorage.removeItem(ANGELONE_CREDENTIALS_STORAGE_KEY);
  }, []);

  useEffect(() => {
    if (!watchlists.some((watchlist) => watchlist.id === selectedWatchlistId)) {
      setSelectedWatchlistId(watchlists[0]?.id ?? "");
    }
  }, [selectedWatchlistId, watchlists]);

  useEffect(() => {
    cachedBarsBySymbolRef.current = cachedBarsBySymbol;
  }, [cachedBarsBySymbol]);

  useEffect(() => {
    setIsRenamingWatchlist(false);
    setWatchlistNameDraft(selectedWatchlist?.name ?? "");
  }, [selectedWatchlist?.id]);

  useEffect(() => {
    if (symbols.length === 0) {
      setSelectedSymbolKey("");
      return;
    }
    if (!symbols.some((item) => liveSymbolKey(item) === selectedSymbolKey)) {
      setSelectedSymbolKey(liveSymbolKey(symbols[0]));
    }
  }, [selectedSymbolKey, symbols]);

  useEffect(() => {
    if (!isRenamingWatchlist) {
      return;
    }
    watchlistNameInputRef.current?.focus();
    watchlistNameInputRef.current?.select();
  }, [isRenamingWatchlist]);

  useEffect(() => {
    if (!selectedLiveSymbol) {
      setLiveBars([]);
      return;
    }
    const cachedBars = cachedBarsBySymbol[liveSymbolKey(selectedLiveSymbol)] ?? [];
    setLiveBars(cachedBars);
    if (cachedBars.length === 0 || selectedLiveSymbol.feed === "angelone") {
      return;
    }
    const cachedTicker = liveTickerFromCandles(selectedLiveSymbol, cachedBars);
    if (!cachedTicker) {
      return;
    }
    setTickers((current) =>
      current[liveSymbolKey(selectedLiveSymbol)]
        ? current
        : { ...current, [liveSymbolKey(selectedLiveSymbol)]: cachedTicker },
    );
  }, [cachedBarsBySymbol, selectedLiveSymbol]);

  useEffect(() => {
    const binanceSymbols = symbols.filter((item) => item.feed === "binance").map((item) => item.symbol);
    if (binanceSymbols.length === 0) {
      return;
    }
    const controller = new AbortController();
    void fetchBinanceTickers(binanceSymbols, controller.signal)
      .then((nextTickers) => {
        setTickers((current) => ({ ...current, ...prefixLiveTickers("binance", nextTickers) }));
        setFeedError(null);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setFeedError(importErrorMessage(error));
        }
      });
    return () => controller.abort();
  }, [symbols]);

  useEffect(() => {
    if (!selectedLiveSymbol) {
      setLiveBars([]);
      return;
    }
    const symbolKey = liveSymbolKey(selectedLiveSymbol);
    const cachedBars = cachedBarsBySymbolRef.current[symbolKey] ?? [];
    if (selectedLiveSymbol.feed === "angelone") {
      setLiveBars(cachedBars);
      return;
    }
    const controller = new AbortController();
    const candleRequest = selectedLiveSymbol.feed === "binance"
      ? fetchBinanceHistoricalCandles(selectedLiveSymbol.symbol, "1m", controller.signal)
      : fetchDukascopyHistoricalCandles(selectedLiveSymbol.symbol, "1MIN", controller.signal);
    void candleRequest
      .then((nextBars) => {
        setLiveBars((current) => {
          const preservedBars = mergeLiveCandles(
            cachedBarsBySymbolRef.current[symbolKey] ?? [],
            current,
            LIVE_HISTORY_CACHE_BARS,
          );
          const mergedBars = mergeLiveCandles(preservedBars, nextBars, LIVE_HISTORY_CACHE_BARS);
          setCachedBarsBySymbol((cache) => ({
            ...cache,
            [symbolKey]: mergedBars,
          }));
          if (selectedLiveSymbol.feed === "dukascopy") {
            const ticker = liveTickerFromCandles(selectedLiveSymbol, mergedBars);
            if (ticker) {
              setTickers((current) => ({ ...current, [symbolKey]: ticker }));
            }
          }
          return mergedBars;
        });
        setFeedError(null);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setFeedError(liveFeedErrorMessage(error, cachedBars.length > 0));
        }
      });
    return () => controller.abort();
  }, [selectedLiveSymbol]);

  useEffect(() => {
    const streamSymbols = uniqueLiveSymbols(symbols.filter((item) => item.feed === "binance").map((item) => item.symbol));
    if (streamSymbols.length === 0) {
      setConnectionStatus(symbols.some((item) => item.feed === "dukascopy" || item.feed === "angelone") ? "live" : "idle");
      return undefined;
    }
    const streams = [
      ...streamSymbols.map((symbol) => `${symbol.toLowerCase()}@ticker`),
      selectedLiveSymbol?.feed === "binance" ? `${selectedLiveSymbol.symbol.toLowerCase()}@kline_1m` : "",
    ].filter(Boolean);
    const socketUrl = `${BINANCE_WS_BASE}/stream?streams=${streams.join("/")}`;
    const socket = new WebSocket(socketUrl);
    trackDiagnosticWebSocket(socket, socketUrl);
    let closedByEffect = false;
    setConnectionStatus("connecting");
    socket.onopen = () => {
      setConnectionStatus("live");
      setFeedError(null);
    };
    socket.onerror = () => {
      setConnectionStatus("error");
      setFeedError("Live feed connection failed");
    };
    socket.onclose = () => {
      if (!closedByEffect) {
        setConnectionStatus("error");
      }
    };
    socket.onmessage = (event) => {
      const payload = parseBinanceCombinedPayload(event.data);
      if (!payload) {
        return;
      }
      if (isBinanceTickerPayload(payload)) {
        const ticker = liveTickerFromBinance(payload);
        if (ticker) {
          setTickers((current) => ({ ...current, [liveSymbolStorageKey("binance", ticker.symbol)]: ticker }));
        }
        return;
      }
      if (isBinanceKlinePayload(payload) && payload.s === selectedLiveSymbol?.symbol) {
        const candle = liveCandleFromBinance(payload);
        if (candle) {
          const symbolKey = liveSymbolStorageKey("binance", payload.s);
          setLiveBars((current) => {
            const nextBars = upsertLiveCandle(current, candle);
            setCachedBarsBySymbol((cache) => ({
              ...cache,
              [symbolKey]: nextBars.slice(-LIVE_HISTORY_CACHE_BARS),
            }));
            return nextBars;
          });
        }
      }
    };
    return () => {
      closedByEffect = true;
      socket.close();
    };
  }, [selectedLiveSymbol, symbols]);

  useEffect(() => {
    const streamSymbols = symbols.filter(isAngelOneLiveSymbol).slice(0, LIVE_MAX_WATCHLIST_SYMBOLS);
    if (streamSymbols.length === 0) {
      return undefined;
    }
    if (!angelOneReady) {
      if (selectedFeed === "angelone") {
        setConnectionStatus("idle");
        setFeedError("Add Angel One SmartAPI credentials to start the Indian-market live feed.");
      }
      return undefined;
    }

    const socketUrl = getApiWebSocketUrl("/live/angelone/stream");
    const socket = new WebSocket(socketUrl);
    trackDiagnosticWebSocket(socket, socketUrl);
    let closedByEffect = false;
    setConnectionStatus("connecting");

    socket.onopen = () => {
      socket.send(JSON.stringify({
        apiToken: getApiBearerToken(),
        credentials: angelOneCredentials,
        symbols: streamSymbols.map((item) => ({
          exchangeType: item.exchangeType,
          token: item.token,
        })),
      }));
    };
    socket.onerror = () => {
      setConnectionStatus("error");
      setFeedError("Angel One live feed connection failed");
    };
    socket.onclose = () => {
      if (!closedByEffect) {
        setConnectionStatus("error");
      }
    };
    socket.onmessage = (event) => {
      const message = parseAngelOneStreamMessage(event.data);
      if (!message) {
        return;
      }
      if (message.type === "status") {
        setConnectionStatus("live");
        setFeedError(null);
        return;
      }
      if (message.type === "error") {
        setConnectionStatus("error");
        setFeedError(message.message || "Angel One live feed failed");
        return;
      }
      if (message.type !== "tick" || !message.tick) {
        return;
      }
      const tickSymbol = findAngelOneSymbolForTick(streamSymbols, message.tick);
      if (!tickSymbol) {
        return;
      }
      const ticker = liveTickerFromAngelOneTick(tickSymbol, message.tick);
      if (ticker) {
        setTickers((current) => ({ ...current, [liveSymbolKey(tickSymbol)]: ticker }));
      }
      if (selectedLiveSymbol && liveSymbolKey(selectedLiveSymbol) === liveSymbolKey(tickSymbol)) {
        const candle = liveCandleFromAngelOneTick(message.tick);
        if (candle) {
          const symbolKey = liveSymbolKey(tickSymbol);
          setLiveBars((current) => {
            const nextBars = upsertLiveTickCandle(current, candle);
            setCachedBarsBySymbol((cache) => ({
              ...cache,
              [symbolKey]: nextBars.slice(-LIVE_HISTORY_CACHE_BARS),
            }));
            return nextBars;
          });
        }
      }
    };

    return () => {
      closedByEffect = true;
      socket.close();
    };
  }, [angelOneCredentials, angelOneReady, selectedFeed, selectedLiveSymbol, symbols]);

  useEffect(() => {
    if (selectedFeed !== "dukascopy" || !selectedLiveSymbol) {
      return undefined;
    }
    let isActive = true;
    let activeController: AbortController | null = null;
    const poll = () => {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      void fetchDukascopyCandles(
        selectedLiveSymbol.symbol,
        "1MIN",
        controller.signal,
        LIVE_PROVIDER_PAGE_BARS,
      )
        .then((nextBars) => {
          if (!isActive || controller.signal.aborted) {
            return;
          }
          const symbolKey = liveSymbolKey(selectedLiveSymbol);
          setLiveBars((current) => {
            const mergedBars = mergeLiveCandles(current, nextBars);
            setCachedBarsBySymbol((cache) => ({
              ...cache,
              [symbolKey]: mergedBars,
            }));
            const ticker = liveTickerFromCandles(selectedLiveSymbol, mergedBars);
            if (ticker) {
              setTickers((currentTickers) => ({ ...currentTickers, [symbolKey]: ticker }));
            }
            return mergedBars;
          });
          setConnectionStatus("live");
          setFeedError(null);
        })
        .catch(() => {
          if (!isActive || controller.signal.aborted) {
            return;
          }
          setConnectionStatus("error");
        });
    };
    poll();
    const interval = window.setInterval(poll, DUKASCOPY_POLL_INTERVAL_MS);
    return () => {
      isActive = false;
      window.clearInterval(interval);
      activeController?.abort();
    };
  }, [selectedFeed, selectedLiveSymbol]);

  function persistWatchlist(nextWatchlist: LiveWatchlist) {
    setWatchlists((current) =>
      current.map((watchlist) => watchlist.id === nextWatchlist.id ? sanitizeLiveWatchlist(nextWatchlist) : watchlist),
    );
  }

  function createWatchlist() {
    const id = `live-watchlist-${Date.now()}`;
    const nextWatchlist: LiveWatchlist = {
      id,
      name: `Watchlist ${watchlists.length + 1}`,
      symbols: [],
    };
    setWatchlists((current) => [...current, nextWatchlist]);
    setSelectedWatchlistId(id);
    setSelectedSymbolKey("");
  }

  function startWatchlistRename() {
    if (!selectedWatchlist) {
      return;
    }
    setWatchlistNameDraft(selectedWatchlist.name);
    setIsRenamingWatchlist(true);
  }

  function cancelWatchlistRename() {
    setWatchlistNameDraft(selectedWatchlist?.name ?? "");
    setIsRenamingWatchlist(false);
  }

  function saveWatchlistRename() {
    if (!selectedWatchlist) {
      return;
    }
    const trimmedName = watchlistNameDraft.trim();
    if (!trimmedName) {
      return;
    }
    persistWatchlist({
      ...selectedWatchlist,
      name: trimmedName,
    });
    setIsRenamingWatchlist(false);
  }

  async function deleteWatchlist() {
    if (!selectedWatchlist || watchlists.length <= 1) {
      return;
    }
    const confirmed = await confirm({
      confirmLabel: "Delete watchlist",
      detail: "Symbols inside this list are removed from the Live workspace only. No backtest or journal data is affected.",
      message: (
        <>
          Delete <span className="font-semibold text-white">{selectedWatchlist.name}</span>?
        </>
      ),
      title: "Delete live watchlist",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }
    const nextWatchlists = watchlists.filter((watchlist) => watchlist.id !== selectedWatchlist.id);
    setWatchlists(nextWatchlists);
    setSelectedWatchlistId(nextWatchlists[0]?.id ?? "");
  }

  function addSymbol(symbolOverride?: string) {
    if (!selectedWatchlist) {
      return;
    }
    const rawSymbol = symbolOverride?.trim() || symbolDraft.trim() || liveSearchTextForFeed(feedDraft, {
      angelone: angelOneSearch,
      binance: binanceSearch,
      dukascopy: dukascopySearch,
    }).trim();
    if (!rawSymbol) {
      setFeedError(liveProviderSelectionError(feedDraft));
      return;
    }
    const binanceInstrument = feedDraft === "binance" ? findBinanceInstrument(catalog.binance, rawSymbol) : null;
    const dukascopyInstrument = feedDraft === "dukascopy" ? findDukascopyInstrument(catalog.dukascopy, rawSymbol) : null;
    const angelOneInstrument = feedDraft === "angelone" ? findAngelOneInstrument(catalog.angelone, rawSymbol) : null;
    if (feedDraft === "binance" && !binanceInstrument) {
      setFeedError("Choose a Binance spot pair from the refreshed catalog. Use Global Settings to refresh the list if it is missing.");
      return;
    }
    if (feedDraft === "dukascopy" && !dukascopyInstrument) {
      setFeedError("Choose a Dukascopy instrument from the refreshed catalog. Use Global Settings to refresh the list if it is missing.");
      return;
    }
    if (feedDraft === "angelone" && !angelOneInstrument) {
      setFeedError("Choose an Angel One instrument from the refreshed catalog. Use Global Settings to refresh the list if it is missing.");
      return;
    }
    const nextSymbol = binanceInstrument
      ? liveWatchlistSymbol(binanceInstrument.symbol, {
        assetClass: binanceInstrument.assetClass,
        description: binanceInstrument.description,
        feed: "binance",
        label: binanceInstrument.label,
      })
      : dukascopyInstrument
      ? liveWatchlistSymbol(dukascopyInstrument.symbol, {
        assetClass: dukascopyInstrument.assetClass,
        description: dukascopyInstrument.description,
        feed: "dukascopy",
        label: dukascopyInstrument.label,
      })
      : angelOneInstrument
      ? liveWatchlistSymbol(angelOneInstrument.symbol, {
        assetClass: angelOneInstrument.assetClass,
        description: angelOneInstrument.description,
        exchange: angelOneInstrument.exchange,
        exchangeType: angelOneInstrument.exchangeType,
        feed: "angelone",
        instrumentType: angelOneInstrument.instrumentType,
        label: angelOneInstrument.label,
        token: angelOneInstrument.token,
      })
      : null;
    if (!nextSymbol) {
      return;
    }
    const nextSymbolKey = liveSymbolKey(nextSymbol);
    if (selectedWatchlist.symbols.some((item) => liveSymbolKey(item) === nextSymbolKey)) {
      setSelectedSymbolKey(nextSymbolKey);
      setSymbolDraft("");
      setBinanceSearch("");
      setDukascopySearch("");
      setAngelOneSearch("");
      return;
    }
    if (selectedWatchlist.symbols.length >= LIVE_MAX_WATCHLIST_SYMBOLS) {
      setFeedError(`A watchlist can hold up to ${LIVE_MAX_WATCHLIST_SYMBOLS} symbols.`);
      return;
    }
    persistWatchlist({
      ...selectedWatchlist,
      symbols: [...selectedWatchlist.symbols, nextSymbol],
    });
    setSelectedSymbolKey(nextSymbolKey);
    setSymbolDraft("");
    setBinanceSearch("");
    setDukascopySearch("");
    setAngelOneSearch("");
    setFeedError(null);
  }

  function removeSymbol(symbolKey: string) {
    if (!selectedWatchlist) {
      return;
    }
    persistWatchlist({
      ...selectedWatchlist,
      symbols: selectedWatchlist.symbols.filter((item) => liveSymbolKey(item) !== symbolKey),
    });
    if (selectedSymbolKey === symbolKey) {
      setSelectedSymbolKey(liveSymbolKey(selectedWatchlist.symbols.find((item) => liveSymbolKey(item) !== symbolKey) ?? selectedWatchlist.symbols[0]));
    }
  }

  return (
    <ChartWorkspaceFrame symbol={selectedLiveSymbol?.symbol ?? selectedSymbol} onChartFocus={focusJournalTrade}>
    <PageScaffold
      eyebrow="Live Markets"
      title="Live Chart Watchlists"
      description="Build watchlists and monitor Binance, Dukascopy, and Angel One SmartAPI markets in real time."
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className={`status-pill h-9 px-2 text-[11px] ${connectionStatus === "live" ? "text-emerald-100" : connectionStatus === "error" ? "text-rose-100" : ""}`}>
            {feedIssue === "stale" ? "Feed stale" : feedIssue === "delayed" ? "Feed delayed" : feedIssue === "unsupported" ? "Unsupported" : connectionStatus === "live" ? "Live feed" : connectionStatus === "connecting" ? "Connecting" : connectionStatus === "error" ? "Feed offline" : "No symbols"}
          </span>
        </div>
      }
    >
      <div className="grid gap-4 2xl:grid-cols-[minmax(360px,0.42fr)_minmax(0,0.58fr)]">
        <FeatureCard className="order-2 p-0 2xl:order-1">
          <div className="border-b border-white/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <CardLabel icon={Activity} label="Watchlist" />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <ThemedSelect
                    className="h-10 min-w-52"
                    onChange={setSelectedWatchlistId}
                    options={watchlists.map((watchlist) => ({ label: watchlist.name, value: watchlist.id }))}
                    value={selectedWatchlist?.id ?? ""}
                  />
                  <button aria-label="Create watchlist" className="icon-button h-10 w-10" onClick={createWatchlist} title="Create watchlist" type="button">
                    <Plus size={16} />
                  </button>
                  <button
                    className={`icon-button h-10 w-10 ${isRenamingWatchlist ? "border-cyan-300/35 bg-cyan-300/10 text-cyan-100" : ""}`}
                    disabled={!selectedWatchlist}
                    onClick={startWatchlistRename}
                    title="Rename watchlist"
                    type="button"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className="icon-button h-10 w-10 border-rose-300/20 text-rose-200 hover:bg-rose-300/10 hover:text-rose-100"
                    disabled={watchlists.length <= 1}
                    onClick={() => void deleteWatchlist()}
                    title="Delete watchlist"
                    type="button"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              <span className="status-pill h-8 px-2 text-[11px]">{selectedSourceLabel}</span>
            </div>
            {selectedWatchlist && isRenamingWatchlist && (
              <div className="mt-3 rounded-md border border-white/10 bg-black/20 p-3">
                <div className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                  Rename watchlist
                </div>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <input
                    ref={watchlistNameInputRef}
                    className="input-control h-10 normal-case tracking-normal"
                    onChange={(event) => setWatchlistNameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        saveWatchlistRename();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelWatchlistRename();
                      }
                    }}
                    value={watchlistNameDraft}
                  />
                  <button className="control-button h-10 px-3" onClick={cancelWatchlistRename} type="button">
                    <X size={14} />
                    Cancel
                  </button>
                  <button
                    className="control-button h-10 border-cyan-300/30 bg-cyan-300/10 px-3 text-cyan-100 hover:bg-cyan-300/20"
                    disabled={!watchlistNameDraft.trim()}
                    onClick={saveWatchlistRename}
                    type="button"
                  >
                    <Save size={14} />
                    Save
                  </button>
                </div>
              </div>
            )}
            <div className="mt-3 rounded-md border border-white/10 bg-black/20 p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex rounded-md border border-white/10 bg-black/20 p-1">
                  <TinyTab
                    active={feedDraft === "binance"}
                    onClick={() => {
                      setFeedDraft("binance");
                      setDukascopySearch("");
                      setAngelOneSearch("");
                      setBinanceSearch("");
                      setSymbolDraft("");
                    }}
                  >
                    Binance
                  </TinyTab>
                  <TinyTab
                    active={feedDraft === "dukascopy"}
                    onClick={() => {
                      setFeedDraft("dukascopy");
                      setBinanceSearch("");
                      setAngelOneSearch("");
                      setSymbolDraft("");
                    }}
                  >
                    Dukascopy
                  </TinyTab>
                  <TinyTab
                    active={feedDraft === "angelone"}
                    onClick={() => {
                      setFeedDraft("angelone");
                      setBinanceSearch("");
                      setDukascopySearch("");
                      setSymbolDraft("");
                    }}
                  >
                    Angel One
                  </TinyTab>
                </div>
                <span className="text-xs font-semibold text-slate-500">
                  {liveCatalogCountLabel(feedDraft, catalog)}
                </span>
              </div>

              {feedDraft === "angelone" && (
                <div className="mb-3 rounded-md border border-white/10 bg-black/20 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">SmartAPI credentials</div>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        Required for the live socket. Cleared when this page reloads.
                      </p>
                    </div>
                    <button
                      className="control-button h-8 px-2 text-xs"
                      onClick={() => setAngelOneCredentials(defaultAngelOneCredentials())}
                      type="button"
                    >
                      <X size={13} />
                      Clear
                    </button>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <input
                      className="input-control h-10 normal-case tracking-normal"
                      onChange={(event) => setAngelOneCredentials((current) => ({ ...current, clientCode: event.target.value }))}
                      placeholder="Client code"
                      value={angelOneCredentials.clientCode}
                    />
                    <input
                      className="input-control h-10 normal-case tracking-normal"
                      onChange={(event) => setAngelOneCredentials((current) => ({ ...current, apiKey: event.target.value }))}
                      placeholder="API key"
                      value={angelOneCredentials.apiKey}
                    />
                    <input
                      className="input-control h-10 normal-case tracking-normal"
                      onChange={(event) => setAngelOneCredentials((current) => ({ ...current, jwtToken: event.target.value }))}
                      placeholder="JWT token"
                      type="password"
                      value={angelOneCredentials.jwtToken}
                    />
                    <input
                      className="input-control h-10 normal-case tracking-normal"
                      onChange={(event) => setAngelOneCredentials((current) => ({ ...current, feedToken: event.target.value }))}
                      placeholder="Feed token"
                      type="password"
                      value={angelOneCredentials.feedToken}
                    />
                  </div>
                  <div className={`mt-3 text-xs font-semibold ${angelOneReady ? "text-emerald-200" : "text-amber-200"}`}>
                    {angelOneReady ? "Ready to connect Angel One SmartAPI feed." : "Fill all four fields before selecting Angel One symbols."}
                  </div>
                </div>
              )}

              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="relative">
                  {feedDraft === "binance" ? (
                    <>
                      <input
                        className="input-control h-10 normal-case tracking-normal"
                        onChange={(event) => {
                          setBinanceSearch(event.target.value);
                          setSymbolDraft("");
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            addSymbol(binanceSearchResults[0]?.symbol);
                          }
                        }}
                        placeholder="Search Binance, e.g. Bitcoin, BTC, USDT"
                        value={binanceSearch}
                      />
                      {binanceSearch.trim().length > 0 && binanceSearchResults.length > 0 && (
                        <LiveInstrumentSuggestionList>
                          {binanceSearchResults.map((instrument) => (
                            <button
                              className="flex w-full items-center justify-between gap-3 rounded px-2 py-2 text-left text-sm text-slate-300 transition hover:bg-white/5 hover:text-white"
                              key={instrument.symbol}
                              onClick={() => {
                                setSymbolDraft(instrument.symbol);
                                setBinanceSearch(`${instrument.label} · ${instrument.symbol}`);
                              }}
                              type="button"
                            >
                              <span className="min-w-0">
                                <span className="block truncate font-semibold text-white">{instrument.label}</span>
                                <span className="block truncate text-xs text-slate-500">{instrument.symbol} · {instrument.description}</span>
                              </span>
                              <span className="status-pill h-7 px-2 text-[10px]">{instrument.quoteAsset}</span>
                            </button>
                          ))}
                        </LiveInstrumentSuggestionList>
                      )}
                    </>
                  ) : feedDraft === "dukascopy" ? (
                    <>
                    <input
                      className="input-control h-10 normal-case tracking-normal"
                      onChange={(event) => {
                        setDukascopySearch(event.target.value);
                        setSymbolDraft("");
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addSymbol(dukascopySearchResults[0]?.symbol);
                        }
                      }}
                      placeholder="Search Dukascopy, e.g. EUR/USD, Gold, Apple"
                      value={dukascopySearch}
                    />
                    {dukascopySearch.trim().length > 0 && dukascopySearchResults.length > 0 && (
                      <LiveInstrumentSuggestionList>
                        {dukascopySearchResults.map((instrument) => (
                          <button
                            className="flex w-full items-center justify-between gap-3 rounded px-2 py-2 text-left text-sm text-slate-300 transition hover:bg-white/5 hover:text-white"
                            key={instrument.symbol}
                            onClick={() => {
                              setSymbolDraft(instrument.symbol);
                              setDukascopySearch(`${instrument.label} · ${instrument.description}`);
                            }}
                            type="button"
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-semibold text-white">{instrument.label}</span>
                              <span className="block truncate text-xs text-slate-500">{instrument.description}</span>
                            </span>
                            <span className="status-pill h-7 px-2 text-[10px] capitalize">{instrument.assetClass}</span>
                          </button>
                        ))}
                      </LiveInstrumentSuggestionList>
                    )}
                    </>
                  ) : (
                    <>
                      <input
                        className="input-control h-10 normal-case tracking-normal"
                        onChange={(event) => {
                          setAngelOneSearch(event.target.value);
                          setSymbolDraft("");
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            const first = angelOneSearchResults[0];
                            addSymbol(first ? `${first.exchangeType}:${first.token}` : undefined);
                          }
                        }}
                        placeholder="Search NSE, BSE, NFO, MCX, e.g. NIFTY, RELIANCE, SBIN"
                        value={angelOneSearch}
                      />
                      {angelOneSearch.trim().length > 0 && angelOneSearchResults.length > 0 && (
                        <LiveInstrumentSuggestionList>
                          {angelOneSearchResults.map((instrument) => (
                            <button
                              className="flex w-full items-center justify-between gap-3 rounded px-2 py-2 text-left text-sm text-slate-300 transition hover:bg-white/5 hover:text-white"
                              key={`${instrument.exchangeType}:${instrument.token}`}
                              onClick={() => {
                                setSymbolDraft(`${instrument.exchangeType}:${instrument.token}`);
                                setAngelOneSearch(`${instrument.label} · ${instrument.exchange}`);
                              }}
                              type="button"
                            >
                              <span className="min-w-0">
                                <span className="block truncate font-semibold text-white">{instrument.label}</span>
                                <span className="block truncate text-xs text-slate-500">{instrument.symbol} · {instrument.description}</span>
                              </span>
                              <span className="status-pill h-7 px-2 text-[10px]">{instrument.exchange}</span>
                            </button>
                          ))}
                        </LiveInstrumentSuggestionList>
                      )}
                    </>
                  )}
                </div>
                <button className="control-button workspace-tab-active h-10 justify-center" onClick={() => addSymbol()} type="button">
                  <Plus size={15} />
                  Add market
                </button>
              </div>

              {feedDraft === "binance" && binanceSearch.trim().length === 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {featuredBinanceInstruments(catalog.binance).slice(0, 8).map((instrument) => (
                    <button
                      className="status-pill h-8 px-2 text-[11px] transition hover:border-cyan-300/35 hover:text-cyan-100"
                      key={instrument.symbol}
                      onClick={() => {
                        setSymbolDraft(instrument.symbol);
                        setBinanceSearch(`${instrument.label} · ${instrument.symbol}`);
                      }}
                      type="button"
                    >
                      {instrument.label}
                    </button>
                  ))}
                </div>
              )}

              {feedDraft === "dukascopy" && dukascopySearch.trim().length === 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {featuredDukascopyInstruments(catalog.dukascopy).slice(0, 8).map((instrument) => (
                    <button
                      className="status-pill h-8 px-2 text-[11px] transition hover:border-cyan-300/35 hover:text-cyan-100"
                      key={instrument.symbol}
                      onClick={() => {
                        setSymbolDraft(instrument.symbol);
                        setDukascopySearch(`${instrument.label} · ${instrument.description}`);
                      }}
                      type="button"
                    >
                      {instrument.label}
                    </button>
                  ))}
                </div>
              )}

              {feedDraft === "angelone" && angelOneSearch.trim().length === 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {featuredAngelOneInstruments(catalog.angelone).slice(0, 9).map((instrument) => (
                    <button
                      className="status-pill h-8 px-2 text-[11px] transition hover:border-cyan-300/35 hover:text-cyan-100"
                      key={`${instrument.exchangeType}:${instrument.token}`}
                      onClick={() => {
                        setSymbolDraft(`${instrument.exchangeType}:${instrument.token}`);
                        setAngelOneSearch(`${instrument.label} · ${instrument.exchange}`);
                      }}
                      type="button"
                    >
                      {instrument.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="overflow-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-white/10 text-xs uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Symbol</th>
                  <th className="px-3 py-3 text-right font-medium">Last</th>
                  <th className="px-3 py-3 text-right font-medium">Chg</th>
                  <th className="px-3 py-3 text-right font-medium">Chg%</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {symbols.map((item) => {
                  const itemKey = liveSymbolKey(item);
                  const ticker = tickers[itemKey];
                  const active = itemKey === selectedSymbolKey;
                  return (
                    <tr
                      className={`cursor-pointer border-b border-white/10 text-slate-300 transition hover:bg-white/5 ${active ? "bg-cyan-300/10 ring-1 ring-inset ring-cyan-300/30" : ""}`}
                      key={itemKey}
                      onClick={() => setSelectedSymbolKey(itemKey)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <span
                            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[10px] font-black text-white"
                            style={{ backgroundColor: item.color }}
                          >
                            {liveSymbolMonogram(item)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-base font-semibold text-white">{item.label}</span>
                            <span className="block truncate text-xs text-slate-500">
                              {liveFeedLabel(item.feed)} · {liveAssetClassLabel(item)}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right text-lg font-semibold tabular-nums text-slate-100">
                        {ticker ? formatLivePrice(ticker.last) : "--"}
                      </td>
                      <td className={`px-3 py-3 text-right text-lg font-semibold tabular-nums ${toneForNumber(ticker?.change ?? 0)}`}>
                        {ticker ? signedLiveNumber(ticker.change) : "--"}
                      </td>
                      <td className={`px-3 py-3 text-right text-lg font-semibold tabular-nums ${toneForNumber(ticker?.changePercent ?? 0)}`}>
                        {ticker ? `${signedLiveNumber(ticker.changePercent)}%` : "--"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          className="icon-button h-8 w-8 border-rose-300/20 text-rose-200 hover:bg-rose-300/10 hover:text-rose-100"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeSymbol(itemKey);
                          }}
                          title="Remove symbol"
                          type="button"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {symbols.length === 0 && (
                  <tr>
                    <td className="px-4 py-10 text-center text-sm text-slate-500" colSpan={5}>
                      Add a Binance, Dukascopy, or Angel One market to start this watchlist.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </FeatureCard>

        <div className="order-1 grid min-w-0 gap-4 2xl:order-2">
          <FeatureCard className="overflow-hidden p-0">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-xl font-semibold text-white">{selectedLiveSymbol?.label || selectedSymbol || "No symbol selected"}</h2>
                  <span className="status-pill h-7 px-2 text-[10px]">{selectedSourceLabel}</span>
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedFeed === "binance"
                    ? "Live candlesticks and 24h ticker from Binance public market data."
                    : selectedFeed === "dukascopy"
                      ? "Dukascopy cross-asset candles for forex, commodities, indices, equities, and ETFs."
                      : "Angel One SmartAPI stream for Indian equities, indices, derivatives, commodities, and currency markets."}
                </p>
              </div>
              <div className={`text-right text-2xl font-semibold tabular-nums ${toneForNumber(selectedTicker?.change ?? 0)}`}>
                {selectedTicker ? `${formatLivePrice(selectedTicker.last)}${feedIssue ? " · last verified" : ""}` : "--"}
              </div>
            </div>
            <div className="px-4 pt-3">
              <LiveFeedHealthSurface
                connectionStatus={connectionStatus}
                feedError={feedError}
                onChooseProvider={() => window.location.assign("/app/settings/data-providers#settings/data-providers/broker-connections")}
                onIssueChange={setFeedIssue}
                onRetry={() => window.location.reload()}
                sourceLabel={selectedSourceLabel}
                tickerUpdatedAt={selectedTicker?.updatedAt}
              />
            </div>
            <LiveChartStudio
              bars={liveBars}
              connectionStatus={connectionStatus}
              feedIssue={feedIssue}
              journalChartFocus={activeJournalFocus}
              selectedSourceLabel={selectedSourceLabel}
              symbol={selectedLiveSymbol?.label ?? selectedSymbol}
              symbolCode={selectedLiveSymbol?.symbol ?? selectedSymbol}
              tickerChangeLabel={selectedTicker ? `${signedLiveNumber(selectedTicker.changePercent)}% 24h` : selectedSourceLabel}
            />
          </FeatureCard>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ResultMetricCard icon={BadgeDollarSign} label={feedIssue ? "Last verified price" : "Last price"} value={selectedTicker ? formatLivePrice(selectedTicker.last) : "--"} tone={toneForNumber(selectedTicker?.change ?? 0)} />
            <ResultMetricCard icon={TrendingUp} label={selectedFeed === "binance" ? "24h high" : "Range high"} value={selectedTicker && !feedIssue ? formatLivePrice(selectedTicker.high) : "--"} />
            <ResultMetricCard icon={TrendingDown} label={selectedFeed === "binance" ? "24h low" : "Range low"} value={selectedTicker && !feedIssue ? formatLivePrice(selectedTicker.low) : "--"} />
            <ResultMetricCard icon={BarChart3} label={selectedFeed === "binance" ? "Quote volume" : "Volume"} value={selectedTicker && !feedIssue ? formatCompactNumber(selectedFeed === "binance" ? selectedTicker.quoteVolume : selectedTicker.volume) : "--"} />
          </div>

          {feedError && (
            <div className="rounded-md border border-rose-300/20 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">
              {feedError}
            </div>
          )}
        </div>
      </div>
      {confirmDialog}
    </PageScaffold>
    </ChartWorkspaceFrame>
  );
}

type PositionRiskMode = "percent" | "money";

type PositionInstrumentProfile = {
  assetClass: string;
  base: string;
  contractSize: number;
  defaultPrice: number;
  label: string;
  pipSize: number;
  quote: string;
  symbol: string;
};

const POSITION_INSTRUMENT_PROFILES: PositionInstrumentProfile[] = [
  { assetClass: "FX Major", base: "EUR", contractSize: 100000, defaultPrice: 1.08, label: "EUR/USD", pipSize: 0.0001, quote: "USD", symbol: "EURUSD" },
  { assetClass: "FX Major", base: "GBP", contractSize: 100000, defaultPrice: 1.25, label: "GBP/USD", pipSize: 0.0001, quote: "USD", symbol: "GBPUSD" },
  { assetClass: "FX Major", base: "USD", contractSize: 100000, defaultPrice: 155, label: "USD/JPY", pipSize: 0.01, quote: "JPY", symbol: "USDJPY" },
  { assetClass: "FX Major", base: "USD", contractSize: 100000, defaultPrice: 1.37, label: "USD/CAD", pipSize: 0.0001, quote: "CAD", symbol: "USDCAD" },
  { assetClass: "FX Major", base: "USD", contractSize: 100000, defaultPrice: 0.91, label: "USD/CHF", pipSize: 0.0001, quote: "CHF", symbol: "USDCHF" },
  { assetClass: "FX Major", base: "AUD", contractSize: 100000, defaultPrice: 0.66, label: "AUD/USD", pipSize: 0.0001, quote: "USD", symbol: "AUDUSD" },
  { assetClass: "FX Major", base: "NZD", contractSize: 100000, defaultPrice: 0.6, label: "NZD/USD", pipSize: 0.0001, quote: "USD", symbol: "NZDUSD" },
  { assetClass: "FX Cross", base: "EUR", contractSize: 100000, defaultPrice: 0.86, label: "EUR/GBP", pipSize: 0.0001, quote: "GBP", symbol: "EURGBP" },
  { assetClass: "FX Cross", base: "EUR", contractSize: 100000, defaultPrice: 168, label: "EUR/JPY", pipSize: 0.01, quote: "JPY", symbol: "EURJPY" },
  { assetClass: "FX Cross", base: "GBP", contractSize: 100000, defaultPrice: 194, label: "GBP/JPY", pipSize: 0.01, quote: "JPY", symbol: "GBPJPY" },
  { assetClass: "FX Cross", base: "AUD", contractSize: 100000, defaultPrice: 102, label: "AUD/JPY", pipSize: 0.01, quote: "JPY", symbol: "AUDJPY" },
  { assetClass: "FX Cross", base: "EUR", contractSize: 100000, defaultPrice: 1.64, label: "EUR/AUD", pipSize: 0.0001, quote: "AUD", symbol: "EURAUD" },
  { assetClass: "FX Cross", base: "EUR", contractSize: 100000, defaultPrice: 1.47, label: "EUR/CAD", pipSize: 0.0001, quote: "CAD", symbol: "EURCAD" },
  { assetClass: "FX Cross", base: "GBP", contractSize: 100000, defaultPrice: 1.9, label: "GBP/AUD", pipSize: 0.0001, quote: "AUD", symbol: "GBPAUD" },
  { assetClass: "FX Cross", base: "CAD", contractSize: 100000, defaultPrice: 113, label: "CAD/JPY", pipSize: 0.01, quote: "JPY", symbol: "CADJPY" },
  { assetClass: "Metal", base: "XAU", contractSize: 100, defaultPrice: 2350, label: "XAU/USD", pipSize: 0.01, quote: "USD", symbol: "XAUUSD" },
  { assetClass: "Metal", base: "XAG", contractSize: 5000, defaultPrice: 28, label: "XAG/USD", pipSize: 0.001, quote: "USD", symbol: "XAGUSD" },
  { assetClass: "CFD", base: "NAS", contractSize: 1, defaultPrice: 18000, label: "NAS100", pipSize: 1, quote: "USD", symbol: "NAS100" },
  { assetClass: "CFD", base: "SPX", contractSize: 1, defaultPrice: 5200, label: "SPX500", pipSize: 1, quote: "USD", symbol: "SPX500" },
  { assetClass: "CFD", base: "US30", contractSize: 1, defaultPrice: 39000, label: "US30", pipSize: 1, quote: "USD", symbol: "US30" },
  { assetClass: "Custom", base: "", contractSize: 100000, defaultPrice: 1, label: "Custom symbol", pipSize: 0.0001, quote: "USD", symbol: "CUSTOM" },
];

const POSITION_INSTRUMENT_OPTIONS = POSITION_INSTRUMENT_PROFILES.map((profile) => ({
  label: profile.label,
  sublabel: `${profile.assetClass} · ${profile.contractSize.toLocaleString()} units · pip ${profile.pipSize}`,
  value: profile.symbol,
}));

const POSITION_RISK_PRESETS = ["0.25", "0.5", "1", "1.5", "2"];

function PositionSizeCalculatorPage() {
  const defaultProfile = POSITION_INSTRUMENT_PROFILES[0];
  const [instrumentSymbol, setInstrumentSymbol] = useState(defaultProfile.symbol);
  const [accountCurrency, setAccountCurrency] = useState("USD");
  const [accountSize, setAccountSize] = useState("10000");
  const [riskMode, setRiskMode] = useState<PositionRiskMode>("percent");
  const [riskPercent, setRiskPercent] = useState("1");
  const [riskAmount, setRiskAmount] = useState("100");
  const [stopLossPips, setStopLossPips] = useState("20");
  const [entryPrice, setEntryPrice] = useState(formatPositionDecimal(defaultProfile.defaultPrice, 5));
  const [contractSize, setContractSize] = useState(formatPositionDecimal(defaultProfile.contractSize, 0));
  const [pipSize, setPipSize] = useState(formatPositionDecimal(defaultProfile.pipSize, 5));
  const [quoteCurrency, setQuoteCurrency] = useState(defaultProfile.quote);
  const [conversionRate, setConversionRate] = useState("1");
  const [conversionTouched, setConversionTouched] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");

  const selectedProfile = POSITION_INSTRUMENT_PROFILES.find((profile) => profile.symbol === instrumentSymbol) ?? defaultProfile;
  const accountBalance = positivePositionNumber(accountSize);
  const riskAmountValue =
    riskMode === "money"
      ? positivePositionNumber(riskAmount)
      : (accountBalance * positivePositionNumber(riskPercent)) / 100;
  const riskPercentValue = accountBalance > 0 ? (riskAmountValue / accountBalance) * 100 : 0;
  const stopLossValue = positivePositionNumber(stopLossPips);
  const entryPriceValue = positivePositionNumber(entryPrice);
  const contractSizeValue = positivePositionNumber(contractSize);
  const pipSizeValue = positivePositionNumber(pipSize);
  const conversionRateValue = positivePositionNumber(conversionRate);
  const pipValuePerLot = contractSizeValue * pipSizeValue * conversionRateValue;
  const stopValuePerLot = stopLossValue * pipValuePerLot;
  const lots = stopValuePerLot > 0 ? riskAmountValue / stopValuePerLot : 0;
  const units = lots * contractSizeValue;
  const notionalQuote = units * entryPriceValue;
  const notionalAccount = notionalQuote * conversionRateValue;
  const isValidSize = riskAmountValue > 0 && stopValuePerLot > 0 && Number.isFinite(lots);
  const inferredConversion = inferPositionConversionRate({
    accountCurrency,
    entryPrice: entryPriceValue,
    profile: selectedProfile,
    quoteCurrency,
  });
  const riskTone = positionRiskTone(riskPercentValue);
  const riskLevel = positionRiskLevel(riskPercentValue);
  const riskHeatWidth = Math.min(100, Math.max(3, riskPercentValue * 20));

  useEffect(() => {
    const profile = POSITION_INSTRUMENT_PROFILES.find((item) => item.symbol === instrumentSymbol) ?? defaultProfile;
    setEntryPrice(formatPositionDecimal(profile.defaultPrice, 5));
    setContractSize(formatPositionDecimal(profile.contractSize, 0));
    setPipSize(formatPositionDecimal(profile.pipSize, 5));
    setQuoteCurrency(profile.quote);
    setConversionTouched(false);
  }, [defaultProfile, instrumentSymbol]);

  useEffect(() => {
    if (!conversionTouched) {
      setConversionRate(formatPositionDecimal(inferredConversion, 6));
    }
  }, [conversionTouched, inferredConversion]);

  useEffect(() => {
    if (riskMode === "percent") {
      setRiskAmount(formatPositionDecimal((accountBalance * positivePositionNumber(riskPercent)) / 100, 2));
    }
  }, [accountBalance, riskMode, riskPercent]);

  useEffect(() => {
    if (riskMode === "money") {
      setRiskPercent(formatPositionDecimal(accountBalance > 0 ? (positivePositionNumber(riskAmount) / accountBalance) * 100 : 0, 3));
    }
  }, [accountBalance, riskAmount, riskMode]);

  function resetCalculator() {
    setInstrumentSymbol(defaultProfile.symbol);
    setAccountCurrency("USD");
    setAccountSize("10000");
    setRiskMode("percent");
    setRiskPercent("1");
    setRiskAmount("100");
    setStopLossPips("20");
    setConversionTouched(false);
    setCopyStatus("");
  }

  async function copyPositionBrief() {
    if (!isValidSize) {
      return;
    }
    const lines = [
      `Position size: ${formatPositionLots(lots)} lots (${formatWholeNumber(units)} units)`,
      `Instrument: ${selectedProfile.label}`,
      `Account risk: ${formatMoney(riskAmountValue, accountCurrency)} (${formatPositionDecimal(riskPercentValue, 2)}%)`,
      `Stop: ${formatPositionDecimal(stopLossValue, 2)} pips`,
      `Pip value per lot: ${formatMoney(pipValuePerLot, accountCurrency)}`,
      `Quote-to-account rate: ${formatPositionDecimal(conversionRateValue, 6)}`,
    ];
    await copyTextToClipboard(lines.join("\n"));
    setCopyStatus("Copied");
    window.setTimeout(() => setCopyStatus(""), 1600);
  }

  return (
    <PageScaffold
      eyebrow="Risk Tools"
      title="Position Size Calculator"
      description="Calculate trade size from account risk, stop distance, contract size, and quote-to-account conversion."
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="status-pill h-9 px-2 text-[11px]">Myfxbook-style sizing</span>
          <button className="control-button h-9" onClick={resetCalculator} type="button">
            <RefreshCw size={15} />
            Reset
          </button>
        </div>
      }
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ResultMetricCard icon={Calculator} label="Recommended size" tone="text-cyan-100" value={isValidSize ? `${formatPositionLots(lots)} lots` : "-"} />
        <ResultMetricCard icon={WalletCards} label="Units" value={isValidSize ? formatWholeNumber(units) : "-"} />
        <ResultMetricCard icon={BadgeDollarSign} label="Risk amount" tone={riskTone} value={formatMoney(riskAmountValue, accountCurrency)} />
        <ResultMetricCard icon={Gauge} label="Per pip / lot" value={pipValuePerLot > 0 ? formatMoney(pipValuePerLot, accountCurrency) : "-"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.62fr)_minmax(340px,0.38fr)]">
        <FeatureCard className="overflow-visible">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardLabel icon={SlidersHorizontal} label="Sizing console" />
              <div className="mt-1 text-xs text-slate-500">{selectedProfile.assetClass} · {selectedProfile.base || "Custom"} / {quoteCurrency}</div>
            </div>
            <ReportSegmentedTabs
              active={riskMode}
              onChange={setRiskMode}
              options={[
                { label: "Risk %", value: "percent" },
                { label: "Fixed risk", value: "money" },
              ]}
            />
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(220px,1.3fr)_minmax(130px,0.7fr)_minmax(130px,0.7fr)]">
            <label className="grid gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Instrument</span>
              <ThemedSelect
                ariaLabel="Instrument"
                className="h-10"
                onChange={setInstrumentSymbol}
                options={POSITION_INSTRUMENT_OPTIONS}
                portal
                value={instrumentSymbol}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Account ccy</span>
              <ThemedSelect
                ariaLabel="Account currency"
                className="h-10"
                onChange={(value) => {
                  setAccountCurrency(value);
                  setConversionTouched(false);
                }}
                options={selectOptionsWithValue(CURRENCY_OPTIONS, accountCurrency)}
                portal
                value={accountCurrency}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Quote ccy</span>
              <ThemedSelect
                ariaLabel="Quote currency"
                className="h-10"
                onChange={(value) => {
                  setQuoteCurrency(value);
                  setConversionTouched(false);
                }}
                options={selectOptionsWithValue(CURRENCY_OPTIONS, quoteCurrency)}
                portal
                value={quoteCurrency}
              />
            </label>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <PositionNumberField label="Account size" onChange={setAccountSize} value={accountSize} />
            <PositionNumberField
              label="Risk %"
              onChange={(value) => {
                setRiskMode("percent");
                setRiskPercent(value);
              }}
              suffix="%"
              value={riskPercent}
            />
            <PositionNumberField
              label="Risk amount"
              onChange={(value) => {
                setRiskMode("money");
                setRiskAmount(value);
              }}
              value={riskAmount}
            />
            <PositionNumberField label="Stop pips" onChange={setStopLossPips} value={stopLossPips} />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {POSITION_RISK_PRESETS.map((preset) => (
              <button
                className={`control-button h-8 px-2 text-xs ${riskMode === "percent" && riskPercent === preset ? "workspace-tab-active" : ""}`}
                key={preset}
                onClick={() => {
                  setRiskMode("percent");
                  setRiskPercent(preset);
                }}
                type="button"
              >
                {preset}%
              </button>
            ))}
          </div>

          <div className="mt-5 border-t border-white/10 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardLabel icon={Settings} label="Contract model" />
              <span className={`status-pill h-8 px-2 text-[11px] ${conversionTouched ? "text-amber-100" : "text-emerald-100"}`}>
                {conversionTouched ? "Manual conversion" : "Auto conversion"}
              </span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <PositionNumberField label="Entry price" onChange={setEntryPrice} value={entryPrice} />
              <PositionNumberField label="Contract units" onChange={setContractSize} value={contractSize} />
              <PositionNumberField label="Pip size" onChange={setPipSize} value={pipSize} />
              <label className="grid gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Quote to account</span>
                <div className="flex gap-2">
                  <input
                    className="input-control h-10 normal-case tracking-normal"
                    min="0"
                    onChange={(event) => {
                      setConversionTouched(true);
                      setConversionRate(event.target.value);
                    }}
                    step="any"
                    type="number"
                    value={conversionRate}
                  />
                  <button
                    className="control-button h-10 px-2"
                    onClick={() => {
                      setConversionTouched(false);
                      setConversionRate(formatPositionDecimal(inferredConversion, 6));
                    }}
                    title="Reset conversion"
                    type="button"
                  >
                    <RefreshCw size={14} />
                  </button>
                </div>
              </label>
            </div>
          </div>
        </FeatureCard>

        <FeatureCard className="overflow-hidden p-0">
          <div className="border-b border-white/10 p-4">
            <CardLabel icon={Calculator} label="Execution size" />
            <div className="mt-5 rounded-md border border-cyan-300/15 bg-cyan-300/[0.06] p-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-200/80">Standard lots</div>
              <div className="mt-2 text-5xl font-semibold tabular-nums text-white">{isValidSize ? formatPositionLots(lots) : "-"}</div>
              <div className="mt-2 text-sm text-slate-500">{isValidSize ? `${formatWholeNumber(units)} units on ${selectedProfile.label}` : "Enter risk, stop, and contract values"}</div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <MiniMetric label="Mini lots" value={isValidSize ? formatPositionLots(lots * 10) : "-"} />
              <MiniMetric label="Micro lots" value={isValidSize ? formatPositionLots(lots * 100) : "-"} />
              <MiniMetric label="Stop value / lot" value={stopValuePerLot > 0 ? formatMoney(stopValuePerLot, accountCurrency) : "-"} />
              <MiniMetric label="Exposure" value={notionalAccount > 0 ? formatCompactMoney(notionalAccount, accountCurrency) : "-"} />
            </div>
          </div>

          <div className="p-4">
            <div className="flex items-center justify-between gap-3">
              <CardLabel icon={Gauge} label="Risk heat" />
              <span className={`text-sm font-semibold tabular-nums ${riskTone}`}>{riskLevel} · {formatPositionDecimal(riskPercentValue, 2)}%</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
              <div aria-label="Risk heat" aria-valuemax={5} aria-valuemin={0} aria-valuenow={Math.min(5, riskPercentValue)} aria-valuetext={`${riskLevel}, ${formatPositionDecimal(riskPercentValue, 2)} percent`} className={`h-full rounded-full ${positionRiskBarClass(riskPercentValue)}`} role="progressbar" style={{ width: `${riskHeatWidth}%` }} />
            </div>
            <div className="mt-4 grid gap-2">
              {[
                ["Risk", formatMoney(riskAmountValue, accountCurrency), riskTone],
                ["Pip value", pipValuePerLot > 0 ? formatMoney(pipValuePerLot, accountCurrency) : "-", "text-slate-100"],
                ["Conversion", formatPositionDecimal(conversionRateValue, 6), conversionTouched ? "text-amber-200" : "text-emerald-200"],
                ["Notional", notionalAccount > 0 ? formatCompactMoney(notionalAccount, accountCurrency) : "-", "text-slate-100"],
              ].map(([label, value, tone]) => (
                <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-black/20 px-3 py-2" key={label}>
                  <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{label}</span>
                  <span className={`text-sm font-semibold tabular-nums ${tone}`}>{value}</span>
                </div>
              ))}
            </div>
            <button className="control-button workspace-tab-active mt-4 w-full justify-center" disabled={!isValidSize} onClick={() => void copyPositionBrief()} type="button">
              <Copy size={15} />
              {copyStatus || "Copy execution brief"}
            </button>
          </div>
        </FeatureCard>
      </div>

      <FeatureCard className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div>
            <CardLabel icon={List} label="Lot ladder" />
            <div className="mt-1 text-xs text-slate-500">Same risk budget expressed across common execution units</div>
          </div>
          <span className="status-pill h-8 px-2 text-[11px]">{accountCurrency} account</span>
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Unit</th>
                <th className="px-4 py-3 font-medium">Quantity</th>
                <th className="px-4 py-3 font-medium">Pip value</th>
                <th className="px-4 py-3 font-medium">Risk at stop</th>
                <th className="px-4 py-3 font-medium">Notional</th>
              </tr>
            </thead>
            <tbody>
              {buildPositionLadderRows({
                accountCurrency,
                conversionRate: conversionRateValue,
                contractSize: contractSizeValue,
                entryPrice: entryPriceValue,
                lots,
                pipSize: pipSizeValue,
                stopLossPips: stopLossValue,
              }).map((row) => (
                <tr className="border-t border-white/10 text-slate-300" key={row.label}>
                  <td className="px-4 py-3 font-semibold text-white">{row.label}</td>
                  <td className="px-4 py-3 tabular-nums">{row.quantity}</td>
                  <td className="px-4 py-3 tabular-nums">{row.pipValue}</td>
                  <td className="px-4 py-3 tabular-nums">{row.riskAtStop}</td>
                  <td className="px-4 py-3 tabular-nums">{row.notional}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </FeatureCard>
    </PageScaffold>
  );
}

function PositionNumberField({
  label,
  onChange,
  suffix,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  suffix?: string;
  value: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{label}</span>
      <div className="relative">
        <input
          className={`input-control h-10 normal-case tracking-normal ${suffix ? "pr-9" : ""}`}
          min="0"
          onChange={(event) => onChange(event.target.value)}
          step="any"
          type="number"
          value={value}
        />
        {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">{suffix}</span>}
      </div>
    </label>
  );
}

function positivePositionNumber(value: string) {
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatPositionDecimal(value: number, maximumFractionDigits = 4) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return Number(value.toFixed(maximumFractionDigits)).toString();
}

function formatPositionLots(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "-";
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value < 1 ? 3 : 2,
    minimumFractionDigits: value < 1 ? 3 : 2,
  }).format(value);
}

function formatWholeNumber(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "-";
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function inferPositionConversionRate({
  accountCurrency,
  entryPrice,
  profile,
  quoteCurrency,
}: {
  accountCurrency: string;
  entryPrice: number;
  profile: PositionInstrumentProfile;
  quoteCurrency: string;
}) {
  if (quoteCurrency === accountCurrency) {
    return 1;
  }
  if (profile.base === accountCurrency && entryPrice > 0) {
    return 1 / entryPrice;
  }
  return 1;
}

function positionRiskTone(value: number) {
  if (value >= 3) {
    return "text-rose-300";
  }
  if (value >= 1.5) {
    return "text-amber-200";
  }
  return "text-emerald-300";
}

function positionRiskLevel(value: number) {
  if (value >= 3) return "High risk";
  if (value >= 1.5) return "Moderate risk";
  return "Low risk";
}

function positionRiskBarClass(value: number) {
  if (value >= 3) {
    return "bg-rose-300";
  }
  if (value >= 1.5) {
    return "bg-amber-300";
  }
  return "bg-emerald-300";
}

function buildPositionLadderRows({
  accountCurrency,
  conversionRate,
  contractSize,
  entryPrice,
  lots,
  pipSize,
  stopLossPips,
}: {
  accountCurrency: string;
  conversionRate: number;
  contractSize: number;
  entryPrice: number;
  lots: number;
  pipSize: number;
  stopLossPips: number;
}) {
  const normalizedLots = Number.isFinite(lots) && lots > 0 ? lots : 0;
  const rows = [
    { label: "Standard lots", multiplier: normalizedLots },
    { label: "Mini lots", multiplier: normalizedLots * 10 },
    { label: "Micro lots", multiplier: normalizedLots * 100 },
    { label: "Units", multiplier: normalizedLots * contractSize },
  ];
  return rows.map((row) => {
    const rowLots =
      row.label === "Mini lots"
        ? row.multiplier / 10
        : row.label === "Micro lots"
          ? row.multiplier / 100
          : row.label === "Units"
            ? row.multiplier / contractSize
            : row.multiplier;
    const rowUnits = rowLots * contractSize;
    const pipValue = rowLots * contractSize * pipSize * conversionRate;
    const riskAtStop = pipValue * stopLossPips;
    const notional = rowUnits * entryPrice * conversionRate;
    return {
      label: row.label,
      notional: notional > 0 ? formatCompactMoney(notional, accountCurrency) : "-",
      pipValue: pipValue > 0 ? formatMoney(pipValue, accountCurrency) : "-",
      quantity: row.label === "Units" ? formatWholeNumber(row.multiplier) : formatPositionLots(row.multiplier),
      riskAtStop: riskAtStop > 0 ? formatMoney(riskAtStop, accountCurrency) : "-",
    };
  });
}

const ECONOMIC_IMPACT_FILTERS = [
  { label: "All impact", value: "ALL" },
  { label: "High", value: "High" },
  { label: "Medium", value: "Medium" },
  { label: "Low", value: "Low" },
  { label: "Holiday", value: "Holiday" },
];
const ECONOMIC_EVENT_TYPE_FILTERS = [
  { label: "All event types", value: "ALL" },
  { label: "Growth", value: "Growth" },
  { label: "Inflation", value: "Inflation" },
  { label: "Employment", value: "Employment" },
  { label: "Central Bank", value: "Central Bank" },
  { label: "Housing", value: "Housing" },
  { label: "Consumer", value: "Consumer" },
  { label: "Business", value: "Business" },
  { label: "Bonds", value: "Bonds" },
  { label: "Speeches", value: "Speeches" },
  { label: "Misc", value: "Misc" },
];

function EconomicCalendarPage() {
  const [calendar, setCalendar] = useState<EconomicCalendarResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [impactFilter, setImpactFilter] = useState("ALL");
  const [currencyFilter, setCurrencyFilter] = useState("ALL");
  const [dayFilter, setDayFilter] = useState("ALL");
  const [eventTypeFilter, setEventTypeFilter] = useState("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [detailEvent, setDetailEvent] = useState<EconomicCalendarEvent | null>(null);
  const [graphEvent, setGraphEvent] = useState<EconomicCalendarEvent | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  async function loadCalendar(refresh = false) {
    const nextCalendar = await getForexFactoryCalendar(refresh);
    if (isMountedRef.current) {
      setCalendar(nextCalendar);
      setError(null);
    }
    return nextCalendar;
  }

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    void loadCalendar(false)
      .then(() => {
        if (cancelled) {
          return;
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          setError(importErrorMessage(requestError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!calendar) {
      return;
    }
    const refreshAt = Date.parse(calendar.cache_expires_at);
    if (!Number.isFinite(refreshAt)) {
      return;
    }
    const delayMs = Math.max(5_000, refreshAt - Date.now());
    const timer = window.setTimeout(() => {
      void loadCalendar(false).catch((requestError) => {
        setError(importErrorMessage(requestError));
      });
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [calendar?.cache_expires_at]);

  useEffect(() => {
    function refreshIfExpired() {
      if (!calendar || !economicCalendarIsExpired(calendar)) {
        return;
      }
      void loadCalendar(false).catch((requestError) => {
        setError(importErrorMessage(requestError));
      });
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        refreshIfExpired();
      }
    }

    window.addEventListener("focus", refreshIfExpired);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", refreshIfExpired);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [calendar]);

  useEffect(() => {
    if (!detailEvent || !calendar) {
      return;
    }
    const nextDetailEvent = findMatchingEconomicEvent(calendar.events, detailEvent);
    if (nextDetailEvent && nextDetailEvent !== detailEvent) {
      setDetailEvent(nextDetailEvent);
    }
  }, [calendar, detailEvent]);

  useEffect(() => {
    if (!graphEvent || !calendar) {
      return;
    }
    const nextGraphEvent = findMatchingEconomicEvent(calendar.events, graphEvent);
    if (nextGraphEvent && nextGraphEvent !== graphEvent) {
      setGraphEvent(nextGraphEvent);
    }
  }, [calendar, graphEvent]);

  const events = calendar?.events ?? [];
  const currencyOptions = useMemo(() => buildEconomicCurrencyOptions(events), [events]);
  const dayOptions = useMemo(() => buildEconomicDayOptions(events), [events]);
  const filteredEvents = useMemo(
    () =>
      events.filter((event) =>
        economicEventMatchesFilters(event, {
          currency: currencyFilter,
          day: dayFilter,
          eventType: eventTypeFilter,
          impact: impactFilter,
          search: searchTerm,
        }),
      ),
    [currencyFilter, dayFilter, eventTypeFilter, events, impactFilter, searchTerm],
  );
  const groupedEvents = useMemo(() => groupEconomicEventsByDay(filteredEvents), [filteredEvents]);
  const highImpactCount = events.filter((event) => normalizeEconomicImpact(event.impact) === "High").length;
  const upcomingEvent = useMemo(() => nextEconomicEvent(events), [events]);
  const currenciesInScope = new Set(events.map((event) => event.currency)).size;
  const lastUpdated = calendar ? formatDateTime(calendar.updated_at) : "—";
  const cacheStatus = calendar?.stale ? "Stale cache" : calendar ? "Cached feed" : "Waiting";

  async function refreshCalendar() {
    setIsRefreshing(true);
    try {
      await loadCalendar(true);
    } catch (requestError) {
      if (isMountedRef.current) {
        setError(importErrorMessage(requestError));
      }
    } finally {
      if (isMountedRef.current) {
        setIsRefreshing(false);
        setIsLoading(false);
      }
    }
  }

  return (
    <PageScaffold
      eyebrow="Economic Calendar"
      title="Forex Factory Calendar"
      description="Track scheduled macro events, impact level, and consensus values alongside your live markets."
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className={`status-pill h-9 px-2 text-[11px] ${calendar?.stale ? "text-amber-100" : "text-emerald-100"}`}>
            {cacheStatus}
          </span>
          <button className="control-button h-9" disabled={isRefreshing} onClick={() => void refreshCalendar()} type="button">
            <RefreshCw className={isRefreshing ? "animate-spin" : ""} size={15} />
            Refresh
          </button>
        </div>
      }
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ResultMetricCard icon={CalendarDays} label="Events" value={isLoading ? "Loading" : String(events.length)} />
        <ResultMetricCard icon={Gauge} label="High impact" tone={highImpactCount > 0 ? "text-rose-200" : "text-slate-100"} value={String(highImpactCount)} />
        <ResultMetricCard icon={Globe2} label="Currencies" value={String(currenciesInScope)} />
        <ResultMetricCard icon={Clock3} label="Next event" value={upcomingEvent ? economicEventTimeLabel(upcomingEvent.starts_at) : "—"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.68fr)_minmax(320px,0.32fr)]">
        <FeatureCard className="overflow-hidden p-0">
          <div className="border-b border-white/10 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardLabel icon={CalendarDays} label="Macro schedule" />
                <div className="mt-1 text-xs text-slate-500">
                  Updated {lastUpdated}
                </div>
              </div>
              <span className="status-pill h-8 px-2 text-[11px]">
                {filteredEvents.length} visible
              </span>
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-2 2xl:grid-cols-[minmax(180px,1fr)_150px_150px_150px_170px]">
              <label className="relative min-w-0">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={15} />
                <input
                  className="input-control h-10 pl-9 normal-case tracking-normal"
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search event, currency, forecast"
                  value={searchTerm}
                />
              </label>
              <ThemedSelect
                className="h-10"
                onChange={setCurrencyFilter}
                options={currencyOptions}
                value={currencyFilter}
              />
              <ThemedSelect
                className="h-10"
                onChange={setImpactFilter}
                options={ECONOMIC_IMPACT_FILTERS}
                value={impactFilter}
              />
              <ThemedSelect
                className="h-10"
                onChange={setDayFilter}
                options={dayOptions}
                value={dayFilter}
              />
              <ThemedSelect
                className="h-10"
                onChange={setEventTypeFilter}
                options={ECONOMIC_EVENT_TYPE_FILTERS}
                value={eventTypeFilter}
              />
            </div>
          </div>

          <div className="divide-y divide-white/10">
            {groupedEvents.map((group) => (
              <section key={group.date}>
                <div className="flex items-center justify-between bg-white/[0.025] px-4 py-2">
                  <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{group.label}</div>
                  <div className="text-xs font-semibold text-slate-500">{group.events.length} events</div>
                </div>
                <div className="divide-y divide-white/10">
                  {group.events.map((event, index) => (
                    <EconomicEventRow
                      event={event}
                      key={`${event.starts_at}-${event.currency}-${event.title}-${index}`}
                      onOpenDetail={setDetailEvent}
                      onOpenGraph={setGraphEvent}
                    />
                  ))}
                </div>
              </section>
            ))}
            {!isLoading && groupedEvents.length === 0 && (
              <EmptyState icon={CalendarDays} message="No calendar events match this scope." />
            )}
            {isLoading && (
              <div className="px-4 py-10 text-center text-sm text-slate-500">
                Loading Forex Factory calendar...
              </div>
            )}
          </div>
        </FeatureCard>

        <div className="grid content-start gap-4">
          <FeatureCard>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardLabel icon={Activity} label="Impact radar" />
                <div className="mt-1 text-xs text-slate-500">Events by severity</div>
              </div>
              <span className="status-pill h-8 px-2 text-[11px]">This week</span>
            </div>
            <div className="mt-4 grid gap-2">
              {economicImpactSummary(events).map((row) => (
                <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2" key={row.impact}>
                  <div className="flex items-center justify-between gap-3">
                    <span className={`text-sm font-semibold ${economicImpactTone(row.impact)}`}>{row.impact}</span>
                    <span className="text-sm font-semibold tabular-nums text-slate-100">{row.count}</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full rounded-full ${economicImpactBarClass(row.impact)}`}
                      style={{ width: `${Math.max(4, row.percent)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </FeatureCard>

          <FeatureCard>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardLabel icon={Globe2} label="Currency focus" />
                <div className="mt-1 text-xs text-slate-500">Most active currencies</div>
              </div>
            </div>
            <div className="mt-4 grid gap-2">
              {economicCurrencySummary(events).slice(0, 8).map((row) => (
                <button
                  className={`flex items-center justify-between rounded-md border px-3 py-2 text-left transition ${
                    currencyFilter === row.currency
                      ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
                      : "border-white/10 bg-black/20 text-slate-300 hover:bg-white/5 hover:text-white"
                  }`}
                  key={row.currency}
                  onClick={() => setCurrencyFilter(currencyFilter === row.currency ? "ALL" : row.currency)}
                  type="button"
                >
                  <span className="font-semibold">{row.currency}</span>
                  <span className="text-sm tabular-nums text-slate-500">{row.count}</span>
                </button>
              ))}
            </div>
          </FeatureCard>

          <FeatureCard>
            <CardLabel icon={Clock3} label="Next risk window" />
            {upcomingEvent ? (
              <div className="mt-4 rounded-md border border-white/10 bg-black/25 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="status-pill h-8 px-2 text-[11px]">{upcomingEvent.currency}</span>
                  <span className={`text-xs font-bold uppercase tracking-[0.14em] ${economicImpactTone(upcomingEvent.impact)}`}>
                    {normalizeEconomicImpact(upcomingEvent.impact)}
                  </span>
                </div>
                <div className="mt-3 text-lg font-semibold text-white">{upcomingEvent.title}</div>
                <div className="mt-1 text-sm text-slate-500">{formatEconomicEventDateTime(upcomingEvent.starts_at)}</div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                  <MiniMetric label="Type" value={economicEventType(upcomingEvent)} />
                  <MiniMetric label="Forecast" value={upcomingEvent.forecast ?? "—"} />
                  <MiniMetric label="Previous" value={upcomingEvent.previous ?? "—"} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="control-button h-9 text-xs" onClick={() => setDetailEvent(upcomingEvent)} type="button">
                    <FolderPlus size={14} />
                    Detail
                  </button>
                  <button className="control-button h-9 text-xs" onClick={() => setGraphEvent(upcomingEvent)} type="button">
                    <BarChart3 size={14} />
                    Graph
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 text-sm text-slate-500">No upcoming events in this calendar payload.</div>
            )}
          </FeatureCard>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-300/20 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      )}
      {detailEvent && <EconomicEventDetailDialog event={detailEvent} onClose={() => setDetailEvent(null)} />}
      {graphEvent && <EconomicEventGraphDialog event={graphEvent} onClose={() => setGraphEvent(null)} />}
    </PageScaffold>
  );
}

function EconomicEventRow({
  event,
  onOpenDetail,
  onOpenGraph,
}: {
  event: EconomicCalendarEvent;
  onOpenDetail: (event: EconomicCalendarEvent) => void;
  onOpenGraph: (event: EconomicCalendarEvent) => void;
}) {
  const impact = normalizeEconomicImpact(event.impact);
  const eventType = economicEventType(event);
  return (
    <div className="grid gap-3 px-4 py-3 text-sm text-slate-300 transition hover:bg-white/[0.035] lg:grid-cols-[84px_84px_minmax(0,1fr)_260px]">
      <div className="font-semibold tabular-nums text-slate-100">{economicEventTimeLabel(event.starts_at)}</div>
      <div>
        <span className="status-pill h-8 px-2 text-[11px]">{event.currency}</span>
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${economicImpactDotClass(impact)}`} />
          <span className={`text-[10px] font-bold uppercase tracking-[0.16em] ${economicImpactTone(impact)}`}>{impact}</span>
          <span className="status-pill h-7 px-2 text-[10px]">{eventType}</span>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          <button
            className="min-w-0 flex-1 truncate text-left text-base font-semibold text-white transition hover:text-cyan-100"
            onClick={() => onOpenDetail(event)}
            type="button"
          >
            {event.title}
          </button>
          <div className="flex shrink-0 items-center gap-1">
            <button aria-label="Open event detail" className="icon-button h-8 w-8" onClick={() => onOpenDetail(event)} title="Open event detail" type="button">
              <FolderPlus size={14} />
            </button>
            <button aria-label="Open event graph" className="icon-button h-8 w-8" onClick={() => onOpenGraph(event)} title="Open event graph" type="button">
              <BarChart3 size={14} />
            </button>
          </div>
        </div>
        <div className="mt-0.5 text-xs text-slate-500">{formatEconomicEventDateTime(event.starts_at)}</div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <MiniMetric label="Actual" value={event.actual ?? "—"} />
        <MiniMetric label="Forecast" value={event.forecast ?? "—"} />
        <MiniMetric label="Previous" value={event.previous ?? "—"} />
      </div>
    </div>
  );
}

function EconomicEventDetailDialog({
  event,
  onClose,
}: {
  event: EconomicCalendarEvent;
  onClose: () => void;
}) {
  const impact = normalizeEconomicImpact(event.impact);
  const eventType = economicEventType(event);
  const surprise = economicEventSurprise(event);
  const detailRows = economicEventDetailRows(event);
  return (
    <ModalFrame maxWidth="wide" onClose={onClose} title="Economic Event Detail">
      <div className="grid gap-4">
        <div className="rounded-md border border-white/10 bg-black/25 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="status-pill h-8 px-2 text-[11px]">{event.currency}</span>
                <span className={`status-pill h-8 px-2 text-[11px] ${economicImpactTone(impact)}`}>{impact}</span>
                <span className="status-pill h-8 px-2 text-[11px]">{eventType}</span>
              </div>
              <h3 className="mt-3 text-2xl font-semibold text-white">{event.title}</h3>
              <p className="mt-2 text-sm text-slate-500">{formatEconomicEventDateTime(event.starts_at)}</p>
            </div>
            <button className="control-button h-9 text-xs" onClick={() => openEconomicEventSource(event)} type="button">
              <Globe2 size={14} />
              Forex Factory day
            </button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MiniMetric label="Actual" value={event.actual ?? "Not released"} />
          <MiniMetric label="Forecast" value={event.forecast ?? "—"} />
          <MiniMetric label="Previous" value={event.previous ?? "—"} />
          <MiniMetric label="Surprise" value={surprise.label} />
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.58fr)_minmax(0,0.42fr)]">
          <div className="rounded-md border border-white/10 bg-black/20 p-4">
            <CardLabel icon={FileText} label="Event detail" />
            <div className="mt-3 grid gap-3 text-sm leading-6 text-slate-300">
              <p>{economicEventDetailNarrative(event)}</p>
              <div className="grid gap-2">
                {detailRows.map((row) => (
                  <div className="grid gap-1 rounded-md border border-white/10 bg-black/20 px-3 py-2 sm:grid-cols-[128px_minmax(0,1fr)]" key={row.label}>
                    <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600">{row.label}</span>
                    <span className="font-semibold text-slate-200">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-md border border-white/10 bg-black/20 p-4">
            <CardLabel icon={Gauge} label="Trading context" />
            <div className="mt-3 grid gap-2">
              <MiniMetric label="Risk window" value={impact === "High" ? "Major volatility" : impact === "Medium" ? "Moderate volatility" : "Routine watch"} />
              <MiniMetric label="Event class" value={eventType} />
              <MiniMetric label="Local release" value={economicEventTimeLabel(event.starts_at)} />
              <MiniMetric label="Data state" value={event.actual ? "Released" : "Scheduled"} />
            </div>
          </div>
        </div>
      </div>
    </ModalFrame>
  );
}

function EconomicEventGraphDialog({
  event,
  onClose,
}: {
  event: EconomicCalendarEvent;
  onClose: () => void;
}) {
  const points = economicEventGraphPoints(event);
  const hasChart = points.length >= 2;
  const surprise = economicEventSurprise(event);
  return (
    <ModalFrame maxWidth="wide" onClose={onClose} title="Economic Event Graph">
      <div className="grid gap-4">
        <div className="rounded-md border border-white/10 bg-black/25 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardLabel icon={BarChart3} label="Actual / Forecast / Previous" />
              <h3 className="mt-3 text-xl font-semibold text-white">{event.title}</h3>
              <div className="mt-1 text-sm text-slate-500">{event.currency} · {formatEconomicEventDateTime(event.starts_at)}</div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <span className={`status-pill h-8 px-2 text-[11px] ${economicImpactTone(event.impact)}`}>{normalizeEconomicImpact(event.impact)}</span>
              <span className="status-pill h-8 px-2 text-[11px]">{economicEventType(event)}</span>
            </div>
          </div>
        </div>
        {hasChart ? (
          <EconomicEventValueChart points={points} />
        ) : (
          <EmptyState icon={BarChart3} message="No numeric chart data is available for this event yet." />
        )}
        <div className="grid gap-3 md:grid-cols-3">
          <MiniMetric label="Previous" value={event.previous ?? "—"} />
          <MiniMetric label="Forecast" value={event.forecast ?? "—"} />
          <MiniMetric label="Actual" value={event.actual ?? "Not released"} />
        </div>
        <div className="rounded-md border border-white/10 bg-black/20 px-4 py-3 text-sm leading-6 text-slate-500">
          <span className={`font-semibold ${surprise.tone}`}>{surprise.label}.</span>{" "}
          The chart compares the current event values available in the calendar feed, so unreleased events show forecast and previous values until an actual value posts.
        </div>
      </div>
    </ModalFrame>
  );
}

type EconomicEventChartPoint = {
  label: "Previous" | "Forecast" | "Actual";
  raw: string;
  value: number;
};

type EconomicEventSurprise = {
  label: string;
  shortLabel: string;
  tone: string;
};

function economicEventType(event: EconomicCalendarEvent) {
  const title = event.title.toLowerCase();
  if (/\b(speaks|speech|testif|testimony|press conference)\b/.test(title)) {
    return "Speeches";
  }
  if (/\b(cpi|ppi|rpi|inflation|price index|prices|deflator|consumer price|producer price)\b/.test(title)) {
    return "Inflation";
  }
  if (/\b(employment|unemployment|payroll|non-farm|nfp|jobless|claimant|earnings|wages|labor|labour|jobs|jolts)\b/.test(title)) {
    return "Employment";
  }
  if (/\b(fomc|fed|federal reserve|ecb|boe|boj|boc|rba|rbnz|snb|rate decision|interest rate|policy rate|monetary|minutes|central bank)\b/.test(title)) {
    return "Central Bank";
  }
  if (/\b(housing|home sales|house price|building permits|construction|mortgage|starts)\b/.test(title)) {
    return "Housing";
  }
  if (/\b(pmi|ism|business|manufacturing|services|industrial|factory|orders|zew|ifo|nab)\b/.test(title)) {
    return "Business";
  }
  if (/\b(consumer confidence|consumer sentiment|consumer credit|household spending|retail sales|personal spending)\b/.test(title)) {
    return "Consumer";
  }
  if (/\b(gdp|growth|trade balance|current account|production|productivity|inventories|spending)\b/.test(title)) {
    return "Growth";
  }
  if (/\b(bond|auction|yield|treasury|gilt|bund)\b/.test(title)) {
    return "Bonds";
  }
  return "Misc";
}

function economicEventDetailRows(event: EconomicCalendarEvent) {
  const surprise = economicEventSurprise(event);
  return [
    { label: "Release time", value: formatEconomicEventDateTime(event.starts_at) },
    { label: "Currency", value: event.currency || "—" },
    { label: "Impact", value: normalizeEconomicImpact(event.impact) },
    { label: "Event class", value: economicEventType(event) },
    { label: "Actual", value: event.actual || "Not released" },
    { label: "Forecast", value: event.forecast || "—" },
    { label: "Previous", value: event.previous || "—" },
    { label: "Surprise", value: surprise.label },
  ];
}

function economicCalendarIsExpired(calendar: EconomicCalendarResponse) {
  const expiresAt = Date.parse(calendar.cache_expires_at);
  return Number.isFinite(expiresAt) && Date.now() >= expiresAt;
}

function economicEventCacheKey(event: EconomicCalendarEvent) {
  return [event.starts_at, event.currency, event.title].join("|");
}

function findMatchingEconomicEvent(
  events: EconomicCalendarEvent[],
  selected: EconomicCalendarEvent,
) {
  const key = economicEventCacheKey(selected);
  return events.find((event) => economicEventCacheKey(event) === key) ?? null;
}

function economicEventDetailNarrative(event: EconomicCalendarEvent) {
  const impact = normalizeEconomicImpact(event.impact);
  const eventType = economicEventType(event);
  const releaseState = event.actual
    ? `The latest actual value is ${event.actual}`
    : "The event is still scheduled and the actual value has not posted yet";
  const forecastState = event.forecast ? ` against a ${event.forecast} forecast` : " with no forecast value in the feed";
  const previousState = event.previous ? ` and a ${event.previous} previous reading` : "";
  return `${event.title} is a ${impact.toLowerCase()} impact ${event.currency} ${eventType.toLowerCase()} event scheduled for ${formatEconomicEventDateTime(event.starts_at)}. ${releaseState}${forecastState}${previousState}.`;
}

function economicEventSurprise(event: EconomicCalendarEvent): EconomicEventSurprise {
  const actual = numericCalendarValue(event.actual);
  const forecast = numericCalendarValue(event.forecast);
  if (actual == null) {
    return {
      label: "Waiting for actual",
      shortLabel: "Pending actual",
      tone: "text-slate-500",
    };
  }
  if (forecast == null) {
    return {
      label: "No forecast comparison",
      shortLabel: "No forecast",
      tone: "text-slate-500",
    };
  }
  const diff = actual - forecast;
  const absDiff = Math.abs(diff);
  if (absDiff <= Math.max(0.000001, Math.abs(forecast) * 0.000001)) {
    return {
      label: "Inline with forecast",
      shortLabel: "Inline forecast",
      tone: "text-slate-400",
    };
  }
  const formatted = formatCalendarDifference(diff, event.actual ?? event.forecast ?? "");
  return {
    label: `${formatted} vs forecast`,
    shortLabel: diff > 0 ? "Above forecast" : "Below forecast",
    tone: diff > 0 ? "text-emerald-200" : "text-rose-200",
  };
}

function economicEventGraphPoints(event: EconomicCalendarEvent): EconomicEventChartPoint[] {
  return [
    { label: "Previous" as const, raw: event.previous ?? "", value: numericCalendarValue(event.previous) },
    { label: "Forecast" as const, raw: event.forecast ?? "", value: numericCalendarValue(event.forecast) },
    { label: "Actual" as const, raw: event.actual ?? "", value: numericCalendarValue(event.actual) },
  ].filter((point): point is EconomicEventChartPoint => point.value != null && point.raw.trim().length > 0);
}

function EconomicEventValueChart({ points }: { points: EconomicEventChartPoint[] }) {
  const data = points.map((point) => ({
    label: point.label,
    raw: point.raw,
    value: point.value,
  }));

  return (
    <div className="rounded-md border border-white/10 bg-[#060b10]/85 p-3">
      <div className="rounded-md border border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(50,211,238,0.12),transparent_36%),rgba(2,6,23,0.82)] p-2">
        <BacklitBarChart
          aspectRatio="2.6 / 1"
          barGap={0.38}
          data={data}
          margin={{ top: 18, right: 18, bottom: 42, left: 62 }}
          xDataKey="label"
        >
          <BacklitGrid horizontal />
          <BacklitBar
            dataKey="value"
            fill={(datum) => Number(datum.value ?? 0) >= 0 ? "var(--profit)" : "var(--loss)"}
            lineCap="round"
          />
          <BacklitYAxis formatValue={formatCompactCalendarNumber} numTicks={4} />
          <BacklitBarXAxis showAllLabels />
          <BacklitChartTooltip
            content={({ point }) => {
              const value = Number(point.value ?? 0);
              return (
                <div className="min-w-[148px] px-3 py-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    {String(point.label ?? "Value")}
                  </div>
                  <div className={`mt-1 text-sm font-semibold tabular-nums ${toneForNumber(value)}`}>
                    {formatCompactCalendarNumber(value)}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">{String(point.raw ?? "")}</div>
                </div>
              );
            }}
            showDatePill={false}
            showDots={false}
          />
        </BacklitBarChart>
      </div>
    </div>
  );
}

function numericCalendarValue(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const cleaned = value.replace(/,/g, "").trim();
  if (!cleaned || /^(-|—|n\/a|na|tentative)$/i.test(cleaned)) {
    return null;
  }
  const match = cleaned.match(/[-+]?(?:\d+\.?\d*|\.\d+)\s*([kmbt%])?/i);
  if (!match) {
    return null;
  }
  const parsed = Number.parseFloat(match[0]);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const suffix = match[1]?.toUpperCase();
  if (suffix === "K") {
    return parsed * 1_000;
  }
  if (suffix === "M") {
    return parsed * 1_000_000;
  }
  if (suffix === "B") {
    return parsed * 1_000_000_000;
  }
  if (suffix === "T") {
    return parsed * 1_000_000_000_000;
  }
  return parsed;
}

function calendarValueScale(rawValue: string) {
  const suffix = rawValue.trim().match(/[kmbt%]\s*$/i)?.[0].trim().toUpperCase();
  if (suffix === "K") {
    return { suffix, value: 1_000 };
  }
  if (suffix === "M") {
    return { suffix, value: 1_000_000 };
  }
  if (suffix === "B") {
    return { suffix, value: 1_000_000_000 };
  }
  if (suffix === "T") {
    return { suffix, value: 1_000_000_000_000 };
  }
  if (suffix === "%") {
    return { suffix, value: 1 };
  }
  return { suffix: "", value: 1 };
}

function formatCalendarDifference(value: number, rawReference: string) {
  const scale = calendarValueScale(rawReference);
  const scaled = value / scale.value;
  const precision = Math.abs(scaled) >= 10 ? 1 : 2;
  const formatted = scaled.toLocaleString([], {
    maximumFractionDigits: precision,
    minimumFractionDigits: Math.abs(scaled) < 1 ? 2 : 0,
    signDisplay: "always",
  });
  return `${formatted}${scale.suffix}`;
}

function formatCompactCalendarNumber(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toLocaleString([], { maximumFractionDigits: 2 });
}

function openEconomicEventSource(event: EconomicCalendarEvent) {
  if (typeof window === "undefined") {
    return;
  }
  const date = new Date(event.starts_at);
  if (Number.isNaN(date.getTime())) {
    window.open("https://www.forexfactory.com/calendar", "_blank", "noopener,noreferrer");
    return;
  }
  const month = date.toLocaleString("en-US", { month: "short" }).toLowerCase();
  const daySlug = `${month}${date.getDate()}.${date.getFullYear()}`;
  window.open(`https://www.forexfactory.com/calendar?day=${daySlug}`, "_blank", "noopener,noreferrer");
}

function normalizeEconomicImpact(impact: string | null | undefined) {
  const normalized = (impact ?? "Unknown").trim().toLowerCase();
  if (normalized === "high") {
    return "High";
  }
  if (normalized === "medium") {
    return "Medium";
  }
  if (normalized === "low") {
    return "Low";
  }
  if (normalized === "holiday") {
    return "Holiday";
  }
  return "Unknown";
}

function economicImpactRank(impact: string | null | undefined) {
  const normalized = normalizeEconomicImpact(impact);
  if (normalized === "High") {
    return 0;
  }
  if (normalized === "Medium") {
    return 1;
  }
  if (normalized === "Low") {
    return 2;
  }
  if (normalized === "Holiday") {
    return 3;
  }
  return 4;
}

function economicImpactTone(impact: string | null | undefined) {
  const normalized = normalizeEconomicImpact(impact);
  if (normalized === "High") {
    return "text-rose-200";
  }
  if (normalized === "Medium") {
    return "text-amber-200";
  }
  if (normalized === "Low") {
    return "text-cyan-200";
  }
  if (normalized === "Holiday") {
    return "text-violet-200";
  }
  return "text-slate-400";
}

function economicImpactDotClass(impact: string | null | undefined) {
  const normalized = normalizeEconomicImpact(impact);
  if (normalized === "High") {
    return "bg-rose-300 shadow-[0_0_16px_rgba(253,164,175,0.45)]";
  }
  if (normalized === "Medium") {
    return "bg-amber-300 shadow-[0_0_16px_rgba(252,211,77,0.38)]";
  }
  if (normalized === "Low") {
    return "bg-cyan-300 shadow-[0_0_16px_rgba(103,232,249,0.32)]";
  }
  if (normalized === "Holiday") {
    return "bg-violet-300 shadow-[0_0_16px_rgba(196,181,253,0.32)]";
  }
  return "bg-slate-500";
}

function economicImpactBarClass(impact: string | null | undefined) {
  const normalized = normalizeEconomicImpact(impact);
  if (normalized === "High") {
    return "bg-rose-300";
  }
  if (normalized === "Medium") {
    return "bg-amber-300";
  }
  if (normalized === "Low") {
    return "bg-cyan-300";
  }
  if (normalized === "Holiday") {
    return "bg-violet-300";
  }
  return "bg-slate-500";
}

function buildEconomicCurrencyOptions(events: EconomicCalendarEvent[]) {
  const priority = ["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "CNY"];
  const currencies = Array.from(new Set(events.map((event) => event.currency).filter(Boolean)));
  currencies.sort((left, right) => {
    const leftRank = priority.indexOf(left);
    const rightRank = priority.indexOf(right);
    return (leftRank === -1 ? 99 : leftRank) - (rightRank === -1 ? 99 : rightRank) || left.localeCompare(right);
  });
  return [
    { label: "All currencies", value: "ALL" },
    ...currencies.map((currency) => ({ label: currency, value: currency })),
  ];
}

function buildEconomicDayOptions(events: EconomicCalendarEvent[]) {
  const days = Array.from(new Map(events.map((event) => [localDateKey(event.starts_at), economicDayLabel(event.starts_at)])).entries());
  return [
    { label: "All week", value: "ALL" },
    ...days.map(([value, label]) => ({ label, value })),
  ];
}

function economicEventMatchesFilters(
  event: EconomicCalendarEvent,
  filters: {
    currency: string;
    day: string;
    eventType: string;
    impact: string;
    search: string;
  },
) {
  if (filters.currency !== "ALL" && event.currency !== filters.currency) {
    return false;
  }
  if (filters.impact !== "ALL" && normalizeEconomicImpact(event.impact) !== filters.impact) {
    return false;
  }
  if (filters.day !== "ALL" && localDateKey(event.starts_at) !== filters.day) {
    return false;
  }
  const eventType = economicEventType(event);
  if (filters.eventType !== "ALL" && eventType !== filters.eventType) {
    return false;
  }
  const query = filters.search.trim().toLowerCase();
  if (!query) {
    return true;
  }
  return [
    event.title,
    event.currency,
    event.impact,
    eventType,
    event.actual,
    event.forecast,
    event.previous,
  ].some((value) => String(value ?? "").toLowerCase().includes(query));
}

function groupEconomicEventsByDay(events: EconomicCalendarEvent[]) {
  const groups = new Map<string, { date: string; events: EconomicCalendarEvent[]; label: string }>();
  for (const event of events) {
    const date = localDateKey(event.starts_at);
    const group = groups.get(date) ?? {
      date,
      events: [],
      label: economicDayLabel(event.starts_at),
    };
    group.events.push(event);
    groups.set(date, group);
  }
  return Array.from(groups.values()).map((group) => ({
    ...group,
    events: group.events.slice().sort((left, right) => {
      const timeDiff = Date.parse(left.starts_at) - Date.parse(right.starts_at);
      return timeDiff || economicImpactRank(left.impact) - economicImpactRank(right.impact);
    }),
  }));
}

function nextEconomicEvent(events: EconomicCalendarEvent[]) {
  const now = Date.now();
  return events.find((event) => Date.parse(event.starts_at) >= now) ?? null;
}

function economicImpactSummary(events: EconomicCalendarEvent[]) {
  const total = Math.max(1, events.length);
  return ["High", "Medium", "Low", "Holiday"].map((impact) => {
    const count = events.filter((event) => normalizeEconomicImpact(event.impact) === impact).length;
    return {
      count,
      impact,
      percent: (count / total) * 100,
    };
  });
}

function economicCurrencySummary(events: EconomicCalendarEvent[]) {
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.currency, (counts.get(event.currency) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([currency, count]) => ({ count, currency }))
    .sort((left, right) => right.count - left.count || left.currency.localeCompare(right.currency));
}

function localDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function economicDayLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unscheduled";
  }
  return date.toLocaleDateString([], {
    day: "2-digit",
    month: "short",
    weekday: "short",
  });
}

function economicEventTimeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatEconomicEventDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString([], {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    weekday: "short",
  });
}

function useProgressiveChartEngines(paneIds: string[], activePaneId: string) {
  const paneKey = paneIds.join("|");
  const [mountedPaneIds, setMountedPaneIds] = useState<Set<string>>(() => new Set([activePaneId]));

  useEffect(() => {
    let cancelled = false;
    let frameId: number | null = null;
    const prioritized = [activePaneId, ...paneIds.filter((id) => id !== activePaneId)];
    let cursor = 1;
    setMountedPaneIds(new Set(prioritized.slice(0, 1)));

    const mountNextBatch = () => {
      if (cancelled) return;
      const batch = prioritized.slice(cursor, cursor + 2);
      cursor += batch.length;
      if (batch.length) {
        setMountedPaneIds((current) => new Set([...current, ...batch]));
      }
      if (cursor < prioritized.length) frameId = window.requestAnimationFrame(mountNextBatch);
    };
    frameId = window.requestAnimationFrame(mountNextBatch);
    return () => {
      cancelled = true;
      if (frameId != null) window.cancelAnimationFrame(frameId);
    };
  }, [paneKey]);

  useEffect(() => {
    if (!paneIds.includes(activePaneId)) return;
    setMountedPaneIds((current) => current.has(activePaneId) ? current : new Set([...current, activePaneId]));
  }, [activePaneId, paneKey]);

  return {
    enginesReady: paneIds.every((id) => mountedPaneIds.has(id)),
    mountedPaneIds,
  };
}

const LiveChartStudio = memo(function LiveChartStudio({
  bars,
  connectionStatus,
  feedIssue,
  journalChartFocus,
  selectedSourceLabel,
  symbol,
  symbolCode,
  tickerChangeLabel,
}: {
  bars: Candle[];
  connectionStatus: LiveConnectionStatus;
  feedIssue: LiveFeedIssue;
  journalChartFocus: JournalChartFocusRequest | null;
  selectedSourceLabel: string;
  symbol: string;
  symbolCode: string;
  tickerChangeLabel: string;
}) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [chartPaneLayout, setChartPaneLayout] = useState<ChartPaneLayoutId>(() =>
    sanitizeChartPaneLayout(loadLiveChartLayout()?.paneLayout),
  );
  const [chartPanes, setChartPanes] = useState<LiveChartPaneState[]>(() =>
    sanitizeLiveChartPanes(loadLiveChartLayout() ?? {}),
  );
  const [chartSyncSettings, setChartSyncSettings] = useState<ChartSyncSettings>(() =>
    sanitizeChartSyncSettings(loadLiveChartLayout()?.syncSettings),
  );
  const crosshairSyncBusRef = useRef<ChartCrosshairSyncBus | null>(null);
  if (!crosshairSyncBusRef.current) {
    crosshairSyncBusRef.current = createChartCrosshairSyncBus();
  }
  const crosshairSyncBus = crosshairSyncBusRef.current;
  const [activeChartPaneId, setActiveChartPaneId] = useState(() => chartPanes[0]?.id ?? "live-chart-pane-1");
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [chartToolsOpen, setChartToolsOpen] = useState(false);
  const [chartSettingsPanelOpen, setChartSettingsPanelOpen] = useState(false);
  const [chartSettingsOpenSignal, setChartSettingsOpenSignal] = useState(0);
  const [layersPanelOpen, setLayersPanelOpen] = useState(false);
  const [layoutName, setLayoutName] = useState(() => loadActiveLiveChartLayoutName());
  const [availableLayouts, setAvailableLayouts] = useState(() => loadLiveChartLayoutRecords().map((record) => record.name));
  const [chartLayoutSavedAt, setChartLayoutSavedAt] = useState<number | null>(null);
  const [drawingUndoStack, setDrawingUndoStack] = useState<ChartDrawing[][]>([]);
  const [timeframeShortcutFeedback, setTimeframeShortcutFeedback] = useState<TimeframeShortcutFeedback | null>(null);
  const drawingUndoBatchOpenRef = useRef(false);
  const drawingUndoBatchTimerRef = useRef<number | null>(null);
  const lastNeutralDrawingToolRef = useRef<Extract<DrawingTool, "cursor" | "crosshair">>("crosshair");
  const timeframeShortcutBufferRef = useRef("");
  const timeframeShortcutTimerRef = useRef<number | null>(null);
  const chartStudioRef = useRef<HTMLDivElement | null>(null);
  const chartPaneLayoutDefinition = chartPaneLayoutById(chartPaneLayout);
  const visibleChartPanes = chartPanes.slice(0, chartPaneLayoutDefinition.panes);
  const { enginesReady, mountedPaneIds } = useProgressiveChartEngines(visibleChartPanes.map((pane) => pane.id), activeChartPaneId);
  const activeChartPane =
    chartPanes.find((pane) => pane.id === activeChartPaneId) ?? visibleChartPanes[0] ?? createDefaultLiveChartPane(0);
  const activeChartPaneIndex = visibleChartPanes.findIndex((pane) => pane.id === activeChartPane.id);
  const isMultiChartLayout = chartPaneLayoutDefinition.panes > 1;
  const activePaneLabel = isMultiChartLayout && activeChartPaneIndex >= 0 ? `Pane ${activeChartPaneIndex + 1}` : "Live chart";
  const savedLayoutLabel =
    chartLayoutSavedAt == null
      ? null
      : `Saved ${new Date(chartLayoutSavedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  const changeTone = tickerChangeLabel.startsWith("+")
    ? toneForNumber(1)
    : tickerChangeLabel.startsWith("-")
      ? toneForNumber(-1)
      : toneForNumber(0);
  const paneMarketData = usePaneMarketData(visibleChartPanes.map((pane) => {
    const paneSymbol = pane.symbol || symbolCode || symbol;
    const focused = journalChartFocus && journalFocusMatchesSymbol(paneSymbol, journalChartFocus.symbol);
    return {
      id: pane.id,
      symbol: paneSymbol,
      timeframe: pane.timeframe,
      fromAt: focused ? journalChartFocus.startAt : undefined,
      toAt: focused ? journalChartFocus.endAt : undefined,
    };
  }));
  const journalFocusRange = useMemo(() => journalChartFocus ? journalFocusVisibleRange(journalChartFocus, journalChartFocus.tradeId) : null, [journalChartFocus]);

  useEffect(() => {
    crosshairSyncBus.setEnabled(chartSyncSettings.crosshair);
  }, [chartSyncSettings.crosshair, crosshairSyncBus]);

  useEffect(() => () => crosshairSyncBus.dispose(), [crosshairSyncBus]);

  useEffect(() => {
    const syncFullscreen = () => {
      if (document.fullscreenElement === chartStudioRef.current) {
        setIsFullscreen(true);
      } else if (!document.fullscreenElement) {
        setIsFullscreen(false);
      }
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  function toggleFullscreen() {
    if (isFullscreen) {
      setIsFullscreen(false);
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
      }
      return;
    }
    setIsFullscreen(true);
    const element = chartStudioRef.current;
    if (element && document.fullscreenElement !== element && element.requestFullscreen) {
      void element.requestFullscreen().catch(() => {
        // The fixed in-app layout remains available when native fullscreen is denied.
      });
    }
  }

  useEffect(() => {
    const nextSymbol = symbolCode || symbol;
    if (!nextSymbol) return;
    setChartPanes((current) => current.map((pane) => pane.id === activeChartPane.id ? { ...pane, symbol: nextSymbol } : pane));
  }, [symbol, symbolCode]);

  useEffect(() => {
    if (!journalChartFocus) return;
    setChartPanes((current) => current.map((pane) => pane.id === activeChartPane.id ? { ...pane, symbol: journalChartFocus.symbol, drawings: applyJournalFocusDrawings(pane.drawings, journalChartFocus) } : pane));
  }, [journalChartFocus]);

  useEffect(() => {
    const unsubscribe = subscribeAppStorageItem<unknown>(
      LIVE_CHART_LAYOUT_STORAGE_KEY,
      (value) => {
        const layout = sanitizeLiveChartLayout(value);
        setChartPaneLayout(sanitizeChartPaneLayout(layout.paneLayout));
        setChartPanes(sanitizeLiveChartPanes(layout));
        setChartSyncSettings(sanitizeChartSyncSettings(layout.syncSettings));
        setActiveChartPaneId(layout.activePaneId ?? "live-chart-pane-1");
      },
    );
    return unsubscribe;
  }, []);

  useEffect(() => {
    const persistTimer = window.setTimeout(() => {
      void saveAppStorageItem(LIVE_CHART_LAYOUT_STORAGE_KEY, buildLiveChartLayoutPayload());
    }, 0);
    return () => window.clearTimeout(persistTimer);
  }, [activeChartPaneId, chartPaneLayout, chartPanes, chartSyncSettings]);

  useEffect(() => {
    if (visibleChartPanes.some((pane) => pane.id === activeChartPaneId)) {
      return;
    }
    setActiveChartPaneId(visibleChartPanes[0]?.id ?? "live-chart-pane-1");
    setSelectedDrawingId(null);
    setDrawingUndoStack([]);
  }, [activeChartPaneId, visibleChartPanes]);

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
      setTimeframeShortcutFeedback(buildTimeframeShortcutFeedback(rawValue, LIVE_SOURCE_TIMEFRAME));
      scheduleTimeframeShortcutClear();
    }

    function commitTimeframeShortcut(rawValue: string) {
      const feedback = buildTimeframeShortcutFeedback(rawValue, LIVE_SOURCE_TIMEFRAME);
      if (feedback.status === "ready" && feedback.timeframe) {
        clearTimeframeShortcutBuffer();
        changeTimeframe(feedback.timeframe);
        return;
      }
      timeframeShortcutBufferRef.current = "";
      setTimeframeShortcutFeedback(feedback);
      scheduleTimeframeShortcutClear();
    }

    function handleTimeframeShortcut(event: globalThis.KeyboardEvent) {
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
        timeframeShortcutBufferRef.current = `${timeframeShortcutBufferRef.current}${event.key}`.slice(0, 5);
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
      showTimeframeShortcutFeedback(`${timeframeShortcutBufferRef.current}${event.key}`);
      timeframeShortcutBufferRef.current = "";
      event.preventDefault();
      return true;
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if (isTyping) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undoLastDrawingChange();
        return;
      }
      if (handleTimeframeShortcut(event)) {
        return;
      }
      switch (event.key) {
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
          if (activeChartPane.drawingTool !== "cursor" && activeChartPane.drawingTool !== "crosshair") {
            changeDrawingTool(lastNeutralDrawingToolRef.current);
          }
          setSelectedDrawingId(null);
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
  }, [activeChartPane.drawingTool, selectedDrawingId, drawingUndoStack, chartPanes, activeChartPane.id]);

  function updateChartPane(paneId: string, updater: (pane: LiveChartPaneState) => LiveChartPaneState) {
    setChartPanes((current) =>
      current.map((pane) => pane.id === paneId ? sanitizeLiveChartPaneState(updater(pane)) : pane),
    );
  }

  function updateActiveChartPane(updater: (pane: LiveChartPaneState) => LiveChartPaneState) {
    updateChartPane(activeChartPane.id, updater);
  }

  function chartPaneById(paneId: string) {
    return chartPanes.find((pane) => pane.id === paneId) ?? activeChartPane;
  }

  function changeTimeframe(nextTimeframe: ChartTimeframe) {
    const normalized = normalizeChartTimeframe(nextTimeframe);
    if (!normalized || !canAggregateTimeframe(normalized, LIVE_SOURCE_TIMEFRAME)) {
      return;
    }
    updateActiveChartPane((pane) => ({ ...pane, timeframe: normalized }));
  }

  function changeReplayTimeframe(nextTimeframe: ChartTimeframe) {
    changeTimeframe(nextTimeframe);
  }

  function changeDrawingTool(tool: DrawingTool) {
    changeDrawingToolForPane(activeChartPane.id, tool);
  }

  function changeDrawingToolForPane(paneId: string, tool: DrawingTool) {
    if (tool === "cursor" || tool === "crosshair") {
      lastNeutralDrawingToolRef.current = tool;
    }
    updateChartPane(paneId, (pane) => ({ ...pane, drawingTool: tool }));
  }

  function selectChartPane(paneId: string) {
    setActiveChartPaneId(paneId);
    setSelectedDrawingId(null);
    setDrawingUndoStack([]);
  }

  function changeChartPaneLayout(nextLayout: ChartPaneLayoutId) {
    const layout = chartPaneLayoutById(nextLayout);
    void saveAppStorageItem(ACTIVE_LIVE_CHART_LAYOUT_STORAGE_KEY, null);
    setChartPaneLayout(layout.id);
    setChartPanes((current) => {
      const nextPanes = [...current];
      while (nextPanes.length < layout.panes) {
        nextPanes.push(createDefaultLiveChartPane(nextPanes.length, activeChartPane));
      }
      return nextPanes;
    });
    if (activeChartPaneIndex >= layout.panes) {
      selectChartPane("live-chart-pane-1");
    }
  }

  function addIndicator(kind: ChartIndicatorKind) {
    updateActiveChartPane((pane) => {
      if (
        (kind === "fvg" || kind === "ifvg") &&
        pane.indicatorInstances.some((indicator) => indicator.kind === kind)
      ) {
        return pane;
      }
      return {
        ...pane,
        indicatorInstances: [
          ...pane.indicatorInstances,
          createIndicatorInstance(kind, {
            color: nextIndicatorInstanceColor(kind, pane.indicatorInstances),
          }),
        ],
      };
    });
  }

  function removeIndicator(instanceId: string) {
    removeIndicatorForPane(activeChartPane.id, instanceId);
  }

  function removeIndicatorForPane(paneId: string, instanceId: string) {
    updateChartPane(paneId, (pane) => ({
      ...pane,
      indicatorInstances: pane.indicatorInstances.filter((indicator) => indicator.id !== instanceId),
    }));
  }

  function toggleIndicatorVisibility(instanceId: string) {
    toggleIndicatorVisibilityForPane(activeChartPane.id, instanceId);
  }

  function toggleIndicatorVisibilityForPane(paneId: string, instanceId: string) {
    updateChartPane(paneId, (pane) => ({
      ...pane,
      indicatorInstances: pane.indicatorInstances.map((indicator) =>
        indicator.id === instanceId ? { ...indicator, visible: indicator.visible === false } : indicator,
      ),
    }));
  }

  function updateIndicatorSettings(instanceId: string, settings: Partial<IndicatorSettings>) {
    updateIndicatorSettingsForPane(activeChartPane.id, instanceId, settings);
  }

  function updateIndicatorSettingsForPane(
    paneId: string,
    instanceId: string,
    settings: Partial<IndicatorSettings>,
  ) {
    updateChartPane(paneId, (pane) => ({
      ...pane,
      indicatorInstances: pane.indicatorInstances.map((indicator) =>
        indicator.id === instanceId
          ? { ...indicator, settings: mergeIndicatorSettings(indicator.kind, { ...indicator.settings, ...settings }) }
          : indicator,
      ),
    }));
  }

  function changeMagnetModeForPane(paneId: string, magnetMode: MagnetMode) {
    updateChartPane(paneId, (pane) => ({ ...pane, magnetMode }));
  }

  function setPaneDrawings(paneId: string, nextDrawings: ChartDrawing[], recordUndo = true) {
    const paneSnapshot = chartPaneById(paneId).drawings;
    const sanitizedDrawings = sanitizeLiveDrawings(nextDrawings);
    if (recordUndo) {
      captureDrawingUndoSnapshot(paneSnapshot);
    } else {
      closeDrawingUndoBatch();
    }
    updateChartPane(paneId, (pane) => ({ ...pane, drawings: sanitizedDrawings }));
    return sanitizedDrawings;
  }

  function addDrawingToPane(paneId: string, drawing: ChartDrawing) {
    const pane = chartPaneById(paneId);
    setPaneDrawings(paneId, [...pane.drawings, drawing]);
    setActiveChartPaneId(paneId);
    setSelectedDrawingId(drawing.id);
  }

  function deleteDrawingForPane(paneId: string, drawingId: string) {
    const pane = chartPaneById(paneId);
    const targetDrawing = pane.drawings.find((drawing) => drawing.id === drawingId);
    if (!targetDrawing || targetDrawing.locked) {
      return;
    }
    setPaneDrawings(paneId, pane.drawings.filter((drawing) => drawing.id !== drawingId));
    setSelectedDrawingId(null);
  }

  function deleteDrawing(drawingId: string) {
    deleteDrawingForPane(activeChartPane.id, drawingId);
  }

  function clearDrawingsForPane(paneId: string) {
    const pane = chartPaneById(paneId);
    const nextDrawings = setPaneDrawings(paneId, pane.drawings.filter((drawing) => drawing.locked));
    if (!nextDrawings.some((drawing) => drawing.id === selectedDrawingId)) {
      setSelectedDrawingId(null);
    }
  }

  function clearDrawings() {
    clearDrawingsForPane(activeChartPane.id);
  }

  function updateDrawingForPane(
    paneId: string,
    updatedDrawing: ChartDrawing,
    coalesceUndo = false,
  ) {
    const pane = chartPaneById(paneId);
    if (coalesceUndo && drawingUndoBatchOpenRef.current) {
      if (drawingUndoBatchTimerRef.current != null) {
        window.clearTimeout(drawingUndoBatchTimerRef.current);
      }
    } else {
      captureDrawingUndoSnapshot(pane.drawings);
    }
    drawingUndoBatchOpenRef.current = coalesceUndo;
    if (coalesceUndo) {
      drawingUndoBatchTimerRef.current = window.setTimeout(closeDrawingUndoBatch, LIVE_DRAWING_UNDO_COALESCE_MS);
    }
    updateChartPane(paneId, (currentPane) => ({
      ...currentPane,
      drawings: sanitizeLiveDrawings(
        currentPane.drawings.map((drawing) => drawing.id === updatedDrawing.id ? updatedDrawing : drawing),
      ),
    }));
  }

  function updateDrawing(updatedDrawing: ChartDrawing, coalesceUndo = false) {
    updateDrawingForPane(activeChartPane.id, updatedDrawing, coalesceUndo);
  }

  function removeLastUnlockedDrawing() {
    const drawing = [...activeChartPane.drawings].reverse().find((item) => !item.locked);
    if (drawing) {
      deleteDrawing(drawing.id);
    }
  }

  function captureDrawingUndoSnapshot(snapshot: ChartDrawing[]) {
    closeDrawingUndoBatch();
    setDrawingUndoStack((current) => {
      const next = [...current, cloneLiveDrawings(snapshot)];
      return next.slice(-LIVE_DRAWING_UNDO_LIMIT);
    });
  }

  function closeDrawingUndoBatch() {
    drawingUndoBatchOpenRef.current = false;
    if (drawingUndoBatchTimerRef.current != null) {
      window.clearTimeout(drawingUndoBatchTimerRef.current);
      drawingUndoBatchTimerRef.current = null;
    }
  }

  function undoLastDrawingChange() {
    closeDrawingUndoBatch();
    const previousDrawings = drawingUndoStack[drawingUndoStack.length - 1];
    if (!previousDrawings) {
      return;
    }
    setDrawingUndoStack((current) => current.slice(0, -1));
    updateActiveChartPane((pane) => ({ ...pane, drawings: cloneLiveDrawings(previousDrawings) }));
    if (selectedDrawingId && !previousDrawings.some((drawing) => drawing.id === selectedDrawingId)) {
      setSelectedDrawingId(null);
    }
  }

  function saveChartLayout() {
    const payload = buildLiveChartLayoutPayload();
    const name = normalizeLiveLayoutName(layoutName);
    void saveAppStorageItem(LIVE_CHART_LAYOUT_STORAGE_KEY, payload);
    void saveAppStorageItem(ACTIVE_LIVE_CHART_LAYOUT_STORAGE_KEY, name);
    setLayoutName(name);
    setAvailableLayouts(saveNamedLiveChartLayout(name, payload));
    setChartLayoutSavedAt(Date.now());
  }

  function buildLiveChartLayoutPayload(): LiveChartLayout {
    const panes = chartPanes.map(sanitizeLiveChartPaneState);
    const activePane = panes.find((pane) => pane.id === activeChartPane.id) ?? panes[0];
    return {
      activePaneId: activePane?.id,
      chartSettings: sanitizeChartVisualSettings(activePane?.chartSettings),
      chartStyle: sanitizeLiveChartStyle(activePane?.chartStyle),
      drawings: sanitizeLiveDrawings(activePane?.drawings),
      indicatorInstances: sanitizeLiveIndicatorInstances(activePane?.indicatorInstances),
      magnetMode: sanitizeLiveMagnetMode(activePane?.magnetMode),
      paneLayout: chartPaneLayout,
      panes,
      showOrderOverlays: activePane?.showOrderOverlays ?? false,
      smoothCandles: activePane?.smoothCandles ?? false,
      syncSettings: sanitizeChartSyncSettings(chartSyncSettings),
      timeframe: sanitizeLiveTimeframe(activePane?.timeframe),
    };
  }

  function loadNamedChartLayout(name: string) {
    const record = loadLiveChartLayoutRecord(name);
    if (!record) {
      return;
    }
    applyChartLayout(record.layout);
    void saveAppStorageItem(ACTIVE_LIVE_CHART_LAYOUT_STORAGE_KEY, record.name);
    setLayoutName(record.name);
    setChartLayoutSavedAt(Date.now());
  }

  function deleteNamedChartLayout(name: string) {
    const nextNames = deleteLiveChartLayoutRecord(name);
    setAvailableLayouts(nextNames);
    if (normalizeLiveLayoutName(name) === normalizeLiveLayoutName(layoutName)) {
      setLayoutName(nextNames[0] ?? "Live Default");
      void saveAppStorageItem(ACTIVE_LIVE_CHART_LAYOUT_STORAGE_KEY, nextNames[0] ?? null);
    }
  }

  function applyChartLayout(layout: Partial<LiveChartLayout>) {
    const nextLayout = sanitizeChartPaneLayout(layout.paneLayout);
    const nextPanes = sanitizeLiveChartPanes(layout);
    const nextActivePane = nextPanes.find((pane) => pane.id === layout.activePaneId) ?? nextPanes[0];
    setChartPaneLayout(nextLayout);
    setChartPanes(nextPanes);
    setChartSyncSettings(sanitizeChartSyncSettings(layout.syncSettings));
    setActiveChartPaneId(nextActivePane?.id ?? "live-chart-pane-1");
    setSelectedDrawingId(null);
    setDrawingUndoStack([]);
  }

  return (
    <div
      className={`relative ${isFullscreen ? "chart-fullscreen-shell fixed inset-0 z-[90] overflow-auto bg-[#05070a]" : ""}`}
      ref={chartStudioRef}
    >
      {timeframeShortcutFeedback && <TimeframeShortcutOverlay feedback={timeframeShortcutFeedback} />}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex flex-wrap gap-2">
          <span className={`status-pill h-8 px-2 text-[11px] ${connectionStatus === "live" ? "text-emerald-100" : connectionStatus === "error" ? "text-rose-100" : ""}`}>
            {feedIssue === "stale" ? "Stale · review only" : feedIssue === "delayed" ? "Delayed" : feedIssue === "unsupported" ? "Unsupported" : connectionStatus === "live" ? "Streaming" : connectionStatus === "connecting" ? "Connecting" : connectionStatus === "error" ? "Offline" : "Idle"}
          </span>
          <span className={`status-pill h-8 px-2 text-[11px] ${changeTone}`}>
            {tickerChangeLabel}
          </span>
          <span className="status-pill h-8 px-2 text-[11px]">
            {formatChartTimeframeLabel(activeChartPane.timeframe)}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button className={`control-button h-9 px-3 text-xs ${chartToolsOpen ? "workspace-tab-active" : ""}`} onClick={() => {
            setChartSettingsPanelOpen(false);
            setChartToolsOpen((value) => !value);
          }} type="button">
            <SlidersHorizontal size={14} />
            Tools
          </button>
          <button className={`control-button h-9 px-3 text-xs ${chartSettingsPanelOpen ? "workspace-tab-active" : ""}`} onClick={() => {
            setChartToolsOpen(false);
            setChartSettingsPanelOpen(true);
            setChartSettingsOpenSignal((value) => value + 1);
          }} type="button">
            <Settings size={14} />
            Settings
          </button>
          <button className={`control-button h-9 px-3 text-xs ${layersPanelOpen ? "workspace-tab-active" : ""}`} onClick={() => setLayersPanelOpen((value) => !value)} type="button">
            <LayersIcon />
            Layers
          </button>
          <button className="control-button h-9 px-3 text-xs" onClick={toggleFullscreen} type="button">
            {isFullscreen ? <Minimize2 aria-hidden="true" size={14} /> : <Maximize2 aria-hidden="true" size={14} />}
            {isFullscreen ? "Exit" : "Full Screen"}
          </button>
        </div>
      </div>

      {(chartToolsOpen || chartSettingsPanelOpen) && (
        <ChartToolbar
          activePaneLabel={activePaneLabel}
          chartSettings={activeChartPane.chartSettings}
          chartStyle={activeChartPane.chartStyle}
          clearableDrawingsCount={activeChartPane.drawings.filter((drawing) => !drawing.locked).length}
          drawingTool={activeChartPane.drawingTool}
          drawingsCount={activeChartPane.drawings.length}
          indicatorInstances={activeChartPane.indicatorInstances}
          layoutName={layoutName}
          layoutNames={availableLayouts}
          magnetMode={activeChartPane.magnetMode}
          onAddIndicator={addIndicator}
          onChartSettingsChange={(settings) => updateActiveChartPane((pane) => ({ ...pane, chartSettings: sanitizeChartVisualSettings(settings) }))}
          onChartSettingsReset={() => updateActiveChartPane((pane) => ({ ...pane, chartSettings: DEFAULT_CHART_VISUAL_SETTINGS }))}
          onChartStyleChange={(chartStyle) => updateActiveChartPane((pane) => ({ ...pane, chartStyle }))}
          onClearDrawings={clearDrawings}
          onDeleteLayout={deleteNamedChartLayout}
          onDrawingToolChange={changeDrawingTool}
          onLayoutNameChange={setLayoutName}
          onLoadLayout={loadNamedChartLayout}
          onMagnetModeChange={(magnetMode) => updateActiveChartPane((pane) => ({ ...pane, magnetMode }))}
          onPaneLayoutChange={changeChartPaneLayout}
          onReplayTimeframeChange={changeReplayTimeframe}
          onSaveLayout={saveChartLayout}
          onSyncSettingsChange={setChartSyncSettings}
          onTimeframeChange={changeTimeframe}
          onRemoveIndicator={removeIndicator}
          onSettingsClose={() => setChartSettingsPanelOpen(false)}
          onSmoothCandlesChange={(smoothCandles) => updateActiveChartPane((pane) => ({ ...pane, smoothCandles }))}
          onToggleOrderOverlays={() => updateActiveChartPane((pane) => ({ ...pane, showOrderOverlays: !pane.showOrderOverlays }))}
          onUpdateIndicatorSettings={updateIndicatorSettings}
          orderOverlaysVisible={activeChartPane.showOrderOverlays}
          paneLayout={chartPaneLayout}
          replayTimeframe={activeChartPane.timeframe}
          replayTimeframeOptions={buildLiveTimeframeOptions(chartPanes)}
          savedLabel={savedLayoutLabel}
          settingsOpenSignal={chartSettingsOpenSignal}
          smoothCandles={activeChartPane.smoothCandles}
          sourceTimeframe={LIVE_SOURCE_TIMEFRAME}
          syncSettingKeys={LIVE_CHART_SYNC_SETTING_KEYS}
          syncSettings={chartSyncSettings}
          timeframe={activeChartPane.timeframe}
          toolsOpen={chartToolsOpen}
        />
      )}

      <div aria-busy={!enginesReady} className={`chart-studio-layout ${layersPanelOpen ? "" : "chart-studio-layout-focus"} p-3`} data-chart-engines-ready={enginesReady ? "true" : "false"}>
        <div className="min-w-0">
          <div className={`chart-pane-grid ${chartPaneLayoutDefinition.className}`}>
            {visibleChartPanes.map((pane, index) => {
              const paneActive = pane.id === activeChartPane.id;
              const paneDrawingControlsActive = shouldMountPaneDrawingControls(
                chartPaneLayoutDefinition.panes,
                paneActive,
              );
              const paneHasHistoricalFocus = Boolean(journalChartFocus && journalFocusMatchesSymbol(pane.symbol || symbolCode || symbol, journalChartFocus.symbol));
              const paneUsesPrimaryFeed = !paneHasHistoricalFocus && journalFocusMatchesSymbol(pane.symbol || symbolCode || symbol, symbolCode || symbol);
              const normalizedPane = paneMarketData[pane.id];
              const paneBars = paneUsesPrimaryFeed ? bars : normalizedPane?.bars ?? [];
              return (
                <div
                  className={`chart-pane-shell ${paneActive && isMultiChartLayout ? "chart-pane-shell-active" : ""} ${isMultiChartLayout ? "chart-pane-shell-with-header" : ""}`}
                  data-chart-engine-state={mountedPaneIds.has(pane.id) ? "mounted" : "pending"}
                  data-chart-pane-id={pane.id}
                  key={pane.id}
                  onFocusCapture={paneDrawingControlsActive ? undefined : () => selectChartPane(pane.id)}
                  onPointerEnter={paneDrawingControlsActive ? undefined : () => selectChartPane(pane.id)}
                  onPointerDownCapture={() => selectChartPane(pane.id)}
                >
                  {isMultiChartLayout && (
                    <div className="chart-pane-header">
                      <button
                        className={`chart-pane-select-button ${paneActive ? "chart-pane-select-button-active" : ""}`}
                        onClick={() => selectChartPane(pane.id)}
                        type="button"
                      >
                        Pane {index + 1}
                      </button>
                      <span>{pane.symbol || symbolCode || symbol} · {formatChartTimeframeLabel(pane.timeframe)}</span>
                    </div>
                  )}
                  {mountedPaneIds.has(pane.id) ? <TradingChart
                    bars={paneBars}
                    canUndoDrawingChange={paneActive && drawingUndoStack.length > 0}
                    chartSettings={pane.chartSettings}
                    chartStyle={pane.chartStyle}
                    confirmOrderLineModifications={false}
                    crosshairSyncBus={crosshairSyncBus}
                    drawingTool={pane.drawingTool}
                    drawings={pane.drawings}
                    executions={[]}
                    indicatorInstances={pane.indicatorInstances}
                    indicatorRuntimeMode="live"
                    magnetMode={pane.magnetMode}
                    neutralDrawingTool={lastNeutralDrawingToolRef.current}
                    onAddDrawing={(drawing) => addDrawingToPane(pane.id, drawing)}
                    onAmendOrder={() => undefined}
                    onClearDrawings={() => clearDrawingsForPane(pane.id)}
                    onClosePositionFraction={() => undefined}
                    onDeleteDrawing={(drawingId) => deleteDrawingForPane(pane.id, drawingId)}
                    onDrawingToolChange={(tool) => changeDrawingToolForPane(pane.id, tool)}
                    onMagnetModeChange={(magnetMode) => changeMagnetModeForPane(pane.id, magnetMode)}
                    onRemoveIndicator={(instanceId) => removeIndicatorForPane(pane.id, instanceId)}
                    onSelectDrawing={(drawingId) => {
                      selectChartPane(pane.id);
                      setSelectedDrawingId(drawingId);
                    }}
                    onToggleIndicatorVisibility={(instanceId) => toggleIndicatorVisibilityForPane(pane.id, instanceId)}
                    onUndoDrawingChange={paneActive ? undoLastDrawingChange : () => selectChartPane(pane.id)}
                    onUpdateDrawing={(drawing, coalesceUndo) => updateDrawingForPane(pane.id, drawing, coalesceUndo)}
                    onUpdateIndicatorSettings={(instanceId, settings) =>
                      updateIndicatorSettingsForPane(pane.id, instanceId, settings)
                    }
                    onUpdatePosition={() => undefined}
                    orders={[]}
                    paneId={pane.id}
                    position={null}
                    pnlMultiplier={1}
                    replayFocusTrade={null}
                    dataState={paneUsesPrimaryFeed ? connectionStatus === "connecting" && !paneBars.length ? undefined : { status: paneBars.length ? "available" : "empty", detail: paneBars.length ? "Live provider candles." : "No candles were returned for this symbol and timeframe." } : { status: normalizedPane?.status === "available" ? "available" : normalizedPane?.status === "empty" ? "empty" : "unavailable", detail: normalizedPane?.detail ?? `Subscribing ${pane.symbol} through normalized market data.` }}
                    selectedDrawingId={paneActive ? selectedDrawingId : null}
                    drawingControlsActive={paneDrawingControlsActive}
                    showOrderOverlays={pane.showOrderOverlays}
                    symbol={pane.symbol || symbolCode || symbol}
                    syncedVisibleRange={journalFocusRange ? { ...journalFocusRange, revision: journalFocusRange.revision + paneBars.length } : null}
                    currency="USD"
                    datasetTimeframe={LIVE_SOURCE_TIMEFRAME}
                    timeframe={pane.timeframe}
                    undoShortcutLabel="⌘Z"
                  /> : <div aria-label={`Pane ${index + 1} chart engine loading`} className="chart-engine-placeholder grid h-full min-h-0 place-items-center bg-black/20 text-xs text-slate-500" role="status">Loading chart engine…</div>}
                </div>
              );
            })}
          </div>
          {bars.length === 0 && connectionStatus === "connecting" ? (
            <div aria-label="Live chart skeleton" className="mt-3 space-y-2 rounded-md border border-white/10 bg-black/30 px-4 py-3" role="status">
              <span className="sr-only">Loading live chart data</span>
              <div className="h-3 w-40 animate-pulse rounded bg-white/10 motion-reduce:animate-none" />
              <div className="h-3 w-64 max-w-full animate-pulse rounded bg-white/[0.06] motion-reduce:animate-none" />
            </div>
          ) : bars.length === 0 ? (
            <div aria-label="Live chart empty state" className="mt-3 rounded-md border border-white/10 bg-black/30 px-4 py-3 text-sm text-slate-400" role="status">
              <strong className="block text-slate-200">{symbol ? "No live chart data" : "No symbol selected"}</strong>
              <span className="mt-1 block text-xs">{symbol ? "No candles were returned for this symbol and timeframe." : "Select a symbol to load the chart."}</span>
            </div>
          ) : null}
        </div>
        {layersPanelOpen && (
          <ChartObjectsPanel
            chartStyle={activeChartPane.chartStyle}
            drawings={activeChartPane.drawings}
            indicatorInstances={activeChartPane.indicatorInstances}
            onClearDrawings={clearDrawings}
            onCollapse={() => setLayersPanelOpen(false)}
            onDeleteDrawing={deleteDrawing}
            onRemoveIndicator={removeIndicator}
            onSelectDrawing={setSelectedDrawingId}
            onToggleIndicatorVisibility={toggleIndicatorVisibility}
            onToggleOrderOverlays={() => updateActiveChartPane((pane) => ({ ...pane, showOrderOverlays: !pane.showOrderOverlays }))}
            onUpdateDrawing={(drawing) => updateDrawing(drawing)}
            onUpdateIndicatorSettings={updateIndicatorSettings}
            orderOverlaysVisible={activeChartPane.showOrderOverlays}
            selectedDrawingId={selectedDrawingId}
            smoothCandles={activeChartPane.chartStyle === "heikinAshi" || activeChartPane.smoothCandles}
          />
        )}
      </div>
    </div>
  );
});

function LayersIcon() {
  return <Layers size={14} />;
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

function loadLiveChartLayout(): Partial<LiveChartLayout> | null {
  try {
    const activeName = getCachedAppStorageItem<string | null>(
      ACTIVE_LIVE_CHART_LAYOUT_STORAGE_KEY,
      null,
    );
    const activeRecord = activeName ? loadLiveChartLayoutRecord(activeName) : null;
    if (activeRecord) {
      return sanitizeLiveChartLayout(activeRecord.layout);
    }

    const parsed = getCachedAppStorageItem<unknown>(LIVE_CHART_LAYOUT_STORAGE_KEY, null);
    if (typeof parsed !== "object" || parsed == null) {
      return null;
    }
    return sanitizeLiveChartLayout(parsed);
  } catch {
    return null;
  }
}

function sanitizeLiveChartLayout(value: unknown): LiveChartLayout {
  const layout = isPlainRecord(value) ? value : {};
  const paneLayout = sanitizeChartPaneLayout(layout.paneLayout);
  const panes = sanitizeLiveChartPanes({ ...layout, paneLayout });
  const activePane = panes.find((pane) => pane.id === layout.activePaneId) ?? panes[0];
  return {
    activePaneId: activePane?.id,
    chartSettings: sanitizeChartVisualSettings(
      layout.chartSettings as Partial<ChartVisualSettings> | null | undefined,
    ),
    chartStyle: sanitizeLiveChartStyle(layout.chartStyle),
    drawings: sanitizeLiveDrawings(layout.drawings),
    indicatorInstances: sanitizeLiveIndicatorInstances(layout.indicatorInstances),
    magnetMode: sanitizeLiveMagnetMode(layout.magnetMode),
    paneLayout,
    panes,
    showOrderOverlays: layout.showOrderOverlays === true,
    smoothCandles: layout.smoothCandles === true,
    syncSettings: sanitizeChartSyncSettings(layout.syncSettings),
    timeframe: sanitizeLiveTimeframe(layout.timeframe),
  };
}

function sanitizeLiveChartPanes(layout: Partial<LiveChartLayout>): LiveChartPaneState[] {
  const paneLayout = sanitizeChartPaneLayout(layout.paneLayout ?? DEFAULT_CHART_PANE_LAYOUT);
  const paneCount = chartPaneLayoutById(paneLayout).panes;
  const legacyPane = {
    chartSettings: layout.chartSettings,
    chartStyle: layout.chartStyle,
    drawingTool: "crosshair" as DrawingTool,
    drawings: layout.drawings,
    id: "live-chart-pane-1",
    indicatorInstances: layout.indicatorInstances,
    magnetMode: layout.magnetMode,
    showOrderOverlays: layout.showOrderOverlays,
    smoothCandles: layout.smoothCandles,
    symbol: "",
    timeframe: layout.timeframe,
  };
  const rawPanes =
    Array.isArray(layout.panes) && layout.panes.length > 0
      ? layout.panes
      : [legacyPane];
  const panes = rawPanes.map((pane, index) => sanitizeLiveChartPaneState(pane, index));
  const seenIds = new Set<string>();
  const uniquePanes = panes.map((pane, index) => {
    const fallbackId = `live-chart-pane-${index + 1}`;
    const id = seenIds.has(pane.id) ? fallbackId : pane.id;
    seenIds.add(id);
    return { ...pane, id };
  });

  while (uniquePanes.length < paneCount) {
    uniquePanes.push(createDefaultLiveChartPane(uniquePanes.length, uniquePanes[0]));
  }

  return uniquePanes.slice(0, Math.max(paneCount, uniquePanes.length));
}

function sanitizeLiveChartPaneState(value: unknown, index = 0): LiveChartPaneState {
  const candidate = isPlainRecord(value) ? value : {};
  const fallback = createDefaultLiveChartPane(index);
  const id =
    typeof candidate.id === "string" && candidate.id.trim().length > 0
      ? candidate.id.trim().slice(0, 80)
      : fallback.id;
  return {
    ...fallback,
    chartSettings: sanitizeChartVisualSettings(
      candidate.chartSettings as Partial<ChartVisualSettings> | null | undefined,
    ),
    chartStyle: sanitizeLiveChartStyle(candidate.chartStyle),
    drawingTool: sanitizeLiveDrawingTool(candidate.drawingTool),
    drawings: sanitizeLiveDrawings(candidate.drawings),
    id,
    indicatorInstances: sanitizeLiveIndicatorInstances(candidate.indicatorInstances),
    magnetMode: sanitizeLiveMagnetMode(candidate.magnetMode),
    showOrderOverlays: candidate.showOrderOverlays === true,
    smoothCandles: candidate.smoothCandles === true,
    symbol: typeof candidate.symbol === "string" ? candidate.symbol.trim().slice(0, 96) : fallback.symbol,
    timeframe: sanitizeLiveTimeframe(candidate.timeframe),
  };
}

function createDefaultLiveChartPane(
  index: number,
  template?: Partial<LiveChartPaneState> | null,
): LiveChartPaneState {
  return {
    chartSettings: sanitizeChartVisualSettings(template?.chartSettings),
    chartStyle: sanitizeLiveChartStyle(template?.chartStyle),
    drawingTool: sanitizeLiveDrawingTool(template?.drawingTool),
    drawings: [],
    id: `live-chart-pane-${index + 1}`,
    indicatorInstances: sanitizeLiveIndicatorInstances(template?.indicatorInstances),
    magnetMode: sanitizeLiveMagnetMode(template?.magnetMode),
    showOrderOverlays: template?.showOrderOverlays === true,
    smoothCandles: template?.smoothCandles === true,
    symbol: typeof template?.symbol === "string" ? template.symbol : "",
    timeframe: sanitizeLiveTimeframe(template?.timeframe ?? LIVE_SOURCE_TIMEFRAME),
  };
}

function sanitizeLiveDrawings(value: unknown): ChartDrawing[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((drawing): ChartDrawing[] => {
    if (!isPlainRecord(drawing)) {
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
        (typeof candidate.fillOpacity === "number" && Number.isFinite(candidate.fillOpacity))) &&
      (candidate.fibExtendLeft == null || typeof candidate.fibExtendLeft === "boolean") &&
      (candidate.fibExtendRight == null || typeof candidate.fibExtendRight === "boolean") &&
      (candidate.label == null || typeof candidate.label === "string") &&
      (candidate.labelBackgroundOpacity == null ||
        (typeof candidate.labelBackgroundOpacity === "number" && Number.isFinite(candidate.labelBackgroundOpacity))) &&
      (candidate.lineStyle == null || ["solid", "dashed", "dotted"].includes(candidate.lineStyle)) &&
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
    const riskAdjusted = normalizeRiskRewardDrawing(normalized);
    return [
      riskAdjusted.tool === "measure" && riskAdjusted.lineStyle === "dashed"
        ? { ...riskAdjusted, lineStyle: "solid" }
        : riskAdjusted,
    ];
  });
}

function cloneLiveDrawings(drawings: ChartDrawing[]) {
  return drawings.map((drawing) => ({
    ...drawing,
    fibLevels: drawing.fibLevels?.map((level) => ({ ...level })),
    points: drawing.points.map((point) => ({ ...point })),
  }));
}

function sanitizeLiveChartStyle(value: unknown): ChartStyle {
  return ["area", "candles", "heikinAshi", "line"].includes(value as ChartStyle)
    ? (value as ChartStyle)
    : "candles";
}

function sanitizeLiveMagnetMode(value: unknown): MagnetMode {
  return value === "weak" || value === "strong" ? value : "off";
}

function sanitizeLiveDrawingTool(value: unknown): DrawingTool {
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

function sanitizeLiveIndicatorInstances(value: unknown): ChartIndicatorInstance[] {
  if (!Array.isArray(value)) {
    return [createIndicatorInstance("ema")];
  }
  return value
    .map((item) => sanitizeLiveIndicatorInstance(item))
    .filter((item): item is ChartIndicatorInstance => item != null);
}

function sanitizeLiveIndicatorInstance(value: unknown): ChartIndicatorInstance | null {
  if (!isPlainRecord(value)) {
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
    settings: mergeIndicatorSettings(candidate.kind, candidate.settings),
  };
}

function sanitizeLiveTimeframe(value: unknown): ChartTimeframe {
  const normalized = normalizeChartTimeframe(value) ?? LIVE_SOURCE_TIMEFRAME;
  return canAggregateTimeframe(normalized, LIVE_SOURCE_TIMEFRAME)
    ? normalized
    : LIVE_SOURCE_TIMEFRAME;
}

function buildLiveTimeframeOptions(panes: LiveChartPaneState[]) {
  const candidateTimeframes = [
    LIVE_SOURCE_TIMEFRAME,
    ...panes.map((pane) => sanitizeLiveTimeframe(pane.timeframe)),
    ...TIMEFRAMES.map((timeframe) => timeframe.id),
  ];
  const seen = new Set<string>();
  return candidateTimeframes
    .flatMap((timeframe) => {
      const normalized = normalizeChartTimeframe(timeframe);
      if (!normalized || seen.has(normalized) || !canAggregateTimeframe(normalized, LIVE_SOURCE_TIMEFRAME)) {
        return [];
      }
      seen.add(normalized);
      return [normalized];
    })
    .sort((left, right) => getTimeframeSeconds(left) - getTimeframeSeconds(right) || left.localeCompare(right))
    .map((normalized) => {
      const stepBars = Math.max(
        1,
        Math.round(getTimeframeSeconds(normalized) / getTimeframeSeconds(LIVE_SOURCE_TIMEFRAME)),
      );
      return {
        label: `${formatChartTimeframeLabel(normalized)} bars`,
        sublabel: stepBars === 1 ? "Live source" : `${stepBars} source bars`,
        value: normalized,
      };
    });
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

function loadActiveLiveChartLayoutName() {
  return normalizeLiveLayoutName(
    getCachedAppStorageItem<string | null>(ACTIVE_LIVE_CHART_LAYOUT_STORAGE_KEY, null) ?? "Live Default",
  );
}

function loadLiveChartLayoutRecord(name: string) {
  const normalized = normalizeLiveLayoutName(name);
  return loadLiveChartLayoutRecords().find(
    (record) => normalizeLiveLayoutName(record.name) === normalized,
  );
}

function loadLiveChartLayoutRecords(): LiveChartLayoutRecord[] {
  try {
    const parsed = getCachedAppStorageItem<unknown>(LIVE_CHART_LAYOUTS_STORAGE_KEY, []);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((record): record is LiveChartLayoutRecord => {
        if (!isPlainRecord(record)) {
          return false;
        }
        return (
          typeof record.name === "string" &&
          typeof record.updatedAt === "string" &&
          typeof record.layout === "object" &&
          record.layout != null
        );
      })
      .map((record) => ({
        ...record,
        layout: sanitizeLiveChartLayout(record.layout),
        name: normalizeLiveLayoutName(record.name),
      }));
  } catch {
    return [];
  }
}

function saveNamedLiveChartLayout(name: string, layout: LiveChartLayout) {
  const normalizedName = normalizeLiveLayoutName(name);
  const records = loadLiveChartLayoutRecords().filter(
    (record) => normalizeLiveLayoutName(record.name) !== normalizedName,
  );
  const nextRecords = [
    {
      layout: sanitizeLiveChartLayout(layout),
      name: normalizedName,
      updatedAt: new Date().toISOString(),
    },
    ...records,
  ].slice(0, 12);
  void saveAppStorageItem(LIVE_CHART_LAYOUTS_STORAGE_KEY, nextRecords);
  return nextRecords.map((record) => record.name);
}

function deleteLiveChartLayoutRecord(name: string) {
  const normalizedName = normalizeLiveLayoutName(name);
  const nextRecords = loadLiveChartLayoutRecords().filter(
    (record) => normalizeLiveLayoutName(record.name) !== normalizedName,
  );
  void saveAppStorageItem(LIVE_CHART_LAYOUTS_STORAGE_KEY, nextRecords);
  return nextRecords.map((record) => record.name);
}

function normalizeLiveLayoutName(name: string) {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 48) : "Live Default";
}

function LiveInstrumentSuggestionList({ children }: { children: ReactNode }) {
  return (
    <div className="absolute left-0 right-0 top-12 z-20 max-h-72 overflow-auto rounded-md border border-white/10 bg-[#080c11] p-1 shadow-panel">
      {children}
    </div>
  );
}

function liveWatchlistSymbol(
  symbol: string,
  options: {
    assetClass?: LiveAssetClass;
    description?: string;
    exchange?: string;
    exchangeType?: number;
    feed?: LiveFeedProvider;
    instrumentType?: string;
    label?: string;
    token?: string;
  } = {},
): LiveWatchlistSymbol {
  const feed = options.feed ?? "binance";
  const normalized = feed === "binance" ? normalizeLiveSymbolInput(symbol) : symbol.trim();
  return {
    color: liveSymbolColor(options.token ?? normalized),
    assetClass: options.assetClass ?? (feed === "binance" ? "crypto" : "other"),
    description: options.description,
    exchange: options.exchange,
    exchangeType: options.exchangeType,
    feed,
    instrumentType: options.instrumentType,
    label: options.label ?? normalized,
    symbol: normalized,
    token: options.token,
  };
}

function sanitizeLiveWatchlists(value: unknown): LiveWatchlist[] {
  const source = Array.isArray(value) ? value : DEFAULT_LIVE_WATCHLISTS;
  const sanitized = source
    .map((watchlist, index) => sanitizeLiveWatchlist(watchlist, index))
    .filter((watchlist) => watchlist.name.trim().length > 0);
  const next = sanitized.length > 0
    ? sanitized
    : DEFAULT_LIVE_WATCHLISTS.map((watchlist, index) => sanitizeLiveWatchlist(watchlist, index));
  const hasDukascopy = next.some((watchlist) => watchlist.symbols.some((symbol) => symbol.feed === "dukascopy"));
  const hasAngelOne = next.some((watchlist) => watchlist.symbols.some((symbol) => symbol.feed === "angelone"));
  if ((!hasDukascopy || !hasAngelOne) && next.some((watchlist) => watchlist.id === "crypto-majors")) {
    return [
      ...next,
      ...(!hasDukascopy ? [sanitizeLiveWatchlist(DEFAULT_LIVE_WATCHLISTS[1], next.length)] : []),
      ...(!hasAngelOne ? [sanitizeLiveWatchlist(DEFAULT_LIVE_WATCHLISTS[2], next.length + 1)] : []),
    ];
  }
  return next;
}

function sanitizeLiveWatchlist(value: unknown, index = 0): LiveWatchlist {
  const record = isPlainRecord(value) ? value : {};
  const rawId = typeof record.id === "string" ? record.id.trim() : "";
  const rawName = typeof record.name === "string" ? record.name.trim() : "";
  const symbols = Array.isArray(record.symbols)
    ? sanitizeLiveSymbols(record.symbols)
    : [];

  return {
    id: rawId || `live-watchlist-${index + 1}`,
    name: rawName || `Watchlist ${index + 1}`,
    symbols,
  };
}

function sanitizeLiveSymbols(value: unknown[]): LiveWatchlistSymbol[] {
  const seen = new Set<string>();
  const symbols: LiveWatchlistSymbol[] = [];
  for (const item of value) {
    const record = isPlainRecord(item) ? item : null;
    const rawSymbol = record && typeof record.symbol === "string" ? record.symbol : typeof item === "string" ? item : "";
    const feed = isLiveFeedProvider(record?.feed) ? record.feed : "binance";
    const symbol = feed === "binance" ? normalizeLiveSymbolInput(rawSymbol) : rawSymbol.trim();
    const token = record && typeof record.token === "string" ? record.token.trim() : undefined;
    const exchangeType = record && typeof record.exchangeType === "number" ? record.exchangeType : undefined;
    const key = feed === "angelone" && token && exchangeType ? `angelone:${exchangeType}:${token}` : liveSymbolStorageKey(feed, symbol);
    if (!symbol || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const label = record && typeof record.label === "string"
      ? record.label.trim().slice(0, 40) || symbol
      : symbol;
    const rawColor = record && typeof record.color === "string" ? record.color.trim() : "";
    const rawAssetClass = record && typeof record.assetClass === "string" ? record.assetClass : undefined;
    const exchange = record && typeof record.exchange === "string" ? record.exchange.trim() : undefined;
    const instrumentType = record && typeof record.instrumentType === "string" ? record.instrumentType.trim() : undefined;
    symbols.push({
      assetClass: isLiveAssetClass(rawAssetClass) ? rawAssetClass : feed === "binance" ? "crypto" : "other",
      color: isValidLiveColor(rawColor) ? rawColor : liveSymbolColor(token ?? symbol),
      description: record && typeof record.description === "string" ? record.description.trim() : undefined,
      exchange,
      exchangeType,
      feed,
      instrumentType,
      label,
      symbol,
      token,
    });
    if (symbols.length >= LIVE_MAX_WATCHLIST_SYMBOLS) {
      break;
    }
  }
  return symbols;
}

function uniqueLiveSymbols(symbols: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of symbols) {
    const symbol = normalizeLiveSymbolInput(value);
    if (!symbol || seen.has(symbol)) {
      continue;
    }
    seen.add(symbol);
    unique.push(symbol);
  }
  return unique.slice(0, LIVE_MAX_WATCHLIST_SYMBOLS);
}

function normalizeLiveSymbolInput(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function splitBinanceSymbol(symbol: string) {
  const normalized = normalizeLiveSymbolInput(symbol);
  const quoteAssets = ["USDT", "USDC", "FDUSD", "BUSD", "BTC", "ETH", "BNB", "TRY", "EUR", "BRL", "GBP"];
  const quoteAsset = quoteAssets.find((quote) => normalized.endsWith(quote)) ?? "";
  const baseAsset = quoteAsset ? normalized.slice(0, -quoteAsset.length) : normalized;
  return {
    baseAsset: baseAsset || normalized,
    quoteAsset: quoteAsset || "SPOT",
  };
}

async function fetchBinanceTickers(symbols: string[], signal: AbortSignal): Promise<Record<string, LiveTicker>> {
  const uniqueSymbols = uniqueLiveSymbols(symbols);
  if (uniqueSymbols.length === 0) {
    return {};
  }
  const query = new URLSearchParams({
    symbols: JSON.stringify(uniqueSymbols),
  });
  const response = await fetch(`${BINANCE_REST_BASE}/api/v3/ticker/24hr?${query}`, { signal });
  if (!response.ok) {
    throw new Error(`Binance ticker request failed (${response.status})`);
  }
  const payload = await response.json() as unknown;
  const rows = Array.isArray(payload) ? payload : [payload];
  const tickers: Record<string, LiveTicker> = {};
  for (const row of rows) {
    const ticker = isBinanceTickerPayload(row)
      ? liveTickerFromBinance(row)
      : isBinanceRestTickerPayload(row)
        ? liveTickerFromBinanceRest(row)
        : null;
    if (ticker) {
      tickers[ticker.symbol] = ticker;
    }
  }
  return tickers;
}

function prefixLiveTickers(feed: LiveFeedProvider, tickers: Record<string, LiveTicker>) {
  return Object.fromEntries(
    Object.entries(tickers).map(([symbol, ticker]) => [liveSymbolStorageKey(feed, symbol), ticker]),
  );
}

async function fetchBinanceKlines(
  symbol: string,
  interval: (typeof LIVE_TIMEFRAMES)[number]["binanceInterval"],
  signal: AbortSignal,
  limit = LIVE_PROVIDER_PAGE_BARS,
  endTimeMs?: number,
): Promise<Candle[]> {
  const normalized = normalizeLiveSymbolInput(symbol);
  if (!normalized) {
    return [];
  }
  const query = new URLSearchParams({
    interval,
    limit: String(Math.max(1, Math.min(LIVE_PROVIDER_PAGE_BARS, Math.floor(limit)))),
    symbol: normalized,
  });
  if (endTimeMs != null && Number.isFinite(endTimeMs)) {
    query.set("endTime", String(Math.max(0, Math.floor(endTimeMs))));
  }
  const response = await fetch(`${BINANCE_REST_BASE}/api/v3/klines?${query}`, { signal });
  if (!response.ok) {
    throw new Error(`Binance candle request failed (${response.status})`);
  }
  const payload = await response.json() as unknown;
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload
    .map(liveCandleFromRestKline)
    .filter((candle): candle is Candle => candle !== null)
    .sort((left, right) => left.time - right.time);
}

async function fetchBinanceHistoricalCandles(
  symbol: string,
  interval: (typeof LIVE_TIMEFRAMES)[number]["binanceInterval"],
  signal: AbortSignal,
  targetBars = LIVE_HISTORY_TARGET_BARS,
): Promise<Candle[]> {
  let beforeTimeMs: number | undefined;
  let merged: Candle[] = [];
  while (!signal.aborted && merged.length < targetBars) {
    const remaining = targetBars - merged.length;
    const page = await fetchBinanceKlines(
      symbol,
      interval,
      signal,
      Math.min(LIVE_PROVIDER_PAGE_BARS, remaining),
      beforeTimeMs,
    );
    if (signal.aborted || page.length === 0) {
      break;
    }
    merged = mergeLiveCandles(merged, page, targetBars);
    const oldestTime = page[0]?.time;
    if (!Number.isFinite(oldestTime)) {
      break;
    }
    const nextBeforeTimeMs = oldestTime * 1000 - 1;
    if (beforeTimeMs != null && nextBeforeTimeMs >= beforeTimeMs) {
      break;
    }
    beforeTimeMs = nextBeforeTimeMs;
    if (page.length < Math.min(LIVE_PROVIDER_PAGE_BARS, remaining)) {
      break;
    }
  }
  return merged;
}

async function fetchLiveMarketCatalog(): Promise<LiveMarketCatalog> {
  const [binanceResponse, dukascopyResponse] = await Promise.all([
    getBinanceInstruments("", LIVE_CATALOG_LIMITS.binance),
    getDukascopyInstruments("", LIVE_CATALOG_LIMITS.dukascopy),
  ]);
  const angelOneResponse = await getAngelOneInstruments("", LIVE_CATALOG_LIMITS.angelone);
  return sanitizeLiveMarketCatalog({
    angelone: angelOneResponse.instruments.map(apiAngelOneInstrumentToLive),
    binance: binanceResponse.instruments.map(apiBinanceInstrumentToLive),
    dukascopy: dukascopyResponse.instruments.map(apiDukascopyInstrumentToLive),
    refreshedAt: new Date().toISOString(),
  });
}

function apiBinanceInstrumentToLive(instrument: ApiBinanceInstrument): BinanceInstrument {
  return {
    assetClass: "crypto",
    baseAsset: instrument.base_asset,
    description: instrument.description,
    label: instrument.label,
    quoteAsset: instrument.quote_asset,
    status: instrument.status,
    symbol: instrument.symbol,
  };
}

function apiDukascopyInstrumentToLive(instrument: ApiDukascopyInstrument): DukascopyInstrument {
  return {
    assetClass: isLiveAssetClass(instrument.asset_class) ? instrument.asset_class : "other",
    baseCurrency: instrument.base_currency,
    description: instrument.description,
    label: instrument.label,
    quoteCurrency: instrument.quote_currency,
    symbol: instrument.symbol,
    tags: instrument.tags,
  };
}

function apiAngelOneInstrumentToLive(instrument: ApiAngelOneInstrument): AngelOneInstrument {
  return {
    assetClass: isLiveAssetClass(instrument.asset_class) ? instrument.asset_class : "other",
    description: instrument.description,
    exchange: instrument.exchange,
    exchangeType: instrument.exchange_type,
    expiry: instrument.expiry,
    instrumentType: instrument.instrument_type,
    label: instrument.label,
    lotSize: instrument.lot_size,
    name: instrument.name,
    symbol: instrument.symbol,
    tickSize: instrument.tick_size,
    token: instrument.token,
  };
}

async function fetchDukascopyCandles(
  symbol: string,
  interval: (typeof LIVE_TIMEFRAMES)[number]["dukascopyInterval"],
  signal: AbortSignal,
  limit = 260,
  beforeTimeMs?: number,
): Promise<Candle[]> {
  const response = await getDukascopyCandles(symbol, interval, limit, beforeTimeMs);
  if (signal.aborted) {
    return [];
  }
  return response.candles
    .map((candle) =>
      createLiveCandle(
        candle.time,
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        candle.volume,
      ),
    )
    .sort((left, right) => left.time - right.time);
}

async function fetchDukascopyHistoricalCandles(
  symbol: string,
  interval: (typeof LIVE_TIMEFRAMES)[number]["dukascopyInterval"],
  signal: AbortSignal,
  targetBars = LIVE_HISTORY_TARGET_BARS,
): Promise<Candle[]> {
  let beforeTimeMs: number | undefined;
  let merged: Candle[] = [];
  while (!signal.aborted && merged.length < targetBars) {
    const remaining = targetBars - merged.length;
    const page = await fetchDukascopyCandles(
      symbol,
      interval,
      signal,
      Math.min(LIVE_PROVIDER_PAGE_BARS, remaining),
      beforeTimeMs,
    );
    if (signal.aborted || page.length === 0) {
      break;
    }
    merged = mergeLiveCandles(merged, page, targetBars);
    const oldestTime = page[0]?.time;
    if (!Number.isFinite(oldestTime)) {
      break;
    }
    const nextBeforeTimeMs = oldestTime * 1000 - 1;
    if (beforeTimeMs != null && nextBeforeTimeMs >= beforeTimeMs) {
      break;
    }
    beforeTimeMs = nextBeforeTimeMs;
    if (page.length < Math.min(LIVE_PROVIDER_PAGE_BARS, remaining)) {
      break;
    }
  }
  return merged;
}

function defaultBinanceInstruments(): BinanceInstrument[] {
  return BINANCE_FEATURED_SYMBOLS.map((symbol) => {
    const { baseAsset, quoteAsset } = splitBinanceSymbol(symbol);
    return {
      assetClass: "crypto",
      baseAsset,
      description: `${baseAsset} / ${quoteAsset} spot pair`,
      label: `${baseAsset}/${quoteAsset}`,
      quoteAsset,
      status: "TRADING",
      symbol,
    };
  });
}

function defaultDukascopyInstruments(): DukascopyInstrument[] {
  return [
    ["EUR/USD", "EUR/USD", "Euro vs US Dollar", "forex", "EUR", "USD"],
    ["GBP/USD", "GBP/USD", "Pound Sterling vs US Dollar", "forex", "GBP", "USD"],
    ["USD/JPY", "USD/JPY", "US Dollar vs Japanese Yen", "forex", "USD", "JPY"],
    ["XAU/USD", "XAU/USD", "Spot gold", "commodity", "XAU", "USD"],
    ["XAG/USD", "XAG/USD", "Spot silver", "commodity", "XAG", "USD"],
    ["E_Brent", "BRENT", "US Brent Crude Oil", "commodity", "BRENT", "USD"],
    ["E_Light", "WTI", "US Light Crude Oil", "commodity", "WTI", "USD"],
    ["E_SandP-500", "S&P 500", "USA 500 Index", "index", "SPX", "USD"],
    ["E_NQ-100", "NASDAQ 100", "USA 100 Technical Index", "index", "NDX", "USD"],
    ["E_D&J-Ind", "DOW 30", "USA 30 Index", "index", "DJI", "USD"],
    ["E_DAAX", "DAX 40", "Germany 40 Index", "index", "DAX", "EUR"],
    ["AAPL.US/USD", "AAPL", "APPLE INC", "equity", "AAPL.US", "USD"],
    ["TSLA.US/USD", "TSLA", "TESLA MOTORS INC", "equity", "TSLA.US", "USD"],
    ["SPY.US/USD", "SPY", "SPDR S&P 500 ETF", "etf", "SPY.US", "USD"],
  ].map(([symbol, label, description, assetClass, baseCurrency, quoteCurrency]) => ({
    assetClass: assetClass as LiveAssetClass,
    baseCurrency,
    description,
    label,
    quoteCurrency,
    symbol,
    tags: [],
  }));
}

function defaultAngelOneInstruments(): AngelOneInstrument[] {
  return [
    ["99926000", "Nifty 50", "NIFTY", "NSE", 1, "index", "NSE index"],
    ["99926009", "Nifty Bank", "BANKNIFTY", "NSE", 1, "index", "NSE index"],
    ["99919000", "SENSEX", "SENSEX", "BSE", 3, "index", "BSE index"],
    ["2885", "RELIANCE-EQ", "RELIANCE", "NSE", 1, "equity", "NSE equity"],
    ["3045", "SBIN-EQ", "SBIN", "NSE", 1, "equity", "NSE equity"],
    ["11536", "TCS-EQ", "TCS", "NSE", 1, "equity", "NSE equity"],
    ["1594", "INFY-EQ", "INFY", "NSE", 1, "equity", "NSE equity"],
    ["1333", "HDFCBANK-EQ", "HDFCBANK", "NSE", 1, "equity", "NSE equity"],
    ["4963", "ICICIBANK-EQ", "ICICIBANK", "NSE", 1, "equity", "NSE equity"],
  ].map(([token, symbol, name, exchange, exchangeType, assetClass, description]) => ({
    assetClass: assetClass as LiveAssetClass,
    description: description as string,
    exchange: exchange as string,
    exchangeType: exchangeType as number,
    expiry: null,
    instrumentType: assetClass === "index" ? "AMXIDX" : "",
    label: name as string,
    lotSize: 1,
    name: name as string,
    symbol: symbol as string,
    tickSize: null,
    token: token as string,
  }));
}

function parseBinanceCombinedPayload(raw: unknown): unknown {
  if (typeof raw !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isPlainRecord(parsed) && "data" in parsed ? parsed.data : parsed;
  } catch {
    return null;
  }
}

function isBinanceTickerPayload(value: unknown): value is BinanceTickerPayload {
  if (!isPlainRecord(value)) {
    return false;
  }
  return typeof value.s === "string" && typeof value.c === "string" && !isPlainRecord(value.k);
}

function isBinanceRestTickerPayload(value: unknown): value is BinanceRestTickerPayload {
  return isPlainRecord(value) && typeof value.symbol === "string" && typeof value.lastPrice === "string";
}

function isBinanceKlinePayload(value: unknown): value is BinanceKlinePayload {
  return isPlainRecord(value) && typeof value.s === "string" && isPlainRecord(value.k);
}

function liveTickerFromBinance(payload: BinanceTickerPayload): LiveTicker | null {
  const symbol = normalizeLiveSymbolInput(payload.s ?? "");
  const last = liveNumber(payload.c);
  if (!symbol || last == null) {
    return null;
  }
  return {
    change: liveNumber(payload.p) ?? 0,
    changePercent: liveNumber(payload.P) ?? 0,
    high: liveNumber(payload.h) ?? last,
    last,
    low: liveNumber(payload.l) ?? last,
    quoteVolume: liveNumber(payload.q) ?? 0,
    symbol,
    updatedAt: Number.isFinite(payload.E) ? payload.E ?? Date.now() : Date.now(),
    volume: liveNumber(payload.v) ?? 0,
  };
}

function liveTickerFromBinanceRest(payload: BinanceRestTickerPayload): LiveTicker | null {
  const symbol = normalizeLiveSymbolInput(payload.symbol ?? "");
  const last = liveNumber(payload.lastPrice);
  if (!symbol || last == null) {
    return null;
  }
  return {
    change: liveNumber(payload.priceChange) ?? 0,
    changePercent: liveNumber(payload.priceChangePercent) ?? 0,
    high: liveNumber(payload.highPrice) ?? last,
    last,
    low: liveNumber(payload.lowPrice) ?? last,
    quoteVolume: liveNumber(payload.quoteVolume) ?? 0,
    symbol,
    updatedAt: Number.isFinite(payload.closeTime) ? payload.closeTime ?? Date.now() : Date.now(),
    volume: liveNumber(payload.volume) ?? 0,
  };
}

function liveTickerFromCandles(symbol: LiveWatchlistSymbol, candles: Candle[]): LiveTicker | null {
  if (candles.length === 0) {
    return null;
  }
  const lastCandle = candles[candles.length - 1];
  const previousCandle = candles[candles.length - 2] ?? lastCandle;
  const last = Number(lastCandle.close);
  const previous = Number(previousCandle.close);
  const change = last - previous;
  return {
    change,
    changePercent: previous !== 0 ? (change / previous) * 100 : 0,
    high: Math.max(...candles.map((candle) => Number(candle.high))),
    last,
    low: Math.min(...candles.map((candle) => Number(candle.low))),
    quoteVolume: 0,
    symbol: symbol.symbol,
    updatedAt: lastCandle.time * 1000,
    volume: candles.reduce((total, candle) => total + candle.volume, 0),
  };
}

function liveTickerFromAngelOneTick(symbol: LiveWatchlistSymbol, payload: AngelOneTickPayload): LiveTicker | null {
  const last = liveNumber(payload.last);
  if (last == null || !isAngelOneLiveSymbol(symbol)) {
    return null;
  }
  const close = liveNumber(payload.close) ?? last;
  const change = last - close;
  return {
    change,
    changePercent: close !== 0 ? (change / close) * 100 : 0,
    high: liveNumber(payload.high) ?? last,
    last,
    low: liveNumber(payload.low) ?? last,
    quoteVolume: 0,
    symbol: symbol.symbol,
    updatedAt: payload.timestamp && Number.isFinite(payload.timestamp) ? payload.timestamp : Date.now(),
    volume: liveNumber(payload.volume) ?? 0,
  };
}

function liveCandleFromBinance(payload: BinanceKlinePayload): Candle | null {
  const kline = payload.k;
  if (!kline) {
    return null;
  }
  const time = Math.floor((kline.t ?? 0) / 1000);
  const open = liveNumber(kline.o);
  const high = liveNumber(kline.h);
  const low = liveNumber(kline.l);
  const close = liveNumber(kline.c);
  if (!Number.isFinite(time) || open == null || high == null || low == null || close == null) {
    return null;
  }
  return createLiveCandle(time, open, high, low, close, liveNumber(kline.v) ?? 0);
}

function liveCandleFromRestKline(value: unknown): Candle | null {
  if (!Array.isArray(value) || value.length < 5) {
    return null;
  }
  const time = Math.floor(Number(value[0]) / 1000);
  const open = liveNumber(value[1]);
  const high = liveNumber(value[2]);
  const low = liveNumber(value[3]);
  const close = liveNumber(value[4]);
  if (!Number.isFinite(time) || open == null || high == null || low == null || close == null) {
    return null;
  }
  return createLiveCandle(time, open, high, low, close, liveNumber(value[5]) ?? 0);
}

function liveCandleFromAngelOneTick(payload: AngelOneTickPayload): Candle | null {
  const last = liveNumber(payload.last);
  if (last == null) {
    return null;
  }
  const timestamp = payload.timestamp && Number.isFinite(payload.timestamp) ? payload.timestamp : Date.now();
  const time = Math.floor(timestamp / 60000) * 60;
  const high = liveNumber(payload.high) ?? last;
  const low = liveNumber(payload.low) ?? last;
  return createLiveCandle(time, last, Math.max(high, last), Math.min(low, last), last, liveNumber(payload.volume) ?? 0);
}

function createLiveCandle(
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
): Candle {
  return {
    close,
    ema_20: null,
    ema_50: null,
    high,
    low,
    open,
    rsi_14: null,
    time,
    timestamp: new Date(time * 1000).toISOString(),
    volume: Number.isFinite(volume) ? volume : 0,
  };
}

function mergeLiveCandles(
  existing: Candle[],
  incoming: Candle[],
  maxBars = LIVE_HISTORY_CACHE_BARS,
) {
  if (existing.length === 0) {
    return incoming.slice(-maxBars);
  }
  if (incoming.length === 0) {
    return existing.slice(-maxBars);
  }
  const byTime = new Map<number, Candle>();
  for (const candle of existing) {
    byTime.set(candle.time, candle);
  }
  for (const candle of incoming) {
    byTime.set(candle.time, candle);
  }
  return Array.from(byTime.values())
    .sort((left, right) => left.time - right.time)
    .slice(-maxBars);
}

function upsertLiveCandle(candles: Candle[], candle: Candle) {
  return mergeLiveCandles(candles, [candle]);
}

function upsertLiveTickCandle(candles: Candle[], candle: Candle) {
  const existing = candles.find((item) => item.time === candle.time);
  if (!existing) {
    return upsertLiveCandle(candles, candle);
  }
  return candles.map((item) =>
    item.time === candle.time
      ? {
          ...item,
          close: candle.close,
          high: Math.max(item.high, candle.high, candle.close),
          low: Math.min(item.low, candle.low, candle.close),
          timestamp: candle.timestamp,
          volume: Math.max(item.volume, candle.volume),
        }
      : item,
  );
}

function formatLivePrice(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return "--";
  }
  const absolute = Math.abs(value);
  const maximumFractionDigits = absolute >= 1000 ? 2 : absolute >= 1 ? 4 : absolute >= 0.01 ? 6 : 8;
  const minimumFractionDigits = absolute >= 1 ? 2 : 0;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
    minimumFractionDigits,
  }).format(value);
}

function signedLiveNumber(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return "--";
  }
  const absolute = Math.abs(value);
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: absolute >= 1 ? 2 : 4,
    minimumFractionDigits: absolute >= 1 ? 2 : 0,
  }).format(absolute);
  if (value > 0) {
    return `+${formatted}`;
  }
  if (value < 0) {
    return `-${formatted}`;
  }
  return formatted;
}

function liveNumber(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function parseAngelOneStreamMessage(raw: unknown): { message?: string; status?: string; tick?: AngelOneTickPayload; type: string } | null {
  if (typeof raw !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainRecord(parsed) || typeof parsed.type !== "string") {
      return null;
    }
    return {
      message: typeof parsed.message === "string" ? parsed.message : undefined,
      status: typeof parsed.status === "string" ? parsed.status : undefined,
      tick: isPlainRecord(parsed.tick) ? parsed.tick as AngelOneTickPayload : undefined,
      type: parsed.type,
    };
  } catch {
    return null;
  }
}

function isAngelOneLiveSymbol(symbol: LiveWatchlistSymbol): symbol is LiveWatchlistSymbol & { exchangeType: number; token: string } {
  return symbol.feed === "angelone" && typeof symbol.exchangeType === "number" && typeof symbol.token === "string" && symbol.token.trim().length > 0;
}

function findAngelOneSymbolForTick(symbols: LiveWatchlistSymbol[], payload: AngelOneTickPayload) {
  const token = String(payload.token ?? "").trim();
  const exchangeType = typeof payload.exchangeType === "number" ? payload.exchangeType : Number(payload.exchangeType);
  if (!token || !Number.isFinite(exchangeType)) {
    return null;
  }
  return symbols.find((symbol) => isAngelOneLiveSymbol(symbol) && symbol.token === token && symbol.exchangeType === exchangeType) ?? null;
}

function liveSymbolColor(symbol: string) {
  const palette = ["#0e7490", "#0f766e", "#1d4ed8", "#6d28d9", "#be123c", "#9a3412", "#3f6212", "#0369a1"];
  const hash = Array.from(symbol).reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return palette[hash % palette.length];
}

function isValidLiveColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function liveSymbolKey(symbol: LiveWatchlistSymbol) {
  if (isAngelOneLiveSymbol(symbol)) {
    return `angelone:${symbol.exchangeType}:${symbol.token}`;
  }
  return liveSymbolStorageKey(symbol.feed, symbol.symbol);
}

function liveSymbolStorageKey(feed: LiveFeedProvider, symbol: string) {
  return `${feed}:${symbol}`;
}

function liveFeedLabel(feed: LiveFeedProvider) {
  if (feed === "binance") {
    return "Binance";
  }
  if (feed === "dukascopy") {
    return "Dukascopy";
  }
  return "Angel One";
}

function liveSourceLabel(feed: LiveFeedProvider) {
  if (feed === "binance") {
    return "Binance Spot";
  }
  if (feed === "dukascopy") {
    return "Dukascopy";
  }
  return "Angel One SmartAPI";
}

function liveAssetClassLabel(symbol: LiveWatchlistSymbol) {
  if (symbol.feed === "binance") {
    const quoteAssets = ["USDT", "FDUSD", "USDC", "BUSD", "BTC", "ETH", "BNB", "TRY", "EUR", "BRL", "GBP"];
    return `Spot ${quoteAssets.find((quote) => symbol.symbol.endsWith(quote)) ?? ""}`.trim();
  }
  if (symbol.feed === "angelone") {
    return [symbol.exchange, symbol.assetClass ? symbol.assetClass.charAt(0).toUpperCase() + symbol.assetClass.slice(1) : ""].filter(Boolean).join(" · ") || "Indian market";
  }
  return symbol.assetClass ? symbol.assetClass.charAt(0).toUpperCase() + symbol.assetClass.slice(1) : "Market";
}

function liveSymbolMonogram(symbol: LiveWatchlistSymbol) {
  return symbol.label.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || symbol.symbol.slice(0, 2).toUpperCase();
}

function isLiveFeedProvider(value: unknown): value is LiveFeedProvider {
  return value === "angelone" || value === "binance" || value === "dukascopy";
}

function isLiveAssetClass(value: unknown): value is LiveAssetClass {
  return value === "commodity" || value === "crypto" || value === "derivative" || value === "equity" || value === "etf" || value === "forex" || value === "index" || value === "other";
}

function filterBinanceInstruments(instruments: BinanceInstrument[], search: string) {
  const query = search.trim().toLowerCase();
  const source = query
    ? instruments.filter((instrument) =>
      [instrument.symbol, instrument.label, instrument.description, instrument.baseAsset, instrument.quoteAsset].some((value) =>
        value.toLowerCase().includes(query),
      ),
    )
    : featuredBinanceInstruments(instruments);
  return source.slice(0, 24);
}

function compareBinanceInstruments(left: BinanceInstrument, right: BinanceInstrument) {
  const leftRank = BINANCE_QUOTE_ASSET_RANK[left.quoteAsset] ?? 99;
  const rightRank = BINANCE_QUOTE_ASSET_RANK[right.quoteAsset] ?? 99;
  return leftRank - rightRank || left.baseAsset.localeCompare(right.baseAsset) || left.symbol.localeCompare(right.symbol);
}

function featuredBinanceInstruments(instruments: BinanceInstrument[]) {
  const bySymbol = new Map(instruments.map((instrument) => [instrument.symbol, instrument]));
  return BINANCE_FEATURED_SYMBOLS.map((symbol) => bySymbol.get(symbol)).filter((instrument): instrument is BinanceInstrument => Boolean(instrument));
}

function findBinanceInstrument(instruments: BinanceInstrument[], value: string) {
  const normalized = normalizeLiveSymbolInput(value);
  const normalizedText = value.trim().toLowerCase();
  return instruments.find((instrument) =>
    instrument.symbol === normalized ||
    instrument.label.toLowerCase() === normalizedText ||
    `${instrument.label} · ${instrument.symbol}`.toLowerCase() === normalizedText,
  ) ?? defaultBinanceInstruments().find((instrument) => instrument.symbol === normalized || instrument.label.toLowerCase() === normalizedText) ?? null;
}

function filterDukascopyInstruments(instruments: DukascopyInstrument[], search: string) {
  const query = search.trim().toLowerCase();
  const source = query
    ? instruments.filter((instrument) =>
      [instrument.symbol, instrument.label, instrument.description, instrument.assetClass].some((value) =>
        value.toLowerCase().includes(query),
      ),
    )
    : featuredDukascopyInstruments(instruments);
  return source.slice(0, 24);
}

function featuredDukascopyInstruments(instruments: DukascopyInstrument[]) {
  const bySymbol = new Map(instruments.map((instrument) => [instrument.symbol, instrument]));
  return DUKASCOPY_FEATURED_SYMBOLS.map((symbol) => bySymbol.get(symbol)).filter((instrument): instrument is DukascopyInstrument => Boolean(instrument));
}

function findDukascopyInstrument(instruments: DukascopyInstrument[], value: string) {
  const normalized = value.trim().toLowerCase();
  return instruments.find((instrument) =>
    instrument.symbol.toLowerCase() === normalized ||
    instrument.label.toLowerCase() === normalized ||
    `${instrument.label} · ${instrument.description}`.toLowerCase() === normalized,
  ) ?? defaultDukascopyInstruments().find((instrument) => instrument.symbol.toLowerCase() === normalized || instrument.label.toLowerCase() === normalized) ?? null;
}

function filterAngelOneInstruments(instruments: AngelOneInstrument[], search: string) {
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const source = words.length > 0
    ? instruments.filter((instrument) => {
      const haystack = [
        instrument.token,
        instrument.symbol,
        instrument.label,
        instrument.name,
        instrument.exchange,
        instrument.description,
        instrument.instrumentType,
        instrument.assetClass,
      ].join(" ").toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    : featuredAngelOneInstruments(instruments);
  return source.slice(0, 24);
}

function featuredAngelOneInstruments(instruments: AngelOneInstrument[]) {
  const byKey = new Map(instruments.map((instrument) => [`${instrument.exchangeType}:${instrument.token}`, instrument]));
  return ANGELONE_FEATURED_TOKENS.map((key) => byKey.get(key)).filter((instrument): instrument is AngelOneInstrument => Boolean(instrument));
}

function findAngelOneInstrument(instruments: AngelOneInstrument[], value: string) {
  const normalized = value.trim().toLowerCase();
  const tokenValue = value.trim();
  return instruments.find((instrument) =>
    instrument.token === tokenValue ||
    `${instrument.exchangeType}:${instrument.token}` === tokenValue ||
    instrument.symbol.toLowerCase() === normalized ||
    instrument.label.toLowerCase() === normalized ||
    `${instrument.label} · ${instrument.exchange}`.toLowerCase() === normalized,
  ) ?? defaultAngelOneInstruments().find((instrument) =>
    instrument.token === tokenValue ||
    `${instrument.exchangeType}:${instrument.token}` === tokenValue ||
    instrument.symbol.toLowerCase() === normalized ||
    instrument.label.toLowerCase() === normalized,
  ) ?? null;
}

function liveSearchTextForFeed(
  feed: LiveFeedProvider,
  values: { angelone: string; binance: string; dukascopy: string },
) {
  if (feed === "binance") {
    return values.binance;
  }
  if (feed === "dukascopy") {
    return values.dukascopy;
  }
  return values.angelone;
}

function liveProviderSelectionError(feed: LiveFeedProvider) {
  if (feed === "binance") {
    return "Search and select a Binance spot pair from the catalog.";
  }
  if (feed === "dukascopy") {
    return "Search and select a Dukascopy instrument from the catalog.";
  }
  return "Search and select an Angel One instrument from the catalog.";
}

function liveCatalogCountLabel(feed: LiveFeedProvider, catalog: LiveMarketCatalog) {
  if (feed === "binance") {
    return `${catalog.binance.length.toLocaleString()} spot pairs`;
  }
  if (feed === "dukascopy") {
    return `${catalog.dukascopy.length.toLocaleString()} instruments`;
  }
  return `${catalog.angelone.length.toLocaleString()} Indian instruments`;
}

function resolveStateAction<T>(action: SetStateAction<T>, previous: T): T {
  return typeof action === "function" ? (action as (previousValue: T) => T)(previous) : action;
}

function useFinanceTrackerData(): [FinanceTrackerData, Dispatch<SetStateAction<FinanceTrackerData>>] {
  const [data, setDataState] = useState<FinanceTrackerData>(() =>
    sanitizeFinanceTrackerData(getCachedAppStorageItem<unknown>(FINANCE_TRACKER_STORAGE_KEY, defaultFinanceTrackerData())),
  );
  const dataRef = useRef(data);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    let active = true;
    void loadAppStorageItem<unknown>(FINANCE_TRACKER_STORAGE_KEY, defaultFinanceTrackerData()).then((value) => {
      if (active) {
        const next = sanitizeFinanceTrackerData(value);
        dataRef.current = next;
        setDataState(next);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeAppStorageItem<unknown>(
      FINANCE_TRACKER_STORAGE_KEY,
      (value) => {
        if (value === dataRef.current) {
          return;
        }
        const next = sanitizeFinanceTrackerData(value);
        dataRef.current = next;
        setDataState(next);
      },
    );
    return unsubscribe;
  }, []);

  const setData: Dispatch<SetStateAction<FinanceTrackerData>> = useCallback((action) => {
    setDataState((current) => {
      const next = sanitizeFinanceTrackerData(resolveStateAction(action, current));
      dataRef.current = next;
      void saveAppStorageItem(FINANCE_TRACKER_STORAGE_KEY, next).catch(() => undefined);
      return next;
    });
  }, []);

  return [data, setData];
}

function useLiveWatchlists(): [LiveWatchlist[], Dispatch<SetStateAction<LiveWatchlist[]>>] {
  const [watchlists, setWatchlistsState] = useState<LiveWatchlist[]>(() =>
    sanitizeLiveWatchlists(getCachedAppStorageItem<unknown>(LIVE_WATCHLIST_STORAGE_KEY, DEFAULT_LIVE_WATCHLISTS)),
  );
  const watchlistsRef = useRef(watchlists);

  useEffect(() => {
    watchlistsRef.current = watchlists;
  }, [watchlists]);

  useEffect(() => {
    let active = true;
    void loadAppStorageItem<unknown>(LIVE_WATCHLIST_STORAGE_KEY, DEFAULT_LIVE_WATCHLISTS).then((value) => {
      if (active) {
        const next = sanitizeLiveWatchlists(value);
        watchlistsRef.current = next;
        setWatchlistsState(next);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeAppStorageItem<unknown>(
      LIVE_WATCHLIST_STORAGE_KEY,
      (value) => {
        if (value === watchlistsRef.current) {
          return;
        }
        const next = sanitizeLiveWatchlists(value);
        watchlistsRef.current = next;
        setWatchlistsState(next);
      },
    );
    return unsubscribe;
  }, []);

  const setWatchlists: Dispatch<SetStateAction<LiveWatchlist[]>> = useCallback((action) => {
    setWatchlistsState((current) => {
      const next = sanitizeLiveWatchlists(resolveStateAction(action, current));
      watchlistsRef.current = next;
      void saveAppStorageItem(LIVE_WATCHLIST_STORAGE_KEY, next).catch(() => undefined);
      return next;
    });
  }, []);

  return [watchlists, setWatchlists];
}

function useLiveMarketCatalog() {
  const [catalog, setCatalog] = useState<LiveMarketCatalog>(() => loadLiveMarketCatalog());
  const [refreshStatus, setRefreshStatus] = useState<"error" | "idle" | "loading" | "ready">("idle");

  useEffect(() => {
    let active = true;
    void loadAppStorageItem<unknown>(LIVE_MARKET_CATALOG_STORAGE_KEY, null).then((value) => {
      if (active) {
        setCatalog(sanitizeLiveMarketCatalog(value));
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeAppStorageItem<unknown>(
      LIVE_MARKET_CATALOG_STORAGE_KEY,
      (value) => setCatalog(sanitizeLiveMarketCatalog(value)),
    );
    return unsubscribe;
  }, []);

  const refreshCatalog = useCallback(async () => {
    setRefreshStatus("loading");
    try {
      const nextCatalog = await fetchLiveMarketCatalog();
      await saveAppStorageItem(LIVE_MARKET_CATALOG_STORAGE_KEY, nextCatalog);
      setCatalog(nextCatalog);
      setRefreshStatus("ready");
      return nextCatalog;
    } catch (error) {
      setRefreshStatus("error");
      throw error;
    }
  }, []);

  return { catalog, refreshCatalog, refreshStatus };
}

function loadLiveMarketCatalog() {
  return sanitizeLiveMarketCatalog(getCachedAppStorageItem<unknown>(LIVE_MARKET_CATALOG_STORAGE_KEY, null));
}

function sanitizeLiveMarketCatalog(value: unknown): LiveMarketCatalog {
  const record = isPlainRecord(value) ? value : {};
  const angelone = Array.isArray(record.angelone)
    ? sanitizeAngelOneInstruments(record.angelone)
    : defaultAngelOneInstruments();
  const binance = Array.isArray(record.binance)
    ? sanitizeBinanceInstruments(record.binance)
    : defaultBinanceInstruments();
  const dukascopy = Array.isArray(record.dukascopy)
    ? sanitizeDukascopyInstruments(record.dukascopy)
    : defaultDukascopyInstruments();
  return {
    angelone: angelone.length > 0 ? angelone : defaultAngelOneInstruments(),
    binance: binance.length > 0 ? binance : defaultBinanceInstruments(),
    dukascopy: dukascopy.length > 0 ? dukascopy : defaultDukascopyInstruments(),
    refreshedAt: typeof record.refreshedAt === "string" ? record.refreshedAt : null,
  };
}

function sanitizeBinanceInstruments(value: unknown[]) {
  const seen = new Set<string>();
  const instruments: BinanceInstrument[] = [];
  for (const item of value) {
    const instrument = sanitizeBinanceInstrument(item);
    if (!instrument || seen.has(instrument.symbol)) {
      continue;
    }
    seen.add(instrument.symbol);
    instruments.push(instrument);
  }
  return instruments.sort(compareBinanceInstruments);
}

function sanitizeBinanceInstrument(value: unknown): BinanceInstrument | null {
  const record = isPlainRecord(value) ? value : {};
  const symbol = normalizeLiveSymbolInput(typeof record.symbol === "string" ? record.symbol : "");
  if (!symbol) {
    return null;
  }
  const fallback = splitBinanceSymbol(symbol);
  const baseAsset = normalizeLiveSymbolInput(stringRecordValue(record, "baseAsset", "base_asset")) || fallback.baseAsset;
  const quoteAsset = normalizeLiveSymbolInput(stringRecordValue(record, "quoteAsset", "quote_asset")) || fallback.quoteAsset;
  const label = stringRecordValue(record, "label").trim() || `${baseAsset}/${quoteAsset}`;
  return {
    assetClass: "crypto",
    baseAsset,
    description: stringRecordValue(record, "description").trim() || `${baseAsset} / ${quoteAsset} spot pair`,
    label,
    quoteAsset,
    status: stringRecordValue(record, "status").trim() || "TRADING",
    symbol,
  };
}

function sanitizeDukascopyInstruments(value: unknown[]) {
  const seen = new Set<string>();
  const instruments: DukascopyInstrument[] = [];
  for (const item of value) {
    const instrument = sanitizeDukascopyInstrument(item);
    if (!instrument || seen.has(instrument.symbol)) {
      continue;
    }
    seen.add(instrument.symbol);
    instruments.push(instrument);
  }
  return instruments.sort((left, right) => left.assetClass.localeCompare(right.assetClass) || left.label.localeCompare(right.label));
}

function sanitizeDukascopyInstrument(value: unknown): DukascopyInstrument | null {
  const record = isPlainRecord(value) ? value : {};
  const symbol = stringRecordValue(record, "symbol").trim();
  if (!symbol) {
    return null;
  }
  const rawAssetClass = stringRecordValue(record, "assetClass", "asset_class");
  const rawTags = record.tags;
  return {
    assetClass: isLiveAssetClass(rawAssetClass) ? rawAssetClass : "other",
    baseCurrency: stringRecordValue(record, "baseCurrency", "base_currency").trim(),
    description: stringRecordValue(record, "description").trim() || symbol,
    label: stringRecordValue(record, "label").trim() || symbol,
    quoteCurrency: stringRecordValue(record, "quoteCurrency", "quote_currency").trim(),
    symbol,
    tags: Array.isArray(rawTags) ? rawTags.map(String) : [],
  };
}

function sanitizeAngelOneInstruments(value: unknown[]) {
  const seen = new Set<string>();
  const instruments: AngelOneInstrument[] = [];
  for (const item of value) {
    const instrument = sanitizeAngelOneInstrument(item);
    const key = instrument ? `${instrument.exchangeType}:${instrument.token}` : "";
    if (!instrument || seen.has(key)) {
      continue;
    }
    seen.add(key);
    instruments.push(instrument);
  }
  return instruments.sort(compareAngelOneInstruments);
}

function sanitizeAngelOneInstrument(value: unknown): AngelOneInstrument | null {
  const record = isPlainRecord(value) ? value : {};
  const token = stringRecordValue(record, "token").trim();
  const symbol = stringRecordValue(record, "symbol").trim();
  const exchange = stringRecordValue(record, "exchange").trim().toUpperCase();
  const exchangeType = typeof record.exchangeType === "number"
    ? record.exchangeType
    : typeof record.exchange_type === "number"
      ? record.exchange_type
      : Number(stringRecordValue(record, "exchangeType", "exchange_type"));
  if (!token || !symbol || !Number.isFinite(exchangeType)) {
    return null;
  }
  const rawAssetClass = stringRecordValue(record, "assetClass", "asset_class");
  const lotSize = typeof record.lotSize === "number"
    ? record.lotSize
    : typeof record.lot_size === "number"
      ? record.lot_size
      : null;
  const tickSize = typeof record.tickSize === "number"
    ? record.tickSize
    : typeof record.tick_size === "number"
      ? record.tick_size
      : null;
  return {
    assetClass: isLiveAssetClass(rawAssetClass) ? rawAssetClass : "other",
    description: stringRecordValue(record, "description").trim() || exchange || "Angel One instrument",
    exchange,
    exchangeType,
    expiry: stringRecordValue(record, "expiry").trim() || null,
    instrumentType: stringRecordValue(record, "instrumentType", "instrument_type").trim(),
    label: stringRecordValue(record, "label").trim() || symbol,
    lotSize,
    name: stringRecordValue(record, "name").trim() || symbol,
    symbol,
    tickSize,
    token,
  };
}

function compareAngelOneInstruments(left: AngelOneInstrument, right: AngelOneInstrument) {
  const exchangeRank = (exchange: string) => ({ NSE: 0, BSE: 1, NFO: 2, BFO: 3, MCX: 4, CDS: 5 })[exchange] ?? 9;
  const assetRank = (assetClass: LiveAssetClass) => ({ index: 0, equity: 1, derivative: 2, commodity: 3, forex: 4, crypto: 5, etf: 6, other: 9 })[assetClass] ?? 9;
  const featuredRank = (token: string) => ({ "99926000": -3, "99926009": -2, "99919000": -1 })[token] ?? 0;
  return exchangeRank(left.exchange) - exchangeRank(right.exchange) ||
    assetRank(left.assetClass) - assetRank(right.assetClass) ||
    featuredRank(left.token) - featuredRank(right.token) ||
    left.name.localeCompare(right.name) ||
    left.symbol.localeCompare(right.symbol);
}

function defaultAngelOneCredentials(): AngelOneCredentials {
  return {
    apiKey: "",
    clientCode: "",
    feedToken: "",
    jwtToken: "",
  };
}

function hasAngelOneCredentials(credentials: AngelOneCredentials) {
  return Boolean(credentials.apiKey.trim() && credentials.clientCode.trim() && credentials.feedToken.trim() && credentials.jwtToken.trim());
}

function stringRecordValue(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return "";
}

type FeedbackScreenshotAttachment = {
  data_url: string;
  name: string;
  size: number;
  type: string;
};

const FEEDBACK_MAX_SCREENSHOTS = 3;
const FEEDBACK_MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read screenshot file."));
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Could not read screenshot file."));
      }
    };
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024).toLocaleString()} KB`;
  }
  return `${bytes.toLocaleString()} B`;
}

function previewFeedbackMessage(message: string) {
  return message.length > 180 ? `${message.slice(0, 177)}...` : message;
}

function FeedbackPage({ activeSession }: { activeSession: BacktestSession | null }) {
  const authSession = getStoredAuthSession();
  const [category, setCategory] = useState<FeedbackCategory>("FEATURE");
  const [message, setMessage] = useState("");
  const [includeSessionContext, setIncludeSessionContext] = useState(true);
  const [includeDiagnostics, setIncludeDiagnostics] = useState(
    () => loadSettingsPreferences().includeDiagnosticsByDefault,
  );
  const [screenshots, setScreenshots] = useState<FeedbackScreenshotAttachment[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastSubmittedAt, setLastSubmittedAt] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<FeedbackSubmission[]>([]);
  const [submissionsLoading, setSubmissionsLoading] = useState(true);
  const [submissionsError, setSubmissionsError] = useState<string | null>(null);
  const trimmedMessage = message.trim();
  const canSubmit = trimmedMessage.length >= 10 && !isSubmitting;
  const activeSessionLabel = activeSession
    ? [activeSession.instrument ?? activeSession.symbol, activeSession.timeframe ?? "Replay", activeSession.name]
        .filter(Boolean)
        .join(" · ")
    : "No active backtest session";

  const loadSubmittedFeedback = useCallback(async () => {
    setSubmissionsLoading(true);
    setSubmissionsError(null);
    try {
      setSubmissions(await getFeedbackSubmissions());
    } catch (loadError) {
      setSubmissionsError(importErrorMessage(loadError));
    } finally {
      setSubmissionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSubmittedFeedback();
  }, [loadSubmittedFeedback]);

  async function handleScreenshotChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) {
      return;
    }

    setError(null);
    const remainingSlots = FEEDBACK_MAX_SCREENSHOTS - screenshots.length;
    if (remainingSlots <= 0) {
      setError(`You can attach up to ${FEEDBACK_MAX_SCREENSHOTS} screenshots.`);
      return;
    }

    const acceptedFiles = files.slice(0, remainingSlots);
    const attachments: FeedbackScreenshotAttachment[] = [];
    for (const file of acceptedFiles) {
      if (!file.type.startsWith("image/")) {
        setError("Only image screenshots can be attached.");
        continue;
      }
      if (file.size > FEEDBACK_MAX_SCREENSHOT_BYTES) {
        setError(`Each screenshot must be ${formatBytes(FEEDBACK_MAX_SCREENSHOT_BYTES)} or smaller.`);
        continue;
      }

      attachments.push({
        data_url: await readFileAsDataUrl(file),
        name: file.name,
        size: file.size,
        type: file.type,
      });
    }

    if (attachments.length > 0) {
      setScreenshots((current) => [...current, ...attachments].slice(0, FEEDBACK_MAX_SCREENSHOTS));
    }
  }

  function removeScreenshot(index: number) {
    setScreenshots((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    setIsSubmitting(true);
    setStatus(null);
    setError(null);
    try {
      const submission = await postFeedback({
        category,
        context: {
          app: "edgelab",
          include_session_context: includeSessionContext,
          diagnostics: includeDiagnostics
            ? {
                captured_at: new Date().toISOString(),
                format: "har-1.2",
                har: buildDiagnosticsHarSnapshot(),
              }
            : null,
          pathname: typeof window !== "undefined" ? window.location.pathname : "/app",
          screenshots,
          session: includeSessionContext && activeSession
            ? {
                id: activeSession.id,
                instrument: activeSession.instrument ?? activeSession.symbol,
                name: activeSession.name,
                timeframe: activeSession.timeframe,
              }
            : null,
          submitted_at: new Date().toISOString(),
          user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
        },
        message: trimmedMessage,
      });
      setLastSubmittedAt(submission.created_at);
      setSubmissions((current) => [
        submission,
        ...current.filter((currentSubmission) => currentSubmission.id !== submission.id),
      ].slice(0, 50));
      setMessage("");
      setScreenshots([]);
      setStatus("Feedback sent. Thanks for helping sharpen EdgeLab.");
    } catch (submissionError) {
      setError(importErrorMessage(submissionError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <PageScaffold
      eyebrow="Feedback"
      title="Tell Us What To Fix"
      description="Send bugs, UX friction, missing features, or performance issues straight into the EdgeLab product queue."
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <FeatureCard>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardLabel icon={MessageSquareQuote} label="Product feedback" />
              <h2 className="mt-3 text-xl font-semibold text-white">Ship the rough edges to us</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                Be concrete. Tell us what happened, what you expected instead, and where the workflow slowed you down.
              </p>
            </div>
            <span className="status-pill h-8 px-2 text-[11px]">Authenticated submit</span>
          </div>

          <form className="mt-5 grid gap-4" onSubmit={(event) => void handleSubmit(event)}>
            <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
              <label className="form-field">
                Type
                <ThemedSelect
                  className="h-10"
                  onChange={(value) => setCategory(value as FeedbackCategory)}
                  options={[
                    { label: "Feature request", sublabel: "New workflow or capability", value: "FEATURE" },
                    { label: "Bug", sublabel: "Something is broken", value: "BUG" },
                    { label: "UX friction", sublabel: "Confusing or clunky flow", value: "UX" },
                    { label: "Performance", sublabel: "Slow or resource-heavy behavior", value: "PERFORMANCE" },
                    { label: "Data quality", sublabel: "Incorrect or missing market/app data", value: "DATA" },
                    { label: "Other", sublabel: "Everything else", value: "OTHER" },
                  ]}
                  portal
                  value={category}
                />
              </label>
              <div className="grid gap-2 rounded-md border border-white/10 bg-black/20 px-3 py-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Submission context
                </div>
                <label className="flex items-start gap-3 text-sm text-slate-300">
                  <input
                    checked={includeSessionContext}
                    className="mt-1 h-4 w-4 rounded border-white/15 bg-black/30 text-cyan-300 focus:ring-cyan-300/25"
                    onChange={(event) => setIncludeSessionContext(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    Include current session context
                    <span className="mt-1 block text-xs text-slate-500">{activeSessionLabel}</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 text-sm text-slate-300">
                  <input
                    checked={includeDiagnostics}
                    className="mt-1 h-4 w-4 rounded border-white/15 bg-black/30 text-cyan-300 focus:ring-cyan-300/25"
                    onChange={(event) => setIncludeDiagnostics(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    Attach HAR network logs
                    <span className="mt-1 block text-xs text-slate-500">
                      Default on. Includes recent request URLs, status codes, timings, and WebSocket failures with secrets redacted.
                    </span>
                  </span>
                </label>
              </div>
            </div>

            <label className="form-field">
              Feedback
              <textarea
                className="min-h-[220px] w-full rounded-md border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/40 focus:ring-2 focus:ring-cyan-300/10 placeholder:text-slate-600"
                onChange={(event) => setMessage(event.target.value)}
                placeholder="What were you doing, what went wrong, and what should EdgeLab do instead?"
                value={message}
              />
            </label>

            <div className="grid gap-3 rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                    <Image size={15} />
                    Screenshots
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Add up to {FEEDBACK_MAX_SCREENSHOTS} images, {formatBytes(FEEDBACK_MAX_SCREENSHOT_BYTES)} each.
                  </p>
                </div>
                <label className="control-button h-9 cursor-pointer px-3">
                  <FileUp size={14} />
                  Add screenshots
                  <input
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="sr-only"
                    multiple
                    onChange={(event) => void handleScreenshotChange(event)}
                    type="file"
                  />
                </label>
              </div>
              {screenshots.length > 0 ? (
                <div className="grid gap-2">
                  {screenshots.map((screenshot, index) => (
                    <div
                      className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-slate-950/70 px-3 py-2"
                      key={`${screenshot.name}-${screenshot.size}-${index}`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-100">{screenshot.name}</div>
                        <div className="text-xs text-slate-500">
                          {screenshot.type || "image"} · {formatBytes(screenshot.size)}
                        </div>
                      </div>
                      <button
                        className="icon-button h-8 w-8"
                        onClick={() => removeScreenshot(index)}
                        type="button"
                        aria-label={`Remove ${screenshot.name}`}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-slate-500">
                {trimmedMessage.length < 10
                  ? "Use at least 10 characters so we have enough detail to act on it."
                  : `${trimmedMessage.length.toLocaleString()} characters ready to send.`}
              </div>
              <button
                className="control-button workspace-tab-active h-10 px-4"
                disabled={!canSubmit}
                type="submit"
              >
                {isSubmitting ? <RefreshCw className="animate-spin motion-reduce:animate-none" size={15} /> : <Send size={15} />}
                {isSubmitting ? "Sending..." : "Send feedback"}
              </button>
            </div>

            {status ? (
              <div className="rounded-md border border-emerald-300/20 bg-emerald-300/10 px-3 py-3 text-sm text-emerald-100">
                {status}
              </div>
            ) : null}
            {error ? (
              <div className="rounded-md border border-rose-300/20 bg-rose-300/10 px-3 py-3 text-sm text-rose-100">
                {error}
              </div>
            ) : null}
          </form>
        </FeatureCard>

        <div className="space-y-4">
          <FeatureCard>
            <CardLabel icon={Lightbulb} label="What helps most" />
            <div className="mt-4 grid gap-2 text-sm leading-6 text-slate-400">
              <p>1. The exact screen or flow where the problem showed up.</p>
              <p>2. What you expected to happen.</p>
              <p>3. What actually happened instead.</p>
              <p>4. If the issue is performance-related, how it felt: lag, memory spike, blocked action, or stale data.</p>
            </div>
          </FeatureCard>

          <FeatureCard>
            <CardLabel icon={Info} label="Submission info" />
            <div className="mt-4 grid gap-2">
              <CompactMetric label="Signed in as" value={authSession?.user.email ?? "Authenticated user"} />
              <CompactMetric label="Current session" value={activeSession ? String(activeSession.id) : "None"} />
              <CompactMetric
                label="Last sent"
                value={lastSubmittedAt ? formatDateTime(lastSubmittedAt) : "Not yet submitted"}
              />
            </div>
          </FeatureCard>

          <FeatureCard>
            <div className="flex items-center justify-between gap-3">
              <CardLabel icon={ClipboardList} label="Recent submissions" />
              <button
                className="control-button h-8 px-2 text-xs"
                disabled={submissionsLoading}
                onClick={() => void loadSubmittedFeedback()}
                type="button"
              >
                <RefreshCw
                  className={submissionsLoading ? "animate-spin motion-reduce:animate-none" : ""}
                  size={13}
                />
                Refresh
              </button>
            </div>
            <div className="mt-4 grid gap-3">
              {submissionsError ? (
                <div className="rounded-md border border-rose-300/20 bg-rose-300/10 px-3 py-3 text-sm text-rose-100">
                  {submissionsError}
                </div>
              ) : null}
              {submissionsLoading && submissions.length === 0 ? (
                <div className="rounded-md border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-400">
                  Loading submitted feedback...
                </div>
              ) : null}
              {!submissionsLoading && submissions.length === 0 && !submissionsError ? (
                <div className="rounded-md border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-400">
                  No submitted feedback yet.
                </div>
              ) : null}
              {submissions.map((submission) => (
                <div
                  className="rounded-md border border-white/10 bg-black/20 px-3 py-3"
                  key={submission.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-100/70">
                      {submission.category}
                    </div>
                    <span className="status-pill h-6 px-2 text-[10px]">{submission.status}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    {previewFeedbackMessage(submission.message)}
                  </p>
                  <div className="mt-2 text-xs text-slate-500">
                    {formatDateTime(submission.created_at)}
                  </div>
                </div>
              ))}
            </div>
          </FeatureCard>
        </div>
      </div>
    </PageScaffold>
  );
}

function GlobalSettingsPage({
  playbooks,
  sessions,
  trades,
}: {
  datasets: DatasetCatalog | null;
  playbooks: Playbook[];
  sessions: BacktestSession[];
  trades: Trade[];
}) {
  const { confirm, confirmDialog } = useThemedConfirm();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [bundle, setBundle] = useState<AppDataBundle | null>(null);
  const [fileName, setFileName] = useState("");
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const bundleRows = useMemo(() => bundle ? appDataBundleRows(bundle) : [], [bundle]);
  const bundleTotalRows = useMemo(() => bundleRows.reduce((sum, row) => sum + row.count, 0), [bundleRows]);

  async function exportBundle() {
    setIsExporting(true);
    setExportStatus(null);
    setError(null);
    try {
      const exportedBundle = await exportAppDataBundle();
      const filename = `edgelab-data-${bundleDateSlug(exportedBundle.exported_at)}.json`;
      downloadTextFile(filename, JSON.stringify(exportedBundle, null, 2), "application/json");
      setExportStatus(`Exported ${appDataBundleRecordCount(exportedBundle).toLocaleString()} records`);
    } catch (exportError) {
      setError(importErrorMessage(exportError));
    } finally {
      setIsExporting(false);
    }
  }

  async function readBundleFile(file: File | null | undefined) {
    if (!file) {
      return;
    }
    setError(null);
    setImportStatus(null);
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const nextBundle = parseAppDataBundle(parsed);
      setBundle(nextBundle);
      setFileName(file.name);
      setImportStatus(`Ready to import ${appDataBundleRecordCount(nextBundle).toLocaleString()} records`);
    } catch (readError) {
      setBundle(null);
      setFileName("");
      setError(readError instanceof Error ? readError.message : "Could not read import bundle");
    }
  }

  function handleImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    void readBundleFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function handleDrop(event: ReactDragEvent<HTMLButtonElement>) {
    event.preventDefault();
    void readBundleFile(event.dataTransfer.files?.[0]);
  }

  async function importBundle() {
    if (!bundle) {
      return;
    }
    const confirmed = await confirm({
      confirmLabel: "Import bundle",
      detail: "This replaces current sessions, trades, orders, playbooks, Journal data, notes, chart layouts, app settings, and market data preferences with the selected bundle.",
      message: (
        <>
          Replace current app data with <span className="font-semibold text-white">{fileName || "this bundle"}</span>?
        </>
      ),
      title: "Import app data bundle",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }
    setIsImporting(true);
    setError(null);
    setImportStatus(null);
    try {
      const result = await importAppDataBundle(bundle);
      const totalRows = Object.values(result.summary).reduce((sum, count) => sum + count, 0);
      setImportStatus(`Imported ${totalRows.toLocaleString()} records. Reloading workspace...`);
      purgeLegacyAppLocalStorage();
      window.setTimeout(() => window.location.reload(), 700);
    } catch (importError) {
      setError(importErrorMessage(importError));
      setIsImporting(false);
    }
  }

  return (
    <PageScaffold
      eyebrow="Global Settings"
      title="App Data"
      description="Export or restore the full EdgeLab data bundle for this workspace."
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ResultMetricCard icon={PlaySquare} label="Backtest sessions" value={String(sessions.length)} />
        <ResultMetricCard icon={ClipboardList} label="Backtest trades" value={String(trades.length)} />
        <ResultMetricCard icon={BookOpen} label="Playbooks" value={String(playbooks.length)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <FeatureCard>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardLabel icon={FileDown} label="Export data" />
              <h2 className="mt-3 text-xl font-semibold text-white">Create a complete app bundle</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                Downloads a JSON bundle with backtest records, Journal data, notes, playbooks, chart layouts, presets, order defaults, and market data preferences.
              </p>
            </div>
            <span className="status-pill h-8 px-2 text-[11px]">JSON bundle</span>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-3">
            <MiniMetric label="Sessions" value={String(sessions.length)} />
            <MiniMetric label="Trades" value={String(trades.length)} />
            <MiniMetric label="Playbooks" value={String(playbooks.length)} />
          </div>
          <div className="mt-4 rounded-md border border-white/10 bg-black/20 px-3 py-3 text-sm leading-6 text-slate-400">
            Large market data files are kept outside app-data bundles.
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            {exportStatus ? (
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-200">
                <CheckCircle2 size={15} />
                {exportStatus}
              </span>
            ) : (
              <span className="text-sm text-slate-500">Use this before moving machines or testing destructive changes.</span>
            )}
            <button className="control-button workspace-tab-active h-10" disabled={isExporting} onClick={() => void exportBundle()} type="button">
              <FileDown size={15} />
              {isExporting ? "Exporting..." : "Export data"}
            </button>
          </div>
        </FeatureCard>

        <FeatureCard>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardLabel icon={FileUp} label="Import data" />
              <h2 className="mt-3 text-xl font-semibold text-white">Restore from a bundle</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                Select an EdgeLab export file, review its contents, then replace the current workspace data in one controlled import.
              </p>
            </div>
            <span className="status-pill h-8 px-2 text-[11px]">Replace mode</span>
          </div>
          <input
            accept="application/json,.json"
            className="hidden"
            onChange={handleImportFileChange}
            ref={fileInputRef}
            type="file"
          />
          <button
            className="mt-4 w-full rounded-md border border-dashed border-cyan-300/25 bg-cyan-300/[0.04] px-4 py-8 text-left transition hover:border-cyan-300/45 hover:bg-cyan-300/[0.07]"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
            type="button"
          >
            <span className="flex flex-wrap items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-white">{fileName || "Drop an EdgeLab JSON bundle here"}</span>
                <span className="mt-1 block text-sm leading-6 text-slate-500">
                  {bundle ? `${bundleTotalRows.toLocaleString()} records detected` : "Click this area to choose a file"}
                </span>
              </span>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-cyan-300/25 bg-cyan-300/10 text-cyan-100">
                <FileUp size={17} />
              </span>
            </span>
          </button>

          {bundle && (
            <div className="mt-4 rounded-md border border-white/10 bg-black/20 p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <CardLabel icon={Database} label="Bundle preview" />
                <span className="text-xs text-slate-500">{formatDateTime(bundle.exported_at)}</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {bundleRows.map((row) => (
                  <MiniMetric key={row.key} label={row.label} value={row.count.toLocaleString()} />
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span className={`text-sm ${error ? "text-rose-200" : importStatus ? "text-cyan-100" : "text-slate-500"}`}>
              {error ?? importStatus ?? "Import replaces existing app data after confirmation."}
            </span>
            <button className="control-button workspace-tab-active h-10" disabled={!bundle || isImporting} onClick={() => void importBundle()} type="button">
              <FileUp size={15} />
              {isImporting ? "Importing..." : "Import data"}
            </button>
          </div>
        </FeatureCard>
      </div>
      {confirmDialog}
    </PageScaffold>
  );
}

function FinanceTrackerPage({ journalAccounts }: { journalAccounts: LiveJournalAccount[] }) {
  const { confirm, confirmDialog } = useThemedConfirm();
  const [data, setData] = useFinanceTrackerData();
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(() => data.accounts[0]?.id ?? null);
  const [accountFilter, setAccountFilter] = useState<"ALL" | FinanceAccountKind>("ALL");
  const [entryTypeFilter, setEntryTypeFilter] = useState<"ALL" | FinanceEntryType>("ALL");
  const [accountKind, setAccountKind] = useState<FinanceAccountKind>("broker");
  const [accountName, setAccountName] = useState("");
  const [provider, setProvider] = useState("");
  const [accountCurrency, setAccountCurrency] = useState("USD");
  const [accountColor, setAccountColor] = useState("#22d3ee");
  const [accountStatus, setAccountStatus] = useState<FinanceAccountStatus>("ACTIVE");
  const [propStage, setPropStage] = useState<FinancePropStage>("phase1");
  const [startingBalance, setStartingBalance] = useState("0");
  const [fundedAmount, setFundedAmount] = useState("100000");
  const [challengeFee, setChallengeFee] = useState("0");
  const [profitSplitPercent, setProfitSplitPercent] = useState("80");
  const [profitTarget, setProfitTarget] = useState("0");
  const [maxLossLimit, setMaxLossLimit] = useState("0");
  const [startDate, setStartDate] = useState(() => financeToday());
  const [accountNotes, setAccountNotes] = useState("");
  const [entryType, setEntryType] = useState<FinanceEntryType>("expense");
  const [entryAccountId, setEntryAccountId] = useState("none");
  const [entryAmount, setEntryAmount] = useState("");
  const [entryCurrency, setEntryCurrency] = useState("USD");
  const [entryCategory, setEntryCategory] = useState(FINANCE_EXPENSE_CATEGORIES[0]);
  const [entryDate, setEntryDate] = useState(() => financeToday());
  const [entryDescription, setEntryDescription] = useState("");

  const accountById = useMemo(
    () => new Map(data.accounts.map((account) => [account.id, account])),
    [data.accounts],
  );
  const selectedAccount = selectedAccountId == null ? null : accountById.get(selectedAccountId) ?? null;
  const scopedAccounts = data.accounts.filter((account) => accountFilter === "ALL" || account.kind === accountFilter);
  const filteredEntries = useMemo(
    () =>
      data.entries
        .filter((entry) => {
          const account = entry.account_id == null ? null : accountById.get(entry.account_id);
          if (accountFilter !== "ALL" && account?.kind !== accountFilter) {
            return false;
          }
          if (entryTypeFilter !== "ALL" && entry.type !== entryTypeFilter) {
            return false;
          }
          return true;
        })
        .slice()
        .sort((left, right) => right.date.localeCompare(left.date) || right.id - left.id),
    [accountById, accountFilter, data.entries, entryTypeFilter],
  );
  const selectedAccountEntries = selectedAccount
    ? data.entries.filter((entry) => entry.account_id === selectedAccount.id)
    : [];
  const summaryCurrency = currencyForFinanceEntries(filteredEntries, accountById, scopedAccounts);
  const incomeTotal = filteredEntries
    .filter((entry) => entry.type === "income")
    .reduce((sum, entry) => sum + entry.amount, 0);
  const expenseTotal = filteredEntries
    .filter((entry) => entry.type === "expense")
    .reduce((sum, entry) => sum + entry.amount, 0);
  const depositTotal = filteredEntries
    .filter((entry) => entry.type === "deposit")
    .reduce((sum, entry) => sum + entry.amount, 0);
  const netTotal = incomeTotal - expenseTotal - depositTotal;
  const propExpenseTotal = data.entries
    .filter((entry) => (entry.type === "expense" || entry.type === "deposit") && financeEntryAccount(entry, accountById)?.kind === "propFirm")
    .reduce((sum, entry) => sum + entry.amount, 0);
  const propChallengeFees = data.accounts
    .filter((account) => account.kind === "propFirm")
    .reduce((sum, account) => sum + account.challenge_fee, 0);
  const activePropAccounts = data.accounts.filter(
    (account) => account.kind === "propFirm" && account.status !== "ARCHIVED",
  );
  const breachedAccounts = data.accounts.filter((account) => account.breached || account.status === "BREACHED");
  const accountOptions = [
    { label: "General ledger", sublabel: "Income or expense not tied to an account", value: "none" },
    ...data.accounts.map((account) => ({
      label: account.name,
      sublabel: `${financeAccountKindLabel(account.kind)} · ${account.provider || "Manual"} · ${account.currency}`,
      value: String(account.id),
    })),
  ];
  const accountRows = scopedAccounts.map((account) => {
    const entries = data.entries.filter((entry) => entry.account_id === account.id);
    const income = entries.filter((entry) => entry.type === "income").reduce((sum, entry) => sum + entry.amount, 0);
    const expense = entries.filter((entry) => entry.type === "expense").reduce((sum, entry) => sum + entry.amount, 0);
    const deposit = entries.filter((entry) => entry.type === "deposit").reduce((sum, entry) => sum + entry.amount, 0);
    return {
      account,
      deposit,
      entries,
      expense,
      income,
      net: income - expense - deposit,
    };
  });
  const selectedLedgerNet = selectedAccountEntries.reduce((sum, entry) => sum + financeSignedEntryAmount(entry), 0);
  const selectedAccountIncome = selectedAccountEntries.filter((entry) => entry.type === "income").reduce((sum, entry) => sum + entry.amount, 0);
  const selectedProfitSplit = selectedAccount?.profit_split_percent ?? 0;
  const selectedGrossProfitEstimate = selectedAccount?.kind === "propFirm" && selectedProfitSplit > 0
    ? selectedAccountIncome / (selectedProfitSplit / 100)
    : selectedAccountIncome;
  const selectedFirmShareEstimate = Math.max(0, selectedGrossProfitEstimate - selectedAccountIncome);

  useEffect(() => {
    if (selectedAccount || data.accounts.length === 0) {
      return;
    }
    setSelectedAccountId(data.accounts[0].id);
  }, [data.accounts, selectedAccount]);

  useEffect(() => {
    if (journalAccounts.length === 0) {
      return;
    }
    setData((current) => {
      let changed = false;
      let nextAccounts = current.accounts;
      let nextEntries = current.entries;
      let nextAccountId = nextNumericId(nextAccounts);

      for (const journalAccount of journalAccounts) {
        const existingAccount = nextAccounts.find((account) => account.journal_account_id === journalAccount.id);
        if (existingAccount) {
          continue;
        }
        const account = sanitizeFinanceAccount({
          color: journalAccount.color,
          created_at: journalAccount.created_at,
          currency: journalAccount.currency,
          id: nextAccountId,
          journal_account_id: journalAccount.id,
          kind: "broker",
          name: journalAccount.name,
          notes: journalAccount.notes,
          provider: journalAccount.broker,
          starting_balance: journalAccount.initial_balance,
          start_date: journalAccount.created_at.slice(0, 10),
          status: journalAccount.status === "ARCHIVED" ? "ARCHIVED" : "ACTIVE",
        });
        nextAccountId += 1;
        nextAccounts = [account, ...nextAccounts];
        changed = true;
      }

      return changed ? { accounts: nextAccounts, entries: nextEntries } : current;
    });
  }, [journalAccounts, setData]);

  function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = nextNumericId(data.accounts);
    const account: FinanceTrackerAccount = sanitizeFinanceAccount({
      challenge_fee: positivePositionNumber(challengeFee),
      color: accountColor,
      created_at: new Date().toISOString(),
      currency: accountCurrency,
      funded_amount: accountKind === "propFirm" ? positivePositionNumber(fundedAmount) : 0,
      id,
      kind: accountKind,
      max_loss_limit: accountKind === "propFirm" ? positivePositionNumber(maxLossLimit) : 0,
      name: accountName,
      notes: accountNotes,
      profit_split_percent: accountKind === "propFirm" ? positivePositionNumber(profitSplitPercent) : 0,
      profit_target: accountKind === "propFirm" ? positivePositionNumber(profitTarget) : 0,
      provider,
      stage: accountKind === "propFirm" ? propStage : "live",
      starting_balance: accountKind === "broker" ? positivePositionNumber(startingBalance) : 0,
      start_date: startDate,
      status: accountStatus,
    });
    setData((current) => {
      const depositEntry = financeDefaultDepositEntry(account, nextNumericId(current.entries));
      return {
        accounts: [account, ...current.accounts],
        entries: depositEntry ? [depositEntry, ...current.entries] : current.entries,
      };
    });
    setSelectedAccountId(id);
    setEntryAccountId(String(id));
    setEntryCurrency(account.currency);
    setAccountName(accountKind === "propFirm" ? "Prop Firm Challenge" : "Broker Account");
    setProvider("");
    setAccountNotes("");
  }

  function handleEntryTypeChange(value: string) {
    const nextType = sanitizeFinanceEntryType(value);
    setEntryType(nextType);
    setEntryCategory(financeCategoriesForType(nextType)[0]);
  }

  function handleEntryAccountChange(value: string) {
    setEntryAccountId(value);
    const account = accountById.get(Number(value));
    if (account) {
      setEntryCurrency(account.currency);
    }
  }

  function addEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = positivePositionNumber(entryAmount);
    if (amount <= 0) {
      return;
    }
    const accountId = entryAccountId === "none" ? null : Number(entryAccountId);
    const account = Number.isFinite(accountId) && accountId != null ? accountById.get(accountId) : null;
    const entry: FinanceTrackerEntry = sanitizeFinanceEntry({
      account_id: account?.id ?? null,
      amount,
      category: entryCategory,
      created_at: new Date().toISOString(),
      currency: entryCurrency || account?.currency || "USD",
      date: entryDate || financeToday(),
      description: entryDescription,
      id: nextNumericId(data.entries),
      type: entryType,
    }, new Set(data.accounts.map((item) => item.id)));
    setData((current) => ({ ...current, entries: [entry, ...current.entries] }));
    setEntryAmount("");
    setEntryDescription("");
  }

  function updateAccount(accountId: number, payload: Partial<FinanceTrackerAccount>) {
    setData((current) => ({
      ...current,
      accounts: current.accounts.map((account) =>
        account.id === accountId ? sanitizeFinanceAccount({ ...account, ...payload }) : account,
      ),
    }));
  }

  async function deleteAccount(account: FinanceTrackerAccount) {
    const linkedEntries = data.entries.filter((entry) => entry.account_id === account.id).length;
    if (account.journal_account_id != null) {
      const confirmed = await confirm({
        confirmLabel: "Archive finance profile",
        detail: "This broker account is linked from Journal Accounts, so it will be archived in Finance instead of deleted and recreated on the next sync.",
        message: (
          <>
            Archive <span className="font-semibold text-white">{account.name}</span> in the finance tracker?
          </>
        ),
        title: "Archive synced account",
      });
      if (confirmed) {
        updateAccount(account.id, { status: "ARCHIVED" });
      }
      return;
    }
    const confirmed = await confirm({
      confirmLabel: "Delete account",
      detail: linkedEntries > 0
        ? `${linkedEntries} ledger ${linkedEntries === 1 ? "entry" : "entries"} will stay in the tracker and move to General ledger.`
        : "This removes the account profile only.",
      message: (
        <>
          Delete <span className="font-semibold text-white">{account.name}</span>?
        </>
      ),
      title: "Delete finance account",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }
    setData((current) => ({
      accounts: current.accounts.filter((item) => item.id !== account.id),
      entries: current.entries.map((entry) => entry.account_id === account.id ? { ...entry, account_id: null } : entry),
    }));
    setSelectedAccountId((current) => current === account.id ? null : current);
  }

  async function deleteEntry(entry: FinanceTrackerEntry) {
    const confirmed = await confirm({
      confirmLabel: "Delete entry",
      detail: "This only removes the income or expense record from the tracker.",
      message: (
        <>
          Delete <span className="font-semibold text-white">{entry.category}</span> for{" "}
          <span className={entry.type === "income" ? "font-semibold text-emerald-200" : entry.type === "deposit" ? "font-semibold text-amber-200" : "font-semibold text-rose-200"}>
            {formatMoney(entry.amount, entry.currency)}
          </span>
          ?
        </>
      ),
      title: "Delete finance entry",
      tone: "danger",
    });
    if (confirmed) {
      setData((current) => ({
        ...current,
        entries: current.entries.filter((item) => item.id !== entry.id),
      }));
    }
  }

  return (
    <PageScaffold
      eyebrow="Journal Finance"
      title="Income & Expense Tracker"
      description="Track payouts, deposits, operating costs, broker accounts, prop-firm challenges, instant funded accounts, breaches, and live account cashflow in one ledger."
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ResultMetricCard icon={BadgeDollarSign} label="Net cashflow" tone={toneForNumber(netTotal)} value={formatCompactMoney(netTotal, summaryCurrency)} />
        <ResultMetricCard icon={TrendingUp} label="Income" tone="text-emerald-300" value={formatCompactMoney(incomeTotal, summaryCurrency)} />
        <ResultMetricCard icon={TrendingDown} label="Expenses" tone="text-rose-300" value={formatCompactMoney(expenseTotal, summaryCurrency)} />
        <ResultMetricCard icon={WalletCards} label="Deposits & breaches" value={`${formatCompactMoney(depositTotal, summaryCurrency)} · ${breachedAccounts.length}`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.62fr)_minmax(360px,0.38fr)]">
        <FeatureCard>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardLabel icon={WalletCards} label="Account book" />
              <h2 className="mt-3 text-xl font-semibold text-white">Journal accounts and prop-firm accounts</h2>
            </div>
            <ThemedSelect
              className="h-10 min-w-44"
              onChange={(value) => setAccountFilter(value as "ALL" | FinanceAccountKind)}
              options={[
                { label: "All accounts", value: "ALL" },
                { label: "Broker only", value: "broker" },
                { label: "Prop firm only", value: "propFirm" },
              ]}
              value={accountFilter}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
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
                    <span className="mt-1 block truncate text-xs text-slate-500">
                      {row.account.provider || "Manual"} · {financeAccountKindLabel(row.account.kind)}
                    </span>
                  </span>
                  <span
                    className="h-3 w-3 shrink-0 rounded-full ring-2 ring-black/40"
                    style={{ backgroundColor: row.account.color, boxShadow: `0 0 18px ${row.account.color}` }}
                  />
                </div>
                <div className={`mt-4 text-2xl font-semibold tabular-nums ${toneForNumber(row.net)}`}>
                  {formatMoney(row.net, row.account.currency)}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <MiniMetric label="Deposit" value={formatCompactMoney(row.deposit, row.account.currency)} />
                  <MiniMetric label="Income" value={formatCompactMoney(row.income, row.account.currency)} />
                  <MiniMetric label="Expense" value={formatCompactMoney(row.expense, row.account.currency)} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="status-pill h-7 px-2 text-[10px]">{financeAccountStatusLabel(row.account.status)}</span>
                  {row.account.breached && (
                    <span className="status-pill h-7 border-rose-300/25 bg-rose-300/10 px-2 text-[10px] text-rose-100">Breached</span>
                  )}
                  {row.account.kind === "propFirm" && (
                    <span className="status-pill h-7 px-2 text-[10px]">{financePropStageLabel(row.account.stage)}</span>
                  )}
                  {row.account.kind === "broker" && (
                    <span className="status-pill h-7 px-2 text-[10px]">{formatCompactMoney(row.account.starting_balance, row.account.currency)} start</span>
                  )}
                </div>
              </button>
            ))}
            {accountRows.length === 0 && (
              <EmptyState icon={WalletCards} message="Create a broker account or prop-firm challenge to start tracking cashflow." />
            )}
          </div>
        </FeatureCard>

        <div className="grid content-start gap-4">
          <FeatureCard>
            <CardLabel icon={Plus} label="Create account" />
            <form className="mt-4 grid gap-3" onSubmit={createAccount}>
              <div className="grid grid-cols-2 gap-2">
                {FINANCE_ACCOUNT_KIND_OPTIONS.map((option) => (
                  <button
                    className={`control-button justify-center ${accountKind === option.value ? "workspace-tab-active" : ""}`}
                    key={option.value}
                    onClick={() => {
                      const nextKind = option.value as FinanceAccountKind;
                      setAccountKind(nextKind);
                      setAccountName(nextKind === "propFirm" ? "Prop Firm Challenge" : "Broker Account");
                    }}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <label className="form-field">
                Account name
                <input className="input-control h-10 normal-case tracking-normal" onChange={(event) => setAccountName(event.target.value)} value={accountName} />
              </label>
              <label className="form-field">
                {accountKind === "propFirm" ? "Prop firm" : "Broker"}
                <input className="input-control h-10 normal-case tracking-normal" onChange={(event) => setProvider(event.target.value)} placeholder={accountKind === "propFirm" ? "FTMO, MyForexFunds, FundedNext..." : "IC Markets, Pepperstone, Zerodha..."} value={provider} />
              </label>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(128px,150px)]">
                <label className="form-field">
                  Currency
                  <ThemedSelect className="h-10" onChange={setAccountCurrency} options={selectOptionsWithValue(CURRENCY_OPTIONS, accountCurrency)} portal value={accountCurrency} />
                </label>
                <label className="form-field min-w-0">
                  Accent
                  <ThemedColorPicker ariaLabel="Finance account color" compact onChange={setAccountColor} value={accountColor} />
                </label>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="form-field">
                  Status
                  <ThemedSelect className="h-10" onChange={(value) => setAccountStatus(sanitizeFinanceAccountStatus(value))} options={FINANCE_STATUS_OPTIONS} portal value={accountStatus} />
                </label>
                <label className="form-field">
                  Start date
                  <ThemedDatePicker onChange={setStartDate} value={startDate} />
                </label>
              </div>
              {accountKind === "propFirm" ? (
                <>
                  <label className="form-field">
                    Phase
                    <ThemedSelect className="h-10" onChange={(value) => setPropStage(sanitizeFinancePropStage(value))} options={FINANCE_PROP_STAGE_OPTIONS} portal value={propStage} />
                  </label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="form-field">
                      Account size
                      <input className="input-control h-10 normal-case tracking-normal" min="0" onChange={(event) => setFundedAmount(event.target.value)} type="number" value={fundedAmount} />
                    </label>
                    <label className="form-field">
                      Challenge fee
                      <input className="input-control h-10 normal-case tracking-normal" min="0" onChange={(event) => setChallengeFee(event.target.value)} type="number" value={challengeFee} />
                    </label>
                    <label className="form-field">
                      Profit target
                      <input className="input-control h-10 normal-case tracking-normal" min="0" onChange={(event) => setProfitTarget(event.target.value)} type="number" value={profitTarget} />
                    </label>
                    <label className="form-field">
                      Max loss
                      <input className="input-control h-10 normal-case tracking-normal" min="0" onChange={(event) => setMaxLossLimit(event.target.value)} type="number" value={maxLossLimit} />
                    </label>
                    <label className="form-field">
                      Profit split %
                      <input className="input-control h-10 normal-case tracking-normal" max="100" min="0" onChange={(event) => setProfitSplitPercent(event.target.value)} type="number" value={profitSplitPercent} />
                    </label>
                  </div>
                </>
              ) : (
                <>
                  <label className="form-field">
                    Initial deposit
                    <input className="input-control h-10 normal-case tracking-normal" min="0" onChange={(event) => setStartingBalance(event.target.value)} type="number" value={startingBalance} />
                  </label>
                  <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2 text-xs leading-5 text-slate-500">
                    Existing Journal accounts are synced here automatically, with their initial balance recorded as an initial deposit.
                  </div>
                </>
              )}
              <label className="form-field">
                Notes
                <textarea className="input-control min-h-20 py-3 normal-case tracking-normal" onChange={(event) => setAccountNotes(event.target.value)} value={accountNotes} />
              </label>
              <button className="control-button workspace-tab-active justify-center" disabled={!accountName.trim()} type="submit">
                <Plus size={15} />
                Save account
              </button>
            </form>
          </FeatureCard>

          <FeatureCard>
            <CardLabel icon={BadgeDollarSign} label="Add ledger entry" />
            <form className="mt-4 grid gap-3" onSubmit={addEntry}>
              <div className="grid grid-cols-3 gap-2">
                <button className={`control-button justify-center ${entryType === "deposit" ? "border-amber-300/25 bg-amber-300/10 text-amber-100" : ""}`} onClick={() => handleEntryTypeChange("deposit")} type="button">
                  <WalletCards size={15} />
                  Deposit
                </button>
                <button className={`control-button justify-center ${entryType === "income" ? "workspace-tab-active" : ""}`} onClick={() => handleEntryTypeChange("income")} type="button">
                  <TrendingUp size={15} />
                  Income
                </button>
                <button className={`control-button justify-center ${entryType === "expense" ? "border-rose-300/25 bg-rose-300/10 text-rose-100" : ""}`} onClick={() => handleEntryTypeChange("expense")} type="button">
                  <TrendingDown size={15} />
                  Expense
                </button>
              </div>
              <label className="form-field">
                Account
                <ThemedSelect className="h-10" onChange={handleEntryAccountChange} options={accountOptions} portal value={entryAccountId} />
              </label>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
                <label className="form-field">
                  Amount
                  <input className="input-control h-10 normal-case tracking-normal" min="0" onChange={(event) => setEntryAmount(event.target.value)} step="any" type="number" value={entryAmount} />
                </label>
                <label className="form-field">
                  Currency
                  <ThemedSelect className="h-10" onChange={setEntryCurrency} options={selectOptionsWithValue(CURRENCY_OPTIONS, entryCurrency)} portal value={entryCurrency} />
                </label>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="form-field">
                  Category
                  <ThemedSelect
                    className="h-10"
                    onChange={setEntryCategory}
                    options={financeCategoriesForType(entryType).map((category) => ({ label: category, value: category }))}
                    portal
                    value={entryCategory}
                  />
                </label>
                <label className="form-field">
                  Date
                  <ThemedDatePicker onChange={setEntryDate} value={entryDate} />
                </label>
              </div>
              <label className="form-field">
                Notes
                <textarea className="input-control min-h-20 py-3 normal-case tracking-normal" onChange={(event) => setEntryDescription(event.target.value)} value={entryDescription} />
              </label>
              <button className="control-button workspace-tab-active justify-center" disabled={positivePositionNumber(entryAmount) <= 0} type="submit">
                <Plus size={15} />
                Add entry
              </button>
            </form>
          </FeatureCard>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.64fr)_minmax(340px,0.36fr)]">
        <FeatureCard>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardLabel icon={ClipboardList} label="Finance ledger" />
              <h2 className="mt-3 text-xl font-semibold text-white">Income and expense history</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <ThemedSelect
                className="h-10 min-w-36"
                onChange={(value) => setEntryTypeFilter(value as "ALL" | FinanceEntryType)}
                options={[
                  { label: "All entries", value: "ALL" },
                  { label: "Deposits", value: "deposit" },
                  { label: "Income", value: "income" },
                  { label: "Expenses", value: "expense" },
                ]}
                value={entryTypeFilter}
              />
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-4">
            <MiniMetric label="Rows" value={filteredEntries.length.toLocaleString()} />
            <MiniMetric label="Prop active" value={String(activePropAccounts.length)} />
            <MiniMetric label="Prop expenses" value={formatCompactMoney(propExpenseTotal, summaryCurrency)} />
            <MiniMetric label="Setup fees" value={formatCompactMoney(propChallengeFees, summaryCurrency)} />
          </div>
          <div className="mt-4 overflow-auto rounded-md border border-white/10 bg-black/20">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-white/10 text-xs uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-3 py-3 font-medium">Type</th>
                  <th className="px-3 py-3 font-medium">Account</th>
                  <th className="px-3 py-3 font-medium">Category</th>
                  <th className="px-3 py-3 text-right font-medium">Amount</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((entry) => {
                  const account = financeEntryAccount(entry, accountById);
                  const signed = financeSignedEntryAmount(entry);
                  return (
                    <tr className="border-b border-white/10 text-slate-300 last:border-0" key={entry.id}>
                      <td className="px-4 py-3 text-slate-500">{formatFinanceDate(entry.date)}</td>
                      <td className="px-3 py-3">
                        <span className={`status-pill h-7 px-2 text-[10px] ${financeEntryTypeToneClass(entry.type)}`}>
                          {financeEntryTypeLabel(entry.type)}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-white">{account?.name ?? "General ledger"}</div>
                          <div className="truncate text-xs text-slate-500">{account ? financeAccountKindLabel(account.kind) : "Unlinked"}</div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-slate-200">{entry.category}</div>
                          {entry.description && <div className="truncate text-xs text-slate-500">{entry.description}</div>}
                        </div>
                      </td>
                      <td className={`px-3 py-3 text-right text-base font-semibold tabular-nums ${toneForNumber(signed)}`}>
                        {formatMoney(signed, entry.currency)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          className="icon-button h-8 w-8 border-rose-300/20 text-rose-200 hover:bg-rose-300/10 hover:text-rose-100"
                          onClick={() => void deleteEntry(entry)}
                          title="Delete entry"
                          type="button"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filteredEntries.length === 0 && (
                  <tr>
                    <td className="px-4 py-10 text-center text-sm text-slate-500" colSpan={6}>
                      Add income or expense entries to build the ledger.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </FeatureCard>

        <FeatureCard>
          {selectedAccount ? (
            <div className="grid gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardLabel icon={WalletCards} label="Selected account" />
                  <h2 className="mt-3 flex min-w-0 items-center gap-2 text-xl font-semibold text-white">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: selectedAccount.color, boxShadow: `0 0 18px ${selectedAccount.color}` }}
                    />
                    <span className="truncate">{selectedAccount.name}</span>
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {selectedAccount.provider || "Manual"} · {financeAccountKindLabel(selectedAccount.kind)} · {selectedAccount.currency}
                  </p>
                </div>
                <button
                  className="icon-button h-9 w-9 border-rose-300/20 text-rose-200 hover:bg-rose-300/10 hover:text-rose-100"
                  onClick={() => void deleteAccount(selectedAccount)}
                  title="Delete account"
                  type="button"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <CompactMetric label="Ledger net" tone={toneForNumber(selectedLedgerNet)} value={formatMoney(selectedLedgerNet, selectedAccount.currency)} />
                <CompactMetric label="Entries" value={String(selectedAccountEntries.length)} />
                <CompactMetric label={selectedAccount.kind === "propFirm" ? "Account size" : "Starting"} value={formatMoney(selectedAccount.kind === "propFirm" ? selectedAccount.funded_amount : selectedAccount.starting_balance, selectedAccount.currency)} />
                <CompactMetric label={selectedAccount.kind === "propFirm" ? "Profit split" : "Status"} value={selectedAccount.kind === "propFirm" ? `${formatOptionalNumber(selectedAccount.profit_split_percent)}%` : financeAccountStatusLabel(selectedAccount.status)} />
              </div>
              <div className="grid gap-3 rounded-md border border-white/10 bg-black/20 p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="form-field">
                    Status
                    <ThemedSelect
                      className="h-10"
                      onChange={(value) => {
                        const status = sanitizeFinanceAccountStatus(value);
                        updateAccount(selectedAccount.id, {
                          breached: status === "BREACHED" ? true : selectedAccount.breached,
                          status,
                        });
                      }}
                      options={FINANCE_STATUS_OPTIONS}
                      portal
                      value={selectedAccount.status}
                    />
                  </label>
                  {selectedAccount.kind === "propFirm" ? (
                    <label className="form-field">
                      Phase
                      <ThemedSelect
                        className="h-10"
                        onChange={(value) => updateAccount(selectedAccount.id, { stage: sanitizeFinancePropStage(value) })}
                        options={FINANCE_PROP_STAGE_OPTIONS}
                        portal
                        value={selectedAccount.stage}
                      />
                    </label>
                  ) : (
                    <label className="form-field">
                      Started
                      <ThemedDatePicker onChange={(value) => updateAccount(selectedAccount.id, { start_date: value })} value={selectedAccount.start_date} />
                    </label>
                  )}
                </div>
                {selectedAccount.kind === "propFirm" && (
                  <>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <MiniMetric label="Challenge deposit" value={formatMoney(selectedAccount.challenge_fee, selectedAccount.currency)} />
                      <MiniMetric label="Profit target" value={formatMoney(selectedAccount.profit_target, selectedAccount.currency)} />
                      <MiniMetric label="Max loss" value={formatMoney(selectedAccount.max_loss_limit, selectedAccount.currency)} />
                      <MiniMetric label="Firm share est." value={formatMoney(selectedFirmShareEstimate, selectedAccount.currency)} />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="form-field">
                        Profit split %
                        <input
                          className="input-control h-10 normal-case tracking-normal"
                          max="100"
                          min="0"
                          onChange={(event) => updateAccount(selectedAccount.id, { profit_split_percent: positivePositionNumber(event.target.value) })}
                          type="number"
                          value={String(selectedAccount.profit_split_percent)}
                        />
                      </label>
                      <label className="form-field">
                        Breach date
                        <ThemedDatePicker onChange={(value) => updateAccount(selectedAccount.id, { breach_date: value, breached: Boolean(value) || selectedAccount.breached })} value={selectedAccount.breach_date} />
                      </label>
                    </div>
                    <label className="form-field">
                      Breach reason
                      <textarea
                        className="input-control min-h-20 py-3 normal-case tracking-normal"
                        onChange={(event) => updateAccount(selectedAccount.id, {
                          breach_reason: event.target.value,
                          breached: event.target.value.trim().length > 0 || selectedAccount.breached,
                          status: event.target.value.trim().length > 0 && selectedAccount.status === "ACTIVE" ? "BREACHED" : selectedAccount.status,
                        })}
                        placeholder="Daily loss, max drawdown, rule violation, inactivity, news hold..."
                        value={selectedAccount.breach_reason}
                      />
                    </label>
                  </>
                )}
                <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-3 text-sm leading-6 text-slate-400">
                  {selectedAccount.breached && selectedAccount.breach_reason ? selectedAccount.breach_reason : selectedAccount.notes || "No account notes yet."}
                </div>
              </div>
            </div>
          ) : (
            <EmptyState icon={WalletCards} message="Select or create an account to see lifecycle details." />
          )}
        </FeatureCard>
      </div>
      {confirmDialog}
    </PageScaffold>
  );
}

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
            <button aria-label="Copy account balance" className="icon-button h-8 w-8" onClick={() => void copyBalance()} title="Copy balance" type="button">
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
              <button aria-label="Copy overview summary" className="icon-button h-8 w-8" onClick={() => void copyDashboardSummary()} title="Copy overview summary" type="button">
                <Share2 size={14} />
              </button>
              <button aria-label="Toggle calendar details" aria-expanded={calendarInfoOpen} className={`icon-button h-8 w-8 ${calendarInfoOpen ? "workspace-tab-active" : ""}`} onClick={() => setCalendarInfoOpen((value) => !value)} title="Calendar details" type="button">
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

function liveFeedErrorMessage(error: unknown, hasCachedData: boolean) {
  const message = importErrorMessage(error);
  if (message === "Bad Gateway" || message.includes("502")) {
    return hasCachedData
      ? "Live feed is temporarily unavailable. Showing cached market data."
      : "Live feed is temporarily unavailable for this symbol.";
  }
  return hasCachedData ? `Showing cached market data. ${message}` : message;
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
  const [instrument, setInstrument] = useState("EUR/USD");
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
  const [name, setName] = useState("");
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
              <button aria-label="Cancel editing" className="icon-button h-8 w-8" onClick={closeEditorPopovers} title="Cancel" type="button">
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
  const [entryPrice, setEntryPrice] = useState("");
  const [exitPrice, setExitPrice] = useState("");
  const [quantity, setQuantity] = useState("");
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
                  <input className="input-control h-10 normal-case tracking-normal" onChange={(event) => setEntryPrice(event.target.value)} placeholder="1.00000" value={entryPrice} />
                </label>
                <label className="form-field">
                  {entryType === "MISSED" ? "Planned exit" : "Exit"}
                  <input className="input-control h-10 normal-case tracking-normal" onChange={(event) => setExitPrice(event.target.value)} placeholder="1.00100" value={exitPrice} />
                </label>
                <label className="form-field">
                  Size
                  <input className="input-control h-10 normal-case tracking-normal" onChange={(event) => setQuantity(event.target.value)} placeholder="10000" value={quantity} />
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
          <button aria-label="Copy note summary" className="icon-button h-9 w-9" onClick={copySummary} title="Copy note summary" type="button">
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
  onInspectTrade,
  onRetryReports,
  reportsError,
  reportsLoading,
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

  if (reportsLoading) {
    return (
      <PageScaffold
        eyebrow="Backtest Reports"
        title="Backtest Performance Reports"
        description="Loading performance, risk, calendar, and recap data from your closed replay trades."
      >
        <section aria-label="Loading report data" className="terminal-panel p-5" role="status">
          <div className="flex items-center gap-3 text-sm text-slate-300">
            <RefreshCw aria-hidden="true" className="motion-safe:animate-spin text-cyan-300" size={18} />
            Loading report data…
          </div>
          <div aria-hidden="true" className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((item) => (
              <div className="h-20 rounded-md border border-white/10 bg-white/[0.03] motion-safe:animate-pulse" key={item} />
            ))}
          </div>
        </section>
      </PageScaffold>
    );
  }

  if (reportsError) {
    return (
      <PageScaffold
        eyebrow="Backtest Reports"
        title="Backtest Performance Reports"
        description="Performance, overview, day/time, risk, tags, calendar, and recaps from replay/backtest trades only."
      >
        <section aria-labelledby="reports-error-title" className="terminal-panel p-5" role="alert">
          <h2 className="text-base font-semibold text-white" id="reports-error-title">Reports could not be loaded</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">{reportsError}</p>
          <button className="control-button mt-4" onClick={onRetryReports} type="button">
            <RefreshCw size={14} />
            Retry reports
          </button>
        </section>
      </PageScaffold>
    );
  }

  if (closedTrades.length === 0) {
    return (
      <PageScaffold
        eyebrow="Backtest Reports"
        title="Backtest Performance Reports"
        description="Performance, overview, day/time, risk, tags, calendar, and recaps from replay/backtest trades only."
      >
        <section aria-labelledby="reports-empty-title" className="terminal-panel p-5" role="status">
          <h2 className="text-base font-semibold text-white" id="reports-empty-title">No closed backtest trades yet</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">Complete and close a replay trade to populate performance, risk, calendar, and recap reports.</p>
        </section>
      </PageScaffold>
    );
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

      {filteredClosedTrades.length === 0 ? (
        <section aria-labelledby="reports-filtered-empty-title" className="terminal-panel p-5" role="status">
          <h2 className="text-base font-semibold text-white" id="reports-filtered-empty-title">No trades match these filters</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">Adjust the filters or reset them to see all {closedTrades.length} closed trades.</p>
          <button className="control-button mt-4" onClick={() => setFilters(DEFAULT_RESULT_FILTERS)} type="button">
            <RefreshCw size={14} />
            Reset filters
          </button>
        </section>
      ) : <>
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
              <div className="p-4">
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
              <div className="p-4">
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
              <ResultsTradeTable currency={reportCurrency} datasets={datasets} onInspectTrade={onInspectTrade} sessionById={sessionById} trades={filteredClosedTrades} />
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
              <div className="p-4">
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
              <ResultsTradeTable currency={reportCurrency} datasets={datasets} onInspectTrade={onInspectTrade} sessionById={sessionById} trades={filteredClosedTrades} />
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
      </>}
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
      await applyStrategyNameChange(strategy.name, null);
      const nextSelected = strategyRows.find(
        (row) =>
          !sameStrategyName(row.name, strategy.name) &&
          !sameStrategyName(row.name, "Unassigned"),
      );
      setSelectedName(nextSelected?.name ?? null);
      setDeleteTarget(null);
    } finally {
      setMutatingName(null);
    }
  }

  async function applyStrategyNameChange(currentName: string, nextName: string | null) {
    const matchingSessions = sessions.filter((session) => sameStrategyName(sessionStrategyName(session), currentName));
    const matchingTrades = trades.filter((trade) =>
      sameStrategyName(tradeStrategyName(trade, sessionById.get(trade.session_id)), currentName),
    );
    const updates = [
      ...matchingSessions.map((session) =>
        updateSession(session.id, { strategy_name: nextName }),
      ),
      ...matchingTrades.map((trade) =>
        updateTradeStrategy(trade.id, { strategy_name: nextName }),
      ),
    ];
    if (updates.length > 0) {
      await Promise.all(updates);
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
              Delete <span className="font-semibold text-white">{deleteTarget.name}</span>? Linked sessions and trades will stay intact with their strategy assignment cleared.
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
  strategies,
}: SharedPageProps) {
  const sections: Array<{
    description: string;
    icon: LucideIcon;
    id: SettingsSectionId;
    label: string;
  }> = [
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
  const [active, setActive] = useState<SettingsSectionId>("orders");
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
          {active === "orders" ? (
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

type SettingsSectionId = "orders" | "notes" | "tags";

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
  onInspectTrade,
  sessionById,
  trades,
}: {
  currency: string;
  datasets: DatasetCatalog | null;
  onInspectTrade: (trade: Trade) => void;
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
                <td className="px-3 py-3 font-semibold text-white"><button className="min-h-10 text-cyan-100 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300" onClick={() => onInspectTrade(trade)} type="button">Inspect trade #{trade.id}</button></td>
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
    <Dialog
      className={`grid ${widthClass} max-w-none grid-rows-[auto_minmax(0,1fr)] overflow-hidden`}
      label={title}
      onClose={onClose}
      open
    >
        <DialogHeader onClose={onClose} title={title} />
        <div className="min-h-0 overflow-y-auto p-4">
          {children}
        </div>
    </Dialog>
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const activeMonth = month ?? internalMonth;
  const cells = useMemo(() => buildMonthCells(days, activeMonth), [days, activeMonth]);
  const heatmapMargin = compact
    ? { top: 10, right: 10, bottom: 0, left: 24 }
    : { top: 10, right: 10, bottom: 0, left: 34 };
  const heatmapGap = compact ? 2 : 3;

  useEffect(() => {
    if (month == null) {
      setInternalMonth(monthCursorFromDateKey(days[0]?.date));
    }
  }, [days, month]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }
    const updateWidth = () => {
      setContainerWidth(node.clientWidth);
    };
    updateWidth();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const { cellByDate, columns, overlayCells } = useMemo(() => {
    const activeMonthDate = dateFromKey(activeMonth);
    const firstOfMonth = new Date(activeMonthDate.getFullYear(), activeMonthDate.getMonth(), 1);
    const monthOffset = (firstOfMonth.getDay() + 6) % 7;
    const firstVisibleDate = new Date(firstOfMonth);
    firstVisibleDate.setDate(firstVisibleDate.getDate() - monthOffset);
    const heatmapColumns: HeatmapColumn[] = [];
    const nextOverlayCells: Array<{
      column: number;
      dateKey: string;
      day: number | null;
      isCurrentMonth: boolean;
      key: string;
      pnl: number;
      row: number;
      trades: number;
    }> = [];

    for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
      const row = cellIndex % 7;
      const column = Math.floor(cellIndex / 7);
      const date = new Date(firstVisibleDate);
      date.setDate(firstVisibleDate.getDate() + cellIndex);
      const dateKey = dateKeyFromDate(date);
      const cell = cells[cellIndex];

      if (!heatmapColumns[column]) {
        heatmapColumns[column] = { bin: column, bins: [] };
      }

      heatmapColumns[column]?.bins.push({
        bin: row,
        count: cell?.trades ?? 0,
        date,
      });
      nextOverlayCells.push({
        column,
        dateKey,
        day: cell?.day ?? null,
        isCurrentMonth:
          date.getFullYear() === activeMonthDate.getFullYear() &&
          date.getMonth() === activeMonthDate.getMonth(),
        key: cell?.key ?? dateKey,
        pnl: cell?.pnl ?? 0,
        row,
        trades: cell?.trades ?? 0,
      });
    }

    return {
      cellByDate: new Map(nextOverlayCells.map((cell) => [cell.dateKey, cell])),
      columns: heatmapColumns,
      overlayCells: nextOverlayCells,
    };
  }, [activeMonth, cells]);

  const columnCount = Math.max(columns.length, 1);
  const innerWidth = Math.max(containerWidth - heatmapMargin.left - heatmapMargin.right, 0);
  const cellSize = innerWidth > 0 ? innerWidth / columnCount : 0;
  const plotHeight = cellSize * 7;
  const chartHeight = Math.max(96, heatmapMargin.top + plotHeight + heatmapMargin.bottom);

  function changeMonth(delta: number) {
    const nextMonth = addMonthsToDateKey(activeMonth, delta);
    if (onMonthChange) {
      onMonthChange(nextMonth);
      return;
    }
    setInternalMonth(nextMonth);
  }

  function handleHeatmapClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!onSelectDate || cellSize <= 0) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left - heatmapMargin.left;
    const y = event.clientY - bounds.top - heatmapMargin.top;
    if (x < 0 || y < 0 || x >= innerWidth || y >= plotHeight) {
      return;
    }
    const column = Math.floor(x / cellSize);
    const row = Math.floor(y / cellSize);
    const cell = overlayCells[column * 7 + row];
    if (!cell || cell.day == null || cell.trades === 0) {
      return;
    }
    onSelectDate(cell.dateKey);
  }

  return (
    <div className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <button aria-label="Previous month" className="icon-button h-8 w-8" onClick={() => changeMonth(-1)} title="Previous month" type="button">
          <ChevronLeft size={14} />
        </button>
        <div className="text-sm font-semibold text-white">{calendarTitle(activeMonth)}</div>
        <button aria-label="Next month" className="icon-button h-8 w-8" onClick={() => changeMonth(1)} title="Next month" type="button">
          <ChevronRight size={14} />
        </button>
      </div>
      <div
        ref={containerRef}
        className={`relative overflow-hidden rounded-md border border-white/10 bg-[#070b10]/80 ${
          onSelectDate ? "cursor-pointer" : ""
        }`}
        onClick={handleHeatmapClick}
        style={{ height: chartHeight }}
      >
        <BacklitHeatmapChart
          className="h-full w-full"
          data={columns}
          gap={heatmapGap}
          layout="fluid"
          levelColors={[
            "rgba(15, 23, 42, 0.58)",
            "rgba(34, 211, 238, 0.14)",
            "rgba(34, 211, 238, 0.24)",
            "rgba(6, 182, 212, 0.4)",
            "rgba(103, 232, 249, 0.62)",
          ]}
          margin={heatmapMargin}
        >
          <BacklitHeatmapCells cornerRadius={compact ? 4 : 6} />
          {!compact ? <BacklitHeatmapYAxis /> : null}
          <BacklitHeatmapTooltip
            formatLabel={(tradeCount, date) => {
              const key = dateKeyFromDate(date);
              const cell = cellByDate.get(key);
              if (!cell) {
                return shortDate(key);
              }
              const tradeLabel = `${tradeCount} ${tradeCount === 1 ? "trade" : "trades"}`;
              return `${shortDate(key)} · ${tradeLabel} · ${formatMoney(cell.pnl, currency)}`;
            }}
          />
        </BacklitHeatmapChart>
        {cellSize > 0 ? (
          <div
            className="pointer-events-none absolute inset-0 z-10"
            style={{
              left: heatmapMargin.left,
              top: heatmapMargin.top,
              width: innerWidth,
              height: plotHeight,
            }}
          >
            {overlayCells.map((cell) => {
              const isSelected =
                selectedDate === cell.dateKey ||
                Boolean(selectedRange && dateKeyInRange(cell.dateKey, selectedRange.start, selectedRange.end));
              const isRealDay = cell.day != null;
              const overlayStyle: CSSProperties = {
                height: Math.max(cellSize - heatmapGap, 0),
                left: cell.column * cellSize + heatmapGap / 2,
                top: cell.row * cellSize + heatmapGap / 2,
                width: Math.max(cellSize - heatmapGap, 0),
              };

              return (
                <div
                  className={`absolute overflow-hidden rounded-[6px] ${
                    isSelected ? "ring-1 ring-cyan-300/55 ring-inset" : ""
                  }`}
                  key={cell.key}
                  style={overlayStyle}
                >
                  {isRealDay ? (
                    <div className="flex h-full flex-col justify-between px-1.5 py-1">
                      <div className="flex items-start justify-between gap-1">
                        <span className={`text-[10px] font-semibold ${cell.trades > 0 ? "text-slate-100" : "text-slate-500"}`}>
                          {cell.day}
                        </span>
                        {!compact && cell.trades > 0 ? (
                          <span className="text-[9px] font-semibold text-slate-400">{cell.trades}</span>
                        ) : null}
                      </div>
                      {!compact && cell.trades > 0 ? (
                        <div className={`truncate text-[9px] font-semibold tabular-nums leading-none ${toneForNumber(cell.pnl)}`}>
                          {formatCompactMoney(cell.pnl, currency)}
                        </div>
                      ) : null}
                      {compact && cell.trades > 0 ? (
                        <div
                          className={`h-1.5 w-1.5 rounded-full ${
                            cell.pnl > 0 ? "bg-emerald-300" : cell.pnl < 0 ? "bg-rose-300" : "bg-cyan-300"
                          }`}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
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
  const data = useMemo(
    () =>
      values.map((value, index) => ({
        date: new Date(Date.UTC(2025, 0, index + 1)),
        label:
          index === 0
            ? "Start"
            : index === values.length - 1
              ? "Latest"
              : `Point ${index}`,
        value,
      })),
    [values]
  );

  if (values.length < 2) {
    return (
      <div
        className="grid place-items-center rounded-md border border-white/10 bg-[#070b10]/80 text-sm text-slate-500"
        style={{ height }}
      >
        No chart data
      </div>
    );
  }

  return (
    <div className="rounded-md border border-white/10 bg-[#070b10]/80 p-2" style={{ height }}>
      <BacklitLineChart
        aspectRatio={undefined}
        className="h-full w-full"
        data={data}
        margin={{ top: 18, right: 18, bottom: 30, left: 76 }}
        style={{ height: "100%" }}
      >
        <BacklitGrid highlightRowValues={[0]} horizontal />
        <BacklitYAxis
          formatValue={(value) => formatCompactMoney(value, currency)}
          numTicks={4}
        />
        {tone === "rose" ? (
          <BacklitLine
            curve={curveLinear}
            dataKey="value"
            fadeEdges={false}
            stroke="var(--loss)"
          />
        ) : (
          <>
            <BacklitLine
              curve={curveLinear}
              dataKey="value"
              fadeEdges={false}
              showHighlight={false}
              stroke="transparent"
              strokeWidth={0}
            />
            <ProfitLossLine dataKey="value" fadeEdges={false} />
          </>
        )}
        <BacklitChartTooltip
          content={({ point }) => {
            const value = Number(point.value ?? 0);
            return (
              <div className="min-w-[136px] px-3 py-2">
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  {String(point.label ?? "Point")}
                </div>
                <div className={`mt-1 text-sm font-semibold tabular-nums ${tone === "rose" ? "text-rose-300" : toneForNumber(value)}`}>
                  {formatMoney(value, currency)}
                </div>
              </div>
            );
          }}
          indicatorColor={
            tone === "rose"
              ? "var(--loss)"
              : (point) => profitLossColor(Number(point.value ?? 0))
          }
          showDatePill={false}
        />
      </BacklitLineChart>
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
  const visibleRows = useMemo(
    () =>
      rows
        .filter((row) => Number.isFinite(row.value))
        .slice(0, maxItems),
    [maxItems, rows],
  );
  const chartData = useMemo(
    () =>
      visibleRows.map((row) => ({
        label: row.label,
        value: row.value,
      })),
    [visibleRows],
  );
  const minWidth = Math.max(380, visibleRows.length * 62);

  if (visibleRows.length === 0) {
    return <EmptyState icon={BarChart3} message="No chart data yet." />;
  }

  return (
    <div className="mt-4 overflow-x-auto rounded-md border border-white/10 bg-black/20 px-3 py-3">
      <div
        className="rounded-md border border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(50,211,238,0.12),transparent_34%),rgba(2,6,23,0.84)] p-2"
        style={{ height: chartHeight, minWidth }}
      >
        <BacklitBarChart
          aspectRatio={undefined}
          barGap={0.36}
          className="h-full w-full"
          data={chartData}
          margin={{ top: 18, right: 18, bottom: 50, left: percent ? 54 : 76 }}
          xDataKey="label"
        >
          <BacklitGrid horizontal />
          <BacklitBar
            dataKey="value"
            fill={(datum) => Number(datum.value ?? 0) >= 0 ? "var(--profit)" : "var(--loss)"}
            lineCap="round"
          />
          <BacklitYAxis
            formatValue={(value) => (percent ? `${value.toFixed(0)}%` : formatCompactMoney(value, currency))}
            numTicks={5}
          />
          <BacklitBarXAxis maxLabels={8} showAllLabels={visibleRows.length <= 8} />
          <BacklitChartTooltip
            content={({ point }) => {
              const rowValue = Number(point.value ?? 0);
              return (
                <div className="min-w-[164px] px-3 py-2">
                  <div className="truncate text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    {String(point.label ?? "Bucket")}
                  </div>
                  <div className={`mt-1 text-sm font-semibold tabular-nums ${toneForNumber(rowValue)}`}>
                    {percent ? `${rowValue.toFixed(1)}%` : formatMoney(rowValue, currency)}
                  </div>
                </div>
              );
            }}
            indicatorColor={(point) =>
              Number(point.value ?? 0) >= 0
                ? "var(--profit)"
                : "var(--loss)"
            }
            showDatePill={false}
            showDots={false}
          />
        </BacklitBarChart>
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
    if (
      !name ||
      sameStrategyName(name, "Unassigned") ||
      names.some((current) => sameStrategyName(current, name))
    ) {
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
  if (typeof navigator === "undefined" && typeof document === "undefined") {
    return;
  }
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall back to a temporary textarea below when browser clipboard permissions are unavailable.
  }
  if (typeof document === "undefined") {
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.left = "-9999px";
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
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
  void downloadSubscribedTextFile(filename, contents, type);
}

const APP_DATA_TABLE_LABELS: Record<string, string> = {
  app_storage: "App storage",
  backtest_sessions: "Backtest sessions",
  dataset_assets: "Market instruments",
  dataset_settings: "Market data preferences",
  dataset_timeframes: "Market timeframes",
  executions: "Executions",
  orders: "Orders",
  playbooks: "Playbooks",
  positions: "Positions",
  trade_notes: "Trade notes",
  trades: "Trades",
};

const APP_DATA_TABLE_ORDER = [
  "backtest_sessions",
  "trades",
  "orders",
  "executions",
  "positions",
  "trade_notes",
  "playbooks",
  "app_storage",
  "dataset_settings",
  "dataset_assets",
  "dataset_timeframes",
];

function appDataBundleRows(bundle: AppDataBundle) {
  const knownRows = APP_DATA_TABLE_ORDER
    .filter((key) => key in bundle.tables)
    .map((key) => ({
      count: bundle.tables[key]?.length ?? 0,
      key,
      label: APP_DATA_TABLE_LABELS[key] ?? key,
    }));
  const extraRows = Object.keys(bundle.tables)
    .filter((key) => !APP_DATA_TABLE_ORDER.includes(key))
    .sort()
    .map((key) => ({
      count: bundle.tables[key]?.length ?? 0,
      key,
      label: APP_DATA_TABLE_LABELS[key] ?? key,
    }));
  return [...knownRows, ...extraRows];
}

function appDataBundleRecordCount(bundle: AppDataBundle) {
  return appDataBundleRows(bundle).reduce((sum, row) => sum + row.count, 0);
}

function bundleDateSlug(value: string | null | undefined) {
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return safeDate.toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

function parseAppDataBundle(value: unknown): AppDataBundle {
  if (!isPlainRecord(value) || value.app !== "edgelab" || typeof value.version !== "number") {
    throw new Error("Choose a valid EdgeLab data bundle.");
  }
  if (!isPlainRecord(value.tables)) {
    throw new Error("This EdgeLab bundle is missing table data.");
  }
  const tables: AppDataBundle["tables"] = {};
  for (const [key, rows] of Object.entries(value.tables)) {
    if (!Array.isArray(rows) || !rows.every(isPlainRecord)) {
      throw new Error(`Bundle table "${key}" is not valid.`);
    }
    tables[key] = rows as Array<Record<string, unknown>>;
  }
  return {
    app: "edgelab",
    exported_at: typeof value.exported_at === "string" ? value.exported_at : null,
    tables,
    version: value.version,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function purgeLegacyAppLocalStorage() {
  if (typeof window === "undefined") {
    return;
  }
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (key && isAppStorageLocalStorageKey(key)) {
      window.localStorage.removeItem(key);
    }
  }
}

function defaultFinanceTrackerData(): FinanceTrackerData {
  return {
    accounts: [],
    entries: [],
  };
}

function sanitizeFinanceTrackerData(value: unknown): FinanceTrackerData {
  if (!isPlainRecord(value)) {
    return defaultFinanceTrackerData();
  }
  const rawAccounts = Array.isArray(value.accounts) ? value.accounts : [];
  const accounts = rawAccounts
    .map(sanitizeFinanceAccount)
    .filter((account) => account.name.trim().length > 0);
  const validAccountIds = new Set(accounts.map((account) => account.id));
  const rawEntries = Array.isArray(value.entries) ? value.entries : [];
  const entries = rawEntries
    .map((entry) => sanitizeFinanceEntry(entry, validAccountIds))
    .filter((entry) => entry.amount > 0 && entry.date.trim().length > 0);
  const seededAccountIds = new Set(
    accounts
      .filter((account) =>
        isSeededFinanceAccount(account) &&
        entries.every((entry) =>
          entry.account_id !== account.id || isSeededFinanceDepositEntry(account, entry),
        ),
      )
      .map((account) => account.id),
  );
  return {
    accounts: accounts.filter((account) => !seededAccountIds.has(account.id)),
    entries: entries.filter((entry) => entry.account_id == null || !seededAccountIds.has(entry.account_id)),
  };
}

function sanitizeFinanceAccount(value: unknown): FinanceTrackerAccount {
  const candidate = isPlainRecord(value) ? value : {};
  const kind = sanitizeFinanceAccountKind(candidate.kind);
  const currency = normalizeCurrencyCode(typeof candidate.currency === "string" ? candidate.currency : "USD");
  const name = typeof candidate.name === "string" && candidate.name.trim()
    ? candidate.name.trim()
    : kind === "propFirm" ? "Prop Firm Account" : "Broker Account";
  const status = sanitizeFinanceAccountStatus(candidate.status);
  const breached = candidate.breached === true || status === "BREACHED";
  const rawJournalAccountId = typeof candidate.journal_account_id === "number"
    ? candidate.journal_account_id
    : Number(candidate.journal_account_id);
  return {
    breach_date: typeof candidate.breach_date === "string" ? candidate.breach_date : "",
    breach_reason: typeof candidate.breach_reason === "string" ? candidate.breach_reason : "",
    breached,
    challenge_fee: kind === "propFirm" ? safeNonNegativeNumber(candidate.challenge_fee, 0) : 0,
    color: normalizeAccountColor(typeof candidate.color === "string" ? candidate.color : null),
    created_at: typeof candidate.created_at === "string" ? candidate.created_at : new Date().toISOString(),
    currency,
    funded_amount: kind === "propFirm" ? safeNonNegativeNumber(candidate.funded_amount, 0) : 0,
    id: safePositiveInteger(candidate.id, 1),
    journal_account_id: Number.isInteger(rawJournalAccountId) && rawJournalAccountId > 0 ? rawJournalAccountId : null,
    kind,
    max_loss_limit: kind === "propFirm" ? safeNonNegativeNumber(candidate.max_loss_limit, 0) : 0,
    name,
    notes: typeof candidate.notes === "string" ? candidate.notes : "",
    profit_split_percent: kind === "propFirm" ? clampFinancePercent(candidate.profit_split_percent, 80) : 0,
    profit_target: kind === "propFirm" ? safeNonNegativeNumber(candidate.profit_target, 0) : 0,
    provider: typeof candidate.provider === "string" ? candidate.provider.trim() : "",
    stage: kind === "propFirm" ? sanitizeFinancePropStage(candidate.stage) : "live",
    starting_balance: kind === "broker" ? safeNonNegativeNumber(candidate.starting_balance, 0) : 0,
    start_date: typeof candidate.start_date === "string" && candidate.start_date.trim() ? candidate.start_date : financeToday(),
    status,
  };
}

function sanitizeFinanceEntry(value: unknown, validAccountIds: Set<number>): FinanceTrackerEntry {
  const candidate = isPlainRecord(value) ? value : {};
  const rawAccountId = typeof candidate.account_id === "number" ? candidate.account_id : Number(candidate.account_id);
  const accountId = Number.isInteger(rawAccountId) && validAccountIds.has(rawAccountId) ? rawAccountId : null;
  const type = sanitizeFinanceEntryType(candidate.type);
  const fallbackCategory = financeCategoriesForType(type)[0];
  return {
    account_id: accountId,
    amount: safeNonNegativeNumber(candidate.amount, 0),
    category: typeof candidate.category === "string" && candidate.category.trim() ? candidate.category.trim() : fallbackCategory,
    created_at: typeof candidate.created_at === "string" ? candidate.created_at : new Date().toISOString(),
    currency: normalizeCurrencyCode(typeof candidate.currency === "string" ? candidate.currency : "USD"),
    date: typeof candidate.date === "string" && candidate.date.trim() ? candidate.date : financeToday(),
    description: typeof candidate.description === "string" ? candidate.description : "",
    id: safePositiveInteger(candidate.id, 1),
    type,
  };
}

function sanitizeFinanceAccountKind(value: unknown): FinanceAccountKind {
  return value === "propFirm" ? "propFirm" : "broker";
}

function sanitizeFinanceAccountStatus(value: unknown): FinanceAccountStatus {
  return value === "PAUSED" || value === "PASSED" || value === "BREACHED" || value === "FAILED" || value === "ARCHIVED"
    ? value
    : "ACTIVE";
}

function sanitizeFinancePropStage(value: unknown): FinancePropStage {
  return value === "phase2" || value === "verification" || value === "funded" || value === "instant" || value === "live"
    ? value
    : "phase1";
}

function sanitizeFinanceEntryType(value: unknown): FinanceEntryType {
  return value === "deposit" || value === "income" ? value : "expense";
}

function financeCategoriesForType(type: FinanceEntryType) {
  if (type === "deposit") {
    return FINANCE_DEPOSIT_CATEGORIES;
  }
  return type === "income" ? FINANCE_INCOME_CATEGORIES : FINANCE_EXPENSE_CATEGORIES;
}

function financeDefaultDepositEntry(account: FinanceTrackerAccount, id: number): FinanceTrackerEntry | null {
  const amount = account.kind === "propFirm" ? account.challenge_fee : account.starting_balance;
  if (amount <= 0) {
    return null;
  }
  return {
    account_id: account.id,
    amount,
    category: account.kind === "propFirm" ? "Challenge fee deposit" : "Initial deposit",
    created_at: new Date().toISOString(),
    currency: account.currency,
    date: account.start_date || financeToday(),
    description: account.kind === "propFirm"
      ? "Default deposit from the prop-firm challenge fee."
      : "Default deposit from the account initial balance.",
    id,
    type: "deposit",
  };
}

function isSeededFinanceAccount(account: FinanceTrackerAccount) {
  return (
    account.kind === "broker" &&
    account.journal_account_id === 1 &&
    account.name === "Primary Journal Account" &&
    account.provider === "Manual" &&
    account.currency === "USD" &&
    account.starting_balance === 100000 &&
    account.notes === "" &&
    account.status === "ACTIVE" &&
    !account.breached
  );
}

function isSeededFinanceDepositEntry(
  account: FinanceTrackerAccount,
  entry: FinanceTrackerEntry,
) {
  return (
    entry.account_id === account.id &&
    entry.type === "deposit" &&
    entry.category === "Initial deposit" &&
    entry.amount === account.starting_balance &&
    entry.currency === account.currency &&
    entry.description === "Default deposit from the account initial balance."
  );
}

function clampFinancePercent(value: unknown, fallback: number) {
  return Math.min(100, Math.max(0, safeFiniteNumber(value, fallback)));
}

function safePositiveInteger(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function financeToday() {
  const date = new Date();
  const localOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - localOffset).toISOString().slice(0, 10);
}

function financeAccountKindLabel(kind: FinanceAccountKind) {
  return kind === "propFirm" ? "Prop firm" : "Broker";
}

function financeAccountStatusLabel(status: FinanceAccountStatus) {
  const labels: Record<FinanceAccountStatus, string> = {
    ACTIVE: "Active",
    ARCHIVED: "Archived",
    BREACHED: "Breached",
    FAILED: "Failed",
    PASSED: "Passed",
    PAUSED: "Paused",
  };
  return labels[status];
}

function financePropStageLabel(stage: FinancePropStage) {
  const labels: Record<FinancePropStage, string> = {
    funded: "Funded",
    instant: "Instant funded",
    live: "Live funded",
    phase1: "Challenge phase 1",
    phase2: "Challenge phase 2",
    verification: "Verification",
  };
  return labels[stage];
}

function financeSignedEntryAmount(entry: FinanceTrackerEntry) {
  return entry.type === "income" ? entry.amount : -entry.amount;
}

function financeEntryTypeLabel(type: FinanceEntryType) {
  return type === "deposit" ? "Deposit" : type === "income" ? "Income" : "Expense";
}

function financeEntryTypeToneClass(type: FinanceEntryType) {
  if (type === "income") {
    return "text-emerald-100";
  }
  return type === "deposit" ? "text-amber-100" : "text-rose-100";
}

function financeEntryAccount(
  entry: FinanceTrackerEntry,
  accountById: Map<number, FinanceTrackerAccount>,
) {
  return entry.account_id == null ? null : accountById.get(entry.account_id) ?? null;
}

function currencyForFinanceEntries(
  entries: FinanceTrackerEntry[],
  accountById: Map<number, FinanceTrackerAccount>,
  accounts: FinanceTrackerAccount[] = [],
  fallbackCurrency = "USD",
) {
  const currencies = new Set<string>();
  entries.forEach((entry) => {
    currencies.add(normalizeCurrencyCode(entry.currency || financeEntryAccount(entry, accountById)?.currency || fallbackCurrency));
  });
  if (currencies.size === 0) {
    accounts.forEach((account) => currencies.add(normalizeCurrencyCode(account.currency || fallbackCurrency)));
  }
  if (currencies.size === 0) {
    return normalizeCurrencyCode(fallbackCurrency);
  }
  return currencies.size === 1 ? Array.from(currencies)[0] : MIXED_CURRENCY;
}

function formatFinanceDate(value: string) {
  if (!value) {
    return "-";
  }
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
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
  const dataRef = useRef(data);
  const hydratedRef = useRef(false);
  const skipNextPersistRef = useRef(false);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    let active = true;
    void hydrateLiveJournalData().then((nextData) => {
      if (!active) {
        return;
      }
      dataRef.current = nextData;
      skipNextPersistRef.current = true;
      setData(nextData);
      hydratedRef.current = true;
    });
    const unsubscribe = subscribeAppStorageItem<unknown>(
      LIVE_JOURNAL_STORAGE_KEY,
      (value) => {
        if (value === dataRef.current) {
          return;
        }
        const nextData = sanitizeLiveJournalData(value);
        dataRef.current = nextData;
        skipNextPersistRef.current = true;
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
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    try {
      void saveAppStorageItem(LIVE_JOURNAL_STORAGE_KEY, data).catch(() => undefined);
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
        sessions,
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
  const usedAccountIds = liveJournalUsedAccountIds(rawSessions, candidate.trades);
  const accounts = accountsFromStorage.length > 0
    ? accountsFromStorage.filter((account) =>
        !isUnusedSeededLiveJournalAccount(account, usedAccountIds),
      )
    : buildLegacyJournalAccounts(rawSessions);
  const settings = sanitizeLiveJournalSettings(candidate.settings, accounts);
  const sessions = rawSessions.map((session) =>
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
  return {
    accounts: [],
    playbooks: [],
    sessions: [],
    settings,
    trades: [],
  };
}

function defaultLiveJournalSettings(): LiveJournalSettings {
  return {
    default_account_ids: [],
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

function defaultLiveSession(
  accounts: LiveJournalAccount[] = [],
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
    name: "Manual Journal",
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

function liveJournalUsedAccountIds(
  sessions: LiveJournalSession[],
  tradesValue: unknown,
) {
  const used = new Set<number>();
  for (const session of sessions) {
    for (const accountId of session.account_ids ?? []) {
      if (typeof accountId === "number") {
        used.add(accountId);
      }
    }
  }
  if (Array.isArray(tradesValue)) {
    for (const item of tradesValue) {
      if (!isPlainRecord(item) || !Array.isArray(item.account_ids)) {
        continue;
      }
      for (const accountId of item.account_ids) {
        if (typeof accountId === "number") {
          used.add(accountId);
        }
      }
    }
  }
  return used;
}

function isUnusedSeededLiveJournalAccount(
  account: LiveJournalAccount,
  usedAccountIds: Set<number>,
) {
  return (
    !usedAccountIds.has(account.id) &&
    account.id === 1 &&
    account.name === "Primary Journal Account" &&
    account.broker === "Manual" &&
    account.currency === "USD" &&
    account.initial_balance === 100000 &&
    account.notes === "" &&
    account.status === "ACTIVE"
  );
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
    return [];
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
  return accounts;
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
  while (cells.length < 42) {
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
