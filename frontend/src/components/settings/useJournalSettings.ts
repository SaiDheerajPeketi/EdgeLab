import { useEffect, useSyncExternalStore } from "react";
import { apiRequest, getAppStorageItem, putAppStorageItem, type AppStorageItem } from "../../lib/api";
import { getStoredAuthSession, subscribeAuthSession } from "../../lib/authSession";
import { journalDraftEdits, useJournalDraft } from "../../lib/journalDrafts";
import { runJournalMutation, useJournalMutationPending } from "../../lib/journalMutationState";
import { confirmAppStorageOperation } from "../../lib/serverStorage";

import { DEFAULT_JOURNAL_SETTINGS, DEFAULT_NOTE_TEMPLATE, confirmedJournalSettings, confirmedNoteTemplate, journalSettingsFrom, type SettingsJournalDefaults } from "../../lib/journalSettingsModel";
export { DEFAULT_JOURNAL_SETTINGS, DEFAULT_NOTE_TEMPLATE, RESET_JOURNAL_SETTINGS, journalSettingsFrom } from "../../lib/journalSettingsModel";
export type { SettingsJournalDefaults } from "../../lib/journalSettingsModel";
type SaveState = "idle" | "saving" | "saved" | "error";
type Snapshot = { ready: boolean; loading: boolean; error: boolean; defaults: SettingsJournalDefaults; template: string; journalState: SaveState; noteState: SaveState; journalSubmitted?: SettingsJournalDefaults; noteSubmitted?: string; journalRevision: number; noteRevision: number };
const snapshots = new Map<string, Snapshot>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const ownerNow = () => String(getStoredAuthSession()?.user.id ?? "anonymous");
function snapshot(owner: string): Snapshot {
  if (!snapshots.has(owner)) snapshots.set(owner, { ready: false, loading: false, error: false, defaults: DEFAULT_JOURNAL_SETTINGS, template: DEFAULT_NOTE_TEMPLATE, journalState: "idle", noteState: "idle", journalRevision: 0, noteRevision: 0 });
  return snapshots.get(owner)!;
}
function publish(owner: string, update: Partial<Snapshot>) {
  snapshots.set(owner, { ...snapshot(owner), ...update });
  listeners.forEach((listener) => listener());
}
async function load(owner: string) {
  const starting = snapshot(owner);
  if (starting.loading || owner !== ownerNow()) return;
  publish(owner, { loading: true, error: false });
  try {
    const [journal, note] = await Promise.all([
      confirmAppStorageOperation("live-journal.v1", async () => { const item = await getAppStorageItem("edgelab", "live-journal.v1"); confirmedJournalSettings(item); return item; }, "edgelab", undefined, { readOnly: true }),
      confirmAppStorageOperation("notebook-template.v1", async () => { const item = await getAppStorageItem<string>("edgelab", "notebook-template.v1"); confirmedNoteTemplate(item); return item; }, "edgelab", undefined, { readOnly: true }),
    ]);
    if (owner !== ownerNow()) return;
    const latest = snapshot(owner);
    publish(owner, { ready: true, defaults: starting.journalRevision === latest.journalRevision ? confirmedJournalSettings(journal) : latest.defaults, template: starting.noteRevision === latest.noteRevision ? confirmedNoteTemplate(note) : latest.template });
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
    if (owner !== ownerNow() || !current.ready || !journalDirty || !/^[A-Z]{3}$/.test(journalDraft.default_currency) || journalPending) return;
    const submitted = { ...journalDraft };
    const changes = journalDraftEdits(current.defaults, submitted);
    try {
      await runJournalMutation("settings:journal-defaults", async () => {
        publish(owner, { journalState: "saving", journalSubmitted: submitted, journalRevision: snapshot(owner).journalRevision + 1 });
        const item = await confirmAppStorageOperation("live-journal.v1", async () => { const result = await apiRequest<AppStorageItem>("/journal/settings", { method: "PATCH", body: JSON.stringify(changes) }); confirmedJournalSettings(result, changes); return result; }, "edgelab", (pending, confirmed) => {
          if (!pending || typeof pending !== "object" || Array.isArray(pending)) return pending;
          const queued = pending as Record<string, unknown>;
          const existing = queued.settings && typeof queued.settings === "object" ? queued.settings : {};
          // Trades entered while defaults are saving keep their records and adopt
          // the acknowledged defaults before their queued full-journal write.
          return { ...queued, settings: { ...existing, ...journalSettingsFrom(confirmed) } };
        });
        if (owner !== ownerNow()) return;
        clearJournal(undefined, submitted);
        publish(owner, { defaults: confirmedJournalSettings(item, changes), journalState: "saved" });
      });
    } catch { if (owner === ownerNow()) publish(owner, { journalState: "error" }); }
    finally { if (owner !== ownerNow()) publish(owner, { ready: false, journalState: "idle" }); }
  }
  async function saveNote() {
    if (owner !== ownerNow() || !current.ready || !noteDirty || !note.body.trim() || notePending) return;
    const submitted = { ...note };
    try {
      await runJournalMutation("settings:note-template", async () => {
        publish(owner, { noteState: "saving", noteSubmitted: submitted.body, noteRevision: snapshot(owner).noteRevision + 1 });
        const item = await confirmAppStorageOperation("notebook-template.v1", async () => { const result = await putAppStorageItem("edgelab", "notebook-template.v1", submitted.body); confirmedNoteTemplate(result, submitted.body); return result; });
        if (owner !== ownerNow()) return;
        clearNote(undefined, submitted);
        publish(owner, { template: confirmedNoteTemplate(item, submitted.body), noteState: "saved" });
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
  const feedback = (state: SaveState, pending: boolean, dirty: boolean, sameAttempt: boolean): SaveState => pending ? "saving" : state === "saved" && !dirty ? "saved" : state === "error" && dirty && sameAttempt ? "error" : "idle";
  const journalAttempt = Boolean(current.journalSubmitted && !Object.keys(journalDraftEdits(current.journalSubmitted, journalDraft)).length);
  return { ...current, journalDraft, setJournalDraft, journalDirty, noteDraft: note.body, setNoteDraft: (body: string) => setNote({ body }), noteDirty, journalPending, notePending, journalState: feedback(current.journalState, journalPending, journalDirty, journalAttempt), noteState: feedback(current.noteState, notePending, noteDirty, current.noteSubmitted === note.body), saveJournal, saveNote, reload: () => load(owner) };
}
