import {
  AlertTriangle,
  Bot,
  Camera,
  CheckCircle2,
  Code2,
  GripHorizontal,
  Mic,
  PanelBottom,
  PanelRight,
  Plus,
  ScanSearch,
  Send,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Candle } from "../lib/api";
import { getApiBearerToken } from "../lib/api";
import { getStoredAuthSession, subscribeAuthSession } from "../lib/authSession";
import { FloatingWorkspacePanel } from "./ui/WorkspacePanelManager";
import { IconButton } from "./ui/Primitives";
import type { EdgeIndicatorInputValue } from "../lib/indicatorDsl";
import { createIndicatorRuntimeJob } from "../lib/indicatorRuntime";
import type { CustomIndicatorScript } from "../lib/customIndicators";
import {
  DEFAULT_QUANT_BACKTEST_CONFIG,
  appendQuantAudit,
  createQuantConversation,
  createQuantGenerationJob,
  fetchQuantProviderStatus,
  hydrateQuantPreferences,
  hydrateQuantWorkspace,
  loadCachedQuantPreferences,
  loadCachedQuantWorkspace,
  persistQuantPreferences,
  persistQuantWorkspace,
  runReproducibleIndicatorBacktest,
  resolveQuantIndicatorFollowup,
  resolveQuantRequestContext,
  transcribeQuantAudio,
  upsertQuantConversation,
  type QuantBacktestConfig,
  type QuantBacktestResult,
  type QuantCaptureAttachment,
  type QuantChartContext,
  type QuantConversation,
  type QuantConversationKind,
  type QuantGeneratedIndicator,
  type QuantJobStatus,
  type QuantPreferences,
  type QuantProviderStatus,
  type QuantUsage,
  type QuantWorkspace,
} from "../lib/quantAssistant";

type Props = {
  attachment: QuantCaptureAttachment | null;
  bars: Candle[];
  context: QuantChartContext;
  onAddGeneratedIndicator: (artifact: QuantGeneratedIndicator) => void;
  onCaptureChart: () => Promise<void>;
  onCaptureRegion: () => void;
  onClearAttachment: () => void;
  onClose: () => void;
  onOpenIndicatorEditor: (artifact: QuantGeneratedIndicator) => void;
  scripts: readonly CustomIndicatorScript[];
};

type MicrophoneState = "not-requested" | "requesting" | "recording" | "transcribing" | "denied" | "error";
type RecordingAttempt = { controller: AbortController; ownerId: number | null; token: string | null };
type QuantSendRequest = {
  operation?: "CHART_ANALYSIS" | "GENERATE_INDICATOR" | "EDIT_INDICATOR" | "ANALYSIS_TO_INDICATOR";
  retry?: boolean;
  text?: string;
};

