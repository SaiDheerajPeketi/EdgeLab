import { DEFAULT_CHART_VISUAL_SETTINGS, sanitizeChartVisualSettings } from "./chartSettings";

export type ChartSettingsDraft = {
  timeHoursFormat: "12-hour" | "24-hour"; dateFormat: "dd MMM yy" | "MMM dd yyyy" | "yyyy-MM-dd";
  textSize: string; gridMode: "both" | "horizontal" | "vertical" | "none";
  backgroundColor: string; textColor: string; gridColor: string; candleUpColor: string; candleDownColor: string;
};
export type ChartDraftField = keyof ChartSettingsDraft;
export const CHART_DRAFT_FIELDS: ChartDraftField[] = ["timeHoursFormat", "dateFormat", "textSize", "gridMode", "backgroundColor", "textColor", "gridColor", "candleUpColor", "candleDownColor"];
export const CHART_PRESETS_KEY = "chart-settings-presets.v1";
export const CHART_ACTIVE_KEY = "active-chart-settings-preset.v1";
export const SETTINGS_PRESET_NAME = "Settings default";
export function chartDraftFrom(value: unknown): ChartSettingsDraft {
  const settings = sanitizeChartVisualSettings(value && typeof value === "object" ? value : DEFAULT_CHART_VISUAL_SETTINGS);
  return Object.fromEntries(CHART_DRAFT_FIELDS.map((field) => [field, field === "textSize" ? String(settings[field]) : settings[field]])) as ChartSettingsDraft;
}
export const DEFAULT_CHART_DRAFT = chartDraftFrom(DEFAULT_CHART_VISUAL_SETTINGS);
export function chartDraftValidation(draft: ChartSettingsDraft) {
  if (!draft.textSize.trim() || !Number.isInteger(Number(draft.textSize)) || Number(draft.textSize) < 10 || Number(draft.textSize) > 18) return "Enter a whole-number text size from 10 to 18.";
  if (!CHART_DRAFT_FIELDS.filter((field) => field.endsWith("Color")).every((field) => /^#[\da-f]{6}$/i.test(draft[field]))) return "Choose six-digit chart colors.";
  return null;
}
export function rawChartPresets(value: unknown): Array<Record<string, unknown> & { name: string; settings: Record<string, unknown> }> {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((entry) => !entry || typeof entry !== "object" || typeof entry.name !== "string" || !entry.name.trim() || !entry.settings || typeof entry.settings !== "object" || Array.isArray(entry.settings))) throw new Error("Chart presets need recovery.");
  const names = value.map((entry) => normalizedName(entry.name));
  if (new Set(names).size !== names.length) throw new Error("Duplicate chart preset names need recovery.");
  return value;
}
export function activeRawChartSettings(presets: unknown, active: unknown) {
  const values = rawChartPresets(presets);
  if (active != null && typeof active !== "string") throw new Error("The active chart preset needs recovery.");
  return (values.find((entry) => normalizedName(entry.name) === normalizedName(String(active ?? ""))) ?? values[0])?.settings;
}
const normalizedName = (name: string) => name.trim().replace(/\s+/g, " ");
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Later legacy snapshots keep their explicit changes and membership edits;
 * unchanged fields adopt acknowledged values, including unknown metadata. */
export function rebaseQueuedChartPresets(pending: unknown, confirmed: unknown, before: unknown, activeBefore?: unknown) {
  if (!Array.isArray(pending) || !Array.isArray(confirmed)) return pending;
  const previous = rawChartPresets(before);
  const queued = rawChartPresets(pending);
  const acknowledged = rawChartPresets(confirmed);
  const previousNames = new Set(previous.map((entry) => normalizedName(entry.name)));
  const queuedNames = new Set(queued.map((entry) => normalizedName(entry.name)));
  const result = queued.map((entry) => {
    const name = normalizedName(entry.name);
    const old = previous.find((item) => normalizedName(item.name) === name);
    const saved = acknowledged.find((item) => normalizedName(item.name) === name);
    if (!saved) return entry;
    // A newly named preset may be a toolbar snapshot of the prior active chart.
    const settingsBefore = old?.settings ?? { ...sanitizeChartVisualSettings(activeRawChartSettings(before, activeBefore)), ...activeRawChartSettings(before, activeBefore) };
    return { ...(rebaseQueuedPreferences(entry, saved, old) as Record<string, unknown>), name: entry.name, settings: rebaseQueuedPreferences(entry.settings, saved.settings, settingsBefore) } as typeof entry;
  });
  acknowledged.forEach((entry) => { const name = normalizedName(entry.name); if (!queuedNames.has(name) && !previousNames.has(name)) result.push(entry); });
  return result;
}
export function rebaseQueuedPreferences(pending: unknown, confirmed: unknown, before: unknown) {
  if (!pending || typeof pending !== "object" || Array.isArray(pending) || !confirmed || typeof confirmed !== "object" || Array.isArray(confirmed)) return pending;
  const earlier = before && typeof before === "object" ? before as Record<string, unknown> : {};
  const later = pending as Record<string, unknown>;
  return { ...confirmed, ...Object.fromEntries(Object.entries(later).filter(([key, value]) => !same(value, earlier[key]))) };
}
