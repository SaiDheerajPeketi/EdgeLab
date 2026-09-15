import type { Candle } from "./api";
import { apiRequest } from "./api";
import type { ChartDrawing, ChartIndicatorInstance } from "./charting";
import type { ChartVisualSettings } from "./chartSettings";
import { adaptBackendIndicatorJson } from "./indicatorDsl";
import {
  getCachedAppStorageItem,
  loadAppStorageItem,
  saveAppStorageItem,
  subscribeAppStorageItem,
} from "./serverStorage";

export const QUANT_WORKSPACE_STORAGE_KEY = "quant-workspace.v1";
export const QUANT_AUDIT_STORAGE_KEY = "quant-audit.v1";
export const QUANT_PREFERENCES_STORAGE_KEY = "quant-preferences.v1";

export type QuantConversationKind = "analysis" | "build";
export type QuantJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type QuantUsage = {
  cost?: number | null;
  credits?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
};

export type QuantModel = {
  offline: boolean;
  operations: string[];
  provider: string;
  description: string;
  id: string;
  label: string;
  policy: {
    costLabel: string;
    dataRetention: string;
    maxContextTokens: number | null;
  };
};

export type QuantAnalysis = {
  bias: "bullish" | "bearish" | "neutral";
  invalidation: string;
  levels: Array<{ label: string; price: number; rationale: string }>;
  riskWarning: string;
  summary: string;
  uncertainty: string;
};

export type QuantGeneratedIndicator = {
  name: string;
  source: string;
};

export type QuantMessage = {
  analysis?: QuantAnalysis;
  content: string;
  createdAt: string;
  generatedIndicator?: QuantGeneratedIndicator;
  id: string;
  role: "assistant" | "user";
  usage?: QuantUsage;
};

export type QuantConversation = {
  createdAt: string;
  id: string;
  kind: QuantConversationKind;
  messages: QuantMessage[];
  title: string;
  updatedAt: string;
};

export type QuantWorkspace = {
  activeConversationByKind: Partial<Record<QuantConversationKind, string>>;
  conversations: QuantConversation[];
  revision: number;
};

export type QuantPreferences = {
  allowGeneratedCode: boolean;
  allowScreenshots: boolean;
  allowStructuredContext: boolean;
  dock: "bottom" | "right";
  retention: "30-days" | "off" | "session";
};

export type QuantSelectedRegion = {
  heightRatio: number;
  widthRatio: number;
  xRatio: number;
  yRatio: number;
};

export type QuantChartContext = {
  activeIndicators: ChartIndicatorInstance[];
  chartSettings: ChartVisualSettings;
  drawings: ChartDrawing[];
  history: {
    barCount: number;
    firstTimestamp: string | null;
    lastTimestamp: string | null;
    sampled: boolean;
  };
  provider: string;
  selectedObjectId: string | null;
  selectedRegion: QuantSelectedRegion | null;
  sessionMode: "extended" | "regular";
  symbol: string;
  timeframe: string;
  timezone: string;
  visibleBars: Candle[];
};

export type QuantCaptureAttachment = {
  dataUrl: string;
  height: number;
  id: string;
  kind: "chart" | "region";
  region: QuantSelectedRegion | null;
  width: number;
};

export type QuantAuditRecord = {
  action: "cancel" | "capture" | "generate" | "microphone" | "transcribe";
  contextFields: string[];
  id: string;
  modelId: string | null;
  status: "allowed" | "blocked" | "completed" | "failed";
  timestamp: string;
};

export type QuantBacktestConfig = {
  commissionBps: number;
  initialCapital: number;
  rule: "plot-crosses-zero" | "price-crosses-plot";
  slippageBps: number;
  windowDays: number;
};

export type QuantBacktestResult = {
  assumptions: string[];
  endingCapital: number;
  losses: number;
  maxDrawdownPercent: number;
  netReturnPercent: number;
  sample: { bars: number; from: string | null; hash: string; to: string | null };
  sourceVersion: number;
  trades: number;
  warnings: string[];
  winRatePercent: number;
  wins: number;
};

export const DEFAULT_QUANT_PREFERENCES: QuantPreferences = {
  allowGeneratedCode: true,
  allowScreenshots: false,
  allowStructuredContext: true,
  dock: "right",
  retention: "30-days",
};

