import { NumericDraftInput } from "./NumericDraftInput";
import { ThemedSelect } from "./ThemedSelect";
import { usePineInputMetadata, usePineInputMigration } from "../lib/usePineInputMetadata";
import { hasLegacyPineEnums, migratePineEnumInputs } from "../lib/pineInputMigration";
import { usePineInstrumentContext } from "./chart/usePineInstrumentContext";
import type { PineLiveFeed } from "../lib/pineLiveFeed";
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  Copy,
  History,
  Play,
  Plus,
  Save,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { Candle } from "../lib/api";
import { getApiBearerToken } from "../lib/api";
import { getStoredAuthSession, subscribeAuthSession } from "../lib/authSession";
import {
  DEFAULT_EDGE_INDICATOR_SOURCE,
  DEFAULT_PINE_INDICATOR_SOURCE,
  DEFAULT_PINE_STRATEGY_SOURCE,
  duplicateCustomIndicator,
  isPineScriptSource,
  saveCustomIndicator,
  type CustomIndicatorScript,
} from "../lib/customIndicators";
import {
  EDGE_INDICATOR_DSL_REFERENCE,
  parseEdgeIndicator,
  type EdgeIndicatorInputValue,
} from "../lib/indicatorDsl";
import { createCustomScriptRuntimeJob } from "../lib/customScriptRuntime";
import { pineMarketScopeForFeed } from "../lib/pineMarketScope";
import { createPineRuntimeJob } from "../lib/pineRuntime";
import { validatePineStrategySettings, type PineStrategySettings, type PineExecutionResult, type PinePrepareResult, type PineSourceSnapshot } from "../lib/pineProtocol";
import { pineAnchorActive, pineInputAnchors } from "../lib/pineInteractiveInputs";
import { pineInputActive } from "../lib/pineInputActivation";
import { pickPineChartInputs } from "../lib/pineChartInputPicker";
import { pineSourceSnapshotForChart } from "../lib/pineSourceSnapshot";
import { loadPineCatalogOriginal, pineCatalogProvenanceLicenseUrl, sanitizePineCatalogProvenance, type PineCatalogImport, type PineCatalogProvenance } from "../lib/pineCatalog";
import { sourceSha256 } from "../lib/sourceSha256";
import { PINE_INDICATOR_STARTERS } from "../lib/pineStarters";
import { PineCatalogBrowser } from "./PineCatalogBrowser";
import { PineInputControl } from "./PineInputControl";
import { PineStrategySettingsControl } from "./PineStrategySettingsControl";
import { PineStrategyResults } from "./PineStrategyResults";
import { Dialog, IconButton } from "./ui/Primitives";

type EditorRequest = {
  nonce: number;
  scriptId?: string;
  source?: string;
  catalogOrigin?: PineCatalogProvenance;
};

type Props = {
  bars: Candle[];
  sourceSnapshot?: PineSourceSnapshot;
  symbol: string;
  timeframe: string;
  pineLiveFeed?: PineLiveFeed;
  onAddToChart: (script: CustomIndicatorScript, inputs: Record<string, EdgeIndicatorInputValue>) => void;
  onClose: () => void;
  onScriptsChange: (scripts: CustomIndicatorScript[]) => void | Promise<unknown>;
  request: EditorRequest;
  scripts: CustomIndicatorScript[];
};

const COMPLETIONS = [
  "indicator", "input", "plot", "overlay", "pane", "number", "boolean", "source",
  "open", "high", "low", "close", "volume", "hl2", "hlc3", "ohlc4",
  "sma(", "ema(", "wma(", "highest(", "lowest(", "change(", "roc(", "rsi(",
  "atr(", "stdev(", "linreg(", "cci(", "adx(", "obv(", "mfi(", "cmf(",
  "force_index(", "histvol(", "choppiness(", "abs(", "min(", "max(",
];
const PINE_COMPLETIONS = ["indicator(", "strategy(", "input.int(", "input.float(", "input.bool(", "input.source(", "input.color(", "plot(", "plotshape(", "ta.ema(", "ta.sma(", "ta.rsi(", "ta.crossover(", "ta.crossunder(", "strategy.entry(", "strategy.exit(", "strategy.close(", "color.new("];

