import { boundedPineMetadataBytes, PineProtocolError } from "./pineProtocol";
import type { Candle } from "./api";

export type PineAlertPlotDefinition = Readonly<{ callsiteId: string; title?: string; width: 1 | 4 }>;
export type PineAlertPlotValues = { numbered: (number | null)[]; named: { title: string; value: number | null }[] };
export type PineAlertMessageContext = {
  ticker: string; exchange: string; interval: string; currency?: string; basecurrency?: string;
  bar: Pick<Candle, "time" | "open" | "high" | "low" | "close" | "volume">;
  receivedAt: number; plots: PineAlertPlotValues;
};
const fail = (message: string): never => { throw new PineProtocolError("INVALID_ALERT_PLACEHOLDERS", message); };
const numeric = (value: unknown): number | null => typeof value === "boolean" ? Number(value)
  : typeof value === "number" && Number.isFinite(value) ? value : null;

/** Read calculation values before chart offsets, projection and display filtering. */
export function capturePineAlertPlots(plots: unknown, definitions: readonly PineAlertPlotDefinition[], openTimeMs: number): PineAlertPlotValues {
  if (!Number.isSafeInteger(openTimeMs) || openTimeMs < 0 || !Array.isArray(definitions) || definitions.length > 64) fail("Invalid authored plot snapshot.");
  boundedPineMetadataBytes(definitions);
  if (!plots || typeof plots !== "object" || Array.isArray(plots)) fail("Missing native plot channels.");
  const channels = new Map<string, Record<string, unknown>>();
  for (const field of Object.values(Object.getOwnPropertyDescriptors(plots))) {
    if (!("value" in field) || !field.enumerable) continue;
    const plot = field.value;
    if (!plot || typeof plot !== "object") continue;
    const id = Object.getOwnPropertyDescriptor(plot, "_callsiteId");
    if (id && "value" in id && typeof id.value === "string") {
      if (channels.has(id.value)) fail("Duplicate native plot call identity.");
      channels.set(id.value, plot);
    }
  }
  const numbered: (number | null)[] = [], named: PineAlertPlotValues["named"] = [];
  const ids = new Set<string>(), titles = new Set<string>();
  for (const definition of definitions) {
    if (!definition || Object.keys(definition).some(key => !["callsiteId", "title", "width"].includes(key))
      || typeof definition.callsiteId !== "string" || !/^#[0-9]{1,6}$/.test(definition.callsiteId)
      || ids.has(definition.callsiteId) || ![1, 4].includes(definition.width)
      || definition.title !== undefined && (typeof definition.title !== "string" || definition.title.length > 4096)) fail("Invalid authored plot definition.");
    ids.add(definition.callsiteId);
    const plot = channels.get(definition.callsiteId), field = plot && Object.getOwnPropertyDescriptor(plot, "data");
    const data = field && "value" in field && Array.isArray(field.value) ? field.value : undefined;
    const tail = data?.length ? Object.getOwnPropertyDescriptor(data, String(data.length - 1)) : undefined;
    const point = tail && "value" in tail ? tail.value : undefined;
    const time = point && Object.getOwnPropertyDescriptor(point, "time");
    const fieldValue = point && Object.getOwnPropertyDescriptor(point, "value");
    const value = time && "value" in time && time.value === openTimeMs && fieldValue && "value" in fieldValue ? fieldValue.value : undefined;
    for (let component = 0; component < definition.width && numbered.length < 20; component++) {
      const part = definition.width === 1 ? value : Array.isArray(value) ? Object.getOwnPropertyDescriptor(value, String(component))?.value : undefined;
      numbered.push(numeric(part));
    }
    if (definition.width === 1 && definition.title !== undefined && !titles.has(definition.title)) {
      titles.add(definition.title);
      named.push({ title: definition.title, value: numeric(value) });
    }
  }
  return { numbered, named };
}

