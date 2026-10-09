import type { Candle } from "./api";
import { bucketTime } from "./charting";
import { pineFeedNextSourceTime } from "./pineLiveFeed";
import { pineMarketChartTimeframe, pineMarketSymbol } from "./pineMarketProtocol";
import { PINE_LIMITS, PineProtocolError, canonicalPineTimeframe, validatePineBar, type PineContext, type PineRequest } from "./pineProtocol";

export const PINE_LIVE_MARKET_BATCH_LIMIT = 128;
export type PineLiveMarketStream = { symbol: string; timeframe: string; epoch: number };
export type PineLiveMarketEvent = PineLiveMarketStream & { sequence: number; eventTime: number; closeTime: number; bar: Candle; confirmed: boolean };
export type PineLiveMarketState = Readonly<PineLiveMarketStream & {
  context: Readonly<PineContext>; requestedTimeframes: readonly string[]; bars: readonly Candle[];
  asOf: number; sequence: number; revision: number; confirmed: boolean; event: Readonly<PineLiveMarketEvent> | null;
}>;
export type PineLiveMarketLedger = readonly PineLiveMarketState[];
export type PineLiveMarketReceipt = { kind: "market-update"; streams: { symbol: string; timeframe: string; epoch: number; sequence: number; revision: number; confirmed: boolean; tailTime: number | null }[] };

function invalid(message: string): never { throw new PineProtocolError("INVALID_LIVE_MARKET", message); }
function ordinary(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid("Requested-market events require ordinary objects.");
  for (const key of Reflect.ownKeys(value)) {
    const field = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !keys.includes(key) || !("value" in field) || !field.enumerable) invalid("Unexpected requested-market event field.");
  }
  return value as Record<string, unknown>;
}
function dense(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > limit || Reflect.ownKeys(value).length !== value.length + 1) invalid("Requested-market batches require bounded dense arrays.");
  for (let i = 0; i < value.length; i++) {
    const field = Object.getOwnPropertyDescriptor(value, String(i));
    if (!field || !("value" in field) || !field.enumerable) invalid("Requested-market batches cannot contain holes or accessors.");
  }
  return value;
}
function counter(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 1_000_000_000) invalid("Invalid requested-market epoch or sequence.");
  return value as number;
}
const native = new Set(["1", "3", "5", "15", "30", "60", "120", "240", "360", "480", "720", "1D", "1W", "1M"]);
const streamFields = ["symbol", "timeframe", "epoch"];
function stream(raw: Record<string, unknown>): PineLiveMarketStream {
  const symbol = pineMarketSymbol(raw.symbol);
  if (symbol !== raw.symbol || typeof raw.timeframe !== "string") invalid("Requested-market streams require canonical qualified identities.");
  const timeframe = canonicalPineTimeframe(raw.timeframe);
  if (timeframe !== raw.timeframe || !native.has(timeframe)) invalid("Requested-market streams require a native source interval.");
  return { symbol, timeframe, epoch: counter(raw.epoch) };
}
export function validatePineLiveMarketStreams(value: unknown): PineLiveMarketStream[] {
  const seen = new Set<string>();
  return dense(value, 64).map(value => {
    const item = stream(ordinary(value, streamFields)), key = pineLiveMarketKey(item);
    if (seen.has(key)) invalid("Duplicate requested-market stream.");
    seen.add(key); return item;
  });
}
export function pineLiveMarketKey(value: Pick<PineLiveMarketStream, "symbol" | "timeframe">): string { return `${value.symbol}|${value.timeframe}`; }
export function validatePineLiveMarketEvents(value: unknown): PineLiveMarketEvent[] {
  const values = dense(value, PINE_LIVE_MARKET_BATCH_LIMIT);
  if (!values.length) invalid("Requested-market updates require a nonempty batch.");
  return values.map(value => {
    const raw = ordinary(value, [...streamFields, "sequence", "eventTime", "closeTime", "bar", "confirmed"]), owner = stream(raw);
    const sequence = counter(raw.sequence);
    if (!sequence || typeof raw.confirmed !== "boolean" || !Number.isSafeInteger(raw.eventTime) || (raw.eventTime as number) < 0) invalid("Requested-market updates require an explicit confirmation and transport order.");
    const candle = ordinary(raw.bar, ["time", "timestamp", "open", "high", "low", "close", "volume", "ema_20", "ema_50", "rsi_14"]);
    if (!["time", "open", "high", "low", "close", "volume"].every(key => Object.prototype.hasOwnProperty.call(candle, key))) invalid("Requested-market updates require explicit OHLCV fields.");
    const bar = validatePineBar(candle), frame = pineMarketChartTimeframe(owner.timeframe);
    const closeTime = pineFeedNextSourceTime(bar.time, frame) * 1000 - 1;
    if (bucketTime(bar.time, frame) !== bar.time || raw.closeTime !== closeTime || (raw.eventTime as number) < bar.time * 1000
      || raw.confirmed && (raw.eventTime as number) < closeTime) invalid("Requested-market candles require their actual native opening and closing boundaries.");
    return { ...owner, sequence, eventTime: raw.eventTime as number, closeTime, confirmed: raw.confirmed, bar };
  });
}
const candleEqual = (a: Candle, b: Candle) => ["time", "open", "high", "low", "close", "volume"].every(key => a[key as keyof Candle] === b[key as keyof Candle]);
const frozenBar = (bar: Candle): Candle => Object.freeze({ ...bar });
function budget(ledger: PineLiveMarketLedger, primaryBars: number, measureBytes = false) {
  // An ordinary primary session retains its pre-existing independent limits.
  if (!ledger.length) return;
  if (!Number.isSafeInteger(primaryBars) || primaryBars < 0 || primaryBars + ledger.reduce((sum, item) => sum + item.bars.length, 0) > PINE_LIMITS.sourceBars) throw new PineProtocolError("BAR_LIMIT", "Chart and requested live histories exceed 200,000 candles.");
  if (measureBytes && new TextEncoder().encode(JSON.stringify(ledger)).byteLength > PINE_LIMITS.resultBytes) throw new PineProtocolError("REQUEST_LIMIT", "Requested live market state exceeds 16 MB.");
}

