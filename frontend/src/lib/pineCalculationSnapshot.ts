import type { Candle } from "./api";
import type { PineLiveMarketLedger } from "./pineLiveMarkets";
import { pineMarketSymbol, type PineMarketSnapshot } from "./pineMarketProtocol";
import { PINE_LIMITS, PineProtocolError, canonicalPineTimeframe, type PineRequest, type PineSourceSnapshot } from "./pineProtocol";
import { aggregatePineCalculationBars, pineCalculationCanAggregate, pineCalculationEnd } from "./pineCalculationTimeframe";

export type PineCalculationPrefix = Readonly<{
  initialSource: PineSourceSnapshot; snapshot: PineMarketSnapshot; bars: readonly Candle[];
}>;
export type PineCalculationSnapshot = {
  bars: readonly Candle[]; timeframe: string; authority: "chart" | "source" | "market" | "history" | "primary";
  baseTimeframe: string; boundary: number | null; confirmed: boolean; revision: number; received: boolean;
};
export type PineCalculationSnapshotInput = {
  request: Pick<PineRequest, "context" | "bars" | "sourceSnapshot" | "marketData">;
  timeframe: string; realtime: boolean; chartConfirmed: boolean; sourceConfirmed: boolean; revision: number;
  initialSource?: PineSourceSnapshot; marketLedger?: PineLiveMarketLedger; prefix?: PineCalculationPrefix;
};
function budget(bars: readonly Candle[]) {
  if (bars.length > PINE_LIMITS.sourceBars) throw new PineProtocolError("BAR_LIMIT", "Calculation source history exceeds 200,000 candles.");
}

/** Verify original closed overlaps once; only earlier immutable history is retained. */
export function preparePineCalculationPrefix(initialSource: PineSourceSnapshot, snapshot: PineMarketSnapshot): PineCalculationPrefix | undefined {
  if (canonicalPineTimeframe(initialSource.timeframe) !== canonicalPineTimeframe(snapshot.context.timeframe)) return undefined;
  budget(initialSource.bars); budget(snapshot.bars);
  const owned = new Map(initialSource.bars.map(bar => [bar.time, bar]));
  for (const bar of snapshot.bars) {
    const known = owned.get(bar.time);
    if (known && pineCalculationEnd(known.time, initialSource.timeframe) <= snapshot.asOf
      && !["open", "high", "low", "close", "volume"].every(key => known[key as keyof Candle] === bar[key as keyof Candle]))
      throw new PineProtocolError("INVALID_LIVE_MARKET", "Calculation history conflicts with the primary native candles.");
  }
  const start = initialSource.bars[0]?.time ?? Infinity;
  return Object.freeze({ initialSource, snapshot, bars: Object.freeze(snapshot.bars.filter(bar => bar.time < start).map(bar => Object.freeze({ ...bar }))) });
}

/** Select numerical candles and their authority clock together from validated owned inputs. */
export function selectPineCalculationSnapshot(input: PineCalculationSnapshotInput): PineCalculationSnapshot {
  const { request, realtime } = input, context = request.context;
  if (!context || !request.bars) throw new PineProtocolError("INVALID_CONTEXT", "Calculation selection requires an owned chart snapshot.");
  const chartFrame = canonicalPineTimeframe(context.timeframe), target = canonicalPineTimeframe(input.timeframe);
  const source = request.sourceSnapshot, initialSource = input.initialSource ?? source ?? { timeframe: chartFrame, bars: request.bars };
  const base = source ?? { timeframe: chartFrame, bars: request.bars };
  const end = (bars: readonly Candle[], frame: string) => bars.length ? pineCalculationEnd(bars[bars.length - 1].time, frame) : null;
  const result = (bars: readonly Candle[], authority: PineCalculationSnapshot["authority"], baseTimeframe: string,
    boundary: number | null, ownerConfirmed: boolean, revision: number): PineCalculationSnapshot => {
    budget(bars);
    const tailEnd = end(bars, target);
    return { bars, timeframe: target, authority, baseTimeframe, boundary,
      confirmed: tailEnd !== null && boundary !== null && (tailEnd < boundary || tailEnd === boundary && ownerConfirmed),
      revision, received: revision > 0 };
  };
  if (target === chartFrame) return result(request.bars, "chart", chartFrame, end(request.bars, chartFrame), input.chartConfirmed, input.revision);
  if (source && target === canonicalPineTimeframe(source.timeframe))
    return result(source.bars, "source", target, end(source.bars, target), input.sourceConfirmed, input.revision);
  let qualified: string | undefined;
  if (request.marketData) { try { qualified = pineMarketSymbol(context.symbol); } catch { /* Legacy identities have no requested-market authority. */ } }
  const snapshot = qualified && request.marketData?.snapshots.find(item => item.context.symbol === qualified && item.requestedTimeframe === target);
  const prefix = snapshot && (input.prefix?.initialSource === initialSource && input.prefix.snapshot === snapshot
    ? input.prefix : preparePineCalculationPrefix(initialSource, snapshot));
  let history = base, authority: PineCalculationSnapshot["authority"] = "primary", boundary = end(base.bars, base.timeframe);
  let confirmed = source ? input.sourceConfirmed : input.chartConfirmed, revision = input.revision;
  if (snapshot) {
    const market = realtime && input.marketLedger?.find(item => item.symbol === qualified && item.requestedTimeframes.includes(target)
      && canonicalPineTimeframe(item.timeframe) === canonicalPineTimeframe(snapshot.context.timeframe)
      && pineCalculationCanAggregate(item.timeframe, target));
    if (market) {
      history = { timeframe: market.timeframe, bars: market.bars }; authority = "market";
      boundary = end(market.bars, market.timeframe); confirmed = market.confirmed; revision = market.revision;
    } else if (!realtime) {
      history = { timeframe: snapshot.context.timeframe, bars: snapshot.bars }; authority = "history";
      boundary = snapshot.asOf; confirmed = true; revision = 0;
    } else if (prefix) {
      history = { timeframe: base.timeframe, bars: [...prefix.bars, ...base.bars] };
      // An empty live source has no clock yet. Its verified closed warmup
      // retains only its own native boundary until actual source bars arrive.
      if (!base.bars.length && prefix.bars.length) {
        authority = "history"; boundary = end(prefix.bars, base.timeframe); confirmed = true; revision = 0;
      }
    }
    else throw new PineProtocolError("UNAVAILABLE_DATA", "This calculation needs an independently owned live source interval.");
  }
  budget(history.bars);
  const bars = pineCalculationCanAggregate(history.timeframe, target) ? aggregatePineCalculationBars(history.bars, history.timeframe, target, realtime) : [];
  if (!bars.length && !snapshot) {
    if (qualified) throw new PineProtocolError("MARKET_DATA_REQUIRED", JSON.stringify({ symbol: qualified, timeframe: target }));
    if (!pineCalculationCanAggregate(base.timeframe, target)) throw new PineProtocolError("UNAVAILABLE_DATA", "The indicator's calculation timeframe requires smaller loaded candles.");
  }
  return result(bars, authority, canonicalPineTimeframe(history.timeframe), boundary, confirmed, revision);
}
