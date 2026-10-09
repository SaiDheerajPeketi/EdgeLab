import { getBinanceInstruments, type Candle, type BinanceInstrument } from "./api";
import { getStoredAuthSession, hasWorkspaceAccess, subscribeAuthSession, type AuthSession } from "./authSession";
import { binanceChartPlan, loadBinanceRequestHistory, type BinanceChartPlan } from "./binanceChartFeed";
import { normalizeChartTimeframe } from "./charting";
import { pineContextForChart } from "./customIndicators";
import { pineContextWithBinanceInstrument } from "./pineInstrumentContext";
import { pineFeedNextSourceTime } from "./pineLiveFeed";
import { canonicalPineTimeframe, PINE_LIMITS, PineProtocolError, validatePineViewport, type PineContext, type PineViewport } from "./pineProtocol";

export const PINE_MARKET_DATA_LIMITS = Object.freeze({ contexts: 64, concurrent: 4, historyCandles: 16_000, candles: PINE_LIMITS.sourceBars, bytes: PINE_LIMITS.resultBytes });
export type PineMarketDataScope = {
  provider: "binance"; chartSymbol: string; revision: string; range: PineViewport; asOf: number;
  /** Trusted live coordinator supplies the chart's actual native source interval. */
  primaryTimeframe?: string;
  owns(): boolean; signal?: AbortSignal;
};
export type PineMarketDataDemand = { symbol: string; timeframe: string; warmupPeriods?: number };
/** Trusted host seam, called only after instrument qualification and before REST. */
export type PineMarketHistoryAdmission = {
  providerSymbol: string; context: Readonly<PineContext>; plan: Readonly<BinanceChartPlan>; signal: AbortSignal;
};
export type PineResolvedMarketData = {
  provider: "binance"; providerSymbol: string; revision: string;
  context: Readonly<PineContext>; sourceTimeframe: string; interval: string; bars: readonly Readonly<Candle>[];
  coverage: Readonly<{ from: number; to: number; warmupFrom: number; asOf: number; first: number | null; last: number | null;
    requests: number; exhausted: boolean; capped: boolean; omittedUnconfirmed: boolean }>;
};
type Dependencies = {
  getSession(): AuthSession | null;
  subscribeSession(listener: () => void): () => void;
  subscribeIdentity(listener: () => void): () => void;
  instruments: typeof getBinanceInstruments;
  history: typeof loadBinanceRequestHistory;
  beforeHistory?(admission: PineMarketHistoryAdmission): Promise<void>;
};
function unavailable(message: string): never { throw new PineProtocolError("UNAVAILABLE_DATA", message); }
function subscribeIdentity(listener: () => void) {
  if (typeof window === "undefined") return () => {};
  const clear = (event: StorageEvent) => { if (event.key === null) listener(); };
  window.addEventListener("edgelab:auth-session-change", listener);
  window.addEventListener("storage", clear);
  return () => { window.removeEventListener("edgelab:auth-session-change", listener); window.removeEventListener("storage", clear); };
}

/** Provider qualification is retained; punctuation is never stripped into a different market. */
export function pineBinanceRequestedSymbol(value: unknown): string {
  if (typeof value !== "string" || value.length > 96) return unavailable("Choose a supported Binance spot symbol.");
  const match = /^(?:BINANCE:)?([A-Z0-9]{2,40})$/.exec(value.trim().toUpperCase());
  if (!match) return unavailable("This requested symbol is unavailable from the chart's Binance provider.");
  return match[1];
}
function demand(value: unknown): Required<PineMarketDataDemand> {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) unavailable("Invalid requested market context.");
  const raw = value as Record<string, unknown>;
  for (const key of Reflect.ownKeys(raw)) {
    const field = Object.getOwnPropertyDescriptor(raw, key)!;
    if (typeof key !== "string" || !["symbol", "timeframe", "warmupPeriods"].includes(key) || !("value" in field) || !field.enumerable) unavailable("Requested market contexts contain only symbol, timeframe and warmup periods.");
  }
  const symbol = pineBinanceRequestedSymbol(raw.symbol);
  if (typeof raw.timeframe !== "string" || raw.timeframe.length > 8) unavailable("Use a supported Pine timeframe for the requested market.");
  const timeframe = canonicalPineTimeframe(raw.timeframe);
  const warmupPeriods = raw.warmupPeriods ?? 0;
  if (!Number.isSafeInteger(warmupPeriods) || (warmupPeriods as number) < 0 || (warmupPeriods as number) > PINE_MARKET_DATA_LIMITS.historyCandles) unavailable("Requested warmup exceeds the market-data limit.");
  return { symbol, timeframe, warmupPeriods: warmupPeriods as number };
}
function chartTimeframe(timeframe: string): string {
  const match = /^(\d+)([SDWM]?)$/.exec(timeframe)!;
  if (match[2] === "S") unavailable("Binance spot does not supply these second candles.");
  const result = normalizeChartTimeframe(`${match[1]}${match[2] || "m"}`);
  if (!result) unavailable("This requested timeframe is unavailable from Binance spot.");
  return result;
}