/** Seed only validated closed histories. Native streams are shared across requested target intervals. */
export function createPineLiveMarketLedger(request: PineRequest, bindings: PineLiveMarketStream[] = []): PineLiveMarketLedger {
  const checked = validatePineLiveMarketStreams(bindings), byKey = new Map(checked.map(item => [pineLiveMarketKey(item), item]));
  const states = new Map<string, PineLiveMarketState>();
  const main = request.marketData ? pineMarketSymbol(request.context!.symbol) : undefined;
  const primary = main && pineLiveMarketKey({ symbol: main, timeframe: canonicalPineTimeframe(request.sourceSnapshot?.timeframe ?? request.context!.timeframe) });
  if (primary && byKey.has(primary)) invalid("The primary native interval already owns its stream.");
  for (const snapshot of request.marketData?.snapshots ?? []) {
    const key = pineLiveMarketKey(snapshot.context), binding = byKey.get(key);
    if (key === primary) continue;
    if (!binding) invalid("Requested live history requires its explicitly owned stream epoch.");
    const previous = states.get(key);
    const bars = new Map((previous?.bars ?? []).map(bar => [bar.time, bar]));
    if (previous && (previous.asOf !== snapshot.asOf || JSON.stringify(previous.context) !== JSON.stringify(snapshot.context))) invalid("Requested live histories conflict across target intervals.");
    for (const bar of snapshot.bars) {
      const other = bars.get(bar.time);
      if (other && !candleEqual(other, bar)) invalid("Requested live histories disagree on a native candle.");
      if (!other) bars.set(bar.time, frozenBar(bar));
    }
    states.set(key, Object.freeze({ ...binding, context: Object.freeze({ ...snapshot.context }),
      requestedTimeframes: Object.freeze([...(previous?.requestedTimeframes ?? []), snapshot.requestedTimeframe]),
      bars: Object.freeze([...bars.values()].sort((a, b) => a.time - b.time)), asOf: snapshot.asOf, sequence: 0, revision: 0, confirmed: true, event: null }));
  }
  if (states.size !== checked.length) invalid("Requested live stream bindings must exactly match the admitted secondary histories.");
  const ledger = Object.freeze([...states.values()]);
  budget(ledger, (request.bars?.length ?? 0) + (request.sourceSnapshot?.bars.length ?? 0), true);
  return ledger;
}
export function assertPineLiveMarketBudget(ledger: PineLiveMarketLedger, request: Pick<PineRequest, "bars" | "sourceSnapshot">) {
  budget(ledger, (request.bars?.length ?? 0) + (request.sourceSnapshot?.bars.length ?? 0));
}

