import type { CandlestickData, LineData, UTCTimestamp } from "lightweight-charts";
import { CHART_COLOR } from "./colorTokens";
import type { Candle } from "./api";

export const TIMEFRAMES = [
  { id: "1m", label: "1m", seconds: 60 },
  { id: "5m", label: "5m", seconds: 300 },
  { id: "15m", label: "15m", seconds: 900 },
  { id: "30m", label: "30m", seconds: 1800 },
  { id: "1H", label: "1H", seconds: 3600 },
  { id: "4H", label: "4H", seconds: 14400 },
  { id: "1D", label: "1D", seconds: 86400 },
  { id: "1W", label: "1W", seconds: 604800 },
  { id: "1M", label: "1M", seconds: 2592000 },
] as const;

export type ChartTimeframe = string;
type ChartTimeframeUnit = "minute" | "hour" | "day" | "week" | "month";
type ParsedChartTimeframe = {
  id: ChartTimeframe;
  label: string;
  seconds: number;
  unit: ChartTimeframeUnit;
  value: number;
};
export type ChartStyle = "area" | "candles" | "heikinAshi" | "line";
export type ChartIndicatorId =
  | "atr14"
  | "ema20"
  | "ema50"
  | "dema20"
  | "donchian20"
  | "hma20"
  | "keltner20"
  | "momentum10"
  | "sma200"
  | "supertrend10"
  | "tema20"
  | "vwap"
  | "wma20"
  | "bb20"
  | "rsi14"
  | "macd";
export type ChartIndicatorKind =
  | "atr"
  | "bb"
  | "dema"
  | "donchian"
  | "ema"
  | "fvg"
  | "hma"
  | "ifvg"
  | "keltner"
  | "macd"
  | "momentum"
  | "rsi"
  | "sma"
  | "supertrend"
  | "tema"
  | "vwap"
  | "wma";
export type DrawingTool =
  | "cursor"
  | "crosshair"
  | "trendline"
  | "horizontal"
  | "vertical"
  | "rectangle"
  | "fib"
  | "measure"
  | "longPosition"
  | "shortPosition"
  | "text";
export type DrawingLineStyle = "solid" | "dashed" | "dotted";
export type MagnetMode = "off" | "weak" | "strong";
export type IndicatorSettings = {
  color: string;
  period: number;
  extendBars?: number;
  fillOpacity?: number;
  stdDev?: number;
  fastPeriod?: number;
  slowPeriod?: number;
  signalPeriod?: number;
  maxZones?: number;
  minGapPercent?: number;
  secondaryColor?: string;
  signalColor?: string;
  showLabels?: boolean;
  unmitigatedOnly?: boolean;
  histogramColor?: string;
  lineStyle?: DrawingLineStyle;
  lineWidth?: number;
};

export type IndicatorSettingsMap = Record<ChartIndicatorKind, IndicatorSettings>;
export type LegacyIndicatorSettingsMap = Record<ChartIndicatorId, IndicatorSettings>;

export type ChartIndicatorInstance = {
  id: string;
  kind: ChartIndicatorKind;
  settings: IndicatorSettings;
  visible?: boolean;
  createdAt?: string;
};

export type DrawingPoint = {
  logical?: number;
  time: number;
  price: number;
};

export type FibLevel = {
  id: string;
  value: number;
  color: string;
  backgroundOpacity?: number;
  label?: string;
  lineStyle?: DrawingLineStyle;
  visible?: boolean;
};

export type ChartDrawing = {
  id: string;
  tool: Exclude<DrawingTool, "cursor" | "crosshair">;
  color: string;
  fibExtendLeft?: boolean;
  fibExtendRight?: boolean;
  fibLevels?: FibLevel[];
  fillOpacity?: number;
  lineStyle?: DrawingLineStyle;
  lineWidth?: number;
  locked?: boolean;
  points: DrawingPoint[];
  rewardColor?: string;
  riskColor?: string;
  label?: string;
  labelBackgroundOpacity?: number;
  createdAt: string;
  visible?: boolean;
};

export type IndicatorDefinition = {
  id: string;
  sourceId: string;
  label: string;
  color: string;
  data: LineData[];
  lineWidth?: 1 | 2 | 3 | 4;
  lineStyle?: 0 | 1 | 2 | 3 | 4;
};

export type FvgZoneDefinition = {
  id: string;
  sourceId: string;
  label: string;
  active: boolean;
  color: string;
  fillOpacity: number;
  high: number;
  lineStyle?: 0 | 1 | 2;
  lineWidth?: 1 | 2 | 3 | 4;
  low: number;
  mitigated: boolean;
  showLabel: boolean;
  startLogical: number;
  endLogical: number;
};

type GapSeed = {
  direction: "bullish" | "bearish";
  high: number;
  invalidationIndex: number | null;
  low: number;
  mitigationIndex: number | null;
  sourceIndex: number;
  time: number;
};

export type MacdData = {
  histogram: Array<{ time: UTCTimestamp; value: number }>;
  macd: LineData[];
  signal: LineData[];
};

export const DEFAULT_FIB_BACKGROUND_OPACITY = 0.055;

export const DEFAULT_FIB_LEVELS: FibLevel[] = [
  { id: "0", value: 0, color: CHART_COLOR.white, backgroundOpacity: 0.035, label: "0", lineStyle: "solid" },
  { id: "0236", value: 0.236, color: CHART_COLOR.sky, backgroundOpacity: 0.045, label: "0.236", lineStyle: "solid" },
  { id: "0382", value: 0.382, color: CHART_COLOR.up, backgroundOpacity: 0.052, label: "0.382", lineStyle: "solid" },
  { id: "05", value: 0.5, color: CHART_COLOR.warm, backgroundOpacity: 0.058, label: "0.5", lineStyle: "solid" },
  { id: "0618", value: 0.618, color: CHART_COLOR.amber, backgroundOpacity: 0.066, label: "0.618", lineStyle: "solid" },
  { id: "0786", value: 0.786, color: CHART_COLOR.magenta, backgroundOpacity: 0.052, label: "0.786", lineStyle: "solid" },
  { id: "1", value: 1, color: CHART_COLOR.white, backgroundOpacity: 0.035, label: "1", lineStyle: "solid" },
  { id: "1272", value: 1.272, color: CHART_COLOR.violet, backgroundOpacity: 0.045, label: "1.272", lineStyle: "solid" },
  { id: "1618", value: 1.618, color: CHART_COLOR.down, backgroundOpacity: 0.045, label: "1.618", lineStyle: "solid" },
];