export const DEFAULT_QUANT_BACKTEST_CONFIG: QuantBacktestConfig = {
  commissionBps: 1,
  initialCapital: 10_000,
  rule: "price-crosses-plot",
  slippageBps: 1,
  windowDays: 60,
};

export type QuantProviderStatus = {
  available: boolean;
  detail: string;
  models: QuantModel[];
};

export type QuantJobUpdate = {
  analysis?: QuantAnalysis;
  content: string;
  generatedIndicator?: QuantGeneratedIndicator;
  id: string;
  status: QuantJobStatus;
  usage?: QuantUsage;
};

export function loadCachedQuantWorkspace() {
  return sanitizeQuantWorkspace(getCachedAppStorageItem<unknown>(QUANT_WORKSPACE_STORAGE_KEY, null));
}

export async function hydrateQuantWorkspace() {
  return sanitizeQuantWorkspace(await loadAppStorageItem<unknown>(QUANT_WORKSPACE_STORAGE_KEY, null));
}

export function persistQuantWorkspace(workspace: QuantWorkspace) {
  return saveAppStorageItem(QUANT_WORKSPACE_STORAGE_KEY, sanitizeQuantWorkspace(workspace));
}

export function subscribeQuantWorkspace(listener: (workspace: QuantWorkspace) => void) {
  return subscribeAppStorageItem<unknown>(QUANT_WORKSPACE_STORAGE_KEY, (value) => listener(sanitizeQuantWorkspace(value)));
}

export function loadCachedQuantPreferences() {
  return sanitizeQuantPreferences(getCachedAppStorageItem<unknown>(QUANT_PREFERENCES_STORAGE_KEY, DEFAULT_QUANT_PREFERENCES));
}

export async function hydrateQuantPreferences() {
  return sanitizeQuantPreferences(await loadAppStorageItem<unknown>(QUANT_PREFERENCES_STORAGE_KEY, DEFAULT_QUANT_PREFERENCES));
}

export function persistQuantPreferences(preferences: QuantPreferences) {
  return saveAppStorageItem(QUANT_PREFERENCES_STORAGE_KEY, sanitizeQuantPreferences(preferences));
}

export async function fetchQuantProviderStatus(): Promise<QuantProviderStatus> {
  try {
    const response = await apiRequest<unknown>("/quant/models");
    const models = sanitizeModels(response);
    const available = models.length > 0;
    const offlineOnly = available && models.every((model) => model.offline);
    return {
      available,
      detail: offlineOnly
        ? "Only the clearly labeled deterministic offline scaffold is available; no external AI provider is configured."
        : available
          ? "A configured AI provider is ready."
          : "No supported AI model provider is configured.",
      models,
    };
  } catch {
    return { available: false, detail: "No AI model provider is configured for this EdgeLab server.", models: [] };
  }
}

