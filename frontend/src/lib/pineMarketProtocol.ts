import type { Candle } from "./api";
import { canAggregateTimeframe, normalizeChartTimeframe } from "./charting";
import { pineFeedNextSourceTime } from "./pineLiveFeed";
import { canonicalPineTimeframe, PINE_LIMITS, PineProtocolError, validatePineBar, validatePineRequest, type PineContext } from "./pineProtocol";

export type PineMarketSnapshot = { context: PineContext; requestedTimeframe: string; bars: Candle[]; asOf: number };
export type PineMarketDataConfig = { provider: "binance"; snapshots: PineMarketSnapshot[]; invalidSymbols?: string[] };
export type PineMarketDemand = { symbol: string; timeframe: string; calcBarsCount?: number; ignoreInvalidSymbol?: boolean };
function invalid(message: string): never { throw new PineProtocolError("INVALID_MARKET_DATA", message); }
function ordinary(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid("Requested data requires ordinary objects.");
  for (const key of Reflect.ownKeys(value)) {
    const field = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || ["__proto__", "prototype", "constructor"].includes(key) || !("value" in field) || !field.enumerable) invalid("Requested data requires ordinary named fields.");
  }
  return value as Record<string, unknown>;
}
function fields(raw: Record<string, unknown>, keys: string[]) { if (Object.keys(raw).some(key => !keys.includes(key))) invalid("Unexpected requested-data field."); }
function denseArray(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > limit) invalid("Requested data requires bounded ordinary arrays.");
  if (Reflect.ownKeys(value).length !== value.length + 1) invalid("Requested arrays must be dense and contain only indexed values.");
  for (let index = 0; index < value.length; index++) {
    const field = Object.getOwnPropertyDescriptor(value, String(index));
    if (!field || !("value" in field) || !field.enumerable) invalid("Requested arrays cannot contain holes or accessors.");
  }
  return value;
}

/** Qualification stays intact. This policy is enabled only by an explicit host provider. */
export function pineMarketSymbol(value: unknown): string {
  if (typeof value !== "string" || value.length > 96) throw new PineProtocolError("UNAVAILABLE_DATA", "Choose a supported Binance spot symbol.");
  const match = /^(?:BINANCE:)?([A-Z0-9]{2,40})$/.exec(value.trim().toUpperCase());
  if (!match) throw new PineProtocolError("UNAVAILABLE_DATA", "This symbol or ticker modifier is unavailable from the chart's Binance provider.");
  return `BINANCE:${match[1]}`;
}
export function pineMarketChartTimeframe(value: string): string {
  const timeframe = canonicalPineTimeframe(value), match = /^(\d+)([SDWM]?)$/.exec(timeframe)!;
  if (match[2] === "S") throw new PineProtocolError("UNAVAILABLE_DATA", "Binance spot does not supply these second candles.");
  const frame = normalizeChartTimeframe(`${match[1]}${match[2] || "m"}`);
  if (!frame) throw new PineProtocolError("UNAVAILABLE_DATA", "This requested timeframe is unavailable from Binance spot.");
  return frame;
}
/** A bounded, evaluated request from the trusted worker; never a URL or an API path. */
export function validatePineMarketDemand(value: unknown): PineMarketDemand {
  const raw = ordinary(value); fields(raw, ["symbol", "timeframe", "calcBarsCount", "ignoreInvalidSymbol"]);
  const symbol = pineMarketSymbol(raw.symbol);
  if (typeof raw.timeframe !== "string" || raw.timeframe.length > 8) invalid("Invalid requested Pine timeframe.");
  const timeframe = canonicalPineTimeframe(raw.timeframe);
  let calcBarsCount: number | undefined;
  if (raw.calcBarsCount !== undefined) {
    if (!Number.isSafeInteger(raw.calcBarsCount) || (raw.calcBarsCount as number) < 1 || (raw.calcBarsCount as number) > PINE_LIMITS.sourceBars) invalid("Requested calculation depth exceeds the candle limit.");
    calcBarsCount = raw.calcBarsCount as number;
  }
  if (raw.ignoreInvalidSymbol !== undefined && typeof raw.ignoreInvalidSymbol !== "boolean") invalid("Invalid requested symbol policy.");
  return { symbol, timeframe, ...(calcBarsCount !== undefined ? { calcBarsCount } : {}), ...(raw.ignoreInvalidSymbol === true ? { ignoreInvalidSymbol: true } : {}) };
}
export function parsePineMarketDemand(error: unknown): PineMarketDemand | null {
  if (!(error instanceof PineProtocolError) || error.code !== "MARKET_DATA_REQUIRED") return null;
  if (error.message.length > 256) invalid("Requested data demand exceeds its transport limit.");
  let value: unknown;
  try { value = JSON.parse(error.message); } catch { invalid("Invalid requested-data demand."); }
  return validatePineMarketDemand(value);
}

