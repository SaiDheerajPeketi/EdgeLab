import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemedColorPicker } from "../frontend/src/components/ThemedColorPicker";
import { colorWithOpacity } from "../frontend/src/lib/colorTokens";
type Mode = "alpha" | "strict";
declare global { interface Window { alphaFixture: {
  external(mode: Mode, value: string): void; disable(value: boolean): void; ledger(mode: Mode): string[];
  paint(color: string, opacity: number): { color: string; pixel: number[] };
}; } }
function Fixture() {
  const [alpha, setAlpha] = useState("#FF000080"), [strict, setStrict] = useState("#102030"), [disabled, setDisabled] = useState(false);
  const calls = useRef<Record<Mode, string[]>>({ alpha: [], strict: [] });
  window.alphaFixture = { external: (mode, value) => (mode === "alpha" ? setAlpha : setStrict)(value), disable: setDisabled, ledger: mode => [...calls.current[mode]],
    paint: (color, opacity) => { const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d")!; const result = colorWithOpacity(color, opacity); ctx.fillStyle = result; ctx.fillRect(0, 0, 1, 1);
      return { color: result, pixel: Array.from(ctx.getImageData(0, 0, 1, 1).data) }; } };
  return <main style={{ maxWidth: 480, margin: "32px auto", padding: 24, background: "var(--ui-panel)", color: "var(--text-primary)" }}>
    <h1 style={{ fontSize: 20, marginBottom: 16 }}>Drawing transparency</h1>
    <ThemedColorPicker ariaLabel="Drawing" allowAlpha value={alpha} disabled={disabled} onChange={value => { calls.current.alpha.push(value); setAlpha(value); }} />
    <p style={{ margin: "20px 0" }}>Drawing owner: <output data-testid="alpha-owner">{alpha}</output></p>
    <ThemedColorPicker ariaLabel="Chart" value={strict} disabled={disabled} onChange={value => { calls.current.strict.push(value); setStrict(value); }} />
    <p style={{ marginTop: 20 }}>Chart owner: <output data-testid="strict-owner">{strict}</output></p>
    <button type="button" style={{ position: "fixed", right: 8, top: 8, minHeight: 44, padding: "8px 16px", border: "1px solid var(--ui-border-strong)" }}>Outside focus target</button>
  </main>;
}
createRoot(document.querySelector("#root")!).render(<Fixture />);
