import type { Candle } from "./api";

export const PINE_LIMITS = Object.freeze({ sourceBytes: 20_000, bars: 20_000, inputs: 24, plots: 8, points: 160_000, trades: 10_000, resultBytes: 12_000_000, loops: 10_000, diagnostics: 100 });
export type PineInputValue = boolean | number | string;
export type PineScalar = PineInputValue | null;
export type PineDiagnostic = { code: string; message: string; severity: "warning" | "error"; line: number; column: number };
export type PineInputDefinition = {
  id: string; name: string; type: string; defval: PineScalar;
  varId?: string; title?: string; tooltip?: string; group?: string; display?: string;
  active?: boolean; confirm?: boolean; inline?: string; options?: PineScalar[];
  minval?: number; maxval?: number; step?: number;
};
export type PineContext = { symbol: string; timeframe: string; mintick?: number; pointvalue?: number };
export type PineRequest = {
  id: string; action: "prepare" | "run"; source: string; bars?: Candle[];
  inputs?: Record<string, PineInputValue>; mode?: "historical" | "live"; context?: PineContext;
};
export type PinePrepareResult = {
  kind: "prepare"; source: string; language: "pine"; pineVersion: 5 | 6;
  declaration: "indicator" | "strategy"; name: string; overlay: boolean;
  inputDefinitions: PineInputDefinition[]; diagnostics: PineDiagnostic[];
};
export type PinePlot = {
  id: string; name: string; style: string; overlay: boolean; options: Record<string, PineScalar>;
  points: { time: number; value: number | boolean | null | number[]; options: Record<string, PineScalar> }[];
};
export type PineStrategyResult = {
  config: Record<string, PineScalar>; metrics: Record<string, PineScalar>;
  closedTrades: Record<string, PineScalar>[]; openTrades: Record<string, PineScalar>[]; pendingOrders: Record<string, PineScalar>[];
};
export type PineExecutionResult = Omit<PinePrepareResult, "kind"> & {
  kind: "run"; inputs: Record<string, PineInputValue>; plots: PinePlot[]; strategy?: PineStrategyResult;
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
export function validatePineRequest(value: unknown): PineRequest {
  const raw = record(value);
  const id = string(raw.id, 128);
  if (!id || !["prepare", "run"].includes(String(raw.action))) fail("Invalid Pine request identity or action.");
  const source = string(raw.source, PINE_LIMITS.sourceBytes);
  pineSourceVersion(source);
  const inputs = raw.inputs === undefined ? {} : scalarRecord(raw.inputs, PINE_LIMITS.inputs);
  for (const [key, val] of Object.entries(inputs)) if (!/^in_\d+$/.test(key) || val === null) fail("Pine inputs must use native in_N IDs and primitive values.", "INVALID_INPUT");
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
    for (const key of ["mintick", "pointvalue"] as const) if (ctx[key] !== undefined) {
      const val = finite(ctx[key]);
      if (val <= 0) fail(`Chart ${key} must be positive.`, "INVALID_CONTEXT");
      context[key] = val;
    }
  }
  let bars: Candle[] | undefined;
  if (raw.bars !== undefined) {
    let previous = -Infinity;
    bars = array(raw.bars, PINE_LIMITS.bars).map((item) => {
      const bar = record(item);
      const time = finite(bar.time), open = finite(bar.open), high = finite(bar.high), low = finite(bar.low), close = finite(bar.close), volume = finite(bar.volume);
      if (!Number.isSafeInteger(time) || time < 0 || time > 253_402_300_799 || time <= previous || low > Math.min(open, close) || high < Math.max(open, close) || low > high || volume < 0) fail("Bars need ordered unique second timestamps and valid OHLCV values.", "INVALID_BARS");
      previous = time;
      return { time, open, high, low, close, volume, timestamp: new Date(time * 1000).toISOString(), ema_20: null, ema_50: null, rsi_14: null };
    });
  }
  if (raw.action === "run" && (!context || !bars?.length)) fail("Pine execution needs chart bars, symbol and timeframe.", "INVALID_CONTEXT");
  return { id, action: raw.action as PineRequest["action"], source, inputs: inputs as Record<string, PineInputValue>, mode, ...(context ? { context } : {}), ...(bars ? { bars } : {}) };
}

