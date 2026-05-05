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
};

export type IndicatorSettingsMap = Record<ChartIndicatorId, IndicatorSettings>;

export type DrawingPoint = {
  logical?: number;
  time: number;
  price: number;
};

export type ChartDrawing = {
  id: string;
  tool: Exclude<DrawingTool, "cursor" | "crosshair">;
  color: string;
  fillOpacity?: number;
  lineStyle?: DrawingLineStyle;
  lineWidth?: number;
  locked?: boolean;
  points: DrawingPoint[];
  label?: string;
  createdAt: string;
  visible?: boolean;
};

export type IndicatorDefinition = {
  id: string;
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

export const INDICATORS: Array<{
  id: ChartIndicatorId;
  label: string;
  description: string;
  color: string;
}> = [
  { id: "ema20", label: "EMA 20", description: "Fast trend overlay", color: "#32d3ee" },
  { id: "ema50", label: "EMA 50", description: "Structure trend overlay", color: "#f59e0b" },
  { id: "wma20", label: "WMA 20", description: "Weighted moving average", color: "#38bdf8" },
  { id: "dema20", label: "DEMA 20", description: "Double exponential average", color: "#2dd4bf" },
  { id: "tema20", label: "TEMA 20", description: "Triple exponential average", color: "#34d399" },
  { id: "hma20", label: "HMA 20", description: "Hull moving average", color: "#fbbf24" },
  { id: "sma200", label: "SMA 200", description: "Higher timeframe bias", color: "#a78bfa" },
  { id: "vwap", label: "VWAP", description: "Session fair value", color: "#22c55e" },
  { id: "bb20", label: "Bollinger 20", description: "Volatility envelope", color: "#94a3b8" },
  { id: "donchian20", label: "Donchian 20", description: "Range channel", color: "#60a5fa" },
  { id: "keltner20", label: "Keltner 20", description: "ATR volatility channel", color: "#fb923c" },
  { id: "supertrend10", label: "SuperTrend 10", description: "ATR trend overlay", color: "#84cc16" },
  { id: "atr14", label: "ATR 14", description: "Average true range pane", color: "#f97316" },
  { id: "momentum10", label: "Momentum 10", description: "Close-to-close momentum pane", color: "#c084fc" },
  { id: "rsi14", label: "RSI 14", description: "Momentum pane", color: "#f472b6" },
  { id: "macd", label: "MACD", description: "Trend momentum pane", color: "#60a5fa" },
];

export const DEFAULT_INDICATOR_SETTINGS: IndicatorSettingsMap = {
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
  macd: {
    color: "#60a5fa",
    period: 12,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    signalColor: "#f59e0b",
    histogramColor: "#94a3b8",
  },
  sma200: { color: "#a78bfa", period: 200 },
  supertrend10: { color: "#84cc16", period: 10, stdDev: 3 },
  tema20: { color: "#34d399", period: 20 },
  vwap: { color: "#22c55e", period: 1 },
  wma20: { color: "#38bdf8", period: 20 },
};

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
  activeIndicators: ChartIndicatorId[],
  settings: IndicatorSettingsMap = DEFAULT_INDICATOR_SETTINGS,
): IndicatorDefinition[] {
  const definitions: IndicatorDefinition[] = [];
  const has = (id: ChartIndicatorId) => activeIndicators.includes(id);

  if (has("ema20")) {
    const config = settings.ema20;
    definitions.push({
      id: "ema20",
      label: `EMA ${config.period}`,
      color: config.color,
      data: emaSeries(bars, config.period),
      lineWidth: 2,
    });
  }

  if (has("ema50")) {
    const config = settings.ema50;
    definitions.push({
      id: "ema50",
      label: `EMA ${config.period}`,
      color: config.color,
      data: emaSeries(bars, config.period),
      lineWidth: 2,
    });
  }

  if (has("wma20")) {
    const config = settings.wma20;
    definitions.push({
      id: "wma20",
      label: `WMA ${config.period}`,
      color: config.color,
      data: wmaSeries(bars, config.period),
      lineWidth: 2,
    });
  }

  if (has("dema20")) {
    const config = settings.dema20;
    definitions.push({
      id: "dema20",
      label: `DEMA ${config.period}`,
      color: config.color,
      data: demaSeries(bars, config.period),
      lineWidth: 2,
    });
  }

  if (has("tema20")) {
    const config = settings.tema20;
    definitions.push({
      id: "tema20",
      label: `TEMA ${config.period}`,
      color: config.color,
      data: temaSeries(bars, config.period),
      lineWidth: 2,
    });
  }

  if (has("hma20")) {
    const config = settings.hma20;
    definitions.push({
      id: "hma20",
      label: `HMA ${config.period}`,
      color: config.color,
      data: hmaSeries(bars, config.period),
      lineWidth: 2,
    });
  }

  if (has("sma200")) {
    const config = settings.sma200;
    definitions.push({
      id: "sma200",
      label: `SMA ${config.period}`,
      color: config.color,
      data: smaSeries(bars, config.period),
      lineWidth: 2,
    });
  }

  if (has("vwap")) {
    const config = settings.vwap;
    definitions.push({
      id: "vwap",
      label: "VWAP",
      color: config.color,
      data: vwapSeries(bars),
      lineWidth: 2,
      lineStyle: 2,
    });
  }

  if (has("bb20")) {
    const config = settings.bb20;
    const bands = bollingerBands(bars, config.period, config.stdDev ?? 2);
    definitions.push(
      {
        id: "bb20-upper",
        label: `BB ${config.period} Upper`,
        color: config.color,
        data: bands.map((band) => ({ time: band.time, value: band.upper })),
        lineWidth: 1,
        lineStyle: 2,
      },
      {
        id: "bb20-mid",
        label: `BB ${config.period} Mid`,
        color: config.color,
        data: bands.map((band) => ({ time: band.time, value: band.middle })),
        lineWidth: 1,
        lineStyle: 2,
      },
      {
        id: "bb20-lower",
        label: `BB ${config.period} Lower`,
        color: config.color,
        data: bands.map((band) => ({ time: band.time, value: band.lower })),
        lineWidth: 1,
        lineStyle: 2,
      },
    );
  }

  if (has("donchian20")) {
    const config = settings.donchian20;
    const channel = donchianChannel(bars, config.period);
    definitions.push(
      {
        id: "donchian20-upper",
        label: `DC ${config.period} High`,
        color: config.color,
        data: channel.map((band) => ({ time: band.time, value: band.upper })),
        lineWidth: 1,
        lineStyle: 2,
      },
      {
        id: "donchian20-mid",
        label: `DC ${config.period} Mid`,
        color: config.color,
        data: channel.map((band) => ({ time: band.time, value: band.middle })),
        lineWidth: 1,
        lineStyle: 2,
      },
      {
        id: "donchian20-lower",
        label: `DC ${config.period} Low`,
        color: config.color,
        data: channel.map((band) => ({ time: band.time, value: band.lower })),
        lineWidth: 1,
        lineStyle: 2,
      },
    );
  }

  if (has("keltner20")) {
    const config = settings.keltner20;
    const channel = keltnerChannel(bars, config.period, config.stdDev ?? 2);
    definitions.push(
      {
        id: "keltner20-upper",
        label: `KC ${config.period} Upper`,
        color: config.color,
        data: channel.map((band) => ({ time: band.time, value: band.upper })),
        lineWidth: 1,
        lineStyle: 2,
      },
      {
        id: "keltner20-mid",
        label: `KC ${config.period} Mid`,
        color: config.color,
        data: channel.map((band) => ({ time: band.time, value: band.middle })),
        lineWidth: 1,
      },
      {
        id: "keltner20-lower",
        label: `KC ${config.period} Lower`,
        color: config.color,
        data: channel.map((band) => ({ time: band.time, value: band.lower })),
        lineWidth: 1,
        lineStyle: 2,
      },
    );
  }

  if (has("supertrend10")) {
    const config = settings.supertrend10;
    definitions.push({
      id: "supertrend10",
      label: `SuperTrend ${config.period}`,
      color: config.color,
      data: superTrendSeries(bars, config.period, config.stdDev ?? 3),
      lineWidth: 2,
      lineStyle: 1,
    });
  }

  return definitions;
}

