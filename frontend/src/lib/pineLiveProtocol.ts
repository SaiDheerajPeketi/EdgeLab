import type { Candle } from "./api";
import { validatePineConditionSampleOwnership, type PineConditionSampleProof } from "./pineConditionSamples";
import { validatePineLiveMarketEvents, validatePineLiveMarketStreams, validatePineLiveMarketReceipt, type PineLiveMarketEvent, type PineLiveMarketStream, type PineLiveMarketReceipt, type PineLiveMarketLedger } from "./pineLiveMarkets";
import { PINE_LIMITS, pineFixedTimeframeDuration, PineProtocolError, validatePineBar, validatePineViewport, validatePineRequest, validatePineResponse, type PineExecutionResult, type PineRequest, type PineResponse, type PineSourceSnapshot, type PineViewport } from "./pineProtocol";

export const PINE_LIVE_PROTOCOL = "pine-live-v1" as const;
export const PINE_LIVE_QUEUE_LIMIT = 32;
type LiveIdentity = { protocol: typeof PINE_LIVE_PROTOCOL; sessionId: string; sequence: number };
export type PineLiveSourceEvent = { bar: Candle; confirmed: boolean };
export type PineLiveRequest = LiveIdentity & (
  { action: "start"; request: PineRequest; marketStreams?: PineLiveMarketStream[] } |
  { action: "update"; bar: Candle; confirmed: boolean; source?: PineLiveSourceEvent; collectAlerts?: boolean; collectConditions?: boolean } |
  { action: "markets"; events: PineLiveMarketEvent[] } |
  { action: "viewport"; viewport: PineViewport | null }
);
export type PineLiveResponse = LiveIdentity & { response: PineResponse | { id: string; status: "completed"; ack: PineLiveMarketReceipt } };

