/// <reference lib="webworker" />
import { pineInputActive, validatePineInputCondition } from "../lib/pineInputActivation";
import { Indicator, PineTS, computeNextPeriodStart } from "pinets";
import type { Context, IProvider, ISymbolInfo, Kline, PreparedScript } from "pinets";
import { PINE_LIMITS, PineProtocolError, canonicalPineTimeframe, pineSourceVersion, validatePineRequest, pineTickRepresentation, validatePineResponse, validatePineEnumMetadata } from "../lib/pineProtocol";
import { PINE_LIVE_PROTOCOL, pineLiveRequestId, validatePineLiveRequest } from "../lib/pineLiveProtocol";
import type { PineLiveRequest } from "../lib/pineLiveProtocol";
import type { Candle } from "../lib/api";
import { encodePinePackedPlots, toPineWireResponse } from "../lib/pinePacked";
import type { PinePackedPlot, PinePlotPoint } from "../lib/pinePacked";
import type { PineDiagnostic, PineExecutionResult, PineInputDefinition, PineInputValue, PinePlot, PinePrepareResult, PineRequest, PineResult, PineScalar, PineStrategyResult } from "../lib/pineProtocol";

function error(code: string, message: string): never { throw new PineProtocolError(code, message); }
function warning(code: string, message: string): PineDiagnostic { return { code, message: message.slice(0, 4_096), severity: "warning", line: 1, column: 1 }; }
function plainScalar(value: unknown): PineScalar {
  if (value === undefined || value === null || (typeof value === "number" && !Number.isFinite(value))) return null;
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string" && value.length <= 4_096) return value;
  return error("UNSUPPORTED_RESULT", "The native engine returned unsupported or oversized output data.");
}
function fields(value: object, keys?: string[]): Record<string, PineScalar> {
  const result: Record<string, PineScalar> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.startsWith("_") || (keys && !keys.includes(key))) continue;
    if (["__proto__", "prototype", "constructor"].includes(key)) error("INVALID_MESSAGE", "Unsafe engine output key.");
    result[key] = plainScalar(item);
  }
  return result;
}
function definitions(indicator: Indicator): PineInputDefinition[] {
  const metadata = indicator.getInputsMeta();
  if (metadata.length > PINE_LIMITS.inputs) error("INPUT_LIMIT", "Pine source exceeds 24 inputs.");
  return metadata.map((item) => {
    const definition: PineInputDefinition = { id: item.id, name: item.name, type: item.type, defval: plainScalar(item.defval) };
    for (const key of ["varId", "title", "tooltip", "group", "display", "inline", "active", "confirm", "minval", "maxval", "step"] as const) {
      const val = item[key];
      if (val !== undefined) Object.assign(definition, { [key]: plainScalar(val) });
    }
    const condition = (item as typeof item & { activeCondition?: unknown }).activeCondition;
    if (condition !== undefined) {
      try { definition.activeCondition = validatePineInputCondition(condition); } catch { error("UNSUPPORTED_INPUT", "Input activation exceeds supported expression limits."); }
    }
    if (item.options) definition.options = item.options.map(plainScalar);
    if (item.type === "enum") {
      const raw = item as typeof item & { enumVersion?: unknown; enumType?: unknown; enumMembers?: unknown };
      Object.assign(definition, validatePineEnumMetadata({ enumVersion: raw.enumVersion, enumType: raw.enumType, enumMembers: raw.enumMembers }));
    }
    return definition;
  });
}
function runtimeInputs(request: PineRequest, inputs: PineInputDefinition[]): Record<string, PineInputValue> {
  const values: Record<string, PineInputValue> = {};
  for (const key of Object.keys(request.inputs ?? {})) if (!inputs.some((item) => item.id === key)) error("INVALID_INPUT", `Unknown native Pine input ${key}.`);
  for (const input of inputs) {
    const value = request.inputs?.[input.id] ?? input.defval;
    if (value === null) error("UNSUPPORTED_INPUT", `Input ${input.name} has an unsupported default value.`);
    const numeric = ["int", "float", "price", "time"].includes(input.type);
    if ((numeric && typeof value !== "number") || (input.type === "bool" && typeof value !== "boolean") || (!numeric && input.type !== "bool" && typeof value !== "string")) error("INVALID_INPUT", `Invalid value for Pine input ${input.name}.`);
    if (typeof value === "number" && ((["int", "time"].includes(input.type) && !Number.isSafeInteger(value)) || (input.minval !== undefined && value < input.minval) || (input.maxval !== undefined && value > input.maxval))) error("INVALID_INPUT", `Pine input ${input.name} is outside its declared range.`);
    if (input.options && !input.options.includes(value)) error("INVALID_INPUT", `Pine input ${input.name} must match a declared option.`);
    if (input.type === "source" && !["open", "high", "low", "close", "hl2", "hlc3", "ohlc4", "hlcc4"].includes(String(value))) error("UNSUPPORTED_INPUT", "Only the loaded chart's OHLC sources are available.");
    values[input.id] = value;
  }
  return values;
}
function displayName(source: string, declaration: string): string {
  // A display hint only. Native preparation and execution remain authoritative.
  const match = new RegExp(`^[ \\t]*${declaration}\\s*\\(\\s*(?:title\\s*=\\s*)?("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')`, "m").exec(source);
  if (match) {
    try {
      const quoted = match[1];
      const title = quoted.startsWith('"') ? JSON.parse(quoted) : quoted.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
      if (typeof title === "string" && title.length <= 4_096) return title;
    } catch { /* The engine reports syntax errors; this hint has no execution role. */ }
  }
  return `Pine ${declaration}`;
}
function normalizeSymbol(symbol: string): string { return symbol.toUpperCase(); }
function chartProvider(request: PineRequest) {
  const context = request.context!;
  const timeframe = canonicalPineTimeframe(context.timeframe);
  let failure: PineProtocolError | undefined;
  let calls = 0;
  const reject = (symbol: string, tf?: string) => {
    failure ??= new PineProtocolError("UNAVAILABLE_DATA", `Only loaded ${context.symbol} ${context.timeframe} chart data is available; requested ${symbol}${tf ? ` ${tf}` : ""}.`);
  };
  const interval = /^(\d+)([SDWM]?)$/.exec(timeframe)!;
  const count = Number(interval[1]), unit = interval[2];
  const candle = (bar: Candle): Kline => {
    const openTime = bar.time * 1000;
    const closeTime = unit === "M" ? computeNextPeriodStart(openTime, "month", count) : openTime + count * ({ S: 1_000, D: 86_400_000, W: 604_800_000 }[unit] ?? 60_000);
    return { openTime, closeTime, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, quoteAssetVolume: 0, numberOfTrades: 0, takerBuyBaseAssetVolume: 0, takerBuyQuoteAssetVolume: 0, ignore: 0 };
  };
  const candles: Kline[] = request.bars!.map(candle);
  const symbol = context.symbol, ticker = symbol.split(":").slice(-1)[0];
  const info: ISymbolInfo = {
    current_contract: "", description: symbol, isin: "", main_tickerid: symbol, prefix: symbol.includes(":") ? symbol.split(":")[0] : "", root: ticker, ticker, tickerid: symbol, type: "", basecurrency: context.basecurrency ?? "", country: "", currency: context.currency ?? "USD", timezone: "UTC", session: "24x7", volumetype: "base", mincontract: context.mincontract ?? 1,
    ...pineTickRepresentation(context.mintick ?? 0.01), mintick: context.mintick ?? 0.01, pointvalue: context.pointvalue ?? 1,
    employees: 0, industry: "", sector: "", shareholders: 0, shares_outstanding_float: 0, shares_outstanding_total: 0, expiration_date: 0,
    recommendations_buy: 0, recommendations_buy_strong: 0, recommendations_date: 0, recommendations_hold: 0, recommendations_sell: 0, recommendations_sell_strong: 0, recommendations_total: 0,
    target_price_average: 0, target_price_date: 0, target_price_estimates: 0, target_price_high: 0, target_price_low: 0, target_price_median: 0,
  };
  const provider: IProvider = {
    configure() { /* Owned chart snapshots only, with no credentials or network. */ },
    async getMarketData(requestedSymbol, requestedTimeframe, limit, start, end) {
      if (++calls > 64) error("REQUEST_LIMIT", "Pine requested too many data snapshots.");
      let tf: string;
      try { tf = canonicalPineTimeframe(requestedTimeframe); } catch { reject(requestedSymbol, requestedTimeframe); return []; }
      if (normalizeSymbol(requestedSymbol) !== normalizeSymbol(symbol) || tf !== timeframe) { reject(requestedSymbol, requestedTimeframe); return []; }
      let result = candles.filter((bar) => (start === undefined || bar.openTime >= start) && (end === undefined || bar.openTime <= end));
      if (limit !== undefined) result = result.slice(-Math.min(candles.length, Math.max(0, Math.floor(limit))));
      return result.map((bar) => ({ ...bar }));
    },
    async getSymbolInfo(requestedSymbol) {
      if (normalizeSymbol(requestedSymbol) !== normalizeSymbol(symbol)) reject(requestedSymbol);
      return { ...info };
    },
  };
  // Native request shortcuts must validate the original full identity before decoding it.
  // An immutable provider-owned callback is captured by every request namespace factory.
  Object.defineProperty(provider, "_edgelabRequestContext", { value: (requestedSymbol: unknown, requestedTimeframe: unknown) => {
    const requested = requestedSymbol === "" ? symbol : requestedSymbol;
    const rawTimeframe = requestedTimeframe === "" ? context.timeframe : String(requestedTimeframe ?? "");
    let tf: string | undefined;
    try { tf = canonicalPineTimeframe(rawTimeframe); } catch { /* Unavailable context, including invalid timeframes. */ }
    if (typeof requested !== "string" || normalizeSymbol(requested) !== normalizeSymbol(symbol) || tf !== timeframe) {
      reject(String(requested), rawTimeframe);
      throw failure!;
    }
    return { symbol, timeframe };
  } });
  // Empty unavailable snapshots let upstream's ready promise settle; no result is published after failure.
  return {
    provider,
    unavailable: () => failure,
    reset() { calls = 0; failure = undefined; },
    update(bar: Candle, append: boolean) {
      if (append) candles.push(candle(bar)); else candles[candles.length - 1] = candle(bar);
    },
    nextTime: () => candles[candles.length - 1].closeTime / 1000,
  };
}
export function normalizePinePlotValue(value: unknown): PinePlot["points"][number]["value"] {
  if (Array.isArray(value)) {
    if (value.length !== 4 || value.some((item) => item != null && typeof item !== "number")
      || value.some((item) => typeof item === "number" && !Number.isFinite(item) && !Number.isNaN(item))) {
      return error("UNSUPPORTED_RESULT", "Invalid OHLC plot output.");
    }
    // Pine plotcandle and plotbar hide a bar when any required OHLC series is na.
    if (value.some((item) => item == null || Number.isNaN(item))) return null;
    return value as number[];
  }
  const scalar = plainScalar(value);
  if (typeof scalar === "string") return error("UNSUPPORTED_RESULT", "Unsupported native plot value.");
  return scalar;
}

