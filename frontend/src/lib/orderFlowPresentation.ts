export type OrderFlowDisplayMode =
  | "bid-ask"
  | "volume-profile"
  | "delta-profile"
  | "absolute-delta";

export type OrderFlowAlignment = "left" | "center" | "right";
export type OrderFlowStatsMetric = "volume" | "delta" | "trades" | "average-size";
export type OrderFlowTemplateId = "classic" | "delta" | "high-contrast";

export type OrderFlowLevelAggregate = {
  askVolume: number;
  averageTradeSize: number;
  bidVolume: number;
  delta: number;
  price: number;
  totalVolume: number;
  tradeCount: number;
  unknownVolume: number;
};

export type OrderFlowBarAggregate = {
  askVolume: number;
  averageTradeSize: number;
  bidVolume: number;
  delta: number;
  levels: OrderFlowLevelAggregate[];
  tickSize: number;
  time: number;
  totalVolume: number;
  tradeCount: number;
  unknownVolume: number;
};

export type OrderFlowAvailability = {
  detail: string;
  status: "available" | "partial" | "insufficient" | "unavailable";
};

export type OrderFlowImbalanceAnalysis = {
  buyPrices: number[];
  sellPrices: number[];
  stackedBuyPrices: number[];
  stackedSellPrices: number[];
  unfinishedHigh: boolean;
  unfinishedLow: boolean;
};

export type MarketProfileRow = {
  delta: number;
  inValueArea: boolean;
  isPointOfControl: boolean;
  letters: string;
  price: number;
  tpoCount: number;
  volume: number;
};

export type MarketProfile = {
  pointOfControl: number | null;
  rows: MarketProfileRow[];
  valueAreaHigh: number | null;
  valueAreaLow: number | null;
};

export const ORDER_FLOW_COLOR_TEMPLATES: ReadonlyArray<{
  askColor: string;
  bidColor: string;
  id: OrderFlowTemplateId;
  label: string;
  mode: OrderFlowDisplayMode;
  neutralColor: string;
}> = [
  {
    askColor: "#22C55E",
    bidColor: "#EF4444",
    id: "classic",
    label: "Classic bid / ask",
    mode: "bid-ask",
    neutralColor: "#94A3B8",
  },
  {
    askColor: "#38BDF8",
    bidColor: "#F97316",
    id: "delta",
    label: "Delta profile",
    mode: "delta-profile",
    neutralColor: "#64748B",
  },
  {
    askColor: "#67E8F9",
    bidColor: "#FB7185",
    id: "high-contrast",
    label: "High contrast",
    mode: "bid-ask",
    neutralColor: "#E2E8F0",
  },
] as const;

export function sanitizeOrderFlowDisplayMode(value: unknown): OrderFlowDisplayMode {
  return value === "volume-profile" ||
    value === "delta-profile" ||
    value === "absolute-delta"
    ? value
    : "bid-ask";
}

export function sanitizeOrderFlowAlignment(value: unknown): OrderFlowAlignment {
  return value === "left" || value === "right" ? value : "center";
}

export function sanitizeOrderFlowStatsMetric(value: unknown): OrderFlowStatsMetric {
  return value === "delta" || value === "trades" || value === "average-size"
    ? value
    : "volume";
}

export function sanitizeOrderFlowTemplateId(value: unknown): OrderFlowTemplateId {
  return value === "delta" || value === "high-contrast" ? value : "classic";
}

export function orderFlowColorTemplate(id: OrderFlowTemplateId) {
  return (
    ORDER_FLOW_COLOR_TEMPLATES.find((template) => template.id === id) ??
    ORDER_FLOW_COLOR_TEMPLATES[0]
  );
}

export function readOrderFlowSeries(bars: readonly unknown[]): OrderFlowBarAggregate[] {
  return bars.flatMap((bar) => {
    const record = asRecord(bar);
    if (!record) {
      return [];
    }
    const embedded = asRecord(record.order_flow ?? record.orderFlow ?? record.footprint);
    if (!embedded) {
      return [];
    }
    const normalized = normalizeOrderFlowBar(embedded, finiteNumber(record.time));
    return normalized ? [normalized] : [];
  });
}

