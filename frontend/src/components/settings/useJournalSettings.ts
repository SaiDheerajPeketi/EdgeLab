import { useEffect, useSyncExternalStore } from "react";
import { apiRequest, getAppStorageItem, putAppStorageItem, type AppStorageItem } from "../../lib/api";
import { getStoredAuthSession, subscribeAuthSession } from "../../lib/authSession";
import { journalDraftEdits, useJournalDraft } from "../../lib/journalDrafts";
import { runJournalMutation, useJournalMutationPending } from "../../lib/journalMutationState";
import { confirmAppStorageOperation } from "../../lib/serverStorage";

export type SettingsJournalDefaults = { default_broker: string; default_currency: string; default_entry_type: "MISSED" | "TAKEN"; require_account_for_taken_trades: boolean };
export const DEFAULT_JOURNAL_SETTINGS: SettingsJournalDefaults = { default_broker: "Manual", default_currency: "USD", default_entry_type: "TAKEN", require_account_for_taken_trades: true };
export const RESET_JOURNAL_SETTINGS: SettingsJournalDefaults = { default_broker: "", default_currency: "USD", default_entry_type: "TAKEN", require_account_for_taken_trades: false };
export const DEFAULT_NOTE_TEMPLATE = ["Setup", "- Context:", "- Trigger:", "", "Execution", "- Side: {side}", "- Quantity: {quantity}", "- Entry: {entry}", "- Exit: {exit}", "- Result: {pnl} ({r}R)", "", "Review", "- What worked:", "- What needs correction:", "- Next action:"].join("\n");
type SaveState = "idle" | "saving" | "saved" | "error";
type Snapshot = { ready: boolean; loading: boolean; error: boolean; defaults: SettingsJournalDefaults; template: string; journalState: SaveState; noteState: SaveState; journalSubmitted?: SettingsJournalDefaults; noteSubmitted?: string };
const snapshots = new Map<string, Snapshot>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const ownerNow = () => String(getStoredAuthSession()?.user.id ?? "anonymous");
function snapshot(owner: string): Snapshot {
  if (!snapshots.has(owner)) snapshots.set(owner, { ready: false, loading: false, error: false, defaults: DEFAULT_JOURNAL_SETTINGS, template: DEFAULT_NOTE_TEMPLATE, journalState: "idle", noteState: "idle" });
  return snapshots.get(owner)!;
}
function publish(owner: string, update: Partial<Snapshot>) {
  snapshots.set(owner, { ...snapshot(owner), ...update });
  listeners.forEach((listener) => listener());
}
export function journalSettingsFrom(value: unknown): SettingsJournalDefaults {
  const settings = value && typeof value === "object" && "settings" in value ? (value as { settings: unknown }).settings : null;
  const candidate = settings && typeof settings === "object" ? settings as Partial<SettingsJournalDefaults> : {};
  return {
    default_broker: typeof candidate.default_broker === "string" ? candidate.default_broker.trim() || "Manual" : "Manual",
    default_currency: typeof candidate.default_currency === "string" && /^[A-Za-z]{3}$/.test(candidate.default_currency) ? candidate.default_currency.toUpperCase() : "USD",
    default_entry_type: candidate.default_entry_type === "MISSED" ? "MISSED" : "TAKEN",
    require_account_for_taken_trades: typeof candidate.require_account_for_taken_trades === "boolean" ? candidate.require_account_for_taken_trades : true,
  };
}
async function load(owner: string) {
  if (snapshot(owner).loading) return;
  publish(owner, { loading: true, error: false });
  try {
    const [journal, note] = await Promise.all([
      confirmAppStorageOperation("live-journal.v1", () => getAppStorageItem("edgelab", "live-journal.v1"), "edgelab", undefined, { readOnly: true }),
      confirmAppStorageOperation("notebook-template.v1", () => getAppStorageItem<string>("edgelab", "notebook-template.v1"), "edgelab", undefined, { readOnly: true }),
    ]);
    if (owner !== ownerNow()) return;
    publish(owner, { ready: true, defaults: journalSettingsFrom(journal.value), template: typeof note.value === "string" && note.value.trim() ? note.value : DEFAULT_NOTE_TEMPLATE });
  } catch { if (owner === ownerNow()) publish(owner, { error: true }); }
  finally { publish(owner, { loading: false }); }
}

