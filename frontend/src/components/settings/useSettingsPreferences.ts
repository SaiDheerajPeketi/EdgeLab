import { useEffect, useRef, useSyncExternalStore } from "react";
import { getAppStorageItem, patchSettingsPreferences } from "../../lib/api";
import { getStoredAuthSession, subscribeAuthSession } from "../../lib/authSession";
import { appDataSessionKey } from "../../lib/appDataBarrier";
import { rebaseQueuedPreferences } from "../../lib/chartSettingsDraft";
import { useJournalDraft } from "../../lib/journalDrafts";
import { confirmAppStorageOperations } from "../../lib/serverStorage";
import { DEFAULT_SETTINGS_PREFERENCES, applySettingsPreferences, cacheSettingsPreferences, sanitizeSettingsPreferences, settingsPreferencesStorageKey, type SettingsPreferences } from "../../lib/settingsPreferences";
import type { SaveState } from "./SettingsPrimitives";

type Field = keyof SettingsPreferences;
const fields: Field[] = ["appTheme", "density", "includeDiagnosticsByDefault"];
const key = "settings-center.v1";
type Snapshot = { ready: boolean; loading: boolean; error: boolean; defaults: SettingsPreferences; submitted: Partial<SettingsPreferences>; states: Partial<Record<Field, SaveState>>; attempts: Partial<SettingsPreferences>; revisions: Partial<Record<Field, number>>; undo: Partial<SettingsPreferences> | null; conflict: boolean; conflictRevision: number; editRevisions: Partial<Record<Field, number>>; replacementDraft?: SettingsPreferences };
const snapshots = new Map<string, Snapshot>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const ownerNow = () => String(getStoredAuthSession()?.user.id ?? "anonymous");
function snapshot(owner: string) {
  if (!snapshots.has(owner)) {
    let attempts: Partial<SettingsPreferences> = {};
    try {
      const stored = JSON.parse(sessionStorage.getItem(appDataSessionKey(`edgelab.preferences-save-errors.v1.user-${owner}`, `user-${owner}`)) ?? "null");
      if (stored?.version === 1) attempts = Object.fromEntries(fields.filter((field) => valid(field, stored.attempts?.[field])).map((field) => [field, stored.attempts[field]]));
    } catch { /* Private drafts remain recoverable independently. */ }
    snapshots.set(owner, { ready: false, loading: false, error: false, defaults: DEFAULT_SETTINGS_PREFERENCES, submitted: {}, states: Object.fromEntries(Object.keys(attempts).map((field) => [field, "error"])), attempts, revisions: {}, undo: null, conflict: false, conflictRevision: 0, editRevisions: {} });
  }
  return snapshots.get(owner)!;
}
function valid(field: Field, value: unknown) { return field === "appTheme" ? value === "dark" || value === "light" || value === "system" : field === "density" ? value === "comfortable" || value === "compact" : typeof value === "boolean"; }
function validate(value: unknown, changes?: Partial<SettingsPreferences>) {
  if (value != null && (typeof value !== "object" || Array.isArray(value))) throw new Error("Preferences need recovery.");
  const raw = value as Partial<SettingsPreferences> | null;
  if (raw && fields.some((field) => Object.prototype.hasOwnProperty.call(raw, field) && !valid(field, raw[field]))) throw new Error("Preferences need recovery.");
  if (changes && Object.entries(changes).some(([field, expected]) => raw?.[field as Field] !== expected)) throw new Error("The preference was not confirmed.");
  return sanitizeSettingsPreferences(value);
}
function publish(owner: string, update: Partial<Snapshot>) { snapshots.set(owner, { ...snapshot(owner), ...update }); listeners.forEach((listener) => listener()); }
function remember(owner: string) {
  const current = snapshot(owner);
  try { sessionStorage.setItem(appDataSessionKey(`edgelab.preferences-save-errors.v1.user-${owner}`, `user-${owner}`), JSON.stringify({ version: 1, attempts: Object.fromEntries(fields.filter((field) => current.states[field] === "error").map((field) => [field, current.attempts[field]])) })); } catch { /* In-memory recovery remains available. */ }
}
async function load(owner: string) {
  const starting = snapshot(owner);
  if (starting.loading || owner !== ownerNow()) return false;
  publish(owner, { loading: true, error: false });
  try {
    const [item] = await confirmAppStorageOperations([{ key, rebaseQueued: rebaseQueuedPreferences }], async () => { const result = await getAppStorageItem("edgelab", key); validate(result.value); return [result]; }, { readOnly: true });
    if (owner === ownerNow()) {
      const latest = snapshot(owner), loaded = validate(item.value);
      const defaults = Object.fromEntries(fields.map((field) => [field, starting.revisions[field] !== latest.revisions[field] ? latest.defaults[field] : loaded[field]])) as SettingsPreferences;
      publish(owner, { ready: true, defaults });
      return true;
    }
  } catch { if (owner === ownerNow()) publish(owner, { error: true }); }
  finally { publish(owner, { loading: false }); }
  return false;
}

