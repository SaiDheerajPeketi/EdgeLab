import { PineProtocolError } from "./pineProtocol";

export const PINE_ALERT_EVENT_LIMIT = 64;
export const PINE_ALERT_DROPPED_LIMIT = 1_000_000_000;
export type PineAlertEvent = {
  id: string; message: string; freq: "all" | "once_per_bar" | "once_per_bar_close";
  time: number; barIndex: number;
};
export type PineAlertEvents = { events: PineAlertEvent[]; dropped: number };
function invalid(): never { throw new PineProtocolError("INVALID_ALERT_EVENTS", "Invalid or oversized owned Pine alert events."); }
function fields(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some(key => !descriptors[key]
    || !("value" in descriptors[key]) || !descriptors[key].enumerable)) invalid();
  return value as Record<string, unknown>;
}
export function validatePineAlertEvent(value: unknown): PineAlertEvent {
  const event = fields(value, ["id", "message", "freq", "time", "barIndex"]);
  if (typeof event.id !== "string" || !event.id || event.id.length > 128
    || typeof event.message !== "string" || event.message.length > 4096
    || typeof event.freq !== "string" || !["all", "once_per_bar", "once_per_bar_close"].includes(event.freq)
    || !Number.isSafeInteger(event.time) || (event.time as number) < 0 || (event.time as number) > 253402300799
    || !Number.isSafeInteger(event.barIndex) || (event.barIndex as number) < 0 || (event.barIndex as number) >= 20_000) invalid();
  return { id: event.id, message: event.message, freq: event.freq as PineAlertEvent["freq"], time: event.time as number, barIndex: event.barIndex as number };
}
export function validatePineAlertEvents(value: unknown): PineAlertEvents {
  const batch = fields(value, ["events", "dropped"]), events = batch.events;
  if (!Array.isArray(events) || Object.getPrototypeOf(events) !== Array.prototype || events.length > PINE_ALERT_EVENT_LIMIT
    || Reflect.ownKeys(events).length !== events.length + 1
    || !Number.isSafeInteger(batch.dropped) || (batch.dropped as number) < 0 || (batch.dropped as number) > PINE_ALERT_DROPPED_LIMIT) invalid();
  const checked = [];
  for (let index = 0; index < events.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(events, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalid();
    checked.push(validatePineAlertEvent(descriptor.value));
  }
  return { events: checked, dropped: batch.dropped as number };
}
