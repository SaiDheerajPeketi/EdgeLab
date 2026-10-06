import { CHART_COLOR } from "./colorTokens";
import {
  DEFAULT_CHART_TIME_ZONE,
  sanitizeChartTimeZone,
  type ChartTimeZone,
} from "./chartTimezones";
import {
  sanitizeSessionTemplatePreference,
  sanitizeTradingHoursMode,
  type ChartSessionTemplatePreference,
  type ChartTradingHoursMode,
} from "./chartSessions";
import {
  sanitizeOrderFlowAlignment,
  sanitizeOrderFlowDisplayMode,
  sanitizeOrderFlowStatsMetric,
  sanitizeOrderFlowTemplateId,
  type OrderFlowAlignment,
  type OrderFlowDisplayMode,
  type OrderFlowStatsMetric,
  type OrderFlowTemplateId,
} from "./orderFlowPresentation";

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
  closedSessionShading: boolean;
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
  orderFlowTemplate: OrderFlowTemplateId;
  footprintAlignment: OrderFlowAlignment;
  footprintAskColor: string;
  footprintBidColor: string;
  footprintDisplayMode: OrderFlowDisplayMode;
  footprintImbalanceRatio: number;
  footprintNeutralColor: string;
  footprintShowAverageTradeSize: boolean;
  footprintShowImbalances: boolean;
  footprintShowStats: boolean;
  footprintShowUnfinishedAuctions: boolean;
  footprintStackedImbalanceCount: number;
  footprintStatsMetric: OrderFlowStatsMetric;
  previousDayClose: ChartVisibilityMode;
  postMarketShading: boolean;
  preMarketShading: boolean;
  pricePrecision: number;
  priceScaleBorderVisible: boolean;
  scalePlacement: ChartScalePlacement;
  sessionBreakColor: string;
  sessionBreakLineStyle: ChartLineStyle;
  sessionBreakLineWidth: number;
  sessionBreaks: boolean;
  sessionTemplate: ChartSessionTemplatePreference;
  symbolLine: ChartVisibilityMode;
  textColor: string;
  textSize: number;
  timeScaleBorderVisible: boolean;
  timeHoursFormat: "12-hour" | "24-hour";
  timeZone: ChartTimeZone;
  title: boolean;
  tpoBracketMinutes: number;
  tpoShowPointOfControl: boolean;
  tpoShowValueArea: boolean;
  tpoValueAreaPercent: number;
  tradingHoursMode: ChartTradingHoursMode;
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
  backgroundColor: CHART_COLOR.surface,
  barChangeValues: true,
  bodyDownColor: CHART_COLOR.down,
  bodyUpColor: CHART_COLOR.up,
  bodyVisible: true,
  borderDownColor: CHART_COLOR.down,
  borderUpColor: CHART_COLOR.up,
  borderVisible: true,
  candleDownColor: CHART_COLOR.down,
  candleUpColor: CHART_COLOR.up,
  chartValues: true,
  colorBarsByPreviousClose: false,
  closedSessionShading: true,
  crosshairColor: CHART_COLOR.muted,
  crosshairVisible: true,
  dateFormat: "dd MMM yy",
  dayOfWeekLabels: true,
  gridColor: CHART_COLOR.grid,
  gridMode: "both",
  highLowLabels: "hidden",
  indicatorTitles: true,
  indicatorValues: true,
  noOverlappingLabels: true,
  orderFlowTemplate: "classic",
  footprintAlignment: "center",
  footprintAskColor: CHART_COLOR.up,
  footprintBidColor: CHART_COLOR.down,
  footprintDisplayMode: "bid-ask",
  footprintImbalanceRatio: 3,
  footprintNeutralColor: CHART_COLOR.muted,
  footprintShowAverageTradeSize: false,
  footprintShowImbalances: true,
  footprintShowStats: true,
  footprintShowUnfinishedAuctions: true,
  footprintStackedImbalanceCount: 3,
  footprintStatsMetric: "delta",
  previousDayClose: "hidden",
  postMarketShading: true,
  preMarketShading: true,
  pricePrecision: 5,
  priceScaleBorderVisible: true,
  scalePlacement: "right",
  sessionBreakColor: CHART_COLOR.sky,
  sessionBreakLineStyle: "dashed",
  sessionBreakLineWidth: 1,
  sessionBreaks: false,
  sessionTemplate: "auto",
  symbolLine: "valueLine",
  textColor: CHART_COLOR.text,
  textSize: 12,
  timeScaleBorderVisible: true,
  timeHoursFormat: "24-hour",
  timeZone: DEFAULT_CHART_TIME_ZONE,
  title: true,
  tpoBracketMinutes: 30,
  tpoShowPointOfControl: true,
  tpoShowValueArea: true,
  tpoValueAreaPercent: 70,
  tradingHoursMode: "extended",
  volume: true,
  watermark: "hidden",
  watermarkText: "EdgeLab",
  wickDownColor: CHART_COLOR.down,
  wickUpColor: CHART_COLOR.up,
  wickVisible: true,
};

