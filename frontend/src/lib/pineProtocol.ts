import { validatePineInputCondition, pineInputConditionReferences, pineInputActive } from "./pineInputActivation";
import { validatePineAlertEvents, type PineAlertEvents } from "./pineAlertEvents";
import type { PineInputCondition } from "./pineInputActivation";
import type { Candle } from "./api";
import { decodePinePackedPlots, validatePinePackedBuffers, validatePinePlotOptions } from "./pinePacked";
import type { PinePlotPoint } from "./pinePacked";
import { validatePineMarketData, type PineMarketDataConfig } from "./pineMarketProtocol";
import { pineLiveObservationCutoff, validatePineLiveObservation, type PineLiveObservation } from "./pineLiveObservation";

export const PINE_LIMITS = Object.freeze({ sourceBytes: 20_000, bars: 20_000, sourceBars: 200_000, inputs: 24, plots: 64, points: 1_280_000, legacyPoints: 4_096, trades: 10_000, resultBytes: 16_000_000, metadataBytes: 1_000_000, loops: 10_000, diagnostics: 100, lines: 500, lineFills: 500, boxes: 500, labels: 500, polylines: 100, polylinePoints: 10_000, polylineTotalPoints: 32_000, tables: 9, tableCells: 4096, tablePercent: 1_000_000 });
export type PineInputValue = boolean | number | string;
export type PineScalar = PineInputValue | null;
export type PineDiagnostic = { code: string; message: string; severity: "warning" | "error"; line: number; column: number };
export type PineEnumMember = { id: string; label: string };
export type PineEnumMetadata = { enumVersion: 1; enumType: string; enumMembers: PineEnumMember[] };
export type PineInputDefinition = {
  id: string; name: string; type: string; defval: PineScalar;
  varId?: string; title?: string; tooltip?: string; group?: string; display?: string;
  active?: boolean; activeCondition?: PineInputCondition; confirm?: boolean; inline?: string; options?: PineScalar[];
  minval?: number; maxval?: number; step?: number;
  enumVersion?: 1; enumType?: string; enumMembers?: PineEnumMember[];
};
export type PineStrategySettings = {
  initial_capital?: number; default_qty_type?: "fixed" | "cash" | "percent_of_equity";
  default_qty_value?: number; commission_type?: "percent" | "cash_per_contract" | "cash_per_order";
  commission_value?: number; slippage?: number; pyramiding?: number; process_orders_on_close?: boolean;
  calc_on_every_tick?: boolean; calc_on_order_fills?: boolean; use_bar_magnifier?: boolean;
};
export type PineContext = { symbol: string; timeframe: string; mintick?: number; pointvalue?: number; mincontract?: number; quantityStep?: number; currency?: string; basecurrency?: string };
export type PineViewport = { from: number; to: number };
export type PineSourceSnapshot = { timeframe: string; bars: readonly Candle[] };
export type PineRequest = {
  id: string; action: "prepare" | "run"; source: string; bars?: Candle[]; sourceSnapshot?: PineSourceSnapshot; viewport?: PineViewport | null;
  strategySettings?: PineStrategySettings; inputs?: Record<string, PineInputValue>; mode?: "historical" | "live"; context?: PineContext; marketData?: PineMarketDataConfig; liveObservation?: PineLiveObservation;
};
export type PinePrepareResult = {
  kind: "prepare"; source: string; language: "pine"; pineVersion: 5 | 6;
  declaration: "indicator" | "strategy"; name: string; overlay: boolean; behindChart?: boolean;
  inputDefinitions: PineInputDefinition[]; diagnostics: PineDiagnostic[]; usesVisibleRange?: boolean;
};
export type PinePlot = {
  id: string; name: string; style: string; overlay: boolean; options: Record<string, PineScalar>;
  points: readonly PinePlotPoint[];
};
export type PineLineDrawing = {
  id: string; x1: number | null; y1: number | null; x2: number | null; y2: number | null;
  xloc: "bar_index" | "bar_time"; extend: "none" | "left" | "right" | "both";
  color: string | null; style: "solid" | "dashed" | "dotted" | "arrow_left" | "arrow_right" | "arrow_both";
  width: number; overlay: boolean; forceOverlay: boolean;
};
export type PineBoxDrawing = {
  id: string; left: number | null; top: number | null; right: number | null; bottom: number | null;
  xloc: "bar_index" | "bar_time"; extend: "none" | "left" | "right" | "both";
  borderColor: string | null; borderStyle: "solid" | "dashed" | "dotted"; borderWidth: number; bgcolor: string | null;
  text: string; textColor: string | null; textSize: number; textHalign: "left" | "center" | "right";
  textValign: "top" | "center" | "bottom"; textWrap: "none" | "auto"; textFontFamily: "default" | "monospace";
  textFormatting: "none" | "bold" | "italic" | "bolditalic"; overlay: boolean; forceOverlay: boolean;
};
export const PINE_LABEL_STYLES = ["label_down", "label_up", "label_left", "label_right", "label_lower_left", "label_lower_right", "label_upper_left", "label_upper_right", "label_center", "circle", "square", "diamond", "flag", "arrowup", "arrowdown", "cross", "xcross", "triangleup", "triangledown", "none", "text_outline"] as const;
export type PineLabelDrawing = {
  id: string; x: number | null; y: number | null; xloc: "bar_index" | "bar_time"; yloc: "price" | "abovebar" | "belowbar";
  color: string | null; style: typeof PINE_LABEL_STYLES[number]; text: string; textColor: string | null; textSize: number;
  textAlign: "left" | "center" | "right"; tooltip: string; textFontFamily: "default" | "monospace";
  textFormatting: "none" | "bold" | "italic" | "bolditalic"; overlay: boolean; forceOverlay: boolean;
};
export type PinePolylineDrawing = {
  id: string; points: { x: number | null; y: number | null }[]; curved: boolean; closed: boolean;
  xloc: "bar_index" | "bar_time"; lineColor: string | null; fillColor: string | null;
  lineStyle: PineLineDrawing["style"]; lineWidth: number; overlay: boolean; forceOverlay: boolean;
};
export const PINE_TABLE_POSITIONS = ['top_left', 'top_center', 'top_right', 'middle_left', 'middle_center', 'middle_right', 'bottom_left', 'bottom_center', 'bottom_right'] as const;
export type PineTableCell = {
  populated: boolean; text: string; width: number; height: number; textColor: string | null;
  textHalign: 'left' | 'center' | 'right'; textValign: 'top' | 'center' | 'bottom'; textSize: number;
  bgcolor: string | null; tooltip: string; textFontFamily: 'default' | 'monospace';
  textFormatting: 'none' | 'bold' | 'italic' | 'bolditalic';
};
export type PineTableMerge = { startCol: number; startRow: number; endCol: number; endRow: number };
export type PineTableDrawing = {
  id: string; position: typeof PINE_TABLE_POSITIONS[number]; columns: number; rows: number;
  cells: (PineTableCell | null)[][]; merges: PineTableMerge[]; bgcolor: string | null;
  frameColor: string | null; frameWidth: number; borderColor: string | null; borderWidth: number;
  overlay: boolean; forceOverlay: boolean;
};
export type PineLineFillDrawing = { id: string; line1: string; line2: string; color: string | null; overlay: boolean };
export type PineStrategyResult = {
  config: Record<string, PineScalar>; metrics: Record<string, PineScalar>;
  closedTrades: Record<string, PineScalar>[]; openTrades: Record<string, PineScalar>[]; pendingOrders: Record<string, PineScalar>[];
};
export type PineExecutionResult = Omit<PinePrepareResult, "kind"> & {
  alertEvents?: PineAlertEvents;
  kind: "run"; inputs: Record<string, PineInputValue>; plots: PinePlot[]; lines?: PineLineDrawing[]; lineFills?: PineLineFillDrawing[]; boxes?: PineBoxDrawing[]; labels?: PineLabelDrawing[]; polylines?: PinePolylineDrawing[]; tables?: PineTableDrawing[]; strategy?: PineStrategyResult;
  audit: { engine: "PineTS"; engineVersion: "0.11.0"; bars: number; sourceBytes: number; mode: "historical" | "live"; elapsedMs: number };
};
export type PineResult = PinePrepareResult | PineExecutionResult;
export type PineResponse = { id: string; status: "completed"; result: PineResult } | { id: string; status: "failed"; error: { code: string; message: string } };