/** Host-only, account-local data loading. No URLs or credentials are accepted from a script. */
export function createPineMarketDataResolver(scope: PineMarketDataScope, overrides: Partial<Dependencies> = {}) {
  const deps: Dependencies = { getSession: getStoredAuthSession, subscribeSession: subscribeAuthSession, subscribeIdentity,
    instruments: getBinanceInstruments, history: loadBinanceRequestHistory, ...overrides };
  if (scope.provider !== "binance") unavailable("Requested market data is unavailable from this provider.");
  pineBinanceRequestedSymbol(scope.chartSymbol);
  const range = validatePineViewport(scope.range);
  if (!range || !Number.isSafeInteger(scope.asOf) || scope.asOf < range.to || scope.asOf > 253402300799
    || typeof scope.revision !== "string" || !scope.revision || scope.revision.length > 256 || typeof scope.owns !== "function") unavailable("Requested data needs an owned chart range and script revision.");
  const revision = scope.revision, asOf = scope.asOf, scopeOwns = scope.owns, signal = scope.signal;
  const owner = deps.getSession();
  if (!hasWorkspaceAccess(owner)) throw new PineProtocolError("MARKET_ACCESS_REQUIRED", "Sign in with workspace access before loading indicator markets.");
  const identity = { id: owner!.user.id, token: owner!.token };
  const controller = new AbortController();
  const cache = new Map<string, Promise<PineResolvedMarketData>>();
  const metadata = new Map<string, Promise<BinanceInstrument>>();
  let retired = false, pending = 0, reserved = 0, storedBars = 0, storedBytes = 0;
  let unsubscribe = () => {}, unsubscribeIdentity = () => {};
  const cancel = () => {
    if (retired) return;
    retired = true; controller.abort(); cache.clear(); metadata.clear(); unsubscribe(); unsubscribeIdentity();
    signal?.removeEventListener("abort", cancel);
  };
  const owns = () => {
    const current = deps.getSession();
    return !retired && !signal?.aborted && scopeOwns() && hasWorkspaceAccess(current)
      && current!.user.id === identity.id && current!.token === identity.token;
  };
  const ensureActive = () => {
    if (!owns()) { cancel(); throw new DOMException("Requested indicator markets retired.", "AbortError"); }
  };
  ensureActive();
  unsubscribe = deps.subscribeSession(() => { if (!owns()) cancel(); });
  if (retired) unsubscribe();
  unsubscribeIdentity = deps.subscribeIdentity(cancel);
  if (retired) unsubscribeIdentity();
  signal?.addEventListener("abort", cancel, { once: true });
  const resolve = (value: unknown): Promise<PineResolvedMarketData> => {
    try {
      ensureActive();
      const requested = demand(value);
      const frame = chartTimeframe(requested.timeframe), plan = binanceChartPlan(frame);
      if (!plan) unavailable("This requested timeframe is unavailable from Binance spot.");
      const key = JSON.stringify([requested.symbol, requested.timeframe, requested.warmupPeriods]);
      const existing = cache.get(key);
      if (existing) return existing.then(result => { ensureActive(); return result; });
      if (cache.size >= PINE_MARKET_DATA_LIMITS.contexts || pending >= PINE_MARKET_DATA_LIMITS.concurrent
        || storedBars + reserved + PINE_MARKET_DATA_LIMITS.historyCandles > PINE_MARKET_DATA_LIMITS.candles) {
        throw new PineProtocolError("REQUEST_LIMIT", "The indicator requested too many market contexts or candles.");
      }
      pending++; reserved += PINE_MARKET_DATA_LIMITS.historyCandles;
      const job = (async () => {
        let instrumentRequest = metadata.get(requested.symbol);
        if (!instrumentRequest) {
          instrumentRequest = deps.instruments(requested.symbol, 5000, controller.signal).then(response => {
            ensureActive();
            if (!Array.isArray(response?.instruments) || response.instruments.length > 5000) unavailable("Requested instrument details are unavailable. Retry the indicator.");
            const matches = response.instruments.filter(item => item?.symbol === requested.symbol);
            if (matches.length > 1) unavailable("Requested instrument details conflict. Retry the indicator.");
            if (!matches.length || matches[0].status !== "TRADING" || matches[0].asset_class !== "crypto") throw new PineProtocolError("INVALID_REQUEST_SYMBOL", "This symbol is unavailable from the chart's Binance provider.");
            const validated = pineContextWithBinanceInstrument(`BINANCE:${requested.symbol}`, frame, requested.symbol, matches[0]);
            // Retain one validated scalar row, never the full search response.
            const item: BinanceInstrument = Object.freeze({ symbol: requested.symbol, label: requested.symbol, description: requested.symbol,
              status: "TRADING", asset_class: "crypto", base_asset: validated.basecurrency!, quote_asset: validated.currency!,
              tick_size: validated.mintick!, min_quantity: validated.mincontract!, quantity_step: validated.quantityStep! });
            const bytes = new TextEncoder().encode(JSON.stringify(item)).byteLength;
            if (storedBytes + bytes > PINE_MARKET_DATA_LIMITS.bytes) throw new PineProtocolError("REQUEST_LIMIT", "Requested instrument details exceed the indicator memory limit.");
            ensureActive(); storedBytes += bytes;
            return item;
          });
          metadata.set(requested.symbol, instrumentRequest);
          void instrumentRequest.catch(() => { if (metadata.get(requested.symbol) === instrumentRequest) metadata.delete(requested.symbol); });
        }
        const instrument = await instrumentRequest;
        ensureActive();
        const symbol = `BINANCE:${requested.symbol}`;
        const context = pineContextWithBinanceInstrument(symbol, frame, requested.symbol, instrument);
        ensureActive();
        await deps.beforeHistory?.({ providerSymbol: requested.symbol, context: Object.freeze({ ...context }),
          plan: Object.freeze({ ...plan }), signal: controller.signal });
        ensureActive();
        const history = await deps.history(requested.symbol, plan, { from: range.from, to: range.to,
          warmupPeriods: requested.warmupPeriods, candleLimit: PINE_MARKET_DATA_LIMITS.historyCandles,
          signal: controller.signal, owns });
        ensureActive();
        // Historical seeds may never contain OHLC from beyond the observation cutoff.
        // Developing data will be supplied by its independently owned live transport.
        const closed = history.bars.filter(bar => pineFeedNextSourceTime(bar.time, history.sourceTimeframe) <= asOf);
        const result: PineResolvedMarketData = Object.freeze({ provider: "binance", providerSymbol: requested.symbol, revision,
          context: Object.freeze(context), sourceTimeframe: pineContextForChart(symbol, history.sourceTimeframe).timeframe,
          interval: plan.interval, bars: Object.freeze(closed.map(bar => Object.freeze({ ...bar }))),
          coverage: Object.freeze({ from: range.from, to: range.to, warmupFrom: history.warmupFrom, asOf,
            first: closed[0]?.time ?? null, last: closed.at(-1)?.time ?? null, requests: history.requests,
            exhausted: history.exhausted, capped: history.capped, omittedUnconfirmed: closed.length !== history.bars.length }) });
        const bytes = new TextEncoder().encode(JSON.stringify(result)).byteLength;
        if (storedBytes + bytes > PINE_MARKET_DATA_LIMITS.bytes) throw new PineProtocolError("REQUEST_LIMIT", "Requested market data exceeds the indicator memory limit.");
        ensureActive(); storedBytes += bytes; storedBars += closed.length;
        return result;
      })().finally(() => { pending--; reserved -= PINE_MARKET_DATA_LIMITS.historyCandles; });
      cache.set(key, job);
      // Failed contexts remain admitted and cached for this immutable revision;
      // repeated calls (including ignore_invalid_symbol) cannot retry every bar.
      void job.catch(() => {});
      return job.then(result => { ensureActive(); return result; });
    } catch (error) { return Promise.reject(error); }
  };
  return { resolve, cancel, signal: controller.signal, assertActive: ensureActive, stats: () => ({ contexts: cache.size, pending, candles: storedBars, bytes: storedBytes, retired }) };
}