export function QuantPanel({
  attachment,
  bars,
  context,
  onAddGeneratedIndicator,
  onCaptureChart,
  onCaptureRegion,
  onClearAttachment,
  onClose,
  onOpenIndicatorEditor,
  scripts,
}: Props) {
  const [workspace, setWorkspace] = useState<QuantWorkspace>(loadCachedQuantWorkspace);
  const [preferences, setPreferences] = useState<QuantPreferences>(loadCachedQuantPreferences);
  const [provider, setProvider] = useState<QuantProviderStatus>({ available: false, detail: "Checking configured AI providers…", models: [] });
  const [providerLoading, setProviderLoading] = useState(true);
  const [kind, setKind] = useState<QuantConversationKind>("analysis");
  const [modelId, setModelId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [job, setJob] = useState<{ content: string; id: string; status: QuantJobStatus; usage?: QuantUsage } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [microphone, setMicrophone] = useState<MicrophoneState>("not-requested");
  const [selectedScriptId, setSelectedScriptId] = useState(scripts[0]?.id ?? "");
  const [backtestConfig, setBacktestConfig] = useState<QuantBacktestConfig>(DEFAULT_QUANT_BACKTEST_CONFIG);
  const [backtestResult, setBacktestResult] = useState<QuantBacktestResult | null>(null);
  const [backtestStatus, setBacktestStatus] = useState<"idle" | "running" | "error">("idle");
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [externalEgressConsent, setExternalEgressConsent] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const jobCancelRef = useRef<(() => Promise<void>) | null>(null);
  const lastRequestRef = useRef<Omit<QuantSendRequest, "retry"> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const recordingAttemptRef = useRef<RecordingAttempt | null>(null);
  const recordingBytesRef = useRef(0);
  const mountedRef = useRef(false);
  const recordingLimitRef = useRef<number | null>(null);

  const conversations = workspace.conversations.filter((conversation) => conversation.kind === kind);
  const activeId = workspace.activeConversationByKind[kind];
  const activeConversation = conversations.find((conversation) => conversation.id === activeId) ?? conversations[0] ?? null;
  const selectedModel = provider.models.find((model) => model.id === modelId) ?? provider.models[0] ?? null;
  const selectedScript = scripts.find((script) => script.id === selectedScriptId) ?? scripts[0] ?? null;
  const busy = job?.status === "queued" || job?.status === "running";

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    const onAuthChange = () => {
      const attempt = recordingAttemptRef.current;
      if (attempt) ensureCurrentRecording(attempt);
    };
    const unsubscribe = subscribeAuthSession(onAuthChange);
    window.addEventListener("edgelab:auth-session-change", onAuthChange);
    void Promise.all([hydrateQuantWorkspace(), hydrateQuantPreferences(), fetchQuantProviderStatus()]).then(([nextWorkspace, nextPreferences, nextProvider]) => {
      if (!active) return;
      setWorkspace(nextWorkspace);
      setPreferences(nextPreferences);
      setProvider(nextProvider);
      setModelId(nextProvider.models[0]?.id ?? "");
      setProviderLoading(false);
    });
    return () => {
      active = false;
      mountedRef.current = false;
      unsubscribe();
      window.removeEventListener("edgelab:auth-session-change", onAuthChange);
      void jobCancelRef.current?.();
      invalidateRecording();
    };
  }, []);

  useEffect(() => {
    if (!selectedScriptId && scripts[0]) setSelectedScriptId(scripts[0].id);
  }, [scripts, selectedScriptId]);

  function updatePreferences(patch: Partial<QuantPreferences>) {
    setPreferences((current) => {
      const next = { ...current, ...patch };
      void persistQuantPreferences(next);
      return next;
    });
  }

  function stopMediaTracks() {
    if (recordingLimitRef.current != null) window.clearTimeout(recordingLimitRef.current);
    recordingLimitRef.current = null;
    const recorder = mediaRecorderRef.current;
    if (recorder) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      recorder.onerror = null;
      if (recorder.state !== "inactive") {
        try { recorder.stop(); } catch { /* Track cleanup still runs after a browser stop failure. */ }
      }
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
    mediaChunksRef.current = [];
    recordingBytesRef.current = 0;
  }

  function invalidateRecording() {
    const attempt = recordingAttemptRef.current;
    recordingAttemptRef.current = null;
    attempt?.controller.abort();
    stopMediaTracks();
  }

  function ensureCurrentRecording(attempt: RecordingAttempt) {
    const current = mountedRef.current && recordingAttemptRef.current === attempt
      && getApiBearerToken() === attempt.token && (getStoredAuthSession()?.user.id ?? null) === attempt.ownerId;
    // Expiry can remove a session silently; release its attempt even without an identity event.
    if (!current && recordingAttemptRef.current === attempt) {
      invalidateRecording();
      if (mountedRef.current) setMicrophone("not-requested");
    }
    return current;
  }

  function commitWorkspace(next: QuantWorkspace) {
    setWorkspace(next);
    if (preferences.retention !== "session") void persistQuantWorkspace(preferences.retention === "off" ? { ...next, conversations: [] } : next);
  }

  function selectConversation(id: string) {
    const conversation = workspace.conversations.find((item) => item.id === id);
    if (!conversation) return;
    commitWorkspace({ ...workspace, activeConversationByKind: { ...workspace.activeConversationByKind, [kind]: id } });
  }

  function newConversation() {
    const conversation = createQuantConversation(kind);
    commitWorkspace(upsertQuantConversation(workspace, conversation));
    setJob(null);
    setError(null);
    setRetrying(false);
  }

  function deleteConversation() {
    if (!activeConversation) return;
    const remaining = workspace.conversations.filter((conversation) => conversation.id !== activeConversation.id);
    const fallback = remaining.find((conversation) => conversation.kind === kind);
    commitWorkspace({ activeConversationByKind: { ...workspace.activeConversationByKind, [kind]: fallback?.id }, conversations: remaining, revision: workspace.revision + 1 });
  }

  async function sendPrompt(options: QuantSendRequest = {}) {
    const text = (options.text ?? prompt).trim();
    if (!text || busy) return;
    if (!provider.available || !selectedModel) {
      setError(provider.detail);
      appendQuantAudit({ action: "generate", contextFields: [], modelId: null, status: "blocked" });
      return;
    }
    if (kind === "build" && !preferences.allowGeneratedCode) {
      setError("Generated indicator source is disabled in Quant permissions.");
      appendQuantAudit({ action: "generate", contextFields: [], modelId: selectedModel.id, status: "blocked" });
      return;
    }
    if (attachment && !preferences.allowScreenshots) {
      setError("Enable screenshot sharing before sending the attached chart image.");
      return;
    }
    if (attachment && !selectedModel.offline) {
      setError("The capture is stored as an opaque EdgeLab reference, but external vision transfer is not enabled for this provider. Remove the attachment to continue.");
      return;
    }
    if (!selectedModel.offline && !externalEgressConsent) {
      setError(`Confirm this one request before sending chart context and prior conversation to ${selectedModel.label} via ${selectedModel.provider}.`);
      return;
    }
    const conversation = activeConversation ?? createQuantConversation(kind);
    const lastMessage = conversation.messages.at(-1);
    const reuseFailedRequest = options.retry === true && lastMessage?.role === "user" && lastMessage.content === text;
    const userMessage = reuseFailedRequest
      ? lastMessage
      : { content: text, createdAt: new Date().toISOString(), id: `quant-message-${Date.now().toString(36)}`, role: "user" as const };
    const pendingConversation = reuseFailedRequest
      ? conversation
      : { ...conversation, messages: [...conversation.messages, userMessage], title: conversation.messages.length === 0 ? text.slice(0, 60) : conversation.title, updatedAt: userMessage.createdAt };
    commitWorkspace(upsertQuantConversation(workspace, pendingConversation));
    setPrompt("");
    setError(null);
    setRetrying(options.retry === true);
    setJob({ content: "", id: "local", status: "queued" });
    const sharedAttachment = preferences.allowScreenshots ? attachment : null;
    const sharedContext = preferences.allowStructuredContext
      ? resolveQuantRequestContext(context, sharedAttachment)
      : null;
    const followup = kind === "build" ? resolveQuantIndicatorFollowup(conversation, backtestResult) : { baseIndicator: null, operation: undefined, priorTestResult: null };
    const operation = options.operation ?? followup.operation;
    lastRequestRef.current = { operation, text };
    appendQuantAudit({ action: "generate", contextFields: sharedContext ? Object.keys(sharedContext) : [], modelId: selectedModel.id, status: "allowed" });
    const generation = createQuantGenerationJob({ attachment: sharedAttachment, baseIndicator: followup.baseIndicator, context: sharedContext, conversation: pendingConversation, egressConsent: externalEgressConsent, kind, modelId: selectedModel.id, operation, priorTestResult: followup.priorTestResult, prompt: text }, (update) => {
      setRetrying(false);
      setJob({ content: update.content, id: update.id, status: update.status, usage: update.usage });
    });
    setExternalEgressConsent(false);
    jobCancelRef.current = generation.cancel;
    void generation.promise.then(async (result) => {
      jobCancelRef.current = null;
      setRetrying(false);
      if (result.status !== "completed") {
        setJob(result);
        if (result.status === "failed") setError(result.content || "The Quant job failed without a provider response.");
        return;
      }
      const automaticBacktest = await automaticallyBacktest(result.generatedIndicator);
      const assistantMessage = {
        analysis: result.analysis,
        backtest: automaticBacktest ?? undefined,
        content: result.content,
        createdAt: new Date().toISOString(),
        generatedIndicator: result.generatedIndicator,
        id: `quant-message-${Date.now().toString(36)}-assistant`,
        role: "assistant" as const,
        usage: result.usage,
      };
      commitWorkspace(upsertQuantConversation({ ...workspace, conversations: [pendingConversation, ...workspace.conversations.filter((item) => item.id !== pendingConversation.id)] }, { ...pendingConversation, messages: [...pendingConversation.messages, assistantMessage], updatedAt: assistantMessage.createdAt }));
      if (automaticBacktest) setBacktestResult(automaticBacktest);
      appendQuantAudit({ action: "generate", contextFields: sharedContext ? Object.keys(sharedContext) : [], modelId: selectedModel.id, status: "completed" });
    }).catch((failure) => {
      jobCancelRef.current = null;
      setRetrying(false);
      setJob((current) => current ? { ...current, status: "failed" } : null);
      setError(failure instanceof Error ? failure.message : "The Quant request failed.");
      appendQuantAudit({ action: "generate", contextFields: sharedContext ? Object.keys(sharedContext) : [], modelId: selectedModel.id, status: "failed" });
    });
  }

  async function automaticallyBacktest(artifact?: QuantGeneratedIndicator) {
    if (!artifact) return null;
    try {
      const runtime = createIndicatorRuntimeJob({ bars: bars.slice(-20_000), inputs: {}, mode: "historical", source: artifact.source });
      const execution = await runtime.promise;
      return runReproducibleIndicatorBacktest(bars, execution.plots[0]?.points ?? [], backtestConfig, 1);
    } catch (failure) {
      setBacktestError(failure instanceof Error ? failure.message : "Automatic 60-day backtest failed.");
      return null;
    }
  }

  function turnAnalysisIntoIndicator(message: QuantConversation["messages"][number]) {
    if (!message.analysis) return;
    const analysis = message.analysis;
    const text = `Turn this chart analysis into a real-time EdgeLab indicator with score/probability labels. Bias: ${analysis.bias}. Summary: ${analysis.summary}. Levels: ${analysis.levels.map((level) => `${level.label} ${level.price}`).join(", ")}. Invalidation: ${analysis.invalidation}.`;
    void sendPrompt({ operation: "ANALYSIS_TO_INDICATOR", text });
  }

  async function cancelJob() {
    await jobCancelRef.current?.();
    jobCancelRef.current = null;
    appendQuantAudit({ action: "cancel", contextFields: [], modelId: selectedModel?.id ?? null, status: "completed" });
  }

  function retryJob() {
    if (!lastRequestRef.current || busy) return;
    void sendPrompt({ ...lastRequestRef.current, retry: true });
  }

  async function startRecording() {
    if (recordingAttemptRef.current) return;
    if (!provider.available) {
      setError("Dictation needs a configured Quant transcription provider.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMicrophone("error");
      setError("This browser does not support microphone recording.");
      return;
    }
    setMicrophone("requesting");
    setError(null);
    const attempt = { controller: new AbortController(), ownerId: getStoredAuthSession()?.user.id ?? null, token: getApiBearerToken() };
    recordingAttemptRef.current = attempt;
    appendQuantAudit({ action: "microphone", contextFields: [], modelId: selectedModel?.id ?? null, status: "allowed" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!ensureCurrentRecording(attempt)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      mediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      mediaChunksRef.current = [];
      recordingBytesRef.current = 0;
      recorder.ondataavailable = (event) => {
        if (!ensureCurrentRecording(attempt)) return;
        if (event.data.size === 0) return;
        recordingBytesRef.current += event.data.size;
        if (recordingBytesRef.current > 5_000_000) {
          invalidateRecording();
          setMicrophone("error");
          setError("Recording exceeds the 5 MB transcription limit.");
          return;
        }
        mediaChunksRef.current.push(event.data);
      };
      recorder.onstop = () => void finishRecording(recorder.mimeType || "audio/webm", attempt);
      recorder.onerror = () => {
        if (!ensureCurrentRecording(attempt)) return;
        invalidateRecording();
        setMicrophone("error");
        setError("The microphone recording failed. Try recording again.");
      };
      recorder.start(250);
      if (!ensureCurrentRecording(attempt)) return;
      setMicrophone("recording");
      recordingLimitRef.current = window.setTimeout(() => {
        if (ensureCurrentRecording(attempt) && recorder.state === "recording") recorder.stop();
      }, 60_000);
    } catch (failure) {
      if (!ensureCurrentRecording(attempt)) return;
      invalidateRecording();
      const denied = failure instanceof DOMException && (failure.name === "NotAllowedError" || failure.name === "SecurityError");
      setMicrophone(denied ? "denied" : "error");
      setError(denied ? "Microphone permission was denied. Change the site permission to use dictation." : "The microphone could not be started.");
      appendQuantAudit({ action: "microphone", contextFields: [], modelId: selectedModel?.id ?? null, status: "failed" });
    }
  }

  async function finishRecording(mimeType: string, attempt: RecordingAttempt) {
    if (!ensureCurrentRecording(attempt)) return;
    const blob = new Blob(mediaChunksRef.current, { type: mimeType });
    stopMediaTracks();
    if (!blob.size || blob.size > 5_000_000) {
      invalidateRecording();
      setMicrophone("error");
      setError(blob.size ? "Recording exceeds the 5 MB transcription limit." : "No audio was recorded. Try recording again.");
      return;
    }
    setMicrophone("transcribing");
    try {
      const buffer = await blob.arrayBuffer();
      if (!ensureCurrentRecording(attempt)) return;
      const encoded = arrayBufferToBase64(buffer);
      const text = await transcribeQuantAudio(encoded, mimeType, attempt.controller.signal);
      if (!ensureCurrentRecording(attempt)) return;
      setPrompt((current) => mountedRef.current && getApiBearerToken() === attempt.token
        && (getStoredAuthSession()?.user.id ?? null) === attempt.ownerId
        ? [current.trim(), text.trim()].filter(Boolean).join(" ") : current);
      setMicrophone("not-requested");
      appendQuantAudit({ action: "transcribe", contextFields: ["audio"], modelId: selectedModel?.id ?? null, status: "completed" });
    } catch (failure) {
      if (!ensureCurrentRecording(attempt)) return;
      setMicrophone("error");
      setError(failure instanceof Error ? failure.message : "Audio transcription failed.");
      appendQuantAudit({ action: "transcribe", contextFields: ["audio"], modelId: selectedModel?.id ?? null, status: "failed" });
    } finally {
      if (recordingAttemptRef.current === attempt) invalidateRecording();
    }
  }

  function cancelRecording() {
    invalidateRecording();
    setMicrophone("not-requested");
  }

  async function runBacktest() {
    if (!selectedScript) return;
    setBacktestStatus("running");
    setBacktestError(null);
    const job = createIndicatorRuntimeJob({ bars: bars.slice(-20_000), inputs: selectedScript.inputs as Record<string, EdgeIndicatorInputValue>, mode: "historical", source: selectedScript.source });
    try {
      const execution = await job.promise;
      const plot = execution.plots[0]?.points ?? [];
      setBacktestResult(runReproducibleIndicatorBacktest(bars, plot, backtestConfig, selectedScript.revision));
      setBacktestStatus("idle");
    } catch (failure) {
      setBacktestStatus("error");
      setBacktestError(failure instanceof Error ? failure.message : "Backtest execution failed.");
    }
  }

  return (
    <FloatingWorkspacePanel label="Quant assistant" dock={preferences.dock} size={preferences.dock === "right" ? preferences.panelWidth : preferences.panelHeight} onSizeChange={(size) => updatePreferences(preferences.dock === "right" ? { panelWidth: size } : { panelHeight: size })}>
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2.5">
        <div className="min-w-0"><h2 className="flex items-center gap-2 text-sm font-semibold text-white"><Bot size={16} /> Quant</h2><p className="truncate text-[11px] text-slate-500">Chart-aware analysis and indicator building</p></div>
        <div className="flex items-center gap-1">
          <IconButton icon={PanelRight} label="Dock Quant on the right" pressed={preferences.dock === "right"} onClick={() => updatePreferences({ dock: "right" })} />
          <IconButton icon={PanelBottom} label="Dock Quant at the bottom" pressed={preferences.dock === "bottom"} onClick={() => updatePreferences({ dock: "bottom" })} />
          <IconButton icon={X} label="Close Quant" onClick={onClose} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-1 border-b border-white/10 p-2" role="tablist">
          {(["analysis", "build"] as const).map((tab) => <button aria-selected={kind === tab} className={`h-8 flex-1 rounded-md text-xs font-semibold ${kind === tab ? "bg-white text-ink-950" : "text-slate-400 hover:bg-white/5 hover:text-white"}`} key={tab} onClick={() => setKind(tab)} role="tab" type="button">{tab === "analysis" ? "Chart analysis" : "Build & backtest"}</button>)}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-2">
          <select aria-label="Quant conversation" className="input-control h-8 min-w-0 flex-1 text-xs" onChange={(event) => selectConversation(event.target.value)} value={activeConversation?.id ?? ""}><option value="">No conversation</option>{conversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.title}</option>)}</select>
          <button aria-label="New conversation" className="icon-button h-8 w-8" onClick={newConversation} type="button"><Plus size={13} /></button>
          <button aria-label="Delete conversation" className="icon-button h-8 w-8" disabled={!activeConversation} onClick={deleteConversation} type="button"><Trash2 size={13} /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {providerLoading ? <div aria-label="Quant provider status" className="m-3 flex gap-2 rounded-lg border border-white/10 bg-white/[0.04] p-3 text-xs leading-5 text-slate-300" data-quant-state="provider-loading" role="status"><Bot className="mt-0.5 shrink-0" size={14} /><div><strong className="block text-slate-100">Checking Quant provider</strong><span className="text-slate-400">Confirming the models and permissions available to this workspace…</span></div></div> : !provider.available ? <div aria-label="Quant provider status" className="m-3 flex gap-2 rounded-lg border border-amber-300/15 bg-amber-300/[0.06] p-3 text-xs leading-5 text-amber-100" data-quant-state="unavailable" role="status"><AlertTriangle className="mt-0.5 shrink-0" size={14} /><div><strong className="block">Quant provider unavailable</strong><span className="text-amber-100/70">{provider.detail} Conversations, scripts, captures, and deterministic backtests remain local; no AI output is fabricated.</span></div></div> : null}
          <div className="space-y-3 p-3">
            {activeConversation?.messages.length ? activeConversation.messages.map((message) => <Message key={message.id} message={message} onAddGeneratedIndicator={onAddGeneratedIndicator} onOpenIndicatorEditor={onOpenIndicatorEditor} onTurnAnalysisIntoIndicator={turnAnalysisIntoIndicator} />) : <div aria-label="Quant conversation empty state" className="grid min-h-36 place-items-center rounded-lg border border-dashed border-white/10 px-5 text-center" data-quant-state="empty" role="status"><div><Bot className="mx-auto text-slate-600" size={22} /><h3 className="mt-2 text-sm font-semibold text-slate-200">{kind === "analysis" ? "Ask about the visible chart" : "Describe an indicator to build"}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{kind === "analysis" ? "Quant can use structured context or an explicitly shared capture when a provider is configured." : "Generated source must compile as EdgeLab DSL before it can run or reach the chart."}</p></div></div>}
            {job ? <div aria-label="Quant request status" aria-live="polite" className="rounded-lg bg-white/[0.04] p-3 text-xs leading-5 text-slate-300" data-quant-state={retrying ? "retrying" : job.status} role="status"><div className="mb-2 flex items-center justify-between gap-3"><span className="font-semibold text-cyan-100">{quantJobLabel(job.status, retrying)}</span>{busy ? <button className="studio-tool-button" onClick={() => void cancelJob()} type="button"><Square size={11} /> Cancel</button> : job.status === "cancelled" && lastRequestRef.current ? <button className="studio-tool-button studio-tool-button-active" onClick={retryJob} type="button">Retry request</button> : null}</div>{quantJobContent(job, retrying)}</div> : null}
            {error ? <div className="rounded-lg bg-rose-400/10 p-3 text-xs leading-5 text-rose-200" data-quant-state="error" role="alert"><p>{error}</p>{lastRequestRef.current ? <button className="studio-tool-button studio-tool-button-active mt-2" onClick={retryJob} type="button">Retry request</button> : null}</div> : null}
          </div>

          {kind === "build" ? <BacktestControls config={backtestConfig} error={backtestError} onChange={setBacktestConfig} onRun={() => void runBacktest()} result={backtestResult} scripts={scripts} selectedScriptId={selectedScript?.id ?? ""} setSelectedScriptId={setSelectedScriptId} status={backtestStatus} /> : null}
        </div>

        <div className="border-t border-white/10 p-3">
          <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <select aria-label="Quant model" className="input-control h-8 min-w-0 text-xs" disabled={!provider.available} onChange={(event) => setModelId(event.target.value)} value={selectedModel?.id ?? ""}>{provider.models.length ? provider.models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>) : <option value="">No supported model</option>}</select>
            <div className="flex gap-1">
              <button aria-label="Attach full chart screenshot" className="icon-button h-8 w-8" disabled={!preferences.allowScreenshots} onClick={() => void onCaptureChart()} title={preferences.allowScreenshots ? "Attach full chart" : "Enable screenshot permission first"} type="button"><Camera size={13} /></button>
              <button aria-label="Select chart region to send" className="icon-button h-8 w-8" disabled={!preferences.allowScreenshots} onClick={onCaptureRegion} title={preferences.allowScreenshots ? "Drag-select chart region" : "Enable screenshot permission first"} type="button"><ScanSearch size={13} /></button>
            </div>
          </div>
          {selectedModel ? <p className="mb-2 text-[10px] leading-4 text-slate-500">Before use: {selectedModel.policy.costLabel} · retention {selectedModel.policy.dataRetention}{selectedModel.policy.maxContextTokens ? ` · ${selectedModel.policy.maxContextTokens.toLocaleString()} token context` : ""}</p> : null}
          {selectedModel && !selectedModel.offline ? <label className="mb-2 flex items-start gap-2 rounded-md border border-amber-300/20 bg-amber-300/[0.05] p-2 text-[11px] leading-4 text-amber-100"><input checked={externalEgressConsent} className="mt-0.5 h-4 w-4 accent-amber-300" onChange={(event) => setExternalEgressConsent(event.target.checked)} type="checkbox" /><span>For this request only, send chart context and prior conversation to <strong>{selectedModel.label}</strong> via {selectedModel.provider}. This resets after send.</span></label> : null}
          {attachment ? <div className="mb-2 flex items-center justify-between rounded-md bg-cyan-300/[0.06] px-2 py-1.5 text-[11px] text-cyan-100"><span>{attachment.kind === "region" ? "Selected region" : "Full chart"} attached · {attachment.width}×{attachment.height}</span><button aria-label="Remove chart attachment" onClick={onClearAttachment} type="button"><X size={12} /></button></div> : null}
          <textarea aria-label="Message Quant" className="input-control min-h-20 w-full resize-y text-sm" disabled={busy} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void sendPrompt(); }} placeholder={providerLoading ? "Checking provider…" : provider.available ? "Ask Quant…" : "Provider unavailable — draft remains editable"} value={prompt} />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              {microphone === "recording" ? <><button className="studio-tool-button studio-tool-button-active" onClick={() => mediaRecorderRef.current?.stop()} type="button"><Square size={11} /> Stop & transcribe</button><button className="studio-tool-button" onClick={cancelRecording} type="button">Cancel</button></> : <button className="studio-tool-button" disabled={!provider.available || microphone === "requesting" || microphone === "transcribing"} onClick={() => void startRecording()} type="button"><Mic size={12} />{microphone === "requesting" ? "Requesting…" : microphone === "transcribing" ? "Transcribing…" : "Dictate"}</button>}
              <span className="text-[10px] text-slate-500">Mic: {microphone.replace("-", " ")}</span>
            </div>
            <button className="studio-tool-button studio-tool-button-active" disabled={!prompt.trim() || busy || !provider.available} onClick={() => void sendPrompt()} type="button"><Send size={12} /> Send</button>
          </div>
          <details className="mt-2 text-[11px] text-slate-500"><summary className="cursor-pointer">Permissions, retention & context</summary><div className="mt-2 grid gap-2 rounded-md bg-black/20 p-2"><Permission checked={preferences.allowStructuredContext} label="Share structured chart context" onChange={(value) => updatePreferences({ allowStructuredContext: value })} /><Permission checked={preferences.allowScreenshots} label="Allow explicit screenshot attachments" onChange={(value) => updatePreferences({ allowScreenshots: value })} /><Permission checked={preferences.allowGeneratedCode} label="Allow generated EdgeLab DSL source" onChange={(value) => updatePreferences({ allowGeneratedCode: value })} /><label className="flex items-center justify-between gap-3"><span>Conversation retention</span><select className="input-control h-8 text-xs" onChange={(event) => updatePreferences({ retention: event.target.value as QuantPreferences["retention"] })} value={preferences.retention}><option value="30-days">30 days</option><option value="session">This session</option><option value="off">Off</option></select></label><p>Context preview: {context.symbol} · {context.timeframe} · {context.visibleBars.length} visible bars · {context.activeIndicators.length} studies · {context.drawings.length} drawings.</p></div></details>
          {job?.usage ? <p className="mt-2 text-[10px] text-slate-500">Actual usage: {formatUsage(job.usage)}</p> : null}
        </div>
      </div>
      <style>{`@media (max-width: 1023px) { aside[aria-label="Quant assistant"] { bottom: calc(4rem + env(safe-area-inset-bottom)) !important; } } @media (max-width: 640px) { aside[aria-label="Quant assistant"] { left: 8px !important; right: 8px !important; top: 8px !important; height: auto !important; width: auto !important; } }`}</style>
    </FloatingWorkspacePanel>
  );
}