function plotResults(raw: Record<string, unknown>, overlay: boolean, diagnostics: PineDiagnostic[], bars: readonly { time: number }[]): { plots: PinePlot[] } | { plots: PinePackedPlot[]; buffers: ArrayBuffer[] } {
  const drawings = new Set(["label", "drawing_line", "drawing_box", "linefill", "drawing_polyline", "table"]);
  const entries = Object.entries(raw).filter(([, value]) => {
    const plot = value as { options?: { style?: string }; data?: { value?: unknown }[] };
    if (!drawings.has(plot.options?.style ?? "")) return true;
    if (plot.data?.some((point) => Array.isArray(point.value) ? point.value.length > 0 : point.value != null)) diagnostics.push(warning("UNSUPPORTED_DRAWING", `The ${plot.options!.style} drawing output is not exposed by this chart adapter.`));
    return false;
  });
  if (entries.length > PINE_LIMITS.plots) error("PLOT_LIMIT", "Native Pine output exceeds 64 channels; this host capacity is distinct from TradingView plot counts.");
  if (entries.length * bars.length > PINE_LIMITS.points) error("POINT_LIMIT", "Native Pine output exceeds 1,280,000 bar slots.");
  const packed = entries.length * bars.length > PINE_LIMITS.legacyPoints;
  // Object enumeration sorts numeric titles. Preserve actual background invocation order instead.
  const backgrounds = entries.filter(([, value]) => (value as { options?: { style?: string } }).options?.style === "background")
    .sort(([, first], [, second]) => ((first as { _edgelabBackgroundOrder?: number })._edgelabBackgroundOrder ?? 0) - ((second as { _edgelabBackgroundOrder?: number })._edgelabBackgroundOrder ?? 0));
  const barcolors = entries.filter(([, value]) => (value as { options?: { style?: string } }).options?.style === "barcolor")
    .sort(([, first], [, second]) => ((first as { _edgelabBarColorOrder?: number })._edgelabBarColorOrder ?? 0) - ((second as { _edgelabBarColorOrder?: number })._edgelabBarColorOrder ?? 0));
  const barplots = entries.filter(([, value]) => (value as { options?: { style?: string } }).options?.style === "bar")
    .sort(([, first], [, second]) => ((first as { _edgelabBarPlotOrder?: number })._edgelabBarPlotOrder ?? 0) - ((second as { _edgelabBarPlotOrder?: number })._edgelabBarPlotOrder ?? 0));
  let backgroundIndex = 0, barcolorIndex = 0, barplotIndex = 0;
  const ordered = entries.map((entry) => {
    const style = (entry[1] as { options?: { style?: string } }).options?.style;
    return style === "background" ? backgrounds[backgroundIndex++] : style === "barcolor" ? barcolors[barcolorIndex++] : style === "bar" ? barplots[barplotIndex++] : entry;
  });
  const plots = ordered.flatMap(([id, value]) => {
    const plot = value as { title?: string; _edgelabBackgroundOrder?: number; _edgelabBarColorOrder?: number; _edgelabBarPlotOrder?: number; options?: Record<string, unknown>; data?: { time: number; value: unknown; options?: Record<string, unknown> }[] };
    const style = typeof plot.options?.style === "string" ? plot.options.style : "line";
    if (!Array.isArray(plot.data)) { diagnostics.push(warning("UNSUPPORTED_DRAWING", `The ${style} drawing output is not exposed by this chart adapter.`)); return []; }
    if (plot.data.some((point) => point.value && typeof point.value === "object" && !Array.isArray(point.value))) { diagnostics.push(warning("UNSUPPORTED_DRAWING", `The ${style} drawing output is not exposed by this chart adapter.`)); return []; }
    // HlineHelper forwards omitted parameters as own undefined fields. Preserve absence
    // separately from explicit na (NaN), so a missing color does not hide a fixed level.
    const plotFields = (value: object) => fields(["hline", "bar", "candle", "candles", "plotcandle"].includes(style) ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) : value);
    const points = function* (): Generator<PinePlotPoint> {
      for (const point of plot.data!) yield { time: point.time / 1000, value: normalizePinePlotValue(point.value), options: plotFields(point.options ?? {}) };
    };
    const name = plot.title ?? (style === "background" ? `Background ${(plot._edgelabBackgroundOrder ?? 0) + 1}` : style === "barcolor" ? `Bar color ${(plot._edgelabBarColorOrder ?? 0) + 1}` : style === "bar" ? `OHLC bars ${(plot._edgelabBarPlotOrder ?? 0) + 1}` : id);
    return [{ id, name, style, overlay: plot.options?.force_overlay === true || overlay || (typeof plot.options?.overlay === "boolean" ? plot.options.overlay : false), options: plotFields(plot.options ?? {}), points: packed ? points() : Array.from(points()) }];
  });
  return packed ? encodePinePackedPlots(plots, bars) : { plots: plots as PinePlot[] };
}
const TRADE_FIELDS = ["id", "entry_id", "entry_price", "entry_bar_index", "entry_time", "entry_comment", "exit_id", "exit_price", "exit_bar_index", "exit_time", "exit_comment", "size", "profit", "commission", "max_drawdown", "max_runup", "status"];
const ORDER_FIELDS = ["id", "direction", "qty", "type", "limit", "stop", "bar", "time", "oca_name", "oca_type", "comment", "status", "category", "profit", "loss", "trail_price", "trail_offset", "trail_points", "from_entry", "qty_percent", "immediately"];
const METRIC_FIELDS = ["position_size", "position_avg_price", "position_entry_name", "initial_capital", "account_currency", "equity", "netprofit", "grossprofit", "grossloss", "openprofit", "cagr", "max_drawdown", "max_runup", "equity_peak", "max_drawdown_percent_value", "max_runup_percent_value", "sharpe_ratio", "sortino_ratio", "wintrades", "losstrades", "eventrades", "buy_and_hold_pnl", "risk_halted"];
function strategyResult(state: { config: object; closedtrades: object[]; opentrades: object[]; pending_orders: object[] }): PineStrategyResult {
  if (state.closedtrades.length + state.opentrades.length + state.pending_orders.length > PINE_LIMITS.trades) error("TRADE_LIMIT", "Native strategy output exceeds 10,000 ledger entries.");
  const trades = (items: object[]) => items.map((item) => {
    const trade = fields(item, TRADE_FIELDS);
    for (const key of ["entry_time", "exit_time"]) if (typeof trade[key] === "number") trade[key] = (trade[key] as number) / 1000;
    return trade;
  });
  // A consumed unscoped exit call may persist for future entries; its dormant
  // template is not an executable pending order in the returned ledger.
  return { config: fields(state.config), metrics: fields(state, METRIC_FIELDS), closedTrades: trades(state.closedtrades), openTrades: trades(state.opentrades), pendingOrders: state.pending_orders.filter((item) => !(item as { _historical_exit_dormant?: boolean })._historical_exit_dormant).map((item) => { const order = fields(item, ORDER_FIELDS); if (typeof order.time === "number") order.time /= 1000; return order; }) };
}

const RECALCULATION_SETTINGS = ["calc_on_every_tick", "calc_on_order_fills", "calc_on_every_history_tick"] as const;
function resolvedSetting(value: unknown): unknown {
  if (value && typeof value === "object" && typeof (value as { get?: unknown }).get === "function") return (value as { get(index: number): unknown }).get(0);
  return value;
}

