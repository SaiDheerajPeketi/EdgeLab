import { useEffect, useRef, useSyncExternalStore } from "react";
import { getAppStorageItem, putAppStorageItem } from "../../lib/api";
import { getStoredAuthSession, subscribeAuthSession } from "../../lib/authSession";
import { BACKTEST_DEFAULTS, BACKTEST_FIELDS, BACKTEST_KEYS, backtestSaveDelay, backtestValidation, backtestValue, type BacktestDefaults, type BacktestField } from "../../lib/backtestSettingsModel";
import { useJournalDraft } from "../../lib/journalDrafts";
import { confirmAppStorageOperation } from "../../lib/serverStorage";
import type { SaveState } from "./SettingsPrimitives";

type Snapshot = { ready: boolean; loading: boolean; error: boolean; defaults: BacktestDefaults; submitted: Partial<BacktestDefaults>; states: Partial<Record<BacktestField, SaveState>>; revisions: Partial<Record<BacktestField, number>>; attempts: Partial<BacktestDefaults>; undo: Partial<BacktestDefaults> | null };
const snapshots = new Map<string, Snapshot>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const ownerNow = () => String(getStoredAuthSession()?.user.id ?? "anonymous");
function snapshot(owner: string) {
  if (!snapshots.has(owner)) {
    const attempts = savedFailures(owner);
    const states = Object.fromEntries(Object.keys(attempts).map((field) => [field, "error"])) as Snapshot["states"];
    snapshots.set(owner, { ready: false, loading: false, error: false, defaults: BACKTEST_DEFAULTS, submitted: {}, states, revisions: {}, attempts, undo: null });
  }
  return snapshots.get(owner)!;
}
function publish(owner: string, update: Partial<Snapshot>) { snapshots.set(owner, { ...snapshot(owner), ...update }); listeners.forEach((listener) => listener()); }
function savedFailures(owner: string): Partial<BacktestDefaults> {
  try {
    const value = JSON.parse(sessionStorage.getItem(`edgelab.backtest-save-errors.v1.user-${owner}`) ?? "null");
    if (!value || value.version !== 1 || !value.attempts || typeof value.attempts !== "object") return {};
    return Object.fromEntries(BACKTEST_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(value.attempts, field) && !backtestValidation(field, value.attempts[field]) && (typeof value.attempts[field] !== "string" || value.attempts[field].length <= 100)).map((field) => [field, value.attempts[field]]));
  } catch { return {}; }
}
function rememberFailures(owner: string) {
  const current = snapshot(owner);
  const attempts = Object.fromEntries(BACKTEST_FIELDS.filter((field) => current.states[field] === "error").map((field) => [field, current.attempts[field]]));
  try { sessionStorage.setItem(`edgelab.backtest-save-errors.v1.user-${owner}`, JSON.stringify({ version: 1, attempts })); } catch { /* In-memory recovery remains available. */ }
}
async function load(owner: string) {
  if (snapshot(owner).loading) return;
  const startingRevisions = snapshot(owner).revisions;
  // Keep an acknowledged snapshot editable during renderer replacement. GETs
  // may wait behind held writes; per-field revisions protect the refresh merge.
  publish(owner, { loading: true, error: false });
  try {
    const entries = await Promise.all(BACKTEST_FIELDS.map(async (field) => {
      const item = await confirmAppStorageOperation(BACKTEST_KEYS[field], () => getAppStorageItem("edgelab", BACKTEST_KEYS[field]));
      return [field, backtestValue(field, item.value)] as const;
    }));
    if (owner === ownerNow()) {
      const latest = snapshot(owner);
      const defaults = Object.fromEntries(entries.map(([field, value]) => [field, latest.revisions[field] !== startingRevisions[field] ? latest.defaults[field] : value])) as BacktestDefaults;
      publish(owner, { ready: true, defaults });
    }
  } catch { if (owner === ownerNow()) publish(owner, { ready: false, error: true }); }
  finally { publish(owner, { loading: false }); }
}