export const CHART_SETTINGS_PRESETS_KEY = "edgelab.chart-settings-presets.v1";
export const ACTIVE_CHART_SETTINGS_PRESET_KEY =
  "edgelab.active-chart-settings-preset.v1";
const CHART_SETTINGS_PRESETS_STORAGE_KEY = "chart-settings-presets.v1";
const ACTIVE_CHART_SETTINGS_PRESET_STORAGE_KEY = "active-chart-settings-preset.v1";

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
    closedSessionShading: sanitizeBoolean(
      candidate.closedSessionShading,
      DEFAULT_CHART_VISUAL_SETTINGS.closedSessionShading,
    ),
    crosshairColor: sanitizeHex(candidate.crosshairColor, DEFAULT_CHART_VISUAL_SETTINGS.crosshairColor),
    gridColor: sanitizeHex(candidate.gridColor, DEFAULT_CHART_VISUAL_SETTINGS.gridColor),
    footprintAlignment: sanitizeOrderFlowAlignment(candidate.footprintAlignment),
    footprintAskColor: sanitizeHex(
      candidate.footprintAskColor,
      DEFAULT_CHART_VISUAL_SETTINGS.footprintAskColor,
    ),
    footprintBidColor: sanitizeHex(
      candidate.footprintBidColor,
      DEFAULT_CHART_VISUAL_SETTINGS.footprintBidColor,
    ),
    footprintDisplayMode: sanitizeOrderFlowDisplayMode(candidate.footprintDisplayMode),
    footprintImbalanceRatio: clampInteger(
      candidate.footprintImbalanceRatio,
      2,
      10,
      DEFAULT_CHART_VISUAL_SETTINGS.footprintImbalanceRatio,
    ),
    footprintNeutralColor: sanitizeHex(
      candidate.footprintNeutralColor,
      DEFAULT_CHART_VISUAL_SETTINGS.footprintNeutralColor,
    ),
    footprintShowAverageTradeSize: sanitizeBoolean(
      candidate.footprintShowAverageTradeSize,
      DEFAULT_CHART_VISUAL_SETTINGS.footprintShowAverageTradeSize,
    ),
    footprintShowImbalances: sanitizeBoolean(
      candidate.footprintShowImbalances,
      DEFAULT_CHART_VISUAL_SETTINGS.footprintShowImbalances,
    ),
    footprintShowStats: sanitizeBoolean(
      candidate.footprintShowStats,
      DEFAULT_CHART_VISUAL_SETTINGS.footprintShowStats,
    ),
    footprintShowUnfinishedAuctions: sanitizeBoolean(
      candidate.footprintShowUnfinishedAuctions,
      DEFAULT_CHART_VISUAL_SETTINGS.footprintShowUnfinishedAuctions,
    ),
    footprintStackedImbalanceCount: clampInteger(
      candidate.footprintStackedImbalanceCount,
      2,
      6,
      DEFAULT_CHART_VISUAL_SETTINGS.footprintStackedImbalanceCount,
    ),
    footprintStatsMetric: sanitizeOrderFlowStatsMetric(candidate.footprintStatsMetric),
    orderFlowTemplate: sanitizeOrderFlowTemplateId(candidate.orderFlowTemplate),
    pricePrecision: clampInteger(candidate.pricePrecision, 0, 8, DEFAULT_CHART_VISUAL_SETTINGS.pricePrecision),
    postMarketShading: sanitizeBoolean(
      candidate.postMarketShading,
      DEFAULT_CHART_VISUAL_SETTINGS.postMarketShading,
    ),
    preMarketShading: sanitizeBoolean(
      candidate.preMarketShading,
      DEFAULT_CHART_VISUAL_SETTINGS.preMarketShading,
    ),
    sessionBreakColor: sanitizeHex(candidate.sessionBreakColor, DEFAULT_CHART_VISUAL_SETTINGS.sessionBreakColor),
    sessionBreakLineStyle: sanitizeLineStyle(candidate.sessionBreakLineStyle),
    sessionBreakLineWidth: clampInteger(
      candidate.sessionBreakLineWidth,
      1,
      8,
      DEFAULT_CHART_VISUAL_SETTINGS.sessionBreakLineWidth,
    ),
    sessionTemplate: sanitizeSessionTemplatePreference(candidate.sessionTemplate),
    textColor: sanitizeHex(candidate.textColor, DEFAULT_CHART_VISUAL_SETTINGS.textColor),
    textSize: clampInteger(candidate.textSize, 10, 18, DEFAULT_CHART_VISUAL_SETTINGS.textSize),
    timeZone: sanitizeChartTimeZone(candidate.timeZone),
    timeScaleBorderVisible:
      typeof candidate.timeScaleBorderVisible === "boolean"
        ? candidate.timeScaleBorderVisible
        : typeof candidate.priceScaleBorderVisible === "boolean"
          ? candidate.priceScaleBorderVisible
          : DEFAULT_CHART_VISUAL_SETTINGS.timeScaleBorderVisible,
    tpoBracketMinutes: clampInteger(
      candidate.tpoBracketMinutes,
      5,
      240,
      DEFAULT_CHART_VISUAL_SETTINGS.tpoBracketMinutes,
    ),
    tpoShowPointOfControl: sanitizeBoolean(
      candidate.tpoShowPointOfControl,
      DEFAULT_CHART_VISUAL_SETTINGS.tpoShowPointOfControl,
    ),
    tpoShowValueArea: sanitizeBoolean(
      candidate.tpoShowValueArea,
      DEFAULT_CHART_VISUAL_SETTINGS.tpoShowValueArea,
    ),
    tpoValueAreaPercent: clampInteger(
      candidate.tpoValueAreaPercent,
      50,
      95,
      DEFAULT_CHART_VISUAL_SETTINGS.tpoValueAreaPercent,
    ),
    tradingHoursMode: sanitizeTradingHoursMode(candidate.tradingHoursMode),
    wickDownColor,
    wickUpColor,
  };
}

function sanitizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function sanitizeLineStyle(value: unknown): ChartLineStyle {
  return value === "solid" || value === "dashed" || value === "dotted"
    ? value
    : DEFAULT_CHART_VISUAL_SETTINGS.sessionBreakLineStyle;
}

export function loadChartSettingsPresets(): ChartSettingsPreset[] {
  return sanitizeChartSettingsPresets(
    getCachedAppStorageItem<unknown>(CHART_SETTINGS_PRESETS_STORAGE_KEY, []),
  );
}

export async function hydrateChartSettingsPresets(): Promise<ChartSettingsPreset[]> {
  const [loaded] = await Promise.all([
    loadAppStorageItem<unknown>(CHART_SETTINGS_PRESETS_STORAGE_KEY, []),
    loadAppStorageItem<string | null>(ACTIVE_CHART_SETTINGS_PRESET_STORAGE_KEY, null),
  ]);
  const presets = sanitizeChartSettingsPresets(loaded);
  return presets;
}

export function saveChartSettingsPreset(
  name: string,
  settings: ChartVisualSettings,
): ChartSettingsPreset[] {
  const presetName = normalizeChartSettingsPresetName(name);
  const existing = getCachedAppStorageItem<ChartSettingsPreset[]>(CHART_SETTINGS_PRESETS_STORAGE_KEY, []);
  const previous = existing.find((preset) => preset.name === presetName);
  const sanitized = sanitizeChartVisualSettings(settings);
  const before = sanitizeChartVisualSettings(previous?.settings);
  const changes = Object.fromEntries(Object.entries(sanitized).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key as keyof ChartVisualSettings])));
  const nextPreset: ChartSettingsPreset = {
    ...previous,
    name: presetName,
    settings: previous ? { ...previous.settings, ...changes } : sanitized,
    updatedAt: new Date().toISOString(),
  };
  const nextPresets = [
    nextPreset,
    ...existing.filter((preset) => preset.name !== presetName),
  ];
  persistChartSettingsPresets(nextPresets);
  persistActiveChartSettingsPresetName(presetName);
  return nextPresets;
}