export const INDICATORS: Array<{
  id: ChartIndicatorKind;
  kind: ChartIndicatorKind;
  label: string;
  description: string;
  color: string;
  pane: "overlay" | "pane";
}> = [
  { id: "ema", kind: "ema", label: "EMA", description: "Exponential moving average", color: CHART_COLOR.cyan, pane: "overlay" },
  { id: "sma", kind: "sma", label: "SMA", description: "Simple moving average", color: CHART_COLOR.violet, pane: "overlay" },
  { id: "wma", kind: "wma", label: "WMA", description: "Weighted moving average", color: CHART_COLOR.sky, pane: "overlay" },
  { id: "dema", kind: "dema", label: "DEMA", description: "Double exponential average", color: CHART_COLOR.teal, pane: "overlay" },
  { id: "tema", kind: "tema", label: "TEMA", description: "Triple exponential average", color: CHART_COLOR.up, pane: "overlay" },
  { id: "fvg", kind: "fvg", label: "Fair Value Gap", description: "Automatic imbalance zones", color: CHART_COLOR.amber, pane: "overlay" },
  { id: "hma", kind: "hma", label: "HMA", description: "Hull moving average", color: CHART_COLOR.warm, pane: "overlay" },
  { id: "ifvg", kind: "ifvg", label: "iFVG", description: "Inverted fair value gaps", color: CHART_COLOR.blue, pane: "overlay" },
  { id: "vwap", kind: "vwap", label: "VWAP", description: "Session fair value", color: CHART_COLOR.up, pane: "overlay" },
  { id: "bb", kind: "bb", label: "Bollinger Bands", description: "Volatility envelope", color: CHART_COLOR.muted, pane: "overlay" },
  { id: "donchian", kind: "donchian", label: "Donchian Channel", description: "High-low range channel", color: CHART_COLOR.blue, pane: "overlay" },
  { id: "keltner", kind: "keltner", label: "Keltner Channel", description: "ATR volatility channel", color: CHART_COLOR.orange, pane: "overlay" },
  { id: "supertrend", kind: "supertrend", label: "SuperTrend", description: "ATR trend overlay", color: CHART_COLOR.lime, pane: "overlay" },
  { id: "rsi", kind: "rsi", label: "RSI", description: "Relative strength pane", color: CHART_COLOR.magenta, pane: "pane" },
  { id: "macd", kind: "macd", label: "MACD", description: "Trend momentum pane", color: CHART_COLOR.blue, pane: "pane" },
  { id: "atr", kind: "atr", label: "ATR", description: "Average true range pane", color: CHART_COLOR.orangeStrong, pane: "pane" },
  { id: "momentum", kind: "momentum", label: "Momentum", description: "Close-to-close momentum pane", color: CHART_COLOR.violetSoft, pane: "pane" },
];

export const DEFAULT_INDICATOR_SETTINGS: IndicatorSettingsMap = {
  atr: { color: CHART_COLOR.orangeStrong, period: 14 },
  bb: { color: CHART_COLOR.muted, period: 20, stdDev: 2 },
  dema: { color: CHART_COLOR.teal, period: 20 },
  donchian: { color: CHART_COLOR.blue, period: 20 },
  ema: { color: CHART_COLOR.cyan, period: 20 },
  fvg: {
    color: CHART_COLOR.amber,
    period: 1,
    extendBars: 80,
    fillOpacity: 0.18,
    lineStyle: "solid",
    lineWidth: 1,
    maxZones: 12,
    minGapPercent: 0,
    secondaryColor: CHART_COLOR.down,
    signalColor: CHART_COLOR.down,
    showLabels: true,
  },
  hma: { color: CHART_COLOR.warm, period: 20 },
  ifvg: {
    color: CHART_COLOR.blue,
    period: 1,
    extendBars: 120,
    fillOpacity: 0.16,
    lineStyle: "dashed",
    lineWidth: 1,
    maxZones: 10,
    minGapPercent: 0,
    secondaryColor: CHART_COLOR.magenta,
    signalColor: CHART_COLOR.magenta,
    showLabels: true,
    unmitigatedOnly: true,
  },
  keltner: { color: CHART_COLOR.orange, period: 20, stdDev: 2 },
  macd: {
    color: CHART_COLOR.blue,
    period: 12,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    signalColor: CHART_COLOR.amber,
    histogramColor: CHART_COLOR.muted,
  },
  momentum: { color: CHART_COLOR.violetSoft, period: 10 },
  rsi: { color: CHART_COLOR.magenta, period: 14 },
  sma: { color: CHART_COLOR.violet, period: 20 },
  supertrend: { color: CHART_COLOR.lime, period: 10, stdDev: 3 },
  tema: { color: CHART_COLOR.up, period: 20 },
  vwap: { color: CHART_COLOR.up, period: 1 },
  wma: { color: CHART_COLOR.sky, period: 20 },
};

const INDICATOR_INSTANCE_COLORS = [
  CHART_COLOR.cyan,
  CHART_COLOR.amber,
  CHART_COLOR.violet,
  CHART_COLOR.up,
  CHART_COLOR.down,
  CHART_COLOR.magenta,
  CHART_COLOR.warm,
  CHART_COLOR.sky,
  CHART_COLOR.violetSoft,
  CHART_COLOR.lime,
  CHART_COLOR.orange,
  CHART_COLOR.teal,
  CHART_COLOR.blue,
  CHART_COLOR.muted,
];

export const DEFAULT_LEGACY_INDICATOR_SETTINGS: LegacyIndicatorSettingsMap = {
  atr14: { color: CHART_COLOR.orangeStrong, period: 14 },
  bb20: { color: CHART_COLOR.muted, period: 20, stdDev: 2 },
  dema20: { color: CHART_COLOR.teal, period: 20 },
  donchian20: { color: CHART_COLOR.blue, period: 20 },
  ema20: { color: CHART_COLOR.cyan, period: 20 },
  ema50: { color: CHART_COLOR.amber, period: 50 },
  hma20: { color: CHART_COLOR.warm, period: 20 },
  keltner20: { color: CHART_COLOR.orange, period: 20, stdDev: 2 },
  momentum10: { color: CHART_COLOR.violetSoft, period: 10 },
  rsi14: { color: CHART_COLOR.magenta, period: 14 },
  macd: { ...DEFAULT_INDICATOR_SETTINGS.macd },
  sma200: { color: CHART_COLOR.violet, period: 200 },
  supertrend10: { color: CHART_COLOR.lime, period: 10, stdDev: 3 },
  tema20: { color: CHART_COLOR.up, period: 20 },
  vwap: { color: CHART_COLOR.up, period: 1 },
  wma20: { color: CHART_COLOR.sky, period: 20 },
};

