import { binanceChartPlan, type BinanceChartPlan } from "./binanceChartFeed";
import { TIMEFRAMES, type ChartTimeframe } from "./charting";
import type { ChartSymbolOption } from "./chartWorkspace";
import { journalFocusMatchesSymbol } from "./journalChartFocus";
import { binanceChartSymbolMatches } from "./pineInstrumentContext";

type BinanceCatalogPair = { symbol: string; status: string; assetClass: string; label: string; description: string };
type Pane = { id: string; symbol: string; timeframe: ChartTimeframe };
export type BinancePaneRoute = Pane & { focused: boolean; primary: boolean; marketKey: string; plan: BinanceChartPlan | null };

function tradingPair(pair: BinanceCatalogPair) {
  return pair.status === "TRADING" && pair.assetClass === "crypto" && /^[A-Z0-9]{1,40}$/.test(pair.symbol);
}

/** Route only explicitly matched Binance pairs; exchange prefixes keep their identity. */
export function planBinancePaneRoutes(panes: Pane[], catalog: readonly BinanceCatalogPair[], primary: {
  symbol: string; provider?: string;
}, focusSymbol?: string | null): BinancePaneRoute[] {
  const pairs = catalog.filter(tradingPair);
  return panes.map(pane => {
    const chartSymbol = pane.symbol || primary.symbol;
    const focused = Boolean(focusSymbol && journalFocusMatchesSymbol(chartSymbol, focusSymbol));
    const matchesPrimary = primary.provider === "binance"
      ? binanceChartSymbolMatches(chartSymbol, primary.symbol)
      : !/^BINANCE:/i.test(chartSymbol.trim()) && journalFocusMatchesSymbol(chartSymbol, primary.symbol);
    const isPrimary = !focused && matchesPrimary;
    const pair = pairs.find(pair => binanceChartSymbolMatches(chartSymbol, pair.symbol));
    // The existing primary feed also owns catalog pairs added after the cached catalog.
    const providerSymbol = pair?.symbol ?? (isPrimary && primary.provider === "binance"
      && /^[A-Z0-9]{1,40}$/.test(primary.symbol) ? primary.symbol : null);
    const useNative = !focused && providerSymbol !== null
      && !(isPrimary && (primary.provider !== "binance" || pane.timeframe === "1m"));
    const symbol = providerSymbol ?? (focused ? chartSymbol.replace(/^BINANCE:/i, "") : chartSymbol);
    const provider = matchesPrimary && primary.provider !== "binance" ? primary.provider?.toUpperCase()
      : providerSymbol ? "BINANCE" : null;
    return { ...pane, symbol, focused, primary: isPrimary, marketKey: provider ? `${provider}:${symbol}` : symbol.toUpperCase(),
      plan: useNative ? binanceChartPlan(pane.timeframe) : null };
  });
}

export function binanceChartSymbolOptions(catalog: readonly BinanceCatalogPair[]): ChartSymbolOption[] {
  return catalog.filter(tradingPair).map(pair => ({ assetClass: "crypto", canonical: pair.symbol,
    id: `binance-${pair.symbol}`, label: pair.label, name: `Binance · ${pair.description}`, source: "live",
    sourceId: null, symbol: `BINANCE:${pair.symbol}`, timeframes: TIMEFRAMES.map(frame => frame.id) }));
}