export function normalizeOrderFlowBar(
  value: unknown,
  fallbackTime: number | null = null,
): OrderFlowBarAggregate | null {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.levels)) {
    return null;
  }
  const time =
    finiteNumber(record.time) ??
    epochSeconds(record.start ?? record.start_time ?? record.startTime) ??
    fallbackTime;
  if (time == null) {
    return null;
  }
  const levels = record.levels
    .flatMap((level) => {
      const normalized = normalizeOrderFlowLevel(level);
      return normalized ? [normalized] : [];
    })
    .sort((left, right) => left.price - right.price);
  if (levels.length === 0) {
    return null;
  }
  const sums = sumOrderFlowLevels(levels);
  const bidVolume = nonNegativeNumber(record.bid_volume ?? record.bidVolume) ?? sums.bidVolume;
  const askVolume = nonNegativeNumber(record.ask_volume ?? record.askVolume) ?? sums.askVolume;
  const unknownVolume =
    nonNegativeNumber(record.unknown_volume ?? record.unknownVolume) ?? sums.unknownVolume;
  const totalVolume =
    nonNegativeNumber(record.total_volume ?? record.totalVolume) ?? sums.totalVolume;
  const tradeCount =
    nonNegativeInteger(record.trade_count ?? record.tradeCount) ?? sums.tradeCount;
  const averageTradeSize =
    nonNegativeNumber(record.average_trade_size ?? record.averageTradeSize) ??
    (tradeCount > 0 ? totalVolume / tradeCount : 0);
  const tickSize =
    positiveNumber(record.tick_size ?? record.tickSize) ?? inferTickSize(levels);
  return {
    askVolume,
    averageTradeSize,
    bidVolume,
    delta: finiteNumber(record.delta) ?? askVolume - bidVolume,
    levels,
    tickSize,
    time,
    totalVolume,
    tradeCount,
    unknownVolume,
  };
}

export function aggregateOrderFlowBars(
  bars: readonly OrderFlowBarAggregate[],
  bucketForTime: (time: number) => number,
): OrderFlowBarAggregate[] {
  const grouped = new Map<number, OrderFlowBarAggregate[]>();
  for (const bar of bars) {
    const bucket = bucketForTime(bar.time);
    if (!Number.isFinite(bucket)) {
      continue;
    }
    const existing = grouped.get(bucket) ?? [];
    existing.push(bar);
    grouped.set(bucket, existing);
  }
  return Array.from(grouped.entries())
    .sort(([left], [right]) => left - right)
    .map(([time, source]) => mergeOrderFlowBars(time, source));
}

export function resolveOrderFlowAvailability(
  sourceBarCount: number,
  bars: readonly OrderFlowBarAggregate[],
): OrderFlowAvailability {
  if (bars.length === 0) {
    return {
      detail:
        "This source provides OHLCV candles only. Connect aggressor-side trades to render footprint or TPO data; EdgeLab will not infer bid/ask volume from candle direction.",
      status: "unavailable",
    };
  }
  const knownVolume = bars.reduce(
    (total, bar) => total + bar.bidVolume + bar.askVolume,
    0,
  );
  const unknownVolume = bars.reduce((total, bar) => total + bar.unknownVolume, 0);
  if (knownVolume <= 0 && unknownVolume > 0) {
    return {
      detail:
        "Trade volume is present, but aggressor side is missing. Bid/ask, delta, and imbalance views stay unavailable rather than guessing sides.",
      status: "insufficient",
    };
  }
  if (sourceBarCount > 0 && bars.length < sourceBarCount) {
    return {
      detail: `${bars.length} of ${sourceBarCount} source bars include order-flow aggregates. Missing bars remain blank.`,
      status: "partial",
    };
  }
  return {
    detail:
      unknownVolume > 0
        ? "Aggressor-side aggregates are available; unknown-side volume is preserved separately."
        : "Aggressor-side aggregates are available for every source bar.",
    status: "available",
  };
}

export function analyzeOrderFlowBar(
  bar: OrderFlowBarAggregate,
  ratioThreshold: number,
  stackedCount: number,
): OrderFlowImbalanceAnalysis {
  const levels = [...bar.levels].sort((left, right) => left.price - right.price);
  const threshold = clamp(ratioThreshold, 1.1, 100);
  const requiredStack = Math.round(clamp(stackedCount, 2, 10));
  const buyPrices: number[] = [];
  const sellPrices: number[] = [];

  for (let index = 0; index < levels.length; index += 1) {
    const level = levels[index];
    const lowerBid = levels[index - 1]?.bidVolume ?? 0;
    const upperAsk = levels[index + 1]?.askVolume ?? 0;
    if (lowerBid > 0 && level.askVolume / lowerBid >= threshold) {
      buyPrices.push(level.price);
    }
    if (upperAsk > 0 && level.bidVolume / upperAsk >= threshold) {
      sellPrices.push(level.price);
    }
  }

  const high = levels.at(-1);
  const low = levels[0];
  return {
    buyPrices,
    sellPrices,
    stackedBuyPrices: stackedPrices(buyPrices, bar.tickSize, requiredStack),
    stackedSellPrices: stackedPrices(sellPrices, bar.tickSize, requiredStack),
    unfinishedHigh: (high?.bidVolume ?? 0) > 0,
    unfinishedLow: (low?.askVolume ?? 0) > 0,
  };
}

