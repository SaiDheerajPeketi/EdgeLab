import type { WorkspaceSharePayload, WorkspaceShareScope } from "./workspaceShare";
import { AppDataReloadRequiredError, appDataRecoveryNeeded, assertAppDataAccess, captureAppDataAccess, recoverAppDataOperations, runAppDataReplacement, runAppDataRequest } from "./appDataBarrier";
import type { AppDataAccess, AppDataOperation, RequestProgress } from "./appDataBarrier";

export type Candle = {
  time: number;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ema_20: number | null;
  ema_50: number | null;
  rsi_14: number | null;
};

export type DatasetMeta = {
  csv_path: string;
  rows: number;
  first_timestamp: string | null;
  last_timestamp: string | null;
};

export type DatasetTimeframe = {
  timeframe: string;
  csv_path: string;
  rows: number;
  first_timestamp: string | null;
  last_timestamp: string | null;
  imported: boolean;
  imported_at: string | null;
};

export type DatasetInstrument = {
  id: string;
  name: string;
  symbol: string;
  currency: string;
  timezone: string;
  pnl_multiplier: number;
  folder_path: string | null;
  updated_at: string | null;
  timeframes: DatasetTimeframe[];
};

export type DatasetCatalog = {
  root: string;
  instruments: DatasetInstrument[];
};

export type DatasetRefreshResponse = {
  catalog: DatasetCatalog;
  summary: {
    assets: number;
    timeframes: number;
    candles: number;
  };
  status: DatasetRefreshStatus | null;
};

export type DatasetRefreshStatus = {
  running: boolean;
  current: string | null;
  summary: {
    assets: number;
    timeframes: number;
    candles: number;
  };
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
};

export type DatasetSettings = {
  root_path: string;
};

export type BarsResponse = {
  offset: number;
  limit: number;
  next_offset: number;
  bars: Candle[];
};

export type BinanceInstrument = {
  asset_class: string;
  base_asset: string;
  description: string;
  label: string;
  quote_asset: string;
  status: string;
  symbol: string;
};

export type BinanceInstrumentsResponse = {
  instruments: BinanceInstrument[];
};

export type DukascopyInstrument = {
  symbol: string;
  label: string;
  description: string;
  asset_class: string;
  base_currency: string;
  quote_currency: string;
  tags: string[];
};

export type DukascopyInstrumentsResponse = {
  instruments: DukascopyInstrument[];
};

export type DukascopyCandlesResponse = {
  candles: Candle[];
};

export type AngelOneInstrument = {
  token: string;
  symbol: string;
  label: string;
  description: string;
  exchange: string;
  exchange_type: number;
  asset_class: string;
  name: string;
  expiry: string | null;
  instrument_type: string;
  lot_size: number | null;
  tick_size: number | null;
};

export type AngelOneInstrumentsResponse = {
  instruments: AngelOneInstrument[];
};

export type EconomicCalendarEvent = {
  title: string;
  currency: string;
  starts_at: string;
  impact: string;
  forecast: string | null;
  previous: string | null;
  actual: string | null;
};

export type EconomicCalendarResponse = {
  provider: "forex_factory";
  source_url: string;
  updated_at: string;
  cache_expires_at: string;
  stale: boolean;
  events: EconomicCalendarEvent[];
};

export type Playbook = {
  id: number;
  name: string;
  description: string | null;
  rules: string | null;
  created_at: string;
};

export type PlaybookPayload = {
  name: string;
  description?: string | null;
  rules?: string | null;
};

export type PlaybookUpdatePayload = {
  name?: string;
  description?: string | null;
  rules?: string | null;
};

export type CommissionMode = "NONE" | "FIXED" | "PERCENT";

export type BacktestSession = {
  id: number;
  name: string;
  symbol: string;
  instrument: string | null;
  timeframe: string | null;
  csv_path: string | null;
  currency: string | null;
  timezone: string | null;
  pnl_multiplier: number;
  strategy_name: string | null;
  playbook_id: number | null;
  start_at: string | null;
  end_at: string | null;
  start_offset: number;
  end_offset: number | null;
  status: "ACTIVE" | "COMPLETE";
  current_offset: number;
  replay_ready: boolean;
  initial_balance: number;
  realized_pnl: number;
  default_commission_mode: CommissionMode;
  default_commission_value: number;
  default_fee_mode: CommissionMode;
  default_fee_value: number;
  created_at: string;
  updated_at: string;
};

export type Position = {
  id: number;
  session_id: number;
  side: "FLAT" | "LONG" | "SHORT";
  quantity: number;
  avg_price: number;
  stop_loss: number | null;
  take_profit: number | null;
  breakeven_trigger_r: number | null;
  breakeven_moved: boolean;
  strategy_name: string | null;
  playbook_id: number | null;
  unrealized_pnl: number;
};

export type Order = {
  id: number;
  session_id: number;
  playbook_id: number | null;
  status: "PENDING" | "FILLED" | "CANCELLED";
  side: "BUY" | "SELL";
  order_type: "MARKET" | "LIMIT" | "STOP";
  quantity: number | null;
  risk_percent: number | null;
  limit_price: number | null;
  stop_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  breakeven_trigger_r: number | null;
  reduce_only: boolean;
  commission_mode: CommissionMode;
  commission_value: number;
  fee_mode: CommissionMode;
  fee_value: number;
  strategy_name: string | null;
  mistake_tags: string[];
  notes: string | null;
  created_offset: number;
  filled_offset: number | null;
  filled_price: number | null;
  created_at: string;
  updated_at: string;
  filled_at: string | null;
};

export type Execution = {
  id: number;
  session_id: number;
  order_id: number | null;
  side: "BUY" | "SELL";
  timestamp: string;
  offset: number;
  price: number;
  quantity: number;
  realized_pnl: number;
  position_side_after: "FLAT" | "LONG" | "SHORT";
  position_quantity_after: number;
  created_at: string;
};

export type Trade = {
  id: number;
  session_id: number;
  status: "OPEN" | "CLOSED";
  side: "LONG" | "SHORT";
  entry_time: string;
  entry_offset: number;
  entry_price: number;
  quantity: number;
  remaining_quantity: number;
  stop_loss: number | null;
  take_profit: number | null;
  exit_time: string | null;
  exit_offset: number | null;
  exit_price: number | null;
  gross_pnl: number;
  realized_pnl: number;
  r_multiple: number | null;
  commission_mode: CommissionMode;
  commission_value: number;
  commission_amount: number;
  fee_mode: CommissionMode;
  fee_value: number;
  fee_amount: number;
  strategy_name: string | null;
  playbook_id: number | null;
  notes: string | null;
  mistake_tags: string[];
  emotional_state: string | null;
  screenshot_url: string | null;
};