/** Normalize this context's plot arguments around the pinned positional join type typo. */
function bindPlotOptions(context: Context) {
  const namespace = context.pine.plot;
  const descriptor = Object.getOwnPropertyDescriptor(namespace, "any");
  if (!descriptor?.writable || typeof descriptor.value !== "function") error("UNSUPPORTED_EXECUTION_CONTEXT", "The native engine cannot preserve plot options.");
  const original = descriptor.value;
  const signature = ["series", "title", "color", "linewidth", "style", "trackprice", "histbase", "offset", "join", "editable", "show_last", "display", "format", "precision", "force_overlay", "linestyle"];
  const constantOptions = new WeakMap<object, Record<string, unknown>>();
  Object.defineProperty(namespace, "any", { ...descriptor, value: function(this: unknown, ...args: unknown[]) {
    if (context.isSecondaryContext) return Reflect.apply(original, this, args);
    const last = args.at(-1) as { __callsiteId?: unknown } | undefined;
    const sentinel = last && typeof last === "object" && typeof last.__callsiteId === "string" ? last : undefined;
    const values = sentinel ? args.slice(0, -1) : args;
    const options: Record<string, unknown> = {};
    values.forEach((argument, index) => {
      if (argument && typeof argument === "object" && !Array.isArray(argument) && (Object.getPrototypeOf(argument) === Object.prototype || Object.getPrototypeOf(argument) === null)) {
        if (index !== values.length - 1) error("UNSUPPORTED_PLOT_OPTION", "Named plot options must follow positional arguments.");
        Object.assign(options, argument);
      } else {
        if (index >= signature.length) error("UNSUPPORTED_PLOT_OPTION", "Plot received unsupported extra arguments.");
        options[signature[index]] = argument;
      }
    });
    // HlineHelper delegates to plot.any with its own linestyle/undefined fields.
    // Preserve that internal path byte-for-byte; it has a separate rendering contract.
    if (resolvedSetting(options.style) === "hline") return Reflect.apply(original, this, args);
    if (!Object.prototype.hasOwnProperty.call(options, "series") || Object.keys(options).some((name) => !signature.includes(name))) error("UNSUPPORTED_PLOT_OPTION", "Plot requires a series and only supports its documented options.");
    const series = options.series;
    delete options.series;
    for (const [name, argument] of Object.entries(options)) {
      let value = argument;
      for (let depth = 0; depth < 4; depth++) {
        const scalar = value && typeof value === "object" && "__value" in value ? (value as { __value: unknown }).__value : value;
        const resolved = resolvedSetting(scalar);
        if (resolved === value) break;
        value = resolved;
      }
      options[name] = value;
      if (["trackprice", "join", "editable", "force_overlay"].includes(name) && typeof value !== "boolean") error("UNSUPPORTED_PLOT_OPTION", `Plot ${name} must resolve to a boolean.`);
      if (["linewidth", "offset", "show_last", "precision"].includes(name) && (!Number.isSafeInteger(value) || (name === "linewidth" && (value as number) < 1) || (["show_last", "precision"].includes(name) && (value as number) < 0))) error("UNSUPPORTED_PLOT_OPTION", `Plot ${name} must resolve to a valid integer.`);
      if (name === "histbase" && (typeof value !== "number" || !Number.isFinite(value))) error("UNSUPPORTED_PLOT_OPTION", "Plot histbase must resolve to a finite number.");
      if (["title", "style", "display", "format"].includes(name) && (typeof value !== "string" || value.length > 4_096)) error("UNSUPPORTED_PLOT_OPTION", `Plot ${name} must resolve to a bounded string.`);
      if (name === "linestyle" && (typeof value !== "string" || !["linestyle_solid", "linestyle_dashed", "linestyle_dotted"].includes(value))) error("UNSUPPORTED_PLOT_OPTION", "Plot linestyle must be solid, dashed or dotted.");
      if (name === "color" && value !== undefined && value !== null && !(typeof value === "number" && Number.isNaN(value)) && typeof value !== "string" && typeof value !== "function") error("UNSUPPORTED_PLOT_OPTION", "Plot color must resolve to a color or na.");
    }
    const flags = { ...(Object.prototype.hasOwnProperty.call(options, "offset") ? { offset: options.offset } : {}), linestyle: options.linestyle ?? "linestyle_solid" };
    const forwarded: unknown[] = [series, options];
    if (sentinel) forwarded.push(sentinel);
    const result = Reflect.apply(original, this, forwarded) as { options?: Record<string, unknown> };
    if (!result?.options) error("UNSUPPORTED_EXECUTION_CONTEXT", "The native engine did not preserve the plot channel.");
    const previous = constantOptions.get(result);
    if (previous && (Object.keys(previous).length !== Object.keys(flags).length || Object.entries(flags).some(([name, value]) => !Object.is(value, previous[name])))) error("UNSUPPORTED_PLOT_OPTION", "Plot offset and linestyle must remain constant throughout the snapshot.");
    if (!previous) constantOptions.set(result, flags);
    const overlay = (context.indicator as { overlay?: boolean } | undefined)?.overlay === true || context.strategy?.config?.overlay === true;
    result.options.overlay = overlay || options.force_overlay === true;
    return result;
  } });
}

/** Preserve signed arrow channels separately from the native engine's generic shapes. */
function bindArrowPlotOptions(context: Context) {
  const pine = context.pine as unknown as Record<string, unknown>;
  const descriptor = Object.getOwnPropertyDescriptor(pine, "plotarrow");
  if (!descriptor?.writable || typeof descriptor.value !== "function") error("UNSUPPORTED_EXECUTION_CONTEXT", "The native engine cannot preserve arrow options.");
  const original = descriptor.value;
  const signature = ["series", "title", "colorup", "colordown", "offset", "minheight", "maxheight", "editable", "show_last", "display", "format", "precision", "force_overlay"];
  const constants = new WeakMap<object, Record<string, unknown>>();
  Object.defineProperty(pine, "plotarrow", { ...descriptor, value: function(this: unknown, ...args: unknown[]) {
    if (context.isSecondaryContext) return Reflect.apply(original, this, args);
    const last = args.at(-1) as { __callsiteId?: unknown } | undefined;
    const sentinel = last && typeof last === "object" && typeof last.__callsiteId === "string" ? last : undefined;
    const values = sentinel ? args.slice(0, -1) : args;
    const fields: Record<string, unknown> = {};
    values.forEach((argument, index) => {
      if (argument && typeof argument === "object" && !Array.isArray(argument) && (Object.getPrototypeOf(argument) === Object.prototype || Object.getPrototypeOf(argument) === null)) {
        if (index !== values.length - 1) error("UNSUPPORTED_ARROW_OPTION", "Named arrow options must follow positional arguments.");
        Object.assign(fields, argument);
      } else {
        if (index >= signature.length) error("UNSUPPORTED_ARROW_OPTION", "Arrows received unsupported extra arguments.");
        fields[signature[index]] = argument;
      }
    });
    if (!Object.prototype.hasOwnProperty.call(fields, "series") || Object.keys(fields).some(name => !signature.includes(name))) error("UNSUPPORTED_ARROW_OPTION", "Arrows require a numeric series and only support documented options.");
    const series = fields.series, options: Record<string, unknown> = {};
    const value = resolvedSetting(series);
    if (value !== null && typeof value !== "number") error("UNSUPPORTED_ARROW_OPTION", "Arrow signals must be numbers or na, rather than boolean conditions.");
    for (const name of signature.slice(1)) {
      if (!Object.prototype.hasOwnProperty.call(fields, name)) continue;
      let value = fields[name];
      for (let depth = 0; depth < 4; depth++) {
        const scalar = value && typeof value === "object" && "__value" in value ? (value as { __value: unknown }).__value : value;
        const resolved = resolvedSetting(scalar);
        if (resolved === value) break;
        value = resolved;
      }
      if (["minheight", "maxheight", "show_last", "precision", "offset"].includes(name) && (!Number.isSafeInteger(value) || (name !== "offset" && (value as number) < 0))) error("UNSUPPORTED_ARROW_OPTION", `Arrow ${name} must resolve to a valid integer.`);
      if (["editable", "force_overlay"].includes(name) && typeof value !== "boolean") error("UNSUPPORTED_ARROW_OPTION", `Arrow ${name} must resolve to a boolean.`);
      if (["title", "display", "format"].includes(name) && (typeof value !== "string" || value.length > 4096)) error("UNSUPPORTED_ARROW_OPTION", `Arrow ${name} must resolve to a bounded string.`);
      if (["colorup", "colordown"].includes(name) && value !== undefined && value !== null && !(typeof value === "number" && Number.isNaN(value)) && typeof value !== "string") error("UNSUPPORTED_ARROW_OPTION", `Arrow ${name} must resolve to a color or na.`);
      options[name] = value;
    }
    const flags = Object.fromEntries(Object.entries(options).filter(([name]) => name !== "colorup" && name !== "colordown"));
    if (Number(options.maxheight ?? 100) < Number(options.minheight ?? 5)) error("UNSUPPORTED_ARROW_OPTION", "Arrow maxheight must be at least minheight.");
    const forwarded: unknown[] = [series, options];
    if (sentinel) forwarded.push(sentinel);
    const result = Reflect.apply(original, this, forwarded) as { options?: Record<string, unknown> };
    if (!result?.options) error("UNSUPPORTED_EXECUTION_CONTEXT", "The native engine did not preserve the arrow channel.");
    const before = constants.get(result);
    if (before && (Object.keys(before).length !== Object.keys(flags).length || Object.entries(flags).some(([name, value]) => !Object.is(value, before[name])))) error("UNSUPPORTED_ARROW_OPTION", "Arrow options other than colors must remain constant throughout the snapshot.");
    if (!before) constants.set(result, flags);
    result.options.style = "arrow";
    return result;
  } });
}

/** Preserve the current twelve-argument plotbar signature around PineTS's
 * positional optional-argument loss. Original OHLC Series stay intact. */
