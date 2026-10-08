import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemedColorPicker } from "../frontend/src/components/ThemedColorPicker";

declare global { interface Window { colorFixture: { external(value: string): void; disable(value: boolean): void; ledger(): string[] }; } }
function Fixture() {
  const [color, setColor] = useState("#102030"), [disabled, setDisabled] = useState(false);
  const calls = useRef<string[]>([]);
  window.colorFixture = { external: setColor, disable: setDisabled, ledger: () => [...calls.current] };
  return <main style={{ maxWidth: 480, margin: "32px auto", padding: 24, background: "var(--ui-panel)", color: "var(--text-primary)" }}>
    <h1 style={{ fontSize: 20, marginBottom: 16 }}>Controlled chart color</h1>
    <ThemedColorPicker ariaLabel="Accent" value={color} disabled={disabled} onChange={value => { calls.current.push(value); setColor(value); }} />
    <p style={{ marginTop: 36 }}>Owner color: <output data-testid="owner-color">{color}</output></p>
    <button type="button" style={{ position: "fixed", right: 8, top: 8, minHeight: 44, padding: "8px 16px", border: "1px solid var(--ui-border-strong)" }}>Outside focus target</button>
  </main>;
}
createRoot(document.querySelector("#root")!).render(<Fixture />);
