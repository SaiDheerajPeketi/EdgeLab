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
  pineContextForChart,
  saveCustomIndicator,
  type CustomIndicatorScript,
} from "../lib/customIndicators";
import {
  EDGE_INDICATOR_DSL_REFERENCE,
  parseEdgeIndicator,
  type EdgeIndicatorInputValue,
} from "../lib/indicatorDsl";
import { createCustomScriptRuntimeJob } from "../lib/customScriptRuntime";
import { createPineRuntimeJob } from "../lib/pineRuntime";
import type { PineExecutionResult, PinePrepareResult } from "../lib/pineProtocol";
import { sanitizePineCatalogProvenance, type PineCatalogImport, type PineCatalogProvenance } from "../lib/pineCatalog";
import { sourceSha256 } from "../lib/sourceSha256";
import { PineCatalogBrowser } from "./PineCatalogBrowser";
import { PineInputControl } from "./PineInputControl";
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
  symbol: string;
  timeframe: string;
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
  symbol,
  timeframe,
  onAddToChart,
  onClose,
  onScriptsChange,
  request,
  scripts,
}: Props) {
  const [selectedId, setSelectedId] = useState("");
  const [source, setSource] = useState(DEFAULT_EDGE_INDICATOR_SOURCE);
  const [inputs, setInputs] = useState<Record<string, EdgeIndicatorInputValue>>({});
  const [completionOpen, setCompletionOpen] = useState(false);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [runState, setRunState] = useState<{ detail: string; status: "idle" | "running" | "success" | "error" }>({ detail: "", status: "idle" });
  const [historyRevision, setHistoryRevision] = useState<number | null>(null);
  const [catalogOrigin, setCatalogOrigin] = useState<PineCatalogProvenance | undefined>();
  const [quantSemanticsWarning, setQuantSemanticsWarning] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PinePrepareResult | null>(null);
  const [execution, setExecution] = useState<PineExecutionResult | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const runtimeCancelRef = useRef<(() => void) | null>(null);
  const attemptRef = useRef(0);
  const ownerRef = useRef({ id: getStoredAuthSession()?.user.id ?? null, token: getApiBearerToken() });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const contextRef = useRef({ bars, symbol, timeframe, nonce: request.nonce });
  contextRef.current = { bars, symbol, timeframe, nonce: request.nonce };
  const userScripts = scripts.filter((script) => script.origin === "user");
  const selectedScript = scripts.find((script) => script.id === selectedId) ?? null;
  const pine = isPineScriptSource(source);
  const matchesSelected = Boolean(selectedScript && selectedScript.source === source
    && JSON.stringify(selectedScript.inputs) === JSON.stringify(inputs)
    && JSON.stringify(selectedScript.catalogOrigin) === JSON.stringify(catalogOrigin));
  const originalCatalogSource = useMemo(() => Boolean(catalogOrigin && sourceSha256(source) === catalogOrigin.sourceSha256), [source, catalogOrigin?.sourceSha256]);
  const draftPineVersion = source.match(/^[ \t\uFEFF]*\/\/@version=(\d+)/m)?.[1];
  const parsed = useMemo(() => parseEdgeIndicator(pine ? "" : source), [pine, source]);
  const currentPrepared = prepared?.source === source ? prepared : null;
  const canSave = pine ? Boolean(currentPrepared) : Boolean(parsed.program);
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
    return current.bars === snapshot.bars && current.symbol === snapshot.symbol
      && current.timeframe === snapshot.timeframe && current.nonce === snapshot.nonce;
  }

  function changeSource(next: string, metadata: PinePrepareResult | null = null) {
    invalidateExecution();
    setSource(next);
    setPrepared(metadata?.source === next ? metadata : null);
    setQuantSemanticsWarning(null);
  }

  function changeInput(key: string, value: EdgeIndicatorInputValue) {
    invalidateExecution();
    setInputs((current) => ({ ...current, [key]: value }));
  }

  useEffect(() => {
    const requested = request.scriptId ? scripts.find((script) => script.id === request.scriptId) : null;
    setSelectedId(requested?.id ?? "");
    changeSource(request.source ?? requested?.source ?? DEFAULT_EDGE_INDICATOR_SOURCE, requested?.pinePrepared ?? null);
    setInputs(requested?.inputs ?? {});
    setCatalogOrigin(sanitizePineCatalogProvenance(request.catalogOrigin ?? requested?.catalogOrigin));
    setHistoryRevision(null);
    setRunState({ detail: "", status: "idle" });
    setQuantSemanticsWarning(null);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, [request.nonce]);

  useEffect(() => {
    invalidateExecution();
    return () => { attemptRef.current += 1; runtimeCancelRef.current?.(); };
  }, [bars, symbol, timeframe]);
  useEffect(() => {
    const onAuthChange = () => {
      if (currentOwner()) return;
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
    setCatalogOrigin(script.catalogOrigin);
    setHistoryRevision(null);
    setRunState({ detail: "", status: "idle" });
    setQuantSemanticsWarning(null);
  }

  async function save(clearIncompatibleQuantSemantics = false) {
    if (!currentOwner()) return null;
    const attempt = attemptRef.current;
    const result = saveCustomIndicator(userScripts, {
      category: selectedScript?.category ?? "custom",
      color: selectedScript?.color ?? parsed.program?.plots[0]?.color ?? "#32d3ee",
      description: selectedScript?.description ?? (pine ? "Native Pine script." : "Custom EdgeLab DSL indicator."),
      id: selectedScript?.origin === "user" ? selectedScript.id : "",
      inputs,
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
    setInputs({});
    setCatalogOrigin(undefined);
    setHistoryRevision(null);
  }

  function importCatalog(script: PineCatalogImport) {
    if (!currentOwner()) return;
    setSelectedId("");
    changeSource(script.source);
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
      setPrepared(result);
      setInputs((current) => Object.fromEntries(result.inputDefinitions.flatMap((input) => {
        const value = current[input.id] ?? input.defval;
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
    if (!pine && !parsed.program) {
      setRunState({ detail: "Resolve compile diagnostics before running.", status: "error" });
      return;
    }
    invalidateExecution();
    const attempt = attemptRef.current;
    const context = contextRef.current;
    let job: ReturnType<typeof createCustomScriptRuntimeJob>;
    try {
      job = createCustomScriptRuntimeJob({ bars: bars.slice(-20_000), inputs, mode: "historical", source, context: pine ? pineContextForChart(symbol, timeframe) : undefined });
    } catch (error) {
      setRunState({ detail: error instanceof Error ? error.message : "Script execution failed.", status: "error" }); return;
    }
    runtimeCancelRef.current = job.cancel;
    setRunState({ detail: `Executing ${Math.min(bars.length, 20_000).toLocaleString()} bars in the isolated worker…`, status: "running" });
    void job.promise.then((result) => {
      if (attempt !== attemptRef.current || !currentOwner() || !currentContext(context)) return;
      runtimeCancelRef.current = null;
      if ("kind" in result) {
        setPrepared({ ...result, kind: "prepare" });
        setExecution(result);
        setInputs(result.inputs);
        setRunState({ detail: `${result.plots.length} plots · ${result.audit.bars.toLocaleString()} bars · PineTS ${result.audit.engineVersion}.`, status: "success" });
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
    if (!currentOwner()) return;
    const saved = selectedScript?.origin === "user" && matchesSelected ? selectedScript : await save();
    if (!saved || !canSave) return;
    onAddToChart({ ...saved, inputs }, inputs);
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
    ? [...selectedScript.versions, { createdAt: selectedScript.updatedAt, revision: selectedScript.revision, source: selectedScript.source, catalogOrigin: selectedScript.catalogOrigin }]
    : [];

  return (
    <Dialog open label="EdgeLab indicator editor" onClose={onClose} className="flex h-[min(860px,calc(100dvh-24px))] !max-w-[1180px] flex-col overflow-hidden bg-[var(--ui-modal)]">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold text-white"><Code2 size={17} /> EdgeLab indicator editor</h2>
            <p className="mt-0.5 text-xs text-slate-300">EdgeLab DSL · native Pine v5 / v6 via PineTS</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <label className="sr-only" htmlFor="edge-new-template">New script template</label>
            <select className="input-control h-8 max-w-40 text-xs" id="edge-new-template" value="" onChange={(event) => {
              const next = event.target.value === "pine-indicator" ? DEFAULT_PINE_INDICATOR_SOURCE : event.target.value === "pine-strategy" ? DEFAULT_PINE_STRATEGY_SOURCE : DEFAULT_EDGE_INDICATOR_SOURCE;
              setSelectedId(""); changeSource(next); setInputs({}); setHistoryRevision(null); setCatalogOrigin(undefined);
            }}><option value="" disabled>New script…</option><option value="edge">EdgeLab DSL</option><option value="pine-indicator">Pine indicator</option><option value="pine-strategy">Pine strategy</option></select>
            <button className="studio-tool-button" disabled={!canSave} onClick={duplicate} type="button"><Copy size={13} /> Duplicate</button>
            <button className="studio-tool-button" disabled={!selectedScript || selectedScript.origin !== "user"} onClick={remove} type="button"><Trash2 size={13} /> Delete</button>
            <button className="studio-tool-button" disabled={!canSave || runState.status === "running"} onClick={() => save()} type="button"><Save size={13} /> Save</button>
            <button className="studio-tool-button studio-tool-button-active" disabled={!canSave || runState.status === "running"} onClick={addToChart} type="button"><Plus size={13} /> Add to chart</button>
            <IconButton icon={X} label="Close indicator editor" onClick={onClose} />
          </div>
        </header>

        <div className="grid min-h-0 flex-1 auto-rows-max content-start grid-cols-[minmax(0,1fr)] overflow-y-auto lg:auto-rows-auto lg:content-stretch lg:grid-cols-[210px_minmax(0,1fr)_320px] lg:overflow-hidden">
          <aside className="min-h-0 min-w-0 border-b border-white/10 p-3 lg:overflow-y-auto lg:border-b-0 lg:border-r">
            <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-300" htmlFor="edge-script-library">Script library</label>
            <select className="input-control mt-2 h-9 w-full text-xs" id="edge-script-library" onChange={(event) => selectScript(event.target.value)} value={selectedId}>
              <option value="">Unsaved draft</option>
              <optgroup label="First-party">
                {scripts.filter((script) => script.origin === "first-party").map((script) => <option key={script.id} value={script.id}>{script.name}</option>)}
              </optgroup>
              <optgroup label="My scripts">
                {userScripts.map((script) => <option key={script.id} value={script.id}>{script.name} · v{script.revision}</option>)}
              </optgroup>
            </select>
            <label className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-300" htmlFor="edge-script-name">Name</label>
            <input className="input-control mt-2 h-9 w-full text-xs" id="edge-script-name" readOnly={pine} onChange={(event) => rename(event.target.value)} value={currentPrepared?.name ?? parsed.program?.name ?? ""} />
            {pine ? <p className="mt-1 text-[11px] leading-4 text-slate-300">Change the title in indicator() or strategy(), then check the script.</p> : null}
            {catalogOrigin ? <section aria-label="Catalog source attribution" className="mt-4 min-w-0 break-words text-xs leading-5 text-slate-300">
              <p className="font-semibold text-white">{originalCatalogSource ? "Unmodified original source" : "Edited user copy"}</p>
              <p>{catalogOrigin.author} · {catalogOrigin.license}</p>
              <p>Original Pine v{catalogOrigin.originalPineVersion} · {pine ? draftPineVersion ? `Draft Pine v${draftPineVersion}` : "Draft version missing" : "EdgeLab DSL draft"}</p>
              <p>Upstream revision <span className="font-mono" title={catalogOrigin.upstreamCommit}>{catalogOrigin.upstreamCommit.slice(0, 8)}</span></p>
              <p>Base source hash <span className="font-mono" title={catalogOrigin.sourceSha256}>{catalogOrigin.sourceSha256.slice(0, 12)}</span></p>
              <div className="mt-1 flex flex-wrap gap-x-3"><a className="inline-flex min-h-11 items-center text-cyan-200 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" href={catalogOrigin.originUrl} target="_blank" rel="noreferrer">Upstream source</a><a className="inline-flex min-h-11 items-center text-cyan-200 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" href={`/catalog/pine/everget/${catalogOrigin.upstreamCommit}/LICENSE.txt`} target="_blank" rel="noreferrer">GPL licence</a></div>
            </section> : null}
            <div className="mt-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-300"><History size={13} /> Version history</div>
            <select aria-label="Version history" className="input-control mt-2 h-9 w-full text-xs" disabled={history.length === 0} onChange={(event) => { const version = history.find((item) => item.revision === Number(event.target.value)); if (version) { setHistoryRevision(version.revision); changeSource(version.source); setInputs({}); setCatalogOrigin(version.catalogOrigin); } else if (selectedScript) { setHistoryRevision(null); changeSource(selectedScript.source, selectedScript.pinePrepared ?? null); setInputs(selectedScript.inputs); setCatalogOrigin(selectedScript.catalogOrigin); } }} value={historyRevision ?? ""}>
              <option value="">Current source</option>
              {[...history].reverse().map((version) => <option key={`${version.revision}-${version.createdAt}`} value={version.revision}>v{version.revision} · {new Date(version.createdAt).toLocaleDateString()}</option>)}
            </select>
            <PineCatalogBrowser onImport={importCatalog} />
            <p className="mt-3 text-[11px] leading-5 text-slate-300">Catalog execution is experimental. Current plot limits can reject scripts; fills and some shapes are omitted with chart warnings.</p>
            <details className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3 text-xs leading-5 text-slate-400">
              <summary className="cursor-pointer font-semibold text-slate-200">Language reference</summary>
              {pine ? <div className="mt-3 space-y-2 text-slate-300"><p>Paste a native script with //@version=5 or 6. Check source to generate settings; run to calculate plots or the strategy’s own orders.</p><p>Only the loaded symbol and timeframe are available. Secondary data requests fail explicitly. Some drawing outputs are unavailable and produce warnings.</p><p>PineTS is experimental and independently developed. Results may differ from TradingView.</p><p><a className="text-cyan-200 underline underline-offset-4" href="/LICENSE.txt" target="_blank" rel="noreferrer">AGPL licence</a> · <a className="text-cyan-200 underline underline-offset-4" href="/THIRD_PARTY_NOTICES.txt" target="_blank" rel="noreferrer">Source and notices</a></p></div> : <pre className="mt-3 whitespace-pre-wrap font-mono text-[11px] leading-5">{EDGE_INDICATOR_DSL_REFERENCE}</pre>}
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
              <button className="studio-tool-button" onClick={runState.status === "running" ? () => { invalidateExecution(); setRunState({ detail: "Execution cancelled.", status: "idle" }); } : run} type="button">
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
              {pine ? currentPrepared?.inputDefinitions.map((input) => <PineInputControl definition={input} key={input.id} onChange={(value) => changeInput(input.id, value)} value={inputs[input.id]} />) ?? <p className="text-xs leading-5 text-slate-300">Declared Pine inputs appear after checking the script.</p> : parsed.program?.inputs.map((input) => <GeneratedInput definition={input} key={input.name} onChange={(value) => changeInput(input.name, value)} value={inputs[input.name] ?? input.defaultValue} />) ?? <p className="text-xs leading-5 text-slate-300">Valid input declarations appear here.</p>}
            </div>
            {execution?.strategy ? <PineStrategyResults result={execution} /> : null}
            <p className="mt-5 text-[11px] leading-5 text-slate-300">Ctrl+Space opens completion. Tab moves between controls. Scripts execute without network, storage or page access.</p>
          </aside>
        </div>
    </Dialog>
  );
}

function GeneratedInput({ definition, onChange, value }: { definition: NonNullable<ReturnType<typeof parseEdgeIndicator>["program"]>["inputs"][number]; onChange: (value: EdgeIndicatorInputValue) => void; value: EdgeIndicatorInputValue }) {
  return <label className="grid gap-1 text-xs text-slate-400"><span>{definition.name}</span>{definition.type === "boolean" ? <input checked={Boolean(value)} className="h-4 w-4 accent-cyan-300" onChange={(event) => onChange(event.target.checked)} type="checkbox" /> : definition.type === "source" ? <select className="input-control h-9 text-xs" onChange={(event) => onChange(event.target.value)} value={String(value)}>{["open", "high", "low", "close", "volume", "hl2", "hlc3", "ohlc4"].map((source) => <option key={source} value={source}>{source}</option>)}</select> : <input className="input-control h-9 text-xs" max={definition.max} min={definition.min} onChange={(event) => onChange(Number(event.target.value))} type="number" value={Number(value)} />}</label>;
}

function highlightSource(source: string) {
  const pattern = /(\/\/.*$|"[^"]*"|#[0-9a-fA-F]{6}\b|\b(?:indicator|input|plot|overlay|pane|number|boolean|source|min|max)\b|\b(?:sma|ema|wma|highest|lowest|change|roc|rsi|atr|stdev|linreg|cci|adx|obv|mfi|cmf|force_index|histvol|choppiness|abs)\b|\b\d+(?:\.\d+)?\b)/gm;
  return source.split(pattern).map((token, index) => {
    const className = token.startsWith("//") ? "text-slate-400" : token.startsWith('"') ? "text-amber-200" : token.startsWith("#") ? "text-rose-300" : /^\d/.test(token) ? "text-amber-200" : /^(indicator|input|plot|overlay|pane|number|boolean|source|min|max)$/.test(token) ? "text-cyan-300" : /\w+/.test(token) ? "text-emerald-300" : "";
    return <span className={className} key={index}>{token}</span>;
  });
}
