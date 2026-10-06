import { useRef, useState, useSyncExternalStore, type SetStateAction } from "react";
import { getStoredAuthSession, subscribeAuthSession } from "./authSession";
import type { CanonicalTrade, CanonicalTradeReviewUpdate, JournalSetupGrade } from "./journalApi";
import { navigationStateFor, reloadNavigationStateForAuth, updateNavigationState, type NavigationSurfaceId } from "./navigationState";

export function emptyJournalAccountDraft() {
  return { name: "", provider: "Manual", currency: "USD", timezone: "UTC", initialBalance: "0", color: "#67e8f9", notes: "" };
}

export function journalReviewDraft(trade: CanonicalTrade | null) {
  return {
    reviewed: trade?.reviewed ?? false,
    rating: trade?.rating ?? null as number | null,
    setupGrade: trade?.setup_grade ?? null as JournalSetupGrade | null,
    tagIds: trade?.tags.map((tag) => tag.id) ?? [],
    entryTime: localDateTime(trade?.entry_time),
    exitTime: localDateTime(trade?.exit_time),
    entryPrice: trade ? String(trade.entry_price) : "",
    exitPrice: trade?.exit_price == null ? "" : String(trade.exit_price),
    stopLoss: trade?.stop_loss == null ? "" : String(trade.stop_loss),
    takeProfit: trade?.take_profit == null ? "" : String(trade.take_profit),
    strategy: trade?.strategy_name ?? "",
    emotion: trade?.emotional_state ?? "",
    note: "",
    screenshotUrls: trade?.screenshots.map((screenshot) => screenshot.url).join("\n") ?? "",
  };
}

export type JournalAccountDraft = ReturnType<typeof emptyJournalAccountDraft>;
export type JournalReviewDraft = ReturnType<typeof journalReviewDraft>;
type Draft = JournalAccountDraft | JournalReviewDraft;
type DraftEdits<T> = Partial<T>;
type DraftEnvelope = { __schemaVersion: number; value: unknown };
const VERSION = 1;
const REVIEW_DEFAULT = journalReviewDraft(null);
const draftListeners = new Set<() => void>();
let draftRevision = 0;
const subscribeDraftChanges = (listener: () => void) => { draftListeners.add(listener); return () => { draftListeners.delete(listener); }; };
const currentDraftRevision = () => draftRevision;

/** Restore edits only: untouched fields always follow the latest canonical response. */
export function restoreJournalDraft<T extends Draft>(stored: unknown, base: T): DraftEdits<T> {
  if (!stored || typeof stored !== "object") return {};
  const envelope = stored as Partial<DraftEnvelope>;
  if (envelope.__schemaVersion !== VERSION || !envelope.value || typeof envelope.value !== "object" || Array.isArray(envelope.value)) return {};
  const edits = envelope.value as Record<string, unknown>;
  if (!Object.entries(edits).every(([key, value]) => Object.prototype.hasOwnProperty.call(base, key) && validField(key, value, base))) return {};
  return edits as DraftEdits<T>;
}

export function journalDraftEdits<T extends Draft>(base: T, next: T): DraftEdits<T> {
  return Object.fromEntries(Object.keys(base).filter((key) => !same(base[key as keyof T], next[key as keyof T])).map((key) => [key, next[key as keyof T]])) as DraftEdits<T>;
}

export function acknowledgeJournalDraft<T extends Draft>(edits: DraftEdits<T>, submitted: T, fields = Object.keys(submitted) as Array<keyof T>) {
  const remaining = { ...edits };
  fields.forEach((field) => { if (same(remaining[field], submitted[field])) delete remaining[field]; });
  return remaining;
}

