import { updateChartSettingsTemplate, type ChartSettingsResponse } from "./api";
import { loadActiveChartSettingsPresetName, normalizeChartSettingsPresetName, sanitizeChartVisualSettings, type ChartVisualSettings } from "./chartSettings";
import { CHART_ACTIVE_KEY, CHART_PRESETS_KEY, rawChartPresets, rebaseQueuedChartPresets } from "./chartSettingsDraft";
import { confirmAppStorageOperations } from "./serverStorage";

export type ChartTemplateAction = "save" | "delete" | "activate";

/** Publish the template list and its selection together, after the server commits both. */
export async function confirmChartSettingsTemplate(action: ChartTemplateAction, name: string, settings?: ChartVisualSettings) {
  const normalized = normalizeChartSettingsPresetName(name);
  const submitted = action === "save" ? sanitizeChartVisualSettings(settings) : undefined;
  const activeBefore = loadActiveChartSettingsPresetName();
  let response: ChartSettingsResponse;
  await confirmAppStorageOperations([
    { key: CHART_ACTIVE_KEY },
    { key: CHART_PRESETS_KEY, rebaseQueued: (pending, confirmed, before) => rebaseQueuedChartPresets(pending, confirmed, before, activeBefore) },
  ], async () => {
    response = await updateChartSettingsTemplate({ action, name: normalized, ...(submitted ? { settings: submitted } : {}) });
    if (response?.presets?.key !== CHART_PRESETS_KEY || response?.active?.key !== CHART_ACTIVE_KEY || response.presets.namespace !== "edgelab" || response.active.namespace !== "edgelab") throw new Error("The template was not confirmed.");
    const presets = rawChartPresets(response.presets.value);
    const target = presets.find((preset) => normalizeChartSettingsPresetName(preset.name) === normalized);
    const active = response.active.value;
    if ((active != null && typeof active !== "string") ||
        (action === "delete" ? Boolean(target) : !target || active !== normalized) ||
        (submitted && (!target || Object.entries(submitted).some(([key, value]) => JSON.stringify(target.settings[key]) !== JSON.stringify(value))))) throw new Error("The template was not confirmed.");
    return [response.active, response.presets];
  });
  const presets = rawChartPresets(response!.presets.value).map((preset) => ({
    name: normalizeChartSettingsPresetName(preset.name), settings: sanitizeChartVisualSettings(preset.settings), updatedAt: typeof preset.updatedAt === "string" ? preset.updatedAt : "",
  }));
  const active = typeof response!.active.value === "string" ? normalizeChartSettingsPresetName(response!.active.value) : null;
  return { presets, activeName: presets.find((preset) => preset.name === active)?.name ?? presets[0]?.name ?? null };
}
