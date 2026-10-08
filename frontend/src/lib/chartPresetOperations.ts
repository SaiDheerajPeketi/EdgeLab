import { getAppStorageItem, updateChartPreset, type AppStorageItem } from "./api";
import { assertAppDataAccess, captureAppDataAccess } from "./appDataBarrier";
import { confirmAppStorageOperation } from "./serverStorage";

export type ChartPresetKind = "drawing" | "fib";
export type PresetRecord = { id: string; name: string; updatedAt: string };
export type ChartPresetIntent<T extends PresetRecord> = { action: "save"; preset: T; name: string } | { action: "delete"; id: string; name: string };
export const CHART_PRESET_KEYS = { drawing: "drawing-presets.v1", fib: "fib-presets.v1" };
const LIMITS = { drawing: 36, fib: 24 };
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const operations = new Map<string, Promise<unknown>>();

// Capture identity before waiting; each consumer must see the preceding publication.
function queued<T>(kind: ChartPresetKind, mutation: boolean, execute: () => Promise<T>): Promise<T> {
  const access = captureAppDataAccess();
  const key = JSON.stringify([access?.owner, access?.token, access?.epoch, kind]);
  const result = (operations.get(key) ?? Promise.resolve()).catch(() => undefined).then(() => {
    assertAppDataAccess(access, mutation);
    return execute();
  });
  operations.set(key, result);
  void result.finally(() => { if (operations.get(key) === result) operations.delete(key); }).catch(() => undefined);
  return result;
}

function hasOwn(value: object, key: PropertyKey) { return Object.prototype.hasOwnProperty.call(value, key); }

function equalJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, i) => equalJson(value, right[i]));
  if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) || Array.isArray(right)) return false;
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => hasOwn(b, key) && equalJson(a[key], b[key]));
}

/** Validate the original response; a lossy display sanitizer cannot confirm a save. */
export function validatedChartPresets<T extends PresetRecord>(kind: ChartPresetKind, raw: unknown, sanitize: (value: unknown) => T[]): T[] {
  if (!Array.isArray(raw) || raw.length > LIMITS[kind]) throw new Error("The saved preset list was not confirmed.");
  const clean = JSON.parse(JSON.stringify(sanitize(raw))) as T[];
  const ids = new Set<string>(), names = new Set<string>();
  if (clean.length !== raw.length) throw new Error("The saved preset list was not confirmed.");
  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("The saved preset list was not confirmed.");
    const value = entry as Record<string, unknown>, normalized = clean[index] as Record<string, unknown>;
    if (typeof value.id !== "string" || !value.id.trim() || value.id.length > 128 || ids.has(value.id) || typeof value.name !== "string" || !value.name.trim() || value.name.length > 48 || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt)) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value.updatedAt) || Object.keys(value).some((key) => (kind !== "fib" || key !== "levels") && (!hasOwn(normalized, key) || !equalJson(value[key], normalized[key])))) throw new Error("The saved preset list was not confirmed.");
    const name = `${kind === "drawing" ? value.tool + ":" : ""}${value.name.trim().toLowerCase().replace(/\s+/g, " ")}`;
    if (names.has(name)) throw new Error("The saved preset list was not confirmed.");
    ids.add(value.id); names.add(name);
    for (const field of ["color", "rewardColor", "riskColor"]) {
      if (value[field] != null && (typeof value[field] !== "string" || !HEX.test(value[field] as string))) throw new Error("The saved preset colors were not confirmed.");
    }
    if (kind === "fib") {
      const levels = value.levels;
      const normalizedLevels = normalized.levels as Array<Record<string, unknown>>;
      const levelIds = new Set<string>();
      if (!Array.isArray(levels) || !levels.length || levels.length > 64) throw new Error("The saved Fibonacci levels were not confirmed.");
      for (const level of levels) {
        if (!level || typeof level !== "object" || Array.isArray(level) || typeof level.id !== "string" || !level.id.trim() || level.id.length > 48 || levelIds.has(level.id) || typeof level.color !== "string" || !HEX.test(level.color)) throw new Error("The saved Fibonacci levels were not confirmed.");
        const match = normalizedLevels.find((item) => item.id === level.id);
        if (!match || Object.keys(level).some((key) => !hasOwn(match, key) || !equalJson(level[key], match[key]))) throw new Error("The saved Fibonacci levels were not confirmed.");
        levelIds.add(level.id);
      }
    }
  });
  return sanitize(raw);
}

function envelope(kind: ChartPresetKind, item: AppStorageItem | null | undefined, allowEmpty: boolean) {
  if (!item || !hasOwn(item, "value") || item.namespace !== "edgelab" || item.key !== CHART_PRESET_KEYS[kind] || (item.value == null && !allowEmpty) || (item.value != null && (!Array.isArray(item.value) || typeof item.updated_at !== "string" || !Number.isFinite(Date.parse(item.updated_at))))) throw new Error("The preset response was not confirmed.");
  return item;
}

export async function readChartPresets<T extends PresetRecord>(kind: ChartPresetKind, sanitize: (value: unknown) => T[]) {
  return queued(kind, false, async () => {
    let values: T[] = [];
    await confirmAppStorageOperation(CHART_PRESET_KEYS[kind], async () => {
      const item = envelope(kind, await getAppStorageItem("edgelab", CHART_PRESET_KEYS[kind]), true);
      values = validatedChartPresets(kind, item.value ?? [], sanitize);
      return { ...item, value: item.value ?? [] };
    }, "edgelab", undefined, { readOnly: true });
    return values;
  });
}

export async function confirmChartPreset<T extends PresetRecord>(kind: ChartPresetKind, intent: ChartPresetIntent<T>, sanitize: (value: unknown) => T[]) {
  const action = intent.action;
  const submitted = action === "save" ? JSON.parse(JSON.stringify(intent.preset)) as T : undefined;
  if (submitted) validatedChartPresets(kind, [submitted], sanitize);
  const id = action === "delete" ? intent.id : undefined;
  return queued(kind, true, async () => {
    let values: T[] = [];
    await confirmAppStorageOperation(CHART_PRESET_KEYS[kind], async () => {
      const item = envelope(kind, await updateChartPreset(action === "save" ? { kind, action: "save", preset: submitted } : { kind, action: "delete", id }), false);
      const raw = (item.value ?? []) as PresetRecord[];
      values = validatedChartPresets(kind, raw, sanitize);
      if (action === "save" ? raw[0]?.id !== submitted!.id || !equalJson(raw[0], submitted) : raw.some((preset) => preset.id === id)) throw new Error("The requested preset change was not confirmed.");
      return { ...item, value: raw };
    });
    return values;
  });
}
