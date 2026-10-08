import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { sanitizePinePrepared } from "../frontend/src/lib/customIndicators";
import { PineInputControl } from "../frontend/src/components/PineInputControl";
import { createPineRuntimeJob } from "../frontend/src/lib/pineRuntime";
import type { PineInputValue, PinePrepareResult } from "../frontend/src/lib/pineProtocol";
const fixture = (window as any).pineInputEditFixture = { current: null };
function App() {
  const [prepared, setPrepared] = useState<PinePrepareResult>();
  const [inputs, setInputs] = useState<Record<string, PineInputValue>>({});
  const [result, setResult] = useState<any>(null), [error, setError] = useState("");
  const version = useRef(0), currentJob = useRef<ReturnType<typeof createPineRuntimeJob>>();
  const records = useRef({ emissions: [] as Array<{ id: string; value: PineInputValue }>, runs: [] as any[] });
  fixture.current = { source: prepared?.source, definitions: prepared?.inputDefinitions ?? [], inputs, result, error, ...records.current };
  async function run(nextInputs: Record<string, PineInputValue>) {
    const owned = ++version.current;
    currentJob.current?.cancel();
    const request = { action: "run" as const, source: prepared!.source, inputs: nextInputs, bars: fixture.bars,
      context: { symbol: "TEST", timeframe: "1", mintick: .01, pointvalue: 1 } };
    records.current.runs.push(structuredClone(request));
    const job = createPineRuntimeJob(request); currentJob.current = job;
    try {
      const output = await job.promise;
      if (version.current === owned) { setResult(output); setError(""); }
      return output;
    } catch (cause) {
      if (version.current === owned) setError(String(cause));
      throw cause;
    }
  }
  fixture.prepare = async (source: string) => {
    ++version.current; currentJob.current?.cancel();
    const metadata = await createPineRuntimeJob({ action: "prepare", source }).promise as PinePrepareResult;
    records.current = { emissions: [], runs: [] };
    setPrepared(metadata); setInputs(Object.fromEntries(metadata.inputDefinitions.map(definition => [definition.id, definition.defval])));
    setResult(null); setError(""); return metadata;
  };
  fixture.run = () => run(inputs);
  fixture.rebuildMetadata = () => setPrepared(current => current ? sanitizePinePrepared(structuredClone(current), current.source) : current);
  fixture.externalValue = (id: string, value: PineInputValue) => setInputs(current => ({ ...current, [id]: value }));
  return <main className="mx-auto grid max-w-xl gap-5 p-4 text-[var(--text-primary)]">
    <h1 className="text-xl font-semibold">Pine numeric inputs</h1>
    {prepared?.inputDefinitions.map(definition => <PineInputControl key={definition.id} definition={definition}
      definitions={prepared.inputDefinitions} inputs={inputs} value={inputs[definition.id]} onChange={value => {
        const next = { ...inputs, [definition.id]: value };
        records.current.emissions.push({ id: definition.id, value }); setInputs(next);
        void run(next).catch(() => { /* The actual worker error is rendered below. */ });
      }} />)}
    <button className="studio-tool-button" onClick={() => { void run(inputs).catch(() => {}); }} type="button">Run valid inputs</button>
    {error ? <p role="alert">{error}</p> : null}
  </main>;
}
createRoot(document.getElementById("root")!).render(<App />);
