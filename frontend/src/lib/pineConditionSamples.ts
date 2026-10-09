import { canonicalPineTimeframe, PINE_LIMITS, PineProtocolError, validatePineBar, type PineAlertConditionDefinition } from "./pineProtocol";
import type { PineAlertPlotValues } from "./pineAlertPlaceholders";
import type { PineCalculationSnapshot } from "./pineCalculationSnapshot";

export const PINE_CONDITION_SAMPLE_LIMIT = 64;
export const PINE_CONDITION_SAMPLE_BYTES = 262_144;
export const PINE_CONDITION_DROPPED_LIMIT = 1_000_000_000;
export type PineConditionSample = {
  barIndex: number;
  bar: { time: number; open: number; high: number; low: number; close: number; volume: number };
  confirmed: boolean;
  conditions: boolean[];
  plots: PineAlertPlotValues;
};
export type PineConditionSamples = {
  chartTime: number; chartBarIndex: number; calculationTimeframe: string;
  samples: PineConditionSample[]; dropped: number;
};
/** Created from the fresh start result and immutable inputs captured for this command. */
export type PineConditionSampleProof = {
  conditions: readonly PineAlertConditionDefinition[];
  calculation: PineCalculationSnapshot;
};
function invalid(message = "Invalid or oversized Pine condition samples."): never {
  throw new PineProtocolError("INVALID_CONDITION_SAMPLES", message);
}
function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some(key => !descriptors[key]
    || !("value" in descriptors[key]) || !descriptors[key].enumerable)) invalid();
  return value as Record<string, unknown>;
}
function slots(value: unknown, limit: number, expected?: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > limit
    || expected !== undefined && value.length !== expected || Reflect.ownKeys(value).length !== value.length + 1) invalid();
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalid();
  }
  return value;
}
function index(value: unknown, limit: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) >= limit) invalid();
  return value as number;
}
function numeric(value: unknown): number | null {
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) invalid();
  return value as number | null;
}

/** Structural admission never executes accessors or authorizes a returned condition definition. */
export function validatePineConditionSamples(value: unknown, conditionCount: number): PineConditionSamples {
  index(conditionCount, PINE_LIMITS.plots + 1);
  const raw = fields(value, ["chartTime", "chartBarIndex", "calculationTimeframe", "samples", "dropped"]);
  const chartTime = index(raw.chartTime, 253_402_300_800), chartBarIndex = index(raw.chartBarIndex, PINE_LIMITS.bars);
  if (typeof raw.calculationTimeframe !== "string" || raw.calculationTimeframe.length > 8
    || canonicalPineTimeframe(raw.calculationTimeframe) !== raw.calculationTimeframe) invalid();
  const dropped = index(raw.dropped, PINE_CONDITION_DROPPED_LIMIT + 1);
  let textBytes = 0, previousIndex = -1;
  const samples = slots(raw.samples, PINE_CONDITION_SAMPLE_LIMIT).map((value): PineConditionSample => {
    const sample = fields(value, ["barIndex", "bar", "confirmed", "conditions", "plots"]);
    const barIndex = index(sample.barIndex, PINE_LIMITS.sourceBars);
    if (barIndex <= previousIndex || typeof sample.confirmed !== "boolean") invalid();
    previousIndex = barIndex;
    const rawBar = fields(sample.bar, ["time", "open", "high", "low", "close", "volume"]);
    const { time, open, high, low, close, volume } = validatePineBar(rawBar);
    const conditions = slots(sample.conditions, PINE_LIMITS.plots, conditionCount).map(value => {
      if (typeof value !== "boolean") invalid();
      return value;
    });
    const plotValues = fields(sample.plots, ["numbered", "named"]), titles = new Set<string>();
    const numbered = slots(plotValues.numbered, 20).map(numeric);
    const named = slots(plotValues.named, PINE_LIMITS.plots).map(value => {
      const entry = fields(value, ["title", "value"]);
      if (typeof entry.title !== "string" || entry.title.length > 4096 || titles.has(entry.title)) invalid();
      textBytes += new TextEncoder().encode(entry.title).length;
      if (textBytes > PINE_CONDITION_SAMPLE_BYTES) invalid();
      titles.add(entry.title);
      return { title: entry.title, value: numeric(entry.value) };
    });
    return { barIndex, bar: { time, open, high, low, close, volume }, confirmed: sample.confirmed, conditions, plots: { numbered, named } };
  });
  const checked = { chartTime, chartBarIndex, calculationTimeframe: raw.calculationTimeframe, samples, dropped };
  if (new TextEncoder().encode(JSON.stringify(checked)).length > PINE_CONDITION_SAMPLE_BYTES) invalid();
  return checked;
}

/** Numerical ownership comes from the command's calculation history, never its display index. */
export function validatePineConditionSampleOwnership(batch: PineConditionSamples, proof: PineConditionSampleProof): void {
  const calculation = proof.calculation;
  if (batch.calculationTimeframe !== calculation.timeframe) invalid("Condition samples use a different calculation timeframe.");
  for (const sample of batch.samples) {
    const bar = calculation.bars[sample.barIndex];
    if (!bar || sample.conditions.length !== proof.conditions.length
      || !["time", "open", "high", "low", "close", "volume"].every(key => sample.bar[key as keyof typeof sample.bar] === bar[key as keyof typeof bar])
      || sample.confirmed !== (sample.barIndex < calculation.bars.length - 1 || calculation.confirmed))
      invalid("Condition samples do not belong to their actual calculation candle and confirmation.");
  }
}