export const LEGACY_INDICATOR_KIND: Record<ChartIndicatorId, ChartIndicatorKind> = {
  atr14: "atr",
  bb20: "bb",
  dema20: "dema",
  donchian20: "donchian",
  ema20: "ema",
  ema50: "ema",
  hma20: "hma",
  keltner20: "keltner",
  macd: "macd",
  momentum10: "momentum",
  rsi14: "rsi",
  sma200: "sma",
  supertrend10: "supertrend",
  tema20: "tema",
  vwap: "vwap",
  wma20: "wma",
};

export function getIndicatorCatalogItem(kind: ChartIndicatorKind) {
  return INDICATORS.find((indicator) => indicator.kind === kind);
}

export function mergeIndicatorSettings(
  kind: ChartIndicatorKind,
  settings?: Partial<IndicatorSettings> | null,
): IndicatorSettings {
  return {
    ...DEFAULT_INDICATOR_SETTINGS[kind],
    ...(settings ?? {}),
  };
}

export function createIndicatorInstance(
  kind: ChartIndicatorKind,
  settings?: Partial<IndicatorSettings> | null,
): ChartIndicatorInstance {
  return {
    id: createIndicatorInstanceId(kind),
    kind,
    settings: mergeIndicatorSettings(kind, settings),
    visible: true,
    createdAt: new Date().toISOString(),
  };
}

export function nextIndicatorInstanceColor(
  kind: ChartIndicatorKind,
  instances: ChartIndicatorInstance[],
) {
  const defaultColor = DEFAULT_INDICATOR_SETTINGS[kind].color;
  const usedColors = new Set(
    instances.map((indicator) => indicator.settings.color.toLowerCase()),
  );
  if (!usedColors.has(defaultColor.toLowerCase())) {
    return defaultColor;
  }

  const palette = [
    defaultColor,
    ...INDICATOR_INSTANCE_COLORS.filter(
      (color) => color.toLowerCase() !== defaultColor.toLowerCase(),
    ),
  ];
  return (
    palette.find((color) => !usedColors.has(color.toLowerCase())) ??
    palette[instances.length % palette.length] ??
    defaultColor
  );
}

export function createLegacyIndicatorInstance(
  indicator: ChartIndicatorId,
  settings?: Partial<Record<ChartIndicatorId, Partial<IndicatorSettings>>> | null,
): ChartIndicatorInstance {
  const kind = LEGACY_INDICATOR_KIND[indicator];
  return createIndicatorInstance(kind, {
    ...DEFAULT_LEGACY_INDICATOR_SETTINGS[indicator],
    ...(settings?.[indicator] ?? {}),
  });
}

export function isIndicatorKind(value: unknown): value is ChartIndicatorKind {
  return INDICATORS.some((indicator) => indicator.kind === value);
}

export function indicatorDisplayName(indicator: ChartIndicatorInstance) {
  const settings = mergeIndicatorSettings(indicator.kind, indicator.settings);
  const period = Math.max(1, Math.round(settings.period));
  switch (indicator.kind) {
    case "atr":
      return `ATR ${period}`;
    case "bb":
      return `Bollinger ${period}`;
    case "dema":
      return `DEMA ${period}`;
    case "donchian":
      return `Donchian ${period}`;
    case "ema":
      return `EMA ${period}`;
    case "fvg":
      return "FVG";
    case "hma":
      return `HMA ${period}`;
    case "ifvg":
      return "iFVG";
    case "keltner":
      return `Keltner ${period}`;
    case "macd":
      return `MACD ${settings.fastPeriod ?? 12} ${settings.slowPeriod ?? 26} ${settings.signalPeriod ?? 9}`;
    case "momentum":
      return `Momentum ${period}`;
    case "rsi":
      return `RSI ${period}`;
    case "sma":
      return `SMA ${period}`;
    case "supertrend":
      return `SuperTrend ${period}`;
    case "tema":
      return `TEMA ${period}`;
    case "vwap":
      return "VWAP";
    case "wma":
      return `WMA ${period}`;
  }
}