export function createQuantConversation(kind: QuantConversationKind): QuantConversation {
  const now = new Date().toISOString();
  return {
    createdAt: now,
    id: `quant-${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    messages: [],
    title: kind === "analysis" ? "Chart analysis" : "Indicator build",
    updatedAt: now,
  };
}

export function upsertQuantConversation(workspace: QuantWorkspace, conversation: QuantConversation) {
  const next = {
    activeConversationByKind: { ...workspace.activeConversationByKind, [conversation.kind]: conversation.id },
    conversations: [conversation, ...workspace.conversations.filter((item) => item.id !== conversation.id)].slice(0, 40),
    revision: workspace.revision + 1,
  };
  return pruneQuantWorkspace(next);
}

export function createQuantGenerationJob(
  payload: {
    attachment?: QuantCaptureAttachment | null;
    context?: QuantChartContext | null;
    conversation: QuantConversation;
    kind: QuantConversationKind;
    modelId: string;
    prompt: string;
  },
  onUpdate: (update: QuantJobUpdate) => void,
) {
  let cancelled = false;
  let remoteId: string | null = null;
  const localId = `quant-job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const promise = (async () => {
    if (payload.attachment) {
      throw new Error("This server has no opaque screenshot-upload endpoint yet. Remove the attachment before sending; inline image data is never transmitted.");
    }
    if (payload.kind === "analysis" && !payload.context) {
      throw new Error("The server requires structured chart context for analysis. Enable that permission before sending.");
    }
    const conversation = await apiRequest<unknown>("/quant/conversations", {
      body: JSON.stringify({
        kind: payload.kind === "analysis" ? "CHART_ANALYSIS" : "INDICATOR_BUILD",
        retention_days: 30,
        title: payload.conversation.title,
      }),
      method: "POST",
    });
    const conversationId = numericField(conversation, "id");
    const created = await apiRequest<unknown>("/quant/jobs", {
      body: JSON.stringify({
        chart_context: payload.context ? toBackendChartContext(payload.context) : null,
        conversation_id: conversationId,
        hard_cost_ceiling_micros: 1_000_000,
        idempotency_key: localId,
        max_output_tokens: 2_048,
        model_id: payload.modelId,
        operation: payload.kind === "analysis" ? "CHART_ANALYSIS" : "GENERATE_INDICATOR",
        prompt: payload.prompt,
      }),
      method: "POST",
    });
    const jobId = numericField(created, "id");
    remoteId = String(jobId);
    onUpdate({ content: "Request accepted by the server.", id: remoteId, status: "queued" });
    if (cancelled) return { content: "", id: remoteId, status: "cancelled" as const };
    onUpdate({ content: "The configured provider is processing the request…", id: remoteId, status: "running" });
    const completed = await apiRequest<unknown>(`/quant/jobs/${jobId}/run`, { method: "POST" });
    if (cancelled) return { content: "", id: remoteId, status: "cancelled" as const };
    const status = backendJobStatus(completed);
    if (status !== "completed") return backendFailureUpdate(completed, remoteId, status);
    const artifacts = await apiRequest<unknown>(`/quant/artifacts?conversation_id=${conversationId}`);
    const artifact = Array.isArray(artifacts)
      ? artifacts.find((item) => isRecord(item) && Number(item.job_id) === jobId)
      : null;
    const result = backendArtifactUpdate(completed, artifact, remoteId);
    onUpdate(result);
    return result;
  })();
  return {
    id: localId,
    promise,
    cancel: async () => {
      cancelled = true;
      if (remoteId) {
        await apiRequest(`/quant/jobs/${encodeURIComponent(remoteId)}/cancel`, { method: "POST" }).catch(() => undefined);
      }
      onUpdate({ content: "", id: remoteId ?? localId, status: "cancelled" });
    },
  };
}

export async function transcribeQuantAudio(data: string, mimeType: string) {
  const response = await apiRequest<unknown>("/quant/transcriptions", {
    body: JSON.stringify({ audioBase64: data, mimeType }),
    method: "POST",
  });
  if (typeof response !== "object" || response == null || typeof (response as { text?: unknown }).text !== "string") throw new Error("The transcription service returned no editable text.");
  return (response as { text: string }).text.slice(0, 8_000);
}

export function appendQuantAudit(record: Omit<QuantAuditRecord, "id" | "timestamp">) {
  const current = getCachedAppStorageItem<QuantAuditRecord[]>(QUANT_AUDIT_STORAGE_KEY, []);
  const next = [{ ...record, id: `quant-audit-${Date.now().toString(36)}`, timestamp: new Date().toISOString() }, ...current].slice(0, 300);
  void saveAppStorageItem(QUANT_AUDIT_STORAGE_KEY, next);
  return next;
}

export function runReproducibleIndicatorBacktest(
  bars: Candle[],
  plot: Array<{ time: number; value: number }>,
  config: QuantBacktestConfig,
  sourceVersion: number,
): QuantBacktestResult {
  const normalized = sanitizeBacktestConfig(config);
  const latest = bars.at(-1)?.time ?? 0;
  const from = latest - normalized.windowDays * 86_400;
  const sample = bars.filter((bar) => bar.time >= from).sort((left, right) => left.time - right.time);
  const plotByTime = new Map(plot.map((point) => [point.time, point.value]));
  let capital = normalized.initialCapital;
  let peak = capital;
  let maxDrawdown = 0;
  let entry: number | null = null;
  let wins = 0;
  let losses = 0;
  for (let index = 1; index < sample.length; index += 1) {
    const previous = sample[index - 1];
    const current = sample[index];
    const previousPlot = plotByTime.get(previous.time);
    const currentPlot = plotByTime.get(current.time);
    if (previousPlot == null || currentPlot == null) continue;
    const enter = normalized.rule === "price-crosses-plot"
      ? previous.close <= previousPlot && current.close > currentPlot
      : previousPlot <= 0 && currentPlot > 0;
    const exit = normalized.rule === "price-crosses-plot"
      ? previous.close >= previousPlot && current.close < currentPlot
      : previousPlot >= 0 && currentPlot < 0;
    if (entry == null && enter) {
      entry = current.close * (1 + normalized.slippageBps / 10_000);
    } else if (entry != null && exit) {
      const exitPrice = current.close * (1 - normalized.slippageBps / 10_000);
      const gross = exitPrice / entry - 1;
      const net = gross - normalized.commissionBps * 2 / 10_000;
      capital *= 1 + net;
      if (net >= 0) wins += 1; else losses += 1;
      peak = Math.max(peak, capital);
      maxDrawdown = Math.max(maxDrawdown, peak === 0 ? 0 : (peak - capital) / peak);
      entry = null;
    }
  }
  const trades = wins + losses;
  return {
    assumptions: [
      `Long-only; ${normalized.rule === "price-crosses-plot" ? "enter when close crosses above plot and exit below" : "enter when plot crosses above zero and exit below"}.`,
      `Signals execute on the signal bar close with ${normalized.slippageBps} bps slippage each side.`,
      `${normalized.commissionBps} bps commission charged on entry and exit; no leverage or position scaling.`,
      `Window: ${normalized.windowDays} calendar days; source version ${sourceVersion}.`,
    ],
    endingCapital: capital,
    losses,
    maxDrawdownPercent: maxDrawdown * 100,
    netReturnPercent: (capital / normalized.initialCapital - 1) * 100,
    sample: {
      bars: sample.length,
      from: sample[0]?.timestamp ?? null,
      hash: hashBacktestSample(sample, plot, normalized, sourceVersion),
      to: sample.at(-1)?.timestamp ?? null,
    },
    sourceVersion,
    trades,
    warnings: [
      ...(sample.length < 100 ? ["Fewer than 100 bars fall inside the requested sample."] : []),
      ...(trades < 5 ? ["Fewer than five completed trades; metrics are not statistically reliable."] : []),
      "This deterministic study check is research output, not investment advice.",
    ],
    winRatePercent: trades === 0 ? 0 : wins / trades * 100,
    wins,
  };
}

export function sanitizeQuantAnalysis(value: unknown): QuantAnalysis | undefined {
  if (typeof value !== "object" || value == null) return undefined;
  const candidate = value as Partial<QuantAnalysis>;
  if (!["bullish", "bearish", "neutral"].includes(candidate.bias ?? "") || typeof candidate.summary !== "string" || typeof candidate.invalidation !== "string" || typeof candidate.uncertainty !== "string" || typeof candidate.riskWarning !== "string") return undefined;
  const levels = Array.isArray(candidate.levels) ? candidate.levels.flatMap((item) => typeof item === "object" && item != null && typeof (item as { price?: unknown }).price === "number" && Number.isFinite((item as { price: number }).price) ? [{ label: String((item as { label?: unknown }).label ?? "Level").slice(0, 64), price: (item as { price: number }).price, rationale: String((item as { rationale?: unknown }).rationale ?? "").slice(0, 240) }] : []).slice(0, 12) : [];
  return { bias: candidate.bias as QuantAnalysis["bias"], invalidation: candidate.invalidation.slice(0, 500), levels, riskWarning: candidate.riskWarning.slice(0, 500), summary: candidate.summary.slice(0, 2_000), uncertainty: candidate.uncertainty.slice(0, 500) };
}

function sanitizeQuantWorkspace(value: unknown): QuantWorkspace {
  const fallback: QuantWorkspace = { activeConversationByKind: {}, conversations: [], revision: 0 };
  if (typeof value !== "object" || value == null) return fallback;
  const candidate = value as Partial<QuantWorkspace>;
  const conversations = Array.isArray(candidate.conversations) ? candidate.conversations.flatMap(sanitizeConversation).slice(0, 40) : [];
  return pruneQuantWorkspace({ activeConversationByKind: typeof candidate.activeConversationByKind === "object" && candidate.activeConversationByKind != null ? candidate.activeConversationByKind : {}, conversations, revision: positive(candidate.revision) });
}

function sanitizeConversation(value: unknown): QuantConversation[] {
  if (typeof value !== "object" || value == null) return [];
  const candidate = value as Partial<QuantConversation>;
  if (typeof candidate.id !== "string" || (candidate.kind !== "analysis" && candidate.kind !== "build")) return [];
  const messages = Array.isArray(candidate.messages) ? candidate.messages.flatMap(sanitizeMessage).slice(-200) : [];
  return [{ createdAt: validDate(candidate.createdAt), id: candidate.id.slice(0, 96), kind: candidate.kind, messages, title: typeof candidate.title === "string" ? candidate.title.slice(0, 80) : "Quant conversation", updatedAt: validDate(candidate.updatedAt) }];
}

function sanitizeMessage(value: unknown): QuantMessage[] {
  if (typeof value !== "object" || value == null) return [];
  const candidate = value as Partial<QuantMessage>;
  if (typeof candidate.id !== "string" || (candidate.role !== "user" && candidate.role !== "assistant") || typeof candidate.content !== "string") return [];
  return [{ analysis: sanitizeQuantAnalysis(candidate.analysis), content: candidate.content.slice(0, 24_000), createdAt: validDate(candidate.createdAt), generatedIndicator: sanitizeGeneratedIndicator(candidate.generatedIndicator), id: candidate.id.slice(0, 96), role: candidate.role, usage: sanitizeUsage(candidate.usage) }];
}

function sanitizeQuantPreferences(value: unknown): QuantPreferences {
  const candidate = typeof value === "object" && value != null ? value as Partial<QuantPreferences> : {};
  return { allowGeneratedCode: candidate.allowGeneratedCode !== false, allowScreenshots: candidate.allowScreenshots === true, allowStructuredContext: candidate.allowStructuredContext !== false, dock: candidate.dock === "bottom" ? "bottom" : "right", retention: candidate.retention === "off" || candidate.retention === "session" ? candidate.retention : "30-days" };
}

function pruneQuantWorkspace(workspace: QuantWorkspace) {
  const cutoff = Date.now() - 30 * 86_400_000;
  return { ...workspace, conversations: workspace.conversations.filter((conversation) => Date.parse(conversation.updatedAt) >= cutoff).slice(0, 40) };
}

function sanitizeModels(value: unknown): QuantModel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): QuantModel[] => {
    if (!isRecord(item) || item.available !== true || typeof item.model_id !== "string") return [];
    const provider = typeof item.provider === "string" ? item.provider : "unknown";
    const inputCost = finiteNumber(item.input_token_cost_micros);
    const outputCost = finiteNumber(item.output_token_cost_micros);
    return [{
      description: String(item.availability_reason ?? "Supported server model").slice(0, 200),
      id: item.model_id.slice(0, 96),
      label: String(item.display_name ?? item.model_id).slice(0, 80),
      offline: provider === "offline-ai-fixture",
      operations: Array.isArray(item.operations) ? item.operations.filter((operation): operation is string => typeof operation === "string").slice(0, 12) : [],
      policy: {
        costLabel: provider === "offline-ai-fixture" ? "Offline deterministic scaffold · no model inference" : `${inputCost}µ input / ${outputCost}µ output per token ceiling`,
        dataRetention: "Server conversation retention: 30 days",
        maxContextTokens: null,
      },
      provider,
    }];
  }).slice(0, 16);
}