export function deleteChartSettingsPreset(name: string): ChartSettingsPreset[] {
  const presetName = normalizeChartSettingsPresetName(name);
  const nextPresets = getCachedAppStorageItem<ChartSettingsPreset[]>(CHART_SETTINGS_PRESETS_STORAGE_KEY, []).filter(
    (preset) => preset.name !== presetName,
  );
  persistChartSettingsPresets(nextPresets);
  if (loadActiveChartSettingsPresetName() === presetName) {
    persistActiveChartSettingsPresetName(nextPresets[0]?.name ?? null);
  }
  return nextPresets;
}

export function normalizeChartSettingsPresetName(name: string) {
  const normalized = name.trim().replace(/\s+/g, " ");
  return normalized || "Default";
}

export function loadActiveChartSettingsPresetName(
  presets = loadChartSettingsPresets(),
) {
  const storedName = getCachedAppStorageItem<string | null>(
    ACTIVE_CHART_SETTINGS_PRESET_STORAGE_KEY,
    null,
  );
  const normalizedName = storedName ? normalizeChartSettingsPresetName(storedName) : "";
  if (normalizedName && presets.some((preset) => preset.name === normalizedName)) {
    return normalizedName;
  }
  return presets[0]?.name ?? null;
}

export function loadActiveChartSettingsPreset(
  presets = loadChartSettingsPresets(),
) {
  const activeName = loadActiveChartSettingsPresetName(presets);
  return activeName
    ? presets.find((preset) => preset.name === activeName) ?? null
    : null;
}

export function persistActiveChartSettingsPresetName(name: string | null) {
  if (!name) {
    void saveAppStorageItem(ACTIVE_CHART_SETTINGS_PRESET_STORAGE_KEY, null);
    return;
  }
  void saveAppStorageItem(ACTIVE_CHART_SETTINGS_PRESET_STORAGE_KEY, normalizeChartSettingsPresetName(name));
}

export function subscribeChartSettingsPresets(
  listener: (presets: ChartSettingsPreset[]) => void,
) {
  return subscribeAppStorageItem<unknown>(
    CHART_SETTINGS_PRESETS_STORAGE_KEY,
    (value) => listener(sanitizeChartSettingsPresets(value)),
  );
}

function persistChartSettingsPresets(presets: ChartSettingsPreset[]) {
  void saveAppStorageItem(CHART_SETTINGS_PRESETS_STORAGE_KEY, presets);
}

function sanitizeChartSettingsPresets(value: unknown): ChartSettingsPreset[] {
  try {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
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
import {
  getCachedAppStorageItem,
  loadAppStorageItem,
  saveAppStorageItem,
  subscribeAppStorageItem,
} from "./serverStorage";
