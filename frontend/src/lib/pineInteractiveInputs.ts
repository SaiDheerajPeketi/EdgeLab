import { pineInputActive } from "./pineInputActivation";
import type { PineInputDefinition, PineInputValue } from "./pineProtocol";

export type PineInputAnchor = {
  id: string; kind: "price" | "time" | "point"; priceId?: string; timeId?: string; label: string;
};
export type PineAnchorValues = { price?: number; time?: number };

/** Pine pairs require one price and one time, with no third declaration on the inline row. */
export function pineInputAnchors(definitions: PineInputDefinition[]): PineInputAnchor[] {
  const rows = new Map<string, PineInputDefinition[]>();
  for (const definition of definitions) {
    if (!definition.inline) continue;
    const key = JSON.stringify([definition.group ?? "", definition.inline]);
    rows.set(key, [...(rows.get(key) ?? []), definition]);
  }
  const emitted = new Set<string>();
  const anchors: PineInputAnchor[] = [];
  for (const definition of definitions) {
    if (!["price", "time"].includes(definition.type) || emitted.has(definition.id)) continue;
    const row = definition.inline ? rows.get(JSON.stringify([definition.group ?? "", definition.inline])) : undefined;
    const price = row?.find(item => item.type === "price"), time = row?.find(item => item.type === "time");
    if (row?.length === 2 && price && time && price.id !== time.id) {
      anchors.push({ id: `point:${price.id}:${time.id}`, kind: "point", priceId: price.id, timeId: time.id,
        label: row.map(item => item.title || item.name).join(" / ") });
      emitted.add(price.id); emitted.add(time.id);
    } else {
      anchors.push({ id: definition.id, kind: definition.type as "price" | "time", label: definition.title || definition.name,
        ...(definition.type === "price" ? { priceId: definition.id } : { timeId: definition.id }) });
      emitted.add(definition.id);
    }
  }
  return anchors;
}

function anchorDefinitions(anchor: PineInputAnchor, definitions: PineInputDefinition[]): PineInputDefinition[] | undefined {
  const canonical = pineInputAnchors(definitions).find(item => item.id === anchor.id && item.kind === anchor.kind
    && item.priceId === anchor.priceId && item.timeId === anchor.timeId);
  if (!canonical) return undefined;
  const members = [anchor.priceId, anchor.timeId].filter((id): id is string => id !== undefined);
  const result = members.map(id => definitions.filter(item => item.id === id));
  return result.every(matches => matches.length === 1) ? result.map(matches => matches[0]) : undefined;
}

function validValue(definition: PineInputDefinition, value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
    && (definition.type !== "time" || Number.isSafeInteger(value))
    && (definition.minval === undefined || value >= definition.minval)
    && (definition.maxval === undefined || value <= definition.maxval)
    && (definition.options === undefined || definition.options.includes(value));
}

export function pineAnchorActive(anchor: PineInputAnchor, definitions: PineInputDefinition[], inputs: Record<string, PineInputValue>): boolean {
  const members = anchorDefinitions(anchor, definitions);
  if (!members) return false;
  try { return members.every(definition => pineInputActive(definition, definitions, inputs)); }
  catch { return false; }
}

export function pineAnchorValues(anchor: PineInputAnchor, definitions: PineInputDefinition[], inputs: Record<string, PineInputValue>): PineAnchorValues | undefined {
  const members = anchorDefinitions(anchor, definitions);
  if (!members) return undefined;
  const values: PineAnchorValues = {};
  for (const definition of members) {
    const value = Object.prototype.hasOwnProperty.call(inputs, definition.id) ? inputs[definition.id] : definition.defval;
    if (!validValue(definition, value)) return undefined;
    values[definition.type === "price" ? "price" : "time"] = value;
  }
  return values;
}

/** Point updates contain both members, or nothing. Timestamps remain integer UNIX milliseconds. */
export function pineAnchorPatch(anchor: PineInputAnchor, values: PineAnchorValues, definitions: PineInputDefinition[]): Record<string, PineInputValue> | null {
  const members = anchorDefinitions(anchor, definitions);
  if (!members) return null;
  const entries: Array<[string, PineInputValue]> = [];
  for (const definition of members) {
    const value = values[definition.type === "price" ? "price" : "time"];
    if (!validValue(definition, value)) return null;
    entries.push([definition.id, value]);
  }
  return Object.fromEntries(entries);
}

export function formatPineUtcTime(value: unknown): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, -1) : "";
}

/** Parse explicit UTC fields without local-zone conversion or Date's calendar rollover. */
export function parsePineUtcTime(value: string): number | undefined {
  const match = /^(\d{4,}|[+-]\d{6})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const hour = Number(match[4]), minute = Number(match[5]), second = Number(match[6] ?? 0), millisecond = Number((match[7] ?? "").padEnd(3, "0"));
  if (!Number.isSafeInteger(year) || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return undefined;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millisecond);
  const parsed = date.getTime();
  return Number.isSafeInteger(parsed) && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    && date.getUTCHours() === hour && date.getUTCMinutes() === minute && date.getUTCSeconds() === second && date.getUTCMilliseconds() === millisecond ? parsed : undefined;
}
