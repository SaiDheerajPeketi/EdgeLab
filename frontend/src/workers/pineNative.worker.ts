/// <reference lib="webworker" />
import { Indicator, PineTS, computeNextPeriodStart } from "pinets";
import type { Context, IProvider, ISymbolInfo, Kline, PreparedScript } from "pinets";
import { PINE_LIMITS, PineProtocolError, canonicalPineTimeframe, pineSourceVersion, validatePineRequest, validatePineResponse } from "../lib/pineProtocol";
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
    if (item.options) definition.options = item.options.map(plainScalar);
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
function chartProvider(request: PineRequest): { provider: IProvider; unavailable: () => PineProtocolError | undefined } {
  const context = request.context!;
  const timeframe = canonicalPineTimeframe(context.timeframe);
  let failure: PineProtocolError | undefined;
  let calls = 0;
  const reject = (symbol: string, tf?: string) => {
    failure ??= new PineProtocolError("UNAVAILABLE_DATA", `Only loaded ${context.symbol} ${context.timeframe} chart data is available; requested ${symbol}${tf ? ` ${tf}` : ""}.`);
  };
  const interval = /^(\d+)([SDWM]?)$/.exec(timeframe)!;
  const count = Number(interval[1]), unit = interval[2];
  const candles: Kline[] = request.bars!.map((bar) => {
    const openTime = bar.time * 1000;
    const closeTime = unit === "M" ? computeNextPeriodStart(openTime, "month", count) : openTime + count * ({ S: 1_000, D: 86_400_000, W: 604_800_000 }[unit] ?? 60_000);
    return { openTime, closeTime, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, quoteAssetVolume: 0, numberOfTrades: 0, takerBuyBaseAssetVolume: 0, takerBuyQuoteAssetVolume: 0, ignore: 0 };
  });
  const symbol = context.symbol, ticker = symbol.split(":").slice(-1)[0];
  const info: ISymbolInfo = {
    current_contract: "", description: symbol, isin: "", main_tickerid: symbol, prefix: symbol.includes(":") ? symbol.split(":")[0] : "", root: ticker, ticker, tickerid: symbol, type: "", basecurrency: "", country: "", currency: "USD", timezone: "UTC", session: "24x7", volumetype: "base", mincontract: 1,
    minmove: 1, mintick: context.mintick ?? 0.01, pointvalue: context.pointvalue ?? 1, pricescale: 1 / (context.mintick ?? 0.01),
    employees: 0, industry: "", sector: "", shareholders: 0, shares_outstanding_float: 0, shares_outstanding_total: 0, expiration_date: 0,
    recommendations_buy: 0, recommendations_buy_strong: 0, recommendations_date: 0, recommendations_hold: 0, recommendations_sell: 0, recommendations_sell_strong: 0, recommendations_total: 0,
    target_price_average: 0, target_price_date: 0, target_price_estimates: 0, target_price_high: 0, target_price_low: 0, target_price_median: 0,
  };
  const provider: IProvider = {
    configure() { /* The provider is a closed snapshot, with no credentials or network. */ },
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
  // Empty unavailable snapshots let upstream's ready promise settle; no result is published after failure.
  return { provider, unavailable: () => failure };
}
export function normalizePinePlotValue(value: unknown): PinePlot["points"][number]["value"] {
  if (Array.isArray(value)) {
    if (value.length !== 4 || value.some((item) => item != null && typeof item !== "number")
      || value.some((item) => typeof item === "number" && !Number.isFinite(item) && !Number.isNaN(item))) {
      return error("UNSUPPORTED_RESULT", "Invalid OHLC plot output.");
    }
    // Pine plotcandle hides a bar when any required OHLC series is na.
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
  let backgroundIndex = 0, barcolorIndex = 0;
  const ordered = entries.map((entry) => {
    const style = (entry[1] as { options?: { style?: string } }).options?.style;
    return style === "background" ? backgrounds[backgroundIndex++] : style === "barcolor" ? barcolors[barcolorIndex++] : entry;
  });
  const plots = ordered.flatMap(([id, value]) => {
    const plot = value as { title?: string; _edgelabBackgroundOrder?: number; _edgelabBarColorOrder?: number; options?: Record<string, unknown>; data?: { time: number; value: unknown; options?: Record<string, unknown> }[] };
    const style = typeof plot.options?.style === "string" ? plot.options.style : "line";
    if (!Array.isArray(plot.data)) { diagnostics.push(warning("UNSUPPORTED_DRAWING", `The ${style} drawing output is not exposed by this chart adapter.`)); return []; }
    if (plot.data.some((point) => point.value && typeof point.value === "object" && !Array.isArray(point.value))) { diagnostics.push(warning("UNSUPPORTED_DRAWING", `The ${style} drawing output is not exposed by this chart adapter.`)); return []; }
    // HlineHelper forwards omitted parameters as own undefined fields. Preserve absence
    // separately from explicit na (NaN), so a missing color does not hide a fixed level.
    const plotFields = (value: object) => fields(["hline", "candle", "candles", "plotcandle"].includes(style) ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) : value);
    const points = function* (): Generator<PinePlotPoint> {
      for (const point of plot.data!) yield { time: point.time / 1000, value: normalizePinePlotValue(point.value), options: plotFields(point.options ?? {}) };
    };
    const name = plot.title ?? (style === "background" ? `Background ${(plot._edgelabBackgroundOrder ?? 0) + 1}` : style === "barcolor" ? `Bar color ${(plot._edgelabBarColorOrder ?? 0) + 1}` : id);
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
  return { config: fields(state.config), metrics: fields(state, METRIC_FIELDS), closedTrades: trades(state.closedtrades), openTrades: trades(state.opentrades), pendingOrders: state.pending_orders.map((item) => { const order = fields(item, ORDER_FIELDS); if (typeof order.time === "number") order.time /= 1000; return order; }) };
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
  const signature = ["series", "title", "color", "linewidth", "style", "trackprice", "histbase", "offset", "join", "editable", "show_last", "display", "format", "precision", "force_overlay"];
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
      if (name === "color" && value !== undefined && value !== null && !(typeof value === "number" && Number.isNaN(value)) && typeof value !== "string" && typeof value !== "function") error("UNSUPPORTED_PLOT_OPTION", "Plot color must resolve to a color or na.");
    }
    const flags = Object.prototype.hasOwnProperty.call(options, "offset") ? { offset: options.offset } : {};
    const forwarded: unknown[] = [series, options];
    if (sentinel) forwarded.push(sentinel);
    const result = Reflect.apply(original, this, forwarded) as { options?: Record<string, unknown> };
    if (!result?.options) error("UNSUPPORTED_EXECUTION_CONTEXT", "The native engine did not preserve the plot channel.");
    const previous = constantOptions.get(result);
    if (previous && (Object.keys(previous).length !== Object.keys(flags).length || Object.entries(flags).some(([name, value]) => !Object.is(value, previous[name])))) error("UNSUPPORTED_PLOT_OPTION", "Plot offset must remain constant throughout the snapshot.");
    if (!previous) constantOptions.set(result, flags);
    const overlay = (context.indicator as { overlay?: boolean } | undefined)?.overlay === true || context.strategy?.config?.overlay === true;
    result.options.overlay = overlay || options.force_overlay === true;
    return result;
  } });
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
function bindClosedSnapshot(prepared: PreparedScript, strategyDeclaration: boolean, encounteredAlerts: Set<string>) {
  const original = prepared.fn;
  const installed = new WeakSet<Context>();
  const backgrounds = new WeakMap<Context, ReturnType<typeof bindBackgroundOptions>>();
  const barcolors = new WeakMap<Context, ReturnType<typeof bindBarColorOptions>>();
  const wrapped = function(this: unknown, context: Context, ...args: unknown[]) {
    if (!installed.has(context)) {
      bindDeclarationLayer(context, strategyDeclaration);
      bindPlotOptions(context);
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
      Object.defineProperties(context.pine.barstate, {
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
            if (resolved === true) error("UNSUPPORTED_EXECUTION_SETTING", `${key}=true requires tick or fill recalculation, which closed-snapshot execution does not support.`);
            if (resolved !== false && resolved !== undefined) error("UNSUPPORTED_EXECUTION_SETTING", `${key} must resolve to false for closed-snapshot execution.`);
            if (resolved === false) config[key] = false;
          }
          return config;
        } });
      }
      installed.add(context);
    }
    backgrounds.get(context)!.start();
    barcolors.get(context)!.start();
    const checked = () => {
      backgrounds.get(context)!.finish();
      barcolors.get(context)!.finish();
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

/** Called only inside the isolated worker; exported for deterministic engine fixtures. */
export async function executePineRequest(value: unknown): Promise<PineResult> {
  const request = validatePineRequest(value);
  const started = performance.now();
  const indicator = new Indicator(request.source, request.inputs ?? {});
  let prepared: PreparedScript;
  try { prepared = indicator.prepare({ debug: false, ln: false }); } catch (cause) {
    error("COMPILE_ERROR", cause instanceof Error ? cause.message.slice(0, 4_096) : "Native Pine compilation failed.");
  }
  const declaration = indicator.getDeclarationType();
  if (!declaration) error("DECLARATION_REQUIRED", "Native Pine requires an indicator() or strategy() declaration.");
  const inputDefinitions = definitions(indicator);
  const inputs = runtimeInputs(request, inputDefinitions);
  const parsedLayer = indicator.prop.behind_chart;
  if (parsedLayer !== undefined && typeof parsedLayer !== "boolean" && typeof parsedLayer !== "string") error("UNSUPPORTED_DECLARATION_OPTION", "behind_chart must resolve to a constant boolean.");
  if (parsedLayer === "na") error("UNSUPPORTED_DECLARATION_OPTION", "behind_chart must resolve to a constant boolean.");
  // Omitted declarations have the public schema default true; expressions can remain unresolved.
  const pendingLayer = typeof parsedLayer !== "boolean";
  const descriptor: PinePrepareResult = { kind: "prepare", source: request.source, language: "pine", pineVersion: pineSourceVersion(request.source), declaration, name: displayName(request.source, declaration), overlay: indicator.prop.overlay === true, behindChart: typeof parsedLayer === "boolean" ? parsedLayer : true, inputDefinitions, diagnostics: [
    ...(pendingLayer ? [warning("DECLARATION_LAYER_PENDING", "The declaration layer cannot be resolved during Check; the prepared default is a placeholder and execution will validate the actual constant boolean.")] : []),
    warning("CLOSED_BAR_SNAPSHOT", "Supplied bars are treated as closed historical snapshots, including the final bar. Live mode reloads snapshots; intrabar updates, realtime rollback and varip tick persistence are unavailable."),
    ...(declaration === "strategy" ? [warning("UNSUPPORTED_EXECUTION_SETTINGS", "Strategy tick, fill and historical-tick recalculation are unavailable. Enabled calc_on_every_tick, calc_on_order_fills or calc_on_every_history_tick settings fail execution.")] : []),
  ] };
  if (request.action === "prepare") return validatePineResponse({ id: request.id, status: "completed", result: descriptor }, request);
  const encounteredAlerts = new Set<string>();
  bindClosedSnapshot(prepared, declaration === "strategy", encounteredAlerts);
  const local = chartProvider(request);
  const engine = new PineTS(local.provider, request.context!.symbol, request.context!.timeframe, request.bars!.length);
  engine.setMaxLoops(PINE_LIMITS.loops);
  engine.setTimezone("UTC");
  let context;
  try { context = await engine.run(indicator); } catch (cause) {
    if (local.unavailable()) throw local.unavailable();
    if (cause instanceof PineProtocolError) throw cause;
    error("RUNTIME_ERROR", cause instanceof Error ? cause.message.slice(0, 4_096) : "Native Pine execution failed.");
  }
  if (local.unavailable()) throw local.unavailable();
  const diagnostics = [...descriptor.diagnostics.filter((item) => item.code !== "DECLARATION_LAYER_PENDING"), warning("SNAPSHOT_CONTEXT", "Execution uses the supplied OHLCV snapshot with UTC, a 24x7 session and USD currency; exchange sessions, tick history and additional market data are unavailable.")];
  if (encounteredAlerts.size) diagnostics.push(warning("ALERT_DELIVERY_UNAVAILABLE", `Encountered Pine ${[...encounteredAlerts].sort().join(" and ")} calls. Alert delivery and notifications are unavailable; no alert was sent.`));
  if (request.context!.mintick === undefined || request.context!.pointvalue === undefined) diagnostics.push(warning("DEFAULT_SYMBOL_METADATA", "Missing chart mintick or pointvalue uses 0.01 and 1 respectively; supply instrument metadata for tick-based orders and contract P&L."));
  for (const item of context.warnings ?? []) {
    if (diagnostics.length >= PINE_LIMITS.diagnostics) break;
    diagnostics.push(warning("ENGINE_WARNING", item.message));
  }
  const properties = context.strategy?.config ?? context.indicator;
  const overlay = properties?.overlay === true;
  const output = plotResults(context.plots, overlay, diagnostics, request.bars!);
  const result = { ...descriptor, kind: "run", name: properties?.title ?? descriptor.name, overlay, behindChart: properties?.behind_chart === undefined ? true : properties.behind_chart, diagnostics: diagnostics.slice(0, PINE_LIMITS.diagnostics), inputs, plots: output.plots, ...(context.strategy ? { strategy: strategyResult(context.strategy) } : {}), audit: { engine: "PineTS", engineVersion: "0.11.0", bars: request.bars!.length, sourceBytes: new TextEncoder().encode(request.source).length, mode: request.mode ?? "historical", elapsedMs: performance.now() - started } };
  return validatePineResponse({ id: request.id, status: "completed", result, ...("buffers" in output ? { encoding: "pine-packed-v1", buffers: output.buffers } : {}) }, request);
}

if (typeof self !== "undefined" && typeof document === "undefined") {
  const scope = self as unknown as DedicatedWorkerGlobalScope;
  scope.onmessage = async (event: MessageEvent<unknown>) => {
    const raw = event.data as { id?: unknown } | null;
    const id = typeof raw?.id === "string" ? raw.id.slice(0, 128) : "invalid-request";
    try {
      const result = await executePineRequest(event.data);
      const request = validatePineRequest(event.data);
      const response = toPineWireResponse(id, result, request.bars);
      scope.postMessage(response, "buffers" in response ? response.buffers : []);
    } catch (cause) {
      scope.postMessage({ id, status: "failed", error: { code: cause instanceof PineProtocolError ? cause.code : "RUNTIME_ERROR", message: cause instanceof Error ? cause.message.slice(0, 4_096) : "Native Pine execution failed." } });
    }
  };
}
