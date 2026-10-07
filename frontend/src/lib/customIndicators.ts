import {
  getCachedAppStorageItem,
  loadAppStorageItem,
  saveAppStorageItem,
  subscribeAppStorageItem,
} from "./serverStorage";
import { parseEdgeIndicator, type EdgeIndicatorInputValue } from "./indicatorDsl";
import { normalizeChartTimeframe, type ChartIndicatorInstance } from "./charting";
import { sanitizePineCatalogProvenance, type PineCatalogProvenance } from "./pineCatalog";
import { canonicalPineTimeframe, PINE_LIMITS, PineProtocolError, validatePineRequest, validatePineResponse, type PineContext, type PinePrepareResult } from "./pineProtocol";

export const CUSTOM_INDICATORS_STORAGE_KEY = "custom-indicator-scripts.v1";
export const CUSTOM_INDICATOR_AUDIT_STORAGE_KEY = "custom-indicator-audit.v1";
export const MAX_CUSTOM_INDICATORS = 64;
export const MAX_SCRIPT_VERSIONS = 24;

export type CustomIndicatorCategory =
  | "basic"
  | "volatility"
  | "momentum"
  | "structure"
  | "volume"
  | "order-flow"
  | "custom";

export type CustomIndicatorPreview =
  | "average"
  | "bands"
  | "channel"
  | "histogram"
  | "oscillator"
  | "range"
  | "trend"
  | "volume"
  | "zones";

export type CustomIndicatorVersion = {
  catalogOrigin?: PineCatalogProvenance;
  createdAt: string;
  revision: number;
  source: string;
};

export type CustomIndicatorScript = {
  category: CustomIndicatorCategory;
  color: string;
  createdAt: string;
  description: string;
  id: string;
  inputs: Record<string, EdgeIndicatorInputValue>;
  name: string;
  origin: "first-party" | "user";
  preview: CustomIndicatorPreview;
  revision: number;
  source: string;
  synonyms: string[];
  updatedAt: string;
  versions: CustomIndicatorVersion[];
  quantSemantics?: QuantIndicatorSemantics;
  pinePrepared?: PinePrepareResult;
  catalogOrigin?: PineCatalogProvenance;
};

export type QuantIndicatorSemantics = {
  modelProvenance: string;
  probabilityLabel: string;
  probabilityCalibrated: boolean;
  probabilityPlotName: string | null;
  probabilitySemantics: string;
  scoreLabel: string;
  scorePlotName: string;
  scoreSemantics: string;
};

export type IndicatorAuditRecord = {
  action: "add-to-chart" | "compile" | "delete" | "execute" | "save";
  detail: string;
  id: string;
  scriptId: string;
  status: "completed" | "failed";
  timestamp: string;
};

const source = (
  name: string,
  placement: "overlay" | "pane",
  expression: string,
  color: string,
  period = 14,
) => [
  `indicator "${name}" ${placement}`,
  `input period: number = ${period} min 1 max 500`,
  `input source: source = close`,
  `plot "${name}" = ${expression} color "${color}"`,
].join("\n");

const firstParty = (
  id: string,
  name: string,
  category: CustomIndicatorCategory,
  description: string,
  preview: CustomIndicatorPreview,
  scriptSource: string,
  color: string,
  synonyms: string[],
): CustomIndicatorScript => ({
  category,
  color,
  createdAt: "2026-01-01T00:00:00.000Z",
  description,
  id: `first-party:${id}`,
  inputs: {},
  name,
  origin: "first-party",
  preview,
  revision: 1,
  source: scriptSource,
  synonyms,
  updatedAt: "2026-01-01T00:00:00.000Z",
  versions: [],
});

