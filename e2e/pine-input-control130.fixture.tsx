import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { PineInputControl } from "../frontend/src/components/PineInputControl";
import { validatePineResponse, type PineInputDefinition, type PineInputValue } from "../frontend/src/lib/pineProtocol";

// Hand-authored component/protocol metadata probes. No Pine runtime is executed
// and these descriptors are never represented as native engine output.
const definitions: PineInputDefinition[] = [
  { id: "in_0", name: "Gate", type: "bool", defval: false },
  { id: "in_1", name: "Mixed scalars", type: "string", defval: 1, options: [1, "1", true, "true", null] },
  { id: "in_2", name: "Null choice", type: "string", defval: null, options: [1, "1", true, "true", null] },
  { id: "in_3", name: "Enum choices", type: "enum", defval: "Mode.first", options: ["Mode.first", "Mode.second"], enumVersion: 1, enumType: "Mode", enumMembers: [{ id: "Mode.first", label: "Same label" }, { id: "Mode.second", label: "Same label" }] },
  { id: "in_4", name: "Conditional choice", type: "string", defval: "a", options: ["a", "b"], activeCondition: { kind: "input", id: "in_0" } },
  { id: "in_5", name: "Conditional checkbox", type: "bool", defval: false, activeCondition: { kind: "input", id: "in_0" } },
  { id: "in_6", name: "Disabled choice", type: "string", defval: "a", options: ["a", "b"], active: false },
  { id: "in_7", name: "Disabled checkbox", type: "bool", defval: false, active: false },
];
const source = '// @version=6\nindicator("Component metadata probe")';
function checked(items: PineInputDefinition[]) {
  return validatePineResponse({ id: "component-probe", status: "completed", result: { kind: "prepare", source, language: "pine", pineVersion: 6, declaration: "indicator", name: "Component metadata probe", overlay: false, inputDefinitions: items, diagnostics: [] } }, { id: "component-probe", action: "prepare", source }).inputDefinitions;
}
const validated = checked(definitions);
const emissions: { id: string; value: PineInputValue; type: string }[] = [];
const palettes = {
  dark: { "--ui-inset": "#101820", "--ui-raised": "#202830", "--ui-floating": "#303840", "--text-primary": "#f0e8d0", "--text-secondary": "#c0b8a0", "--ui-focus": "#70e0a0", "--loss-text": "#f08090" },
  light: { "--ui-inset": "#e8edf2", "--ui-raised": "#d8e0e8", "--ui-floating": "#ffffff", "--text-primary": "#152536", "--text-secondary": "#354556", "--ui-focus": "#205080", "--loss-text": "#a02030" },
};
const probe: any = { provenance: "hand-authored protocol/component probe; no Pine execution", definitions: validated, emissions, palettes };
(window as any).inputProbe = probe;
function App() {
  const [values, setValues] = useState<Record<string, PineInputValue>>({});
  const [visible, setVisible] = useState(["in_1"]);
  const [recovery, setRecovery] = useState<Record<string, string>>({});
  probe.mount = (ids: string[]) => flushSync(() => { emissions.length = 0; setValues({}); setRecovery({}); setVisible(ids); });
  probe.set = (id: string, value: PineInputValue) => flushSync(() => setValues(old => ({ ...old, [id]: value })));
  probe.recovery = (id: string, label: string) => flushSync(() => setRecovery(old => ({ ...old, [id]: label })));
  probe.palette = (name: keyof typeof palettes) => Object.entries(palettes[name]).forEach(([key, value]) => document.documentElement.style.setProperty(key, value));
  probe.rejectDuplicateEnumIds = () => {
    try { checked([{ ...definitions[3], enumMembers: [{ id: "Mode.first", label: "Same label" }, { id: "Mode.first", label: "Same label" }] }]); return false; } catch { return true; }
  };
  return <main style={{ padding: 24, maxWidth: 380, display: "grid", gap: 20 }}>
    {validated.filter(item => visible.includes(item.id)).map(definition => <section data-probe={definition.id} key={definition.id}>
      <PineInputControl definition={definition} definitions={validated} inputs={values} value={values[definition.id]} recoveryLabel={recovery[definition.id]} onChange={value => { emissions.push({ id: definition.id, value, type: typeof value }); setValues(old => ({ ...old, [definition.id]: value })); }} />
    </section>)}
  </main>;
}
createRoot(document.getElementById("root")!).render(<App />);