export type AppBootstrap = {
  datasets: DatasetCatalog;
  playbooks: Playbook[];
  recent_sessions: BacktestSession[];
  strategy_summaries: StrategySummary[];
  dashboard_summary: MetricsSummary | null;
  active_session_id: number | null;
  recent_sessions_next_offset: number;
  recent_sessions_next_cursor: string | null;
  recent_sessions_has_more: boolean;
  recent_trades: Trade[];
  recent_session_limit: number;
  recent_trade_limit: number;
};

export type AppBootstrapShell = {
  playbooks: Playbook[];
  recent_sessions: BacktestSession[];
  strategy_summaries: StrategySummary[];
  dashboard_summary: MetricsSummary | null;
  active_session_id: number | null;
  recent_sessions_next_offset: number;
  recent_sessions_next_cursor: string | null;
  recent_sessions_has_more: boolean;
  recent_session_limit: number;
};

export type BacktestSessionPage = {
  items: BacktestSession[];
  offset: number;
  limit: number;
  next_offset: number;
  next_cursor: string | null;
  has_more: boolean;
};

export type TradePage = {
  items: Trade[];
  offset: number;
  limit: number;
  next_offset: number;
  next_cursor: string | null;
  has_more: boolean;
};

export type StrategySummaryAggregate = {
  closed_trades: number;
  winning_trades: number;
  net_pnl: number;
  gross_profit: number;
  gross_loss: number;
  win_rate: number;
  average_r: number | null;
  profit_factor: number | null;
  r_sum: number;
  r_samples: number;
};

export type StrategySummarySession = {
  session: BacktestSession;
  aggregate: StrategySummaryAggregate;
};

export type StrategySummary = {
  name: string;
  aggregate: StrategySummaryAggregate;
  sessions: StrategySummarySession[];
};

export type MetricsSummary = {
  net_pnl: number;
  win_rate: number;
  total_trades: number;
  winning_trades: number;
  breakeven_trades: number;
  open_trades: number;
  profit_factor: number | null;
  gross_pnl: number;
  total_commissions: number;
  total_fees: number;
  max_drawdown: number;
  recovery_factor: number | null;
  sharpe_ratio: number | null;
  average_r: number | null;
  average_hold_minutes: number | null;
  average_win: number | null;
  average_loss: number | null;
  expectancy: number | null;
  best_trade: number | null;
  worst_trade: number | null;
  longest_win_streak: number;
  longest_loss_streak: number;
};

export type MetricsCurves = {
  equity_curve: Array<{ timestamp: string; equity: number }>;
  strategy_performance: Array<{
    strategy_name: string;
    trades: number;
    net_pnl: number;
    win_rate: number;
    average_r: number | null;
  }>;
  side_breakdown: Array<{
    side: "LONG" | "SHORT";
    trades: number;
    net_pnl: number;
    win_rate: number;
  }>;
  calendar: Array<{ date: string; pnl: number; trades: number }>;
};

export type Metrics = MetricsSummary & MetricsCurves;

export type BacktestState = {
  session: BacktestSession;
  current_candle: Candle | null;
  position: Position | null;
  orders: Order[];
  executions: Execution[];
  trades: Trade[];
  metrics: Metrics;
};

export type BacktestReplayUpdate = {
  session: BacktestSession;
  current_candle: Candle | null;
  position: Position | null;
  orders: Order[] | null;
  executions: Execution[] | null;
  trades: Trade[] | null;
  metrics: Metrics | null;
  history_changed: boolean;
  metrics_changed: boolean;
};

export type OrderPayload = {
  side: "BUY" | "SELL";
  order_type: "MARKET" | "LIMIT" | "STOP";
  quantity?: number | null;
  risk_percent?: number | null;
  risk_base?: "CURRENT_BALANCE" | "INITIAL_BALANCE" | null;
  limit_price?: number | null;
  stop_price?: number | null;
  stop_loss?: number | null;
  take_profit?: number | null;
  breakeven_trigger_r?: number | null;
  reduce_only?: boolean;
  commission_mode?: CommissionMode;
  commission_value?: number | null;
  fee_mode?: CommissionMode;
  fee_value?: number | null;
  strategy_name?: string | null;
  playbook_id?: number | null;
  mistake_tags?: string[];
  notes?: string | null;
};

export type BacktestCreatePayload = {
  name?: string;
  symbol?: string;
  instrument?: string | null;
  timeframe?: string | null;
  csv_path?: string | null;
  currency?: string | null;
  timezone?: string | null;
  pnl_multiplier?: number | null;
  strategy_name?: string | null;
  playbook_id?: number | null;
  start_timestamp?: string | null;
  end_timestamp?: string | null;
  initial_balance?: number;
  initial_offset?: number;
  default_commission_mode?: CommissionMode;
  default_commission_value?: number | null;
  default_fee_mode?: CommissionMode;
  default_fee_value?: number | null;
};

export type BacktestSessionUpdatePayload = {
  name?: string;
  currency?: string | null;
  timezone?: string | null;
  pnl_multiplier?: number | null;
  strategy_name?: string | null;
  playbook_id?: number | null;
  status?: "ACTIVE" | "COMPLETE";
  initial_balance?: number;
  default_commission_mode?: CommissionMode | null;
  default_commission_value?: number | null;
  default_fee_mode?: CommissionMode | null;
  default_fee_value?: number | null;
};

export type BacktestTradeImportPayload = {
  account_name: string;
  source_name?: string | null;
  csv_text: string;
  initial_balance?: number;
  currency?: string | null;
  symbol?: string | null;
  instrument?: string | null;
  timeframe?: string | null;
  strategy_name?: string | null;
  default_commission_mode?: CommissionMode;
  default_commission_value?: number | null;
  default_fee_mode?: CommissionMode;
  default_fee_value?: number | null;
  column_mapping?: Record<string, string>;
};

export type BacktestTradeImportResult = {
  session: BacktestSession;
  trades: Trade[];
  imported_rows: number;
  skipped_rows: number;
  errors: string[];
  detected_columns: string[];
};

export type OrderUpdatePayload = Partial<OrderPayload>;

