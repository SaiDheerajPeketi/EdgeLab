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
import {
  DEFAULT_EDGE_INDICATOR_SOURCE,
  duplicateCustomIndicator,
  saveCustomIndicator,
  type CustomIndicatorScript,
} from "../lib/customIndicators";
import {
  EDGE_INDICATOR_DSL_REFERENCE,
  parseEdgeIndicator,
  type EdgeIndicatorInputValue,
} from "../lib/indicatorDsl";
import { createIndicatorRuntimeJob } from "../lib/indicatorRuntime";
import { Dialog, IconButton } from "./ui/Primitives";

type EditorRequest = {
  nonce: number;
  scriptId?: string;
  source?: string;
};

type Props = {
  bars: Candle[];
  onAddToChart: (script: CustomIndicatorScript, inputs: Record<string, EdgeIndicatorInputValue>) => void;
  onClose: () => void;
  onScriptsChange: (scripts: CustomIndicatorScript[]) => void;
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

export function IndicatorEditorPanel({
  bars,
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
  const [revisionSource, setRevisionSource] = useState("");
  const [quantSemanticsWarning, setQuantSemanticsWarning] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const runtimeCancelRef = useRef<(() => void) | null>(null);
  const userScripts = scripts.filter((script) => script.origin === "user");
  const selectedScript = scripts.find((script) => script.id === selectedId) ?? null;
  const parsed = useMemo(() => parseEdgeIndicator(source), [source]);
  const currentWord = source.slice(0, textareaRef.current?.selectionStart ?? source.length).match(/[A-Za-z_][A-Za-z0-9_]*$/)?.[0]?.toLowerCase() ?? "";
  const completions = COMPLETIONS.filter((item) => !currentWord || item.toLowerCase().startsWith(currentWord)).slice(0, 12);

  useEffect(() => {
    const requested = request.scriptId ? scripts.find((script) => script.id === request.scriptId) : null;
    setSelectedId(requested?.id ?? "");
    setSource(request.source ?? requested?.source ?? DEFAULT_EDGE_INDICATOR_SOURCE);
    setInputs(requested?.inputs ?? {});
    setRunState({ detail: "", status: "idle" });
    setQuantSemanticsWarning(null);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, [request.nonce]);

  useEffect(() => () => runtimeCancelRef.current?.(), []);

  function selectScript(id: string) {
    const script = scripts.find((item) => item.id === id);
    if (!script) return;
    setSelectedId(script.id);
    setSource(script.source);
    setInputs(script.inputs);
    setRevisionSource("");
    setRunState({ detail: "", status: "idle" });
    setQuantSemanticsWarning(null);
  }

  function save(clearIncompatibleQuantSemantics = false) {
    const result = saveCustomIndicator(userScripts, {
      category: selectedScript?.category ?? "custom",
      color: selectedScript?.color ?? parsed.program?.plots[0]?.color ?? "#32d3ee",
      description: selectedScript?.description ?? "Custom EdgeLab DSL indicator.",
      id: selectedScript?.origin === "user" ? selectedScript.id : "",
      inputs,
      name: parsed.program?.name ?? "Custom indicator",
      preview: selectedScript?.preview ?? (parsed.program?.overlay ? "trend" : "oscillator"),
      source,
      synonyms: selectedScript?.synonyms ?? [],
      quantSemantics: selectedScript?.quantSemantics,
    }, { clearIncompatibleQuantSemantics });
    if (result.quantSemanticsWarning) {
      setQuantSemanticsWarning(result.quantSemanticsWarning);
      setRunState({ detail: "Review the Quant label warning before saving.", status: "error" });
      return null;
    }
    if (!result.script) {
      setRunState({ detail: "Resolve compile diagnostics before saving.", status: "error" });
      return null;
    }
    onScriptsChange(result.scripts);
    setSelectedId(result.script.id);
    setQuantSemanticsWarning(null);
    setRunState({ detail: `Saved revision ${result.script.revision}.`, status: "success" });
    return result.script;
  }

  function duplicate() {
    const base = selectedScript ?? save();
    if (!base) return;
    const copy = duplicateCustomIndicator(base);
    onScriptsChange([copy, ...userScripts]);
    setSelectedId(copy.id);
    setSource(copy.source);
    setInputs(copy.inputs);
  }

  function remove() {
    if (!selectedScript || selectedScript.origin !== "user") return;
    if (!window.confirm(`Delete “${selectedScript.name}”? Version history for this script will also be removed.`)) return;
    onScriptsChange(userScripts.filter((script) => script.id !== selectedScript.id));
    setSelectedId("");
    setSource(DEFAULT_EDGE_INDICATOR_SOURCE);
    setInputs({});
  }

  function rename(value: string) {
    const safe = value.replace(/["\n\r]/g, " ").trimStart().slice(0, 80);
    setSource((current) => current.replace(/^indicator\s+"[^"]*"/m, `indicator "${safe}"`));
  }

  function run() {
    if (!parsed.program) {
      setRunState({ detail: "Resolve compile diagnostics before running.", status: "error" });
      return;
    }
    runtimeCancelRef.current?.();
    const job = createIndicatorRuntimeJob({ bars: bars.slice(-20_000), inputs, mode: "historical", source });
    runtimeCancelRef.current = job.cancel;
    setRunState({ detail: `Executing ${Math.min(bars.length, 20_000).toLocaleString()} bars in the isolated worker…`, status: "running" });
    void job.promise.then((result) => {
      runtimeCancelRef.current = null;
      setRunState({ detail: `${result.plots.length} plot${result.plots.length === 1 ? "" : "s"} · ${result.audit.operations.toLocaleString()} deterministic operations.`, status: "success" });
    }).catch((error) => {
      runtimeCancelRef.current = null;
      setRunState({ detail: error instanceof Error ? error.message : "Indicator execution failed.", status: "error" });
    });
  }

  function addToChart() {
    const saved = selectedScript?.origin === "user" && selectedScript.source === source ? selectedScript : save();
    if (!saved || !parsed.program) return;
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
    setSource(next);
    setCompletionOpen(false);
    const cursor = replaceStart + value.length;
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
    });
  }

  function editorKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Tab") {
      event.preventDefault();
      const start = event.currentTarget.selectionStart;
      const end = event.currentTarget.selectionEnd;
      setSource(source.slice(0, start) + "  " + source.slice(end));
      window.requestAnimationFrame(() => event.currentTarget.setSelectionRange(start + 2, start + 2));
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
    ? [...selectedScript.versions, { createdAt: selectedScript.updatedAt, revision: selectedScript.revision, source: selectedScript.source }]
    : [];

  return (
    <Dialog open label="EdgeLab indicator editor" onClose={onClose} className="flex h-[min(860px,calc(100vh-20px))] max-w-[1180px] flex-col overflow-hidden bg-[var(--ui-modal)]">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold text-white"><Code2 size={17} /> EdgeLab indicator editor</h2>
            <p className="mt-0.5 text-xs text-slate-400">Original EdgeLab DSL 1.0 · not Pine Script compatible</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button className="studio-tool-button" onClick={() => { setSelectedId(""); setSource(DEFAULT_EDGE_INDICATOR_SOURCE); setInputs({}); }} type="button"><Plus size={13} /> New</button>
            <button className="studio-tool-button" onClick={duplicate} type="button"><Copy size={13} /> Duplicate</button>
            <button className="studio-tool-button" disabled={!selectedScript || selectedScript.origin !== "user"} onClick={remove} type="button"><Trash2 size={13} /> Delete</button>
            <button className="studio-tool-button" onClick={() => save()} type="button"><Save size={13} /> Save</button>
            <button className="studio-tool-button studio-tool-button-active" disabled={!parsed.program} onClick={addToChart} type="button"><Plus size={13} /> Add to chart</button>
            <IconButton icon={X} label="Close indicator editor" onClick={onClose} />
          </div>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[230px_minmax(0,1fr)_280px]">
          <aside className="min-h-0 overflow-y-auto border-b border-white/10 p-3 lg:border-b-0 lg:border-r">
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
            <input className="input-control mt-2 h-9 w-full text-xs" id="edge-script-name" onChange={(event) => rename(event.target.value)} value={parsed.program?.name ?? ""} />
            <div className="mt-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-300"><History size={13} /> Version history</div>
            <select aria-label="Version history" className="input-control mt-2 h-9 w-full text-xs" disabled={history.length === 0} onChange={(event) => { const version = history.find((item) => item.revision === Number(event.target.value)); if (version) { setRevisionSource(version.source); setSource(version.source); } }} value={revisionSource ? history.find((item) => item.source === revisionSource)?.revision ?? "" : ""}>
              <option value="">Current source</option>
              {[...history].reverse().map((version) => <option key={`${version.revision}-${version.createdAt}`} value={version.revision}>v{version.revision} · {new Date(version.createdAt).toLocaleDateString()}</option>)}
            </select>
            <details className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3 text-xs leading-5 text-slate-400">
              <summary className="cursor-pointer font-semibold text-slate-200">Language reference</summary>
              <pre className="mt-3 whitespace-pre-wrap font-mono text-[11px] leading-5">{EDGE_INDICATOR_DSL_REFERENCE}</pre>
            </details>
          </aside>

          <main className="flex min-h-[360px] min-w-0 flex-col border-b border-white/10 lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-xs text-slate-400">
              <span>indicator.edge</span>
              <span>{new TextEncoder().encode(source).length.toLocaleString()} / 20,000 bytes</span>
            </div>
            <div className="relative min-h-0 flex-1 overflow-hidden bg-[#05080c]">
              <pre aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-auto whitespace-pre-wrap p-4 font-mono text-[12px] leading-6 text-slate-200">{highlightSource(source)}</pre>
              <textarea aria-label="EdgeLab indicator source" aria-describedby="edge-editor-diagnostics" className="absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent p-4 font-mono text-[12px] leading-6 outline-none" onChange={(event) => { setSource(event.target.value); setCompletionOpen(true); setCompletionIndex(0); }} onKeyDown={editorKeyDown} ref={textareaRef} spellCheck={false} style={{ caretColor: "#e2e8f0", color: "transparent", WebkitTextFillColor: "transparent" }} value={source} />
              {completionOpen && completions.length > 0 ? (
                <div className="absolute bottom-3 left-3 z-10 max-h-48 w-56 overflow-y-auto rounded-lg border border-white/10 bg-[#0b1118] p-1 shadow-[0_16px_38px_rgba(0,0,0,0.5)]" role="listbox">
                  {completions.map((item, index) => <button aria-selected={index === completionIndex} className={`block w-full rounded px-2 py-1.5 text-left font-mono text-xs ${index === completionIndex ? "bg-cyan-300/10 text-cyan-100" : "text-slate-300 hover:bg-white/5"}`} key={item} onMouseDown={(event) => event.preventDefault()} onClick={() => insertCompletion(item)} role="option" type="button">{item}</button>)}
                </div>
              ) : null}
            </div>
          </main>

          <aside className="min-h-0 overflow-y-auto p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-white">Diagnostics</h3>
              <button className="studio-tool-button" onClick={runState.status === "running" ? () => { runtimeCancelRef.current?.(); runtimeCancelRef.current = null; setRunState({ detail: "Execution cancelled.", status: "idle" }); } : run} type="button">
                {runState.status === "running" ? <Square size={12} /> : <Play size={12} />}{runState.status === "running" ? "Cancel" : "Run"}
              </button>
            </div>
            <div className="mt-3 grid gap-2" id="edge-editor-diagnostics">
              {parsed.diagnostics.length === 0 ? <p className="flex items-center gap-2 rounded-md bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200"><CheckCircle2 size={14} /> Ready to execute in the isolated worker.</p> : parsed.diagnostics.map((item, index) => <button className="flex gap-2 rounded-md bg-rose-400/10 px-3 py-2 text-left text-xs leading-5 text-rose-200" key={`${item.code}-${item.line}-${index}`} onClick={() => { const lineStart = source.split("\n").slice(0, item.line - 1).join("\n").length + (item.line > 1 ? 1 : 0); textareaRef.current?.focus(); textareaRef.current?.setSelectionRange(lineStart + item.column - 1, lineStart + item.column - 1); }} type="button"><AlertTriangle className="mt-0.5 shrink-0" size={13} /><span>Line {item.line}: {item.message}</span></button>)}
              {quantSemanticsWarning ? <div className="rounded-md border border-amber-300/20 bg-amber-300/[0.06] p-3 text-xs leading-5 text-amber-100" role="alert"><p>{quantSemanticsWarning}</p><button className="studio-tool-button mt-2" onClick={() => save(true)} type="button">Clear Quant labels and save</button></div> : null}
              {runState.detail ? <p aria-live="polite" className={`rounded-md px-3 py-2 text-xs leading-5 ${runState.status === "error" ? "bg-rose-400/10 text-rose-200" : runState.status === "success" ? "bg-emerald-400/10 text-emerald-200" : "bg-white/5 text-slate-300"}`}>{runState.detail}</p> : null}
            </div>
            <h3 className="mt-5 text-sm font-semibold text-white">Generated settings</h3>
            <div className="mt-2 grid gap-3">
              {parsed.program?.inputs.map((input) => <GeneratedInput definition={input} key={input.name} onChange={(value) => setInputs((current) => ({ ...current, [input.name]: value }))} value={inputs[input.name] ?? input.defaultValue} />) ?? <p className="text-xs leading-5 text-slate-300">Valid input declarations appear here.</p>}
            </div>
            <p className="mt-5 text-[11px] leading-5 text-slate-300">Ctrl+Space opens completion. Tab inserts two spaces. Runtime permits no network, storage, DOM, imports, or arbitrary JavaScript.</p>
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
    const className = token.startsWith("//") ? "text-slate-400" : token.startsWith('"') ? "text-amber-200" : token.startsWith("#") ? "text-rose-300" : /^\d/.test(token) ? "text-violet-300" : /^(indicator|input|plot|overlay|pane|number|boolean|source|min|max)$/.test(token) ? "text-cyan-300" : /\w+/.test(token) ? "text-emerald-300" : "";
    return <span className={className} key={index}>{token}</span>;
  });
}