export class PineProtocolError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "PineProtocolError"; this.code = code; }
}
function fail(message: string, code = "INVALID_MESSAGE"): never { throw new PineProtocolError(code, message); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("Expected a plain object.");
  const result = value as Record<string, unknown>;
  for (const key of Object.keys(result)) if (["__proto__", "prototype", "constructor"].includes(key)) fail("Unsafe object key.");
  return result;
}
function string(value: unknown, limit = 4_096): string {
  if (typeof value !== "string" || value.length > limit) fail("Invalid or oversized string.");
  return value;
}
function finite(value: unknown): number { if (typeof value !== "number" || !Number.isFinite(value)) fail("Expected a finite number."); return value; }
function bool(value: unknown): boolean { if (typeof value !== "boolean") fail("Expected a boolean."); return value; }
function array(value: unknown, limit: number): unknown[] { if (!Array.isArray(value) || value.length > limit) fail("Array exceeds the Pine limit.", "RESULT_LIMIT"); return value; }
function scalar(value: unknown): PineScalar {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return finite(value);
  return string(value);
}
function scalarRecord(value: unknown, limit = 64): Record<string, PineScalar> {
  const raw = record(value);
  if (Object.keys(raw).length > limit) fail("Too many object fields.", "RESULT_LIMIT");
  return Object.fromEntries(Object.entries(raw).map(([key, val]) => [string(key, 128), scalar(val)]));
}
/** Explicit overrides only: an omitted key keeps the source declaration's value. */
export function validatePineStrategySettings(value: unknown): PineStrategySettings {
  if (value === undefined) return {};
  const raw = record(value), result: Record<string, PineInputValue> = {};
  const numeric: Record<string, [string, number, number, boolean]> = {
    initial_capital: ["Starting capital", 0, 1e12, false],
    default_qty_value: ["Order size", 0, 1e9, false],
    commission_value: ["Commission", 0, 1e9, false],
    slippage: ["Slippage", 0, 10_000, true],
    pyramiding: ["Entries in same direction", 0, 1_000, true],
  };
  const enums: Record<string, readonly string[]> = {
    default_qty_type: ["fixed", "cash", "percent_of_equity"],
    commission_type: ["percent", "cash_per_contract", "cash_per_order"],
  };
  for (const key of Reflect.ownKeys(raw)) {
    if (typeof key !== "string") fail("Strategy settings require named fields.", "INVALID_STRATEGY_SETTINGS");
    const descriptor = Object.getOwnPropertyDescriptor(raw, key)!;
    if (!("value" in descriptor) || !descriptor.enumerable) fail("Strategy settings require ordinary data fields.", "INVALID_STRATEGY_SETTINGS");
    const val = descriptor.value;
    if (Object.prototype.hasOwnProperty.call(numeric, key)) {
      const [label, min, max, integer] = numeric[key];
      const positive = key === "initial_capital" || key === "default_qty_value";
      if (typeof val !== "number" || !Number.isFinite(val) || val < min || val > max || (positive && val === 0) || (integer && !Number.isSafeInteger(val))) fail(`${label} must be ${integer ? "a whole number" : "a number"} ${positive ? "greater than 0" : "at least 0"} and no more than ${max.toLocaleString("en-US")}.`, "INVALID_STRATEGY_SETTINGS");
    } else if (Object.prototype.hasOwnProperty.call(enums, key)) {
      if (typeof val !== "string" || !enums[key].includes(val)) fail("Choose a supported position-sizing or commission type.", "INVALID_STRATEGY_SETTINGS");
    } else if (["process_orders_on_close", "calc_on_every_tick", "calc_on_order_fills", "use_bar_magnifier"].includes(key)) {
      if (typeof val !== "boolean") fail("Choose a supported strategy execution setting.", "INVALID_STRATEGY_SETTINGS");
    } else fail(`Unsupported strategy test setting: ${key}.`, "INVALID_STRATEGY_SETTINGS");
    result[key] = val;
  }
  return result as PineStrategySettings;
}
export function pineSourceVersion(source: string): 5 | 6 {
  if (new TextEncoder().encode(source).length > PINE_LIMITS.sourceBytes) fail("Pine source exceeds 20,000 UTF-8 bytes.", "SOURCE_LIMIT");
  const headers = source.match(/^[ \t\uFEFF]*\/\/[ \t]*@version[^\r\n]*$/gim) ?? [];
  const match = source.match(/^[ \t\uFEFF]*\/\/[ \t]*@version[ \t]*=[ \t]*(5|6)[ \t]*\r?$/im);
  if (!match || headers.length !== 1) fail("Native Pine source requires exactly one //@version=5 or //@version=6 header.", "PINE_VERSION");
  return Number(match[1]) as 5 | 6;
}
export function canonicalPineTimeframe(timeframe: string): string {
  const match = /^(\d+)?([SDWM])?$/.exec(timeframe);
  if (!match || (!match[1] && !match[2])) fail("Use a Pine timeframe such as 1, 60, D or W.", "INVALID_CONTEXT");
  const amount = Number(match[1] ?? 1);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1440 || (match[2] === "S" && ![1, 5, 10, 15, 30, 45].includes(amount))) fail("Invalid Pine timeframe.", "INVALID_CONTEXT");
  return `${amount}${match[2] ?? ""}`;
}
/** Fixed intraday durations; calendar/session timeframes need a real calendar feed. */
export function pineFixedTimeframeDuration(timeframe: string): number | undefined {
  if (/^(1|5|10|15|30|45)S$/.test(timeframe)) return Number(timeframe.slice(0, -1));
  if (!/^[1-9]\d{0,3}$/.test(timeframe)) return undefined;
  const minutes = Number(timeframe);
  return minutes <= 1440 ? minutes * 60 : undefined;
}
function ordinaryFields(value: unknown): Record<string, unknown> {
  const raw = record(value);
  for (const key of Reflect.ownKeys(raw)) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key)!;
    if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)
      || !("value" in descriptor) || !descriptor.enumerable) fail("Source snapshots require ordinary data fields.", "INVALID_BARS");
  }
  return raw;
}
function validateSourceSnapshot(value: unknown, bars: Candle[], context: PineContext, live = false): PineSourceSnapshot {
  const raw = ordinaryFields(value);
  if (Object.keys(raw).some(key => !["timeframe", "bars"].includes(key))
    || !Object.prototype.hasOwnProperty.call(raw, "timeframe") || !Object.prototype.hasOwnProperty.call(raw, "bars")) fail("Source snapshots contain only timeframe and bars.", "INVALID_CONTEXT");
  const timeframe = canonicalPineTimeframe(string(raw.timeframe, 8));
  const base = pineFixedTimeframeDuration(timeframe), chart = pineFixedTimeframeDuration(canonicalPineTimeframe(context.timeframe));
  if (!base || !chart || base > chart || chart % base !== 0) {
    fail("Source snapshots require fixed UTC-aligned intraday multiples of the source timeframe.", "UNAVAILABLE_DATA");
  }
  for (const bar of bars) if (bar.time % chart !== 0) fail("Chart candles must align with their UTC grid when supplying intrabar data.", "INVALID_BARS");
  const input = raw.bars;
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length > PINE_LIMITS.sourceBars) {
    fail("Source history exceeds 200,000 candle slots.", "BAR_LIMIT");
  }
  for (const key of Reflect.ownKeys(input)) {
    if (key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= input.length
      || !("value" in descriptor) || !descriptor.enumerable) fail("Source history requires ordinary dense candle slots.", "INVALID_BARS");
  }
  // A live initialization owns closed chart history plus already received,
  // confirmed children in its next developing chart bucket.
  const first = bars[0].time, cutoff = bars[bars.length - 1].time + chart * (live ? 2 : 1);
  let previous = -Infinity;
  const copied: Candle[] = [];
  for (let index = 0; index < input.length; index++) {
    if (!Object.prototype.hasOwnProperty.call(input, index)) fail("Source history cannot contain missing array slots.", "INVALID_BARS");
    const item = ordinaryFields(input[index]);
    for (const key of ["time", "open", "high", "low", "close", "volume"]) if (!Object.prototype.hasOwnProperty.call(item, key)) fail("Source candles require explicit OHLCV fields.", "INVALID_BARS");
    const bar = validatePineBar(item);
    if (bar.time <= previous || bar.time % base !== 0 || bar.time < first || bar.time + base > cutoff) {
      fail("Source candles must be ordered on their UTC grid within the supplied chart window.", "INVALID_BARS");
    }
    previous = bar.time;
    copied.push(Object.freeze(bar));
  }
  return Object.freeze({ timeframe, bars: Object.freeze(copied) });
}
function decimalPlaces(value: number): number {
  const [coefficient, exponent = "0"] = value.toString().toLowerCase().split("e");
  return Math.max(0, (coefficient.split(".")[1]?.length ?? 0) - Number(exponent));
}
export function pineTickRepresentation(tick: number): { minmove: number; pricescale: number } {
  const pricescale = 10 ** decimalPlaces(tick), minmove = Math.round(tick * pricescale);
  if (!Number.isSafeInteger(pricescale) || !Number.isSafeInteger(minmove) || minmove <= 0 || minmove / pricescale !== tick) {
    fail("Chart price tick exceeds supported decimal precision.", "INVALID_CONTEXT");
  }
  return { minmove, pricescale };
}
export function validatePineBar(value: unknown): Candle {
  const bar = record(value);
  const time = finite(bar.time), open = finite(bar.open), high = finite(bar.high), low = finite(bar.low), close = finite(bar.close), volume = finite(bar.volume);
  if (!Number.isSafeInteger(time) || time < 0 || time > 253_402_300_799 || low > Math.min(open, close) || high < Math.max(open, close) || low > high || volume < 0) fail("Bars need valid second timestamps and OHLCV values.", "INVALID_BARS");
  return { time, open, high, low, close, volume, timestamp: new Date(time * 1000).toISOString(), ema_20: null, ema_50: null, rsi_14: null };
}
/** Chart candle opening times in seconds; null explicitly means no visible owned candles. */
export function validatePineViewport(value: unknown): PineViewport | null {
  if (value === null) return null;
  const raw = record(value);
  for (const key of Reflect.ownKeys(raw)) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key)!;
    if ((key !== "from" && key !== "to") || !("value" in descriptor) || !descriptor.enumerable) fail("Viewport requires from/to data fields.", "INVALID_VIEWPORT");
  }
  const from = finite(raw.from), to = finite(raw.to);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to > 253_402_300_799 || from > to) fail("Invalid ordered viewport seconds.", "INVALID_VIEWPORT");
  return { from, to };
}
export function validatePineRequest(value: unknown): PineRequest {
  const raw = record(value);
  const id = string(raw.id, 128);
  if (!id || !["prepare", "run"].includes(String(raw.action))) fail("Invalid Pine request identity or action.");
  const source = string(raw.source, PINE_LIMITS.sourceBytes);
  pineSourceVersion(source);
  const inputs = raw.inputs === undefined ? {} : scalarRecord(raw.inputs, PINE_LIMITS.inputs);
  for (const [key, val] of Object.entries(inputs)) if (!/^in_\d+$/.test(key) || val === null) fail("Pine inputs must use native in_N IDs and primitive values.", "INVALID_INPUT");
  const strategySettings = raw.strategySettings === undefined ? undefined : validatePineStrategySettings(raw.strategySettings);
  const mode = raw.mode ?? "historical";
  if (mode !== "historical" && mode !== "live") fail("Invalid execution mode.");
  let context: PineContext | undefined;
  if (raw.context !== undefined) {
    const ctx = record(raw.context);
    if (typeof ctx.symbol !== "string" || ctx.symbol.length > 96 || typeof ctx.timeframe !== "string" || ctx.timeframe.length > 8) fail("A valid chart symbol and Pine timeframe are required.", "INVALID_CONTEXT");
    const symbol = string(ctx.symbol, 96), timeframe = string(ctx.timeframe, 8);
    if (!/^[A-Za-z0-9_.:/!-]+$/.test(symbol)) fail("A valid chart symbol is required.", "INVALID_CONTEXT");
    canonicalPineTimeframe(timeframe);
    context = { symbol, timeframe };
    for (const key of ["mintick", "pointvalue", "mincontract", "quantityStep"] as const) if (ctx[key] !== undefined) {
      const val = finite(ctx[key]);
      if (val <= 0) fail(`Chart ${key} must be positive.`, "INVALID_CONTEXT");
      if ((key === "mincontract" || key === "quantityStep") && (val < 1e-10 || val > 1e9)) fail(`Chart ${key} is outside supported quantity bounds.`, "INVALID_CONTEXT");
      if ((key === "mincontract" || key === "quantityStep") && decimalPlaces(val) > 10) fail(`Chart ${key} supports at most 10 decimal places.`, "INVALID_CONTEXT");
      if (key === "mintick") pineTickRepresentation(val);
      context[key] = val;
    }
    for (const key of ["currency", "basecurrency"] as const) if (ctx[key] !== undefined) {
      if (typeof ctx[key] !== "string" || !/^[A-Z0-9]{1,16}$/.test(ctx[key])) fail(`Chart ${key} must be a currency code.`, "INVALID_CONTEXT");
      context[key] = ctx[key];
    }
  }
  let bars: Candle[] | undefined;
  if (raw.bars !== undefined) {
    let previous = -Infinity;
    bars = array(raw.bars, PINE_LIMITS.bars).map((item) => {
      const bar = validatePineBar(item);
      if (bar.time <= previous) fail("Bars need ordered unique second timestamps and valid OHLCV values.", "INVALID_BARS");
      previous = bar.time;
      return bar;
    });
  }
  if (raw.action === "run" && (!context || !bars?.length)) fail("Pine execution needs chart bars, symbol and timeframe.", "INVALID_CONTEXT");
  let viewport: PineViewport | null | undefined;
  const viewportDescriptor = Object.getOwnPropertyDescriptor(raw, "viewport");
  if (viewportDescriptor) {
    if (!("value" in viewportDescriptor) || !viewportDescriptor.enumerable) fail("Invalid viewport request field.", "INVALID_VIEWPORT");
    if (viewportDescriptor.value !== undefined) viewport = validatePineViewport(viewportDescriptor.value);
  }
  let sourceSnapshot: PineSourceSnapshot | undefined;
  const sourceDescriptor = Object.getOwnPropertyDescriptor(raw, "sourceSnapshot");
  if (sourceDescriptor && (!("value" in sourceDescriptor) || !sourceDescriptor.enumerable)) fail("Source snapshots require an ordinary request field.", "INVALID_BARS");
  if (sourceDescriptor?.value !== undefined) {
    if (raw.action !== "run" || !context || !bars?.length) fail("Intrabar source snapshots require an owned chart execution.", "UNAVAILABLE_DATA");
    sourceSnapshot = validateSourceSnapshot(sourceDescriptor.value, bars, context, mode === "live");
  }
  let liveObservation: PineLiveObservation | undefined;
  const observationDescriptor = Object.getOwnPropertyDescriptor(raw, "liveObservation");
  if (observationDescriptor && (!("value" in observationDescriptor) || !observationDescriptor.enumerable)) fail("Live observations require an ordinary request field.", "INVALID_LIVE_OBSERVATION");
  if (observationDescriptor?.value !== undefined) {
    if (raw.action !== "run" || mode !== "live" || !context || !bars?.length) fail("Live observations require an owned live chart execution.", "INVALID_LIVE_OBSERVATION");
    liveObservation = validatePineLiveObservation(observationDescriptor.value, context, bars, sourceSnapshot);
  }
  let marketData: PineMarketDataConfig | undefined;
  const marketDescriptor = Object.getOwnPropertyDescriptor(raw, "marketData");
  if (marketDescriptor && (!("value" in marketDescriptor) || !marketDescriptor.enumerable)) fail("Requested data requires an ordinary request field.", "INVALID_MARKET_DATA");
  if (marketDescriptor?.value !== undefined) {
    if (raw.action !== "run" || !context || !bars?.length) fail("Requested market data requires its owned chart execution.", "INVALID_MARKET_DATA");
    marketData = validatePineMarketData(marketDescriptor.value, context, bars, sourceSnapshot?.bars.length ?? 0,
      mode === "live" ? pineLiveObservationCutoff(context, bars, sourceSnapshot, liveObservation) : undefined);
  }
  return { id, action: raw.action as PineRequest["action"], source, inputs: inputs as Record<string, PineInputValue>, mode, ...(strategySettings ? { strategySettings } : {}), ...(context ? { context } : {}), ...(bars ? { bars } : {}), ...(sourceSnapshot ? { sourceSnapshot } : {}), ...(marketData ? { marketData } : {}), ...(liveObservation ? { liveObservation } : {}), ...(viewport !== undefined ? { viewport } : {}) };
}