export const FIRST_PARTY_EDGE_INDICATORS: readonly CustomIndicatorScript[] = [
  firstParty("linear-regression", "Linear Regression", "basic", "Rolling least-squares trend value at the current bar.", "trend", source("Linear Regression", "overlay", "linreg(source, period)", "#38bdf8", 50), "#38bdf8", ["least squares", "regression line", "trend"]),
  firstParty("rolling-high", "Rolling High", "structure", "Highest high across a configurable lookback window.", "channel", source("Rolling High", "overlay", "highest(high, period)", "#22c55e", 20), "#22c55e", ["highest high", "resistance", "breakout"]),
  firstParty("rolling-low", "Rolling Low", "structure", "Lowest low across a configurable lookback window.", "channel", source("Rolling Low", "overlay", "lowest(low, period)", "#fb7185", 20), "#fb7185", ["lowest low", "support", "breakout"]),
  firstParty("price-midpoint", "Price Channel Midpoint", "structure", "Midpoint between the rolling highest high and lowest low.", "average", source("Price Channel Midpoint", "overlay", "(highest(high, period) + lowest(low, period)) / 2", "#a78bfa", 20), "#a78bfa", ["mid price", "donchian mid", "equilibrium"]),
  firstParty("ema-spread", "EMA Spread", "momentum", "Difference between a fast EMA and a slower EMA using a 2× lookback.", "oscillator", source("EMA Spread", "pane", "ema(source, period) - ema(source, period * 2)", "#2dd4bf", 12), "#2dd4bf", ["trend spread", "ema oscillator", "macd"]),
  firstParty("awesome-oscillator", "Awesome Oscillator", "momentum", "Five-period minus 34-period midpoint averages.", "histogram", source("Awesome Oscillator", "pane", "sma(hl2, 5) - sma(hl2, 34)", "#22d3ee", 5), "#22d3ee", ["ao", "momentum histogram", "midpoint"]),
  firstParty("roc", "Rate of Change", "momentum", "Percentage change from the selected lookback close.", "oscillator", source("Rate of Change", "pane", "roc(source, period)", "#c084fc", 12), "#c084fc", ["roc", "percent change", "velocity"]),
  firstParty("stochastic", "Stochastic %K", "momentum", "Close location within the rolling high-low range on a 0–100 scale.", "oscillator", source("Stochastic %K", "pane", "(close - lowest(low, period)) / max(highest(high, period) - lowest(low, period), 0.0000001) * 100", "#f59e0b", 14), "#f59e0b", ["stoch", "percent k", "overbought oversold"]),
  firstParty("williams-r", "Williams %R", "momentum", "Close location below the rolling high on a −100–0 scale.", "oscillator", source("Williams %R", "pane", "(highest(high, period) - close) / max(highest(high, period) - lowest(low, period), 0.0000001) * -100", "#fb7185", 14), "#fb7185", ["williams percent r", "wpr", "overbought oversold"]),
  firstParty("cci", "Commodity Channel Index", "momentum", "Typical-price deviation from its rolling mean and mean deviation.", "oscillator", source("Commodity Channel Index", "pane", "cci(period)", "#60a5fa", 20), "#60a5fa", ["cci", "commodity channel", "mean deviation"]),
  firstParty("adx", "Average Directional Index", "momentum", "Directional-movement trend-strength measure on a 0–100 scale.", "trend", source("Average Directional Index", "pane", "adx(period)", "#34d399", 14), "#34d399", ["adx", "directional movement", "trend strength"]),
  firstParty("standard-deviation", "Standard Deviation", "volatility", "Rolling population standard deviation of the selected source.", "range", source("Standard Deviation", "pane", "stdev(source, period)", "#94a3b8", 20), "#94a3b8", ["stdev", "dispersion", "volatility"]),
  firstParty("historical-volatility", "Historical Volatility", "volatility", "Annualized log-return volatility; set periodsPerYear for the chart timeframe and market calendar.", "range", source("Historical Volatility", "pane", "histvol(source, period, periodsPerYear)", "#818cf8", 20).replace('input source: source = close', 'input source: source = close\ninput periodsPerYear: number = 252 min 1 max 1000000000'), "#818cf8", ["realized volatility", "histvol", "annualized"]),
  firstParty("choppiness", "Choppiness Index", "volatility", "Compares summed true range with the period's high-low span.", "oscillator", source("Choppiness Index", "pane", "choppiness(period)", "#f97316", 14), "#f97316", ["chop", "range bound", "trendiness"]),
  firstParty("atr-percent", "ATR Percent", "volatility", "Average true range normalized by closing price as a percentage.", "range", source("ATR Percent", "pane", "atr(period) / close * 100", "#fb923c", 14), "#fb923c", ["normalized atr", "natr", "percent volatility"]),
  firstParty("obv", "On-Balance Volume", "volume", "Cumulative signed volume based on close-to-close direction.", "volume", source("On-Balance Volume", "pane", "obv()", "#22c55e", 1), "#22c55e", ["obv", "signed volume", "accumulation"]),
  firstParty("mfi", "Money Flow Index", "volume", "Volume-weighted positive and negative typical-price flow on a 0–100 scale.", "oscillator", source("Money Flow Index", "pane", "mfi(period)", "#2dd4bf", 14), "#2dd4bf", ["mfi", "volume rsi", "money flow"]),
  firstParty("cmf", "Chaikin Money Flow", "volume", "Rolling accumulation/distribution pressure normalized by volume.", "oscillator", source("Chaikin Money Flow", "pane", "cmf(period)", "#06b6d4", 20), "#06b6d4", ["cmf", "chaikin", "accumulation distribution"]),
  firstParty("force-index", "Force Index", "volume", "EMA-smoothed price change multiplied by volume.", "histogram", source("Force Index", "pane", "force_index(period)", "#f43f5e", 13), "#f43f5e", ["elder force", "price volume", "impulse"]),
  firstParty("volume-roc", "Volume Rate of Change", "volume", "Percentage change in volume over the selected lookback.", "histogram", source("Volume Rate of Change", "pane", "roc(volume, period)", "#0ea5e9", 14), "#0ea5e9", ["volume roc", "volume momentum", "activity"]),
];