function bindBarPlotOptions(context: Context) {
  const pine = context.pine as unknown as Record<string, unknown>;
  const descriptor = Object.getOwnPropertyDescriptor(pine, "plotbar");
  if (!descriptor?.writable || typeof descriptor.value !== "function") error("UNSUPPORTED_EXECUTION_CONTEXT", "The native engine cannot preserve OHLC bar options.");
  const original = descriptor.value;
  const signature = ["open", "high", "low", "close", "title", "color", "editable", "show_last", "display", "format", "precision", "force_overlay"];
  const channels = new Map<number, { id: string; flags: Record<string, unknown> }>();
  let count = 0, expectedCount: number | undefined;
  Object.defineProperty(pine, "plotbar", { ...descriptor, value: function(this: unknown, ...args: unknown[]) {
    if (context.isSecondaryContext) return Reflect.apply(original, this, args);
    const last = args.at(-1) as { __callsiteId?: unknown } | undefined;
    const sentinel = last && typeof last === "object" && typeof last.__callsiteId === "string" ? last : undefined;
    const values = sentinel ? args.slice(0, -1) : args;
    const fields: Record<string, unknown> = {};
    values.forEach((argument, index) => {
      if (argument && typeof argument === "object" && !Array.isArray(argument) && (Object.getPrototypeOf(argument) === Object.prototype || Object.getPrototypeOf(argument) === null)) {
        if (index !== values.length - 1) error("UNSUPPORTED_BAR_OPTION", "Named OHLC bar options must follow positional arguments.");
        Object.assign(fields, argument);
      } else {
        if (index >= signature.length) error("UNSUPPORTED_BAR_OPTION", "OHLC bars received unsupported extra arguments.");
        fields[signature[index]] = argument;
      }
    });
    if (signature.slice(0, 4).some(name => !Object.prototype.hasOwnProperty.call(fields, name)) || Object.keys(fields).some(name => !signature.includes(name))) error("UNSUPPORTED_BAR_OPTION", "OHLC bars require open, high, low and close and only support documented options.");
    const options: Record<string, unknown> = {};
    for (const name of signature.slice(4)) {
      if (!Object.prototype.hasOwnProperty.call(fields, name)) continue;
      let value = fields[name];
      for (let depth = 0; depth < 4; depth++) {
        const scalar = value && typeof value === "object" && "__value" in value ? (value as { __value: unknown }).__value : value;
        const resolved = resolvedSetting(scalar);
        if (resolved === value) break;
        value = resolved;
      }
      if (["editable", "force_overlay"].includes(name) && typeof value !== "boolean") error("UNSUPPORTED_BAR_OPTION", `OHLC bar ${name} must resolve to a boolean.`);
      if (["show_last", "precision"].includes(name) && (!Number.isSafeInteger(value) || (value as number) < 0 || (name === "precision" && (value as number) > 16))) error("UNSUPPORTED_BAR_OPTION", `OHLC bar ${name} must resolve to a valid nonnegative integer.`);
      if (name === "title" && (typeof value !== "string" || value.length > 4_096)) error("UNSUPPORTED_BAR_OPTION", "OHLC bar title must resolve to a bounded string.");
      if (name === "display" && value !== "all" && value !== "none") error("UNSUPPORTED_BAR_OPTION", "OHLC bar display must resolve to display.all or display.none.");
      if (name === "format" && !["price", "percent", "volume"].includes(String(value))) error("UNSUPPORTED_BAR_OPTION", "OHLC bar format must resolve to price, percent or volume.");
      if (name === "color" && value !== undefined && value !== null && !(typeof value === "number" && Number.isNaN(value)) && typeof value !== "string") error("UNSUPPORTED_BAR_OPTION", "OHLC bar color must resolve to a color or na.");
      options[name] = value;
    }
    const ordinal = count++, flags = Object.fromEntries(Object.entries(options).filter(([name]) => name !== "color"));
    if (ordinal >= PINE_LIMITS.plots) error("PLOT_LIMIT", "Native Pine output exceeds 64 channels; this host capacity is distinct from TradingView plot counts.");
    const plots = context.plots as Record<string, { _callsiteId?: string; _edgelabBarPlotOrder?: number; options?: Record<string, unknown> }>;
    const title = options.title as string | undefined;
    let channel = channels.get(ordinal);
    if (!channel) {
      let id = `edgelab-ohlc-bar:${ordinal}`;
      while (Object.prototype.hasOwnProperty.call(plots, id) || (title && Object.prototype.hasOwnProperty.call(plots, title + id))) id += ":";
      channel = { id, flags }; channels.set(ordinal, channel);
    } else if (Object.keys(channel.flags).length !== Object.keys(flags).length || Object.entries(flags).some(([name, value]) => !Object.is(value, channel!.flags[name]))) error("UNSUPPORTED_BAR_OPTION", "OHLC bar options other than color must remain constant throughout the snapshot.");
    const key = title ? (!plots[title] || plots[title]._callsiteId === channel.id ? title : title + channel.id) : channel.id;
    const forwarded = [fields.open, fields.high, fields.low, fields.close, options];
    // This helper lacks transpiler callsite identities. Supply an own-context
    // global-call identity so untitled and duplicate-title calls cannot merge.
    forwarded.push({ __callsiteId: channel.id });
    const result = Reflect.apply(original, this, forwarded);
    const plot = plots[key];
    if (plot?.options?.style !== "bar" || plot._callsiteId !== channel.id) error("UNSUPPORTED_EXECUTION_CONTEXT", "The native engine did not preserve the OHLC bar channel.");
    plot._edgelabBarPlotOrder = ordinal;
    return result;
  } });
  return {
    start() { count = 0; },
    finish() {
      if (context.isSecondaryContext) return;
      if (expectedCount !== undefined && count !== expectedCount) error("UNSUPPORTED_BAR_OPTION", "OHLC bars must use the same global calls on every bar; local conditional calls are unsupported.");
      expectedCount = count;
    },
  };
}

/** Bgcolor is global-only in Pine. Invocation ordinals are host channels, not source locations. */
function bindBackgroundOptions(context: Context) {
  const pine = context.pine as unknown as Record<string, unknown>;
  const descriptor = Object.getOwnPropertyDescriptor(pine, "bgcolor");
  if (!descriptor?.writable || typeof descriptor.value !== "function") error("UNSUPPORTED_EXECUTION_CONTEXT", "The native engine cannot preserve background options.");
  const original = descriptor.value;
  const signature = ["color", "offset", "editable", "show_last", "title", "display", "force_overlay"];
  const channels = new Map<number, { id: string; flags: Record<string, unknown> }>();
  let count = 0, expectedCount: number | undefined;
  Object.defineProperty(pine, "bgcolor", { ...descriptor, value: function(this: unknown, ...args: unknown[]) {
    if (context.isSecondaryContext) return Reflect.apply(original, this, args);
    const last = args.at(-1) as { __callsiteId?: unknown } | undefined;
    const sentinel = last && typeof last === "object" && typeof last.__callsiteId === "string" ? last : undefined;
    const values = sentinel ? args.slice(0, -1) : args;
    const fields: Record<string, unknown> = {};
    values.forEach((argument, index) => {
      const value = resolvedSetting(argument);
      if (value !== null && typeof value === "object" && !Array.isArray(value)) Object.assign(fields, value);
      else {
        if (index >= signature.length) error("UNSUPPORTED_BACKGROUND_OPTION", "Background coloring received unsupported extra arguments.");
        fields[signature[index]] = value;
      }
    });
    for (const [name, value] of Object.entries(fields)) fields[name] = resolvedSetting(value);
    if (!Object.prototype.hasOwnProperty.call(fields, "color") || Object.keys(fields).some((key) => !signature.includes(key))) error("UNSUPPORTED_BACKGROUND_OPTION", "Background coloring requires a color and only supports its documented options.");
    const color = fields.color;
    if (color !== null && !(typeof color === "number" && Number.isNaN(color)) && typeof color !== "string") error("UNSUPPORTED_BACKGROUND_OPTION", "Background color must resolve to a color or na.");
    const flags: Record<string, unknown> = { offset: fields.offset ?? 0, editable: fields.editable ?? true, display: fields.display ?? "all", force_overlay: fields.force_overlay ?? false };
    if (!Number.isSafeInteger(flags.offset)) error("UNSUPPORTED_BACKGROUND_OPTION", "Background offset must resolve to a safe integer.");
    for (const name of ["editable", "force_overlay"]) if (typeof flags[name] !== "boolean") error("UNSUPPORTED_BACKGROUND_OPTION", `Background ${name} must resolve to a boolean.`);
    if (fields.show_last !== undefined) {
      if (!Number.isSafeInteger(fields.show_last) || (fields.show_last as number) < 0) error("UNSUPPORTED_BACKGROUND_OPTION", "Background show_last must resolve to a nonnegative integer.");
      flags.show_last = fields.show_last;
    }
    if (fields.title !== undefined) {
      if (typeof fields.title !== "string" || fields.title.length > 4_096) error("UNSUPPORTED_BACKGROUND_OPTION", "Background title must resolve to a bounded string.");
      flags.title = fields.title;
    }
    flags.display = typeof flags.display === "string" ? flags.display.replace(/^display[._]/, "") : flags.display;
    if (flags.display !== "all" && flags.display !== "none") error("UNSUPPORTED_BACKGROUND_OPTION", "Background display must resolve to display.all or display.none.");
    const ordinal = count++;
    if (ordinal >= PINE_LIMITS.plots) error("PLOT_LIMIT", "Native Pine output exceeds 64 channels; this host capacity is distinct from TradingView plot counts.");
    const plots = context.plots as Record<string, { _callsiteId?: string; _edgelabBackgroundOrder?: number; options?: Record<string, unknown> }>;
    const title = flags.title as string | undefined;
    let channel = channels.get(ordinal);
    if (!channel) {
      let id = `edgelab-background:${ordinal}`;
      while (Object.prototype.hasOwnProperty.call(plots, id) || (title && Object.prototype.hasOwnProperty.call(plots, title + id))) id += ":";
      channel = { id, flags }; channels.set(ordinal, channel);
    } else if (Object.keys(flags).length !== Object.keys(channel.flags).length || Object.entries(flags).some(([name, value]) => !Object.is(value, channel!.flags[name]))) {
      error("UNSUPPORTED_BACKGROUND_OPTION", "Background options other than color must remain constant throughout the snapshot.");
    }
    const key = title ? (!plots[title] || plots[title]._callsiteId === channel.id ? title : title + channel.id) : channel.id;
    if (!plots[key]) {
      const channelsInUse = Object.values(plots).filter((plot) => !["label", "drawing_line", "drawing_box", "linefill", "drawing_polyline", "table"].includes(String(plot.options?.style))).length;
      if (channelsInUse >= PINE_LIMITS.plots) error("PLOT_LIMIT", "Native Pine output exceeds 64 channels; this host capacity is distinct from TradingView plot counts.");
    }
    // The pinned helper accepts named flags, but its positional parser drops Series arguments.
    // False force_overlay must never move an overlay script back into a separate pane.
    const overlay = (context.indicator as { overlay?: boolean } | undefined)?.overlay === true;
    const result = Reflect.apply(original, this, [color, flags, { __callsiteId: channel.id }]);
    const plot = plots[key];
    if (plot?.options?.style !== "background" || plot._callsiteId !== channel.id) error("UNSUPPORTED_EXECUTION_CONTEXT", "The native engine did not preserve the background channel.");
    plot.options.overlay = overlay || flags.force_overlay === true;
    plot._edgelabBackgroundOrder = ordinal;
    return result;
  } });
  return {
    start() { count = 0; },
    finish() {
      if (context.isSecondaryContext) return;
      if (expectedCount !== undefined && count !== expectedCount) error("UNSUPPORTED_BACKGROUND_OPTION", "Background coloring must use the same global calls on every bar; local conditional calls are unsupported.");
      expectedCount = count;
    },
  };
}

