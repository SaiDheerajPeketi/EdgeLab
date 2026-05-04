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
  | "ema20"
  | "ema50"
  | "sma200"
  | "vwap"
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
  time: number;
  price: number;
};

export type ChartDrawing = {
  id: string;
  tool: Exclude<DrawingTool, "cursor" | "crosshair">;
  color: string;
  points: DrawingPoint[];
  label?: string;
  createdAt: string;
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
  { id: "sma200", label: "SMA 200", description: "Higher timeframe bias", color: "#a78bfa" },
  { id: "vwap", label: "VWAP", description: "Session fair value", color: "#22c55e" },
  { id: "bb20", label: "Bollinger 20", description: "Volatility envelope", color: "#94a3b8" },
  { id: "rsi14", label: "RSI 14", description: "Momentum pane", color: "#f472b6" },
  { id: "macd", label: "MACD", description: "Trend momentum pane", color: "#60a5fa" },
];

export const DEFAULT_INDICATOR_SETTINGS: IndicatorSettingsMap = {
  bb20: { color: "#94a3b8", period: 20, stdDev: 2 },
  ema20: { color: "#32d3ee", period: 20 },
  ema50: { color: "#f59e0b", period: 50 },
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
  vwap: { color: "#22c55e", period: 1 },
};

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

  return definitions;
}

export function mergeIndicatorSettings(
  settings?: Partial<Record<ChartIndicatorId, Partial<IndicatorSettings>>> | null,
): IndicatorSettingsMap {
  return {
    bb20: { ...DEFAULT_INDICATOR_SETTINGS.bb20, ...settings?.bb20 },
    ema20: { ...DEFAULT_INDICATOR_SETTINGS.ema20, ...settings?.ema20 },
    ema50: { ...DEFAULT_INDICATOR_SETTINGS.ema50, ...settings?.ema50 },
    rsi14: { ...DEFAULT_INDICATOR_SETTINGS.rsi14, ...settings?.rsi14 },
    macd: { ...DEFAULT_INDICATOR_SETTINGS.macd, ...settings?.macd },
    sma200: { ...DEFAULT_INDICATOR_SETTINGS.sma200, ...settings?.sma200 },
    vwap: { ...DEFAULT_INDICATOR_SETTINGS.vwap, ...settings?.vwap },
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