export type PositionUpdatePayload = {
  stop_loss?: number | null;
  take_profit?: number | null;
};

export type JournalPayload = {
  notes: string | null;
  mistake_tags: string[];
  strategy_name: string | null;
  emotional_state: string | null;
  screenshot_url: string | null;
  commission_mode?: CommissionMode | null;
  commission_value?: number | null;
  commission_amount?: number | null;
  fee_mode?: CommissionMode | null;
  fee_value?: number | null;
  fee_amount?: number | null;
};

export type TradeStrategyPayload = {
  strategy_name: string | null;
};

export type AppStorageItem<T = unknown> = {
  namespace: string;
  key: string;
  value: T | null;
  updated_at: string | null;
};

export type FeedbackCategory = "BUG" | "FEATURE" | "UX" | "PERFORMANCE" | "DATA" | "OTHER";
export type FeedbackStatus = "NEW" | "REVIEWED" | "CLOSED";

export type FeedbackPayload = {
  category: FeedbackCategory;
  message: string;
  context?: Record<string, unknown> | null;
};

export type FeedbackSubmission = {
  id: number;
  category: FeedbackCategory;
  message: string;
  status: FeedbackStatus;
  created_at: string;
};

export type AppDataBundle = {
  app: "edgelab";
  version: number;
  exported_at: string | null;
  tables: Record<string, Array<Record<string, unknown>>>;
};

export type AppDataImportResult = {
  ok: boolean;
  imported_at: string;
  summary: Record<string, number>;
};

export type IntegrationSecret = {
  id: number;
  provider: string;
  purpose: string;
  key_id: string;
  cipher_version: number;
  version: number;
  state: "active" | "revoked";
  created_at: string;
  updated_at: string;
  rotated_at: string | null;
  last_connected_at: string | null;
  revoked_at: string | null;
};

export type IntegrationSecretConnection = IntegrationSecret & {
  connection_status: "credentials-ready";
};

export type BrokerProvider = {
  provider_id: string;
  display_name: string;
  availability: "offline-fixture" | "available" | "unconfigured" | "planned";
  capabilities: {
    accounts: boolean;
    incremental_sync: boolean;
    orders: boolean;
    fills: boolean;
    live_connectivity: boolean;
  };
  requires_secret: boolean;
  description: string;
};

export type BrokerConnection = {
  id: number;
  provider: string;
  display_name: string;
  secret_id: number;
  status: "READY" | "SYNCING" | "HEALTHY" | "DEGRADED" | "ERROR" | "REVOKED";
  health: "UNKNOWN" | "HEALTHY" | "DEGRADED" | "ERROR";
  last_error_code: string | null;
  last_error_message: string | null;
  last_sync_started_at: string | null;
  last_sync_completed_at: string | null;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
};

