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
  recent_trades: Trade[];
  recent_session_limit: number;
  recent_trade_limit: number;
};

export type Metrics = {
  net_pnl: number;
  win_rate: number;
  total_trades: number;
  profit_factor: number | null;
  max_drawdown: number;
  sharpe_ratio: number | null;
  average_r: number | null;
  best_trade: number | null;
  worst_trade: number | null;
  longest_win_streak: number;
  longest_loss_streak: number;
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

export type BacktestState = {
  session: BacktestSession;
  current_candle: Candle | null;
  position: Position | null;
  orders: Order[];
  executions: Execution[];
  trades: Trade[];
  metrics: Metrics;
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

export type BetaProgramStatus = {
  mode: "beta";
  seats_total: number;
  seats_taken: number;
  seats_remaining: number;
  waitlist_count: number;
};

export type BetaAuthConfig = {
  google_enabled: boolean;
  google_client_id: string | null;
  google_redirect_uri: string | null;
  manual_access_enabled: boolean;
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
  is_beta_user: true;
  plan: "beta";
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
  import.meta.env.VITE_API_BASE_URL ?? "/api";
const API_BEARER_TOKEN =
  import.meta.env.VITE_API_BEARER_TOKEN ?? "";
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const authToken = readStoredAuthToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(authToken
        ? { Authorization: `Bearer ${authToken}` }
        : API_BEARER_TOKEN
          ? { Authorization: `Bearer ${API_BEARER_TOKEN}` }
          : {}),
      ...init?.headers,
    },
    ...init,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    const detail = error?.detail ?? response.statusText;
    throw new ApiError(
      response.status,
      typeof detail === "string" ? detail : response.statusText,
      detail,
    );
  }

  return response.json() as Promise<T>;
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
  const authToken = readStoredAuthToken();
  base.search = authToken ? `authToken=${encodeURIComponent(authToken)}` : "";
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

export function exportAppDataBundle() {
  return request<AppDataBundle>("/app-data/export");
}

export function importAppDataBundle(bundle: AppDataBundle) {
  return request<AppDataImportResult>("/app-data/import", {
    method: "POST",
    body: JSON.stringify(bundle),
  });
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

export function getDukascopyCandles(instrument: string, interval: string, limit = 260) {
  const query = new URLSearchParams({
    instrument,
    interval,
    limit: String(limit),
  });
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

export function getBootstrap() {
  return request<AppBootstrap>("/bootstrap");
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

export function getMetrics(sessionId?: number) {
  const query = sessionId ? `?session_id=${sessionId}` : "";
  return request<Metrics>(`/metrics${query}`);
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
