import { apiRequest } from "./api";
import { getStoredAuthSession } from "./authSession";
import { runJournalMutation } from "./journalMutationState";

type JournalUpdate = { kind: "account"; account: JournalAccount } | { kind: "review"; trade: CanonicalTrade } | { kind: "daily-note"; note: JournalDailyNote };
const journalListeners = new Set<(update: JournalUpdate) => void>();
export function subscribeJournalUpdates(listener: (update: JournalUpdate) => void) {
  journalListeners.add(listener);
  return () => { journalListeners.delete(listener); };
}

/** Keep a replacement interface current when a request from the previous one finishes. */
function publishJournalUpdate(ownerId: number | undefined, update: JournalUpdate) {
  if (ownerId && ownerId === getStoredAuthSession()?.user.id) journalListeners.forEach((listener) => listener(update));
}

export function latestJournalRecord<T extends { updated_at: string }>(incoming: T, confirmed?: T) {
  return confirmed && Date.parse(confirmed.updated_at) >= Date.parse(incoming.updated_at) ? confirmed : incoming;
}

declare global {
  interface String {
    replaceAll(searchValue: string | RegExp, replaceValue: string): string;
  }
}

export type JournalNumeric = number | string;
export type JournalTagCategory = "SETUP" | "POSITIVE" | "MISTAKE" | "PROCESS";
export type JournalEntryType = "TAKEN" | "MISSED";
export type JournalSetupGrade = "A+" | "A" | "B" | "C" | "D" | "F";

export type JournalAccount = {
  id: number;
  broker_account_id: number | null;
  source_type: string;
  source_key: string;
  name: string;
  provider: string;
  currency: string;
  timezone: string;
  initial_balance: JournalNumeric;
  color: string | null;
  notes: string | null;
  status: "ACTIVE" | "ARCHIVED";
  created_at: string;
  updated_at: string;
};

export type JournalAccountCreate = {
  name: string;
  provider?: string;
  currency?: string;
  timezone?: string;
  initial_balance?: number;
  color?: string | null;
  notes?: string | null;
  broker_account_id?: number | null;
};

export type JournalTag = {
  id: number;
  category: JournalTagCategory;
  name: string;
  color: string | null;
  archived_at: string | null;
  created_at: string;
};

export type CanonicalExecution = {
  id: number;
  source_type: string;
  source_ref: string;
  execution_type: "ENTRY" | "EXIT" | "FILL";
  side: "BUY" | "SELL";
  occurred_at: string;
  price: JournalNumeric;
  quantity: JournalNumeric;
  commission: JournalNumeric;
  fees: JournalNumeric;
  sequence: number;
  source_revision: number;
  fingerprint: string;
  raw_payload: Record<string, unknown>;
  created_at: string;
};

export type CanonicalTrade = {
  id: number;
  account_id: number;
  import_run_id: number | null;
  source_type: "MANUAL" | "CSV_IMPORT" | "APP_STORAGE" | "BACKTEST" | "BROKER";
  source_ref: string;
  duplicate_key: string;
  entry_type: JournalEntryType;
  status: "OPEN" | "CLOSED" | "MISSED" | "VOIDED";
  symbol: string;
  source_symbol: string | null;
  currency: string;
  source_timezone: string;
  side: "LONG" | "SHORT";
  entry_time: string;
  exit_time: string | null;
  entry_price: JournalNumeric;
  exit_price: JournalNumeric | null;
  quantity: JournalNumeric;
  remaining_quantity: JournalNumeric;
  gross_pnl: JournalNumeric;
  net_pnl: JournalNumeric;
  commission: JournalNumeric;
  fees: JournalNumeric;
  stop_loss: JournalNumeric | null;
  take_profit: JournalNumeric | null;
  planned_entry_price: JournalNumeric | null;
  planned_exit_price: JournalNumeric | null;
  planned_stop_loss: JournalNumeric | null;
  planned_take_profit: JournalNumeric | null;
  r_multiple: JournalNumeric | null;
  strategy_name: string | null;
  emotional_state: string | null;
  missed_reason: string | null;
  rating: number | null;
  setup_grade: JournalSetupGrade | null;
  reviewed: boolean;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  tags: JournalTag[];
  notes: Array<{ id: number; kind: string; body: string; created_at: string }>;
  screenshots: Array<{ id: number; url: string; caption: string | null; created_at: string }>;
  executions: CanonicalExecution[];
};