/** Validate independently owned, closed secondary history before it reaches an isolated worker. */
// observationCutoff is an internal seam: validatePineRequest derives it only
// from validated primary events/confirmed source prefixes, never a raw cutoff.
export function validatePineMarketData(value: unknown, chart: PineContext, chartBars: Candle[], sourceBars = 0, observationCutoff?: number): PineMarketDataConfig {
  const raw = ordinary(value); fields(raw, ["provider", "snapshots", "invalidSymbols"]);
  if (raw.provider !== "binance") invalid("Unsupported requested-data provider.");
  pineMarketSymbol(chart.symbol);
  const input = denseArray(raw.snapshots, 64);
  const invalidSymbols = raw.invalidSymbols === undefined ? [] : denseArray(raw.invalidSymbols, 64).map(value => {
    const symbol = pineMarketSymbol(value);
    if (value !== symbol) invalid("Invalid symbols require canonical provider qualification.");
    return symbol;
  });
  if (new Set(invalidSymbols).size !== invalidSymbols.length || input.length + invalidSymbols.length > 64) invalid("Requested data exceeds its unique context limit.");
  const chartEnd = observationCutoff ?? pineFeedNextSourceTime(chartBars.at(-1)!.time, pineMarketChartTimeframe(chart.timeframe));
  let total = chartBars.length + sourceBars;
  const identities = new Set<string>(), metadata = new Map<string, string>();
  const snapshots = input.map(value => {
    const snapshot = ordinary(value); fields(snapshot, ["context", "requestedTimeframe", "bars", "asOf"]);
    const sourceContext = ordinary(snapshot.context);
    fields(sourceContext, ["symbol", "timeframe", "mintick", "mincontract", "pointvalue", "quantityStep", "currency", "basecurrency"]);
    for (const key of ["mintick", "mincontract", "pointvalue", "quantityStep", "currency", "basecurrency"]) if (sourceContext[key] === undefined) invalid("Requested markets require their own verified instrument details.");
    const symbol = pineMarketSymbol(sourceContext.symbol);
    if (invalidSymbols.includes(symbol)) invalid("Requested market cannot be both available and invalid.");
    if (sourceContext.symbol !== symbol) invalid("Requested snapshots require their canonical provider-qualified symbol.");
    const context = validatePineRequest({ id: "requested-market-context", action: "prepare", source: '//@version=6\nindicator("Requested context")', context: sourceContext }).context!;
    context.timeframe = canonicalPineTimeframe(context.timeframe);
    if (!["1", "3", "5", "15", "30", "60", "120", "240", "360", "480", "720", "1D", "1W", "1M"].includes(context.timeframe)) invalid("Requested snapshots require an actual native Binance source interval.");
    if (typeof snapshot.requestedTimeframe !== "string" || snapshot.requestedTimeframe.length > 8) invalid("Invalid requested snapshot timeframe.");
    const requestedTimeframe = canonicalPineTimeframe(snapshot.requestedTimeframe);
    const frame = pineMarketChartTimeframe(context.timeframe), target = pineMarketChartTimeframe(requestedTimeframe);
    if (!canAggregateTimeframe(target, frame)) invalid("Requested source candles cannot construct this timeframe.");
    const key = `${symbol}:${requestedTimeframe}`;
    if (identities.has(key)) invalid("Duplicate requested market context.");
    identities.add(key);
    const signature = JSON.stringify([context.mintick, context.mincontract, context.pointvalue, context.quantityStep, context.currency, context.basecurrency]);
    if (metadata.has(symbol) && metadata.get(symbol) !== signature) invalid("Requested symbol metadata conflicts across its timeframes.");
    metadata.set(symbol, signature);
    const asOf = snapshot.asOf;
    if (!Number.isSafeInteger(asOf) || (asOf as number) < chartBars.at(-1)!.time || (asOf as number) > chartEnd) invalid("Requested data extends beyond the chart's observation cutoff.");
    const inputBars = denseArray(snapshot.bars, PINE_LIMITS.sourceBars);
    total += inputBars.length;
    if (total > PINE_LIMITS.sourceBars) throw new PineProtocolError("BAR_LIMIT", "Chart and requested data exceed 200,000 candles.");
    let previous = -Infinity;
    const bars = inputBars.map(value => {
      const bar = validatePineBar(ordinary(value));
      const close = pineFeedNextSourceTime(bar.time, frame);
      if (bar.time <= previous || close > (asOf as number) || close <= bar.time) invalid("Requested candles must be unique, ordered and confirmed within their cutoff.");
      // The provider interval's next start also proves UTC/native calendar alignment.
      const expected = frame === "1M" ? new Date(bar.time * 1000) : null;
      if (frame === "1M" ? expected!.getUTCDate() !== 1 || expected!.getUTCHours() !== 0 || expected!.getUTCMinutes() !== 0 || expected!.getUTCSeconds() !== 0
        : frame === "1W" ? new Date(bar.time * 1000).getUTCDay() !== 1 || bar.time % 86400 !== 0
          : bar.time % (close - bar.time) !== 0) invalid("Requested candles must align with their actual native interval.");
      previous = bar.time; return bar;
    });
    return { context, requestedTimeframe, bars, asOf: asOf as number };
  });
  const config: PineMarketDataConfig = { provider: "binance", snapshots, ...(invalidSymbols.length ? { invalidSymbols } : {}) };
  if (new TextEncoder().encode(JSON.stringify(config)).byteLength > PINE_LIMITS.resultBytes) throw new PineProtocolError("REQUEST_LIMIT", "Requested market data exceeds 16 MB.");
  return config;
}
