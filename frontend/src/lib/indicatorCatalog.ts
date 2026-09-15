import { INDICATORS, type ChartIndicatorKind } from "./charting";

export const INDICATOR_CATEGORY_ORDER = [
  "basic",
  "volatility",
  "momentum",
  "structure",
  "volume",
  "order-flow",
  "custom",
  "favorites",
] as const;

export type IndicatorCategoryId = (typeof INDICATOR_CATEGORY_ORDER)[number];
export type IndicatorCatalogCategory = Exclude<IndicatorCategoryId, "favorites">;
export type IndicatorCatalogFilter = "all" | IndicatorCategoryId;
export type IndicatorPreviewKind =
  | "average"
  | "bands"
  | "channel"
  | "histogram"
  | "oscillator"
  | "range"
  | "trend"
  | "volume"
  | "zones";

export type IndicatorCategoryDefinition = {
  id: IndicatorCategoryId;
  label: string;
};

export type IndicatorCatalogItem = {
  category: IndicatorCatalogCategory;
  color: string;
  description: string;
  id: ChartIndicatorKind;
  kind: ChartIndicatorKind;
  label: string;
  pane: "overlay" | "pane";
  preview: IndicatorPreviewKind;
  searchText: string;
  synonyms: readonly string[];
};

export const INDICATOR_CATEGORIES: readonly IndicatorCategoryDefinition[] = [
  { id: "basic", label: "Basic" },
  { id: "volatility", label: "Volatility" },
  { id: "momentum", label: "Momentum" },
  { id: "structure", label: "Structure" },
  { id: "volume", label: "Volume" },
  { id: "order-flow", label: "Order flow" },
  { id: "custom", label: "Custom" },
  { id: "favorites", label: "Favorites" },
];

type IndicatorMetadata = Pick<
  IndicatorCatalogItem,
  "category" | "description" | "preview" | "synonyms"
>;

const INDICATOR_METADATA = {
  atr: {
    category: "volatility",
    description: "Measures average trading range without implying direction.",
    preview: "range",
    synonyms: ["average true range", "range", "volatility"],
  },
  "bar-delta": {
    category: "order-flow",
    description: "Plots buyer-aggressor minus seller-aggressor volume for each bar.",
    preview: "histogram",
    synonyms: ["delta", "footprint delta", "bid ask", "aggressor volume"],
  },
  bb: {
    category: "volatility",
    description: "Wraps price in standard-deviation bands around an average.",
    preview: "bands",
    synonyms: ["bollinger", "bollinger bands", "standard deviation", "envelope"],
  },
  "cumulative-delta": {
    category: "order-flow",
    description: "Accumulates trade-side volume delta without inferring it from candles.",
    preview: "oscillator",
    synonyms: ["cvd", "cumulative volume delta", "order flow", "aggressor"],
  },
  custom: {
    category: "custom",
    description: "Runs a saved EdgeLab DSL study in the isolated indicator worker.",
    preview: "oscillator",
    synonyms: ["edge dsl", "user script", "custom study", "code"],
  },
  dema: {
    category: "basic",
    description: "Reduces lag by combining two exponential averages.",
    preview: "average",
    synonyms: ["double exponential moving average", "moving average", "trend"],
  },
  donchian: {
    category: "volatility",
    description: "Plots the highest high and lowest low of a rolling window.",
    preview: "channel",
    synonyms: ["donchian channel", "price channel", "breakout", "high low"],
  },
  ema: {
    category: "basic",
    description: "Weights recent prices more heavily for a responsive trend line.",
    preview: "average",
    synonyms: ["exponential moving average", "moving average", "trend"],
  },
  fvg: {
    category: "structure",
    description: "Marks three-candle price imbalances until they are mitigated.",
    preview: "zones",
    synonyms: ["fair value gap", "imbalance", "gap", "smart money"],
  },
  hma: {
    category: "basic",
    description: "Smooths price while reducing the lag of weighted averages.",
    preview: "average",
    synonyms: ["hull moving average", "moving average", "trend"],
  },
  ifvg: {
    category: "structure",
    description: "Tracks fair value gaps that flip after price invalidates them.",
    preview: "zones",
    synonyms: ["inverse fair value gap", "inversion", "flipped imbalance", "gap"],
  },
  keltner: {
    category: "volatility",
    description: "Wraps an EMA with ATR-based volatility bands.",
    preview: "bands",
    synonyms: ["keltner channel", "atr channel", "envelope", "moving average"],
  },
  macd: {
    category: "momentum",
    description: "Compares fast and slow averages with a signal and histogram.",
    preview: "histogram",
    synonyms: ["moving average convergence divergence", "signal", "histogram", "trend"],
  },
  momentum: {
    category: "momentum",
    description: "Compares the latest close with a prior close to show velocity.",
    preview: "oscillator",
    synonyms: ["price momentum", "rate of change", "roc", "velocity"],
  },
  "order-flow-imbalance": {
    category: "order-flow",
    description: "Counts diagonal bid/ask imbalances from trade-level aggregates.",
    preview: "histogram",
    synonyms: ["stacked imbalance", "bid ask ratio", "footprint", "aggressor"],
  },
  rsi: {
    category: "momentum",
    description: "Measures recent gains versus losses on a 0–100 oscillator.",
    preview: "oscillator",
    synonyms: ["relative strength index", "overbought", "oversold", "oscillator"],
  },
  sma: {
    category: "basic",
    description: "Averages prices evenly across the selected lookback period.",
    preview: "average",
    synonyms: ["simple moving average", "moving average", "mean", "trend"],
  },
  supertrend: {
    category: "structure",
    description: "Uses ATR to flip between bullish and bearish trailing levels.",
    preview: "trend",
    synonyms: ["super trend", "atr trend", "trailing stop", "direction"],
  },
  tema: {
    category: "basic",
    description: "Combines three exponential averages for a low-lag trend line.",
    preview: "average",
    synonyms: ["triple exponential moving average", "moving average", "trend"],
  },
  vwap: {
    category: "volume",
    description: "Plots the session's volume-weighted average price.",
    preview: "volume",
    synonyms: ["volume weighted average price", "session average", "fair value"],
  },
  wma: {
    category: "basic",
    description: "Gives newer prices a larger linear weight in the average.",
    preview: "average",
    synonyms: ["weighted moving average", "moving average", "trend"],
  },
} satisfies Record<ChartIndicatorKind, IndicatorMetadata>;