export const DEFAULT_EDGE_INDICATOR_SOURCE = [
  'indicator "My EMA Signal" overlay',
  "input period: number = 20 min 1 max 500",
  "input source: source = close",
  'plot "Signal" = ema(source, period) color "#32d3ee"',
].join("\n");

export const DEFAULT_PINE_INDICATOR_SOURCE = [
  "//@version=6",
  'indicator("My Pine EMA", overlay=true)',
  'length = input.int(20, "EMA length", minval=1, maxval=500)',
  'src = input.source(close, "Source")',
  'plot(ta.ema(src, length), "EMA", color=color.aqua)',
].join("\n");

export const DEFAULT_PINE_STRATEGY_SOURCE = [
  "//@version=6",
  'strategy("EMA crossover", overlay=true, initial_capital=25000)',
  'fastLength = input.int(12, "Fast EMA", minval=1, maxval=500)',
  'slowLength = input.int(26, "Slow EMA", minval=1, maxval=500)',
  'fast = ta.ema(close, fastLength)',
  'slow = ta.ema(close, slowLength)',
  'if ta.crossover(fast, slow)',
  '    strategy.entry("Long", strategy.long)',
  'if ta.crossunder(fast, slow)',
  '    strategy.close("Long")',
  'plot(fast, "Fast EMA", color=color.aqua)',
  'plot(slow, "Slow EMA", color=color.orange)',
].join("\n");

/** Detect unsupported version markers too, so native source never falls back to DSL. */
export function isPineScriptSource(source: string): boolean {
  return /^[ \t\uFEFF]*\/\/[ \t]*@version\b/im.test(source);
}

/** Metadata is plain data, bound to the exact source; this never compiles Pine. */
export function sanitizePinePrepared(value: unknown, source: string): PinePrepareResult | undefined {
  try {
    const request = validatePineRequest({ id: "pine-metadata", action: "prepare", source });
    const prepared = validatePineResponse({ id: request.id, status: "completed", result: value }, request);
    return prepared.kind === "prepare" && !prepared.diagnostics.some((item) => item.severity === "error") ? prepared : undefined;
  } catch { return undefined; }
}