export function buildOrderFlowIndicatorSeries(
  bars: readonly OrderFlowBarAggregate[],
  kind: "bar-delta" | "cumulative-delta" | "order-flow-imbalance",
  ratioThreshold = 3,
): Array<{ time: number; value: number }> {
  let cumulativeDelta = 0;
  return bars.map((bar) => {
    cumulativeDelta += bar.delta;
    if (kind === "cumulative-delta") {
      return { time: bar.time, value: cumulativeDelta };
    }
    if (kind === "order-flow-imbalance") {
      const analysis = analyzeOrderFlowBar(bar, ratioThreshold, 2);
      return {
        time: bar.time,
        value: analysis.buyPrices.length - analysis.sellPrices.length,
      };
    }
    return { time: bar.time, value: bar.delta };
  });
}

export function buildMarketProfile(
  bars: readonly OrderFlowBarAggregate[],
  bracketMinutes: number,
  valueAreaPercent: number,
): MarketProfile {
  if (bars.length === 0) {
    return { pointOfControl: null, rows: [], valueAreaHigh: null, valueAreaLow: null };
  }
  const firstTime = Math.min(...bars.map((bar) => bar.time));
  const bracketSeconds = Math.max(1, Math.round(bracketMinutes)) * 60;
  const byPrice = new Map<
    number,
    { brackets: Set<number>; delta: number; volume: number }
  >();
  for (const bar of bars) {
    const bracket = Math.max(0, Math.floor((bar.time - firstTime) / bracketSeconds));
    for (const level of bar.levels) {
      const current = byPrice.get(level.price) ?? {
        brackets: new Set<number>(),
        delta: 0,
        volume: 0,
      };
      current.brackets.add(bracket);
      current.delta += level.delta;
      current.volume += level.totalVolume;
      byPrice.set(level.price, current);
    }
  }
  const provisional = Array.from(byPrice.entries()).map(([price, value]) => ({
    delta: value.delta,
    letters: Array.from(value.brackets)
      .sort((left, right) => left - right)
      .map(tpoLetter)
      .join(""),
    price,
    tpoCount: value.brackets.size,
    volume: value.volume,
  }));
  const pointOfControl = [...provisional].sort(
    (left, right) => right.tpoCount - left.tpoCount || right.volume - left.volume,
  )[0]?.price ?? null;
  const totalTpo = provisional.reduce((total, row) => total + row.tpoCount, 0);
  const targetTpo = totalTpo * clamp(valueAreaPercent, 1, 100) / 100;
  const selectedPrices = new Set<number>();
  let selectedTpo = 0;
  for (const row of [...provisional].sort(
    (left, right) => right.tpoCount - left.tpoCount || right.volume - left.volume,
  )) {
    if (selectedTpo >= targetTpo) {
      break;
    }
    selectedPrices.add(row.price);
    selectedTpo += row.tpoCount;
  }
  const valueAreaPrices = Array.from(selectedPrices);
  const valueAreaHigh = valueAreaPrices.length > 0 ? Math.max(...valueAreaPrices) : null;
  const valueAreaLow = valueAreaPrices.length > 0 ? Math.min(...valueAreaPrices) : null;
  return {
    pointOfControl,
    rows: provisional
      .sort((left, right) => right.price - left.price)
      .map((row) => ({
        ...row,
        inValueArea:
          valueAreaHigh != null &&
          valueAreaLow != null &&
          row.price >= valueAreaLow &&
          row.price <= valueAreaHigh,
        isPointOfControl: row.price === pointOfControl,
      })),
    valueAreaHigh,
    valueAreaLow,
  };
}

export function formatOrderFlowMetric(value: number) {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
    notation: Math.abs(value) >= 100_000 ? "compact" : "standard",
  }).format(value);
}

