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

test("rollout flags preserve deep links and provide a global reversible fallback policy", async () => {
  const { cleanup, module } = await bundle("frontend/src/lib/uiRollout.ts");
  try {
    assert.equal(module.routeGroup("/app/journal/trades?trade=42"), "journal");
    assert.equal(module.routeGroup("/app/settings/chart"), "settings");
    assert.equal(module.routeGroup("/app/live"), "chart");
    assert.equal(module.routeGroup("/shared#snapshot-token"), "chart");
    assert.equal(module.routeGroup("/application"), "public");
    assert.equal(module.routeGroup("/app/journalist"), "shell");
    assert.equal(module.routeGroup("/pricing"), "public");
    assert.ok(Object.values(module.resolveUiRollout()).every(Boolean));
    assert.ok(Object.values(module.resolveUiRollout({ killSwitch: true })).every((value) => !value));
    assert.equal(module.resolveUiRollout({ overrides: { chart: false } }).chart, false);
    assert.deepEqual(module.resolveUiRollout({ overrides: { shell: false, journal: true, settings: true, chart: true, public: true } }), {
      shell: false,
      journal: false,
      settings: false,
      chart: false,
      public: true,
    });

    const response = {
      revision: "release-42",
      kill_switch: false,
      flags: { shell: true, journal: true, settings: true, chart: false, public: true },
    };
    assert.deepEqual(module.normalizeServerUiRollout(response), response);
    assert.equal(module.normalizeServerUiRollout({ ...response, flags: { ...response.flags, chart: "true" } }), null);
    assert.ok(Object.values(module.resolveServerUiRollout({ revision: "incident", kill_switch: true, flags: response.flags })).every((value) => !value));
    assert.ok(Object.values(module.resolveServerUiRollout({ revision: "broken", kill_switch: false, flags: {} })).every((value) => !value));

    const snapshot = module.serializeUiRolloutSnapshot(response, 1_000);
    assert.deepEqual(module.parseUiRolloutSnapshot(snapshot, 1_100, 200), response);
    assert.equal(module.parseUiRolloutSnapshot(snapshot, 1_201, 200), null);
    assert.equal(module.parseUiRolloutSnapshot("not-json", 1_100, 200), null);

    const values = new Map();
    const storage = {
      removeItem: (key) => values.delete(key),
      setItem: (key, value) => values.set(key, value),
    };
    assert.equal(module.persistUiRolloutSnapshot(storage, response, 1_000), true);
    assert.ok(values.has(module.rolloutStorageKey()));
    assert.equal(module.persistUiRolloutSnapshot(storage, { ...response, flags: {} }, 1_100), false);
    assert.equal(values.has(module.rolloutStorageKey()), false);
    const reloadResponse = module.parseUiRolloutSnapshot(values.get(module.rolloutStorageKey()) ?? null, 1_200);
    assert.equal(reloadResponse, null);
    const reloadFlags = reloadResponse
      ? module.resolveServerUiRollout(reloadResponse)
      : module.resolveUiRollout({ killSwitch: true });
    assert.ok(Object.values(reloadFlags).every((value) => !value));
  } finally { cleanup(); }
});

test("container deployment exposes every server-owned rollout control", () => {
  const compose = fs.readFileSync(path.join(ROOT, "docker-compose.yml"), "utf8");
  for (const name of [
    "EDGELAB_UI_REVISION",
    "EDGELAB_UI_KILL_SWITCH",
    "EDGELAB_UI_SHELL_V2",
    "EDGELAB_UI_JOURNAL_V2",
    "EDGELAB_UI_SETTINGS_V2",
    "EDGELAB_UI_CHART_V2",
    "EDGELAB_UI_PUBLIC_V2",
  ]) assert.match(compose, new RegExp(`\\b${name}:`));
});

test("quality manifests inventory routes, critical states, and measurable budgets", () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/ui-surface-inventory.json"), "utf8"));
  const budgets = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/ui-performance-budgets.json"), "utf8"));
  assert.ok(inventory.routes.length >= 18);
  assert.ok(inventory.routes.every((route) => route.disposition && route.states.length));
  assert.equal(new Set(inventory.routes.map((route) => route.path)).size, inventory.routes.length);
  assert.ok(inventory.panels.includes("Journal"));
  assert.ok(inventory.panels.every((panel) => inventory.classification.includes(inventory.panelDispositions[panel])));
  assert.ok(inventory.overlays.includes("radial drawing toolbox"));
  assert.ok(inventory.overlays.every((overlay) => inventory.classification.includes(inventory.overlayDispositions[overlay])));
  assert.equal(budgets.runtime.interactionP95Ms, 200);
  assert.equal(budgets.runtime.sixteenPaneFrameP95Ms, 50);
  assert.equal(budgets.runtime.sixteenPaneResizeStressP95Ms, 120);
});

test("low-power chart budget drives and proves representative pane work", () => {
  const source = fs.readFileSync(path.join(ROOT, "e2e/chart-performance.spec.ts"), "utf8");
  assert.match(source, /page\.mouse\.move\(/);
  assert.match(source, /Promise\.all\(\[sampling, driving\]\)/);
  assert.match(source, /panesWithChangingOhlc\)\.toBe\(16\)/);
  assert.match(source, /resizeStressP95Ms/);
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
