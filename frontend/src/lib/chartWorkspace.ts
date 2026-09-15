import type { Candle, DatasetCatalog } from "./api";
import type { ChartDrawing, ChartStyle, ChartTimeframe } from "./charting";

export type ChartAssetClass =
  | "crypto"
  | "equity"
  | "etf"
  | "forex"
  | "index"
  | "commodity"
  | "future"
  | "derivative"
  | "other";

export type ChartSymbolOption = {
  assetClass: ChartAssetClass;
  canonical: string;
  id: string;
  label: string;
  name: string;
  source: "dataset" | "session";
  sourceId: string | null;
  symbol: string;
  timeframes: ChartTimeframe[];
};

export type DrawingMappingPolicy = "same-symbol-timeframe" | "time-price";

export type ChartSyncSettings = {
  crosshair: boolean;
  drawings: boolean;
  drawingMappingPolicy: DrawingMappingPolicy;
  interval: boolean;
  style: boolean;
  symbol: boolean;
  visibleRange: boolean;
};

export const DEFAULT_CHART_SYNC_SETTINGS: ChartSyncSettings = {
  crosshair: true,
  drawings: false,
  drawingMappingPolicy: "same-symbol-timeframe",
  interval: false,
  style: false,
  symbol: false,
  visibleRange: true,
};

export type SyncedChartCrosshair = {
  price: number | null;
  revision: number;
  sourcePaneId: string;
  time: number | null;
};

export type SyncedChartVisibleRange = {
  from: number;
  revision: number;
  sourcePaneId: string;
  to: number;
};

export type ChartDataContinuity = {
  duplicateCount: number;
  gapCount: number;
  invalidCount: number;
  lastTime: number | null;
  missingBars: number;
  outOfOrderCount: number;
  status: "empty" | "healthy" | "gapped" | "stale";
};

export type NormalizedChartData = {
  bars: Candle[];
  continuity: ChartDataContinuity;
};

export type ChartPaneIdentity = {
  id: string;
  symbol: string;
  timeframe: ChartTimeframe;
  chartStyle?: ChartStyle;
};

export function normalizeChartSymbol(value: unknown) {
  if (typeof value !== "string") return "";
  const upper = value.trim().toUpperCase();
  const venueSeparator = upper.lastIndexOf(":");
  const symbol = venueSeparator >= 0 ? upper.slice(venueSeparator + 1) : upper;
  return symbol.replace(/[^A-Z0-9]/g, "").slice(0, 48);
}

export function chartSymbolsEqual(left: unknown, right: unknown) {
  const leftKey = normalizeChartSymbol(left);
  return leftKey.length > 0 && leftKey === normalizeChartSymbol(right);
}

export function buildChartSymbolUniverse(
  catalog: DatasetCatalog | null | undefined,
  currentSymbol?: string | null,
): ChartSymbolOption[] {
  const candidates: ChartSymbolOption[] = [];
  if (currentSymbol?.trim()) {
    candidates.push(makeSymbolOption({
      id: `session:${normalizeChartSymbol(currentSymbol)}`,
      name: currentSymbol,
      source: "session",
      sourceId: null,
      symbol: currentSymbol,
      timeframes: [],
    }));
  }
  for (const instrument of catalog?.instruments ?? []) {
    candidates.push(makeSymbolOption({
      id: `dataset:${instrument.id}`,
      name: instrument.name,
      source: "dataset",
      sourceId: instrument.id,
      symbol: instrument.symbol,
      timeframes: instrument.timeframes
        .map((item) => normalizeTimeframe(item.timeframe))
        .filter((item): item is ChartTimeframe => item != null),
    }));
  }

  const byCanonical = new Map<string, ChartSymbolOption>();
  for (const option of candidates) {
    const existing = byCanonical.get(option.canonical);
    if (!existing || (existing.source === "session" && option.source === "dataset")) {
      byCanonical.set(option.canonical, option);
    }
  }
  return [...byCanonical.values()].sort((left, right) =>
    left.label.localeCompare(right.label) || left.name.localeCompare(right.name),
  );
}