function toBackendChartContext(context: QuantChartContext) {
  return {
    active_indicators: context.activeIndicators.slice(0, 64),
    drawings: context.drawings.slice(0, 1_000),
    history_bars: context.history.barCount,
    provider: context.provider.slice(0, 64),
    selected_objects: context.selectedObjectId ? [context.selectedObjectId] : [],
    selected_region: context.selectedRegion ? {
      height: context.selectedRegion.heightRatio,
      width: context.selectedRegion.widthRatio,
      x: context.selectedRegion.xRatio,
      y: context.selectedRegion.yRatio,
    } : null,
    session_mode: context.sessionMode.toUpperCase(),
    settings: { visual: context.chartSettings, visible_bars: context.visibleBars },
    symbol: context.symbol,
    timeframe: context.timeframe,
    timezone: context.timezone,
    visible_from: context.history.firstTimestamp,
    visible_to: context.history.lastTimestamp,
  };
}

function backendArtifactUpdate(job: unknown, artifact: unknown, id: string): QuantJobUpdate {
  const usage = backendUsage(job);
  if (!isRecord(artifact) || !isRecord(artifact.content)) {
    return { content: "The provider completed, but the server returned no retained result artifact.", id, status: "failed", usage };
  }
  if (artifact.artifact_type === "CHART_ANALYSIS") {
    const analysis = sanitizeQuantAnalysis({
      bias: String(artifact.content.daily_bias ?? "neutral").toLowerCase(),
      invalidation: artifact.content.invalidation,
      levels: artifact.content.levels,
      riskWarning: artifact.content.risk_warning,
      summary: artifact.content.summary ?? "The provider returned a structured chart assessment.",
      uncertainty: artifact.content.uncertainty,
    });
    return { analysis, content: analysis?.summary ?? "Structured analysis could not be validated.", id, status: analysis ? "completed" : "failed", usage };
  }
  if (artifact.artifact_type === "INDICATOR_SOURCE" && typeof artifact.content.source === "string") {
    const adapted = adaptBackendIndicatorJson(artifact.content.source);
    if (!adapted.source) {
      return { content: `The server artifact was retained but not executed: ${adapted.diagnostics.map((item) => item.message).join(" ")}`, id, status: "completed", usage };
    }
    return {
      content: String(artifact.content.summary ?? "Converted the validated server artifact to canonical EdgeLab DSL."),
      generatedIndicator: { name: generatedName(adapted.source), source: adapted.source },
      id,
      status: "completed",
      usage,
    };
  }
  return { content: String(artifact.content.text ?? "The provider returned a retained response."), id, status: "completed", usage };
}