/** Send only explicit changes, retaining untouched execution precision and append-only notes. */
export function journalReviewPayload(base: JournalReviewDraft, draft: JournalReviewDraft): CanonicalTradeReviewUpdate {
  const payload: CanonicalTradeReviewUpdate = {};
  const fields: Array<[keyof JournalReviewDraft, keyof CanonicalTradeReviewUpdate, unknown]> = [
    ["reviewed", "reviewed", draft.reviewed], ["rating", "rating", draft.rating], ["setupGrade", "setup_grade", draft.setupGrade],
    ["tagIds", "tag_ids", draft.tagIds], ["entryPrice", "entry_price", Number(draft.entryPrice)],
    ["exitPrice", "exit_price", draft.exitPrice ? Number(draft.exitPrice) : null],
    ["stopLoss", "stop_loss", draft.stopLoss ? Number(draft.stopLoss) : null],
    ["takeProfit", "take_profit", draft.takeProfit ? Number(draft.takeProfit) : null],
    ["strategy", "strategy_name", draft.strategy.trim() || null], ["emotion", "emotional_state", draft.emotion.trim() || null],
    ["screenshotUrls", "screenshot_urls", draft.screenshotUrls.split(/\n+/).map((value) => value.trim()).filter(Boolean)],
  ];
  fields.forEach(([field, target, value]) => { if (!same(base[field], draft[field])) Object.assign(payload, { [target]: value }); });
  if (base.entryTime !== draft.entryTime) payload.entry_time = new Date(draft.entryTime).toISOString();
  if (base.exitTime !== draft.exitTime) payload.exit_time = draft.exitTime ? new Date(draft.exitTime).toISOString() : null;
  if (draft.note.trim()) payload.note = draft.note.trim();
  return payload;
}

/** Shared by both interfaces; private drafts stay in this tab and authenticated owner's namespace. */
export function useJournalDraft<T extends Draft>(surface: NavigationSurfaceId, base: T) {
  const session = useSyncExternalStore(subscribeAuthSession, getStoredAuthSession, () => null);
  const owner = session?.user.id ? `user-${session.user.id}` : session?.user.email?.toLowerCase() ?? "anonymous";
  const scope = `${owner}:${surface}`;
  const revision = useSyncExternalStore(subscribeDraftChanges, currentDraftRevision, () => 0);
  const [state, setState] = useState(() => ({ scope, revision, edits: readEdits(surface, base) }));
  const edits = state.scope === scope && state.revision === revision ? state.edits : readEdits(surface, base);
  if (state.scope !== scope || state.revision !== revision) setState({ scope, revision, edits });
  const current = useRef({ scope, base, edits });
  current.current = { scope, base, edits };

  function persist(nextEdits: DraftEdits<T>) {
    // An old request completion must never clear or write another user's draft.
    if (owner !== draftOwner()) return;
    reloadNavigationStateForAuth();
    updateNavigationState(surface, { draft: { __schemaVersion: VERSION, value: nextEdits } });
    draftRevision += 1;
    if (current.current.scope === scope) {
      current.current.edits = nextEdits;
      setState({ scope, revision: draftRevision, edits: nextEdits });
    }
    draftListeners.forEach((listener) => listener());
  }

  function setDraft(update: SetStateAction<T>) {
    if (current.current.scope !== scope) return;
    const value = { ...current.current.base, ...current.current.edits };
    const next = typeof update === "function" ? update(value) : update;
    persist(journalDraftEdits(current.current.base, next));
  }

  function clearDraft(fields?: Array<keyof T>, submitted?: T) {
    if (owner !== draftOwner()) return;
    const next = { ...readEdits(surface, base) };
    if (submitted) { persist(acknowledgeJournalDraft(next, submitted, fields)); return; }
    if (fields) fields.forEach((field) => { delete next[field]; });
    persist(fields ? next : {});
  }

  return [{ ...base, ...edits }, setDraft, clearDraft, Object.keys(journalDraftEdits(base, { ...base, ...edits })).length > 0] as const;
}

function readEdits<T extends Draft>(surface: NavigationSurfaceId, base: T) {
  reloadNavigationStateForAuth();
  return restoreJournalDraft(navigationStateFor(surface)?.draft, base);
}

function draftOwner() {
  const user = getStoredAuthSession()?.user;
  return user?.id ? `user-${user.id}` : user?.email?.toLowerCase() ?? "anonymous";
}

function validField(key: string, value: unknown, base: Draft) {
  if (key === "rating") return value === null || (Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5);
  if (key === "setupGrade") return value === null || (typeof value === "string" && ["A+", "A", "B", "C", "D", "F"].includes(value));
  if (key === "tagIds") return Array.isArray(value) && value.length <= 500 && value.every((id) => Number.isSafeInteger(id) && id > 0);
  const expected = (base as Record<string, unknown>)[key] ?? (REVIEW_DEFAULT as Record<string, unknown>)[key];
  return typeof value === typeof expected && (typeof value !== "string" || value.length <= 100_000);
}

function same(left: unknown, right: unknown) { return JSON.stringify(left) === JSON.stringify(right); }
function localDateTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