export function searchChartSymbols(options: ChartSymbolOption[], query: string, limit = 12) {
  const needle = query.trim().toLowerCase();
  const ranked = options.flatMap((option) => {
    if (!needle) return [{ option, score: option.source === "session" ? -1 : 3 }];
    const fields = [option.symbol, option.label, option.name, option.assetClass, option.canonical]
      .map((value) => value.toLowerCase());
    const exact = fields.some((field) => field === needle);
    const prefix = fields.some((field) => field.startsWith(needle));
    const includes = fields.some((field) => field.includes(needle));
    return includes ? [{ option, score: exact ? 0 : prefix ? 1 : 2 }] : [];
  });
  return ranked
    .sort((left, right) =>
      left.score - right.score || left.option.label.localeCompare(right.option.label),
    )
    .slice(0, Math.max(1, limit))
    .map(({ option }) => option);
}

export function chartSymbolTypeaheadQuery(event: {
  altKey?: boolean;
  ctrlKey?: boolean;
  key: string;
  metaKey?: boolean;
}) {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === "/") return "";
  if (event.key.length !== 1 || !/^[a-z]$/i.test(event.key)) return null;
  return /^[bshvtrflm]$/i.test(event.key) ? null : event.key;
}

export function sanitizeChartSyncSettings(value: unknown): ChartSyncSettings {
  const candidate = isRecord(value) ? value : {};
  return {
    crosshair: candidate.crosshair !== false,
    drawings: candidate.drawings === true,
    drawingMappingPolicy:
      candidate.drawingMappingPolicy === "time-price"
        ? "time-price"
        : "same-symbol-timeframe",
    interval: candidate.interval === true,
    style: candidate.style === true,
    symbol: candidate.symbol === true,
    visibleRange: candidate.visibleRange !== false,
  };
}

export function shouldMapDrawingToPane(
  policy: DrawingMappingPolicy,
  source: ChartPaneIdentity,
  target: ChartPaneIdentity,
) {
  if (source.id === target.id) return true;
  if (policy === "time-price") return true;
  return (
    chartSymbolsEqual(source.symbol, target.symbol) &&
    source.timeframe === target.timeframe
  );
}

export function mapDrawingToPane(drawing: ChartDrawing, paneId: string): ChartDrawing {
  const syncKey = drawing.syncKey?.trim() || drawing.id;
  return {
    ...drawing,
    id: drawing.id.endsWith(`:${paneId}`) ? drawing.id : `${syncKey}:${paneId}`,
    points: drawing.points.map((point) => ({ ...point })),
    fibLevels: drawing.fibLevels?.map((level) => ({ ...level })),
    syncKey,
  };
}

export function normalizeChartCandles(
  source: Candle[],
  expectedSeconds: number,
  options: { live?: boolean; nowSeconds?: number; staleAfterBars?: number } = {},
): NormalizedChartData {
  const valid: Array<{ bar: Candle; originalIndex: number }> = [];
  let invalidCount = 0;
  let outOfOrderCount = 0;
  let previousTime = Number.NEGATIVE_INFINITY;

  source.forEach((bar, originalIndex) => {
    const time = normalizeEpochSeconds(bar.time, bar.timestamp);
    if (
      time == null ||
      ![bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)
    ) {
      invalidCount += 1;
      return;
    }
    if (time < previousTime) outOfOrderCount += 1;
    previousTime = time;
    valid.push({
      originalIndex,
      bar: {
        ...bar,
        time,
        timestamp: new Date(time * 1000).toISOString(),
      },
    });
  });

  const latestByTime = new Map<number, { bar: Candle; originalIndex: number }>();
  valid.forEach((item) => latestByTime.set(item.bar.time, item));
  const duplicateCount = valid.length - latestByTime.size;
  const bars = [...latestByTime.values()]
    .sort((left, right) => left.bar.time - right.bar.time || left.originalIndex - right.originalIndex)
    .map(({ bar }) => bar);

  const interval = Math.max(1, Math.round(expectedSeconds));
  let gapCount = 0;
  let missingBars = 0;
  for (let index = 1; index < bars.length; index += 1) {
    const delta = bars[index].time - bars[index - 1].time;
    if (delta > interval * 1.5) {
      gapCount += 1;
      missingBars += Math.max(1, Math.round(delta / interval) - 1);
    }
  }
  const lastTime = bars.at(-1)?.time ?? null;
  const nowSeconds = options.nowSeconds ?? Date.now() / 1000;
  const stale =
    options.live === true &&
    lastTime != null &&
    nowSeconds - lastTime > interval * Math.max(2, options.staleAfterBars ?? 3);
  const status =
    bars.length === 0 ? "empty" : stale ? "stale" : gapCount > 0 ? "gapped" : "healthy";

  return {
    bars,
    continuity: {
      duplicateCount,
      gapCount,
      invalidCount,
      lastTime,
      missingBars,
      outOfOrderCount,
      status,
    },
  };
}