export type BrokerSyncJob = {
  id: number;
  connection_id: number;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "RETRYING" | "DEAD_LETTER";
  attempt_count: number;
  max_attempts: number;
  error_code?: string | null;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkspaceShareCreatePayload = {
  workspace_key: string;
  title: string;
  scope: WorkspaceShareScope;
  recipient_email?: string | null;
  expires_at?: string | null;
  payload: WorkspaceSharePayload;
};

export type WorkspaceShareOwnerRecord = {
  id: number;
  workspace_key: string;
  snapshot_version: number;
  schema_version: number;
  scope: WorkspaceShareScope;
  title: string;
  recipient_email: string | null;
  payload_available: boolean;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
};

export type WorkspaceShareCreated = WorkspaceShareOwnerRecord & {
  public_token: string;
};

export type WorkspaceShareOpen = {
  snapshot_version: number;
  schema_version: number;
  scope: WorkspaceShareScope;
  title: string;
  created_at: string;
  expires_at: string | null;
  payload: WorkspaceSharePayload;
};

export type BetaProgramStatus = {
  mode: "beta" | "production";
  seats_total: number;
  seats_taken: number;
  seats_remaining: number;
  waitlist_count: number;
};

export type BetaAuthConfig = {
  deployment_mode: "beta" | "production";
  google_enabled: boolean;
  google_client_id: string | null;
  google_redirect_uri: string | null;
  manual_access_enabled: boolean;
  dev_auth_bypass_enabled: boolean;
};

export type UiRolloutServerResponse = {
  revision: string;
  kill_switch: boolean;
  flags: Partial<Record<"shell" | "journal" | "settings" | "chart" | "public", boolean>>;
};

export type BetaAccessPayload = {
  email: string;
  name?: string | null;
  provider?: "email" | "google";
};

export type BetaAuthUser = {
  id: number;
  email: string;
  name: string;
  provider: "email" | "google";
  approved: boolean;
  beta_position: number | null;
  deployment_mode: "beta" | "production";
  workspace_access: boolean;
  access_expires_at: string | null;
  is_beta_user: boolean;
  plan: "beta" | "pro" | "none";
};

export type BetaAuthSession = {
  token: string;
  created_at: string;
  expires_at: string;
  user: BetaAuthUser;
};

export type BetaAccessResponse = {
  session: BetaAuthSession;
  program: BetaProgramStatus;
};

export type GoogleAuthExchangePayload = {
  code: string;
  redirect_uri: string;
};

const API_BASE_URL =
  import.meta.env?.VITE_API_BASE_URL ?? "/api";
const API_BEARER_TOKEN =
  import.meta.env?.VITE_API_BEARER_TOKEN ?? "";
const AUTH_STORAGE_KEY = "edgelab.auth.session.v1";

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, message: string, detail: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

function normalizedApiPath(path: string) {
  const decoded = decodeURIComponent(path.split(/[?#]/, 1)[0]);
  if (/[\u0000-\u001f\u007f\\]/.test(decoded)) throw new Error("API paths cannot contain control characters or backslashes.");
  if (decoded.split("/").some((part) => part === "." || part === "..")) throw new Error("API paths cannot contain dot segments.");
  return `/${decoded.replace(/^\/+/, "")}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function portableMutation(path: string, init?: RequestInit) {
  const method = (init?.method ?? "GET").toUpperCase();
  const normalized = normalizedApiPath(path);
  if (["HEAD", "OPTIONS"].includes(method)) return false;
  if (/^\/app-data\/operations(?:\/|$)/.test(normalized)) return false;
  // Revoking an owned connection remains available when workspace access ends.
  if (method === "DELETE" && /^\/broker-connections\/\d+$/.test(normalized)) return false;
  // Catalog discovery and replay repair can commit account rows during reads.
  if (method === "GET") return /^\/(?:datasets(?:\/settings)?|bootstrap(?:-shell)?|backtests(?:\/.*)?|market-data\/(?:meta|bars))$/.test(normalized);
  return normalized === "/app-data/import" || /^\/(?:app-storage|settings|datasets|journal|backtests|playbooks|trades|broker-connections|broker-sync-jobs|quant\/backtests)(?:\/|$)/.test(normalized);
}

type AppDataOperationReceipt = {
  operation_id: string; method: string | null; path: string | null;
  status: "reserved" | "running" | "completed" | "canceled";
  http_status: number | null; result: AppDataImportResult | null;
  created_at: string; completed_at: string | null;
};

function validateOperationReceipt(value: unknown, operation: AppDataOperation): AppDataOperationReceipt {
  if (!appDataRecord(value) || Object.keys(value).length !== 8 ||
      !["operation_id", "method", "path", "status", "http_status", "result", "created_at", "completed_at"].every((key) => appDataOwn(value, key)) ||
      value.operation_id !== operation.id || !appDataTimestamp(value.created_at) ||
      !["reserved", "running", "completed", "canceled"].includes(String(value.status)) ||
      !((value.method === operation.method && value.path === operation.path) || (value.status === "canceled" && value.method === null && value.path === null))) {
    throw new AppDataReloadRequiredError("The server receipt could not be verified. Saves remain paused.");
  }
  if (value.status === "reserved" || value.status === "running") {
    if (value.http_status !== null || value.result !== null || value.completed_at !== null) throw new AppDataReloadRequiredError("Invalid pending server receipt. Saves remain paused.");
  } else {
    if (!appDataTimestamp(value.completed_at) || Date.parse(value.completed_at) < Date.parse(value.created_at)) throw new AppDataReloadRequiredError("Invalid receipt completion time. Saves remain paused.");
    if (value.status === "canceled") {
      if (value.http_status !== null || value.result !== null) throw new AppDataReloadRequiredError("Invalid cancellation receipt. Saves remain paused.");
    } else if (!Number.isInteger(value.http_status) || (value.http_status as number) < 100 || (value.http_status as number) > 599 ||
        (value.result !== null && !(operation.path === "/app-data/import" && value.http_status === 200))) {
      throw new AppDataReloadRequiredError("Invalid completed server receipt. Saves remain paused.");
    }
  }
  return value as unknown as AppDataOperationReceipt;
}

// Private metadata transport must not acquire a shared lock inside replacement
// or recovery's exclusive lock, or recursively reserve its own operation.
async function operationReceipt(operation: AppDataOperation, action: "reserve" | "recover", token: string, identity: () => void) {
  identity();
  try {
    const response = await fetch(`${API_BASE_URL}/app-data/operations/${operation.id}/${action}`, {
      method: "POST", headers: new Headers({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" }),
      ...(action === "reserve" ? { body: JSON.stringify({ method: operation.method, path: operation.path }) } : {}), cache: "no-store",
    });
    const text = await response.text();
    identity();
    if (!response.ok) throw new ApiError(response.status, "The server could not verify this account operation. Saves remain paused.", null);
    return validateOperationReceipt(JSON.parse(text), operation);
  } catch (error) {
    identity();
    throw error;
  }
}

async function reserveOperation(operation: AppDataOperation | undefined, access: AppDataAccess | null, headers: Headers, identity = () => assertAppDataAccess(access, true)) {
  if (!operation) return;
  const token = headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!token) throw new Error("Sign in before reserving an account operation.");
  const receipt = await operationReceipt(operation, "reserve", token, identity);
  if (receipt.status !== "reserved") throw new AppDataReloadRequiredError("This account operation has already started or was canceled. No request was sent.");
  identity();
  headers.set("X-EdgeLab-Operation-Id", operation.id);
}

async function confirmOperation(progress: RequestProgress, headers: Headers, response: Response, identity: () => void) {
  if (progress.operation) {
    const receipt = await operationReceipt(progress.operation, "recover", headers.get("Authorization")!.replace(/^Bearer /, ""), identity);
    if (!["completed", "canceled"].includes(receipt.status)) throw new AppDataReloadRequiredError("This account operation is still running. Saves remain paused until the server confirms completion.");
    if ((receipt.status === "canceled" && response.ok) || (receipt.status === "completed" && receipt.http_status !== response.status)) throw new AppDataReloadRequiredError("The response does not match its server receipt. Saves remain paused.");
    if (progress.operation.path === "/app-data/import" && receipt.status === "completed" && receipt.http_status === 200) validateAppDataImportResult(receipt.result, progress.operation.expected!);
  }
  progress.completed();
}

function coordinatedPath(path: string) {
  return !/^\/(?:auth(?:\/|$)|ui\/rollout$|health$|ready$)/.test(normalizedApiPath(path));
}

function operationSpecification(path: string, init?: RequestInit) {
  const method = (init?.method ?? "GET").toUpperCase();
  const normalized = normalizedApiPath(path);
  // Preserve the existing replay path until receipt throughput is authorized.
  // Its shared locks and legacy uncertainty markers still guard replacement.
  if (method === "POST" && /^\/backtests\/\d+\/advance(?:-compact)?$/.test(normalized)) return undefined;
  return { method, path: normalized };
}

async function request<T>(path: string, init?: RequestInit, replacement?: { operation: AppDataOperation; owner: ReturnType<typeof appDataOwner>; markSent: () => void }): Promise<T> {
  if (normalizedApiPath(path) === "/app-data/import" && !replacement) throw new Error("Use the validated account data import flow.");
  const access = !replacement && coordinatedPath(path) ? captureAppDataAccess() : null;
  const authToken = access?.token ?? readStoredAuthToken();
  const headers = new Headers(init?.headers);
  if (headers.has("X-EdgeLab-Operation-Id")) throw new Error("Account operation headers are managed by the validated request flow.");
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!headers.has("Authorization")) {
    if (authToken) {
      headers.set("Authorization", `Bearer ${authToken}`);
    } else if (API_BEARER_TOKEN) {
      headers.set("Authorization", `Bearer ${API_BEARER_TOKEN}`);
    }
  }
  if (access && headers.get("Authorization") !== `Bearer ${access.token}`) {
    throw new DOMException("Account session changed before request", "AbortError");
  }
  const identity = replacement ? () => assertAppDataOwner(replacement.owner) : () => assertAppDataAccess(access, false, true);
  const execute = async (progress: RequestProgress) => {
    if (init?.signal?.aborted) throw new DOMException("Request canceled", "AbortError");
    await reserveOperation(progress.operation, access, headers, replacement ? identity : () => assertAppDataAccess(access, true));
    if (init?.signal?.aborted) throw new DOMException("Request canceled", "AbortError");
    if (replacement) identity();
    else assertAppDataAccess(access, portableMutation(path, init));
    progress.sent();
    const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
    const text = await response.text();
    await confirmOperation(progress, headers, response, identity);
    let value;
    try { value = JSON.parse(text); } catch (error) { if (response.ok) throw error; }
    if (!response.ok) {
      const detail = value?.detail ?? response.statusText;
      throw new ApiError(response.status, typeof detail === "string" ? detail : response.statusText, detail);
    }
    return value as T;
  };
  return replacement ? execute({ operation: replacement.operation, sent: replacement.markSent, completed() {} }) : runAppDataRequest(access, portableMutation(path, init), execute, operationSpecification(path, init));
}

export function apiRequest<T>(path: string, init?: RequestInit) {
  return request<T>(path, init);
}

export async function authenticatedApiFetch(path: string, init?: RequestInit) {
  if (normalizedApiPath(path) === "/app-data/import") throw new Error("Use the validated account data import flow.");
  const access = coordinatedPath(path) ? captureAppDataAccess() : null;
  const headers = new Headers(init?.headers);
  if (headers.has("X-EdgeLab-Operation-Id")) throw new Error("Account operation headers are managed by the validated request flow.");
  const token = access?.token ?? getApiBearerToken();
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  if (access && headers.get("Authorization") !== `Bearer ${access.token}`) throw new DOMException("Account session changed before request", "AbortError");
  return runAppDataRequest(access, portableMutation(path, init), async (progress) => {
    if (init?.signal?.aborted) throw new DOMException("Request canceled", "AbortError");
    await reserveOperation(progress.operation, access, headers);
    if (init?.signal?.aborted) throw new DOMException("Request canceled", "AbortError");
    assertAppDataAccess(access, portableMutation(path, init));
    progress.sent();
    const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
    if (portableMutation(path, init) || !["GET", "HEAD", "OPTIONS"].includes((init?.method ?? "GET").toUpperCase())) await response.clone().arrayBuffer();
    await confirmOperation(progress, headers, response, () => assertAppDataAccess(access, false, true));
    return response;
  }, operationSpecification(path, init));
}

async function requestWithAuthorization<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  return request<T>(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
}

export function getApiBearerToken() {
  return readStoredAuthToken() || API_BEARER_TOKEN || null;
}

export function getApiWebSocketUrl(path: string) {
  const origin =
    typeof window === "undefined" ? "http://127.0.0.1" : window.location.origin;
  const base = new URL(API_BASE_URL, origin);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  const prefix = base.pathname.replace(/\/$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  base.pathname = `${prefix}${suffix}`;
  base.search = "";
  base.hash = "";
  return base.toString();
}

function readStoredAuthToken() {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as { token?: unknown };
    return typeof parsed.token === "string" && parsed.token.trim() ? parsed.token.trim() : null;
  } catch {
    return null;
  }
}

export function getDatasets() {
  return request<DatasetCatalog>("/datasets");
}

export function getBetaProgramStatus() {
  return request<BetaProgramStatus>("/auth/beta/status");
}

export function getBetaAuthConfig() {
  return request<BetaAuthConfig>("/auth/config");
}

export function getUiRolloutConfig() {
  return request<UiRolloutServerResponse>("/ui/rollout");
}

export function requestBetaAccess(payload: BetaAccessPayload) {
  return request<BetaAccessResponse>("/auth/beta/access", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function exchangeGoogleAuthCode(payload: GoogleAuthExchangePayload) {
  return request<BetaAccessResponse>("/auth/google/exchange", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function requestDevAuthBypass() {
  return request<BetaAccessResponse>("/auth/dev/bypass", {
    method: "POST",
  });
}

export function getAuthSession(token: string) {
  return requestWithAuthorization<BetaAuthSession>("/auth/session", token);
}

export function deleteAuthSession(token: string) {
  return requestWithAuthorization<{ ok: boolean }>("/auth/session", token, {
    method: "DELETE",
  });
}

export function refreshDatasets() {
  return request<DatasetRefreshResponse>("/datasets/refresh", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function getDatasetRefreshStatus() {
  return request<DatasetRefreshStatus>("/datasets/refresh/status");
}

export function patchDatasetSettings(payload: { root_path: string }) {
  return request<DatasetCatalog>("/datasets/settings", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function patchDatasetAsset(
  assetId: string,
  payload: { currency?: string | null; timezone?: string | null; pnl_multiplier?: number | null },
) {
  return request<DatasetCatalog>(`/datasets/assets/${encodeURIComponent(assetId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function getAppStorageItem<T = unknown>(namespace: string, key: string) {
  return request<AppStorageItem<T>>(
    `/app-storage/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`,
  );
}

export type ChartSettingsResponse = { presets: AppStorageItem; active: AppStorageItem };
export function getChartSettings() { return request<ChartSettingsResponse>("/settings/chart"); }
export function patchChartSettings(changes: Record<string, unknown>) {
  return request<ChartSettingsResponse>("/settings/chart", { method: "PATCH", body: JSON.stringify(changes) });
}
export function patchSettingsPreferences(changes: Record<string, unknown>) {
  return request<AppStorageItem>("/settings/preferences", { method: "PATCH", body: JSON.stringify(changes) });
}

export function putAppStorageItem<T = unknown>(
  namespace: string,
  key: string,
  value: T,
) {
  return request<AppStorageItem<T>>(
    `/app-storage/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      body: JSON.stringify({ value }),
    },
  );
}

export function deleteAppStorageItem(namespace: string, key: string) {
  return request<AppStorageItem<null>>(
    `/app-storage/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`,
    {
      method: "DELETE",
    },
  );
}

export const APP_DATA_TABLE_NAMES = Object.freeze([
  "dataset_settings", "dataset_assets", "dataset_timeframes", "app_storage", "playbooks",
  "backtest_sessions", "positions", "orders", "trades", "executions", "trade_notes",
  "journal_accounts", "journal_import_runs", "canonical_trades", "canonical_executions",
  "journal_tags", "canonical_trade_tags", "canonical_trade_notes", "canonical_trade_screenshots",
  "journal_daily_notes", "journal_import_rows", "journal_import_diagnostics", "journal_backfill_checkpoints",
] as const);

/** Local structure checks; the server still validates columns and owned relationships. */
export function validateAppDataBundle(value: unknown, completeExport = false): AppDataBundle {
  if (!appDataRecord(value)) throw new Error("The selected file does not contain an object.");
  if (value.app !== "edgelab" || value.version !== 1 ||
      Object.keys(value).some((key) => !["app", "version", "exported_at", "tables"].includes(key))) {
    throw new Error("The selected file is not a supported EdgeLab version 1 export.");
  }
  if (!appDataRecord(value.tables)) throw new Error("The export is missing its table collection.");
  if ((value.exported_at != null && !appDataTimestamp(value.exported_at)) ||
      (completeExport && !appDataTimestamp(value.exported_at))) {
    throw new Error("The export has an invalid creation time.");
  }
  for (const [name, rows] of Object.entries(value.tables)) {
    if (!APP_DATA_TABLE_NAMES.some((table) => table === name)) {
      throw new Error("The file includes an unsupported account data table.");
    }
    if (!Array.isArray(rows)) throw new Error(`Table “${name}” has an invalid row structure.`);
    const ids = new Set<number>();
    for (const row of rows) {
      if (!appDataRecord(row) || !Number.isSafeInteger(row.id) || (row.id as number) <= 0 || ids.has(row.id as number)) {
        throw new Error(`Table “${name}” requires distinct, positive, safely represented record IDs.`);
      }
      ids.add(row.id as number);
    }
  }
  if (completeExport && APP_DATA_TABLE_NAMES.some((table) => !appDataOwn(value.tables as object, table))) {
    throw new Error("The server export is incomplete. No download was prepared.");
  }
  return value as unknown as AppDataBundle;
}

export class AppDataImportUncertainError extends Error {
  readonly requiresReload = true;
  constructor() {
    super("Import completion could not be verified. Data may have changed. Reload the workspace and verify it before trying another import.");
    this.name = "AppDataImportUncertainError";
  }
}

export function validateAppDataImportResult(value: unknown, expected: Readonly<Record<string, number>>): AppDataImportResult {
  if (!appDataRecord(value) || value.ok !== true || !appDataTimestamp(value.imported_at) ||
      !appDataRecord(value.summary) || Object.keys(value.summary).length !== APP_DATA_TABLE_NAMES.length ||
      Object.keys(expected).length !== APP_DATA_TABLE_NAMES.length ||
      APP_DATA_TABLE_NAMES.some((table) => !appDataOwn(value.summary as object, table) ||
        !appDataOwn(expected, table) || !Number.isSafeInteger(expected[table]) || expected[table] < 0 ||
        !Number.isSafeInteger((value.summary as Record<string, unknown>)[table]) ||
        (value.summary as Record<string, unknown>)[table] !== expected[table])) {
    throw new AppDataImportUncertainError();
  }
  return value as unknown as AppDataImportResult;
}

function appDataRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function appDataOwn(value: object, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function appDataTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) return false;
  const [year, month, day, hour, minute, second] = value.slice(0, 19).split(/[-T:]/).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] &&
    hour <= 23 && minute <= 59 && second <= 59 && Number.isFinite(Date.parse(value));
}

function appDataOwner() {
  if (typeof window === "undefined") throw new Error("Sign in before transferring account data.");
  const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
  let session;
  try { session = JSON.parse(raw ?? "null"); } catch { /* Reject malformed authentication. */ }
  if (!Number.isSafeInteger(session?.user?.id) || session.user.id <= 0 ||
      typeof session.token !== "string" || !session.token.trim() ||
      typeof session.expiresAt !== "string" || !(Date.parse(session.expiresAt) > Date.now())) {
    throw new Error("Sign in before transferring account data.");
  }
  return { id: session.user.id as number, token: session.token.trim() as string, raw };
}

function assertAppDataOwner(owner: ReturnType<typeof appDataOwner>) {
  try {
    const current = appDataOwner();
    if (current.id === owner.id && current.token === owner.token) return;
  } catch { /* Expiry and sign-out invalidate the response as well. */ }
  throw new DOMException("Account session changed during data transfer", "AbortError");
}

// Shared across screen remounts and rollout changes. A sent replacement cannot
// safely be repeated using mounted state, even when its response is uncertain.
const appDataImportSessions = new Map<number, "working" | "reload">();

export async function exportAppDataBundle() {
  const owner = appDataOwner();
  try {
    const value = await requestWithAuthorization<unknown>("/app-data/export", owner.token);
    assertAppDataOwner(owner);
    return validateAppDataBundle(value, true);
  } catch (error) {
    assertAppDataOwner(owner);
    throw error;
  }
}

export async function recoverAccountDataOperations() {
  const owner = appDataOwner();
  const access = captureAppDataAccess();
  if (!access || access.owner !== `user-${owner.id}` || access.token !== owner.token) throw new DOMException("Account session changed", "AbortError");
  return recoverAppDataOperations(access, async (operation) => {
    // Counts belong to the frozen submitted bundle, never the current UI draft.
    if (operation.path === "/app-data/import" && (!operation.expected || Object.keys(operation.expected).length !== APP_DATA_TABLE_NAMES.length || APP_DATA_TABLE_NAMES.some((table) => !Number.isSafeInteger(operation.expected![table]) || operation.expected![table] < 0))) throw new AppDataReloadRequiredError("The interrupted import has invalid recovery counts. Saves remain paused.");
    const receipt = await operationReceipt(operation, "recover", owner.token, () => assertAppDataOwner(owner));
    if (!["completed", "canceled"].includes(receipt.status)) throw new AppDataReloadRequiredError("An account operation is still running. Check completion again before continuing.");
    if (operation.path === "/app-data/import" && receipt.status === "completed" && receipt.http_status === 200) {
      receipt.result = validateAppDataImportResult(receipt.result, operation.expected!);
    }
    return receipt;
  }, () => assertAppDataOwner(owner));
}

export async function importAppDataBundle(bundle: AppDataBundle): Promise<AppDataImportResult> {
  const owner = appDataOwner();
  const validated = validateAppDataBundle(bundle);
  if (appDataImportSessions.has(owner.id)) {
    throw new Error(appDataImportSessions.get(owner.id) === "working"
      ? "An import is already running for this account. Wait for its result."
      : "Reload the workspace and verify your data before trying another import.");
  }
  const expected = Object.fromEntries(APP_DATA_TABLE_NAMES.map((table) => [table, validated.tables[table]?.length ?? 0]));
  const body = JSON.stringify(validated);
  if (appDataRecoveryNeeded(`user-${owner.id}`)) {
    const recovery = await recoverAccountDataOperations();
    if (recovery.requiresReload) throw new AppDataReloadRequiredError("Previous account operations were checked. Reload the workspace before importing or saving again.");
  }
  appDataImportSessions.set(owner.id, "working");
  let sent = false;
  try {
    const result = await runAppDataReplacement<AppDataImportResult>(owner, async (markSent, operation) => {
      assertAppDataOwner(owner);
      if (!operation) throw new Error("The browser could not reserve a safe import. No request was sent.");
      const value = await request<unknown>("/app-data/import", { method: "POST", body, headers: { Authorization: `Bearer ${owner.token}` } }, { operation, owner, markSent: () => { markSent(); sent = true; } });
      assertAppDataOwner(owner);
      return validateAppDataImportResult(value, expected);
    }, { expected });
    assertAppDataOwner(owner);
    return result;
  } catch (error) {
    assertAppDataOwner(owner);
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (!sent) throw error;
    // Outside the replacement lock and ordinary save queues: no lock upgrade
    // or participant waiting on its own request. Never dispatch the import again.
    try {
      const recovery = await recoverAccountDataOperations();
      assertAppDataOwner(owner);
      const imported = recovery.results.find((receipt) => receipt.path === "/app-data/import" && receipt.status === "completed" && receipt.http_status === 200);
      if (imported?.result) return validateAppDataImportResult(imported.result, expected);
      throw new AppDataReloadRequiredError("The server confirmed that the import failed or was canceled. Reload the workspace before trying another import.");
    } catch (recoveryError) {
      assertAppDataOwner(owner);
      if (recoveryError instanceof AppDataReloadRequiredError && /failed or was canceled/.test(recoveryError.message)) throw recoveryError;
    }
    throw new AppDataImportUncertainError();
  } finally {
    if (sent) appDataImportSessions.set(owner.id, "reload");
    else appDataImportSessions.delete(owner.id);
  }
}

export function getIntegrationSecrets() {
  return request<IntegrationSecret[]>("/integration-secrets");
}

export function createIntegrationSecret(payload: {
  provider: string;
  purpose: string;
  credentials: Record<string, string>;
}) {
  return request<IntegrationSecret>("/integration-secrets", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function verifyIntegrationSecret(secretId: number) {
  return request<IntegrationSecretConnection>(`/integration-secrets/${secretId}/connect`, {
    method: "POST",
  });
}

export function rotateIntegrationSecret(secretId: number) {
  return request<IntegrationSecret>(`/integration-secrets/${secretId}/rotate`, {
    method: "POST",
  });
}

export function revokeIntegrationSecret(secretId: number) {
  return request<IntegrationSecret>(`/integration-secrets/${secretId}`, {
    method: "DELETE",
  });
}

export function getBrokerProviders() {
  return request<BrokerProvider[]>("/broker-providers");
}

export function getBrokerConnections() {
  return request<BrokerConnection[]>("/broker-connections");
}

export function createBrokerConnection(payload: {
  provider: string;
  display_name: string;
  secret_id: number;
}) {
  return request<BrokerConnection>("/broker-connections", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function refreshBrokerConnection(connectionId: number) {
  return request<BrokerSyncJob>(`/broker-connections/${connectionId}/refresh`, {
    method: "POST",
    body: JSON.stringify({ max_attempts: 3 }),
  });
}

export function revokeBrokerConnection(connectionId: number) {
  return request<BrokerConnection>(`/broker-connections/${connectionId}`, {
    method: "DELETE",
  });
}

export function createWorkspaceShare(payload: WorkspaceShareCreatePayload) {
  return request<WorkspaceShareCreated>("/workspace-shares", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getWorkspaceShares({
  workspaceKey,
  offset = 0,
  limit = 50,
}: {
  workspaceKey: string;
  offset?: number;
  limit?: number;
}) {
  const query = new URLSearchParams({
    workspace_key: workspaceKey,
    offset: String(offset),
    limit: String(limit),
  });
  return request<WorkspaceShareOwnerRecord[]>(`/workspace-shares?${query.toString()}`);
}

export function revokeWorkspaceShare(snapshotId: number) {
  return request<WorkspaceShareOwnerRecord>(`/workspace-shares/${snapshotId}/revoke`, {
    method: "POST",
  });
}

export function deleteWorkspaceSharePayload(snapshotId: number) {
  return request<WorkspaceShareOwnerRecord>(`/workspace-shares/${snapshotId}/payload`, {
    method: "DELETE",
  });
}

export function openWorkspaceShare(publicToken: string) {
  return request<WorkspaceShareOpen>("/workspace-shares/open", {
    headers: {
      "X-Workspace-Share-Token": publicToken,
    },
  });
}

export function postFeedback(payload: FeedbackPayload) {
  return request<FeedbackSubmission>("/feedback", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getFeedbackSubmissions(limit = 50) {
  const query = new URLSearchParams({ limit: String(limit) });
  return request<FeedbackSubmission[]>(`/feedback?${query.toString()}`);
}

export function getMeta(sessionId?: number) {
  const query = sessionId ? `?session_id=${sessionId}` : "";
  return request<DatasetMeta>(`/market-data/meta${query}`);
}

export function getBars(offset = 0, limit = 300, sessionId?: number) {
  const query = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  });
  if (sessionId) {
    query.set("session_id", String(sessionId));
  }
  return request<BarsResponse>(`/market-data/bars?${query.toString()}`);
}

export function getBinanceInstruments(search = "", limit = 3000) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (search.trim()) {
    query.set("search", search.trim());
  }
  return request<BinanceInstrumentsResponse>(`/live/binance/instruments?${query.toString()}`);
}

export function getDukascopyInstruments(search = "", limit = 160) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (search.trim()) {
    query.set("search", search.trim());
  }
  return request<DukascopyInstrumentsResponse>(`/live/dukascopy/instruments?${query.toString()}`);
}

export function getDukascopyCandles(
  instrument: string,
  interval: string,
  limit = 260,
  before?: number,
) {
  const query = new URLSearchParams({
    instrument,
    interval,
    limit: String(limit),
  });
  if (before != null && Number.isFinite(before)) {
    query.set("before", String(Math.max(0, Math.floor(before))));
  }
  return request<DukascopyCandlesResponse>(`/live/dukascopy/candles?${query.toString()}`);
}

export function getAngelOneInstruments(search = "", limit = 12000, refresh = false) {
  const query = new URLSearchParams({
    limit: String(limit),
    refresh: refresh ? "true" : "false",
  });
  if (search.trim()) {
    query.set("search", search.trim());
  }
  return request<AngelOneInstrumentsResponse>(`/live/angelone/instruments?${query.toString()}`);
}

export function getForexFactoryCalendar(refresh = false) {
  const query = new URLSearchParams({ refresh: refresh ? "true" : "false" });
  return request<EconomicCalendarResponse>(`/economic-calendar/forex-factory?${query.toString()}`);
}

export function getLatestBacktest() {
  return request<BacktestState>("/backtests/latest");
}

export function getBacktest(sessionId: number) {
  return request<BacktestState>(`/backtests/${sessionId}`);
}

export function getBacktests() {
  return request<BacktestSession[]>("/backtests");
}

export function getBacktestSessionSummaries(
  options: { cursor?: string | null; offset?: number; limit?: number; status?: "ACTIVE" | "COMPLETE" } = {},
) {
  const params = new URLSearchParams();
  if (options.cursor) {
    params.set("cursor", options.cursor);
  }
  if (options.offset !== undefined) {
    params.set("offset", String(options.offset));
  }
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  if (options.status !== undefined) {
    params.set("status", options.status);
  }
  const query = params.toString() ? `?${params.toString()}` : "";
  return request<BacktestSessionPage>(`/backtests/summaries${query}`);
}

export function getBacktestStrategySummaries(limit = 50) {
  return request<StrategySummary[]>(`/backtests/strategy-summaries?limit=${limit}`);
}

export function createBacktest(payload: BacktestCreatePayload = {}) {
  return request<BacktestState>("/backtests", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function importBacktestTrades(payload: BacktestTradeImportPayload) {
  return request<BacktestTradeImportResult>("/backtests/import-trades", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateBacktestSession(
  sessionId: number,
  payload: BacktestSessionUpdatePayload,
) {
  return request<BacktestSession>(`/backtests/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteBacktestSession(sessionId: number) {
  return request<{ ok: boolean }>(`/backtests/${sessionId}`, {
    method: "DELETE",
  });
}

export function advanceBacktest(sessionId: number, steps = 1) {
  return request<BacktestState>(`/backtests/${sessionId}/advance`, {
    method: "POST",
    body: JSON.stringify({ steps }),
  });
}

export function advanceBacktestCompact(sessionId: number, steps = 1) {
  return request<BacktestReplayUpdate>(`/backtests/${sessionId}/advance-compact`, {
    method: "POST",
    body: JSON.stringify({ steps }),
  });
}

export function jumpBacktest(
  sessionId: number,
  payload: { offset?: number | null; timestamp?: string | null },
) {
  return request<BacktestState>(`/backtests/${sessionId}/jump`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function postBacktestOrder(sessionId: number, payload: OrderPayload) {
  return request<BacktestState>(`/backtests/${sessionId}/orders`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function patchBacktestOrder(
  sessionId: number,
  orderId: number,
  payload: OrderUpdatePayload,
) {
  return request<BacktestState>(`/backtests/${sessionId}/orders/${orderId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function patchBacktestPosition(
  sessionId: number,
  payload: PositionUpdatePayload,
) {
  return request<BacktestState>(`/backtests/${sessionId}/position`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteBacktestOrder(sessionId: number, orderId: number) {
  return request<BacktestState>(`/backtests/${sessionId}/orders/${orderId}`, {
    method: "DELETE",
  });
}

export function getPlaybooks() {
  return request<Playbook[]>("/playbooks");
}

export function getBootstrap(limit?: number) {
  const query = limit == null ? "" : `?limit=${limit}`;
  return request<AppBootstrap>(`/bootstrap${query}`);
}

export function getBootstrapShell(limit?: number) {
  const query = limit == null ? "" : `?limit=${limit}`;
  return request<AppBootstrapShell>(`/bootstrap-shell${query}`);
}

export function postPlaybook(payload: PlaybookPayload) {
  return request<Playbook>("/playbooks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function patchPlaybook(playbookId: number, payload: PlaybookUpdatePayload) {
  return request<Playbook>(`/playbooks/${playbookId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deletePlaybook(playbookId: number) {
  return request<{ ok: boolean }>(`/playbooks/${playbookId}`, {
    method: "DELETE",
  });
}

export function getTrades(
  sessionId?: number,
  options: { offset?: number; limit?: number } = {},
) {
  const params = new URLSearchParams();
  if (sessionId) {
    params.set("session_id", String(sessionId));
  }
  if (options.offset !== undefined) {
    params.set("offset", String(options.offset));
  }
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  const query = params.toString() ? `?${params.toString()}` : "";
  return request<Trade[]>(`/trades${query}`);
}

export function getTradesPage(
  sessionId?: number,
  options: { cursor?: string | null; offset?: number; limit?: number } = {},
) {
  const params = new URLSearchParams();
  if (sessionId) {
    params.set("session_id", String(sessionId));
  }
  if (options.cursor) {
    params.set("cursor", options.cursor);
  }
  if (options.offset !== undefined) {
    params.set("offset", String(options.offset));
  }
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  const query = params.toString() ? `?${params.toString()}` : "";
  return request<TradePage>(`/trades/page${query}`);
}

export function getMetrics(sessionId?: number) {
  const query = sessionId ? `?session_id=${sessionId}` : "";
  return request<Metrics>(`/metrics${query}`);
}

export function getMetricsSummary(sessionId?: number) {
  const query = sessionId ? `?session_id=${sessionId}` : "";
  return request<MetricsSummary>(`/metrics/summary${query}`);
}

export function getMetricsCurves(sessionId?: number) {
  const query = sessionId ? `?session_id=${sessionId}` : "";
  return request<MetricsCurves>(`/metrics/curves${query}`);
}

export function patchJournal(tradeId: number, payload: JournalPayload) {
  return request<Trade>(`/trades/${tradeId}/journal`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function patchTradeStrategy(tradeId: number, payload: TradeStrategyPayload) {
  return request<Trade>(`/trades/${tradeId}/strategy`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}