function normalizeOrderFlowLevel(value: unknown): OrderFlowLevelAggregate | null {
  const record = asRecord(value);
  const price = record ? positiveNumber(record.price) : null;
  if (!record || price == null) {
    return null;
  }
  const bidVolume = nonNegativeNumber(record.bid_volume ?? record.bidVolume) ?? 0;
  const askVolume = nonNegativeNumber(record.ask_volume ?? record.askVolume) ?? 0;
  const unknownVolume =
    nonNegativeNumber(record.unknown_volume ?? record.unknownVolume) ?? 0;
  const totalVolume =
    nonNegativeNumber(record.total_volume ?? record.totalVolume) ??
    bidVolume + askVolume + unknownVolume;
  const tradeCount = nonNegativeInteger(record.trade_count ?? record.tradeCount) ?? 0;
  return {
    askVolume,
    averageTradeSize:
      nonNegativeNumber(record.average_trade_size ?? record.averageTradeSize) ??
      (tradeCount > 0 ? totalVolume / tradeCount : 0),
    bidVolume,
    delta: finiteNumber(record.delta) ?? askVolume - bidVolume,
    price,
    totalVolume,
    tradeCount,
    unknownVolume,
  };
}

function mergeOrderFlowBars(time: number, bars: readonly OrderFlowBarAggregate[]) {
  const levels = new Map<number, OrderFlowLevelAggregate[]>();
  for (const bar of bars) {
    for (const level of bar.levels) {
      const values = levels.get(level.price) ?? [];
      values.push(level);
      levels.set(level.price, values);
    }
  }
  const mergedLevels = Array.from(levels.entries())
    .sort(([left], [right]) => left - right)
    .map(([price, values]) => mergeOrderFlowLevels(price, values));
  const sums = sumOrderFlowLevels(mergedLevels);
  return {
    askVolume: sums.askVolume,
    averageTradeSize: sums.tradeCount > 0 ? sums.totalVolume / sums.tradeCount : 0,
    bidVolume: sums.bidVolume,
    delta: sums.askVolume - sums.bidVolume,
    levels: mergedLevels,
    tickSize: Math.min(...bars.map((bar) => bar.tickSize).filter((value) => value > 0)),
    time,
    totalVolume: sums.totalVolume,
    tradeCount: sums.tradeCount,
    unknownVolume: sums.unknownVolume,
  } satisfies OrderFlowBarAggregate;
}

function mergeOrderFlowLevels(
  price: number,
  levels: readonly OrderFlowLevelAggregate[],
): OrderFlowLevelAggregate {
  const sums = sumOrderFlowLevels(levels);
  return {
    askVolume: sums.askVolume,
    averageTradeSize: sums.tradeCount > 0 ? sums.totalVolume / sums.tradeCount : 0,
    bidVolume: sums.bidVolume,
    delta: sums.askVolume - sums.bidVolume,
    price,
    totalVolume: sums.totalVolume,
    tradeCount: sums.tradeCount,
    unknownVolume: sums.unknownVolume,
  };
}

function sumOrderFlowLevels(levels: readonly OrderFlowLevelAggregate[]) {
  return levels.reduce(
    (total, level) => ({
      askVolume: total.askVolume + level.askVolume,
      bidVolume: total.bidVolume + level.bidVolume,
      totalVolume: total.totalVolume + level.totalVolume,
      tradeCount: total.tradeCount + level.tradeCount,
      unknownVolume: total.unknownVolume + level.unknownVolume,
    }),
    { askVolume: 0, bidVolume: 0, totalVolume: 0, tradeCount: 0, unknownVolume: 0 },
  );
}

function inferTickSize(levels: readonly OrderFlowLevelAggregate[]) {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < levels.length; index += 1) {
    const difference = levels[index].price - levels[index - 1].price;
    if (difference > 0) {
      minimum = Math.min(minimum, difference);
    }
  }
  return Number.isFinite(minimum) ? minimum : Math.max(levels[0]?.price * 0.0001, 0.00001);
}

function stackedPrices(prices: readonly number[], tickSize: number, required: number) {
  const sorted = [...prices].sort((left, right) => left - right);
  const result = new Set<number>();
  let run: number[] = [];
  for (const price of sorted) {
    const previous = run.at(-1);
    const adjacent =
      previous != null && Math.abs(price - previous - tickSize) <= Math.max(1e-9, tickSize * 1e-6);
    run = adjacent ? [...run, price] : [price];
    if (run.length >= required) {
      run.forEach((value) => result.add(value));
    }
  }
  return Array.from(result).sort((left, right) => left - right);
}

function tpoLetter(index: number) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  return alphabet[index % alphabet.length];
}

function epochSeconds(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? Math.abs(value) < 1_000_000_000_000
        ? value
        : value / 1000
      : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp / 1000 : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegativeNumber(value: unknown) {
  const parsed = finiteNumber(value);
  return parsed != null && parsed >= 0 ? parsed : null;
}

function positiveNumber(value: unknown) {
  const parsed = finiteNumber(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

function nonNegativeInteger(value: unknown) {
  const parsed = nonNegativeNumber(value);
  return parsed == null ? null : Math.floor(parsed);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}
