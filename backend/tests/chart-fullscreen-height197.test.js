import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const bundle = buildSync({
  bundle: true, format: "cjs", platform: "node", packages: "external", write: false, logLevel: "silent",
  stdin: {
    contents: 'export { useChartViewportHeight } from "./frontend/src/lib/useChartViewportHeight.ts";',
    loader: "ts", resolveDir: fileURLToPath(new URL("../..", import.meta.url)),
  },
}).outputFiles[0].text;

test("the actual App fullscreen callback cannot claim a missing backtest chart when Live exits fullscreen", () => {
  const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
  const ts = require("typescript");
  const source = readFileSync(new URL("../../frontend/src/App.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const callbacks = [];
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "syncNativeFullscreen") callbacks.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(callbacks.length, 1);
  const callback = ts.transpileModule(callbacks[0].getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const document = { fullscreenElement: null };
  const chartShellRef = { current: null };
  const updates = [];
  const sync = new Function("document", "chartShellRef", "setIsChartFullscreen", "setFullscreenOrderPanelOpen", `${callback}; return syncNativeFullscreen;`)(
    document, chartShellRef, (value) => updates.push(["fullscreen", value]), (value) => updates.push(["orderPanel", value]),
  );
  sync();
  assert.deepEqual(updates, [["fullscreen", false], ["orderPanel", false]]);

  updates.length = 0;
  chartShellRef.current = {};
  document.fullscreenElement = chartShellRef.current;
  sync();
  assert.deepEqual(updates, [["fullscreen", true]]);

  updates.length = 0;
  document.fullscreenElement = {};
  sync();
  assert.deepEqual(updates, []); // Live/another element is not the backtest chart.

  document.fullscreenElement = null;
  sync();
  assert.deepEqual(updates, [["fullscreen", false], ["orderPanel", false]]);
});

test("native fullscreen exit restores the chart floor after navigation returns and cleans up its scheduled work", () => {
  const effects = [];
  const loaded = { exports: {} };
  new Function("require", "module", "exports", bundle)((name) => {
    assert.equal(name, "react");
    return { useState: () => [false, () => {}], useLayoutEffect: (effect) => effects.push(effect) };
  }, loaded, loaded.exports);

  const windowTarget = new EventTarget();
  Object.assign(windowTarget, { innerWidth: 390, innerHeight: 844, scrollY: 0 });
  const documentTarget = new EventTarget();
  let navigationHeight = 58;
  const navigation = { getBoundingClientRect: () => ({ top: 786, height: navigationHeight }) };
  documentTarget.querySelector = () => navigation;
  const style = () => {
    const values = new Map();
    return {
      getPropertyValue: (key) => values.get(key) ?? "",
      setProperty: (key, value) => values.set(key, value),
      removeProperty: (key) => values.delete(key),
    };
  };
  const stage = { style: style() };
  const frame = {
    parentElement: null, style: style(), getBoundingClientRect: () => ({ top: 302 }),
    closest: (selector) => selector === ".chart-pane-layout-single" ? frame : selector === ".chart-stage" ? stage : null,
  };
  let animationId = 0;
  const scheduled = new Map();
  const canceled = [];
  const replacements = {
    window: windowTarget, document: documentTarget, ResizeObserver: undefined,
    getComputedStyle: () => ({ position: "fixed" }),
    requestAnimationFrame: (callback) => { const id = ++animationId; scheduled.set(id, callback); return id; },
    cancelAnimationFrame: (id) => { canceled.push(id); scheduled.delete(id); },
  };
  const descriptors = Object.fromEntries(Object.keys(replacements).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let cleanup;
  try {
    for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    loaded.exports.useChartViewportHeight({ current: frame });
    effects[0]();
    cleanup = effects[1]();
    assert.equal(frame.style.getPropertyValue("--chart-price-height"), "476px");

    // React has removed its fullscreen shell, but native fullscreen still hides
    // the outside navigation. Its eventual exit need not resize the window.
    navigationHeight = 0;
    effects[0]();
    assert.equal(frame.style.getPropertyValue("--chart-price-height"), "534px");
    navigationHeight = 58;
    documentTarget.dispatchEvent(new Event("fullscreenchange"));
    documentTarget.dispatchEvent(new Event("fullscreenchange"));
    assert.equal(scheduled.size, 1);
    const [id, callback] = scheduled.entries().next().value;
    scheduled.delete(id);
    callback();
    assert.equal(frame.style.getPropertyValue("--chart-price-height"), "476px");
    assert.equal(stage.style.getPropertyValue("--chart-price-height"), "476px");

    documentTarget.dispatchEvent(new Event("fullscreenchange"));
    const pendingId = scheduled.keys().next().value;
    cleanup();
    cleanup = undefined;
    assert.deepEqual(canceled, [pendingId]);
    assert.equal(scheduled.size, 0);
    assert.equal(frame.style.getPropertyValue("--chart-price-height"), "");
    assert.equal(stage.style.getPropertyValue("--chart-price-height"), "");
    documentTarget.dispatchEvent(new Event("fullscreenchange"));
    windowTarget.dispatchEvent(new Event("resize"));
    assert.equal(scheduled.size, 0);
  } finally {
    cleanup?.();
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