export function IndicatorEditorPanel({
  bars,
  sourceSnapshot,
  symbol,
  timeframe,
  pineLiveFeed,
  onAddToChart,
  onClose,
  onScriptsChange,
  request,
  scripts,
}: Props) {
  const [selectedId, setSelectedId] = useState("");
  const [source, setSource] = useState(DEFAULT_EDGE_INDICATOR_SOURCE);
  const [strategySettings, setStrategySettings] = useState<PineStrategySettings>({});
  const [inputs, setInputs] = useState<Record<string, EdgeIndicatorInputValue>>({});
  const [completionOpen, setCompletionOpen] = useState(false);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [runState, setRunState] = useState<{ detail: string; status: "idle" | "running" | "success" | "error" }>({ detail: "", status: "idle" });
  const [historyRevision, setHistoryRevision] = useState<number | null>(null);
  const [catalogOrigin, setCatalogOrigin] = useState<PineCatalogProvenance | undefined>();
  const [originalRecovery, setOriginalRecovery] = useState<{ busy: boolean; loaded: PineCatalogImport | null; error: string | null }>({ busy: false, loaded: null, error: null });
  const originalRecoveryRef = useRef<{ controller: AbortController; draft: unknown } | null>(null);
  const originalRecoveryButtonRef = useRef<HTMLButtonElement | null>(null);
  const [quantSemanticsWarning, setQuantSemanticsWarning] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PinePrepareResult | null>(null);
  const [inputRecovery, setInputRecovery] = useState<Record<string, string>>({});
  const inputStateRef = useRef({ prepared, inputs, recovery: inputRecovery });
  const [execution, setExecution] = useState<PineExecutionResult | null>(null);
  const [confirmation, setConfirmation] = useState<{ scope: object; values: Record<string, EdgeIndicatorInputValue>; error: string | null } | null>(null);
  const confirmationRef = useRef(confirmation);
  confirmationRef.current = confirmation;
  const [chartPicking, setChartPicking] = useState(false);
  const pickerAbortRef = useRef<AbortController | null>(null);
  const confirmationFieldsRef = useRef<HTMLDivElement>(null);
  const addPendingRef = useRef(false);
  const [addingToChart, setAddingToChart] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const runtimeCancelRef = useRef<(() => void) | null>(null);
  const attemptRef = useRef(0);
  const ownerRef = useRef({ id: getStoredAuthSession()?.user.id ?? null, token: getApiBearerToken() });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const userScripts = scripts.filter((script) => script.origin === "user");
  const selectedScript = scripts.find((script) => script.id === selectedId) ?? null;
  const pine = isPineScriptSource(source);
  const pineInstrument = usePineInstrumentContext(symbol, timeframe, pineLiveFeed, pine);
  const contextRef = useRef({ bars, sourceSnapshot, symbol, timeframe, nonce: request.nonce, metadataKey: pineInstrument.key });
  contextRef.current = { bars, sourceSnapshot, symbol, timeframe, nonce: request.nonce, metadataKey: pineInstrument.key };
  const executionOwnerRef = useRef<typeof contextRef.current | null>(null);
  const matchesSelected = Boolean(selectedScript && !hasLegacyPineEnums(selectedScript.pinePrepared) && !hasLegacyPineEnums(prepared ?? undefined) && selectedScript.source === source
    && JSON.stringify(selectedScript.strategySettings ?? {}) === JSON.stringify(strategySettings)
    && JSON.stringify(selectedScript.inputs) === JSON.stringify(inputs)
    && JSON.stringify(selectedScript.catalogOrigin) === JSON.stringify(catalogOrigin));
  const originalCatalogSource = useMemo(() => Boolean(catalogOrigin && sourceSha256(source) === catalogOrigin.sourceSha256), [source, catalogOrigin?.sourceSha256]);
  const unchangedMigration = useMemo(() => Boolean(catalogOrigin?.migration && sourceSha256(source) === catalogOrigin.migration.sourceSha256), [source, catalogOrigin?.migration?.sourceSha256]);
  const draftPineVersion = source.match(/^[ \t\uFEFF]*\/\/@version=(\d+)/m)?.[1];
  // Archived source belongs to the draft, not to each received market update.
  const catalogDraftIdentity = useMemo(() => ({}), [source, inputs, strategySettings, catalogOrigin, selectedId, request.nonce, symbol, timeframe]);
  const catalogDraftRef = useRef(catalogDraftIdentity);
  catalogDraftRef.current = catalogDraftIdentity;
  useEffect(() => {
    originalRecoveryRef.current?.controller.abort();
    originalRecoveryRef.current = null;
    setOriginalRecovery({ busy: false, loaded: null, error: null });
    return () => { originalRecoveryRef.current?.controller.abort(); originalRecoveryRef.current = null; };
  }, [catalogDraftIdentity]);
  const parsed = useMemo(() => parseEdgeIndicator(pine ? "" : source), [pine, source]);
  const currentPrepared = usePineInputMetadata(pine ? source : undefined, prepared?.source === source ? prepared : undefined);
  const confirmationScope = useMemo(() => ({}), [source, selectedId, request.nonce, symbol, timeframe, pineInstrument.key,
    pineLiveFeed, pineLiveFeed?.getSnapshot().epoch, currentPrepared, inputs, strategySettings]);
  const confirmationScopeRef = useRef(confirmationScope);
  confirmationScopeRef.current = confirmationScope;
  function cancelConfirmation() {
    pickerAbortRef.current?.abort();
    pickerAbortRef.current = null;
    confirmationRef.current = null;
    setConfirmation(null);
    setChartPicking(false);
  }
  useEffect(() => {
    if (confirmationRef.current && confirmationRef.current.scope !== confirmationScope) cancelConfirmation();
  }, [confirmationScope]);
  useEffect(() => () => { pickerAbortRef.current?.abort(); confirmationRef.current = null; }, []);
  const effectivePineInputs = usePineInputMigration(prepared?.source === source ? prepared : undefined, currentPrepared, inputs, inputRecovery, (migration) => {
    if (!currentOwner() || migration.prepared.source !== source) return;
    invalidateExecution();
    setPrepared(migration.prepared); setInputs(migration.inputs); setInputRecovery(migration.recovery);
  });
  inputStateRef.current = { prepared: currentPrepared ?? prepared, inputs: effectivePineInputs.inputs, recovery: effectivePineInputs.recovery };
  const invalidEnumInput = currentPrepared?.inputDefinitions.some((input) => input.enumVersion === 1 && !input.options?.includes(effectivePineInputs.inputs[input.id] ?? input.defval));
  let strategySettingsError: string | null = null;
  try { validatePineStrategySettings(strategySettings); } catch (cause) { strategySettingsError = cause instanceof Error ? cause.message : "Check your strategy test settings."; }
  const canSave = !strategySettingsError && !invalidEnumInput && (pine ? Boolean(currentPrepared) : Boolean(parsed.program));
  const diagnostics = pine ? currentPrepared?.diagnostics ?? [] : parsed.diagnostics;
  const currentWord = source.slice(0, textareaRef.current?.selectionStart ?? source.length).match(/[A-Za-z_][A-Za-z0-9_]*$/)?.[0]?.toLowerCase() ?? "";
  const completions = (pine ? PINE_COMPLETIONS : COMPLETIONS).filter((item) => !currentWord || item.toLowerCase().startsWith(currentWord)).slice(0, 12);

  function invalidateExecution() {
    attemptRef.current += 1;
    runtimeCancelRef.current?.();
    runtimeCancelRef.current = null;
    setExecution(null);
    setRunState({ detail: "", status: "idle" });
  }
  function currentOwner() {
    return ownerRef.current.id === (getStoredAuthSession()?.user.id ?? null)
      && ownerRef.current.token === getApiBearerToken();
  }
  function currentContext(snapshot: typeof contextRef.current) {
    const current = contextRef.current;
    return current.bars === snapshot.bars && current.sourceSnapshot === snapshot.sourceSnapshot && current.symbol === snapshot.symbol
      && current.timeframe === snapshot.timeframe && current.nonce === snapshot.nonce && current.metadataKey === snapshot.metadataKey;
  }

  function changeSource(next: string, metadata: PinePrepareResult | null = null) {
    invalidateExecution();
    setSource(next);
    setPrepared(metadata?.source === next ? metadata : null);
    setInputRecovery({});
    setQuantSemanticsWarning(null);
  }

  function changeStrategySettings(value: PineStrategySettings) {
    invalidateExecution(); setStrategySettings(value);
  }

  function changeInput(key: string, value: EdgeIndicatorInputValue) {
    invalidateExecution();
    if (pine && currentPrepared) {
      setPrepared(currentPrepared);
      setInputs({ ...effectivePineInputs.inputs, [key]: value });
      setInputRecovery(Object.fromEntries(Object.entries(effectivePineInputs.recovery).filter(([id]) => id !== key)));
    } else {
      setInputs((current) => ({ ...current, [key]: value }));
      setInputRecovery((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== key)));
    }
  }

  useEffect(() => {
    const requested = request.scriptId ? scripts.find((script) => script.id === request.scriptId) : null;
    setSelectedId(requested?.id ?? "");
    changeSource(request.source ?? requested?.source ?? DEFAULT_EDGE_INDICATOR_SOURCE, requested?.pinePrepared ?? null);
    setInputs(requested?.inputs ?? {});
    setStrategySettings(requested?.strategySettings ?? {});
    setCatalogOrigin(sanitizePineCatalogProvenance(request.catalogOrigin ?? requested?.catalogOrigin));
    setHistoryRevision(null);
    setRunState({ detail: "", status: "idle" });
    setQuantSemanticsWarning(null);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, [request.nonce]);

  useEffect(() => {
    invalidateExecution();
    return () => { attemptRef.current += 1; runtimeCancelRef.current?.(); };
  }, [bars, sourceSnapshot, symbol, timeframe, pineLiveFeed, pineInstrument.key]);
  useEffect(() => {
    const onAuthChange = () => {
      if (currentOwner()) return;
      originalRecoveryRef.current?.controller.abort(); originalRecoveryRef.current = null;
      invalidateExecution(); setPrepared(null); closeRef.current();
    };
    const unsubscribe = subscribeAuthSession(onAuthChange);
    window.addEventListener("edgelab:auth-session-change", onAuthChange);
    return () => { unsubscribe(); window.removeEventListener("edgelab:auth-session-change", onAuthChange); };
  }, []);

  function selectScript(id: string) {
    const script = scripts.find((item) => item.id === id);
    if (!script) return;
    setSelectedId(script.id);
    changeSource(script.source, script.pinePrepared ?? null);
    setInputs(script.inputs);
    setStrategySettings(script.strategySettings ?? {});
    setCatalogOrigin(script.catalogOrigin);
    setHistoryRevision(null);
    setRunState({ detail: "", status: "idle" });
    setQuantSemanticsWarning(null);
  }

  async function recoverOriginal() {
    if (!catalogOrigin || !currentOwner()) return;
    originalRecoveryRef.current?.controller.abort();
    const pending = { controller: new AbortController(), draft: catalogDraftIdentity };
    originalRecoveryRef.current = pending;
    setOriginalRecovery({ busy: true, loaded: null, error: null });
    try {
      const loaded = await loadPineCatalogOriginal(catalogOrigin, pending.controller.signal);
      if (originalRecoveryRef.current === pending && catalogDraftRef.current === pending.draft && currentOwner() && !pending.controller.signal.aborted) {
        setOriginalRecovery({ busy: false, loaded, error: null });
      }
    } catch (cause) {
      if (originalRecoveryRef.current === pending && catalogDraftRef.current === pending.draft && currentOwner() && !pending.controller.signal.aborted) {
        setOriginalRecovery({ busy: false, loaded: null, error: `${cause instanceof Error ? cause.message : "The archived original could not be loaded."} Your draft is unchanged. Try again.` });
      }
    }
  }

  function keepOriginalDraft() {
    originalRecoveryRef.current?.controller.abort(); originalRecoveryRef.current = null;
    setOriginalRecovery({ busy: false, loaded: null, error: null });
    window.requestAnimationFrame(() => originalRecoveryButtonRef.current?.focus());
  }

  function openOriginalDraft() {
    const loaded = originalRecovery.loaded, pending = originalRecoveryRef.current;
    if (!loaded || !pending || pending.controller.signal.aborted || pending.draft !== catalogDraftRef.current || !currentOwner()) return;
    originalRecoveryRef.current = null;
    setSelectedId(""); changeSource(loaded.source); setInputs({}); setStrategySettings({}); setHistoryRevision(null);
    setCatalogOrigin(loaded.provenance);
    setCompletionOpen(false);
    setOriginalRecovery({ busy: false, loaded: null, error: null });
    setRunState({ detail: "Original source opened as an unsaved draft. Saved scripts and chart copies are unchanged.", status: "success" });
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  async function save(clearIncompatibleQuantSemantics = false, selectedInputs?: Record<string, EdgeIndicatorInputValue>) {
    if (!currentOwner()) return null;
    if (invalidEnumInput) { setRunState({ detail: "Choose valid Pine input options before saving.", status: "error" }); return null; }
    const attempt = attemptRef.current;
    const result = saveCustomIndicator(userScripts, {
      category: selectedScript?.category ?? "custom",
      color: selectedScript?.color ?? parsed.program?.plots[0]?.color ?? "#32d3ee",
      description: selectedScript?.description ?? (pine ? "Native Pine script." : "Custom EdgeLab DSL indicator."),
      id: selectedScript?.origin === "user" ? selectedScript.id : "",
      inputs: selectedInputs ?? (pine ? effectivePineInputs.inputs : inputs),
      strategySettings: pine ? strategySettings : undefined,
      name: currentPrepared?.name ?? parsed.program?.name ?? "Custom indicator",
      preview: selectedScript?.preview ?? ((currentPrepared?.overlay ?? parsed.program?.overlay) ? "trend" : "oscillator"),
      source,
      synonyms: selectedScript?.synonyms ?? [],
      quantSemantics: selectedScript?.quantSemantics,
      catalogOrigin,
    }, { clearIncompatibleQuantSemantics, pinePrepared: currentPrepared ?? undefined });
    if (result.quantSemanticsWarning) {
      setQuantSemanticsWarning(result.quantSemanticsWarning);
      setRunState({ detail: "Review the Quant label warning before saving.", status: "error" });
      return null;
    }
    if (!result.script) {
      setRunState({ detail: result.diagnostics[0]?.message ?? "Resolve compile diagnostics before saving.", status: "error" });
      return null;
    }
    try { await onScriptsChange(result.scripts); }
    catch (failure) {
      if (attempt === attemptRef.current && currentOwner()) setRunState({ detail: failure instanceof Error ? failure.message : "The script could not be saved. Try again.", status: "error" });
      return null;
    }
    if (attempt !== attemptRef.current || !currentOwner()) return null;
    setSelectedId(result.script.id);
    setCatalogOrigin(result.script.catalogOrigin);
    setHistoryRevision(null);
    setQuantSemanticsWarning(null);
    setRunState({ detail: `Saved revision ${result.script.revision} locally; server sync is queued.`, status: "success" });
    return result.script;
  }

  async function duplicate() {
    if (!currentOwner()) return;
    const attempt = attemptRef.current;
    const base = matchesSelected ? selectedScript : await save();
    if (!base) return;
    const copy = duplicateCustomIndicator(base);
    const baseScripts = base.origin === "user" ? [base, ...userScripts.filter((script) => script.id !== base.id)] : userScripts;
    try { await onScriptsChange([copy, ...baseScripts]); }
    catch (failure) { if (attempt === attemptRef.current && currentOwner()) setRunState({ detail: failure instanceof Error ? failure.message : "The copy could not be saved.", status: "error" }); return; }
    if (attempt !== attemptRef.current || !currentOwner()) return;
    setSelectedId(copy.id);
    changeSource(copy.source, copy.pinePrepared ?? null);
    setInputs(copy.inputs);
    setStrategySettings(copy.strategySettings ?? {});
    setCatalogOrigin(copy.catalogOrigin);
    setHistoryRevision(null);
  }

  async function remove() {
    if (!currentOwner()) return;
    if (!selectedScript || selectedScript.origin !== "user") return;
    if (!window.confirm(`Delete “${selectedScript.name}”? Version history for this script will also be removed.`)) return;
    const attempt = attemptRef.current;
    try { await onScriptsChange(userScripts.filter((script) => script.id !== selectedScript.id)); }
    catch (failure) { if (attempt === attemptRef.current && currentOwner()) setRunState({ detail: failure instanceof Error ? failure.message : "The script could not be deleted.", status: "error" }); return; }
    if (attempt !== attemptRef.current || !currentOwner()) return;
    setSelectedId("");
    changeSource(DEFAULT_EDGE_INDICATOR_SOURCE);
    setStrategySettings({});
    setInputs({});
    setCatalogOrigin(undefined);
    setHistoryRevision(null);
  }

  function importCatalog(script: PineCatalogImport) {
    if (!currentOwner()) return;
    setSelectedId("");
    changeSource(script.source);
    setStrategySettings({});
    setInputs({});
    setCatalogOrigin(sanitizePineCatalogProvenance(script.provenance));
    setHistoryRevision(null);
    setCompletionOpen(false);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function rename(value: string) {
    const safe = value.replace(/["\n\r]/g, " ").trimStart().slice(0, 80);
    changeSource(source.replace(/^indicator\s+"[^"]*"/m, `indicator "${safe}"`));
  }

  async function checkScript() {
    invalidateExecution();
    const attempt = attemptRef.current;
    const context = contextRef.current;
    const job = createPineRuntimeJob({ action: "prepare", source });
    runtimeCancelRef.current = job.cancel;
    setRunState({ detail: "Checking native Pine source…", status: "running" });
    try {
      const result = await job.promise;
      if (attempt !== attemptRef.current || !currentOwner() || !currentContext(context) || result.kind !== "prepare") return;
      runtimeCancelRef.current = null;
      const latest = inputStateRef.current;
      const migrated = migratePineEnumInputs(latest.prepared?.source === source ? latest.prepared : undefined, result, latest.inputs, latest.recovery);
      setPrepared(result); setInputRecovery(migrated.recovery);
      if (result.declaration !== "strategy") setStrategySettings({});
      setInputs(Object.fromEntries(result.inputDefinitions.flatMap((input) => {
        const value = migrated.inputs[input.id] ?? input.defval;
        return value === null ? [] : [[input.id, value]];
      })));
      setRunState({ detail: `Checked Pine v${result.pineVersion} ${result.declaration} · ${result.inputDefinitions.length} inputs. Ready to save or run.`, status: "success" });
    } catch (error) {
      if (attempt !== attemptRef.current || !currentOwner() || !currentContext(context)) return;
      runtimeCancelRef.current = null;
      setPrepared(null);
      setRunState({ detail: error instanceof Error ? error.message : "Pine compilation failed.", status: "error" });
    }
  }

  function run() {
    if (strategySettingsError) { setRunState({ detail: strategySettingsError, status: "error" }); return; }
    if (!pine && !parsed.program) {
      setRunState({ detail: "Resolve compile diagnostics before running.", status: "error" });
      return;
    }
    invalidateExecution();
    const attempt = attemptRef.current;
    const context = contextRef.current;
    let job: ReturnType<typeof createCustomScriptRuntimeJob>;
    try {
      if (pine && pineInstrument.loading) throw new Error("Instrument details are loading. Try Run again in a moment.");
      if (pine && pineInstrument.error) throw new Error(pineInstrument.error);
      const snapshot = bars.slice(-20_000);
      job = createCustomScriptRuntimeJob({ bars: snapshot, sourceSnapshot: pine && sourceSnapshot ? pineSourceSnapshotForChart(sourceSnapshot.bars, sourceSnapshot.timeframe, snapshot, timeframe) : undefined, inputs: pine ? effectivePineInputs.inputs : inputs, inputMetadata: pine && (currentPrepared ?? prepared)?.source === source ? currentPrepared ?? prepared ?? undefined : undefined, mode: "historical", source, context: pine ? pineInstrument.context : undefined, strategySettings: pine ? strategySettings : undefined,
        marketDataScope: pine ? pineMarketScopeForFeed(pineLiveFeed, snapshot, symbol, timeframe, `editor-${request.nonce}-${attempt}`,
          () => attempt === attemptRef.current && currentOwner() && currentContext(context)) : undefined });
    } catch (error) {
      setRunState({ detail: error instanceof Error ? error.message : "Script execution failed.", status: "error" }); return;
    }
    runtimeCancelRef.current = job.cancel;
    setRunState({ detail: `Executing ${Math.min(bars.length, 20_000).toLocaleString()} bars in the isolated worker…`, status: "running" });
    void job.promise.then((result) => {
      if (attempt !== attemptRef.current || !currentOwner() || !currentContext(context)) return;
      runtimeCancelRef.current = null;
      if ("kind" in result) {
        // Preparation must stay small; packed runtime output belongs only to execution.
        setPrepared({ kind: "prepare", source: result.source, language: result.language,
          pineVersion: result.pineVersion, declaration: result.declaration, name: result.name,
          overlay: result.overlay, behindChart: result.behindChart, inputDefinitions: result.inputDefinitions, diagnostics: result.diagnostics });
        executionOwnerRef.current = context;
        setExecution(result);
        if (result.declaration !== "strategy") setStrategySettings({});
        setInputs(result.inputs);
        setRunState({ detail: `${result.plots.length} plots${result.lines?.length ? ` · ${result.lines.length} line${result.lines.length === 1 ? "" : "s"}` : ""}${result.lineFills?.length ? ` · ${result.lineFills.length} line fill${result.lineFills.length === 1 ? "" : "s"}` : ""}${result.boxes?.length ? ` · ${result.boxes.length} box${result.boxes.length === 1 ? "" : "es"}` : ""}${result.labels?.length ? ` · ${result.labels.length} label${result.labels.length === 1 ? "" : "s"}` : ""}${result.polylines?.length ? ` · ${result.polylines.length} polyline${result.polylines.length === 1 ? "" : "s"}` : ""} · ${result.audit.bars.toLocaleString()} bars · PineTS ${result.audit.engineVersion}.`, status: "success" });
      } else {
        setRunState({ detail: `${result.plots.length} plot${result.plots.length === 1 ? "" : "s"} · ${result.audit.operations.toLocaleString()} deterministic operations.`, status: "success" });
      }
    }).catch((error) => {
      if (attempt !== attemptRef.current || !currentOwner() || !currentContext(context)) return;
      runtimeCancelRef.current = null;
      setRunState({ detail: error instanceof Error ? error.message : "Indicator execution failed.", status: "error" });
    });
  }

  async function addToChart() {
    if (!currentOwner() || !canSave || addPendingRef.current) return;
    if (pine && currentPrepared?.inputDefinitions.some(definition => definition.confirm
      && pineInputActive(definition, currentPrepared.inputDefinitions, effectivePineInputs.inputs))) {
      const next = { scope: confirmationScope, values: { ...effectivePineInputs.inputs }, error: null };
      confirmationRef.current = next;
      setConfirmation(next);
      return;
    }
    await applyToChart(pine ? effectivePineInputs.inputs : inputs);
  }

  async function applyToChart(appliedInputs: Record<string, EdgeIndicatorInputValue>) {
    if (!currentOwner() || !canSave || addPendingRef.current) return;
    addPendingRef.current = true;
    setAddingToChart(true);
    const attempt = attemptRef.current;
    try {
      const saved = selectedScript?.origin === "user" && matchesSelected
        && JSON.stringify(selectedScript.inputs) === JSON.stringify(appliedInputs) ? selectedScript : await save(false, appliedInputs);
      if (!saved || attempt !== attemptRef.current || !currentOwner()) return;
      onAddToChart({ ...saved, inputs: appliedInputs }, appliedInputs);
    } finally {
      addPendingRef.current = false;
      if (currentOwner()) setAddingToChart(false);
    }
  }

  function confirmationValid() {
    const draft = confirmationRef.current;
    if (!draft || draft.scope !== confirmationScopeRef.current || !currentOwner()) return false;
    const invalid = confirmationFieldsRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]:not([disabled])');
    if (invalid) {
      invalid.focus();
      const next = { ...draft, error: "Finish the highlighted input before continuing." };
      confirmationRef.current = next;
      setConfirmation(next);
      return false;
    }
    return true;
  }

  async function pickConfirmedInputs() {
    if (!confirmationValid() || !currentPrepared) return;
    const draft = confirmationRef.current!;
    const definitions = currentPrepared.inputDefinitions;
    const anchorIds = pineInputAnchors(definitions).filter(anchor => pineAnchorActive(anchor, definitions, draft.values)
      && definitions.some(definition => definition.confirm && (definition.id === anchor.priceId || definition.id === anchor.timeId))
      && (currentPrepared.overlay || anchor.kind === "time")).map(anchor => anchor.id);
    if (!anchorIds.length) return;
    pickerAbortRef.current?.abort();
    const controller = new AbortController();
    pickerAbortRef.current = controller;
    setChartPicking(true);
    try {
      const picked = await pickPineChartInputs({ symbol, timeframe, definitions, inputs: draft.values, anchorIds }, controller.signal);
      if (controller.signal.aborted || confirmationRef.current !== draft || draft.scope !== confirmationScopeRef.current || !currentOwner()) return;
      const next = { ...draft, values: picked ?? draft.values, error: picked ? null : "Selection cancelled. Your original inputs are still here." };
      confirmationRef.current = next;
      setConfirmation(next);
    } catch (cause) {
      if (controller.signal.aborted || confirmationRef.current !== draft || draft.scope !== confirmationScopeRef.current || !currentOwner()) return;
      const next = { ...draft, error: cause instanceof Error ? cause.message : "Chart picking is unavailable. You can enter inputs here." };
      confirmationRef.current = next;
      setConfirmation(next);
    } finally {
      if (pickerAbortRef.current === controller) {
        pickerAbortRef.current = null;
        setChartPicking(false);
      }
    }
  }

  async function addConfirmedInputs() {
    if (!confirmationValid()) return;
    const values = confirmationRef.current!.values;
    cancelConfirmation();
    invalidateExecution();
    setInputs(values);
    await applyToChart(values);
  }

  function insertCompletion(value: string) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const before = source.slice(0, start);
    const wordStart = before.search(/[A-Za-z_][A-Za-z0-9_]*$/);
    const replaceStart = wordStart < 0 ? start : wordStart;
    const next = source.slice(0, replaceStart) + value + source.slice(textarea.selectionEnd);
    changeSource(next);
    setCompletionOpen(false);
    const cursor = replaceStart + value.length;
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
    });
  }

  function editorKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Tab" || event.key === "Escape") {
      setCompletionOpen(false);
      return;
    }
    if (event.ctrlKey && event.key === " ") {
      event.preventDefault();
      setCompletionOpen(true);
      return;
    }
    if (!completionOpen) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setCompletionIndex((index) => completions.length === 0 ? 0 : (index + (event.key === "ArrowDown" ? 1 : -1) + completions.length) % completions.length);
    } else if (event.key === "Enter" && completions[completionIndex]) {
      event.preventDefault();
      insertCompletion(completions[completionIndex]);
    }
  }

  const history = selectedScript?.origin === "user"
    ? [...selectedScript.versions, { createdAt: selectedScript.updatedAt, revision: selectedScript.revision, source: selectedScript.source, catalogOrigin: selectedScript.catalogOrigin, strategySettings: selectedScript.strategySettings }]
    : [];

  return (
    <>
    <Dialog open={!confirmation && !chartPicking} label="EdgeLab indicator editor" onClose={onClose} className="flex h-[min(860px,calc(100dvh-24px))] !max-w-[1180px] flex-col overflow-hidden bg-[var(--ui-modal)]">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold text-white"><Code2 size={17} /> EdgeLab indicator editor</h2>
            <p className="mt-0.5 text-xs text-slate-300">EdgeLab DSL · native Pine v5 / v6 via PineTS</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <label className="sr-only" htmlFor="edge-new-template">New script template</label>
            <ThemedSelect
              ariaLabel="New script template"
              className="h-8 w-40 text-xs"
              id="edge-new-template"
              onChange={(value) => {
                const next = PINE_INDICATOR_STARTERS.find((starter) => starter.id === value)?.source
                  ?? (value === "pine-indicator" ? DEFAULT_PINE_INDICATOR_SOURCE : value === "pine-strategy" ? DEFAULT_PINE_STRATEGY_SOURCE : DEFAULT_EDGE_INDICATOR_SOURCE);
                setSelectedId(""); changeSource(next); setInputs({}); setStrategySettings({}); setHistoryRevision(null); setCatalogOrigin(undefined);
                setCompletionOpen(false);
                window.requestAnimationFrame(() => { if (currentOwner()) textareaRef.current?.focus(); });
              }}
              options={[
                { label: "New script…", value: "", disabled: true },
                { label: "EdgeLab DSL", value: "edge" },
                { label: "Pine indicator", value: "pine-indicator" },
                { label: "Pine strategy", value: "pine-strategy" },
                ...PINE_INDICATOR_STARTERS.map((starter) => ({ label: starter.name, value: starter.id, sublabel: "Pine indicators" })),
              ]}
              portal
              value=""
            />
            <button className="studio-tool-button" disabled={!canSave} onClick={duplicate} type="button"><Copy size={13} /> Duplicate</button>
            <button className="studio-tool-button" disabled={!selectedScript || selectedScript.origin !== "user"} onClick={remove} type="button"><Trash2 size={13} /> Delete</button>
            <button className="studio-tool-button" disabled={!canSave || runState.status === "running"} onClick={() => save()} type="button"><Save size={13} /> Save</button>
            <button className="studio-tool-button studio-tool-button-active" disabled={!canSave || addingToChart || runState.status === "running"} onClick={addToChart} type="button"><Plus size={13} /> {addingToChart ? "Adding…" : "Add to chart"}</button>
            <IconButton icon={X} label="Close indicator editor" onClick={onClose} />
          </div>
        </header>

        <div className="grid min-h-0 flex-1 auto-rows-max content-start grid-cols-[minmax(0,1fr)] overflow-y-auto lg:auto-rows-auto lg:content-stretch lg:grid-cols-[210px_minmax(0,1fr)_320px] lg:overflow-hidden">
          <aside className="min-h-0 min-w-0 border-b border-white/10 p-3 lg:overflow-y-auto lg:border-b-0 lg:border-r">
            <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-300" htmlFor="edge-script-library">Script library</label>
            <ThemedSelect
              ariaLabel="Script library"
              className="mt-2 h-9 w-full text-xs"
              id="edge-script-library"
              onChange={selectScript}
              options={[
                { label: "Unsaved draft", value: "" },
                ...scripts.filter((script) => script.origin === "first-party").map((script) => ({ label: script.name, value: script.id, sublabel: "First-party" })),
                ...userScripts.map((script) => ({ label: script.name + " · v" + script.revision, value: script.id, sublabel: "My scripts" })),
              ]}
              portal
              value={selectedId}
            />
            <label className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-300" htmlFor="edge-script-name">Name</label>
            <input className="input-control mt-2 h-9 w-full text-xs" id="edge-script-name" readOnly={pine} onChange={(event) => rename(event.target.value)} value={currentPrepared?.name ?? parsed.program?.name ?? ""} />
            {pine ? <p className="mt-1 text-[11px] leading-4 text-slate-300">Change the title in indicator() or strategy(), then check the script.</p> : null}
            {catalogOrigin ? <section aria-label="Catalog source attribution" className="mt-4 min-w-0 break-words text-xs leading-5 text-slate-300">
              <p className="font-semibold text-white">{originalCatalogSource ? "Unmodified original source" : unchangedMigration ? "Unchanged migrated draft" : catalogOrigin.migration ? "Edited from migrated base" : "Edited user copy"}</p>
              <p>{catalogOrigin.author} · {catalogOrigin.license}</p>
              <p>Original Pine v{catalogOrigin.originalPineVersion} · {pine ? draftPineVersion ? `Draft Pine v${draftPineVersion}` : "Draft version missing" : "EdgeLab DSL draft"}</p>
              <p>Upstream revision <span className="font-mono" title={catalogOrigin.upstreamCommit}>{catalogOrigin.upstreamCommit.slice(0, 8)}</span></p>
              <p>Base source hash <span className="font-mono" title={catalogOrigin.sourceSha256}>{catalogOrigin.sourceSha256.slice(0, 12)}</span></p>
              {catalogOrigin.migration ? <p>Migration v{catalogOrigin.migration.version} · hash <span className="font-mono" title={catalogOrigin.migration.sourceSha256}>{catalogOrigin.migration.sourceSha256.slice(0, 12)}</span></p> : null}
              <div className="mt-1 flex flex-wrap gap-x-3"><a className="inline-flex min-h-11 items-center text-cyan-200 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" href={catalogOrigin.originUrl} target="_blank" rel="noreferrer">Upstream source</a><a className="inline-flex min-h-11 items-center text-cyan-200 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" href={pineCatalogProvenanceLicenseUrl(catalogOrigin)} target="_blank" rel="noreferrer">GPL licence</a></div>
              <button className="studio-tool-button mt-2 min-h-11 w-full justify-center" disabled={originalRecovery.busy} onClick={() => void recoverOriginal()} ref={originalRecoveryButtonRef} type="button">{originalRecovery.busy ? "Loading original…" : "Recover original source"}</button>
              {originalRecovery.busy ? <div className="mt-2"><p role="status">Verifying the archived source for this revision…</p><button className="studio-tool-button mt-2 min-h-11" onClick={keepOriginalDraft} type="button">Cancel recovery</button></div> : null}
              {originalRecovery.error ? <p className="mt-2 text-[var(--loss-text)]" role="alert">{originalRecovery.error}</p> : null}
              {originalRecovery.loaded ? <div className="mt-3 space-y-3">
                <p>Review the archived original below. Opening it replaces your unsaved editor changes with a new draft. Your saved scripts and chart copies stay unchanged.</p>
                {catalogOrigin.originalPineVersion < 5 ? <p>Original Pine v{catalogOrigin.originalPineVersion} is preserved as written. It needs an explicit migration before it can run here.</p> : null}
                <pre aria-label="Archived original source" className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--ui-inset)] p-2 font-mono text-[11px] leading-5 text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]" tabIndex={0}>{originalRecovery.loaded.source}</pre>
                <div className="flex flex-wrap gap-2"><button className="studio-tool-button studio-tool-button-active min-h-11" onClick={openOriginalDraft} type="button">Open original as new draft</button><button className="studio-tool-button min-h-11" onClick={keepOriginalDraft} type="button">Keep my draft</button></div>
              </div> : null}
            </section> : null}
            <div className="mt-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-300"><History size={13} /> Version history</div>
            <ThemedSelect
              ariaLabel="Version history"
              className="mt-2 h-9 w-full text-xs"
              disabled={history.length === 0}
              onChange={(value) => { const version = history.find((item) => item.revision === Number(value)); if (version) { setHistoryRevision(version.revision); changeSource(version.source); setInputs({}); setStrategySettings(version.strategySettings ?? {}); setCatalogOrigin(version.catalogOrigin); } else if (selectedScript) { setHistoryRevision(null); changeSource(selectedScript.source, selectedScript.pinePrepared ?? null); setInputs(selectedScript.inputs); setStrategySettings(selectedScript.strategySettings ?? {}); setCatalogOrigin(selectedScript.catalogOrigin); } }}
              options={[
                { label: "Current source", value: "" },
                ...[...history].reverse().map((version) => ({ label: "v" + version.revision + " · " + new Date(version.createdAt).toLocaleDateString(), value: String(version.revision) })),
              ]}
              portal
              value={historyRevision == null ? "" : String(historyRevision)}
            />
            <PineCatalogBrowser onImport={importCatalog} draftIdentity={catalogDraftIdentity} />
            <p className="mt-3 text-[11px] leading-5 text-slate-300">Catalog execution is experimental. Supported lines, fills and shapes render on the chart; unavailable drawing outputs and options produce visible warnings. Results may differ from TradingView.</p>
            <details className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3 text-xs leading-5 text-slate-400">
              <summary className="cursor-pointer font-semibold text-slate-200">Language reference</summary>
              {pine ? <div className="mt-3 space-y-2 text-slate-300"><p>Paste a native script with //@version=5 or 6. Check source to generate settings; run to calculate plots or the strategy’s own orders.</p><p>Scripts can use loaded intrabar candles and higher timeframes built from this chart’s data. Other symbols and unavailable timeframes cannot be requested. Script lines support updates, copying, deletion and pane placement. Line fills shade the shared region between two lines. Boxes support filled zones, borders and text. Other unavailable drawing outputs produce warnings.</p><p>PineTS is experimental and independently developed. Results may differ from TradingView.</p><p><a className="text-cyan-200 underline underline-offset-4" href="/LICENSE.txt" target="_blank" rel="noreferrer">AGPL licence</a> · <a className="text-cyan-200 underline underline-offset-4" href="/source/" target="_blank" rel="noreferrer">Download source</a> · <a className="text-cyan-200 underline underline-offset-4" href="/THIRD_PARTY_NOTICES.txt" target="_blank" rel="noreferrer">Third-party notices</a></p></div> : <pre className="mt-3 whitespace-pre-wrap font-mono text-[11px] leading-5">{EDGE_INDICATOR_DSL_REFERENCE}</pre>}
              <p className="mt-3 text-slate-300">For TradingView built-ins, use Pine Editor → Open → Built-in script. <a className="inline-flex min-h-11 items-center text-cyan-200 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" href="https://www.tradingview.com/support/solutions/43000481659-i-want-to-see-the-source-code-of-a-built-in-script/" target="_blank" rel="noreferrer">TradingView source access guide</a>. Official source and redistribution rights are not verified for this catalog; official originals are not packaged here.</p>
            </details>
          </aside>

          <main className="flex min-h-[360px] min-w-0 flex-col border-b border-white/10 lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-xs text-slate-400">
              <span>{pine ? `${currentPrepared?.declaration ?? "script"}.pine` : "indicator.edge"}</span>
              <span>{new TextEncoder().encode(source).length.toLocaleString()} / 20,000 bytes</span>
            </div>
            <div className="relative min-h-0 flex-1 overflow-hidden bg-[#05080c]">
              <pre aria-hidden="true" ref={highlightRef} className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words p-4 font-mono text-[12px] leading-6 text-slate-200">{highlightSource(source)}{"\n"}</pre>
              <textarea aria-label="EdgeLab indicator source" aria-describedby="edge-editor-diagnostics" className="absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent p-4 font-mono text-[12px] leading-6 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300/60" onChange={(event) => { changeSource(event.target.value); if (isPineScriptSource(event.target.value)) setInputs({}); setCompletionOpen(true); setCompletionIndex(0); }} onScroll={(event) => { if (highlightRef.current) { highlightRef.current.scrollTop = event.currentTarget.scrollTop; highlightRef.current.scrollLeft = event.currentTarget.scrollLeft; } }} onKeyDown={editorKeyDown} ref={textareaRef} spellCheck={false} style={{ caretColor: "#e2e8f0", color: "transparent", WebkitTextFillColor: "transparent" }} value={source} />
              {completionOpen && completions.length > 0 ? (
                <div className="absolute bottom-3 left-3 z-10 max-h-48 w-56 overflow-y-auto rounded-lg border border-white/10 bg-[#0b1118] p-1 shadow-[0_16px_38px_rgba(0,0,0,0.5)]" role="listbox">
                  {completions.map((item, index) => <button aria-selected={index === completionIndex} className={`block w-full rounded px-2 py-1.5 text-left font-mono text-xs ${index === completionIndex ? "bg-cyan-300/10 text-cyan-100" : "text-slate-300 hover:bg-white/5"}`} key={item} onMouseDown={(event) => event.preventDefault()} onClick={() => insertCompletion(item)} role="option" type="button">{item}</button>)}
                </div>
              ) : null}
            </div>
          </main>

          <aside className="min-h-0 min-w-0 p-3 lg:overflow-y-auto">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-white">Diagnostics</h3>
              <div className="flex flex-wrap gap-1">
              {pine ? <button className="studio-tool-button" disabled={runState.status === "running"} onClick={() => void checkScript()} type="button">Check script</button> : null}
              <button className="studio-tool-button" disabled={runState.status !== "running" && (Boolean(strategySettingsError) || (pine && pineInstrument.loading))} onClick={runState.status === "running" ? () => { invalidateExecution(); setRunState({ detail: "Execution cancelled.", status: "idle" }); } : run} type="button">
                {runState.status === "running" ? <Square size={12} /> : <Play size={12} />}{runState.status === "running" ? "Cancel" : "Run"}
              </button>
              </div>
            </div>
            <div className="mt-3 grid gap-2" id="edge-editor-diagnostics">
              {pine && !currentPrepared ? <p className="text-xs leading-5 text-slate-300">Check the script to generate settings and enable saving. Run uses {symbol} · {timeframe}, up to 20,000 loaded bars.</p> : diagnostics.length === 0 ? <p className="flex items-center gap-2 rounded-md bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200"><CheckCircle2 size={14} /> Ready to execute in the isolated worker.</p> : diagnostics.map((item, index) => <button className={`flex gap-2 rounded-md px-3 py-2 text-left text-xs leading-5 ${item.severity === "warning" ? "bg-amber-300/10 text-amber-100" : "bg-rose-400/10 text-rose-200"}`} key={`${item.code}-${item.line}-${index}`} onClick={() => { const lineStart = source.split("\n").slice(0, item.line - 1).join("\n").length + (item.line > 1 ? 1 : 0); textareaRef.current?.focus(); textareaRef.current?.setSelectionRange(lineStart + item.column - 1, lineStart + item.column - 1); }} type="button"><AlertTriangle className="mt-0.5 shrink-0" size={13} /><span>Line {item.line}: {item.message}</span></button>)}
              {quantSemanticsWarning ? <div className="rounded-md border border-amber-300/20 bg-amber-300/[0.06] p-3 text-xs leading-5 text-amber-100" role="alert"><p>{quantSemanticsWarning}</p><button className="studio-tool-button mt-2" onClick={() => save(true)} type="button">Clear Quant labels and save</button></div> : null}
              {runState.detail ? <p aria-live="polite" className={`rounded-md px-3 py-2 text-xs leading-5 ${runState.status === "error" ? "bg-rose-400/10 text-rose-200" : runState.status === "success" ? "bg-emerald-400/10 text-emerald-200" : "bg-white/5 text-slate-300"}`}>{runState.detail}</p> : null}
            </div>
            <h3 className="mt-5 text-sm font-semibold text-white">Generated settings</h3>
            <div className="mt-2 grid gap-3">
              {pine ? currentPrepared?.inputDefinitions.map((input) => <PineInputControl scopeKey={`${selectedId}:${source}`} definitions={currentPrepared.inputDefinitions} inputs={effectivePineInputs.inputs} definition={input} key={input.id} onChange={(value) => changeInput(input.id, value)} value={effectivePineInputs.inputs[input.id]} recoveryLabel={effectivePineInputs.recovery[input.id]} />) ?? <p className="text-xs leading-5 text-slate-300">Declared Pine inputs appear after checking the script.</p> : parsed.program?.inputs.map((input) => <GeneratedInput definition={input} key={`${selectedId}:${source}:${input.name}`} onChange={(value) => changeInput(input.name, value)} value={inputs[input.name] ?? input.defaultValue} />) ?? <p className="text-xs leading-5 text-slate-300">Valid input declarations appear here.</p>}
            </div>
            {currentPrepared?.declaration === "strategy" ? <PineStrategySettingsControl value={strategySettings} onChange={changeStrategySettings} error={strategySettingsError} /> : null}
            {execution?.strategy && executionOwnerRef.current && currentContext(executionOwnerRef.current) ? <PineStrategyResults result={execution} /> : null}
            <p className="mt-5 text-[11px] leading-5 text-slate-300">Ctrl+Space opens completion. Tab moves between controls. Scripts execute without network, storage or page access.</p>
          </aside>
        </div>
    </Dialog>
    <Dialog open={Boolean(confirmation) && !chartPicking} label="Confirm indicator inputs" onClose={cancelConfirmation} className="!max-w-xl p-5">
      <h2 className="text-xl font-semibold text-[var(--text-primary)]">Set up {currentPrepared?.name ?? "your indicator"}</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">Review these inputs before adding the script. Chart selections stay a draft until you add it.</p>
      <div ref={confirmationFieldsRef} className="my-5 grid gap-4">
        {currentPrepared?.inputDefinitions.filter(definition => definition.confirm || pineInputAnchors(currentPrepared.inputDefinitions).some(anchor =>
          (anchor.priceId === definition.id || anchor.timeId === definition.id) && currentPrepared.inputDefinitions.some(member => member.confirm
            && (member.id === anchor.priceId || member.id === anchor.timeId)))).map(definition => <PineInputControl key={definition.id}
              definition={definition} definitions={currentPrepared.inputDefinitions} inputs={confirmation?.values ?? {}} value={confirmation?.values[definition.id]}
              scopeKey={`${selectedId}:${source}:confirm`} onChange={value => {
                const draft = confirmationRef.current;
                if (!draft || draft.scope !== confirmationScopeRef.current || !currentOwner()) return;
                const next = { ...draft, values: { ...draft.values, [definition.id]: value }, error: null };
                confirmationRef.current = next;
                setConfirmation(next);
              }} />)}
      </div>
      {currentPrepared?.overlay === false && currentPrepared.inputDefinitions.some(definition => definition.type === "price" && definition.confirm)
        && <p className="mb-4 text-xs leading-5 text-[var(--text-secondary)]">Enter the price here first. After adding, move its marker in the indicator pane.</p>}
      {confirmation?.error && <p role="alert" className="mb-4 text-sm text-[var(--loss-text)]">{confirmation.error}</p>}
      <div className="flex flex-wrap gap-2">
        {currentPrepared && pineInputAnchors(currentPrepared.inputDefinitions).some(anchor => pineAnchorActive(anchor, currentPrepared.inputDefinitions, confirmation?.values ?? {})
          && (currentPrepared.overlay || anchor.kind === "time") && currentPrepared.inputDefinitions.some(definition => definition.confirm
            && (definition.id === anchor.priceId || definition.id === anchor.timeId)))
          && <button className="studio-tool-button min-h-11" onClick={() => void pickConfirmedInputs()} type="button">Pick on chart</button>}
        <button className="studio-tool-button studio-tool-button-active min-h-11" onClick={() => void addConfirmedInputs()} type="button">Add with these inputs</button>
        <button className="studio-tool-button min-h-11" onClick={cancelConfirmation} type="button">Cancel</button>
      </div>
    </Dialog>
    </>
  );
}