/** Fixed-point text also handles tiny prices without exponent notation or rounding. */
function numberText(value: number | null): string {
  if (value === null) return "NaN";
  const text = String(value), match = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/.exec(text);
  if (!match) return text;
  const [, sign, whole, fraction = "", exponent] = match, digits = whole + fraction;
  const point = whole.length + Number(exponent);
  return sign + (point <= 0 ? "0." + "0".repeat(-point) + digits
    : point >= digits.length ? digits + "0".repeat(point - digits.length)
    : digits.slice(0, point) + "." + digits.slice(point));
}
function utcSeconds(milliseconds: number): string {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > 8_640_000_000_000_000) fail("Invalid alert timestamp.");
  return new Date(Math.floor(milliseconds / 1000) * 1000).toISOString().replace(".000Z", "Z");
}

/** Plain text only. Unknown placeholders remain visible; substitutions are never rescanned. */
export function resolvePineAlertMessage(template: string, context: PineAlertMessageContext): string {
  if (typeof template !== "string" || template.length > 4096) fail("Alert templates are limited to 4,096 characters.");
  boundedPineMetadataBytes(context);
  if (!context || typeof context !== "object" || Array.isArray(context)
    || !context.bar || typeof context.bar !== "object" || Array.isArray(context.bar)
    || !context.plots || typeof context.plots !== "object" || Array.isArray(context.plots)
    || Object.keys(context.plots).some(key => !["numbered", "named"].includes(key))
    || !Array.isArray(context.plots.numbered) || context.plots.numbered.length > 20
    || !Array.isArray(context.plots.named) || context.plots.named.length > 64) fail("Invalid alert plot values.");
  const number = (value: unknown): number | null => {
    if (value === null || typeof value === "number" && Number.isFinite(value)) return value as number | null;
    return fail("Alert plot values must be finite numbers or missing values.");
  };
  const text = (value: unknown): string => typeof value === "string" && value.length <= 512 ? value : fail("Invalid alert instrument identity.");
  const named = new Map<string, number | null>();
  for (const entry of context.plots.named) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || Object.keys(entry).some(key => !["title", "value"].includes(key))
      || typeof entry.title !== "string" || entry.title.length > 4096) fail("Invalid named alert plot value.");
    const value = number(entry.value);
    if (!named.has(entry.title)) named.set(entry.title, value);
  }
  const numbered = context.plots.numbered.map(number);
  if (!Number.isSafeInteger(context.bar.time) || context.bar.time < 0
    || ["open", "high", "low", "close", "volume"].some(key => typeof context.bar[key as keyof typeof context.bar] !== "number"
      || !Number.isFinite(context.bar[key as keyof typeof context.bar]))) fail("Invalid alert calculation candle.");
  const values = new Map<string, string>([
    ["ticker", text(context.ticker)], ["exchange", text(context.exchange)], ["interval", text(context.interval)],
    ["syminfo.currency", context.currency === undefined ? "na" : text(context.currency)],
    ["syminfo.basecurrency", context.basecurrency === undefined ? "na" : text(context.basecurrency)],
    ["time", utcSeconds(context.bar.time * 1000)], ["timenow", utcSeconds(context.receivedAt)],
    ...(["open", "high", "low", "close", "volume"] as const).map(key => [key, numberText(number(context.bar[key]))] as [string, string]),
  ]);
  let length = 0, previous = 0;
  const output: string[] = [];
  for (const match of template.matchAll(/\{\{([^{}]*)\}\}/g)) {
    const prefix = template.slice(previous, match.index), token = match[1];
    let replacement = values.get(token);
    const index = /^plot_(0|[1-9]\d*)$/.exec(token), title = /^plot\("([^"\r\n]*)"\)$/.exec(token);
    if (replacement === undefined && index && Number(index[1]) < numbered.length) replacement = numberText(numbered[Number(index[1])]);
    if (replacement === undefined && title && named.has(title[1])) replacement = numberText(named.get(title[1])!);
    const piece = prefix + (replacement ?? match[0]);
    length += piece.length;
    if (length > 4096) fail("The expanded alert message exceeds 4,096 characters.");
    output.push(piece); previous = match.index! + match[0].length;
  }
  const suffix = template.slice(previous);
  if (length + suffix.length > 4096) fail("The expanded alert message exceeds 4,096 characters.");
  output.push(suffix);
  return output.join("");
}
