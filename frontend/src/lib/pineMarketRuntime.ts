import { createPineMarketDataResolver, PINE_MARKET_DATA_LIMITS, type PineMarketDataScope } from "./pineMarketDataResolver";
import { parsePineMarketDemand, pineMarketSymbol, type PineMarketSnapshot } from "./pineMarketProtocol";
import { PineProtocolError, validatePineRequest, type PineRequest, type PineExecutionResult, type PinePrepareResult } from "./pineProtocol";

type Job = { id: string; cancel(): void; promise: Promise<PineExecutionResult | PinePrepareResult> };
type Dependencies = {
  createJob(request: PineRequest): Job;
  createResolver: typeof createPineMarketDataResolver;
};

/** Evaluated dependencies load through the host; every attempt gets a fresh isolated worker. */
export function createPineMarketRuntimeJob(request: PineRequest, scope: PineMarketDataScope, dependencies: Dependencies): Job {
  scope = { ...scope, range: { ...scope.range } };
  let inner: Job | undefined, resolver: ReturnType<typeof createPineMarketDataResolver> | undefined;
  let cancelled = false, rejectCancelled: (error: Error) => void = () => {};
  const stopped = new Promise<never>((_, reject) => { rejectCancelled = reject; });
  // Avoid an unhandled rejection if validation fails before the race starts.
  void stopped.catch(() => {});
  const cancel = () => {
    if (cancelled) return;
    cancelled = true; inner?.cancel(); resolver?.cancel();
    rejectCancelled(new DOMException("Pine execution was cancelled.", "AbortError"));
  };
  const timer = setTimeout(() => {
    cancelled = true; inner?.cancel(); resolver?.cancel();
    rejectCancelled(new PineProtocolError("TIMEOUT", "Requested indicator markets took too long to load. Try Run again."));
  }, 45_000);
  const assertActive = () => {
    if (cancelled) throw new DOMException("Pine execution was cancelled.", "AbortError");
    resolver!.assertActive();
  };
  const execute = async () => {
    const base = validatePineRequest({ ...request, marketData: { provider: "binance", snapshots: [] } });
    if (base.action !== "run" || !base.context || !base.bars?.length
      || pineMarketSymbol(scope.chartSymbol) !== pineMarketSymbol(base.context.symbol)
      || scope.range.from !== base.bars[0].time || scope.range.to !== scope.asOf - 1) {
      throw new PineProtocolError("INVALID_MARKET_DATA", "Requested markets need the same owned chart and observation window as this run.");
    }
    // Capture identity before even the first worker attempt, including A→B→A transitions.
    resolver = dependencies.createResolver(scope);
    resolver.signal.addEventListener("abort", cancel, { once: true });
    const snapshots: PineMarketSnapshot[] = [], invalidSymbols: string[] = [], demands = new Map<string, number>();
    for (let attempt = 0; attempt <= PINE_MARKET_DATA_LIMITS.contexts; attempt++) {
      assertActive();
      const input = validatePineRequest({ ...base, marketData: { provider: "binance", snapshots, invalidSymbols } });
      inner = dependencies.createJob(input);
      try {
        const result = await inner.promise;
        assertActive(); return result;
      } catch (failure) {
        assertActive();
        const demand = parsePineMarketDemand(failure);
        if (!demand) throw failure;
        const key = `${demand.symbol}:${demand.timeframe}`;
        const warmupPeriods = Math.max(1000, demand.calcBarsCount ?? 0);
        // A larger evaluated depth may replace a snapshot; repeated unmet demands must stop.
        if ((demands.get(key) ?? -1) >= warmupPeriods || attempt === PINE_MARKET_DATA_LIMITS.contexts) {
          throw new PineProtocolError("REQUEST_LIMIT", "This indicator exceeded its requested market contexts or calculation depth.");
        }
        demands.set(key, warmupPeriods);
        if (warmupPeriods > PINE_MARKET_DATA_LIMITS.historyCandles) throw new PineProtocolError("REQUEST_LIMIT", "Requested calculation depth exceeds the market history limit.");
        try {
          const loaded = await resolver.resolve({ symbol: demand.symbol, timeframe: demand.timeframe, warmupPeriods });
          assertActive();
          if (loaded.coverage.capped) throw new PineProtocolError("REQUEST_LIMIT", "Requested market history exceeds the candle limit. Use a shorter chart window.");
          const snapshot = { context: { ...loaded.context, timeframe: loaded.sourceTimeframe }, requestedTimeframe: demand.timeframe,
            bars: loaded.bars.map(bar => ({ ...bar })), asOf: scope.asOf };
          const previous = snapshots.findIndex(item => item.context.symbol === demand.symbol && item.requestedTimeframe === demand.timeframe);
          if (previous < 0) snapshots.push(snapshot); else snapshots[previous] = snapshot;
        } catch (error) {
          assertActive();
          // Only a verified nonexistent ticker may become NA. Transport/access failures must stop.
          if (!(error instanceof PineProtocolError) || error.code !== "INVALID_REQUEST_SYMBOL" || !demand.ignoreInvalidSymbol) throw error;
          invalidSymbols.push(demand.symbol);
        }
      } finally { inner?.cancel(); inner = undefined; }
    }
    throw new PineProtocolError("REQUEST_LIMIT", "This indicator exceeded its requested market limit.");
  };
  const promise = Promise.race([execute(), stopped]).finally(() => {
    clearTimeout(timer); inner?.cancel(); resolver?.signal.removeEventListener("abort", cancel); resolver?.cancel();
  });
  return { id: request.id, cancel, promise };
}
