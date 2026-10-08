import { useEffect, useSyncExternalStore } from "react";
import { getChartSettings, patchChartSettings, type ChartSettingsResponse } from "../../lib/api";
import { getStoredAuthSession, subscribeAuthSession } from "../../lib/authSession";
import { CHART_ACTIVE_KEY, CHART_PRESETS_KEY, CHART_DRAFT_FIELDS, DEFAULT_CHART_DRAFT, SETTINGS_PRESET_NAME, activeRawChartSettings, chartDraftFrom, chartDraftValidation, rawChartPresets, rebaseQueuedChartPresets, type ChartSettingsDraft } from "../../lib/chartSettingsDraft";
import { useJournalDraft } from "../../lib/journalDrafts";
import { confirmAppStorageOperations } from "../../lib/serverStorage";
import type { SaveState } from "./SettingsPrimitives";

type Snapshot = { ready: boolean; loading: boolean; error: boolean; defaults: ChartSettingsDraft; submitted: Partial<ChartSettingsDraft>; failedDraft: ChartSettingsDraft | null; state: SaveState; revision: number; active: unknown; undo: ChartSettingsDraft | null };
const snapshots = new Map<string, Snapshot>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const ownerNow = () => String(getStoredAuthSession()?.user.id ?? "anonymous");
const normalizedName = (value: unknown) => typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
function editableSettings(presets: unknown, active: unknown) {
  return rawChartPresets(presets).find((entry) => normalizedName(entry.name) === SETTINGS_PRESET_NAME)?.settings ?? activeRawChartSettings(presets, active);
}
function snapshot(owner: string) {
  if (!snapshots.has(owner)) snapshots.set(owner, { ready: false, loading: false, error: false, defaults: DEFAULT_CHART_DRAFT, submitted: {}, failedDraft: null, state: "idle", revision: 0, active: null, undo: null });
  return snapshots.get(owner)!;
}
function publish(owner: string, update: Partial<Snapshot>) { snapshots.set(owner, { ...snapshot(owner), ...update }); listeners.forEach((listener) => listener()); }
function validate(response: ChartSettingsResponse, changes?: Record<string, unknown>) {
  if (!response?.presets || !response.active || response.presets.key !== CHART_PRESETS_KEY || response.active.key !== CHART_ACTIVE_KEY || response.presets.namespace !== "edgelab" || response.active.namespace !== "edgelab") throw new Error("Chart settings were not confirmed.");
  const presets = rawChartPresets(response.presets.value);
  activeRawChartSettings(presets, response.active.value);
  if (changes) {
    const target = presets.find((entry) => normalizedName(entry.name) === SETTINGS_PRESET_NAME);
    if (response.active.value !== SETTINGS_PRESET_NAME || !target || Object.entries(changes).some(([field, value]) => target.settings[field] !== value) || (changes.candleUpColor !== undefined && target.settings.bodyUpColor !== changes.candleUpColor) || (changes.candleDownColor !== undefined && target.settings.bodyDownColor !== changes.candleDownColor)) throw new Error("The chart preset was not confirmed.");
  }
  return [response.active, response.presets];
}
async function operation(owner: string, request: () => Promise<ChartSettingsResponse>, changes?: Record<string, unknown>) {
  const activeBefore = snapshot(owner).active;
  return confirmAppStorageOperations([{ key: CHART_ACTIVE_KEY }, { key: CHART_PRESETS_KEY, rebaseQueued: (pending, confirmed, before) => rebaseQueuedChartPresets(pending, confirmed, before, activeBefore) }], async () => validate(await request(), changes), { readOnly: changes === undefined });
}
async function load(owner: string) {
  const starting = snapshot(owner);
  if (starting.loading) return;
  publish(owner, { loading: true, error: false });
  try {
    const [active, presets] = await operation(owner, getChartSettings);
    if (owner === ownerNow() && snapshot(owner).revision === starting.revision) publish(owner, { ready: true, defaults: chartDraftFrom(editableSettings(presets.value, active.value)), active: active.value });
  } catch { if (owner === ownerNow()) publish(owner, { error: true }); }
  finally { publish(owner, { loading: false }); }
}

/** Both renderers and both categories share private drafts and acknowledged saves. */
export function useChartSettings() {
  const session = useSyncExternalStore(subscribeAuthSession, getStoredAuthSession, () => null);
  const owner = String(session?.user.id ?? "anonymous");
  const current = useSyncExternalStore(subscribe, () => snapshot(owner));
  const [draft, setDraft, clearDraft] = useJournalDraft("settings:chart-defaults", { ...current.defaults, ...current.submitted });
  const pending = current.state === "saving";
  const dirty = CHART_DRAFT_FIELDS.some((field) => draft[field] !== current.defaults[field]);
  const needsActivation = current.ready && normalizedName(current.active) !== SETTINGS_PRESET_NAME;
  const validation = chartDraftValidation(draft);
  const failedDraft = current.failedDraft;
  const matchingFailure = current.state === "error" && (dirty || needsActivation) && failedDraft !== null &&
    CHART_DRAFT_FIELDS.every(field => draft[field] === failedDraft[field]);
  useEffect(() => { void load(owner); }, [owner]);
  async function save() {
    const latest = snapshot(owner);
    if (owner !== ownerNow() || !latest.ready || latest.state === "saving" || chartDraftValidation(draft) || (!dirty && !needsActivation)) return;
    const submitted = { ...draft };
    const fields = CHART_DRAFT_FIELDS.filter((field) => draft[field] !== latest.defaults[field]);
    const changes = Object.fromEntries(fields.map((field) => [field, field === "textSize" ? Number(draft[field]) : draft[field]]));
    publish(owner, { submitted: Object.fromEntries(fields.map((field) => [field, draft[field]])), failedDraft: null, state: "saving", revision: latest.revision + 1 });
    try {
      const [active, presets] = await operation(owner, () => patchChartSettings(changes), changes);
      if (owner !== ownerNow()) { publish(owner, { ready: false }); return; }
      clearDraft(fields, submitted);
      publish(owner, { defaults: chartDraftFrom(activeRawChartSettings(presets.value, active.value)), active: active.value, state: "saved" });
    } catch { publish(owner, owner === ownerNow() ? { failedDraft: submitted, state: "error" } : { ready: false, state: "idle" }); }
    finally { publish(owner, { submitted: {}, state: owner === ownerNow() ? snapshot(owner).state : "idle" }); }
  }
  function change(update: Partial<ChartSettingsDraft>, undoable = false) {
    if (!current.ready || owner !== ownerNow()) return;
    if (undoable) publish(owner, { undo: draft });
    setDraft((value) => ({ ...value, ...update }));
  }
  useEffect(() => {
    if (!dirty && !pending) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, pending]);
  return { ...current, draft, dirty, needsActivation, pending, validation, change, save, reload: () => load(owner),
    saveState: pending ? "saving" as const : matchingFailure ? "error" as const : dirty || current.state === "error" ? "idle" as const : current.state,
    reset: () => change(DEFAULT_CHART_DRAFT, true), undoChange: () => { if (current.undo) { change(current.undo); publish(owner, { undo: null }); } },
  };
}