function Message({ message, onAddGeneratedIndicator, onOpenIndicatorEditor, onTurnAnalysisIntoIndicator }: { message: QuantConversation["messages"][number]; onAddGeneratedIndicator: (artifact: QuantGeneratedIndicator) => void; onOpenIndicatorEditor: (artifact: QuantGeneratedIndicator) => void; onTurnAnalysisIntoIndicator: (message: QuantConversation["messages"][number]) => void }) {
  return <article aria-label={`${message.role === "user" ? "User" : "Quant"} message${message.generatedIndicator ? " with generated indicator" : ""}`} className={`rounded-lg p-3 text-xs leading-5 ${message.role === "user" ? "ml-8 bg-cyan-300/10 text-cyan-50" : "mr-5 bg-white/[0.04] text-slate-300"}`} data-quant-artifact={message.generatedIndicator ? "true" : undefined}><div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{message.role === "user" ? "You" : "Quant"}</div><p className="whitespace-pre-wrap">{message.content}</p>{message.analysis ? <><AnalysisPresentation analysis={message.analysis} /><button className="studio-tool-button mt-3" onClick={() => onTurnAnalysisIntoIndicator(message)} type="button"><Code2 size={12} /> Turn analysis into indicator</button></> : null}{message.generatedIndicator ? <><IndicatorSemantics artifact={message.generatedIndicator} /><div className="mt-3 flex flex-wrap gap-2"><button className="studio-tool-button" onClick={() => onOpenIndicatorEditor(message.generatedIndicator!)} type="button"><Code2 size={12} /> Open source</button><button className="studio-tool-button studio-tool-button-active" onClick={() => onAddGeneratedIndicator(message.generatedIndicator!)} type="button"><Plus size={12} /> Add to chart</button></div></> : null}{message.backtest ? <p className="mt-3 rounded-md border border-white/10 p-2 text-slate-400">Automatic {DEFAULT_QUANT_BACKTEST_CONFIG.windowDays}-day test · {message.backtest.trades} trades · {message.backtest.netReturnPercent.toFixed(2)}% net · sample {message.backtest.sample.hash}</p> : null}{message.usage ? <p className="mt-2 text-[10px] text-slate-500">Usage: {formatUsage(message.usage)}</p> : null}</article>;
}