/** Preserve six-slot barcolor calls and their execution order in this context only. */
function bindBarColorOptions(context: Context) {
  const pine = context.pine as unknown as Record<string, unknown>;
  const descriptor = Object.getOwnPropertyDescriptor(pine, "barcolor");
  if (!descriptor?.writable || typeof descriptor.value !== "function") error("UNSUPPORTED_EXECUTION_CONTEXT", "The native engine cannot preserve barcolor options.");
  const original = descriptor.value;
  const signature = ["color", "offset", "editable", "show_last", "title", "display"];
  const channels = new Map<number, { id: string; flags: Record<string, unknown> }>();
  let count = 0, expectedCount: number | undefined;
  Object.defineProperty(pine, "barcolor", { ...descriptor, value: function(this: unknown, ...args: unknown[]) {
    if (context.isSecondaryContext) return Reflect.apply(original, this, args);
    const last = args.at(-1) as { __callsiteId?: unknown } | undefined;
    const sentinel = last && typeof last === "object" && typeof last.__callsiteId === "string" ? last : undefined;
    const values = sentinel ? args.slice(0, -1) : args;
    const resolve = (argument: unknown) => {
      let value = argument;
      for (let depth = 0; depth < 4; depth++) {
        const scalar = value && typeof value === "object" && "__value" in value ? (value as { __value: unknown }).__value : value;
        const next = resolvedSetting(scalar);
        if (next === value) break;
        value = next;
      }
      return value;
    };
    const fields: Record<string, unknown> = {};
    values.forEach((argument, index) => {
      const value = resolve(argument);
      if (value !== null && typeof value === "object" && !Array.isArray(value)) Object.assign(fields, value);
      else {
        if (index >= signature.length) error("UNSUPPORTED_BARCOLOR_OPTION", "Bar coloring received unsupported extra arguments.");
        fields[signature[index]] = value;
      }
    });
    for (const [name, value] of Object.entries(fields)) fields[name] = resolve(value);
    if (!Object.prototype.hasOwnProperty.call(fields, "color") || Object.keys(fields).some((key) => !signature.includes(key))) error("UNSUPPORTED_BARCOLOR_OPTION", "Bar coloring requires a color and only supports its documented options.");
    const color = fields.color;
    if (color !== undefined && color !== null && !(typeof color === "number" && Number.isNaN(color)) && typeof color !== "string") error("UNSUPPORTED_BARCOLOR_OPTION", "Bar color must resolve to a color or na.");
    const flags: Record<string, unknown> = { offset: fields.offset === undefined ? 0 : fields.offset, editable: fields.editable === undefined ? true : fields.editable, display: fields.display === undefined ? "all" : fields.display };
    if (!Number.isSafeInteger(flags.offset)) error("UNSUPPORTED_BARCOLOR_OPTION", "Bar offset must resolve to a safe integer.");
    for (const name of ["editable"]) if (typeof flags[name] !== "boolean") error("UNSUPPORTED_BARCOLOR_OPTION", `Bar ${name} must resolve to a boolean.`);
    if (fields.show_last !== undefined) {
      if (!Number.isSafeInteger(fields.show_last) || (fields.show_last as number) < 0) error("UNSUPPORTED_BARCOLOR_OPTION", "Bar show_last must resolve to a nonnegative integer.");
      flags.show_last = fields.show_last;
    }
    if (fields.title !== undefined) {
      if (typeof fields.title !== "string" || fields.title.length > 4_096) error("UNSUPPORTED_BARCOLOR_OPTION", "Bar title must resolve to a bounded string.");
      flags.title = fields.title;
    }
    flags.display = typeof flags.display === "string" ? flags.display.replace(/^display[._]/, "") : flags.display;
    if (flags.display !== "all" && flags.display !== "none") error("UNSUPPORTED_BARCOLOR_OPTION", "Bar display must resolve to display.all or display.none.");
    const ordinal = count++;
    if (ordinal >= PINE_LIMITS.plots) error("PLOT_LIMIT", "Native Pine output exceeds 64 channels; this host capacity is distinct from TradingView plot counts.");
    const plots = context.plots as Record<string, { _callsiteId?: string; _edgelabBarColorOrder?: number; options?: Record<string, unknown> }>;
    const title = flags.title as string | undefined;
    let channel = channels.get(ordinal);
    if (!channel) {
      let id = `edgelab-barcolor:${ordinal}`;
      while (Object.prototype.hasOwnProperty.call(plots, id) || (title && Object.prototype.hasOwnProperty.call(plots, title + id))) id += ":";
      channel = { id, flags }; channels.set(ordinal, channel);
    } else if (Object.keys(flags).length !== Object.keys(channel.flags).length || Object.entries(flags).some(([name, value]) => !Object.is(value, channel!.flags[name]))) {
      error("UNSUPPORTED_BARCOLOR_OPTION", "Bar options other than color must remain constant throughout the snapshot.");
    }
    const key = title ? (!plots[title] || plots[title]._callsiteId === channel.id ? title : title + channel.id) : channel.id;
    if (!plots[key]) {
      const channelsInUse = Object.values(plots).filter((plot) => !["label", "drawing_line", "drawing_box", "linefill", "drawing_polyline", "table"].includes(String(plot.options?.style))).length;
      if (channelsInUse >= PINE_LIMITS.plots) error("PLOT_LIMIT", "Native Pine output exceeds 64 channels; this host capacity is distinct from TradingView plot counts.");
    }
    // The pinned helper accepts named flags, but its positional parser drops Series arguments.
    const result = Reflect.apply(original, this, [color, flags, { __callsiteId: channel.id }]);
    const plot = plots[key];
    if (plot?.options?.style !== "barcolor" || plot._callsiteId !== channel.id) error("UNSUPPORTED_EXECUTION_CONTEXT", "The native engine did not preserve the barcolor channel.");
    plot.options.overlay = true;
    plot._edgelabBarColorOrder = ordinal;
    return result;
  } });
  return {
    start() { count = 0; },
    finish() {
      if (context.isSecondaryContext) return;
      if (expectedCount !== undefined && count !== expectedCount) error("UNSUPPORTED_BARCOLOR_OPTION", "Bar coloring must use the same global calls on every bar; local conditional calls are unsupported.");
      expectedCount = count;
    },
  };
}