export type CanonicalTradeCreate = {
  account_id: number;
  symbol: string;
  currency?: string | null;
  source_timezone?: string | null;
  side: "LONG" | "SHORT";
  entry_type?: JournalEntryType;
  entry_time: string;
  exit_time?: string | null;
  entry_price: number;
  exit_price?: number | null;
  quantity: number;
  remaining_quantity?: number | null;
  gross_pnl?: number | null;
  net_pnl?: number | null;
  commission?: number;
  fees?: number;
  stop_loss?: number | null;
  take_profit?: number | null;
  planned_entry_price?: number | null;
  planned_exit_price?: number | null;
  planned_stop_loss?: number | null;
  planned_take_profit?: number | null;
  r_multiple?: number | null;
  strategy_name?: string | null;
  emotional_state?: string | null;
  missed_reason?: string | null;
  rating?: number | null;
  setup_grade?: JournalSetupGrade | null;
  reviewed?: boolean;
  tag_ids?: number[];
  note?: string | null;
  screenshot_urls?: string[];
};

export type CanonicalTradeReviewUpdate = Partial<Pick<CanonicalTradeCreate,
  "entry_time" | "exit_time" | "entry_price" | "exit_price" | "stop_loss" |
  "take_profit" | "strategy_name" | "emotional_state" | "rating" | "setup_grade"
>> & {
  reviewed?: boolean;
  tag_ids?: number[];
  note?: string | null;
  screenshot_urls?: string[];
};

export type JournalDailyNote = {
  id: number;
  account_id: number | null;
  note_date: string;
  body: string;
  created_at: string;
  updated_at: string;
};

export type JournalImportDiagnostic = {
  id: number;
  row_number: number | null;
  severity: "INFO" | "WARNING" | "ERROR";
  code: string;
  field: string | null;
  message: string;
};

export type JournalImportRun = {
  id: number;
  account_id: number;
  source_name: string;
  source_digest: string;
  status: "RUNNING" | "COMPLETED" | "FAILED" | "ROLLED_BACK";
  source_timezone: string;
  currency: string;
  default_symbol: string | null;
  column_mapping: Record<string, string>;
  grouping: Record<string, unknown>;
  detected_columns: string[];
  total_rows: number;
  imported_rows: number;
  skipped_rows: number;
  duplicate_rows: number;
  error_rows: number;
  created_at: string;
  completed_at: string | null;
  rolled_back_at: string | null;
  rows: Array<{
    id: number;
    row_number: number;
    group_key: string;
    status: "IMPORTED" | "SKIPPED" | "DUPLICATE" | "ERROR" | "ROLLED_BACK";
    duplicate_key: string | null;
    trade_id: number | null;
    source_fingerprint: string;
    normalized_payload: Record<string, unknown> | null;
  }>;
  diagnostics: JournalImportDiagnostic[];
};

export type JournalImportCreate = {
  csv_text: string;
  destination_account_id?: number;
  destination_account?: JournalAccountCreate;
  source_name: string;
  source_timezone: string;
  currency?: string | null;
  default_symbol?: string | null;
  strategy_name?: string | null;
  default_commission_mode?: "NONE" | "FIXED" | "PERCENT";
  default_commission_value?: number;
  default_fee_mode?: "NONE" | "FIXED" | "PERCENT";
  default_fee_value?: number;
  column_mapping?: Record<string, string>;
  grouping?: { mode: "ROW" | "COLUMN"; column?: string | null };
};

export type JournalBackfillResult = {
  accounts_created: number;
  trades_created: number;
  executions_created: number;
  notes_created: number;
  screenshots_created: number;
  tags_created: number;
  sources_unchanged: number;
  diagnostics: string[];
};

