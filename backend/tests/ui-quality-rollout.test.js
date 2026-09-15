import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { buildSync } from "../../node_modules/esbuild/lib/main.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

async function bundle(relativePath) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "edgelab-quality-"));
  const output = path.join(directory, "module.mjs");
  buildSync({ bundle: true, entryPoints: [path.join(ROOT, relativePath)], format: "esm", outfile: output, platform: "node" });
  return { cleanup: () => fs.rmSync(directory, { force: true, recursive: true }), module: await import(`${pathToFileURL(output).href}?${Date.now()}`) };
}

test("rollout flags preserve deep links and provide a global reversible fallback", async () => {
  const { cleanup, module } = await bundle("frontend/src/lib/uiRollout.ts");
  try {
    assert.equal(module.routeGroup("/app/journal/trades?trade=42"), "journal");
    assert.equal(module.routeGroup("/app/settings/chart"), "settings");
    assert.equal(module.routeGroup("/app/live"), "chart");
    assert.equal(module.routeGroup("/pricing"), "public");
    assert.ok(Object.values(module.resolveUiRollout()).every(Boolean));
    assert.ok(Object.values(module.resolveUiRollout({ killSwitch: true })).every((value) => !value));
    assert.equal(module.resolveUiRollout({ overrides: { chart: false } }).chart, false);
  } finally { cleanup(); }
});

test("financial states expose a non-color sign and accessible label", async () => {
  const { cleanup, module } = await bundle("frontend/src/lib/uiFoundation.ts");
  try {
    assert.deepEqual(module.financialState(125.5), { label: "Profit +125.5", sign: "+", tone: "profit" });
    assert.deepEqual(module.financialState(-4), { label: "Loss −4", sign: "−", tone: "loss" });
    assert.deepEqual(module.financialState(0), { label: "Unchanged 0", sign: "=", tone: "neutral" });
    assert.deepEqual(module.financialState(null), { label: "Unavailable", sign: "!", tone: "warning" });
  } finally { cleanup(); }
});

test("release matrix covers authenticated responsive, locale, state, and interaction baselines", () => {
  const matrix = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/ui-release-matrix.json"), "utf8"));
  assert.equal(matrix.viewports.mobile.width, 390);
  assert.equal(matrix.viewports.mobile.zoom, 2);
  assert.equal(matrix.routes.settings.auth, true);
  assert.equal(matrix.routes.journal.auth, true);
  assert.equal(matrix.routes.chart.states.includes("sixteen-pane"), true);
  assert.equal(matrix.locales.includes("ar-SA"), true);
  for (const assertion of ["landmarks", "keyboard-complete", "focus-return", "reduced-motion", "touch-targets", "performance-budget"]) assert.ok(matrix.requiredAssertions.includes(assertion));
});

test("critical state component uses persistent semantics and explicit recovery", () => {
  const source = fs.readFileSync(path.join(ROOT, "frontend/src/components/ui/CriticalStateSurface.tsx"), "utf8");
  assert.match(source, /aria-live=/);
  assert.match(source, /aria-busy=/);
  assert.match(source, /role=\{urgent \? "alert" : "status"\}/);
  assert.match(source, /Last verified/);
  assert.match(source, /onAction/);
});