/** Pinned FillHelper drops optional gradient flags. Preserve them on this execution's own helper. */
function bindGradientFillOptions(context: Context) {
  const namespace = context.pine.fill;
  const descriptor = Object.getOwnPropertyDescriptor(namespace, "any");
  if (!descriptor?.writable || typeof descriptor.value !== "function") error("UNSUPPORTED_EXECUTION_CONTEXT", "The native engine cannot preserve gradient fill options.");
  const original = descriptor.value;
  const signature = ["plot1", "plot2", "top_value", "bottom_value", "top_color", "bottom_color", "title", "display", "fillgaps", "editable"];
  const gradientKeys = ["top_value", "bottom_value", "top_color", "bottom_color"];
  Object.defineProperty(namespace, "any", { ...descriptor, value: function(this: unknown, ...args: unknown[]) {
    if (context.isSecondaryContext) return Reflect.apply(original, this, args);
    const sentinel = args[args.length - 1] as { __callsiteId?: unknown } | undefined;
    const callsite = sentinel && typeof sentinel === "object" && typeof sentinel.__callsiteId === "string" ? sentinel.__callsiteId : undefined;
    const values = callsite ? args.slice(0, -1) : args;
    const namedIndex = values.findIndex((value) => value !== null && typeof value === "object" && gradientKeys.some((key) => Object.prototype.hasOwnProperty.call(value, key)));
    const positional = values.length >= 6 && typeof resolvedSetting(values[2]) === "number" && typeof resolvedSetting(values[3]) === "number";
    if (!positional && namedIndex < 0) {
      const color = resolvedSetting(values[2]);
      if (values.length >= 3 && (color === null || (typeof color === "number" && Number.isNaN(color)))) {
        // Pinned FillHelper mistakes a positional na color for a numeric gradient anchor.
        // Its named-color path is unambiguous; hline's solid signature omits show_last.
        const hlines = values.slice(0, 2).every((value) => {
          const reference = resolvedSetting(value) as { options?: { style?: string } } | null;
          return reference?.options?.style === "hline";
        });
        const solid = hlines ? ["plot1", "plot2", "color", "title", "editable", "fillgaps", "display"] : ["plot1", "plot2", "color", "title", "editable", "show_last", "fillgaps", "display"];
        const options: Record<string, unknown> = {};
        for (let index = 2; index < values.length; index++) {
          const value = resolvedSetting(values[index]);
          if (value && typeof value === "object" && !Array.isArray(value)) Object.assign(options, value);
          else {
            if (index >= solid.length) error("UNSUPPORTED_FILL_OPTION", "Solid fill received unsupported extra arguments.");
            options[solid[index]] = value;
          }
        }
        if (Object.keys(options).some((key) => !solid.slice(2).includes(key))) error("UNSUPPORTED_FILL_OPTION", "Solid fill received unsupported named options.");
        const forwarded: unknown[] = [values[0], values[1], options];
        if (callsite) forwarded.push(sentinel);
        return Reflect.apply(original, this, forwarded);
      }
      return Reflect.apply(original, this, args);
    }
    const named = namedIndex >= 0 ? values[namedIndex] as Record<string, unknown> : {};
    const fields: Record<string, unknown> = {};
    const limit = namedIndex >= 0 ? namedIndex : values.length;
    for (let index = 0; index < limit; index++) {
      if (index >= signature.length) error("UNSUPPORTED_FILL_OPTION", "Gradient fill received unsupported extra arguments.");
      if (values[index] && typeof values[index] === "object" && index >= 6) Object.assign(fields, values[index]);
      else fields[signature[index]] = values[index];
    }
    Object.assign(fields, named);
    if (Object.keys(fields).some((key) => !signature.includes(key) && !["hline1", "hline2"].includes(key))) error("UNSUPPORTED_FILL_OPTION", "Gradient fill supports title, editable, fillgaps and display; show_last and extra options are unavailable.");
    const first = fields.plot1 ?? fields.hline1, second = fields.plot2 ?? fields.hline2;
    if (first === undefined || second === undefined || gradientKeys.some((key) => !(key in fields))) error("UNSUPPORTED_FILL_OPTION", "Gradient fill requires two references, two values and two colors.");
    const title = resolvedSetting(fields.title);
    if (title !== undefined && typeof title !== "string") error("UNSUPPORTED_FILL_OPTION", "Gradient fill title must resolve to a string.");
    const flags: Record<string, PineScalar> = { editable: true, fillgaps: false, display: "all" };
    for (const key of ["editable", "fillgaps"]) {
      const value = resolvedSetting(fields[key]);
      if (value !== undefined) {
        if (typeof value !== "boolean") error("UNSUPPORTED_FILL_OPTION", `Gradient ${key} must resolve to a boolean.`);
        flags[key] = value;
      }
    }
    const display = resolvedSetting(fields.display);
    if (display !== undefined) {
      const normalized = typeof display === "string" ? display.replace(/^display[._]/, "") : display;
      if (normalized !== "all" && normalized !== "none") error("UNSUPPORTED_FILL_OPTION", "Gradient display must resolve to display.all or display.none.");
      flags.display = display as string;
    }
    const options = Object.fromEntries(gradientKeys.map((key) => [key, resolvedSetting(fields[key])]));
    if (title !== undefined) options.title = title;
    const forwarded: unknown[] = [first, second, options];
    if (callsite) forwarded.push(sentinel);
    const plots = context.plots as Record<string, { _callsiteId?: string; options?: Record<string, unknown> }>;
    let key = typeof title === "string" && title ? title : "fill";
    if (plots[key] && callsite && plots[key]._callsiteId !== callsite) key = callsite;
    const returned = Reflect.apply(original, this, forwarded);
    const plot = plots[key];
    if (!plot?.options || plot.options.gradient !== true || (callsite && plot._callsiteId !== callsite)) error("UNSUPPORTED_EXECUTION_CONTEXT", "The native engine did not preserve the gradient fill callsite.");
    for (const [name, value] of Object.entries(flags)) {
      if (plot.options[name] !== undefined && plot.options[name] !== value) error("UNSUPPORTED_FILL_OPTION", `Gradient ${name} must remain constant throughout the snapshot.`);
      plot.options[name] = value;
    }
    return returned;
  } });
}

/** Validate the resolved declaration on this context alone, before its plots or orders. */
function bindDeclarationLayer(context: Context, strategy: boolean) {
  const owner = strategy ? context.pine.strategy : context.pine;
  const key = strategy ? "any" : "indicator";
  const descriptor = Object.getOwnPropertyDescriptor(owner, key);
  if (!descriptor?.writable || typeof descriptor.value !== "function") error("UNSUPPORTED_EXECUTION_CONTEXT", "The native engine cannot preserve declaration layers.");
  const original = descriptor.value;
  let previous: boolean | undefined;
  Object.defineProperty(owner, key, { ...descriptor, value: function(this: unknown, ...args: unknown[]) {
    const config = Reflect.apply(original, this, args) as Record<string, unknown>;
    const resolved = resolvedSetting(config.behind_chart);
    const value = resolved === undefined ? true : resolved;
    if (typeof value !== "boolean") error("UNSUPPORTED_DECLARATION_OPTION", "behind_chart must resolve to a constant boolean.");
    if (previous !== undefined && previous !== value) error("UNSUPPORTED_DECLARATION_OPTION", "behind_chart must remain constant throughout the snapshot.");
    previous = value; config.behind_chart = value;
    return config;
  } });
}

