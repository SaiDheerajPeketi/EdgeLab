import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSync } from "esbuild";

const frontendRoot = fileURLToPath(new URL("..", import.meta.url));
const bundleDirectory = mkdtempSync(path.join(tmpdir(), "edgelab-indicator-dsl-"));
const bundlePath = path.join(bundleDirectory, "indicator-dsl-test.mjs");
buildSync({
  bundle: true,
  define: { "import.meta.env": "{}" },
  format: "esm",
  logLevel: "silent",
  outfile: bundlePath,
  platform: "node",
  stdin: {
    contents: [
      'export * from "./src/lib/indicatorDsl.ts";',
      'export * from "./src/lib/customIndicators.ts";',
      'export * from "./src/lib/quantAssistant.ts";',
    ].join("\n"),
    loader: "ts",
    resolveDir: frontendRoot,
    sourcefile: "indicator-dsl-test-entry.ts",
  },
  target: "node22",
});
const modules = await import(pathToFileURL(bundlePath).href);
after(() => rmSync(bundleDirectory, { force: true, recursive: true }));

const bars = Array.from({ length: 180 }, (_, index) => ({
  close: 100 + index * 0.2 + Math.sin(index / 5),
  ema_20: null,
  ema_50: null,
  high: 101 + index * 0.2,
  low: 99 + index * 0.2,
  open: 100 + index * 0.2,
  rsi_14: null,
  time: 1_700_000_000 + index * 60,
  timestamp: new Date((1_700_000_000 + index * 60) * 1_000).toISOString(),
  volume: 1_000 + index,
}));

test("EdgeLab DSL parses and executes deterministically without mutating candle epochs", () => {
  const source = [
    'indicator "Deterministic EMA" overlay',
    "input period: number = 12 min 1 max 500",
    "input source: source = close",
    'plot "EMA" = ema(source, period) color "#22d3ee"',
  ].join("\n");
  assert.ok(modules.parseEdgeIndicator(source).program);
  const first = modules.executeEdgeIndicator({ bars, source });
  const second = modules.executeEdgeIndicator({ bars, source });
  assert.deepEqual(first.plots, second.plots);
  assert.deepEqual(bars.map((bar) => bar.time), Array.from({ length: 180 }, (_, index) => 1_700_000_000 + index * 60));
  assert.equal(first.audit.bars, bars.length);
});

test("validated backend JSON is strictly adapted to canonical user DSL", () => {
  const backend = JSON.stringify({
    dsl_version: 1,
    inputs: { length: { default: 3, max: 50, min: 1, type: "integer" } },
    name: "Server average",
    plots: [{ color: "#22D3EE", series: "average" }],
    series: [{ length: "length", name: "average", op: "sma", source: "close" }],
    signals: [],
  });
  const adapted = modules.adaptBackendIndicatorJson(backend);
  assert.equal(adapted.diagnostics.length, 0);
  assert.match(adapted.source, /^indicator "Server average" pane/m);
  assert.ok(modules.parseEdgeIndicator(adapted.source).program);
  assert.ok(modules.executeEdgeIndicator({ bars, source: adapted.source }).plots[0].points.length > 0);
});

test("adapter rejects unsupported server nodes and never treats raw JSON as executable DSL", () => {
  const unsupported = modules.adaptBackendIndicatorJson(JSON.stringify({
    dsl_version: 1,
    inputs: {},
    name: "Signal artifact",
    plots: [{ series: "close" }],
    series: [],
    signals: [{ left: "close", name: "up", op: "above", right: "open" }],
  }));
  assert.equal(unsupported.source, null);
  assert.equal(unsupported.diagnostics[0].code, "E_ADAPTER_SIGNALS");
  assert.equal(modules.parseEdgeIndicator('{"dsl_version":1}').program, null);
});

test("the professional first-party DSL catalog compiles and remains broad", () => {
  assert.ok(modules.FIRST_PARTY_EDGE_INDICATORS.length >= 20);
  for (const indicator of modules.FIRST_PARTY_EDGE_INDICATORS) {
    assert.ok(modules.parseEdgeIndicator(indicator.source).program, indicator.name);
  }
});