function createIndicatorInstanceId(kind: ChartIndicatorKind) {
  return `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeFibLevels(
  levels?: unknown,
  fallbackColor = "#22c55e",
): FibLevel[] {
  if (!Array.isArray(levels)) {
    return DEFAULT_FIB_LEVELS.map((level) => ({ ...level }));
  }

  const clean = levels
    .map((level, index): FibLevel | null => {
      if (typeof level !== "object" || level == null) {
        return null;
      }
      const candidate = level as Partial<FibLevel>;
      if (typeof candidate.value !== "number" || !Number.isFinite(candidate.value)) {
        return null;
      }
      return {
        id:
          typeof candidate.id === "string" && candidate.id.trim().length > 0
            ? candidate.id.trim().slice(0, 48)
            : `custom-${index}`,
        value: clampFibValue(candidate.value),
        color:
          typeof candidate.color === "string" && candidate.color.trim().length > 0
            ? candidate.color
            : fallbackColor,
        backgroundOpacity:
          typeof candidate.backgroundOpacity === "number" &&
          Number.isFinite(candidate.backgroundOpacity)
            ? clampFibBackgroundOpacity(candidate.backgroundOpacity)
            : DEFAULT_FIB_BACKGROUND_OPACITY,
        label:
          typeof candidate.label === "string"
            ? candidate.label.trim().slice(0, 24)
            : undefined,
        lineStyle:
          candidate.lineStyle === "dashed" || candidate.lineStyle === "dotted"
            ? candidate.lineStyle
            : "solid",
        visible: candidate.visible !== false,
      };
    })
    .filter((level): level is FibLevel => level != null)
    .sort((left, right) => left.value - right.value);

  return clean.length > 0
    ? clean
    : DEFAULT_FIB_LEVELS.map((level) => ({ ...level }));
}

function clampFibValue(value: number) {
  return Math.min(4.236, Math.max(-2, value));
}

function clampFibBackgroundOpacity(value: number) {
  return Math.min(0.24, Math.max(0, value));
}

export function isRiskRewardTool(
  tool: ChartDrawing["tool"] | DrawingTool,
): tool is "longPosition" | "shortPosition" {
  return tool === "longPosition" || tool === "shortPosition";
}

export function normalizeRiskRewardPoints(
  tool: "longPosition" | "shortPosition",
  points: DrawingPoint[],
): DrawingPoint[] {
  if (points.length === 0) {
    return points;
  }

  const entry = { ...points[0] };
  const targetSource = points[1] ? { ...points[1] } : { ...entry };
  const stopSource = points[2]
    ? { ...points[2] }
    : defaultRiskRewardStopPoint(tool, [entry, targetSource]);
  const gap = riskRewardMinimumGap(entry.price);
  const target =
    tool === "longPosition"
      ? {
          ...targetSource,
          price: Math.max(targetSource.price, entry.price + gap),
        }
      : {
          ...targetSource,
          price: Math.min(targetSource.price, entry.price - gap),
        };
  const stop =
    tool === "longPosition"
      ? {
          ...stopSource,
          price: Math.min(stopSource.price, entry.price - gap),
        }
      : {
          ...stopSource,
          price: Math.max(stopSource.price, entry.price + gap),
        };

  return [entry, target, stop, ...points.slice(3)];
}

export function normalizeRiskRewardDrawing(drawing: ChartDrawing): ChartDrawing {
  if (!isRiskRewardTool(drawing.tool)) {
    return drawing;
  }
  return {
    ...drawing,
    points: normalizeRiskRewardPoints(drawing.tool, drawing.points),
  };
}

export function defaultRiskRewardStopPoint(
  tool: "longPosition" | "shortPosition",
  points: DrawingPoint[],
): DrawingPoint {
  const entry = points[0];
  const target = points[1] ?? entry;
  const reward = Math.abs(target.price - entry.price);
  const fallbackRisk = Math.max(Math.abs(entry.price) * 0.001, riskRewardMinimumGap(entry.price));
  const risk = reward > 0 ? reward : fallbackRisk;
  return {
    logical: target.logical,
    time: target.time,
    price: tool === "shortPosition" ? entry.price + risk : entry.price - risk,
  };
}

function riskRewardMinimumGap(entryPrice: number) {
  return Math.max(Math.abs(entryPrice) * 0.000001, 0.00001);
}

const PRESET_TIMEFRAME_LOOKUP = new Map<string, ParsedChartTimeframe>(
  TIMEFRAMES.map((timeframe) => [
    timeframe.id,
    {
      id: timeframe.id,
      label: timeframe.label,
      seconds: timeframe.seconds,
      unit:
        timeframe.id === "1M"
          ? "month"
          : timeframe.id === "1W"
            ? "week"
            : timeframe.id === "1D"
              ? "day"
              : timeframe.id.endsWith("H")
                ? "hour"
                : "minute",
      value: Number.parseInt(timeframe.id, 10) || 1,
    },
  ]),
);

export function normalizeChartTimeframe(value: unknown): ChartTimeframe | null {
  return parseChartTimeframe(value)?.id ?? null;
}

export function formatChartTimeframeLabel(timeframe: ChartTimeframe) {
  return parseChartTimeframe(timeframe)?.label ?? String(timeframe);
}

export function getTimeframeSeconds(timeframe: ChartTimeframe) {
  return parseChartTimeframe(timeframe)?.seconds ?? 60;
}

export function canAggregateTimeframe(
  timeframe: ChartTimeframe,
  sourceTimeframe: ChartTimeframe | null,
) {
  const target = parseChartTimeframe(timeframe);
  const source = sourceTimeframe ? parseChartTimeframe(sourceTimeframe) : null;
  if (!target || !source) {
    return source == null && target != null;
  }
  if (target.seconds < source.seconds) {
    return false;
  }
  if (target.unit === "month") {
    return source.unit === "month"
      ? target.id === source.id
      : source.unit === "minute" || source.unit === "hour" || source.unit === "day";
  }
  return target.seconds % source.seconds === 0;
}

export function bucketTime(time: number, timeframe: ChartTimeframe) {
  if (timeframe === "1W") {
    const date = new Date(time * 1000);
    const daysFromMonday = (date.getUTCDay() + 6) % 7;
    return Math.floor(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate() - daysFromMonday,
      ) / 1000,
    );
  }

  if (timeframe === "1M") {
    const date = new Date(time * 1000);
    return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000);
  }

  const seconds = getTimeframeSeconds(timeframe);
  return Math.floor(time / seconds) * seconds;
}

function parseChartTimeframe(value: unknown): ParsedChartTimeframe | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const raw = String(value).trim();
  if (!raw) {
    return null;
  }
  const compact = raw.replace(/\s+/g, "");
  const upper = compact.toUpperCase();
  const direct = PRESET_TIMEFRAME_LOOKUP.get(compact);
  if (direct) {
    return direct;
  }

  const aliases: Record<string, string> = {
    "1MIN": "1m",
    "1MINUTE": "1m",
    M1: "1m",
    "5M": "5m",
    M5: "5m",
    "15M": "15m",
    M15: "15m",
    "30M": "30m",
    M30: "30m",
    H1: "1H",
    H4: "4H",
    D: "1D",
    DAILY: "1D",
    W: "1W",
    WEEKLY: "1W",
    MONTHLY: "1M",
  };
  const alias = aliases[upper];
  if (alias) {
    return parseChartTimeframe(alias);
  }

  const minuteMatch = compact.match(/^(\d+)(?:m|min|mins|minute|minutes)$/);
  if (minuteMatch) {
    return timeframeFromParts(minuteMatch[1], "minute", "m", 60);
  }
  const uppercaseMinuteMatch = compact.match(/^(\d+)M$/);
  if (uppercaseMinuteMatch && uppercaseMinuteMatch[1] !== "1") {
    return timeframeFromParts(uppercaseMinuteMatch[1], "minute", "m", 60);
  }
  const hourMatch = compact.match(/^(\d+)(?:h|hr|hrs|hour|hours)$/i);
  if (hourMatch) {
    return timeframeFromParts(hourMatch[1], "hour", "H", 3600);
  }
  const dayMatch = compact.match(/^(\d+)(?:d|day|days)$/i);
  if (dayMatch) {
    return timeframeFromParts(dayMatch[1], "day", "D", 86400);
  }
  const weekMatch = compact.match(/^(\d+)(?:w|wk|wks|week|weeks)$/i);
  if (weekMatch) {
    return timeframeFromParts(weekMatch[1], "week", "W", 604800);
  }

  return null;
}

function timeframeFromParts(
  rawValue: string,
  unit: Exclude<ChartTimeframeUnit, "month">,
  suffix: string,
  secondsPerUnit: number,
): ParsedChartTimeframe | null {
  const value = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(value) || value <= 0 || value > 10080) {
    return null;
  }
  return {
    id: `${value}${suffix}`,
    label: `${value}${suffix}`,
    seconds: value * secondsPerUnit,
    unit,
    value,
  };
}

export function normalizeBars(bars: Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const bar of bars) {
    if (!Number.isFinite(bar.time)) {
      continue;
    }
    byTime.set(bar.time, bar);
  }
  return Array.from(byTime.values()).sort((left, right) => left.time - right.time);
}

export function aggregateBars(bars: Candle[], timeframe: ChartTimeframe): Candle[] {
  const sortedBars = normalizeBars(bars);
  if (timeframe === "1m") {
    return sortedBars;
  }

  const grouped: Candle[] = [];
  let current: Candle | null = null;

  for (const bar of sortedBars) {
    const bucket = bucketTime(bar.time, timeframe);
    if (!current || current.time !== bucket) {
      if (current) {
        grouped.push(current);
      }
      current = {
        ...bar,
        time: bucket,
        timestamp: new Date(bucket * 1000).toISOString(),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        ema_20: null,
        ema_50: null,
        rsi_14: null,
      };
      continue;
    }

    current.high = Math.max(current.high, bar.high);
    current.low = Math.min(current.low, bar.low);
    current.close = bar.close;
    current.volume += bar.volume;
  }

  if (current) {
    grouped.push(current);
  }

  return grouped;
}

export function toCandles(bars: Candle[], smoothCandles: boolean): CandlestickData[] {
  const source = smoothCandles ? toHeikinAshi(bars) : bars;
  return source.map((bar) => ({
    time: bar.time as UTCTimestamp,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
  }));
}

export function buildIndicatorDefinitions(
  bars: Candle[],
  indicatorInstances: ChartIndicatorInstance[],
): IndicatorDefinition[] {
  const definitions: IndicatorDefinition[] = [];
  for (const instance of indicatorInstances) {
    if (instance.visible === false) {
      continue;
    }
    const config = mergeIndicatorSettings(instance.kind, instance.settings);
    const label = indicatorDisplayName({ ...instance, settings: config });
    const lineStyle = indicatorLineStyle(config.lineStyle);
    const lineWidth = indicatorLineWidth(config.lineWidth, 2);
    const channelLineWidth = indicatorLineWidth(config.lineWidth, 1);

    if (instance.kind === "ema") {
      definitions.push({
        id: instance.id,
        sourceId: instance.id,
        label,
        color: config.color,
        data: emaSeries(bars, config.period),
        lineStyle,
        lineWidth,
      });
    }

    if (instance.kind === "sma") {
      definitions.push({
        id: instance.id,
        sourceId: instance.id,
        label,
        color: config.color,
        data: smaSeries(bars, config.period),
        lineStyle,
        lineWidth,
      });
    }

    if (instance.kind === "wma") {
      definitions.push({
        id: instance.id,
        sourceId: instance.id,
        label,
        color: config.color,
        data: wmaSeries(bars, config.period),
        lineStyle,
        lineWidth,
      });
    }

    if (instance.kind === "dema") {
      definitions.push({
        id: instance.id,
        sourceId: instance.id,
        label,
        color: config.color,
        data: demaSeries(bars, config.period),
        lineStyle,
        lineWidth,
      });
    }

    if (instance.kind === "tema") {
      definitions.push({
        id: instance.id,
        sourceId: instance.id,
        label,
        color: config.color,
        data: temaSeries(bars, config.period),
        lineStyle,
        lineWidth,
      });
    }

    if (instance.kind === "hma") {
      definitions.push({
        id: instance.id,
        sourceId: instance.id,
        label,
        color: config.color,
        data: hmaSeries(bars, config.period),
        lineStyle,
        lineWidth,
      });
    }

    if (instance.kind === "vwap") {
      definitions.push({
        id: instance.id,
        sourceId: instance.id,
        label,
        color: config.color,
        data: vwapSeries(bars),
        lineWidth,
        lineStyle: config.lineStyle ? lineStyle : 2,
      });
    }

    if (instance.kind === "bb") {
      const bands = bollingerBands(bars, config.period, config.stdDev ?? 2);
      definitions.push(
        {
          id: `${instance.id}-upper`,
          sourceId: instance.id,
          label: `${label} Upper`,
          color: config.color,
          data: bands.map((band) => ({ time: band.time, value: band.upper })),
          lineWidth: channelLineWidth,
          lineStyle: config.lineStyle ? lineStyle : 2,
        },
        {
          id: `${instance.id}-mid`,
          sourceId: instance.id,
          label: `${label} Mid`,
          color: config.color,
          data: bands.map((band) => ({ time: band.time, value: band.middle })),
          lineWidth: channelLineWidth,
          lineStyle: config.lineStyle ? lineStyle : 2,
        },
        {
          id: `${instance.id}-lower`,
          sourceId: instance.id,
          label: `${label} Lower`,
          color: config.color,
          data: bands.map((band) => ({ time: band.time, value: band.lower })),
          lineWidth: channelLineWidth,
          lineStyle: config.lineStyle ? lineStyle : 2,
        },
      );
    }

    if (instance.kind === "donchian") {
      const channel = donchianChannel(bars, config.period);
      definitions.push(
        {
          id: `${instance.id}-upper`,
          sourceId: instance.id,
          label: `${label} High`,
          color: config.color,
          data: channel.map((band) => ({ time: band.time, value: band.upper })),
          lineWidth: channelLineWidth,
          lineStyle: config.lineStyle ? lineStyle : 2,
        },
        {
          id: `${instance.id}-mid`,
          sourceId: instance.id,
          label: `${label} Mid`,
          color: config.color,
          data: channel.map((band) => ({ time: band.time, value: band.middle })),
          lineWidth: channelLineWidth,
          lineStyle: config.lineStyle ? lineStyle : 2,
        },
        {
          id: `${instance.id}-lower`,
          sourceId: instance.id,
          label: `${label} Low`,
          color: config.color,
          data: channel.map((band) => ({ time: band.time, value: band.lower })),
          lineWidth: channelLineWidth,
          lineStyle: config.lineStyle ? lineStyle : 2,
        },
      );
    }

    if (instance.kind === "keltner") {
      const channel = keltnerChannel(bars, config.period, config.stdDev ?? 2);
      definitions.push(
        {
          id: `${instance.id}-upper`,
          sourceId: instance.id,
          label: `${label} Upper`,
          color: config.color,
          data: channel.map((band) => ({ time: band.time, value: band.upper })),
          lineWidth: channelLineWidth,
          lineStyle: config.lineStyle ? lineStyle : 2,
        },
        {
          id: `${instance.id}-mid`,
          sourceId: instance.id,
          label: `${label} Mid`,
          color: config.color,
          data: channel.map((band) => ({ time: band.time, value: band.middle })),
          lineWidth: channelLineWidth,
          lineStyle,
        },
        {
          id: `${instance.id}-lower`,
          sourceId: instance.id,
          label: `${label} Lower`,
          color: config.color,
          data: channel.map((band) => ({ time: band.time, value: band.lower })),
          lineWidth: channelLineWidth,
          lineStyle: config.lineStyle ? lineStyle : 2,
        },
      );
    }

    if (instance.kind === "supertrend") {
      definitions.push({
        id: instance.id,
        sourceId: instance.id,
        label,
        color: config.color,
        data: superTrendSeries(bars, config.period, config.stdDev ?? 3),
        lineWidth,
        lineStyle: config.lineStyle ? lineStyle : 1,
      });
    }
  }

  return definitions;
}

export function buildFvgZoneDefinitions(
  bars: Candle[],
  indicatorInstances: ChartIndicatorInstance[],
): FvgZoneDefinition[] {
  const definitions: FvgZoneDefinition[] = [];
  const seeds = detectGapSeeds(bars);
  for (const instance of indicatorInstances) {
    if (
      instance.visible === false ||
      (instance.kind !== "fvg" && instance.kind !== "ifvg")
    ) {
      continue;
    }
    const settings = mergeIndicatorSettings(instance.kind, instance.settings);
    definitions.push(
      ...(instance.kind === "ifvg"
        ? ifvgZonesForInstance(bars, seeds, instance.id, settings)
        : fvgZonesForInstance(bars, seeds, instance.id, settings)),
    );
  }
  return definitions;
}

function indicatorLineWidth(width: number | undefined, fallback: 1 | 2 | 3 | 4): 1 | 2 | 3 | 4 {
  if (typeof width !== "number" || !Number.isFinite(width)) {
    return fallback;
  }
  const rounded = Math.round(width);
  if (rounded <= 1) {
    return 1;
  }
  if (rounded >= 4) {
    return 4;
  }
  return rounded as 1 | 2 | 3 | 4;
}

function indicatorLineStyle(style: DrawingLineStyle | undefined): 0 | 1 | 2 {
  switch (style) {
    case "dotted":
      return 1;
    case "dashed":
      return 2;
    default:
      return 0;
  }
}

function fvgZonesForInstance(
  bars: Candle[],
  seeds: GapSeed[],
  sourceId: string,
  settings: IndicatorSettings,
): FvgZoneDefinition[] {
  const extendBars = clampInteger(settings.extendBars, 1, 500, 80);
  const fillOpacity = clampNumber(settings.fillOpacity, 0.04, 0.45, 0.18);
  const lineStyle = indicatorLineStyle(settings.lineStyle);
  const lineWidth = indicatorLineWidth(settings.lineWidth, 1);
  const maxZones = clampInteger(settings.maxZones, 1, 64, 12);
  const minGapPercent = clampNumber(settings.minGapPercent, 0, 100, 0);
  const zones: FvgZoneDefinition[] = [];
  const lastLogical = Math.max(0, bars.length - 1 + 0.9);
  const bearishColor =
    settings.secondaryColor ?? settings.signalColor ?? CHART_COLOR.down;

  for (const seed of seeds) {
    if (gapPercent(seed.low, seed.high) < minGapPercent) {
      continue;
    }
    if (settings.unmitigatedOnly === true && seed.mitigationIndex != null) {
      continue;
    }
    zones.push({
      id: `${sourceId}-${seed.direction}-${seed.time}`,
      sourceId,
      label: seed.direction === "bullish" ? "Bull FVG" : "Bear FVG",
      active: seed.mitigationIndex == null,
      color: seed.direction === "bullish" ? settings.color : bearishColor,
      fillOpacity,
      high: seed.high,
      lineStyle,
      lineWidth,
      low: seed.low,
      mitigated: seed.mitigationIndex != null,
      showLabel: settings.showLabels !== false,
      startLogical: seed.sourceIndex - 1 + 0.15,
      endLogical:
        seed.invalidationIndex == null
          ? Math.min(lastLogical, seed.sourceIndex + extendBars)
          : Math.min(lastLogical, seed.invalidationIndex + 0.85),
    });
  }

  return zones.slice(-maxZones);
}

function ifvgZonesForInstance(
  bars: Candle[],
  seeds: GapSeed[],
  sourceId: string,
  settings: IndicatorSettings,
): FvgZoneDefinition[] {
  const extendBars = clampInteger(settings.extendBars, 1, 500, 120);
  const fillOpacity = clampNumber(settings.fillOpacity, 0.04, 0.45, 0.16);
  const lineStyle = indicatorLineStyle(settings.lineStyle);
  const lineWidth = indicatorLineWidth(settings.lineWidth, 1);
  const maxZones = clampInteger(settings.maxZones, 1, 64, 10);
  const minGapPercent = clampNumber(settings.minGapPercent, 0, 100, 0);
  const lastLogical = Math.max(0, bars.length - 1 + 0.9);
  const bearishColor =
    settings.secondaryColor ?? settings.signalColor ?? CHART_COLOR.magenta;
  const zones: FvgZoneDefinition[] = [];

  for (const seed of seeds) {
    if (seed.invalidationIndex == null || gapPercent(seed.low, seed.high) < minGapPercent) {
      continue;
    }

    const inversionDirection = seed.direction === "bullish" ? "bearish" : "bullish";
    const mitigationIndex = findInvertedZoneMitigationIndex(
      bars,
      seed.invalidationIndex + 1,
      inversionDirection,
      seed.low,
      seed.high,
    );
    if (settings.unmitigatedOnly === true && mitigationIndex != null) {
      continue;
    }

    zones.push({
      id: `${sourceId}-${inversionDirection}-${seed.time}`,
      sourceId,
      label: inversionDirection === "bullish" ? "Bull iFVG" : "Bear iFVG",
      active: mitigationIndex == null,
      color: inversionDirection === "bullish" ? settings.color : bearishColor,
      fillOpacity,
      high: seed.high,
      lineStyle,
      lineWidth,
      low: seed.low,
      mitigated: mitigationIndex != null,
      showLabel: settings.showLabels !== false,
      startLogical: seed.invalidationIndex - 0.2,
      endLogical:
        mitigationIndex == null
          ? Math.min(lastLogical, seed.invalidationIndex + extendBars)
          : Math.min(lastLogical, mitigationIndex + 0.85),
    });
  }

  return zones.slice(-maxZones);
}

function detectGapSeeds(bars: Candle[]): GapSeed[] {
  if (bars.length < 3) {
    return [];
  }

  const seeds: GapSeed[] = [];
  for (let index = 2; index < bars.length; index += 1) {
    const first = bars[index - 2];
    const third = bars[index];
    if (!first || !third) {
      continue;
    }
    if (third.low > first.high) {
      seeds.push({
        direction: "bullish",
        high: third.low,
        invalidationIndex: findBullishFvgInvalidationIndex(bars, index + 1, first.high),
        low: first.high,
        mitigationIndex: findBullishFvgMitigationIndex(bars, index + 1, third.low),
        sourceIndex: index,
        time: third.time,
      });
    }
    if (third.high < first.low) {
      seeds.push({
        direction: "bearish",
        high: first.low,
        invalidationIndex: findBearishFvgInvalidationIndex(bars, index + 1, first.low),
        low: third.high,
        mitigationIndex: findBearishFvgMitigationIndex(bars, index + 1, third.high),
        sourceIndex: index,
        time: third.time,
      });
    }
  }
  return seeds;
}

function gapPercent(low: number, high: number) {
  const midpoint = (low + high) / 2;
  if (!Number.isFinite(midpoint) || midpoint <= 0) {
    return 0;
  }
  return ((high - low) / midpoint) * 100;
}

function findBullishFvgMitigationIndex(
  bars: Candle[],
  startIndex: number,
  highBoundary: number,
) {
  for (let index = startIndex; index < bars.length; index += 1) {
    if (bars[index] && bars[index].low <= highBoundary) {
      return index;
    }
  }
  return null;
}

function findBearishFvgMitigationIndex(
  bars: Candle[],
  startIndex: number,
  lowBoundary: number,
) {
  for (let index = startIndex; index < bars.length; index += 1) {
    if (bars[index] && bars[index].high >= lowBoundary) {
      return index;
    }
  }
  return null;
}

function findBullishFvgInvalidationIndex(
  bars: Candle[],
  startIndex: number,
  lowBoundary: number,
) {
  for (let index = startIndex; index < bars.length; index += 1) {
    if (bars[index] && bars[index].close < lowBoundary) {
      return index;
    }
  }
  return null;
}

function findBearishFvgInvalidationIndex(
  bars: Candle[],
  startIndex: number,
  highBoundary: number,
) {
  for (let index = startIndex; index < bars.length; index += 1) {
    if (bars[index] && bars[index].close > highBoundary) {
      return index;
    }
  }
  return null;
}

function findInvertedZoneMitigationIndex(
  bars: Candle[],
  startIndex: number,
  direction: "bullish" | "bearish",
  lowBoundary: number,
  highBoundary: number,
) {
  for (let index = startIndex; index < bars.length; index += 1) {
    const bar = bars[index];
    if (!bar) {
      continue;
    }
    if (direction === "bullish" && bar.low <= highBoundary) {
      return index;
    }
    if (direction === "bearish" && bar.high >= lowBoundary) {
      return index;
    }
  }
  return null;
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

export function rsiSeries(bars: Candle[], period = 14): LineData[] {
  if (bars.length <= period) {
    return [];
  }

  let gains = 0;
  let losses = 0;
  const output: LineData[] = [];

  for (let index = 1; index <= period; index += 1) {
    const change = bars[index].close - bars[index - 1].close;
    if (change >= 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  let averageGain = gains / period;
  let averageLoss = losses / period;
  output.push({
    time: bars[period].time as UTCTimestamp,
    value: toRsi(averageGain, averageLoss),
  });

  for (let index = period + 1; index < bars.length; index += 1) {
    const change = bars[index].close - bars[index - 1].close;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
    output.push({
      time: bars[index].time as UTCTimestamp,
      value: toRsi(averageGain, averageLoss),
    });
  }

  return output;
}

export function latestIndicatorValue(data: LineData[]) {
  return data.length === 0 ? null : data[data.length - 1].value;
}

export function macdSeries(
  bars: Candle[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MacdData {
  if (bars.length === 0) {
    return { histogram: [], macd: [], signal: [] };
  }

  const closes = bars.map((bar) => bar.close);
  const fast = emaValues(closes, fastPeriod);
  const slow = emaValues(closes, slowPeriod);
  const macdValues = closes.map((_, index) => fast[index] - slow[index]);
  const signalValues = emaValues(macdValues, signalPeriod);

  const macd: LineData[] = [];
  const signal: LineData[] = [];
  const histogram: MacdData["histogram"] = [];

  for (let index = 0; index < bars.length; index += 1) {
    const time = bars[index].time as UTCTimestamp;
    macd.push({ time, value: macdValues[index] });
    signal.push({ time, value: signalValues[index] });
    histogram.push({
      time,
      value: macdValues[index] - signalValues[index],
    });
  }

  return { histogram, macd, signal };
}

export function atrSeries(bars: Candle[], period = 14): LineData[] {
  const values = atrValues(bars, period);
  return values
    .map((value, index) => ({
      time: bars[index]?.time as UTCTimestamp,
      value,
    }))
    .filter((point) => Number.isFinite(point.value));
}

export function momentumSeries(bars: Candle[], period = 10): LineData[] {
  const output: LineData[] = [];
  for (let index = period; index < bars.length; index += 1) {
    output.push({
      time: bars[index].time as UTCTimestamp,
      value: bars[index].close - bars[index - period].close,
    });
  }
  return output;
}

function emaSeries(bars: Candle[], period: number): LineData[] {
  if (bars.length === 0) {
    return [];
  }
  const multiplier = 2 / (period + 1);
  let ema = bars[0].close;
  return bars.map((bar, index) => {
    ema = index === 0 ? bar.close : (bar.close - ema) * multiplier + ema;
    return { time: bar.time as UTCTimestamp, value: ema };
  });
}

function wmaSeries(bars: Candle[], period: number): LineData[] {
  const values = wmaValues(
    bars.map((bar) => bar.close),
    period,
  );
  return valuesToLineData(bars, values);
}

function demaSeries(bars: Candle[], period: number): LineData[] {
  const closes = bars.map((bar) => bar.close);
  const emaOne = emaValues(closes, period);
  const emaTwo = emaValues(emaOne, period);
  return valuesToLineData(
    bars,
    closes.map((_, index) => 2 * emaOne[index] - emaTwo[index]),
  );
}

function temaSeries(bars: Candle[], period: number): LineData[] {
  const closes = bars.map((bar) => bar.close);
  const emaOne = emaValues(closes, period);
  const emaTwo = emaValues(emaOne, period);
  const emaThree = emaValues(emaTwo, period);
  return valuesToLineData(
    bars,
    closes.map((_, index) => 3 * emaOne[index] - 3 * emaTwo[index] + emaThree[index]),
  );
}

function hmaSeries(bars: Candle[], period: number): LineData[] {
  const closes = bars.map((bar) => bar.close);
  const halfPeriod = Math.max(1, Math.round(period / 2));
  const sqrtPeriod = Math.max(1, Math.round(Math.sqrt(period)));
  const half = wmaValues(closes, halfPeriod);
  const full = wmaValues(closes, period);
  const composite = closes.map((_, index) =>
    Number.isFinite(half[index]) && Number.isFinite(full[index])
      ? 2 * half[index] - full[index]
      : Number.NaN,
  );
  return valuesToLineData(bars, wmaValues(composite, sqrtPeriod));
}

function emaValues(values: number[], period: number): number[] {
  if (values.length === 0) {
    return [];
  }
  const multiplier = 2 / (period + 1);
  let ema = values[0];
  return values.map((value, index) => {
    ema = index === 0 ? value : (value - ema) * multiplier + ema;
    return ema;
  });
}

function wmaValues(values: number[], period: number): number[] {
  const denominator = (period * (period + 1)) / 2;
  return values.map((_, index) => {
    if (index < period - 1) {
      return Number.NaN;
    }
    let weighted = 0;
    for (let step = 0; step < period; step += 1) {
      const value = values[index - step];
      if (!Number.isFinite(value)) {
        return Number.NaN;
      }
      weighted += value * (period - step);
    }
    return weighted / denominator;
  });
}

function smaSeries(bars: Candle[], period: number): LineData[] {
  const output: LineData[] = [];
  let rolling = 0;
  for (let index = 0; index < bars.length; index += 1) {
    rolling += bars[index].close;
    if (index >= period) {
      rolling -= bars[index - period].close;
    }
    if (index >= period - 1) {
      output.push({
        time: bars[index].time as UTCTimestamp,
        value: rolling / period,
      });
    }
  }
  return output;
}

function donchianChannel(bars: Candle[], period: number) {
  const output: Array<{
    time: UTCTimestamp;
    upper: number;
    middle: number;
    lower: number;
  }> = [];

  for (let index = period - 1; index < bars.length; index += 1) {
    const window = bars.slice(index - period + 1, index + 1);
    const upper = Math.max(...window.map((bar) => bar.high));
    const lower = Math.min(...window.map((bar) => bar.low));
    output.push({
      time: bars[index].time as UTCTimestamp,
      upper,
      middle: (upper + lower) / 2,
      lower,
    });
  }

  return output;
}

function keltnerChannel(bars: Candle[], period: number, multiplier: number) {
  const middle = emaValues(
    bars.map((bar) => (bar.high + bar.low + bar.close) / 3),
    period,
  );
  const atr = atrValues(bars, period);
  return bars
    .map((bar, index) => ({
      time: bar.time as UTCTimestamp,
      upper: middle[index] + atr[index] * multiplier,
      middle: middle[index],
      lower: middle[index] - atr[index] * multiplier,
    }))
    .filter((band) =>
      Number.isFinite(band.upper) &&
      Number.isFinite(band.middle) &&
      Number.isFinite(band.lower),
    );
}

function superTrendSeries(bars: Candle[], period: number, multiplier: number): LineData[] {
  const atr = atrValues(bars, period);
  const closes = bars.map((bar) => bar.close);
  const ema = emaValues(closes, Math.max(2, period));
  const output: LineData[] = [];
  for (let index = 0; index < bars.length; index += 1) {
    if (!Number.isFinite(atr[index]) || !Number.isFinite(ema[index])) {
      continue;
    }
    const bar = bars[index];
    const basis = (bar.high + bar.low) / 2;
    const bullish = bar.close >= ema[index];
    output.push({
      time: bar.time as UTCTimestamp,
      value: bullish ? basis - atr[index] * multiplier : basis + atr[index] * multiplier,
    });
  }
  return output;
}

function atrValues(bars: Candle[], period: number) {
  if (bars.length === 0) {
    return [];
  }

  const trueRanges = bars.map((bar, index) => {
    if (index === 0) {
      return bar.high - bar.low;
    }
    const previousClose = bars[index - 1].close;
    return Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - previousClose),
      Math.abs(bar.low - previousClose),
    );
  });
  return emaValues(trueRanges, period);
}

function valuesToLineData(bars: Candle[], values: number[]): LineData[] {
  return values
    .map((value, index) => ({
      time: bars[index]?.time as UTCTimestamp,
      value,
    }))
    .filter((point) => Number.isFinite(point.value));
}

function vwapSeries(bars: Candle[]): LineData[] {
  const output: LineData[] = [];
  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;
  let activeDay = "";

  for (const bar of bars) {
    const day = new Date(bar.time * 1000).toISOString().slice(0, 10);
    if (day !== activeDay) {
      activeDay = day;
      cumulativePriceVolume = 0;
      cumulativeVolume = 0;
    }

    const typical = (bar.high + bar.low + bar.close) / 3;
    cumulativePriceVolume += typical * bar.volume;
    cumulativeVolume += bar.volume;
    output.push({
      time: bar.time as UTCTimestamp,
      value: cumulativeVolume > 0 ? cumulativePriceVolume / cumulativeVolume : typical,
    });
  }

  return output;
}

function bollingerBands(bars: Candle[], period: number, deviations: number) {
  const output: Array<{
    time: UTCTimestamp;
    upper: number;
    middle: number;
    lower: number;
  }> = [];

  for (let index = period - 1; index < bars.length; index += 1) {
    const window = bars.slice(index - period + 1, index + 1).map((bar) => bar.close);
    const middle = window.reduce((sum, close) => sum + close, 0) / period;
    const variance =
      window.reduce((sum, close) => sum + (close - middle) ** 2, 0) / period;
    const standardDeviation = Math.sqrt(variance);
    output.push({
      time: bars[index].time as UTCTimestamp,
      upper: middle + standardDeviation * deviations,
      middle,
      lower: middle - standardDeviation * deviations,
    });
  }

  return output;
}

function toHeikinAshi(bars: Candle[]): Candle[] {
  let previousOpen: number | null = null;
  let previousClose: number | null = null;

  return bars.map((bar) => {
    const close = (bar.open + bar.high + bar.low + bar.close) / 4;
    const open =
      previousOpen == null || previousClose == null
        ? (bar.open + bar.close) / 2
        : (previousOpen + previousClose) / 2;
    const high = Math.max(bar.high, open, close);
    const low = Math.min(bar.low, open, close);
    previousOpen = open;
    previousClose = close;
    return { ...bar, open, high, low, close };
  });
}

function toRsi(averageGain: number, averageLoss: number) {
  if (averageLoss === 0) {
    return 100;
  }
  const rs = averageGain / averageLoss;
  return 100 - 100 / (1 + rs);
}
