export type ChartGridMode = "both" | "horizontal" | "none" | "vertical";
export type ChartScalePlacement = "auto" | "left" | "right";
export type ChartVisibilityMode = "hidden" | "value" | "valueLine";

export type ChartVisualSettings = {
  backgroundColor: string;
  barChangeValues: boolean;
  bodyVisible: boolean;
  borderVisible: boolean;
  candleDownColor: string;
  candleUpColor: string;
  chartValues: boolean;
  colorBarsByPreviousClose: boolean;
  countdownToBarClose: boolean;
  crosshairColor: string;
  crosshairVisible: boolean;
  dateFormat: "dd MMM yy" | "MMM dd yyyy" | "yyyy-MM-dd";
  dayOfWeekLabels: boolean;
  gridColor: string;
  gridMode: ChartGridMode;
  highLowLabels: ChartVisibilityMode;
  indicatorTitles: boolean;
  indicatorValues: boolean;
  noOverlappingLabels: boolean;
  plusButton: boolean;
  previousDayClose: ChartVisibilityMode;
  pricePrecision: number;
  priceScaleBorderVisible: boolean;
  scalePlacement: ChartScalePlacement;
  sessionBreaks: boolean;
  symbolLine: ChartVisibilityMode;
  textColor: string;
  textSize: number;
  timeHoursFormat: "12-hour" | "24-hour";
  title: boolean;
  volume: boolean;
  watermark: "hidden" | "symbol" | "text";
  watermarkText: string;
  wickVisible: boolean;
};

export type ChartSettingsPreset = {
  name: string;
  settings: ChartVisualSettings;
  updatedAt: string;
};

export const DEFAULT_CHART_VISUAL_SETTINGS: ChartVisualSettings = {
  backgroundColor: "#0D1117",
  barChangeValues: true,
  bodyVisible: true,
  borderVisible: false,
  candleDownColor: "#FB7185",
  candleUpColor: "#22C55E",
  chartValues: true,
  colorBarsByPreviousClose: false,
  countdownToBarClose: false,
  crosshairColor: "#94A3B8",
  crosshairVisible: true,
  dateFormat: "dd MMM yy",
  dayOfWeekLabels: true,
  gridColor: "#334155",
  gridMode: "both",
  highLowLabels: "hidden",
  indicatorTitles: true,
  indicatorValues: true,
  noOverlappingLabels: true,
  plusButton: true,
  previousDayClose: "hidden",
  pricePrecision: 5,
  priceScaleBorderVisible: true,
  scalePlacement: "right",
  sessionBreaks: false,
  symbolLine: "valueLine",
  textColor: "#A8B3C7",
  textSize: 12,
  timeHoursFormat: "24-hour",
  title: true,
  volume: true,
  watermark: "hidden",
  watermarkText: "EdgeLab",
  wickVisible: true,
};

export const CHART_SETTINGS_PRESETS_KEY = "edgelab.chart-settings-presets.v1";

export function sanitizeChartVisualSettings(
  settings?: Partial<ChartVisualSettings> | null,
): ChartVisualSettings {
  const candidate = settings ?? {};
  return {
    ...DEFAULT_CHART_VISUAL_SETTINGS,
    ...candidate,
    backgroundColor: sanitizeHex(candidate.backgroundColor, DEFAULT_CHART_VISUAL_SETTINGS.backgroundColor),
    candleDownColor: sanitizeHex(candidate.candleDownColor, DEFAULT_CHART_VISUAL_SETTINGS.candleDownColor),
    candleUpColor: sanitizeHex(candidate.candleUpColor, DEFAULT_CHART_VISUAL_SETTINGS.candleUpColor),
    crosshairColor: sanitizeHex(candidate.crosshairColor, DEFAULT_CHART_VISUAL_SETTINGS.crosshairColor),
    gridColor: sanitizeHex(candidate.gridColor, DEFAULT_CHART_VISUAL_SETTINGS.gridColor),
    pricePrecision: clampInteger(candidate.pricePrecision, 0, 8, DEFAULT_CHART_VISUAL_SETTINGS.pricePrecision),
    textColor: sanitizeHex(candidate.textColor, DEFAULT_CHART_VISUAL_SETTINGS.textColor),
    textSize: clampInteger(candidate.textSize, 10, 18, DEFAULT_CHART_VISUAL_SETTINGS.textSize),
  };
}

export function loadChartSettingsPresets(): ChartSettingsPreset[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(CHART_SETTINGS_PRESETS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => {
        if (!item || typeof item !== "object" || typeof item.name !== "string") {
          return null;
        }
        return {
          name: normalizeChartSettingsPresetName(item.name),
          settings: sanitizeChartVisualSettings(item.settings),
          updatedAt:
            typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString(),
        };
      })
      .filter((item): item is ChartSettingsPreset => item != null);
  } catch {
    return [];
  }
}

export function saveChartSettingsPreset(
  name: string,
  settings: ChartVisualSettings,
): ChartSettingsPreset[] {
  const presetName = normalizeChartSettingsPresetName(name);
  const nextPreset: ChartSettingsPreset = {
    name: presetName,
    settings: sanitizeChartVisualSettings(settings),
    updatedAt: new Date().toISOString(),
  };
  const nextPresets = [
    nextPreset,
    ...loadChartSettingsPresets().filter((preset) => preset.name !== presetName),
  ].slice(0, 24);
  persistChartSettingsPresets(nextPresets);
  return nextPresets;
}

export function deleteChartSettingsPreset(name: string): ChartSettingsPreset[] {
  const presetName = normalizeChartSettingsPresetName(name);
  const nextPresets = loadChartSettingsPresets().filter(
    (preset) => preset.name !== presetName,
  );
  persistChartSettingsPresets(nextPresets);
  return nextPresets;
}

export function normalizeChartSettingsPresetName(name: string) {
  const normalized = name.trim().replace(/\s+/g, " ");
  return normalized || "Default";
}

function persistChartSettingsPresets(presets: ChartSettingsPreset[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(CHART_SETTINGS_PRESETS_KEY, JSON.stringify(presets));
}

function sanitizeHex(value: string | undefined, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }
  const raw = value.trim();
  const withoutHash = raw.startsWith("#") ? raw.slice(1) : raw;
  if (/^[\da-f]{3}$/i.test(withoutHash)) {
    return `#${withoutHash
      .split("")
      .map((char) => char + char)
      .join("")
      .toUpperCase()}`;
  }
  if (/^[\da-f]{6}$/i.test(withoutHash)) {
    return `#${withoutHash.toUpperCase()}`;
  }
  return fallback;
}

function clampInteger(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}