export type BrokerDiscoveredAccount = {
  id: number;
  connection_id: number;
  external_account_id: string;
  display_name: string;
  currency: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export function listJournalAccounts(includeArchived = false) {
  return apiRequest<JournalAccount[]>(`/journal/accounts?include_archived=${includeArchived ? "true" : "false"}`);
}

export async function createJournalAccount(payload: JournalAccountCreate) {
  const ownerId = getStoredAuthSession()?.user.id;
  return runJournalMutation("journal:account-create", async () => {
    const account = await apiRequest<JournalAccount>("/journal/accounts", { method: "POST", body: JSON.stringify(payload) });
    publishJournalUpdate(ownerId, { kind: "account", account });
    return account;
  });
}

export function listJournalTags() {
  return apiRequest<JournalTag[]>("/journal/tags");
}

export function createJournalTag(payload: { category: JournalTagCategory; name: string; color?: string | null }) {
  return apiRequest<JournalTag>("/journal/tags", { method: "POST", body: JSON.stringify(payload) });
}

export function listCanonicalTrades(options: { accountId?: number; reviewed?: boolean; tagIds?: number[]; offset?: number; limit?: number; startDate?: string; endDate?: string; order?: "entry" | "id"; beforeId?: number; signal?: AbortSignal } = {}) {
  const query = new URLSearchParams({ offset: String(options.offset ?? 0), limit: String(options.limit ?? 500) });
  if (options.accountId) query.set("account_id", String(options.accountId));
  if (options.startDate) query.set("start_date", options.startDate);
  if (options.endDate) query.set("end_date", options.endDate);
  if (options.reviewed != null) query.set("reviewed", String(options.reviewed));
  if (options.order) query.set("order", options.order);
  if (options.beforeId != null) query.set("before_id", String(options.beforeId));
  options.tagIds?.forEach((tagId) => query.append("tag_id", String(tagId)));
  return apiRequest<CanonicalTrade[]>(`/journal/trades?${query.toString()}`, { signal: options.signal });
}

/** Scan immutable IDs so changed entry times and deleted rows cannot shift later pages. */
export async function listAllCanonicalTrades(options: { signal?: AbortSignal } = {}) {
  const ownerId = getStoredAuthSession()?.user.id;
  const trades: CanonicalTrade[] = [];
  let beforeId: number | undefined;
  const checkActive = () => {
    if (options.signal?.aborted || getStoredAuthSession()?.user.id !== ownerId) throw new DOMException("Journal history load canceled", "AbortError");
  };
  for (;;) {
    checkActive();
    const page = await listCanonicalTrades({ order: "id", beforeId, limit: 500, signal: options.signal });
    checkActive();
    if (!Array.isArray(page) || page.length > 500) throw new Error("Journal history could not be verified. Refresh to retry.");
    let previousId = beforeId ?? Number.POSITIVE_INFINITY;
    for (const trade of page) {
      if (!Number.isSafeInteger(trade.id) || trade.id <= 0 || trade.id >= previousId) throw new Error("Journal history paging did not advance. Refresh to retry.");
      previousId = trade.id;
    }
    trades.push(...page);
    if (page.length < 500) break;
    beforeId = previousId;
  }
  return trades.sort((left, right) => Date.parse(right.entry_time) - Date.parse(left.entry_time) || right.id - left.id);
}

export function createCanonicalTrade(payload: CanonicalTradeCreate) {
  return apiRequest<CanonicalTrade>("/journal/trades", { method: "POST", body: JSON.stringify(payload) });
}

export function getCanonicalTrade(tradeId: number) {
  return apiRequest<CanonicalTrade>(`/journal/trades/${tradeId}`);
}

export async function updateCanonicalTradeReview(tradeId: number, payload: CanonicalTradeReviewUpdate) {
  const ownerId = getStoredAuthSession()?.user.id;
  return runJournalMutation(`journal:review:${tradeId}`, async () => {
    const trade = await apiRequest<CanonicalTrade>(`/journal/trades/${tradeId}/review`, { method: "PATCH", body: JSON.stringify(payload) });
    publishJournalUpdate(ownerId, { kind: "review", trade });
    return trade;
  });
}

export function listJournalDailyNotes(options: { startDate?: string; endDate?: string; accountId?: number } = {}) {
  const query = new URLSearchParams();
  if (options.startDate) query.set("start_date", options.startDate);
  if (options.endDate) query.set("end_date", options.endDate);
  if (options.accountId) query.set("account_id", String(options.accountId));
  return apiRequest<JournalDailyNote[]>(`/journal/daily-notes${query.size ? `?${query.toString()}` : ""}`);
}

export async function upsertJournalDailyNote(noteDate: string, payload: { account_id?: number | null; body: string }) {
  const ownerId = getStoredAuthSession()?.user.id;
  return runJournalMutation(`journal:daily-note:${noteDate}:${payload.account_id ?? "shared"}`, async () => {
    const note = await apiRequest<JournalDailyNote>(`/journal/daily-notes/${encodeURIComponent(noteDate)}`, { method: "PUT", body: JSON.stringify(payload) });
    publishJournalUpdate(ownerId, { kind: "daily-note", note });
    return note;
  });
}

export function importJournalCsv(payload: JournalImportCreate) {
  return apiRequest<{ run: JournalImportRun; trades: CanonicalTrade[] }>("/journal/imports", { method: "POST", body: JSON.stringify(payload) });
}

export function listJournalImports(accountId?: number) {
  const query = new URLSearchParams({ offset: "0", limit: "100" });
  if (accountId) query.set("account_id", String(accountId));
  return apiRequest<JournalImportRun[]>(`/journal/imports?${query.toString()}`);
}

export function rollbackJournalImport(runId: number) {
  return apiRequest<JournalImportRun>(`/journal/imports/${runId}/rollback`, { method: "POST" });
}

export function backfillLegacyJournal() {
  return apiRequest<JournalBackfillResult>("/journal/backfill", { method: "POST" });
}

export function listBrokerDiscoveredAccounts(connectionId: number) {
  return apiRequest<BrokerDiscoveredAccount[]>(`/broker-connections/${connectionId}/accounts`);
}

export function syncBrokerConnectionToJournal(connectionId: number) {
  return apiRequest<{ trades_created: number; executions_created: number }>(`/journal/broker-connections/${connectionId}/sync`, { method: "POST" });
}