/** Validate declared settings as data; mirrors the isolated engine's input contract. */
function validatePineSavedInputs(prepared: PinePrepareResult, inputs: unknown): Record<string, EdgeIndicatorInputValue> {
  const request = validatePineRequest({ id: "pine-inputs", action: "prepare", source: prepared.source, inputs });
  const values = request.inputs!;
  const invalid = (message: string): never => { throw new PineProtocolError("INVALID_INPUT", message); };
  for (const key of Object.keys(values)) if (!prepared.inputDefinitions.some((input) => input.id === key)) invalid(`Unknown native Pine input ${key}.`);
  for (const input of prepared.inputDefinitions) {
    const value = values[input.id] ?? input.defval;
    if (value === null) invalid(`Input ${input.name} has an unsupported default value.`);
    const numeric = ["int", "float", "price", "time"].includes(input.type);
    if ((numeric && typeof value !== "number") || (input.type === "bool" && typeof value !== "boolean") || (!numeric && input.type !== "bool" && typeof value !== "string")) invalid(`Invalid value for Pine input ${input.name}.`);
    if (typeof value === "number" && ((["int", "time"].includes(input.type) && !Number.isSafeInteger(value)) || (input.minval !== undefined && value < input.minval) || (input.maxval !== undefined && value > input.maxval))) invalid(`Pine input ${input.name} is outside its declared range.`);
    if (input.options && !input.options.includes(value)) invalid(`Pine input ${input.name} must match a declared option.`);
    if (input.type === "source" && !["open", "high", "low", "close", "hl2", "hlc3", "ohlc4", "hlcc4"].includes(String(value))) invalid("Only the loaded chart's OHLC sources are available.");
  }
  return values;
}

export function pineContextForChart(symbol: string, timeframe: string): PineContext {
  const normalized = normalizeChartTimeframe(timeframe);
  const match = normalized?.match(/^(\d+)(m|H|D|W|M)$/);
  if (!match) throw new Error("The chart timeframe cannot be used by native Pine.");
  const amount = Number(match[1]);
  const native = match[2] === "H" ? String(amount * 60) : match[2] === "m" ? String(amount) : `${amount}${match[2]}`;
  const context = { symbol: symbol.trim(), timeframe: canonicalPineTimeframe(native) };
  return validatePineRequest({ id: "pine-context", action: "prepare", source: DEFAULT_PINE_INDICATOR_SOURCE, context }).context!;
}

export function loadCachedCustomIndicators() {
  return sanitizeCustomIndicators(getCachedAppStorageItem<unknown>(CUSTOM_INDICATORS_STORAGE_KEY, []));
}

export async function hydrateCustomIndicators() {
  return sanitizeCustomIndicators(await loadAppStorageItem<unknown>(CUSTOM_INDICATORS_STORAGE_KEY, []));
}

export function subscribeCustomIndicators(listener: (scripts: CustomIndicatorScript[]) => void) {
  return subscribeAppStorageItem<unknown>(CUSTOM_INDICATORS_STORAGE_KEY, (value) => listener(sanitizeCustomIndicators(value)));
}

export function persistCustomIndicators(scripts: CustomIndicatorScript[]) {
  return saveAppStorageItem(CUSTOM_INDICATORS_STORAGE_KEY, sanitizeCustomIndicators(scripts));
}