/** Per-key acknowledgments keep failed and later edits private across renderers. */
export function useBacktestSettings() {
  const session = useSyncExternalStore(subscribeAuthSession, getStoredAuthSession, () => null);
  const owner = String(session?.user.id ?? "anonymous");
  const current = useSyncExternalStore(subscribe, () => snapshot(owner));
  const pending = BACKTEST_FIELDS.some((field) => current.states[field] === "saving");
  const base = { ...current.defaults, ...current.submitted };
  const [draft, setDraft, clearDraft] = useJournalDraft("settings:backtest-defaults", base);
  const dirty = BACKTEST_FIELDS.some((field) => draft[field] !== current.defaults[field]);
  const draftSignature = JSON.stringify(draft);
  const timers = useRef(new Map<BacktestField, { value: unknown; timer: number }>());
  useEffect(() => { void load(owner); }, [owner]);
  async function saveField(field: BacktestField, retry = false) {
    const latest = snapshot(owner);
    const value = draft[field];
    if (owner !== ownerNow() || !latest.ready || latest.states[field] === "saving" || value === latest.defaults[field] || backtestValidation(field, value)) return;
    if (!retry && latest.states[field] === "error" && latest.attempts[field] === value) return;
    const submitted = { ...draft };
    publish(owner, { submitted: { ...latest.submitted, [field]: value }, states: { ...latest.states, [field]: "saving" }, revisions: { ...latest.revisions, [field]: (latest.revisions[field] ?? 0) + 1 }, attempts: { ...latest.attempts, [field]: value } });
    rememberFailures(owner);
    try {
      const item = await confirmAppStorageOperation(BACKTEST_KEYS[field], async () => {
        const acknowledgment = await putAppStorageItem("edgelab", BACKTEST_KEYS[field], value);
        if (acknowledgment.value !== value) throw new Error("The server did not confirm this preference.");
        return acknowledgment;
      });
      if (owner !== ownerNow()) { publish(owner, { ready: false }); return; }
      clearDraft([field], submitted);
      publish(owner, { defaults: { ...snapshot(owner).defaults, [field]: backtestValue(field, item.value) }, states: { ...snapshot(owner).states, [field]: "saved" } });
    } catch { if (owner === ownerNow()) publish(owner, { states: { ...snapshot(owner).states, [field]: "error" } }); else publish(owner, { ready: false }); }
    finally {
      const latest = snapshot(owner);
      const remaining = { ...latest.submitted }; delete remaining[field];
      publish(owner, { submitted: remaining, states: owner === ownerNow() ? latest.states : { ...latest.states, [field]: "idle" } });
      rememberFailures(owner);
    }
  }
  useEffect(() => {
    BACKTEST_FIELDS.forEach((field) => {
      const eligible = current.ready && draft[field] !== current.defaults[field] && !backtestValidation(field, draft[field]) && current.states[field] !== "saving" && !(current.states[field] === "error" && current.attempts[field] === draft[field]);
      const existing = timers.current.get(field);
      if (existing && (!eligible || existing.value !== draft[field])) { window.clearTimeout(existing.timer); timers.current.delete(field); }
      if (eligible && !timers.current.has(field)) {
        const timer = window.setTimeout(() => { timers.current.delete(field); void saveField(field); }, backtestSaveDelay(field));
        timers.current.set(field, { value: draft[field], timer });
      }
    });
  }, [owner, current, draftSignature]);
  useEffect(() => () => { timers.current.forEach(({ timer }) => window.clearTimeout(timer)); timers.current.clear(); }, [owner]);
  useEffect(() => {
    if (!dirty && !pending) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, pending]);
  function change(update: Partial<BacktestDefaults>, undoable = false) {
    if (!current.ready || owner !== ownerNow()) return;
    if (undoable) publish(owner, { undo: Object.fromEntries(Object.keys(update).map((field) => [field, draft[field as BacktestField]])) });
    setDraft((value) => ({ ...value, ...update }));
  }
  function stateFor(fields: BacktestField[]): SaveState {
    if (fields.some((field) => current.states[field] === "saving")) return "saving";
    if (fields.some((field) => current.states[field] === "error" && current.attempts[field] === draft[field] && draft[field] !== current.defaults[field])) return "error";
    if (fields.some((field) => draft[field] !== current.defaults[field])) return "idle";
    return fields.some((field) => current.states[field] === "saved") ? "saved" : "idle";
  }
  return { ...current, draft, dirty, pending, change, stateFor,
    retry: (fields: BacktestField[]) => Promise.all(fields.filter((field) => current.states[field] === "error" && current.attempts[field] === draft[field]).map((field) => saveField(field, true))),
    reload: () => load(owner), reset: () => change(BACKTEST_DEFAULTS, true),
    undoChange: () => { if (current.undo) { change(current.undo); publish(owner, { undo: null }); } },
  };
}