/** Own-instance compatibility for PineTS 0.11.0; never rewrite Pine or patch engine prototypes. */
function bindClosedSnapshot(prepared: PreparedScript, strategyDeclaration: boolean, encounteredAlerts: Set<string>, realtime = false, quantityStep?: number) {
  const original = prepared.fn;
  const installed = new WeakSet<Context>();
  const backgrounds = new WeakMap<Context, ReturnType<typeof bindBackgroundOptions>>();
  const barcolors = new WeakMap<Context, ReturnType<typeof bindBarColorOptions>>();
  const barplots = new WeakMap<Context, ReturnType<typeof bindBarPlotOptions>>();
  const wrapped = function(this: unknown, context: Context, ...args: unknown[]) {
    if (!installed.has(context)) {
      if (quantityStep !== undefined) Object.defineProperty(context, "_edgelabQuantityStep", { value: quantityStep });
      bindDeclarationLayer(context, strategyDeclaration);
      bindPlotOptions(context);
      bindArrowPlotOptions(context);
      barplots.set(context, bindBarPlotOptions(context));
      bindGradientFillOptions(context);
      backgrounds.set(context, bindBackgroundOptions(context));
      barcolors.set(context, bindBarColorOptions(context));
      const pine = context.pine as unknown as Record<string, unknown>;
      const alertCondition = Object.getOwnPropertyDescriptor(pine, "alertcondition");
      const alert = pine.alert as { any?: unknown };
      if (!alertCondition?.writable || typeof alertCondition.value !== "function" || typeof alert?.any !== "function") {
        error("UNSUPPORTED_EXECUTION_CONTEXT", "The native engine cannot disclose unavailable alert delivery.");
      }
      const condition = alertCondition.value;
      Object.defineProperty(pine, "alertcondition", { ...alertCondition, value: function(this: unknown, ...args: unknown[]) {
        encounteredAlerts.add("alertcondition"); return Reflect.apply(condition, this, args);
      } });
      // AlertHelper.any is inherited; shadow only this context's instance.
      const send = alert.any;
      Object.defineProperty(alert, "any", { configurable: true, writable: true, value: function(this: unknown, ...args: unknown[]) {
        encounteredAlerts.add("alert"); return Reflect.apply(send, this, args);
      } });
      if (!realtime) Object.defineProperties(context.pine.barstate, {
        ishistory: { get: () => true },
        isrealtime: { get: () => false },
        isconfirmed: { get: () => true },
        isnew: { get: () => true },
        isfirst: { get: () => context.idx === 0 },
        islast: { get: () => context.idx === context.length - 1 },
        islastconfirmedhistory: { get: () => context.idx === context.length - 1 },
      });
      if (strategyDeclaration) {
        const namespace = context.pine.strategy;
        const descriptor = Object.getOwnPropertyDescriptor(namespace, "any");
        if (!descriptor?.writable || typeof descriptor.value !== "function") error("UNSUPPORTED_EXECUTION_CONTEXT", "The native engine cannot enforce closed-snapshot strategy settings.");
        const declare = descriptor.value;
        Object.defineProperty(namespace, "any", { ...descriptor, value: function(this: unknown, ...settings: unknown[]) {
          const config = Reflect.apply(declare, this, settings) as Record<string, unknown>;
          for (const key of RECALCULATION_SETTINGS) {
            const resolved = resolvedSetting(config[key]);
            // Historical fill callbacks are scheduled by the per-instance broker.
            // calc_on_every_tick still affects only open realtime bars.
            if (key === "calc_on_every_tick" || key === "calc_on_order_fills") {
              if (resolved !== true && resolved !== false && resolved !== undefined) error("UNSUPPORTED_EXECUTION_SETTING", `${key} must resolve to a boolean.`);
            } else {
              if (resolved === true) error("UNSUPPORTED_EXECUTION_SETTING", `${key}=true requires historical-tick recalculation, which this execution does not support.`);
              if (resolved !== false && resolved !== undefined) error("UNSUPPORTED_EXECUTION_SETTING", `${key} must resolve to false for closed-snapshot execution.`);
            }
            if (typeof resolved === "boolean") config[key] = resolved;
          }
          if (config.calc_on_order_fills === true && resolvedSetting(config.use_bar_magnifier) === true) error("UNSUPPORTED_EXECUTION_SETTING", "use_bar_magnifier=true requires lower-timeframe market data, which historical fill execution does not provide.");
          return config;
        } });
      }
      installed.add(context);
    }
    backgrounds.get(context)!.start();
    barcolors.get(context)!.start();
    barplots.get(context)!.start();
    const checked = () => {
      backgrounds.get(context)!.finish();
      barcolors.get(context)!.finish();
      barplots.get(context)!.finish();
      const channels = (Object.values(context.plots) as { options?: { style?: string }; data?: unknown[] }[]).filter((plot) => !["label", "drawing_line", "drawing_box", "linefill", "drawing_polyline", "table"].includes(plot.options?.style ?? ""));
      if (channels.length > PINE_LIMITS.plots) error("PLOT_LIMIT", "Native Pine output exceeds 64 channels; this host capacity is distinct from TradingView plot counts.");
      if (channels.reduce((total, plot) => total + (plot.data?.length ?? 0), 0) > PINE_LIMITS.points) error("POINT_LIMIT", "Native Pine output exceeds 1,280,000 bar slots.");
    };
    const value = Reflect.apply(original, this, [context, ...args]);
    if (value && typeof value.then === "function") return value.then((result: unknown) => { checked(); return result; });
    checked(); return value;
  };
  // The engine reads this tag to select v5/v6 semantics before the first execution.
  const version = Object.getOwnPropertyDescriptor(original, "_pineVersion");
  if (version) Object.defineProperty(wrapped, "_pineVersion", version);
  prepared.fn = wrapped;
}

function preparePineRequest(request: PineRequest, realtime = false) {
  const indicator = new Indicator(request.source, request.inputs ?? {});
  let prepared: PreparedScript;
  try { prepared = indicator.prepare({ debug: false, ln: false }); } catch (cause) {
    error("COMPILE_ERROR", cause instanceof Error ? cause.message.slice(0, 4_096) : "Native Pine compilation failed.");
  }
  const declaration = indicator.getDeclarationType();
  if (!declaration) error("DECLARATION_REQUIRED", "Native Pine requires an indicator() or strategy() declaration.");
  const settings = request.strategySettings ?? {};
  if (Object.keys(settings).length && declaration !== "strategy") error("INVALID_STRATEGY_SETTINGS", "Strategy test settings require a strategy() script.");
  for (const [key, value] of Object.entries(settings)) indicator.prop[key] = value;
  const inputDefinitions = definitions(indicator);
  const inputs = runtimeInputs(request, inputDefinitions);
  for (const definition of inputDefinitions) if (definition.activeCondition) {
    try { definition.active = pineInputActive(definition, inputDefinitions, inputs); } catch { error("UNSUPPORTED_INPUT", "Input activation must resolve to a supported boolean expression."); }
  }
  const parsedLayer = indicator.prop.behind_chart;
  if (parsedLayer !== undefined && typeof parsedLayer !== "boolean" && typeof parsedLayer !== "string") error("UNSUPPORTED_DECLARATION_OPTION", "behind_chart must resolve to a constant boolean.");
  if (parsedLayer === "na") error("UNSUPPORTED_DECLARATION_OPTION", "behind_chart must resolve to a constant boolean.");
  // Omitted declarations have the public schema default true; expressions can remain unresolved.
  const pendingLayer = typeof parsedLayer !== "boolean";
  const descriptor: PinePrepareResult = { kind: "prepare", source: request.source, language: "pine", pineVersion: pineSourceVersion(request.source), declaration, name: displayName(request.source, declaration), overlay: indicator.prop.overlay === true, behindChart: typeof parsedLayer === "boolean" ? parsedLayer : true, inputDefinitions, diagnostics: [
    ...(pendingLayer ? [warning("DECLARATION_LAYER_PENDING", "The declaration layer cannot be resolved during Check; the prepared default is a placeholder and execution will validate the actual constant boolean.")] : []),
    ...(!realtime ? [warning("CLOSED_BAR_SNAPSHOT", "This run treats supplied bars as closed historical snapshots, including the final bar. It does not simulate realtime updates, realtime rollback or realtime varip tick persistence. Historical order-fill callbacks retain the final OHLCV values.")] : []),
    ...(declaration === "strategy" ? [warning("UNSUPPORTED_EXECUTION_SETTINGS", "Strategies calculate at the candle close and can recalculate after historical order fills with calc_on_order_fills=true. Fills follow an assumed OHLC price path, which can differ from actual trades. Historical callbacks see final OHLCV values. Trailing exits arm and follow the best price reached along the remaining path. Live strategy scheduling, calc_on_every_history_tick and intrabar margin-liquidation simulations with fill recalculation are unavailable.")] : []),
  ] };
  return { indicator, prepared, descriptor, inputs, declaration };
}

/** Called only inside the isolated worker; exported for deterministic engine fixtures. */
export async function executePineRequest(value: unknown): Promise<PineResult> {
  const request = validatePineRequest(value);
  const started = performance.now();
  const { indicator, prepared, descriptor, inputs, declaration } = preparePineRequest(request);
  if (request.action === "prepare") return validatePineResponse({ id: request.id, status: "completed", result: descriptor }, request);
  const encounteredAlerts = new Set<string>();
  bindClosedSnapshot(prepared, declaration === "strategy", encounteredAlerts, false, request.context?.quantityStep);
  const local = chartProvider(request);
  const engine = new PineTS(local.provider, request.context!.symbol, request.context!.timeframe, request.bars!.length);
  engine.setMaxLoops(PINE_LIMITS.loops);
  engine.setTimezone("UTC");
  let context;
  try { context = await engine.run(indicator); } catch (cause) {
    if (local.unavailable()) throw local.unavailable();
    if (cause instanceof PineProtocolError) throw cause;
    const code = (cause as { code?: unknown } | null)?.code;
    if (code === "UNSUPPORTED_ORDER_FILL_CONTEXT" || code === "STRATEGY_EXECUTION_LIMIT" || code === "REALTIME_STATE_LIMIT") error(code, cause instanceof Error ? cause.message.slice(0, 4_096) : "Strategy execution stopped.");
    error("RUNTIME_ERROR", cause instanceof Error ? cause.message.slice(0, 4_096) : "Native Pine execution failed.");
  }
  if (local.unavailable()) throw local.unavailable();
  return executionResult(request, descriptor, inputs, context, encounteredAlerts, started);
}

function executionResult(request: PineRequest, descriptor: PinePrepareResult, inputs: Record<string, PineInputValue>, context: Context, encounteredAlerts: Set<string>, started: number, realtime = false): PineExecutionResult {
  const diagnostics = [...descriptor.diagnostics.filter((item) => item.code !== "DECLARATION_LAYER_PENDING"),
    warning(realtime ? "REALTIME_CONTEXT" : "SNAPSHOT_CONTEXT", realtime
      ? "Execution processes the received chart updates with UTC, a 24x7 session and the supplied quote currency (USD when omitted). Unsupplied trades, exchange sessions, alert delivery and additional market data are unavailable."
      : "Execution uses the supplied OHLCV snapshot with UTC, a 24x7 session and the supplied quote currency (USD when omitted); exchange sessions, tick history and additional market data are unavailable."),
    ...(realtime ? [warning("REALTIME_STATE_BOUNDS", "Realtime execution retains at most 20,000 bars and bounded rollback state: 16,384 payload nodes, 262,144 mutable cells and 1,280,000 scoped Series slots. Exceeding a limit halts the session; these are not whole-engine heap limits.")] : []),
  ];
  if (encounteredAlerts.size) diagnostics.push(warning("ALERT_DELIVERY_UNAVAILABLE", `Encountered Pine ${[...encounteredAlerts].sort().join(" and ")} calls. Alert delivery and notifications are unavailable; no alert was sent.`));
  if (request.context!.mintick === undefined || request.context!.pointvalue === undefined || request.context!.mincontract === undefined || request.context!.quantityStep === undefined) diagnostics.push(warning("DEFAULT_SYMBOL_METADATA", "Unsupplied instrument details default to a price tick of 0.01, value per point of 1 and minimum quantity of 1; an omitted quantity increment uses the minimum. These assumptions can change fills and results."));
  if (request.context!.quantityStep !== undefined) diagnostics.push(warning("SYMBOL_FILTER_SCOPE", "Trade quantities use the supplied minimum and increment. This simulation does not enforce exchange notional limits, separate market-order filters, currency conversion or live order acceptance."));
  for (const item of context.warnings ?? []) {
    if (diagnostics.length >= PINE_LIMITS.diagnostics) break;
    diagnostics.push(warning("ENGINE_WARNING", item.message));
  }
  const properties = context.strategy?.config ?? context.indicator;
  const overlay = properties?.overlay === true;
  const output = plotResults(context.plots, overlay, diagnostics, request.bars!);
  const result = { ...descriptor, kind: "run", name: properties?.title ?? descriptor.name, overlay, behindChart: properties?.behind_chart === undefined ? true : properties.behind_chart, diagnostics: diagnostics.slice(0, PINE_LIMITS.diagnostics), inputs, plots: output.plots, ...(context.strategy ? { strategy: strategyResult(context.strategy) } : {}), audit: { engine: "PineTS", engineVersion: "0.11.0", bars: request.bars!.length, sourceBytes: new TextEncoder().encode(request.source).length, mode: request.mode ?? "historical", elapsedMs: performance.now() - started } };
  return validatePineResponse({ id: request.id, status: "completed", result, ...("buffers" in output ? { encoding: "pine-packed-v1", buffers: output.buffers } : {}) }, request) as PineExecutionResult;
}