// Bound cumulative text before JSON allocation; binary is permitted only in the packed buffer list.
export function boundedPineMetadataBytes(value: unknown): number {
  const active = new Set<object>();
  let nodes = 0, textBytes = 0;
  const countText = (value: string) => {
    textBytes += new TextEncoder().encode(value).length;
    if (textBytes > PINE_LIMITS.metadataBytes) fail("Pine result metadata exceeds 1 MB.", "RESULT_LIMIT");
  };
  function walk(item: unknown, depth: number): void {
    if (++nodes > 100_000 || depth > 12) fail("Pine result exceeds the structural limit.", "RESULT_LIMIT");
    if (item === null || typeof item === "boolean") return;
    if (typeof item === "number") { finite(item); return; }
    if (typeof item === "string") { countText(string(item, PINE_LIMITS.sourceBytes)); return; }
    if (!item || typeof item !== "object" || active.has(item)) fail("Pine result must contain only acyclic plain data.");
    active.add(item);
    if (Array.isArray(item)) {
      if (Object.getPrototypeOf(item) !== Array.prototype || Reflect.ownKeys(item).some((key) => typeof key !== "string" || (key !== "length" && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= item.length)))) fail("Pine metadata arrays cannot have extra fields.");
      for (const key of Reflect.ownKeys(item)) if (key !== "length") {
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        if (!("value" in descriptor) || !descriptor.enumerable) fail("Pine metadata arrays require ordinary data slots.");
      }
      for (const child of array(item, 65_536)) walk(child, depth + 1);
    } else {
      const raw = record(item);
      for (const key of Reflect.ownKeys(raw)) {
        if (typeof key !== "string" || key.length > 128) fail("Invalid Pine metadata key.");
        const descriptor = Object.getOwnPropertyDescriptor(raw, key)!;
        if (!("value" in descriptor) || !descriptor.enumerable) fail("Pine metadata requires ordinary data fields.");
        countText(key); walk(descriptor.value, depth + 1);
      }
    }
    active.delete(item);
  }
  walk(value, 0);
  const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
  if (bytes > PINE_LIMITS.metadataBytes) fail("Pine result metadata exceeds 1 MB.", "RESULT_LIMIT");
  return bytes;
}
/** Table payloads are final viewport drawings, outside numeric plot channel budgets. */
export function validatePineTableDrawings(value: unknown, declarationOverlay: boolean): PineTableDrawing[] {
  const slots = (value: unknown, limit: number, expected?: number) => {
    const result = array(value, limit);
    if (Object.getPrototypeOf(result) !== Array.prototype || expected !== undefined && result.length !== expected) fail('Invalid Pine table array shape.');
    const keys = Reflect.ownKeys(result);
    if (keys.length !== result.length + 1) fail('Pine tables require dense arrays.');
    for (const key of keys) {
      if (key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(result, key)!;
      if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= result.length || !('value' in descriptor) || !descriptor.enumerable) fail('Pine tables require ordinary array slots.');
    }
    return result;
  };
  const fields = (value: unknown, keys: string[]) => {
    const result = ordinaryFields(value);
    if (Object.keys(result).length !== keys.length || Object.keys(result).some(key => !keys.includes(key))) fail('Invalid Pine table fields.');
    return result;
  };
  const color = (value: unknown) => {
    if (value === null) return null;
    const shade = string(value, 128);
    if (!/^(#[\da-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{1,24})$/i.test(shade)) fail('Invalid Pine table color.');
    return shade;
  };
  const measure = (value: unknown, max: number, integer = false) => {
    const size = finite(value);
    if (size < 0 || size > max || integer && !Number.isSafeInteger(size)) fail('Pine table size exceeds supported bounds.');
    return size;
  };
  let allocated = 0;
  const ids = new Set<string>(), positions = new Set<string>();
  return slots(value, PINE_LIMITS.tables).map((item): PineTableDrawing => {
    const table = fields(item, ['id', 'position', 'columns', 'rows', 'cells', 'merges', 'bgcolor', 'frameColor', 'frameWidth', 'borderColor', 'borderWidth', 'overlay', 'forceOverlay']);
    const id = string(table.id, 128), position = table.position;
    if (!id || ids.has(id) || !PINE_TABLE_POSITIONS.includes(position as PineTableDrawing['position']) || positions.has(String(position))) fail('Invalid or duplicate Pine table identity/position.');
    ids.add(id); positions.add(String(position));
    const columns = measure(table.columns, PINE_LIMITS.tableCells, true), rows = measure(table.rows, PINE_LIMITS.tableCells, true);
    allocated += columns * rows;
    if (columns < 1 || rows < 1 || allocated > PINE_LIMITS.tableCells) fail('Pine tables exceed 4096 allocated cells.', 'RESULT_LIMIT');
    const cells = slots(table.cells, rows, rows).map(row => slots(row, columns, columns).map((value): PineTableCell | null => {
      if (value === null) return null;
      const cell = fields(value, ['populated', 'text', 'width', 'height', 'textColor', 'textHalign', 'textValign', 'textSize', 'bgcolor', 'tooltip', 'textFontFamily', 'textFormatting']);
      if (!['left', 'center', 'right'].includes(cell.textHalign as string) || !['top', 'center', 'bottom'].includes(cell.textValign as string)
        || !['default', 'monospace'].includes(cell.textFontFamily as string) || !['none', 'bold', 'italic', 'bolditalic'].includes(cell.textFormatting as string)) fail('Invalid Pine table cell settings.');
      return { populated: bool(cell.populated), text: string(cell.text), width: measure(cell.width, PINE_LIMITS.tablePercent), height: measure(cell.height, PINE_LIMITS.tablePercent),
        textColor: color(cell.textColor), textHalign: cell.textHalign as PineTableCell['textHalign'], textValign: cell.textValign as PineTableCell['textValign'], textSize: measure(cell.textSize, 512, true),
        bgcolor: color(cell.bgcolor), tooltip: string(cell.tooltip), textFontFamily: cell.textFontFamily as PineTableCell['textFontFamily'], textFormatting: cell.textFormatting as PineTableCell['textFormatting'] };
    }));
    const occupied = new Uint8Array(columns * rows);
    const merges = slots(table.merges, columns * rows).map((value): PineTableMerge => {
      const merge = fields(value, ['startCol', 'startRow', 'endCol', 'endRow']);
      const startCol = measure(merge.startCol, columns - 1, true), endCol = measure(merge.endCol, columns - 1, true);
      const startRow = measure(merge.startRow, rows - 1, true), endRow = measure(merge.endRow, rows - 1, true);
      if (startCol > endCol || startRow > endRow) fail('Pine table merge must be ordered.');
      for (let row = startRow; row <= endRow; row++) for (let col = startCol; col <= endCol; col++) {
        const index = row * columns + col;
        if (occupied[index]) fail('Pine table merge regions cannot overlap.');
        occupied[index] = 1;
      }
      return { startCol, startRow, endCol, endRow };
    });
    const overlay = bool(table.overlay), forceOverlay = bool(table.forceOverlay);
    if (overlay !== (declarationOverlay || forceOverlay)) fail('Pine tables require consistent forced overlay placement.');
    return { id, position: position as PineTableDrawing['position'], columns, rows, cells, merges, bgcolor: color(table.bgcolor), frameColor: color(table.frameColor),
      frameWidth: measure(table.frameWidth, 16, true), borderColor: color(table.borderColor), borderWidth: measure(table.borderWidth, 16, true), overlay, forceOverlay };
  });
}
/** Titles are display data. Only declared member IDs cross the execution boundary. */
export function validatePineEnumMetadata(value: unknown): PineEnumMetadata {
  boundedPineMetadataBytes(value);
  const raw = record(value);
  if (Object.keys(raw).some((key) => !["enumVersion", "enumType", "enumMembers"].includes(key)) || raw.enumVersion !== 1) fail("Invalid Pine enum metadata version.");
  const enumType = string(raw.enumType, 128);
  const identifier = (name: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !["__proto__", "prototype", "constructor"].includes(name);
  if (!identifier(enumType)) fail("Invalid Pine enum type.");
  const enumMembers = array(raw.enumMembers, 128).map((value) => {
    const member = record(value), id = string(member.id, 257), label = string(member.label);
    if (Object.keys(member).some((key) => !["id", "label"].includes(key)) || !id.startsWith(enumType + ".") || !identifier(id.slice(enumType.length + 1))) fail("Invalid Pine enum member.");
    return { id, label };
  });
  if (!enumMembers.length || new Set(enumMembers.map((member) => member.id)).size !== enumMembers.length) fail("Pine enum members must be distinct.");
  return { enumVersion: 1, enumType, enumMembers };
}
function inputDefinition(value: unknown): PineInputDefinition {
  const raw = record(value);
  const result: PineInputDefinition = { id: string(raw.id, 96), name: string(raw.name), type: string(raw.type, 32), defval: scalar(raw.defval) };
  if (!/^in_\d+$/.test(result.id) || !["int", "float", "bool", "string", "source", "color", "enum", "price", "time", "session", "symbol", "timeframe", "text_area"].includes(result.type)) fail("Invalid native input metadata.");
  for (const key of ["varId", "title", "tooltip", "group", "display", "inline"] as const) if (raw[key] !== undefined) result[key] = string(raw[key]);
  for (const key of ["active", "confirm"] as const) if (raw[key] !== undefined) result[key] = bool(raw[key]);
  for (const key of ["minval", "maxval", "step"] as const) if (raw[key] !== undefined) result[key] = finite(raw[key]);
  if (raw.activeCondition !== undefined) {
    try { result.activeCondition = validatePineInputCondition(raw.activeCondition); } catch { fail("Invalid Pine input activation metadata."); }
  }
  if (raw.options !== undefined) result.options = array(raw.options, 128).map(scalar);
  if (["enumVersion", "enumType", "enumMembers"].some((key) => raw[key] !== undefined)) {
    if (result.type !== "enum") fail("Enum metadata requires an enum input.");
    Object.assign(result, validatePineEnumMetadata({ enumVersion: raw.enumVersion, enumType: raw.enumType, enumMembers: raw.enumMembers }));
    const members = new Set(result.enumMembers!.map((member) => member.id));
    if (!result.options?.length || result.options.some((option) => typeof option !== "string" || !members.has(option))
      || typeof result.defval !== "string" || !result.options.includes(result.defval)) fail("Pine enum options and default must use declared member IDs.");
  }
  return result;
}
export function validatePineResponse(value: unknown, request: PineRequest): PineResult {
  const response = record(value);
  const packed = response.encoding === "pine-packed-v1";
  if (response.encoding !== undefined && !packed) fail("Unknown Pine transport encoding.");
  const allowed = packed ? ["id", "status", "encoding", "result", "buffers"] : ["id", "status", "result", "error"];
  if (Object.keys(response).some((key) => !allowed.includes(key))) fail("Unexpected Pine response field.");
  let buffers: ArrayBuffer[] | undefined;
  if (packed) {
    const rawResult = record(response.result);
    const channelMetadata = array(rawResult.plots, PINE_LIMITS.plots);
    const checked = validatePinePackedBuffers(response.buffers, channelMetadata.length);
    const metadata = { ...response, buffers: [] };
    const metadataBytes = boundedPineMetadataBytes(metadata);
    if (checked.bytes + metadataBytes > PINE_LIMITS.resultBytes) fail("Packed Pine result exceeds 16 MB including metadata.", "RESULT_LIMIT");
    buffers = checked.buffers;
  } else boundedPineMetadataBytes(value);
  if (response.id !== request.id) fail("Pine response does not match its request.");
  if (response.status === "failed") {
    const error = record(response.error);
    throw new PineProtocolError(string(error.code, 96), string(error.message));
  }
  if (response.status !== "completed") fail("Invalid Pine response status.");
  const raw = record(response.result);
  if (Object.keys(raw).some((key) => !["kind", "source", "language", "pineVersion", "declaration", "name", "overlay", "behindChart", "usesVisibleRange", "inputDefinitions", "diagnostics", "inputs", "plots", "lines", "lineFills", "boxes", "labels", "polylines", "tables", "strategy", "audit", "alertEvents"].includes(key))) fail("Unexpected Pine result field.");
  if (raw.alertEvents !== undefined && (request.action !== "run" || request.mode !== "live")) fail("Pine alerts require an owned live update.");
  const alertEvents = raw.alertEvents === undefined ? undefined : validatePineAlertEvents(raw.alertEvents);
  if (raw.kind !== request.action || raw.source !== request.source || raw.language !== "pine" || raw.pineVersion !== pineSourceVersion(request.source) || !["indicator", "strategy"].includes(String(raw.declaration))) fail("Pine result metadata does not match its request.");
  const inputDefinitions = array(raw.inputDefinitions, PINE_LIMITS.inputs).map(inputDefinition);
  if (new Set(inputDefinitions.map((item) => item.id)).size !== inputDefinitions.length) fail("Duplicate Pine input ID.");
  for (const [index, definition] of inputDefinitions.entries()) {
    if (definition.activeCondition && pineInputConditionReferences(definition.activeCondition).some((id) => !inputDefinitions.slice(0, index).some((item) => item.id === id))) fail("Pine input activation must reference an earlier declared input.");
    if (definition.activeCondition) {
      try { pineInputActive(definition, inputDefinitions, {}); } catch { fail("Pine input activation must be a boolean expression with compatible operands."); }
    }
  }
  const diagnostics = array(raw.diagnostics, PINE_LIMITS.diagnostics).map((item): PineDiagnostic => {
    const entry = record(item), line = finite(entry.line), column = finite(entry.column);
    if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1 || !["warning", "error"].includes(String(entry.severity))) fail("Invalid Pine diagnostic.");
    return { code: string(entry.code, 96), message: string(entry.message), severity: entry.severity as PineDiagnostic["severity"], line, column };
  });
  const base: PinePrepareResult = { kind: "prepare", source: request.source, language: "pine", pineVersion: raw.pineVersion as 5 | 6, declaration: raw.declaration as PinePrepareResult["declaration"], name: string(raw.name), overlay: bool(raw.overlay), behindChart: raw.behindChart === undefined ? true : bool(raw.behindChart), inputDefinitions, diagnostics, ...(raw.usesVisibleRange !== undefined ? { usesVisibleRange: bool(raw.usesVisibleRange) } : {}) };
  if (Object.keys(request.strategySettings ?? {}).length && base.declaration !== "strategy") fail("Strategy test settings require a strategy declaration.", "INVALID_STRATEGY_SETTINGS");
  if (request.action === "prepare") return base;
  const inputs = scalarRecord(raw.inputs, PINE_LIMITS.inputs);
  for (const [key, val] of Object.entries(inputs)) {
    const definition = inputDefinitions.find((item) => item.id === key);
    if (val === null || !definition || (definition.enumVersion === 1 && !definition.options?.includes(val))) fail("Invalid runtime input ID or value.");
  }
  for (const [key, val] of Object.entries(request.inputs ?? {})) if (inputs[key] !== val) fail("Pine result changed a requested input value.");
  let points = 0;
  const barTimes = new Set(request.bars?.map((bar) => bar.time));
  const channelMetadata = array(raw.plots, PINE_LIMITS.plots);
  const plots = buffers ? decodePinePackedPlots(channelMetadata, buffers, request.bars!) : channelMetadata.map((item): PinePlot => {
    const plot = record(item);
    if (Object.keys(plot).some((key) => !["id", "name", "style", "overlay", "options", "points"].includes(key))) fail("Unexpected legacy plot field.");
    const data = array(plot.points, PINE_LIMITS.legacyPoints);
    points += data.length;
    if (points > PINE_LIMITS.legacyPoints || channelMetadata.length * request.bars!.length > PINE_LIMITS.legacyPoints) fail("Plain Pine output is limited to 4,096 bar slots; larger results require packed transport.", "RESULT_LIMIT");
    let previous = -Infinity;
    return { id: string(plot.id, 128), name: string(plot.name), style: string(plot.style, 64), overlay: bool(plot.overlay), options: validatePinePlotOptions(plot.options), points: data.map((item) => {
      const point = record(item), time = finite(point.time);
      if (Object.keys(point).some((key) => !["time", "value", "options"].includes(key))) fail("Unexpected Pine point field.");
      if (!Number.isSafeInteger(time) || time <= previous || !barTimes.has(time)) fail("Plot timestamps must be ordered, unique and belong to the chart snapshot.");
      previous = time;
      const value = Array.isArray(point.value) ? array(point.value, 4).map(finite) : scalar(point.value);
      if (typeof value === "string" || (Array.isArray(value) && value.length !== 4)) fail("Invalid plot value.");
      return { time, value, options: validatePinePlotOptions(point.options) };
    }) };
  });
  if (new Set(plots.map((plot) => plot.id)).size !== plots.length || plots.some((plot) => !plot.id)) fail("Missing or duplicate Pine plot ID.");
  for (const plot of plots) if (plot.style === "fill") for (const key of ["plot1", "plot2"]) {
    const id = plot.options[key];
    if (typeof id !== "string" || !plots.some((candidate) => candidate.id === id && candidate.style !== "fill")) fail("Fill must reference existing numeric plot IDs.");
  }
  const lines = raw.lines === undefined ? undefined : array(raw.lines, PINE_LIMITS.lines).map((item): PineLineDrawing => {
    const line = ordinaryFields(item);
    const keys = ["id", "x1", "y1", "x2", "y2", "xloc", "extend", "color", "style", "width", "overlay", "forceOverlay"];
    if (Object.keys(line).length !== keys.length || Object.keys(line).some(key => !keys.includes(key))) fail("Invalid Pine line fields.");
    const id = string(line.id, 128);
    if (!id || !["bar_index", "bar_time"].includes(String(line.xloc)) || !["none", "left", "right", "both"].includes(String(line.extend))
      || !["solid", "dashed", "dotted", "arrow_left", "arrow_right", "arrow_both"].includes(String(line.style))) fail("Invalid Pine line identity or style.");
    const coordinates = Object.fromEntries(["x1", "y1", "x2", "y2"].map(key => [key, line[key] === null ? null : finite(line[key])]));
    for (const key of ["x1", "x2"]) {
      const value = coordinates[key];
      if (value !== null && (line.xloc === "bar_index" ? !Number.isSafeInteger(value) || value < -10000 || value > request.bars!.length - 1 + 500 : value < 0 || value > 253402300799 || !Number.isSafeInteger(value * 1000))) fail("Pine line x coordinate exceeds supported chart bounds.");
    }
    const width = finite(line.width);
    if (!Number.isInteger(width) || width < 1 || width > 16) fail("Pine line width must be an integer from 1 to 16.");
    const color = line.color === null ? null : string(line.color, 128);
    if (color !== null && !/^(#[\da-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{1,24})$/i.test(color)) fail("Invalid Pine line color.");
    if (bool(line.overlay) !== (base.overlay || bool(line.forceOverlay))) fail("Pine lines require consistent forced overlay placement.");
    return { id, ...coordinates, xloc: line.xloc, extend: line.extend, style: line.style, width, color, overlay: bool(line.overlay), forceOverlay: bool(line.forceOverlay) } as PineLineDrawing;
  });
  if (lines && new Set(lines.map(line => line.id)).size !== lines.length) fail("Duplicate Pine line ID.");
  const lineIds = new Map(lines?.map(line => [line.id, line]));
  const fillPairs = new Set<string>();
  const lineFills = raw.lineFills === undefined ? undefined : array(raw.lineFills, PINE_LIMITS.lineFills).map((item): PineLineFillDrawing => {
    const fill = ordinaryFields(item);
    if (Object.keys(fill).length !== 5 || Object.keys(fill).some(key => !["id", "line1", "line2", "color", "overlay"].includes(key))) fail("Invalid Pine line-fill fields.");
    const id = string(fill.id, 128), line1 = string(fill.line1, 128), line2 = string(fill.line2, 128);
    const first = lineIds.get(line1), second = lineIds.get(line2), overlay = bool(fill.overlay);
    if (!id || !first || !second || overlay !== (first.overlay || second.overlay)) fail("Line fills require active boundary references and consistent placement.");
    const pair = JSON.stringify([line1, line2].sort());
    if (fillPairs.has(pair)) fail("Duplicate active Pine line-fill pair.");
    fillPairs.add(pair);
    const color = fill.color === null ? null : string(fill.color, 128);
    if (color !== null && !/^(#[\da-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{1,24})$/i.test(color)) fail("Invalid Pine line-fill color.");
    return { id, line1, line2, color, overlay };
  });
  if (lineFills && new Set(lineFills.map(fill => fill.id)).size !== lineFills.length) fail("Duplicate Pine line-fill ID.");
  const boxes = raw.boxes === undefined ? undefined : array(raw.boxes, PINE_LIMITS.boxes).map((item): PineBoxDrawing => {
    const box = ordinaryFields(item);
    const keys = ["id", "left", "top", "right", "bottom", "xloc", "extend", "borderColor", "borderStyle", "borderWidth", "bgcolor", "text", "textColor", "textSize", "textHalign", "textValign", "textWrap", "textFontFamily", "textFormatting", "overlay", "forceOverlay"];
    if (Object.keys(box).length !== keys.length || Object.keys(box).some(key => !keys.includes(key))) fail("Invalid Pine box fields.");
    const id = string(box.id, 128);
    if (!id || !["bar_index", "bar_time"].includes(String(box.xloc)) || !["none", "left", "right", "both"].includes(String(box.extend))
      || !["solid", "dashed", "dotted"].includes(String(box.borderStyle)) || !["left", "center", "right"].includes(String(box.textHalign))
      || !["top", "center", "bottom"].includes(String(box.textValign)) || !["none", "auto"].includes(String(box.textWrap))
      || !["default", "monospace"].includes(String(box.textFontFamily)) || !["none", "bold", "italic", "bolditalic"].includes(String(box.textFormatting))) fail("Invalid Pine box identity or settings.");
    const coordinates = Object.fromEntries(["left", "top", "right", "bottom"].map(key => [key, box[key] === null ? null : finite(box[key])]));
    for (const key of ["left", "right"]) {
      const value = coordinates[key];
      if (value !== null && (box.xloc === "bar_index" ? !Number.isSafeInteger(value) || value < -10000 || value > request.bars!.length - 1 + 500 : value < 0 || value > 253402300799 || !Number.isSafeInteger(value * 1000))) fail("Pine box x coordinate exceeds supported chart bounds.");
    }
    const colors = Object.fromEntries(["borderColor", "bgcolor", "textColor"].map(key => {
      const color = box[key] === null ? null : string(box[key], 128);
      if (color !== null && !/^(#[\da-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{1,24})$/i.test(color)) fail("Invalid Pine box color.");
      return [key, color];
    }));
    if (bool(box.overlay) !== (base.overlay || bool(box.forceOverlay))) fail("Pine boxes require consistent forced overlay placement.");
    const borderWidth = finite(box.borderWidth), textSize = finite(box.textSize);
    if (!Number.isInteger(borderWidth) || borderWidth < 0 || borderWidth > 16 || !Number.isInteger(textSize) || textSize < 0 || textSize > 512) fail("Pine box border or text size exceeds supported bounds.");
    return { id, ...coordinates, ...colors, xloc: box.xloc, extend: box.extend, borderStyle: box.borderStyle, borderWidth,
      text: string(box.text, 4096), textSize, textHalign: box.textHalign, textValign: box.textValign, textWrap: box.textWrap,
      textFontFamily: box.textFontFamily, textFormatting: box.textFormatting, overlay: bool(box.overlay), forceOverlay: bool(box.forceOverlay) } as PineBoxDrawing;
  });
  if (boxes && new Set(boxes.map(box => box.id)).size !== boxes.length) fail("Duplicate Pine box ID.");
  const labels = raw.labels === undefined ? undefined : array(raw.labels, PINE_LIMITS.labels).map((item): PineLabelDrawing => {
    const label = ordinaryFields(item);
    const keys = ["id", "x", "y", "xloc", "yloc", "color", "style", "text", "textColor", "textSize", "textAlign", "tooltip", "textFontFamily", "textFormatting", "overlay", "forceOverlay"];
    if (Object.keys(label).length !== keys.length || Object.keys(label).some(key => !keys.includes(key))) fail("Invalid Pine label fields.");
    const id = string(label.id, 128), x = label.x === null ? null : finite(label.x), y = label.y === null ? null : finite(label.y);
    if (!id || !["bar_index", "bar_time"].includes(String(label.xloc)) || !["price", "abovebar", "belowbar"].includes(String(label.yloc))
      || !PINE_LABEL_STYLES.includes(label.style as PineLabelDrawing["style"]) || !["left", "center", "right"].includes(String(label.textAlign))
      || !["default", "monospace"].includes(String(label.textFontFamily)) || !["none", "bold", "italic", "bolditalic"].includes(String(label.textFormatting))) fail("Invalid Pine label identity or settings.");
    if (x !== null && (label.xloc === "bar_index" ? !Number.isSafeInteger(x) || x < -10000 || x > request.bars!.length - 1 + 500 : x < 0 || x > 253402300799 || !Number.isSafeInteger(x * 1000))) fail("Pine label x coordinate exceeds supported chart bounds.");
    const colors = Object.fromEntries(["color", "textColor"].map(key => {
      const color = label[key] === null ? null : string(label[key], 128);
      if (color !== null && !/^(#[\da-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{1,24})$/i.test(color)) fail("Invalid Pine label color.");
      return [key, color];
    }));
    if (bool(label.overlay) !== (base.overlay || bool(label.forceOverlay))) fail("Pine labels require consistent forced overlay placement.");
    const textSize = finite(label.textSize);
    if (!Number.isInteger(textSize) || textSize < 0 || textSize > 512) fail("Pine label size exceeds supported bounds.");
    return { id, x, y, ...colors, xloc: label.xloc, yloc: label.yloc, style: label.style, text: string(label.text, 4096), textSize,
      textAlign: label.textAlign, tooltip: string(label.tooltip, 4096), textFontFamily: label.textFontFamily,
      textFormatting: label.textFormatting, overlay: bool(label.overlay), forceOverlay: bool(label.forceOverlay) } as PineLabelDrawing;
  });
  if (labels && new Set(labels.map(label => label.id)).size !== labels.length) fail("Duplicate Pine label ID.");
  const audit = record(raw.audit);
  if (audit.engine !== "PineTS" || audit.engineVersion !== "0.11.0" || audit.bars !== request.bars?.length || audit.sourceBytes !== new TextEncoder().encode(request.source).length || audit.mode !== (request.mode ?? "historical") || finite(audit.elapsedMs) < 0) fail("Invalid Pine execution audit.");
  let polylinePointCount = 0;
  const polylines = raw.polylines === undefined ? undefined : array(raw.polylines, PINE_LIMITS.polylines).map((item): PinePolylineDrawing => {
    const polyline = ordinaryFields(item), keys = ["id", "points", "curved", "closed", "xloc", "lineColor", "fillColor", "lineStyle", "lineWidth", "overlay", "forceOverlay"];
    if (Object.keys(polyline).length !== keys.length || Object.keys(polyline).some(key => !keys.includes(key))) fail("Invalid Pine polyline fields.");
    const id = string(polyline.id, 128), xloc = polyline.xloc;
    if (!id || !["bar_index", "bar_time"].includes(String(xloc)) || !["solid", "dashed", "dotted", "arrow_left", "arrow_right", "arrow_both"].includes(String(polyline.lineStyle))) fail("Invalid Pine polyline settings.");
    const rawPoints = array(polyline.points, PINE_LIMITS.polylinePoints);
    polylinePointCount += rawPoints.length;
    if (polylinePointCount > PINE_LIMITS.polylineTotalPoints) fail("Pine polylines exceed 32,000 total points.", "RESULT_LIMIT");
    const points = rawPoints.map(item => {
      const point = ordinaryFields(item);
      if (Object.keys(point).length !== 2 || Object.keys(point).some(key => !["x", "y"].includes(key))) fail("Invalid Pine polyline point fields.");
      const x = point.x === null ? null : finite(point.x), y = point.y === null ? null : finite(point.y);
      if (x !== null && (xloc === "bar_index" ? !Number.isSafeInteger(x) || x < -10000 || x > request.bars!.length - 1 + 500 : x < 0 || x > 253402300799 || !Number.isSafeInteger(x * 1000))) fail("Invalid Pine polyline x coordinate.");
      return { x, y };
    });
    const lineWidth = finite(polyline.lineWidth), forceOverlay = bool(polyline.forceOverlay), overlay = bool(polyline.overlay);
    if (!Number.isInteger(lineWidth) || lineWidth < 1 || lineWidth > 16) fail("Invalid Pine polyline width.");
    if (overlay !== (base.overlay || forceOverlay)) fail("Pine polylines require consistent forced overlay placement.");
    const color = (value: unknown) => { if (value === null) return null; const shade = string(value, 128); if (!/^(#[\da-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{1,24})$/i.test(shade)) fail("Invalid Pine polyline color."); return shade; };
    return { id, points, xloc: xloc as PinePolylineDrawing["xloc"], curved: bool(polyline.curved), closed: bool(polyline.closed), lineColor: color(polyline.lineColor), fillColor: color(polyline.fillColor), lineStyle: polyline.lineStyle as PinePolylineDrawing["lineStyle"], lineWidth, overlay, forceOverlay };
  });
  if (polylines && new Set(polylines.map(polyline => polyline.id)).size !== polylines.length) fail("Duplicate Pine polyline ID.");
  const tables = raw.tables === undefined ? undefined : validatePineTableDrawings(raw.tables, base.overlay);
  let strategy: PineStrategyResult | undefined;
  if (raw.strategy !== undefined) {
    if (base.declaration !== "strategy") fail("Indicator returned a strategy ledger.");
    const state = record(raw.strategy);
    const closedTrades = array(state.closedTrades, PINE_LIMITS.trades).map((item) => scalarRecord(item));
    const openTrades = array(state.openTrades, PINE_LIMITS.trades).map((item) => scalarRecord(item));
    const pendingOrders = array(state.pendingOrders, PINE_LIMITS.trades).map((item) => scalarRecord(item));
    if (closedTrades.length + openTrades.length + pendingOrders.length > PINE_LIMITS.trades) fail("Too many Pine ledger entries.", "RESULT_LIMIT");
    for (const [trades, status] of [[closedTrades, "closed"], [openTrades, "open"]] as const) for (const trade of trades) {
      if (trade.status !== status || typeof trade.id !== "string" || typeof trade.entry_id !== "string") fail("Invalid Pine trade.");
      for (const key of ["entry_price", "entry_time", "entry_bar_index", "size"]) finite(trade[key]);
      if (status === "closed") for (const key of ["exit_price", "exit_time", "exit_bar_index"]) finite(trade[key]);
    }
    for (const order of pendingOrders) if (order.status !== "pending" || typeof order.id !== "string" || !["market", "limit", "stop", "stop-limit"].includes(String(order.type))) fail("Invalid pending Pine order.");
    strategy = { config: scalarRecord(state.config), metrics: scalarRecord(state.metrics), closedTrades, openTrades, pendingOrders };
    for (const [key, value] of Object.entries(request.strategySettings ?? {})) if (strategy.config[key] !== value) fail("Pine result changed a requested strategy setting.", "INVALID_STRATEGY_SETTINGS");
  } else if (base.declaration === "strategy") fail("Strategy execution is missing its engine ledger.");
  return { ...base, kind: "run", inputs: inputs as Record<string, PineInputValue>, plots, ...(lines ? { lines } : {}), ...(lineFills ? { lineFills } : {}), ...(boxes ? { boxes } : {}), ...(labels ? { labels } : {}), ...(polylines ? { polylines } : {}), ...(tables ? { tables } : {}), ...(strategy ? { strategy } : {}), ...(alertEvents ? { alertEvents } : {}), audit: { engine: "PineTS", engineVersion: "0.11.0", bars: audit.bars as number, sourceBytes: audit.sourceBytes as number, mode: audit.mode as "historical" | "live", elapsedMs: audit.elapsedMs as number } };
}
