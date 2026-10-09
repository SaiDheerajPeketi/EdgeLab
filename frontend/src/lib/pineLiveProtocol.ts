import type { Candle } from "./api";
import { PineProtocolError, validatePineBar, validatePineViewport, validatePineRequest, validatePineResponse, type PineExecutionResult, type PineRequest, type PineResponse, type PineViewport } from "./pineProtocol";

export const PINE_LIVE_PROTOCOL = "pine-live-v1" as const;
export const PINE_LIVE_QUEUE_LIMIT = 32;
type LiveIdentity = { protocol: typeof PINE_LIVE_PROTOCOL; sessionId: string; sequence: number };
export type PineLiveRequest = LiveIdentity & (
  { action: "start"; request: PineRequest } |
  { action: "update"; bar: Candle; confirmed: boolean } |
  { action: "viewport"; viewport: PineViewport | null }
);
export type PineLiveResponse = LiveIdentity & { response: PineResponse };

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
  const fields = raw.action === "start" ? ["protocol", "sessionId", "sequence", "action", "request"] : raw.action === "viewport" ? ["protocol", "sessionId", "sequence", "action", "viewport"] : ["protocol", "sessionId", "sequence", "action", "bar", "confirmed"];
  if (Object.keys(raw).some(key => !fields.includes(key))) invalid("Unexpected live Pine request field.");
  if (raw.action === "start") {
    if (owner.sequence !== 0) invalid("Live Pine initialization requires sequence zero.");
    const request = validatePineRequest(raw.request);
    if (request.action !== "run" || request.mode !== "live" || request.id !== pineLiveRequestId(owner.sessionId, 0)) invalid("Live Pine initialization requires its owned run request.");
    return { ...owner, action: "start", request };
  }
  if (raw.action === "viewport") {
    if (owner.sequence === 0 || !Object.prototype.hasOwnProperty.call(raw, "viewport") || raw.viewport === undefined) invalid("Live Pine viewport changes require an ordered explicit range or null.");
    return { ...owner, action: "viewport", viewport: validatePineViewport(raw.viewport) };
  }
  if (raw.action !== "update" || owner.sequence === 0 || typeof raw.confirmed !== "boolean") invalid("Live Pine updates require an ordered explicit confirmation event.");
  return { ...owner, action: "update", bar: validatePineBar(raw.bar), confirmed: raw.confirmed };
}
/** Bind every response to its immutable owner, command and exact expected history. */
export function validatePineLiveResponse(value: unknown, command: PineLiveRequest, expected: PineRequest): PineExecutionResult {
  const raw = plain(value);
  const owner = identity(raw);
  if (Object.keys(raw).some(key => !["protocol", "sessionId", "sequence", "response"].includes(key))
    || owner.sessionId !== command.sessionId || owner.sequence !== command.sequence
    || expected.id !== pineLiveRequestId(owner.sessionId, owner.sequence)) invalid("Live Pine response does not match the active command.");
  const result = validatePineResponse(raw.response, expected);
  if (result.kind !== "run" || result.declaration !== "indicator" || result.audit.mode !== "live") invalid("Live Pine sessions require indicator execution results.");
  return result;
}
