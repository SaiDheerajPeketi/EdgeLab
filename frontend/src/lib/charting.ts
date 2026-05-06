import type { CandlestickData, LineData, UTCTimestamp } from "lightweight-charts";
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

export type ChartTimeframe = (typeof TIMEFRAMES)[number]["id"];
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
  | "hma"
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
  | "rectangle"
  | "fib"
  | "measure"
  | "longPosition"
  | "shortPosition"
  | "text";
export type DrawingLineStyle = "solid" | "dashed" | "dotted";
export type IndicatorSettings = {
  color: string;
  period: number;
  stdDev?: number;
  fastPeriod?: number;
  slowPeriod?: number;
  signalPeriod?: number;
  signalColor?: string;
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

export type MacdData = {
  histogram: Array<{ time: UTCTimestamp; value: number }>;
  macd: LineData[];
  signal: LineData[];
};

export const DEFAULT_FIB_BACKGROUND_OPACITY = 0.055;

export const DEFAULT_FIB_LEVELS: FibLevel[] = [
  { id: "0", value: 0, color: "#f8fafc", backgroundOpacity: 0.035, label: "0", lineStyle: "solid" },
  { id: "0236", value: 0.236, color: "#38bdf8", backgroundOpacity: 0.045, label: "0.236", lineStyle: "solid" },
  { id: "0382", value: 0.382, color: "#22c55e", backgroundOpacity: 0.052, label: "0.382", lineStyle: "solid" },
  { id: "05", value: 0.5, color: "#fbbf24", backgroundOpacity: 0.058, label: "0.5", lineStyle: "solid" },
  { id: "0618", value: 0.618, color: "#f59e0b", backgroundOpacity: 0.066, label: "0.618", lineStyle: "solid" },
  { id: "0786", value: 0.786, color: "#f472b6", backgroundOpacity: 0.052, label: "0.786", lineStyle: "solid" },
  { id: "1", value: 1, color: "#f8fafc", backgroundOpacity: 0.035, label: "1", lineStyle: "solid" },
  { id: "1272", value: 1.272, color: "#a78bfa", backgroundOpacity: 0.045, label: "1.272", lineStyle: "dashed" },
  { id: "1618", value: 1.618, color: "#fb7185", backgroundOpacity: 0.045, label: "1.618", lineStyle: "dashed" },
];

export const INDICATORS: Array<{
  id: ChartIndicatorKind;
  kind: ChartIndicatorKind;
  label: string;
  description: string;
  color: string;
  pane: "overlay" | "pane";
}> = [
  { id: "ema", kind: "ema", label: "EMA", description: "Exponential moving average", color: "#32d3ee", pane: "overlay" },
  { id: "sma", kind: "sma", label: "SMA", description: "Simple moving average", color: "#a78bfa", pane: "overlay" },
  { id: "wma", kind: "wma", label: "WMA", description: "Weighted moving average", color: "#38bdf8", pane: "overlay" },
  { id: "dema", kind: "dema", label: "DEMA", description: "Double exponential average", color: "#2dd4bf", pane: "overlay" },
  { id: "tema", kind: "tema", label: "TEMA", description: "Triple exponential average", color: "#34d399", pane: "overlay" },
  { id: "hma", kind: "hma", label: "HMA", description: "Hull moving average", color: "#fbbf24", pane: "overlay" },
  { id: "vwap", kind: "vwap", label: "VWAP", description: "Session fair value", color: "#22c55e", pane: "overlay" },
  { id: "bb", kind: "bb", label: "Bollinger Bands", description: "Volatility envelope", color: "#94a3b8", pane: "overlay" },
  { id: "donchian", kind: "donchian", label: "Donchian Channel", description: "High-low range channel", color: "#60a5fa", pane: "overlay" },
  { id: "keltner", kind: "keltner", label: "Keltner Channel", description: "ATR volatility channel", color: "#fb923c", pane: "overlay" },
  { id: "supertrend", kind: "supertrend", label: "SuperTrend", description: "ATR trend overlay", color: "#84cc16", pane: "overlay" },
  { id: "rsi", kind: "rsi", label: "RSI", description: "Relative strength pane", color: "#f472b6", pane: "pane" },
  { id: "macd", kind: "macd", label: "MACD", description: "Trend momentum pane", color: "#60a5fa", pane: "pane" },
  { id: "atr", kind: "atr", label: "ATR", description: "Average true range pane", color: "#f97316", pane: "pane" },
  { id: "momentum", kind: "momentum", label: "Momentum", description: "Close-to-close momentum pane", color: "#c084fc", pane: "pane" },
];

export const DEFAULT_INDICATOR_SETTINGS: IndicatorSettingsMap = {
  atr: { color: "#f97316", period: 14 },
  bb: { color: "#94a3b8", period: 20, stdDev: 2 },
  dema: { color: "#2dd4bf", period: 20 },
  donchian: { color: "#60a5fa", period: 20 },
  ema: { color: "#32d3ee", period: 20 },
  hma: { color: "#fbbf24", period: 20 },
  keltner: { color: "#fb923c", period: 20, stdDev: 2 },
  macd: {
    color: "#60a5fa",
    period: 12,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    signalColor: "#f59e0b",
    histogramColor: "#94a3b8",
  },
  momentum: { color: "#c084fc", period: 10 },
  rsi: { color: "#f472b6", period: 14 },
  sma: { color: "#a78bfa", period: 20 },
  supertrend: { color: "#84cc16", period: 10, stdDev: 3 },
  tema: { color: "#34d399", period: 20 },
  vwap: { color: "#22c55e", period: 1 },
  wma: { color: "#38bdf8", period: 20 },
};

const INDICATOR_INSTANCE_COLORS = [
  "#32d3ee",
  "#f59e0b",
  "#a78bfa",
  "#22c55e",
  "#fb7185",
  "#f472b6",
  "#fbbf24",
  "#38bdf8",
  "#c084fc",
  "#84cc16",
  "#fb923c",
  "#2dd4bf",
  "#60a5fa",
  "#94a3b8",
];

export const DEFAULT_LEGACY_INDICATOR_SETTINGS: LegacyIndicatorSettingsMap = {
  atr14: { color: "#f97316", period: 14 },
  bb20: { color: "#94a3b8", period: 20, stdDev: 2 },
  dema20: { color: "#2dd4bf", period: 20 },
  donchian20: { color: "#60a5fa", period: 20 },
  ema20: { color: "#32d3ee", period: 20 },
  ema50: { color: "#f59e0b", period: 50 },
  hma20: { color: "#fbbf24", period: 20 },
  keltner20: { color: "#fb923c", period: 20, stdDev: 2 },
  momentum10: { color: "#c084fc", period: 10 },
  rsi14: { color: "#f472b6", period: 14 },
  macd: { ...DEFAULT_INDICATOR_SETTINGS.macd },
  sma200: { color: "#a78bfa", period: 200 },
  supertrend10: { color: "#84cc16", period: 10, stdDev: 3 },
  tema20: { color: "#34d399", period: 20 },
  vwap: { color: "#22c55e", period: 1 },
  wma20: { color: "#38bdf8", period: 20 },
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
    case "hma":
      return `HMA ${period}`;
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

export function getTimeframeSeconds(timeframe: ChartTimeframe) {
  return TIMEFRAMES.find((item) => item.id === timeframe)?.seconds ?? 60;
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