/** Pure copy-on-write acceptance: an invalid later event cannot partly advance any stream. */
export function advancePineLiveMarkets(ledger: PineLiveMarketLedger, input: unknown, request: Pick<PineRequest, "bars" | "sourceSnapshot">): PineLiveMarketLedger {
  const events = validatePineLiveMarketEvents(input), states = new Map(ledger.map(item => [pineLiveMarketKey(item), item]));
  for (const event of events) {
    const key = pineLiveMarketKey(event), previous = states.get(key);
    if (!previous || previous.epoch !== event.epoch) invalid("Requested-market event belongs to an unowned stream or retired epoch.");
    const last = previous.event;
    if (last && event.sequence === last.sequence && event.eventTime === last.eventTime && event.closeTime === last.closeTime && event.confirmed === last.confirmed && candleEqual(event.bar, last.bar)) continue;
    if (event.sequence !== previous.sequence + 1 || last && event.eventTime < last.eventTime) invalid("Requested-market updates require the exact next stream sequence and ordered event time.");
    const tail = previous.bars.at(-1), append = !tail || event.bar.time > tail.time;
    const repeatedClose = !!tail && previous.confirmed && event.confirmed && candleEqual(tail, event.bar);
    if (tail && (event.bar.time < tail.time || !append && previous.confirmed && !repeatedClose
      || append && (!previous.confirmed || event.bar.time !== pineFeedNextSourceTime(tail.time, pineMarketChartTimeframe(previous.timeframe))))) invalid("Requested live candles cannot revise confirmed history, skip a candle or advance before closing.");
    if (!tail && (event.closeTime + 1 <= previous.asOf * 1000 || event.eventTime < previous.asOf * 1000)) invalid("Requested live updates cannot insert ended history before their seed cutoff.");
    if (tail && !append && !repeatedClose && (event.bar.open !== tail.open || event.bar.high < tail.high || event.bar.low > tail.low || event.bar.volume < tail.volume)) invalid("Requested live OHLCV must preserve the candle's received range and volume.");
    const bar = frozenBar(event.bar), heldEvent = Object.freeze({ ...event, bar });
    const bars = repeatedClose ? previous.bars : Object.freeze(append ? [...previous.bars, bar] : [...previous.bars.slice(0, -1), bar]);
    states.set(key, Object.freeze({ ...previous, bars, sequence: event.sequence, revision: previous.revision + (repeatedClose ? 0 : 1), confirmed: event.confirmed,
      asOf: Math.max(previous.asOf, event.eventTime / 1000), event: heldEvent }));
  }
  const next = Object.freeze([...states.values()]);
  budget(next, (request.bars?.length ?? 0) + (request.sourceSnapshot?.bars.length ?? 0), true);
  return next;
}
export function pineLiveMarketReceipt(ledger: PineLiveMarketLedger): PineLiveMarketReceipt {
  return { kind: "market-update", streams: ledger.map(({ symbol, timeframe, epoch, sequence, revision, confirmed, bars }) => ({ symbol, timeframe, epoch, sequence, revision, confirmed, tailTime: bars.at(-1)?.time ?? null })) };
}
/** Acknowledgements contain no chart output, prices, source text or authored payload. */
export function validatePineLiveMarketReceipt(value: unknown, ledger: PineLiveMarketLedger): PineLiveMarketReceipt {
  const raw = ordinary(value, ["kind", "streams"]), expected = pineLiveMarketReceipt(ledger);
  if (raw.kind !== expected.kind) invalid("Invalid requested-market acknowledgement.");
  const values = dense(raw.streams, 64);
  if (values.length !== expected.streams.length) invalid("Requested-market acknowledgement has a different stream set.");
  values.forEach((value, index) => {
    const item = ordinary(value, ["symbol", "timeframe", "epoch", "sequence", "revision", "confirmed", "tailTime"]);
    const owned = expected.streams[index];
    for (const key of Object.keys(owned)) if (item[key] !== owned[key as keyof typeof owned]) invalid("Requested-market acknowledgement does not match the accepted history.");
  });
  return expected;
}