export function saveCustomIndicator(
  scripts: CustomIndicatorScript[],
  draft: Pick<CustomIndicatorScript, "category" | "color" | "description" | "id" | "inputs" | "name" | "preview" | "source" | "synonyms"> & { quantSemantics?: QuantIndicatorSemantics; catalogOrigin?: PineCatalogProvenance },
  options: { clearIncompatibleQuantSemantics?: boolean; pinePrepared?: PinePrepareResult } = {},
) {
  const native = isPineScriptSource(draft.source);
  const pinePrepared = native ? sanitizePinePrepared(options.pinePrepared, draft.source) : undefined;
  const parsed = native ? { program: null, diagnostics: pinePrepared?.diagnostics ?? [{ code: "PINE_PREPARE_REQUIRED", message: "Prepare native Pine successfully before saving this exact source.", severity: "error" as const, line: 1, column: 1 }] } : parseEdgeIndicator(draft.source);
  if (native ? !pinePrepared : !parsed.program) return { diagnostics: parsed.diagnostics, scripts };
  let savedInputs = draft.inputs;
  if (pinePrepared) {
    try { savedInputs = validatePineSavedInputs(pinePrepared, draft.inputs); }
    catch (cause) { return { scripts, diagnostics: [{ code: "INVALID_INPUT", message: cause instanceof Error ? cause.message : "Invalid native Pine inputs.", severity: "error" as const, line: 1, column: 1 }] }; }
  }
  const now = new Date().toISOString();
  const existing = scripts.find((script) => script.id === draft.id && script.origin === "user");
  const requestedQuantSemantics = draft.quantSemantics ?? existing?.quantSemantics;
  const quantSemanticsWarning = native && requestedQuantSemantics
    ? "Converting a Quant script to native Pine removes its Quant provenance and score/probability labels. Confirm clearing those labels before saving."
    : quantIndicatorSemanticsWarning(parsed.program?.plots.map((plot) => plot.name) ?? [], requestedQuantSemantics);
  if (quantSemanticsWarning && !options.clearIncompatibleQuantSemantics) {
    return { diagnostics: parsed.diagnostics, quantSemanticsWarning, scripts };
  }
  const revision = (existing?.revision ?? 0) + 1;
  const next: CustomIndicatorScript = {
    ...draft,
    inputs: savedInputs,
    catalogOrigin: sanitizePineCatalogProvenance(Object.prototype.hasOwnProperty.call(draft, "catalogOrigin") ? draft.catalogOrigin : existing?.catalogOrigin),
    category: draft.category ?? "custom",
    color: validColor(draft.color),
    createdAt: existing?.createdAt ?? now,
    description: draft.description.trim().slice(0, 240),
    id: existing?.id ?? createScriptId(),
    name: pinePrepared ? existing?.source === draft.source ? existing.name : pinePrepared.name : parsed.program!.name,
    origin: "user",
    preview: draft.preview ?? ((pinePrepared?.overlay ?? parsed.program!.overlay) ? "trend" : "oscillator"),
    revision,
    synonyms: draft.synonyms.map((item) => item.trim().slice(0, 32)).filter(Boolean).slice(0, 12),
    updatedAt: now,
    versions: [
      ...(existing?.versions ?? []),
      ...(existing ? [{ createdAt: existing.updatedAt, revision: existing.revision, source: existing.source, catalogOrigin: existing.catalogOrigin }] : []),
    ].slice(-MAX_SCRIPT_VERSIONS),
    quantSemantics: quantSemanticsWarning ? undefined : sanitizeQuantSemantics(requestedQuantSemantics),
    pinePrepared,
  };
  return {
    diagnostics: parsed.diagnostics,
    script: next,
    scripts: [next, ...scripts.filter((script) => script.id !== next.id && script.origin === "user")].slice(0, MAX_CUSTOM_INDICATORS),
  };
}

export function quantIndicatorSemanticsWarning(
  plotNames: readonly string[],
  semantics: QuantIndicatorSemantics | undefined,
) {
  if (!semantics) return null;
  if (!plotNames.includes(semantics.scorePlotName)) {
    return `Quant score mapping “${semantics.scorePlotName}” no longer matches a plot. Saving would remove Quant provenance and score/probability labels.`;
  }
  if (semantics.probabilityPlotName && !plotNames.includes(semantics.probabilityPlotName)) {
    return `Calibrated probability mapping “${semantics.probabilityPlotName}” no longer matches a plot. Saving would remove Quant provenance and score/probability labels.`;
  }
  return null;
}