function quantJobLabel(status: QuantJobStatus, retrying: boolean) {
  if (retrying) return "Retrying";
  return { cancelled: "Cancelled", completed: "Completed", failed: "Failed", queued: "Queued", running: "Generating" }[status];
}

function quantJobContent(job: { content: string; status: QuantJobStatus }, retrying: boolean) {
  if (retrying) return "Reconnecting to the configured provider for the previous request…";
  if (job.status === "failed") return "The request stopped. Review the recovery message below.";
  if (job.content) return job.content;
  if (job.status === "cancelled") return "Request cancelled. No new assistant response was saved.";
  if (job.status === "completed") return "The provider completed without additional response text.";
  return "Waiting for the configured provider…";
}

function AnalysisPresentation({ analysis }: { analysis: NonNullable<QuantConversation["messages"][number]["analysis"]> }) {
  return <div className="mt-3 border-t border-white/10 pt-3"><div className="flex items-center justify-between"><strong className="text-slate-100">Daily bias</strong><span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${analysis.bias === "bullish" ? "bg-emerald-400/10 text-emerald-200" : analysis.bias === "bearish" ? "bg-rose-400/10 text-rose-200" : "bg-white/5 text-slate-300"}`}>{analysis.bias}</span></div><div className="mt-2 grid grid-cols-2 gap-2 rounded-md bg-black/20 p-2"><Metric label="Model confidence" value={`${analysis.confidenceScore.toFixed(0)}/100`} /><Metric label="Outcome probability" value={analysis.probability == null ? "Not calibrated" : `${analysis.probability.toFixed(0)}%`} /><p className="col-span-2 text-[10px] leading-4 text-slate-500">{analysis.probabilityBasis} Scores are decision support, never a guarantee.</p></div><p className="mt-2">{analysis.summary}</p>{analysis.levels.length ? <dl className="mt-3 grid gap-2">{analysis.levels.map((level, index) => <div className="grid grid-cols-[auto_1fr] gap-3" key={`${level.price}-${index}`}><dt className="font-mono text-cyan-100">{level.price}</dt><dd><strong className="text-slate-200">{level.label}</strong><span className="block text-slate-500">{level.rationale}</span></dd></div>)}</dl> : null}<dl className="mt-3 grid gap-2 text-slate-400"><div><dt className="font-semibold text-slate-200">Invalidation</dt><dd>{analysis.invalidation}</dd></div><div><dt className="font-semibold text-slate-200">Uncertainty</dt><dd>{analysis.uncertainty}</dd></div><div className="rounded-md bg-amber-300/[0.06] p-2 text-amber-100"><dt className="font-semibold">Risk warning</dt><dd>{analysis.riskWarning}</dd></div></dl></div>;
}

function IndicatorSemantics({ artifact }: { artifact: QuantGeneratedIndicator }) {
  if (!artifact.scoreLabel && !artifact.probabilityLabel) return null;
  return <dl className="mt-3 grid gap-2 rounded-md border border-white/10 p-2 text-[11px]"><div><dt className="font-semibold text-slate-200">{artifact.scoreLabel ?? "Signal score"}</dt><dd className="text-slate-500">{artifact.scoreSemantics ?? "Indicator output; not model confidence."}</dd></div><div><dt className="font-semibold text-slate-200">{artifact.probabilityLabel ?? "Probability unavailable"}</dt><dd className="text-slate-500">{artifact.probabilitySemantics ?? "No calibrated outcome probability is available."}</dd></div></dl>;
}

function BacktestControls({ config, error, onChange, onRun, result, scripts, selectedScriptId, setSelectedScriptId, status }: { config: QuantBacktestConfig; error: string | null; onChange: (value: QuantBacktestConfig) => void; onRun: () => void; result: QuantBacktestResult | null; scripts: readonly CustomIndicatorScript[]; selectedScriptId: string; setSelectedScriptId: (id: string) => void; status: "idle" | "running" | "error" }) {
  return <section className="border-t border-white/10 p-3"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-white">Reproducible study backtest</h3><button className="studio-tool-button" disabled={!selectedScriptId || status === "running"} onClick={onRun} type="button">{status === "running" ? <GripHorizontal className="animate-pulse" size={12} /> : <CheckCircle2 size={12} />}{status === "running" ? "Running…" : "Run"}</button></div><p className="mt-1 text-[11px] leading-4 text-slate-500">Default window is 60 calendar days. Source executes in the same isolated worker used by the chart.</p><div className="mt-3 grid grid-cols-2 gap-2"><label className="col-span-2 text-[11px] text-slate-400">Indicator<select className="input-control mt-1 h-8 w-full text-xs" onChange={(event) => setSelectedScriptId(event.target.value)} value={selectedScriptId}><option value="">Choose script</option>{scripts.map((script) => <option key={script.id} value={script.id}>{script.name} · v{script.revision}</option>)}</select></label><BacktestNumber label="Days" max={3650} min={1} onChange={(windowDays) => onChange({ ...config, windowDays })} value={config.windowDays} /><BacktestNumber label="Capital" min={1} onChange={(initialCapital) => onChange({ ...config, initialCapital })} value={config.initialCapital} /><BacktestNumber label="Commission bps" min={0} onChange={(commissionBps) => onChange({ ...config, commissionBps })} value={config.commissionBps} /><BacktestNumber label="Slippage bps" min={0} onChange={(slippageBps) => onChange({ ...config, slippageBps })} value={config.slippageBps} /><label className="col-span-2 text-[11px] text-slate-400">Rules<select className="input-control mt-1 h-8 w-full text-xs" onChange={(event) => onChange({ ...config, rule: event.target.value as QuantBacktestConfig["rule"] })} value={config.rule}><option value="price-crosses-plot">Price crosses plot</option><option value="plot-crosses-zero">Plot crosses zero</option></select></label></div>{error ? <p className="mt-3 rounded-md bg-rose-400/10 p-2 text-xs text-rose-200">{error}</p> : null}{result ? <div className="mt-3 text-xs"><div className="grid grid-cols-2 gap-x-4 gap-y-2 border-y border-white/10 py-3"><Metric label="Net return" value={`${result.netReturnPercent.toFixed(2)}%`} /><Metric label="Max drawdown" value={`${result.maxDrawdownPercent.toFixed(2)}%`} /><Metric label="Trades" value={String(result.trades)} /><Metric label="Win rate" value={`${result.winRatePercent.toFixed(1)}%`} /><Metric label="Ending capital" value={result.endingCapital.toFixed(2)} /><Metric label="Sample hash" value={result.sample.hash} /></div><details className="mt-2 text-slate-400"><summary className="cursor-pointer">Assumptions and warnings</summary><ul className="mt-2 list-disc space-y-1 pl-4">{[...result.assumptions, ...result.warnings].map((item) => <li key={item}>{item}</li>)}</ul></details></div> : null}</section>;
}

function Permission({ checked, label, onChange }: { checked: boolean; label: string; onChange: (value: boolean) => void }) { return <label className="flex items-center justify-between gap-3"><span>{label}</span><input checked={checked} className="h-4 w-4 accent-cyan-300" onChange={(event) => onChange(event.target.checked)} type="checkbox" /></label>; }
function BacktestNumber({ label, max, min, onChange, value }: { label: string; max?: number; min: number; onChange: (value: number) => void; value: number }) { return <label className="text-[11px] text-slate-400">{label}<input className="input-control mt-1 h-8 w-full text-xs" max={max} min={min} onChange={(event) => onChange(Number(event.target.value))} type="number" value={value} /></label>; }
function Metric({ label, value }: { label: string; value: string }) { return <div><span className="block text-[10px] uppercase tracking-[0.1em] text-slate-500">{label}</span><strong className="font-mono text-slate-200">{value}</strong></div>; }
function formatUsage(usage: QuantUsage) { return [`${usage.inputTokens ?? "—"} in`, `${usage.outputTokens ?? "—"} out`, usage.credits != null ? `${usage.credits} credits` : null, usage.cost != null ? `$${usage.cost.toFixed(4)}` : null].filter(Boolean).join(" · "); }
function arrayBufferToBase64(buffer: ArrayBuffer) { const bytes = new Uint8Array(buffer); let binary = ""; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)); return btoa(binary); }
