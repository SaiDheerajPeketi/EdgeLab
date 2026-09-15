import {
  getCachedAppStorageItem,
  loadAppStorageItem,
  saveAppStorageItem,
  subscribeAppStorageItem,
} from "./serverStorage";
import { parseEdgeIndicator, type EdgeIndicatorInputValue } from "./indicatorDsl";
import type { ChartIndicatorInstance } from "./charting";

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
  firstParty("historical-volatility", "Historical Volatility", "volatility", "Annualized standard deviation of log returns, expressed as percent.", "range", source("Historical Volatility", "pane", "histvol(source, period)", "#818cf8", 20), "#818cf8", ["realized volatility", "histvol", "annualized"]),
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
  draft: Pick<CustomIndicatorScript, "category" | "color" | "description" | "id" | "inputs" | "name" | "preview" | "source" | "synonyms">,
) {
  const parsed = parseEdgeIndicator(draft.source);
  if (!parsed.program) return { diagnostics: parsed.diagnostics, scripts };
  const now = new Date().toISOString();
  const existing = scripts.find((script) => script.id === draft.id && script.origin === "user");
  const revision = (existing?.revision ?? 0) + 1;
  const next: CustomIndicatorScript = {
    ...draft,
    category: draft.category ?? "custom",
    color: validColor(draft.color),
    createdAt: existing?.createdAt ?? now,
    description: draft.description.trim().slice(0, 240),
    id: existing?.id ?? createScriptId(),
    name: parsed.program.name,
    origin: "user",
    preview: draft.preview ?? (parsed.program.overlay ? "trend" : "oscillator"),
    revision,
    synonyms: draft.synonyms.map((item) => item.trim().slice(0, 32)).filter(Boolean).slice(0, 12),
    updatedAt: now,
    versions: [
      ...(existing?.versions ?? []),
      ...(existing ? [{ createdAt: existing.updatedAt, revision: existing.revision, source: existing.source }] : []),
    ].slice(-MAX_SCRIPT_VERSIONS),
  };
  return {
    diagnostics: parsed.diagnostics,
    script: next,
    scripts: [next, ...scripts.filter((script) => script.id !== next.id && script.origin === "user")].slice(0, MAX_CUSTOM_INDICATORS),
  };
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
    source: script.source.replace(/^indicator\s+"[^"]+"/m, `indicator "${name}"`),
    updatedAt: now,
    versions: [],
  };
}

export function createCustomIndicatorInstance(
  script: CustomIndicatorScript,
  inputs: Record<string, EdgeIndicatorInputValue> = script.inputs,
): ChartIndicatorInstance {
  const parsed = parseEdgeIndicator(script.source);
  return {
    createdAt: new Date().toISOString(),
    customOverlay: parsed.program?.overlay ?? true,
    customScriptId: script.id,
    customScriptName: script.name,
    customScriptSource: script.source,
    customScriptVersion: script.revision,
    id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind: "custom",
    runtimeError: parsed.program ? null : "The saved script no longer compiles.",
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
    const parsed = parseEdgeIndicator(candidate.source);
    if (!parsed.program) return [];
    const createdAt = validDate(candidate.createdAt);
    return [{
      category: validCategory(candidate.category),
      color: validColor(candidate.color),
      createdAt,
      description: typeof candidate.description === "string" ? candidate.description.slice(0, 240) : "Saved EdgeLab indicator.",
      id: candidate.id.trim().slice(0, 96),
      inputs: sanitizeInputs(candidate.inputs),
      name: parsed.program.name,
      origin: "user",
      preview: validPreview(candidate.preview),
      revision: positiveInteger(candidate.revision, 1),
      source: candidate.source.slice(0, 20_000),
      synonyms: Array.isArray(candidate.synonyms) ? candidate.synonyms.filter((term): term is string => typeof term === "string").map((term) => term.slice(0, 32)).slice(0, 12) : [],
      updatedAt: validDate(candidate.updatedAt),
      versions: sanitizeVersions(candidate.versions),
    }];
  }).slice(0, MAX_CUSTOM_INDICATORS);
}

export function appendIndicatorAudit(record: Omit<IndicatorAuditRecord, "id" | "timestamp">) {
  const current = getCachedAppStorageItem<IndicatorAuditRecord[]>(CUSTOM_INDICATOR_AUDIT_STORAGE_KEY, []);
  const next = [{ ...record, id: `indicator-audit-${Date.now().toString(36)}`, timestamp: new Date().toISOString() }, ...current].slice(0, 200);
  void saveAppStorageItem(CUSTOM_INDICATOR_AUDIT_STORAGE_KEY, next);
  return next;
}

function sanitizeInputs(value: unknown): Record<string, EdgeIndicatorInputValue> {
  if (typeof value !== "object" || value == null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && (typeof item === "number" || typeof item === "boolean" || typeof item === "string") ? [[key, item]] : []));
}

function sanitizeVersions(value: unknown): CustomIndicatorVersion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): CustomIndicatorVersion[] => typeof item === "object" && item != null && typeof (item as CustomIndicatorVersion).source === "string" ? [{ createdAt: validDate((item as CustomIndicatorVersion).createdAt), revision: positiveInteger((item as CustomIndicatorVersion).revision, 1), source: (item as CustomIndicatorVersion).source.slice(0, 20_000) }] : []).slice(-MAX_SCRIPT_VERSIONS);
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