export function mergeIndicatorSettings(
  settings?: Partial<Record<ChartIndicatorId, Partial<IndicatorSettings>>> | null,
): IndicatorSettingsMap {
  return {
    atr14: { ...DEFAULT_INDICATOR_SETTINGS.atr14, ...settings?.atr14 },
    bb20: { ...DEFAULT_INDICATOR_SETTINGS.bb20, ...settings?.bb20 },
    dema20: { ...DEFAULT_INDICATOR_SETTINGS.dema20, ...settings?.dema20 },
    donchian20: { ...DEFAULT_INDICATOR_SETTINGS.donchian20, ...settings?.donchian20 },
    ema20: { ...DEFAULT_INDICATOR_SETTINGS.ema20, ...settings?.ema20 },
    ema50: { ...DEFAULT_INDICATOR_SETTINGS.ema50, ...settings?.ema50 },
    hma20: { ...DEFAULT_INDICATOR_SETTINGS.hma20, ...settings?.hma20 },
    keltner20: { ...DEFAULT_INDICATOR_SETTINGS.keltner20, ...settings?.keltner20 },
    momentum10: { ...DEFAULT_INDICATOR_SETTINGS.momentum10, ...settings?.momentum10 },
    rsi14: { ...DEFAULT_INDICATOR_SETTINGS.rsi14, ...settings?.rsi14 },
    macd: { ...DEFAULT_INDICATOR_SETTINGS.macd, ...settings?.macd },
    sma200: { ...DEFAULT_INDICATOR_SETTINGS.sma200, ...settings?.sma200 },
    supertrend10: { ...DEFAULT_INDICATOR_SETTINGS.supertrend10, ...settings?.supertrend10 },
    tema20: { ...DEFAULT_INDICATOR_SETTINGS.tema20, ...settings?.tema20 },
    vwap: { ...DEFAULT_INDICATOR_SETTINGS.vwap, ...settings?.vwap },
    wma20: { ...DEFAULT_INDICATOR_SETTINGS.wma20, ...settings?.wma20 },
  };
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
