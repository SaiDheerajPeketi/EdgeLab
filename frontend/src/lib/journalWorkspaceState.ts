import { getStoredAuthSession } from "./authSession";
import { loadAppStorageItem, saveAppStorageItemConfirmed } from "./serverStorage";
import { appDataSessionKey, assertAppDataAccess, captureAppDataAccess, type AppDataAccess } from "./appDataBarrier";

export type JournalAccountScope = {
  mode: "all" | "selected";
  accountIds: number[];
};

export type JournalPanelId = "journal" | "watchlist" | "quant" | "data-window" | "objects" | "code" | "order-book" | "alerts";
export type JournalPanelPreferences = {
  activePanel: JournalPanelId;
  collapsed: boolean;
  dock: "left" | "right";
  mode: "compact" | "expanded";
  width: number;
};

export type JournalDeepLink = {
  surface: "dashboard" | "trades" | "calendar" | "notes" | "accounts" | "analytics";
  tradeId: number | null;
  date: string | null;
  accountId: number | null;
  segment: string | null;
  returnTo: string | null;
};

const SCOPE_KEY = "journal-account-scope.v1";
const PANEL_KEY = "journal-panel-layout.v1";
const SAMPLE_RUN_KEY = "journal-sample-run.v1";

export const DEFAULT_JOURNAL_SCOPE: JournalAccountScope = { mode: "all", accountIds: [] };
export const DEFAULT_JOURNAL_PANEL: JournalPanelPreferences = {
  activePanel: "journal",
  collapsed: false,
  dock: "right",
  mode: "compact",
  width: 360,
};

export function sanitizeJournalScope(value: unknown, validAccountIds?: Iterable<number>): JournalAccountScope {
  const candidate = value && typeof value === "object" ? value as Partial<JournalAccountScope> : {};
  const valid = validAccountIds ? new Set(validAccountIds) : null;
  const ids = Array.isArray(candidate.accountIds)
    ? [...new Set(candidate.accountIds.filter((id): id is number => Number.isInteger(id) && id > 0 && (!valid || valid.has(id))))]
    : [];
  return candidate.mode === "selected" && ids.length ? { mode: "selected", accountIds: ids } : DEFAULT_JOURNAL_SCOPE;
}

export function sanitizeJournalPanelPreferences(value: unknown): JournalPanelPreferences {
  const candidate = value && typeof value === "object" ? value as Partial<JournalPanelPreferences> : {};
  const panels: JournalPanelId[] = ["journal", "watchlist", "quant", "data-window", "objects", "code", "order-book", "alerts"];
  return {
    activePanel: panels.includes(candidate.activePanel as JournalPanelId) ? candidate.activePanel as JournalPanelId : "journal",
    collapsed: candidate.collapsed === true,
    dock: candidate.dock === "left" ? "left" : "right",
    mode: candidate.mode === "expanded" ? "expanded" : "compact",
    width: Math.min(720, Math.max(280, Number(candidate.width) || 360)),
  };
}

export function loadJournalScope() {
  return sanitizeJournalScope(readLocal(SCOPE_KEY));
}

export async function hydrateJournalScope(validAccountIds: Iterable<number>) {
  const access = captureAppDataAccess();
  assertAppDataAccess(access);
  const owner = ownerSegment();
  const local = sanitizeJournalScope(readLocal(SCOPE_KEY), validAccountIds);
  const remote = sanitizeJournalScope(await loadAppStorageItem(SCOPE_KEY, local), validAccountIds);
  if (ownerSegment() !== owner) throw new DOMException("Journal owner changed", "AbortError");
  writeLocal(SCOPE_KEY, remote, access);
  return remote;
}

export async function saveJournalScope(scope: JournalAccountScope) {
  const access = captureAppDataAccess();
  assertAppDataAccess(access, true);
  const value = sanitizeJournalScope(scope);
  writeLocal(SCOPE_KEY, value, access);
  await saveAppStorageItemConfirmed(SCOPE_KEY, value);
  return value;
}

export function loadJournalPanelPreferences() {
  return sanitizeJournalPanelPreferences(readLocal(PANEL_KEY));
}

export async function hydrateJournalPanelPreferences() {
  const access = captureAppDataAccess();
  assertAppDataAccess(access);
  const local = loadJournalPanelPreferences();
  const remote = sanitizeJournalPanelPreferences(await loadAppStorageItem(PANEL_KEY, local));
  writeLocal(PANEL_KEY, remote, access);
  return remote;
}

export async function saveJournalPanelPreferences(preferences: JournalPanelPreferences) {
  const access = captureAppDataAccess();
  assertAppDataAccess(access, true);
  const value = sanitizeJournalPanelPreferences(preferences);
  writeLocal(PANEL_KEY, value, access);
  await saveAppStorageItemConfirmed(PANEL_KEY, value);
  return value;
}

export function loadJournalSampleRunId() {
  const value = Number(readLocal(SAMPLE_RUN_KEY));
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function saveJournalSampleRunId(runId: number | null) {
  const access = captureAppDataAccess();
  assertAppDataAccess(access, true);
  writeLocal(SAMPLE_RUN_KEY, runId, access);
  void saveAppStorageItemConfirmed(SAMPLE_RUN_KEY, runId).catch(() => undefined);
}

export function journalDeepLink(link: JournalDeepLink) {
  const query = new URLSearchParams();
  if (link.tradeId) query.set("trade", String(link.tradeId));
  if (link.date) query.set("date", link.date);
  if (link.accountId) query.set("account", String(link.accountId));
  if (link.segment) query.set("segment", link.segment);
  if (link.returnTo) query.set("return", link.returnTo);
  const suffix = query.toString();
  return `#journal/${link.surface}${suffix ? `?${suffix}` : ""}`;
}

export function parseJournalDeepLink(hash: string): JournalDeepLink | null {
  const match = hash.match(/^#journal\/(dashboard|trades|calendar|notes|accounts|analytics)(?:\?(.+))?$/);
  if (!match) return null;
  const query = new URLSearchParams(match[2] ?? "");
  return {
    surface: match[1] as JournalDeepLink["surface"],
    tradeId: positiveInteger(query.get("trade")),
    date: isoDate(query.get("date")),
    accountId: positiveInteger(query.get("account")),
    segment: safeText(query.get("segment")),
    returnTo: safeText(query.get("return")),
  };
}

function positiveInteger(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isoDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function safeText(value: string | null) {
  if (!value) return null;
  const clean = value.trim().slice(0, 160);
  return clean || null;
}

function ownerSegment() {
  const user = getStoredAuthSession()?.user;
  return user?.id ? `user-${user.id}` : user?.email ? `user-${encodeURIComponent(user.email.toLowerCase())}` : "anonymous";
}

function localKey(key: string) {
  const owner = ownerSegment();
  return appDataSessionKey(`edgelab.${key}.${owner}`, owner);
}

function readLocal(key: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    assertAppDataAccess(captureAppDataAccess());
    const raw = window.localStorage.getItem(localKey(key));
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: unknown, access: AppDataAccess | null = captureAppDataAccess()) {
  if (typeof window === "undefined") return;
  assertAppDataAccess(access);
  try {
    window.localStorage.setItem(access ? appDataSessionKey(`edgelab.${key}.${access.owner}`, access.owner) : localKey(key), JSON.stringify(value));
  } catch {
    // Confirmed server persistence remains the durable path when local storage is full.
  }
}