function GeneratedInput({ definition, onChange, value }: { definition: NonNullable<ReturnType<typeof parseEdgeIndicator>["program"]>["inputs"][number]; onChange: (value: EdgeIndicatorInputValue) => void; value: EdgeIndicatorInputValue }) {
  return <label className="grid gap-1 text-xs text-slate-400"><span>{definition.name}</span>{definition.type === "boolean" ? <input checked={Boolean(value)} className="h-4 w-4 accent-cyan-300" onChange={(event) => onChange(event.target.checked)} type="checkbox" /> : definition.type === "source" ? <ThemedSelect ariaLabel={definition.name} className="h-9 text-xs" onChange={onChange} options={["open", "high", "low", "close", "volume", "hl2", "hlc3", "ohlc4"].map((source) => ({ label: source, value: source }))} portal value={String(value)} /> : <NumericDraftInput label={definition.name} className="input-control h-9 text-xs" max={definition.max} min={definition.min} onChange={onChange} value={value} resetKey={JSON.stringify(definition)} />}</label>;
}

function highlightSource(source: string) {
  const pattern = /(\/\/.*$|"[^"]*"|#[0-9a-fA-F]{6}\b|\b(?:indicator|input|plot|overlay|pane|number|boolean|source|min|max)\b|\b(?:sma|ema|wma|highest|lowest|change|roc|rsi|atr|stdev|linreg|cci|adx|obv|mfi|cmf|force_index|histvol|choppiness|abs)\b|\b\d+(?:\.\d+)?\b)/gm;
  return source.split(pattern).map((token, index) => {
    const className = token.startsWith("//") ? "text-slate-400" : token.startsWith('"') ? "text-amber-200" : token.startsWith("#") ? "text-rose-300" : /^\d/.test(token) ? "text-amber-200" : /^(indicator|input|plot|overlay|pane|number|boolean|source|min|max)$/.test(token) ? "text-cyan-300" : /\w+/.test(token) ? "text-emerald-300" : "";
    return <span className={className} key={index}>{token}</span>;
  });
}
