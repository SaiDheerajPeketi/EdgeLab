export type ChartGridMode = "both" | "horizontal" | "none" | "vertical";
export type ChartLineStyle = "solid" | "dashed" | "dotted";
export type ChartScalePlacement = "auto" | "left" | "right";
export type ChartVisibilityMode = "hidden" | "value" | "valueLine";

export type ChartVisualSettings = {
  backgroundColor: string;
  barChangeValues: boolean;
  bodyDownColor: string;
  bodyUpColor: string;
  bodyVisible: boolean;
  borderDownColor: string;
  borderUpColor: string;
  borderVisible: boolean;
  candleDownColor: string;
  candleUpColor: string;
  chartValues: boolean;
  colorBarsByPreviousClose: boolean;
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
  previousDayClose: ChartVisibilityMode;
  pricePrecision: number;
  priceScaleBorderVisible: boolean;
  scalePlacement: ChartScalePlacement;
  sessionBreakColor: string;
  sessionBreakLineStyle: ChartLineStyle;
  sessionBreakLineWidth: number;
  sessionBreaks: boolean;
  symbolLine: ChartVisibilityMode;
  textColor: string;
  textSize: number;
  timeScaleBorderVisible: boolean;
  timeHoursFormat: "12-hour" | "24-hour";
  title: boolean;
  volume: boolean;
  watermark: "hidden" | "symbol" | "text";
  watermarkText: string;
  wickDownColor: string;
  wickUpColor: string;
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
  bodyDownColor: "#FB7185",
  bodyUpColor: "#22C55E",
  bodyVisible: true,
  borderDownColor: "#FB7185",
  borderUpColor: "#22C55E",
  borderVisible: false,
  candleDownColor: "#FB7185",
  candleUpColor: "#22C55E",
  chartValues: true,
  colorBarsByPreviousClose: false,
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
  previousDayClose: "hidden",
  pricePrecision: 5,
  priceScaleBorderVisible: true,
  scalePlacement: "right",
  sessionBreakColor: "#38BDF8",
  sessionBreakLineStyle: "dashed",
  sessionBreakLineWidth: 1,
  sessionBreaks: false,
  symbolLine: "valueLine",
  textColor: "#A8B3C7",
  textSize: 12,
  timeScaleBorderVisible: true,
  timeHoursFormat: "24-hour",
  title: true,
  volume: true,
  watermark: "hidden",
  watermarkText: "EdgeLab",
  wickDownColor: "#FB7185",
  wickUpColor: "#22C55E",
  wickVisible: true,
};

export const CHART_SETTINGS_PRESETS_KEY = "edgelab.chart-settings-presets.v1";

export function sanitizeChartVisualSettings(
  settings?: Partial<ChartVisualSettings> | null,
): ChartVisualSettings {
  const candidate = settings ?? {};
  const legacyDownColor = sanitizeHex(candidate.candleDownColor, DEFAULT_CHART_VISUAL_SETTINGS.candleDownColor);
  const legacyUpColor = sanitizeHex(candidate.candleUpColor, DEFAULT_CHART_VISUAL_SETTINGS.candleUpColor);
  const bodyDownColor = sanitizeHex(candidate.bodyDownColor, legacyDownColor);
  const bodyUpColor = sanitizeHex(candidate.bodyUpColor, legacyUpColor);
  const borderDownColor = sanitizeHex(candidate.borderDownColor, bodyDownColor);
  const borderUpColor = sanitizeHex(candidate.borderUpColor, bodyUpColor);
  const wickDownColor = sanitizeHex(candidate.wickDownColor, bodyDownColor);
  const wickUpColor = sanitizeHex(candidate.wickUpColor, bodyUpColor);

  return {
    ...DEFAULT_CHART_VISUAL_SETTINGS,
    ...candidate,
    backgroundColor: sanitizeHex(candidate.backgroundColor, DEFAULT_CHART_VISUAL_SETTINGS.backgroundColor),
    bodyDownColor,
    bodyUpColor,
    borderDownColor,
    borderUpColor,
    candleDownColor: bodyDownColor,
    candleUpColor: bodyUpColor,
    crosshairColor: sanitizeHex(candidate.crosshairColor, DEFAULT_CHART_VISUAL_SETTINGS.crosshairColor),
    gridColor: sanitizeHex(candidate.gridColor, DEFAULT_CHART_VISUAL_SETTINGS.gridColor),
    pricePrecision: clampInteger(candidate.pricePrecision, 0, 8, DEFAULT_CHART_VISUAL_SETTINGS.pricePrecision),
    sessionBreakColor: sanitizeHex(candidate.sessionBreakColor, DEFAULT_CHART_VISUAL_SETTINGS.sessionBreakColor),
    sessionBreakLineStyle: sanitizeLineStyle(candidate.sessionBreakLineStyle),
    sessionBreakLineWidth: clampInteger(
      candidate.sessionBreakLineWidth,
      1,
      8,
      DEFAULT_CHART_VISUAL_SETTINGS.sessionBreakLineWidth,
    ),
    textColor: sanitizeHex(candidate.textColor, DEFAULT_CHART_VISUAL_SETTINGS.textColor),
    textSize: clampInteger(candidate.textSize, 10, 18, DEFAULT_CHART_VISUAL_SETTINGS.textSize),
    timeScaleBorderVisible:
      typeof candidate.timeScaleBorderVisible === "boolean"
        ? candidate.timeScaleBorderVisible
        : typeof candidate.priceScaleBorderVisible === "boolean"
          ? candidate.priceScaleBorderVisible
          : DEFAULT_CHART_VISUAL_SETTINGS.timeScaleBorderVisible,
    wickDownColor,
    wickUpColor,
  };
}

function sanitizeLineStyle(value: unknown): ChartLineStyle {
  return value === "solid" || value === "dashed" || value === "dotted"
    ? value
    : DEFAULT_CHART_VISUAL_SETTINGS.sessionBreakLineStyle;
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