type RealtimeEngine = PineTS & {
  setRealtimeMode(enabled: boolean, options: { initialTail: "historical" }): void;
  updateTail(context: Context, event: { confirmed: boolean; received: boolean }): Promise<boolean>;
};
type LiveState = {
  sessionId: string; sequence: number; confirmed: boolean; request: PineRequest;
  engine: RealtimeEngine; context?: Context; local: ReturnType<typeof chartProvider>;
  descriptor: PinePrepareResult; inputs: Record<string, PineInputValue>; alerts: Set<string>;
};
// Each result owns fresh output buffers; only its validated bar index is retained for encoding.
const liveResultBars = new WeakMap<PineExecutionResult, readonly Candle[]>();

/** One isolated, immutable-source indicator session. Cancellation never publishes pending work. */
export function createPineLiveExecutor(): { execute(value: unknown): Promise<PineExecutionResult>; dispose(): void } {
  let state: LiveState | undefined;
  let busy = false, halted = false;
  const dispose = () => { halted = true; state = undefined; };
  const active = (owner: LiveState) => {
    if (halted || state !== owner) error("LIVE_SESSION_HALTED", "The live Pine session has stopped.");
  };
  return {
    dispose,
    async execute(value: unknown) {
      if (halted) error("LIVE_SESSION_HALTED", "The live Pine session has stopped.");
      if (busy) { dispose(); error("LIVE_CONCURRENT", "A live Pine command is already running; the session has stopped."); }
      busy = true;
      const started = performance.now();
      try {
        const command: PineLiveRequest = validatePineLiveRequest(value);
        let owner: LiveState;
        if (state && command.sessionId !== state.sessionId) error("LIVE_SESSION_MISMATCH", "The live Pine command belongs to another session.");
        if (command.action === "start") {
          if (state) error("LIVE_SEQUENCE", "A live Pine session can only be initialized once.");
          const request = command.request;
          const { indicator, prepared, descriptor, inputs, declaration } = preparePineRequest(request, true);
          if (declaration !== "indicator") error("LIVE_STRATEGY_UNAVAILABLE", "Persistent realtime execution is available only for indicators; strategy tick scheduling is unavailable.");
          const alerts = new Set<string>();
          bindClosedSnapshot(prepared, false, alerts, true, request.context?.quantityStep);
          const local = chartProvider(request);
          const engine = new PineTS(local.provider, request.context!.symbol, request.context!.timeframe, request.bars!.length) as RealtimeEngine;
          engine.setMaxLoops(PINE_LIMITS.loops);
          engine.setTimezone("UTC");
          engine.setRealtimeMode(true, { initialTail: "historical" });
          owner = { sessionId: command.sessionId, sequence: 0, confirmed: true, request, engine, local, descriptor, inputs, alerts };
          state = owner;
          const context = await engine.run(indicator);
          active(owner);
          owner.context = context;
        } else {
          if (!state) error("LIVE_SEQUENCE", "Initialize the live Pine session before updating it.");
          owner = state;
          if (command.sessionId !== owner.sessionId) error("LIVE_SESSION_MISMATCH", "The live Pine command belongs to another session.");
          if (command.sequence !== owner.sequence + 1) error("LIVE_SEQUENCE", "Live Pine updates require the exact next sequence.");
          const bars = owner.request.bars!;
          const previous = bars[bars.length - 1];
          const append = command.bar.time > previous.time;
          if (command.bar.time < previous.time) error("INVALID_BARS", "Live Pine cannot revise the committed chart history.");
          if (append) {
            if (!owner.confirmed) error("INVALID_BARS", "Confirm the current Pine bar before appending another bar.");
            if (command.bar.time !== owner.local.nextTime()) error("INVALID_BARS", "Live Pine accepts exactly the next UTC/calendar chart bucket; gaps require a new session.");
            if (bars.length >= PINE_LIMITS.bars) error("BAR_LIMIT", "The live Pine session reached 20,000 bars; history eviction is unavailable.");
          } else if (owner.confirmed) error("INVALID_BARS", "A committed Pine bar cannot receive another update or confirmation.");
          owner.local.reset();
          owner.local.update(command.bar, append);
          owner.request = { ...owner.request, id: pineLiveRequestId(owner.sessionId, command.sequence), bars: append ? [...bars, command.bar] : [...bars.slice(0, -1), command.bar] };
          const changed = await owner.engine.updateTail(owner.context!, { confirmed: command.confirmed, received: true });
          active(owner);
          if (!changed) error("LIVE_UPDATE_UNAVAILABLE", "The native engine did not execute this received update.");
          owner.confirmed = command.confirmed;
          owner.sequence = command.sequence;
        }
        active(owner);
        if (owner.local.unavailable()) throw owner.local.unavailable();
        const result = executionResult(owner.request, owner.descriptor, owner.inputs, owner.context!, owner.alerts, started, true);
        active(owner);
        liveResultBars.set(result, owner.request.bars!);
        return result;
      } catch (cause) {
        const unavailable = state?.local.unavailable();
        dispose();
        if (unavailable) throw unavailable;
        if (cause instanceof PineProtocolError) throw cause;
        if ((cause as { code?: unknown } | null)?.code === "REALTIME_STATE_LIMIT") error("REALTIME_STATE_LIMIT", cause instanceof Error ? cause.message : "Realtime retained-state limit exceeded.");
        error("RUNTIME_ERROR", cause instanceof Error ? cause.message.slice(0, 4_096) : "Native realtime Pine execution failed.");
      } finally { busy = false; }
    },
  };
}

if (typeof self !== "undefined" && typeof document === "undefined") {
  const scope = self as unknown as DedicatedWorkerGlobalScope;
  const live = createPineLiveExecutor();
  let liveStarted = false, oneShotRunning = 0;
  scope.onmessage = async (event: MessageEvent<unknown>) => {
    const raw = event.data as { id?: unknown; protocol?: unknown; sessionId?: unknown; sequence?: unknown } | null;
    const isLive = raw?.protocol === PINE_LIVE_PROTOCOL;
    // Failed malformed requests never echo unknown objects or unbounded identity data.
    const sessionId = typeof raw?.sessionId === "string" && /^[A-Za-z0-9_-]{16,96}$/.test(raw.sessionId) ? raw.sessionId : "invalid-session-id";
    const sequence = Number.isSafeInteger(raw?.sequence) && (raw!.sequence as number) >= 0 && (raw!.sequence as number) <= 1_000_000_000 ? raw!.sequence as number : 0;
    const id = isLive ? pineLiveRequestId(sessionId, sequence) : typeof raw?.id === "string" ? raw.id.slice(0, 128) : "invalid-request";
    const envelope = (response: unknown) => isLive ? { protocol: PINE_LIVE_PROTOCOL, sessionId, sequence, response } : response;
    try {
      if (isLive) {
        liveStarted = true;
        if (oneShotRunning) { live.dispose(); error("LIVE_CONCURRENT", "The worker already has an execution in progress."); }
        const result = await live.execute(event.data);
        const response = toPineWireResponse(id, result, liveResultBars.get(result));
        scope.postMessage(envelope(response), "buffers" in response ? response.buffers : []);
      } else {
        if (liveStarted) { live.dispose(); error("LIVE_SESSION_MISMATCH", "A live Pine worker cannot accept one-shot requests."); }
        oneShotRunning++;
        try {
          const result = await executePineRequest(event.data);
          const request = validatePineRequest(event.data);
          const response = toPineWireResponse(id, result, request.bars);
          scope.postMessage(response, "buffers" in response ? response.buffers : []);
        } finally { oneShotRunning--; }
      }
    } catch (cause) {
      if (isLive) live.dispose();
      scope.postMessage(envelope({ id, status: "failed", error: { code: cause instanceof PineProtocolError ? cause.code : "RUNTIME_ERROR", message: cause instanceof Error ? cause.message.slice(0, 4_096) : "Native Pine execution failed." } }));
    }
  };
}