export function duplicateCustomIndicator(script: CustomIndicatorScript): CustomIndicatorScript {
  const now = new Date().toISOString();
  const name = `${script.name} copy`.slice(0, 80);
  return {
    ...script,
    createdAt: now,
    id: createScriptId(),
    name,
    origin: "user",
    revision: 1,
    source: isPineScriptSource(script.source) ? script.source : script.source.replace(/^indicator\s+"[^"]+"/m, `indicator "${name}"`),
    pinePrepared: isPineScriptSource(script.source) ? sanitizePinePrepared(script.pinePrepared, script.source) : undefined,
    updatedAt: now,
    versions: [],
  };
}

export function createCustomIndicatorInstance(
  script: CustomIndicatorScript,
  inputs: Record<string, EdgeIndicatorInputValue> = script.inputs,
): ChartIndicatorInstance {
  const native = isPineScriptSource(script.source);
  const prepared = native ? sanitizePinePrepared(script.pinePrepared, script.source) : undefined;
  const parsed = native ? { program: null } : parseEdgeIndicator(script.source);
  return {
    createdAt: new Date().toISOString(),
    customOverlay: prepared?.overlay ?? parsed.program?.overlay ?? true,
    customPinePrepared: prepared,
    customCatalogOrigin: sanitizePineCatalogProvenance(script.catalogOrigin),
    customScriptId: script.id,
    customScriptName: script.name,
    customScriptSource: script.source,
    customScriptVersion: script.revision,
    customQuantSemantics: script.quantSemantics,
    id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind: "custom",
    runtimeError: prepared || parsed.program ? null : native ? "Prepare this native Pine source again before adding it to the chart." : "The saved script no longer compiles.",
    settings: {
      color: script.color,
      customInputs: { ...inputs },
      period: typeof inputs.period === "number" ? inputs.period : 20,
    },
    visible: true,
  };
}

export function sanitizeCustomIndicators(value: unknown): CustomIndicatorScript[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): CustomIndicatorScript[] => {
    if (typeof item !== "object" || item == null) return [];
    const candidate = item as Partial<CustomIndicatorScript>;
    if (typeof candidate.id !== "string" || typeof candidate.name !== "string" || typeof candidate.source !== "string") return [];
    const native = isPineScriptSource(candidate.source);
    if (native && new TextEncoder().encode(candidate.source).length > PINE_LIMITS.sourceBytes) return [];
    const prepared = native ? sanitizePinePrepared(candidate.pinePrepared, candidate.source) : undefined;
    const parsed = native ? { program: null } : parseEdgeIndicator(candidate.source);
    if (native ? !prepared : !parsed.program) return [];
    let inputs = sanitizeInputs(candidate.inputs);
    if (prepared) {
      try { inputs = validatePineSavedInputs(prepared, candidate.inputs ?? {}); }
      catch { return []; }
    }
    const createdAt = validDate(candidate.createdAt);
    return [{
      category: validCategory(candidate.category),
      color: validColor(candidate.color),
      createdAt,
      description: typeof candidate.description === "string" ? candidate.description.slice(0, 240) : "Saved EdgeLab indicator.",
      id: candidate.id.trim().slice(0, 96),
      inputs,
      name: prepared ? candidate.name.trim().slice(0, 80) || prepared.name : parsed.program!.name,
      origin: "user",
      preview: validPreview(candidate.preview),
      revision: positiveInteger(candidate.revision, 1),
      source: native ? candidate.source : candidate.source.slice(0, 20_000),
      synonyms: Array.isArray(candidate.synonyms) ? candidate.synonyms.filter((term): term is string => typeof term === "string").map((term) => term.slice(0, 32)).slice(0, 12) : [],
      updatedAt: validDate(candidate.updatedAt),
      versions: sanitizeVersions(candidate.versions),
      quantSemantics: native ? undefined : sanitizeQuantSemantics(candidate.quantSemantics),
      pinePrepared: prepared,
      catalogOrigin: sanitizePineCatalogProvenance(candidate.catalogOrigin),
    }];
  }).slice(0, MAX_CUSTOM_INDICATORS);
}

