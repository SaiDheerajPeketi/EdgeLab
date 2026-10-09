import React, { useState, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { PineInputControl } from "../frontend/src/components/PineInputControl";
import { createPineRuntimeJob, createPineLiveRuntimeSession } from "../frontend/src/lib/pineRuntime";
import { createCustomScriptRuntimeJob } from "../frontend/src/lib/customScriptRuntime";
import { sanitizePinePrepared } from "../frontend/src/lib/customIndicators";
import { usePineInputMetadata, usePineInputMigration } from "../frontend/src/lib/usePineInputMetadata";
const fixture = (window as any).pineEnumIdentityFixture = { current: null, renderProof: [] };
const context = { symbol: "TEST", timeframe: "1", mintick: .01, pointvalue: 1 };
function legacyMetadata(metadata: any) {
 const legacy = structuredClone(metadata);
 legacy.inputDefinitions = legacy.inputDefinitions.map((definition: any) => {
  if (definition.type !== "enum") return definition;
  const label = (id: string) => definition.enumMembers.find((member: any) => member.id === id)?.label ?? id;
  const {enumVersion, enumType, enumMembers, ...older} = definition;
  return {...older, defval: label(definition.defval), options: definition.options.map(label)};
 });
 const validated = sanitizePinePrepared(legacy, metadata.source);
 if (!validated) throw new Error("The saved legacy descriptor was rejected.");
 return validated;
}
function Controls({bundle, update}: any) {
 const prepared = usePineInputMetadata(bundle.prepared?.source, bundle.prepared);
 const effective = usePineInputMigration(bundle.prepared, prepared, bundle.inputs, bundle.recovery, update);
 useLayoutEffect(() => {
  if (bundle.prepared?.inputDefinitions[0]?.enumVersion !== 1 && prepared?.inputDefinitions[0]?.enumVersion === 1)
   fixture.renderProof.push({saved: structuredClone(bundle.inputs), effective: structuredClone(effective.inputs), ...(document.querySelector("select") ? {selected: [...document.querySelectorAll("select")].map(select => select.value)} : {selectedLabels: [...document.querySelectorAll('button[role="combobox"] .themed-select-value')].map(label => label.textContent)})});
 }, [prepared, bundle, effective]);
 return <div className="grid gap-4">{prepared?.inputDefinitions.map((definition: any) =>
  <PineInputControl key={definition.id} definition={definition} definitions={prepared.inputDefinitions} inputs={effective.inputs}
   value={effective.inputs[definition.id]} recoveryLabel={effective.recovery[definition.id]}
   onChange={value => update({prepared, inputs: {...effective.inputs, [definition.id]: value},
     recovery: Object.fromEntries(Object.entries(effective.recovery).filter(([id]) => id !== definition.id))})}/>)}</div>;
}
function App() {
 const [bundle, setBundle] = useState<any>({prepared: undefined, inputs: {}, recovery: {}});
 const [visible, setVisible] = useState(true), [generation, setGeneration] = useState(0);
 const [result, setResult] = useState<any>(null), [error, setError] = useState("");
 fixture.current = {...bundle, result, error, visible};
 fixture.prepare = async (source: string) => {
  const metadata = await createPineRuntimeJob({action: "prepare", source}).promise;
  setBundle({prepared: metadata, inputs: {}, recovery: {}}); setResult(null); setError(""); return metadata;
 };
 fixture.loadLegacy = async (source: string, inputs: any, show = true) => {
  const metadata = await createPineRuntimeJob({action: "prepare", source}).promise;
  const saved = legacyMetadata(metadata); fixture.renderProof = [];
  setVisible(show); setGeneration(value => value + 1); setBundle({prepared: saved, inputs, recovery: {}});
  setResult(null); setError(""); return saved;
 };
 fixture.run = async (bars: any[]) => {
  try {
   const output = await createPineRuntimeJob({action: "run", source: bundle.prepared.source, inputs: bundle.inputs, bars, context}).promise;
   setResult(output); setError(""); return output;
  } catch (error) { setResult(null); setError(String(error)); throw error; }
 };
 fixture.corruptRecovery = () => setBundle((current: any) => ({...current, recovery: {in_0: {unexpected: true}}}));
 fixture.remount = () => {
  const saved = JSON.parse(JSON.stringify(bundle));
  const validated = sanitizePinePrepared(saved.prepared, saved.prepared.source);
  if (!validated) throw new Error("Saved metadata must remain valid.");
  setBundle({...saved, prepared: validated}); setGeneration(value => value + 1); return saved;
 };
 fixture.ingress = async (bars: any[]) => {
  if (visible) throw new Error("Ingress proof must precede opening the input UI.");
  const options = {source: bundle.prepared.source, inputs: bundle.inputs, bars, context, inputMetadata: bundle.prepared};
  const snapshot = await createCustomScriptRuntimeJob({...options, mode: "historical"}).promise;
  const session = createPineLiveRuntimeSession(options);
  try {
   const initial = await session.promise;
   const last = bars.at(-1), next = {...last, time: last.time + 60, close: last.close + .001, high: last.high + .002};
   const provisional = await session.update(next, false);
   const confirmed = await session.update({...next, close: next.close + .001}, true);
   return {snapshot, initial, provisional, confirmed};
  } finally { session.cancel(); }
 };
 return <main className="mx-auto max-w-xl p-4 text-[var(--text-primary)]">
  <h1 className="mb-5 text-xl font-semibold">Pine enum choices</h1>
  {visible ? <Controls key={generation} bundle={bundle} update={setBundle}/> : <p>Input controls are closed.</p>}
  {error ? <p role="alert">{error}</p> : null}
 </main>;
}
createRoot(document.querySelector("#root")!).render(<App/>);
