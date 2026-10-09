import type { Candle } from "./api";
import { binanceChartSymbolMatches } from "./pineInstrumentContext";
import { pineFeedNextSourceTime, type PineLiveFeed } from "./pineLiveFeed";
import type { PineMarketDataScope } from "./pineMarketDataResolver";

/** The capability comes from the actual Binance feed, never from a script's ticker text. */
export function pineMarketScopeForFeed(feed: PineLiveFeed | undefined, bars: readonly Candle[], symbol: string,
  timeframe: string, revision: string, owns: () => boolean): PineMarketDataScope | undefined {
  if (!feed || !bars.length) return undefined;
  const snapshot = feed.getSnapshot(), epoch = snapshot.epoch;
  if (snapshot.error || !binanceChartSymbolMatches(symbol, snapshot.symbol)) return undefined;
  const asOf = Math.min(Math.floor(Date.now() / 1000), pineFeedNextSourceTime(bars.at(-1)!.time, timeframe));
  if (asOf <= bars.at(-1)!.time) return undefined;
  return { provider: "binance", chartSymbol: snapshot.symbol, revision,
    range: { from: bars[0].time, to: asOf - 1 }, asOf,
    owns: () => owns() && feed.getSnapshot().epoch === epoch && feed.getSnapshot().symbol === snapshot.symbol && !feed.getSnapshot().error };
}