const CATEGORY_LABELS = new Map(
  INDICATOR_CATEGORIES.map((category) => [category.id, category.label]),
);

export const INDICATOR_CATALOG: readonly IndicatorCatalogItem[] = INDICATORS.filter(
  (indicator) => indicator.kind !== "custom",
).map(
  (indicator) => {
    const metadata = INDICATOR_METADATA[indicator.kind];
    const categoryLabel = CATEGORY_LABELS.get(metadata.category) ?? metadata.category;
    const searchText = normalizeIndicatorSearch(
      [
        indicator.id,
        indicator.label,
        metadata.description,
        metadata.category,
        categoryLabel,
        ...metadata.synonyms,
      ].join(" "),
    );
    return {
      ...indicator,
      ...metadata,
      id: indicator.kind,
      searchText,
    };
  },
);

const INDICATOR_CATALOG_BY_KIND = new Map(
  INDICATOR_CATALOG.map((indicator) => [indicator.kind, indicator]),
);

export function getIndicatorCatalogItem(kind: ChartIndicatorKind) {
  return INDICATOR_CATALOG_BY_KIND.get(kind);
}

export function getAvailableIndicatorCategories(
  _favorites: readonly ChartIndicatorKind[],
) {
  return INDICATOR_CATEGORIES;
}

export function filterIndicatorCatalog({
  category = "all",
  favorites = [],
  query = "",
}: {
  category?: IndicatorCatalogFilter;
  favorites?: readonly ChartIndicatorKind[];
  query?: string;
}) {
  const favoriteSet = new Set(favorites);
  const terms = normalizeIndicatorSearch(query).split(" ").filter(Boolean);
  return INDICATOR_CATALOG.filter((indicator) => {
    if (category === "favorites" && !favoriteSet.has(indicator.kind)) {
      return false;
    }
    if (
      category !== "all" &&
      category !== "favorites" &&
      indicator.category !== category
    ) {
      return false;
    }
    return terms.every((term) => indicator.searchText.includes(term));
  });
}

export function isSingleInstanceIndicator(kind: ChartIndicatorKind) {
  return kind === "fvg" || kind === "ifvg";
}

function normalizeIndicatorSearch(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