export function sanitizeQuantSemantics(value: unknown): QuantIndicatorSemantics | undefined {
  if (typeof value !== "object" || value == null) return undefined;
  const candidate = value as Partial<QuantIndicatorSemantics>;
  if (typeof candidate.scorePlotName !== "string" || typeof candidate.scoreLabel !== "string" || typeof candidate.scoreSemantics !== "string") return undefined;
  const probabilityCalibrated = candidate.probabilityCalibrated === true;
  return {
    modelProvenance: String(candidate.modelProvenance ?? "Unknown provider").slice(0, 160),
    probabilityLabel: String(candidate.probabilityLabel ?? "Probability unavailable").slice(0, 80),
    probabilityCalibrated,
    probabilityPlotName: probabilityCalibrated && typeof candidate.probabilityPlotName === "string" ? candidate.probabilityPlotName.slice(0, 80) : null,
    probabilitySemantics: String(candidate.probabilitySemantics ?? "No calibrated outcome probability is available.").slice(0, 300),
    scoreLabel: candidate.scoreLabel.slice(0, 80),
    scorePlotName: candidate.scorePlotName.slice(0, 80),
    scoreSemantics: candidate.scoreSemantics.slice(0, 300),
  };
}

export function appendIndicatorAudit(record: Omit<IndicatorAuditRecord, "id" | "timestamp">) {
  const current = getCachedAppStorageItem<IndicatorAuditRecord[]>(CUSTOM_INDICATOR_AUDIT_STORAGE_KEY, []);
  const next = [{ ...record, id: `indicator-audit-${Date.now().toString(36)}`, timestamp: new Date().toISOString() }, ...current].slice(0, 200);
  void saveAppStorageItem(CUSTOM_INDICATOR_AUDIT_STORAGE_KEY, next);
  return next;
}

function sanitizeInputs(value: unknown): Record<string, EdgeIndicatorInputValue> {
  if (typeof value !== "object" || value == null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && (typeof item === "number" || typeof item === "boolean" || typeof item === "string") && (typeof item !== "number" || Number.isFinite(item)) ? [[key, item]] : []));
}

function sanitizeVersions(value: unknown): CustomIndicatorVersion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): CustomIndicatorVersion[] => {
    if (typeof item !== "object" || item == null || typeof (item as CustomIndicatorVersion).source !== "string") return [];
    const version = item as CustomIndicatorVersion;
    const native = isPineScriptSource(version.source);
    if (native && new TextEncoder().encode(version.source).length > PINE_LIMITS.sourceBytes) return [];
    return [{ catalogOrigin: sanitizePineCatalogProvenance(version.catalogOrigin), createdAt: validDate(version.createdAt), revision: positiveInteger(version.revision, 1), source: native ? version.source : version.source.slice(0, 20_000) }];
  }).slice(-MAX_SCRIPT_VERSIONS);
}

function validCategory(value: unknown): CustomIndicatorCategory {
  return ["basic", "volatility", "momentum", "structure", "volume", "order-flow", "custom"].includes(value as string) ? value as CustomIndicatorCategory : "custom";
}

function validPreview(value: unknown): CustomIndicatorPreview {
  return ["average", "bands", "channel", "histogram", "oscillator", "range", "trend", "volume", "zones"].includes(value as string) ? value as CustomIndicatorPreview : "oscillator";
}

function validColor(value: unknown) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : "#32d3ee";
}

function validDate(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : new Date().toISOString();
}

function positiveInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;
}

function createScriptId() {
  return `edge-script-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