function backendFailureUpdate(job: unknown, id: string, status: QuantJobStatus): QuantJobUpdate {
  const detail = isRecord(job) && typeof job.error_message === "string" ? job.error_message : `The Quant job ended with status ${status}.`;
  return { content: detail.slice(0, 2_000), id, status, usage: backendUsage(job) };
}

function backendJobStatus(value: unknown): QuantJobStatus {
  if (!isRecord(value)) return "failed";
  const status = String(value.status ?? "").toLowerCase();
  return status === "queued" || status === "running" || status === "completed" || status === "cancelled" ? status : "failed";
}

function backendUsage(value: unknown): QuantUsage | undefined {
  if (!isRecord(value)) return undefined;
  return {
    cost: finiteNumber(value.actual_cost_micros) / 1_000_000,
    credits: null,
    inputTokens: nullableFiniteNumber(value.actual_input_tokens),
    outputTokens: nullableFiniteNumber(value.actual_output_tokens),
  };
}

function generatedName(source: string) {
  return source.match(/^indicator\s+"([^"]+)"/m)?.[1] ?? "Generated indicator";
}

function numericField(value: unknown, key: string) {
  if (!isRecord(value) || !Number.isInteger(Number(value[key])) || Number(value[key]) <= 0) throw new Error(`The Quant service returned no valid ${key}.`);
  return Number(value[key]);
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nullableFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function sanitizeGeneratedIndicator(value: unknown): QuantGeneratedIndicator | undefined {
  if (typeof value !== "object" || value == null || typeof (value as { source?: unknown }).source !== "string") return undefined;
  return { name: String((value as { name?: unknown }).name ?? "Generated indicator").slice(0, 80), source: (value as { source: string }).source.slice(0, 20_000) };
}

function sanitizeUsage(value: unknown): QuantUsage | undefined {
  if (typeof value !== "object" || value == null) return undefined;
  const candidate = value as Record<string, unknown>;
  const numeric = (key: string) => typeof candidate[key] === "number" && Number.isFinite(candidate[key]) ? candidate[key] as number : null;
  return { cost: numeric("cost"), credits: numeric("credits"), inputTokens: numeric("inputTokens"), outputTokens: numeric("outputTokens") };
}

function sanitizeBacktestConfig(value: QuantBacktestConfig): QuantBacktestConfig {
  return { commissionBps: clamp(value.commissionBps, 0, 1_000), initialCapital: clamp(value.initialCapital, 1, 1_000_000_000), rule: value.rule === "plot-crosses-zero" ? value.rule : "price-crosses-plot", slippageBps: clamp(value.slippageBps, 0, 1_000), windowDays: clamp(Math.round(value.windowDays), 1, 3_650) };
}

function hashBacktestSample(bars: Candle[], plot: Array<{ time: number; value: number }>, config: QuantBacktestConfig, version: number) {
  const input = JSON.stringify({ bars: bars.map((bar) => [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume]), config, plot: plot.map((point) => [point.time, Number(point.value.toFixed(8))]), version });
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) { hash ^= input.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function positive(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0; }
function validDate(value: unknown) { return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : new Date().toISOString(); }
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min)); }