// Validate before serializing: JSON.stringify alone silently loses functions and non-finite values.
function boundedPlain(value: unknown): void {
  const active = new Set<object>();
  let nodes = 0;
  function walk(item: unknown, depth: number): void {
    if (++nodes > 1_500_000 || depth > 12) fail("Pine result exceeds the structural limit.", "RESULT_LIMIT");
    if (item === null || typeof item === "boolean") return;
    if (typeof item === "number") { finite(item); return; }
    if (typeof item === "string") { string(item, PINE_LIMITS.sourceBytes); return; }
    if (!item || typeof item !== "object" || active.has(item)) fail("Pine result must contain only acyclic plain data.");
    active.add(item);
    if (Array.isArray(item)) for (const child of array(item, PINE_LIMITS.points)) walk(child, depth + 1);
    else for (const child of Object.values(record(item))) walk(child, depth + 1);
    active.delete(item);
  }
  walk(value, 0);
  if (new TextEncoder().encode(JSON.stringify(value)).length > PINE_LIMITS.resultBytes) fail("Pine result exceeds 12 MB.", "RESULT_LIMIT");
}
function inputDefinition(value: unknown): PineInputDefinition {
  const raw = record(value);
  const result: PineInputDefinition = { id: string(raw.id, 96), name: string(raw.name), type: string(raw.type, 32), defval: scalar(raw.defval) };
  if (!/^in_\d+$/.test(result.id) || !["int", "float", "bool", "string", "source", "color", "enum", "price", "time", "session", "symbol", "timeframe", "text_area"].includes(result.type)) fail("Invalid native input metadata.");
  for (const key of ["varId", "title", "tooltip", "group", "display", "inline"] as const) if (raw[key] !== undefined) result[key] = string(raw[key]);
  for (const key of ["active", "confirm"] as const) if (raw[key] !== undefined) result[key] = bool(raw[key]);
  for (const key of ["minval", "maxval", "step"] as const) if (raw[key] !== undefined) result[key] = finite(raw[key]);
  if (raw.options !== undefined) result.options = array(raw.options, 128).map(scalar);
  return result;
}
export function validatePineResponse(value: unknown, request: PineRequest): PineResult {
  boundedPlain(value);
  const response = record(value);
  if (response.id !== request.id) fail("Pine response does not match its request.");
  if (response.status === "failed") {
    const error = record(response.error);
    throw new PineProtocolError(string(error.code, 96), string(error.message));
  }
  if (response.status !== "completed") fail("Invalid Pine response status.");
  const raw = record(response.result);
  if (raw.kind !== request.action || raw.source !== request.source || raw.language !== "pine" || raw.pineVersion !== pineSourceVersion(request.source) || !["indicator", "strategy"].includes(String(raw.declaration))) fail("Pine result metadata does not match its request.");
  const inputDefinitions = array(raw.inputDefinitions, PINE_LIMITS.inputs).map(inputDefinition);
  if (new Set(inputDefinitions.map((item) => item.id)).size !== inputDefinitions.length) fail("Duplicate Pine input ID.");
  const diagnostics = array(raw.diagnostics, PINE_LIMITS.diagnostics).map((item): PineDiagnostic => {
    const entry = record(item), line = finite(entry.line), column = finite(entry.column);
    if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1 || !["warning", "error"].includes(String(entry.severity))) fail("Invalid Pine diagnostic.");
    return { code: string(entry.code, 96), message: string(entry.message), severity: entry.severity as PineDiagnostic["severity"], line, column };
  });
  const base: PinePrepareResult = { kind: "prepare", source: request.source, language: "pine", pineVersion: raw.pineVersion as 5 | 6, declaration: raw.declaration as PinePrepareResult["declaration"], name: string(raw.name), overlay: bool(raw.overlay), inputDefinitions, diagnostics };
  if (request.action === "prepare") return base;
  const inputs = scalarRecord(raw.inputs, PINE_LIMITS.inputs);
  for (const [key, val] of Object.entries(inputs)) if (val === null || !inputDefinitions.some((item) => item.id === key)) fail("Invalid runtime input ID or value.");
  for (const [key, val] of Object.entries(request.inputs ?? {})) if (inputs[key] !== val) fail("Pine result changed a requested input value.");
  let points = 0;
  const barTimes = new Set(request.bars?.map((bar) => bar.time));
  const plots = array(raw.plots, PINE_LIMITS.plots).map((item): PinePlot => {
    const plot = record(item);
    const data = array(plot.points, PINE_LIMITS.points);
    points += data.length;
    if (points > PINE_LIMITS.points) fail("Too many Pine plot points.", "RESULT_LIMIT");
    let previous = -Infinity;
    return { id: string(plot.id, 128), name: string(plot.name), style: string(plot.style, 64), overlay: bool(plot.overlay), options: scalarRecord(plot.options), points: data.map((item) => {
      const point = record(item), time = finite(point.time);
      if (!Number.isSafeInteger(time) || time <= previous || !barTimes.has(time)) fail("Plot timestamps must be ordered, unique and belong to the chart snapshot.");
      previous = time;
      const value = Array.isArray(point.value) ? array(point.value, 4).map(finite) : scalar(point.value);
      if (typeof value === "string") fail("Invalid plot value.");
      return { time, value, options: scalarRecord(point.options) };
    }) };
  });
  if (new Set(plots.map((plot) => plot.id)).size !== plots.length) fail("Duplicate Pine plot ID.");
  const audit = record(raw.audit);
  if (audit.engine !== "PineTS" || audit.engineVersion !== "0.11.0" || audit.bars !== request.bars?.length || audit.sourceBytes !== new TextEncoder().encode(request.source).length || audit.mode !== (request.mode ?? "historical") || finite(audit.elapsedMs) < 0) fail("Invalid Pine execution audit.");
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
  } else if (base.declaration === "strategy") fail("Strategy execution is missing its engine ledger.");
  return { ...base, kind: "run", inputs: inputs as Record<string, PineInputValue>, plots, ...(strategy ? { strategy } : {}), audit: { engine: "PineTS", engineVersion: "0.11.0", bars: audit.bars as number, sourceBytes: audit.sourceBytes as number, mode: audit.mode as "historical" | "live", elapsedMs: audit.elapsedMs as number } };
}