function invalid(message: string): never { throw new PineProtocolError("INVALID_LIVE_MESSAGE", message); }
function plain(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid("Live Pine messages must be plain objects.");
  const record = value as Record<string, unknown>;
  for (const key of Reflect.ownKeys(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key)!;
    if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key) || !("value" in descriptor) || !descriptor.enumerable) invalid("Live Pine messages require ordinary data fields.");
  }
  return record;
}
function identity(record: Record<string, unknown>): LiveIdentity {
  if (record.protocol !== PINE_LIVE_PROTOCOL || typeof record.sessionId !== "string" || !/^[A-Za-z0-9_-]{16,96}$/.test(record.sessionId)
    || !Number.isSafeInteger(record.sequence) || (record.sequence as number) < 0 || (record.sequence as number) > 1_000_000_000) invalid("Invalid live Pine session identity or sequence.");
  return { protocol: PINE_LIVE_PROTOCOL, sessionId: record.sessionId, sequence: record.sequence as number };
}
export function pineLiveRequestId(sessionId: string, sequence: number): string { return `${sessionId}:${sequence}`; }
export function validatePineLiveRequest(value: unknown): PineLiveRequest {
  const raw = plain(value);
  const owner = identity(raw);
  const fields = raw.action === "start" ? ["protocol", "sessionId", "sequence", "action", "request", "marketStreams"] : raw.action === "markets" ? ["protocol", "sessionId", "sequence", "action", "events"] : raw.action === "viewport" ? ["protocol", "sessionId", "sequence", "action", "viewport"] : ["protocol", "sessionId", "sequence", "action", "bar", "confirmed", "source", "collectAlerts", "collectConditions"];
  if (Object.keys(raw).some(key => !fields.includes(key))) invalid("Unexpected live Pine request field.");
  if (raw.action === "start") {
    if (owner.sequence !== 0) invalid("Live Pine initialization requires sequence zero.");
    const request = validatePineRequest(raw.request);
    if (request.action !== "run" || request.mode !== "live" || request.id !== pineLiveRequestId(owner.sessionId, 0)) invalid("Live Pine initialization requires its owned run request.");
    if (request.sourceSnapshot) {
      const base = pineFixedTimeframeDuration(request.sourceSnapshot.timeframe), chart = pineFixedTimeframeDuration(request.context!.timeframe);
      if (!base || !chart || base >= chart) invalid("Live source history requires a lower fixed chart timeframe.");
      if (request.sourceSnapshot.bars.some((bar, index, bars) => index > 0 && bar.time !== bars[index - 1].time + base)) invalid("Live source history requires consecutive actual candles.");
      const chartBars = new Map(request.bars!.map(bar => [bar.time, bar]));
      const groups = new Map<number, Candle[]>();
      for (const bar of request.sourceSnapshot.bars) {
        const start = Math.floor(bar.time / chart) * chart;
        const group = groups.get(start);
        if (group) group.push(bar); else groups.set(start, [bar]);
      }
      for (const [start, children] of groups) {
        const expected = chartBars.get(start);
        if (!expected) {
          if (children.length >= chart / base || children.some((bar, index) => bar.time !== start + index * base)) invalid("A live source seed may contain only a contiguous confirmed prefix of the next chart candle.");
          continue;
        }
        if (children.length !== chart / base || children.some((bar, index) => bar.time !== start + index * base)) continue;
        const aggregate = { open: children[0].open, high: Math.max(...children.map(bar => bar.high)), low: Math.min(...children.map(bar => bar.low)), close: children.at(-1)!.close,
          volume: children.reduce((total, bar) => total + bar.volume, 0) };
        if (!["open", "high", "low", "close", "volume"].every(key => aggregate[key as keyof typeof aggregate] === expected[key as keyof Candle])) invalid("Live source history does not match the chart's committed candles.");
      }
    }
    const marketStreams = raw.marketStreams === undefined ? undefined : validatePineLiveMarketStreams(raw.marketStreams);
    return { ...owner, action: "start", request, ...(marketStreams ? { marketStreams } : {}) };
  }
  if (raw.action === "markets") {
    if (owner.sequence === 0) invalid("Requested-market changes require an initialized ordered live session.");
    return { ...owner, action: "markets", events: validatePineLiveMarketEvents(raw.events) };
  }
  if (raw.action === "viewport") {
    if (owner.sequence === 0 || !Object.prototype.hasOwnProperty.call(raw, "viewport") || raw.viewport === undefined) invalid("Live Pine viewport changes require an ordered explicit range or null.");
    return { ...owner, action: "viewport", viewport: validatePineViewport(raw.viewport) };
  }
  if (raw.action !== "update" || owner.sequence === 0 || typeof raw.confirmed !== "boolean") invalid("Live Pine updates require an ordered explicit confirmation event.");
  if (raw.collectAlerts !== undefined && typeof raw.collectAlerts !== "boolean") invalid("Live Pine alert collection requires an explicit boolean.");
  if (raw.collectConditions !== undefined && typeof raw.collectConditions !== "boolean") invalid("Live Pine condition collection requires an explicit boolean.");
  let source: PineLiveSourceEvent | undefined;
  if (raw.source !== undefined) {
    const event = plain(raw.source);
    if (Object.keys(event).some(key => !["bar", "confirmed"].includes(key)) || typeof event.confirmed !== "boolean") invalid("Source updates require an actual candle and explicit confirmation.");
    const candle = plain(event.bar);
    if (!["time", "open", "high", "low", "close", "volume"].every(key => Object.prototype.hasOwnProperty.call(candle, key))) invalid("Source updates require explicit OHLCV fields.");
    source = { bar: validatePineBar(candle), confirmed: event.confirmed };
  }
  return { ...owner, action: "update", bar: validatePineBar(raw.bar), confirmed: raw.confirmed, ...(source ? { source } : {}), ...(raw.collectAlerts !== undefined ? { collectAlerts: raw.collectAlerts } : {}), ...(raw.collectConditions !== undefined ? { collectConditions: raw.collectConditions } : {}) };
}