export function nextWorkspaceRevision(
  currentRevision: number,
  expectedRevision: number,
) {
  const current = positiveInteger(currentRevision);
  const expected = positiveInteger(expectedRevision);
  return {
    conflict: expected < current,
    revision: Math.max(current, expected) + 1,
  };
}

function makeSymbolOption(source: {
  id: string;
  name: string;
  source: ChartSymbolOption["source"];
  sourceId: string | null;
  symbol: string;
  timeframes: ChartTimeframe[];
}): ChartSymbolOption {
  const canonical = normalizeChartSymbol(source.symbol) || "MARKET";
  const symbol = source.symbol.trim().toUpperCase().slice(0, 48) || canonical;
  return {
    ...source,
    assetClass: inferAssetClass(symbol, source.name),
    canonical,
    label: symbol,
    name: source.name.trim().slice(0, 80) || symbol,
    symbol,
    timeframes: [...new Set(source.timeframes)],
  };
}

function inferAssetClass(symbol: string, name: string): ChartAssetClass {
  const key = `${symbol} ${name}`.toUpperCase();
  if (/\b(OPTION|CALL|PUT)\b|\d{6}[CP]\d+/.test(key)) return "derivative";
  if (/USDT|USDC|BTC|ETH|CRYPTO/.test(key)) return "crypto";
  if (/\b(FUTURE|FUTURES|CONTINUOUS|PERPETUAL)\b|[FGHJKMNQUVXZ]\d{1,2}$/.test(key)) return "future";
  if (/\b(ETF|FUND)\b/.test(key)) return "etf";
  if (/\b(INDEX|NIFTY|S&P|NASDAQ|DOW|DAX|FTSE)\b/.test(key)) return "index";
  if (/\b(GOLD|SILVER|OIL|COPPER|COMMODITY)\b|XAU|XAG/.test(key)) return "commodity";
  if (/^[A-Z]{6}$/.test(normalizeChartSymbol(symbol))) return "forex";
  if (/^[A-Z][A-Z0-9.:-]{0,11}$/.test(symbol)) return "equity";
  return "other";
}

function normalizeTimeframe(value: unknown): ChartTimeframe | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d+)(m|h|d|w|M)$/i);
  if (!match) return null;
  const unit = match[2] === "m" || match[2] === "M" ? match[2] : match[2].toUpperCase();
  return `${Math.max(1, Number.parseInt(match[1], 10))}${unit}` as ChartTimeframe;
}

function normalizeEpochSeconds(time: unknown, timestamp: unknown) {
  let numeric = typeof time === "number" && Number.isFinite(time) ? time : Number.NaN;
  if (Number.isFinite(numeric)) {
    if (Math.abs(numeric) >= 1e14) numeric /= 1_000_000;
    else if (Math.abs(numeric) >= 1e11) numeric /= 1_000;
    numeric = Math.round(numeric);
    if (Math.abs(numeric) < 1e10) return numeric;
  }
  if (typeof timestamp !== "string") return null;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? Math.round(parsed / 1000) : null;
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}