/** Confirmed values and private field edits survive route aliases and renderer replacement. */
export function useJournalSettings() {
  const session = useSyncExternalStore(subscribeAuthSession, getStoredAuthSession, () => null);
  const owner = String(session?.user.id ?? "anonymous");
  const current = useSyncExternalStore(subscribe, () => snapshot(owner));
  const journalPending = useJournalMutationPending("settings:journal-defaults");
  const notePending = useJournalMutationPending("settings:note-template");
  // During a save, edits are relative to the submitted value. Returning to the
  // old baseline is then an explicit later edit rather than an empty draft.
  const [journalDraft, setJournalDraft, clearJournal] = useJournalDraft("settings:journal-defaults", journalPending ? current.journalSubmitted ?? current.defaults : current.defaults);
  const [note, setNote, clearNote] = useJournalDraft("settings:note-template", { body: notePending ? current.noteSubmitted ?? current.template : current.template });
  // The pending base protects later edits; effective/unsaved feedback still
  // compares with server-confirmed values until the acknowledgment arrives.
  const journalDirty = Object.keys(journalDraftEdits(current.defaults, journalDraft)).length > 0;
  const noteDirty = note.body !== current.template;
  useEffect(() => { void load(owner); }, [owner]);
  async function saveJournal() {
    if (!current.ready || !journalDirty || !/^[A-Z]{3}$/.test(journalDraft.default_currency) || journalPending) return;
    const submitted = { ...journalDraft };
    const changes = journalDraftEdits(current.defaults, submitted);
    try {
      await runJournalMutation("settings:journal-defaults", async () => {
        publish(owner, { journalState: "saving", journalSubmitted: submitted });
        const item = await confirmAppStorageOperation("live-journal.v1", () => apiRequest<AppStorageItem>("/journal/settings", { method: "PATCH", body: JSON.stringify(changes) }), "edgelab", (pending, confirmed) => {
          if (!pending || typeof pending !== "object" || Array.isArray(pending)) return pending;
          const queued = pending as Record<string, unknown>;
          const existing = queued.settings && typeof queued.settings === "object" ? queued.settings : {};
          // Trades entered while defaults are saving keep their records and adopt
          // the acknowledged defaults before their queued full-journal write.
          return { ...queued, settings: { ...existing, ...journalSettingsFrom(confirmed) } };
        });
        if (owner !== ownerNow()) return;
        clearJournal(undefined, submitted);
        publish(owner, { defaults: journalSettingsFrom(item.value), journalState: "saved" });
      });
    } catch { if (owner === ownerNow()) publish(owner, { journalState: "error" }); }
    finally { if (owner !== ownerNow()) publish(owner, { ready: false, journalState: "idle" }); }
  }
  async function saveNote() {
    if (!current.ready || !noteDirty || !note.body.trim() || notePending) return;
    const submitted = { ...note };
    try {
      await runJournalMutation("settings:note-template", async () => {
        publish(owner, { noteState: "saving", noteSubmitted: submitted.body });
        const item = await confirmAppStorageOperation("notebook-template.v1", () => putAppStorageItem("edgelab", "notebook-template.v1", submitted.body));
        if (owner !== ownerNow()) return;
        clearNote(undefined, submitted);
        publish(owner, { template: item.value ?? submitted.body, noteState: "saved" });
      });
    } catch { if (owner === ownerNow()) publish(owner, { noteState: "error" }); }
    finally { if (owner !== ownerNow()) publish(owner, { ready: false, noteState: "idle" }); }
  }
  useEffect(() => {
    if (!journalDirty && !noteDirty && !journalPending && !notePending) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [journalDirty, noteDirty, journalPending, notePending]);
  return { ...current, journalDraft, setJournalDraft, journalDirty, noteDraft: note.body, setNoteDraft: (body: string) => setNote({ body }), noteDirty, journalPending, notePending, journalState: journalPending ? "saving" as const : current.journalState, noteState: notePending ? "saving" as const : current.noteState, saveJournal, saveNote, reload: () => load(owner) };
}