/** A chart update and its real source event are accepted atomically by host and worker. */
export function advancePineLiveSource(snapshot: PineSourceSnapshot | undefined, sourceConfirmed: boolean,
  command: Extract<PineLiveRequest, { action: "update" }>, timeframe: string): PineSourceSnapshot | undefined {
  if (!snapshot) {
    if (command.source) invalid("A source update requires the session's initialized source history.");
    return undefined;
  }
  const event = command.source;
  if (!event) invalid("This live session requires its source candle on every chart update.");
  const base = pineFixedTimeframeDuration(snapshot.timeframe), chart = pineFixedTimeframeDuration(timeframe);
  if (!base || !chart || base >= chart || chart % base !== 0 || event.bar.time % base !== 0) invalid("Live source candles require a lower aligned chart timeframe.");
  const previous = snapshot.bars.at(-1);
  const append = !previous || event.bar.time > previous.time;
  if (previous && (event.bar.time < previous.time || append && (!sourceConfirmed || event.bar.time !== previous.time + base)
    || !append && sourceConfirmed)) invalid("Source history cannot be revised, skipped or advanced before confirmation.");
  if (append && snapshot.bars.length >= PINE_LIMITS.sourceBars) throw new PineProtocolError("BAR_LIMIT", "Live source history reached 200,000 candles. Reapply the indicator for a fresh window.");
  const bars = append ? [...snapshot.bars, event.bar] : [...snapshot.bars.slice(0, -1), event.bar];
  const start = Math.floor(event.bar.time / chart) * chart;
  if (command.bar.time !== start || command.confirmed !== (event.confirmed && event.bar.time + base === start + chart)) invalid("Source confirmation must match the chart's actual closing boundary.");
  let first = bars.length - 1;
  while (first > 0 && bars[first - 1].time >= start) first--;
  const children = bars.slice(first);
  if (children[0].time !== start || children.some((bar, i) => bar.time !== start + i * base)) invalid("A live chart candle requires all received constituents from its opening boundary.");
  const aggregate = { open: children[0].open, high: Math.max(...children.map(bar => bar.high)), low: Math.min(...children.map(bar => bar.low)), close: event.bar.close,
    volume: children.reduce((total, bar) => total + bar.volume, 0) };
  if (!["open", "high", "low", "close", "volume"].every(key => aggregate[key as keyof typeof aggregate] === command.bar[key as keyof Candle])) invalid("The chart candle does not match its actual source constituents.");
  return { timeframe: snapshot.timeframe, bars };
}
/** Bind every response to its immutable owner, command and exact expected history. */
export function validatePineLiveResponse(value: unknown, command: PineLiveRequest, expected: PineRequest, conditionProof?: PineConditionSampleProof): PineExecutionResult {
  if (command.action === "markets") invalid("Requested-market commands cannot publish chart execution results.");
  const raw = plain(value);
  const owner = identity(raw);
  if (Object.keys(raw).some(key => !["protocol", "sessionId", "sequence", "response"].includes(key))
    || owner.sessionId !== command.sessionId || owner.sequence !== command.sequence
    || expected.id !== pineLiveRequestId(owner.sessionId, owner.sequence)) invalid("Live Pine response does not match the active command.");
  const result = validatePineResponse(raw.response, expected);
  if (result.kind !== "run" || !["indicator", "strategy"].includes(result.declaration) || result.audit.mode !== "live") invalid("Live Pine sessions require study execution results.");
  if (result.alertEvents !== undefined) {
    if (command.action !== "update" || command.collectAlerts !== true) invalid("Pine alerts cannot publish outside their armed update.");
    const latest = expected.bars!.at(-1)!;
    if (result.alertEvents.events.some(event => event.time !== latest.time || event.time !== command.bar.time
      || event.barIndex !== expected.bars!.length - 1 || event.freq === "once_per_bar_close" && !command.confirmed)) invalid("Pine alerts do not belong to the latest owned candle and confirmation.");
  }
  if (result.conditionSamples !== undefined || command.action === "update" && command.collectConditions === true) {
    if (command.action !== "update" || command.collectConditions !== true || result.declaration !== "indicator"
      || !conditionProof || !result.conditionSamples) invalid("Condition samples require their armed update and fresh calculation owner.");
    const latest = expected.bars!.at(-1)!, batch = result.conditionSamples;
    const definitions = result.alertConditions ?? [];
    if (batch.chartTime !== latest.time || batch.chartTime !== command.bar.time || batch.chartBarIndex !== expected.bars!.length - 1
      || definitions.length !== conditionProof.conditions.length || definitions.some((definition, index) => {
        const trusted = conditionProof.conditions[index];
        return definition.id !== trusted.id || definition.title !== trusted.title || definition.message !== trusted.message;
      })) invalid("Condition samples changed their chart identity or prepared definitions.");
    validatePineConditionSampleOwnership(batch, conditionProof);
  }
  return result;
}

export function validatePineLiveMarketResponse(value: unknown, command: Extract<PineLiveRequest, { action: "markets" }>, expected: PineRequest, ledger: PineLiveMarketLedger): PineLiveMarketReceipt {
  const raw = plain(value), owner = identity(raw);
  if (Object.keys(raw).some(key => !["protocol", "sessionId", "sequence", "response"].includes(key))
    || owner.sessionId !== command.sessionId || owner.sequence !== command.sequence || expected.id !== pineLiveRequestId(owner.sessionId, owner.sequence)) invalid("Requested-market acknowledgement belongs to a different command.");
  const response = plain(raw.response);
  if (response.status === "failed") validatePineResponse(response, expected);
  if (response.id !== expected.id || response.status !== "completed" || Object.keys(response).some(key => !["id", "status", "ack"].includes(key))) invalid("Requested-market commands require their owned acknowledgement without chart results.");
  return validatePineLiveMarketReceipt(response.ack, ledger);
}