/** Theme and density preview immediately; saved defaults and mirrors follow acknowledgment. */
export function useSettingsPreferences() {
  const session = useSyncExternalStore(subscribeAuthSession, getStoredAuthSession, () => null);
  const owner = String(session?.user.id ?? "anonymous");
  const current = useSyncExternalStore(subscribe, () => snapshot(owner));
  const [draft, setDraft, clearDraft] = useJournalDraft("settings:preferences", { ...current.defaults, ...current.submitted, ...current.replacementDraft });
  const draftValue = useRef(draft);
  draftValue.current = draft;
  const dirty = fields.some((field) => draft[field] !== current.defaults[field]);
  const pending = fields.some((field) => current.states[field] === "saving") || Boolean(current.replacementDraft);
  useEffect(() => { void load(owner); }, [owner]);
  useEffect(() => { applySettingsPreferences(draft); }, [owner, draft.appTheme, draft.density]);
  useEffect(() => {
    const handle = (event: StorageEvent) => {
      if (event.key !== settingsPreferencesStorageKey() || event.newValue == null) return;
      try { const remote = validate(JSON.parse(event.newValue)); if (fields.some((field) => remote[field] !== draft[field])) publish(owner, { conflict: true, conflictRevision: snapshot(owner).conflictRevision + 1 }); } catch { /* Malformed local messages cannot replace server values. */ }
    };
    window.addEventListener("storage", handle); return () => window.removeEventListener("storage", handle);
  }, [owner, draft.appTheme, draft.density, draft.includeDiagnosticsByDefault]);
  async function saveField(field: Field, retry = false, force = false) {
    const latest = snapshot(owner), value = draftValue.current[field];
    if (owner !== ownerNow() || !latest.ready || latest.loading || latest.replacementDraft || fields.some((key) => latest.states[key] === "saving") || (!force && value === latest.defaults[field]) || !valid(field, value)) return;
    if (!retry && latest.states[field] === "error" && latest.attempts[field] === value) return;
    const submitted = { ...draftValue.current }, changes = { [field]: value };
    publish(owner, { submitted: { ...latest.submitted, ...changes }, states: { ...latest.states, [field]: "saving" }, revisions: { ...latest.revisions, [field]: (latest.revisions[field] ?? 0) + 1 }, attempts: { ...latest.attempts, ...changes } });
    remember(owner);
    try {
      const [item] = await confirmAppStorageOperations([{ key, rebaseQueued: rebaseQueuedPreferences }], async () => { const result = await patchSettingsPreferences(changes); validate(result.value, changes); return [result]; });
      if (owner !== ownerNow()) { publish(owner, { ready: false }); return; }
      try { cacheSettingsPreferences(validate(item.value)); } catch { /* Confirmed server settings remain durable if the local mirror is full. */ }
      clearDraft([field], submitted);
      publish(owner, { defaults: validate(item.value), states: { ...snapshot(owner).states, [field]: "saved" }, conflict: snapshot(owner).conflictRevision !== latest.conflictRevision && snapshot(owner).conflict });
      window.dispatchEvent(new CustomEvent("edgelab:settings-preferences", { detail: validate(item.value) }));
    } catch { publish(owner, owner === ownerNow() ? { states: { ...snapshot(owner).states, [field]: "error" } } : { ready: false }); }
    finally {
      const latest = snapshot(owner), remaining = { ...latest.submitted }; delete remaining[field];
      publish(owner, { submitted: remaining, states: owner === ownerNow() ? latest.states : { ...latest.states, [field]: "idle" } });
      remember(owner);
    }
  }
  useEffect(() => {
    if (!current.ready || current.loading || pending) return;
    const field = fields.find((field) => draft[field] !== current.defaults[field] && !(current.states[field] === "error" && current.attempts[field] === draft[field]));
    if (!field) return;
    const timer = window.setTimeout(() => void saveField(field), 0);
    return () => window.clearTimeout(timer);
  }, [owner, current, draft.appTheme, draft.density, draft.includeDiagnosticsByDefault]);
  function change(update: Partial<SettingsPreferences>, undoable = true) {
    if (!current.ready || owner !== ownerNow()) return;
    const latest = snapshot(owner);
    publish(owner, { ...(undoable ? { undo: Object.fromEntries(Object.keys(update).map((field) => [field, draftValue.current[field as Field]])) } : {}), editRevisions: { ...latest.editRevisions, ...Object.fromEntries(Object.keys(update).map(field => [field, (latest.editRevisions[field as Field] ?? 0) + 1])) } });
    setDraft((value) => { const next = { ...value, ...update }; draftValue.current = next; return next; });
  }
  function stateFor(field: Field): SaveState {
    if (current.states[field] === "saving") return "saving";
    if (current.states[field] === "error" && current.attempts[field] === draft[field] && draft[field] !== current.defaults[field]) return "error";
    return draft[field] !== current.defaults[field] ? "idle" : current.states[field] === "saved" ? "saved" : "idle";
  }
  useEffect(() => {
    if (!dirty && !pending) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, pending]);
  async function useNewer() {
    const starting = snapshot(owner);
    if (owner !== ownerNow() || starting.loading || starting.replacementDraft || fields.some(field => starting.states[field] === "saving")) return;
    const submitted = { ...draftValue.current };
    // Pin the submitted draft so returning to the old baseline remains a later edit.
    publish(owner, { replacementDraft: submitted });
    try {
      if (!await load(owner) || owner !== ownerNow()) return;
      const latest = snapshot(owner);
      clearDraft(fields.filter(field => starting.editRevisions[field] === latest.editRevisions[field]), submitted);
      publish(owner, { conflict: latest.conflictRevision !== starting.conflictRevision && latest.conflict });
    } finally { publish(owner, { replacementDraft: undefined, ...(owner !== ownerNow() ? { ready: false } : {}) }); }
  }
  return { ...current, draft, dirty, pending, change, stateFor, retry: (field: Field) => saveField(field, true), reload: () => load(owner),
    reset: (field: Field) => change({ [field]: DEFAULT_SETTINGS_PREFERENCES[field] }),
    undoChange: () => { if (current.undo) { change(current.undo, false); publish(owner, { undo: null }); } },
    useNewer,
    keepVersion: async () => { for (const field of fields) await saveField(field, true, true); },
  };
}