test("the 60-day backtest is reproducible and records costs and source version", () => {
  const plot = bars.map((bar, index) => ({ time: bar.time, value: bar.close + Math.sin(index / 8) }));
  const config = { ...modules.DEFAULT_QUANT_BACKTEST_CONFIG, commissionBps: 2, slippageBps: 3 };
  const first = modules.runReproducibleIndicatorBacktest(bars, plot, config, 7);
  const second = modules.runReproducibleIndicatorBacktest(bars, plot, config, 7);
  assert.deepEqual(first, second);
  assert.equal(first.sourceVersion, 7);
  assert.match(first.sample.hash, /^fnv1a-/);
  assert.ok(first.assumptions.some((item) => item.includes("commission")));
});

test("Quant SSE frames expose incremental deltas and terminal status", () => {
  const delta = modules.parseQuantEventFrame('id: 2\nevent: delta\ndata: {"payload":{"delta":"live token"}}');
  assert.deepEqual(delta, { event: "delta", payload: { delta: "live token" } });
  const end = modules.parseQuantEventFrame('event: end\ndata: {"status":"completed"}');
  assert.deepEqual(end, { event: "end", payload: { status: "completed" } });
  assert.equal(modules.parseQuantEventFrame(": keep-alive"), null);
});

test("Quant chart analysis keeps confidence distinct from calibrated probability", () => {
  const analysis = modules.sanitizeQuantAnalysis({
    bias: "bullish",
    confidenceScore: 78,
    invalidation: "Acceptance below 5000",
    levels: [{ label: "Prior high", price: 5100, rationale: "Visible resistance" }],
    probability: null,
    probabilityBasis: "No calibrated outcome model was run.",
    riskWarning: "Decision support only.",
    summary: "Constructive while above support.",
    uncertainty: "Event risk can invalidate the setup.",
  });
  assert.equal(analysis.confidenceScore, 78);
  assert.equal(analysis.probability, null);
  assert.match(analysis.probabilityBasis, /No calibrated/);
  assert.equal(modules.sanitizeQuantAnalysis({ ...analysis, confidenceScore: 180 }).confidenceScore, 100);
});

test("analysis indicator semantics survive save and reach the live chart instance", () => {
  const source = [
    'indicator "Quant score" pane',
    'plot "Signal score" = roc(close, 5) color "#22d3ee"',
  ].join("\n");
  const quantSemantics = {
    modelProvenance: "offline-ai-fixture · offline-deterministic",
    probabilityLabel: "Probability unavailable",
    probabilityCalibrated: false,
    probabilityPlotName: null,
    probabilitySemantics: "No calibrated outcome model was run.",
    scoreLabel: "Live signal score",
    scorePlotName: "Signal score",
    scoreSemantics: "Runtime study value; not model confidence.",
  };
  const saved = modules.saveCustomIndicator([], {
    category: "custom", color: "#22d3ee", description: "Generated by Quant", id: "",
    inputs: {}, name: "Quant score", preview: "oscillator", quantSemantics, source,
    synonyms: ["quant"],
  });
  assert.deepEqual(saved.script.quantSemantics, quantSemantics);
  const instance = modules.createCustomIndicatorInstance(saved.script);
  assert.deepEqual(instance.customQuantSemantics, quantSemantics);
  const execution = modules.executeEdgeIndicator({ bars, source: instance.customScriptSource });
  assert.equal(execution.plots[0].name, quantSemantics.scorePlotName);
  assert.notEqual(execution.plots[0].points.at(-1).value, execution.plots[0].points.at(-2).value);
  assert.equal(instance.customQuantSemantics.probabilityPlotName, null);

  const compatible = modules.saveCustomIndicator(saved.scripts, {
    ...saved.script,
    description: "Edited without changing the mapped plot",
    source: source.replace("roc(close, 5)", "roc(close, 8)"),
  });
  assert.equal(compatible.script.revision, 2);
  assert.deepEqual(compatible.script.quantSemantics, quantSemantics);

  const incompatibleDraft = {
    ...compatible.script,
    source: compatible.script.source.replace('"Signal score"', '"Renamed score"'),
  };
  const blocked = modules.saveCustomIndicator(compatible.scripts, incompatibleDraft);
  assert.equal(blocked.script, undefined);
  assert.match(blocked.quantSemanticsWarning, /no longer matches a plot/);
  assert.deepEqual(blocked.scripts, compatible.scripts);

  const explicitlyCleared = modules.saveCustomIndicator(
    compatible.scripts,
    incompatibleDraft,
    { clearIncompatibleQuantSemantics: true },
  );
  assert.equal(explicitlyCleared.script.revision, 3);
  assert.equal(explicitlyCleared.script.quantSemantics, undefined);
});
