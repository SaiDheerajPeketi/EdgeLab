import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";
import { buildSync } from "esbuild";

const directory = mkdtempSync(path.join(tmpdir(), "edgelab-pine-persistence-"));
const bundle = path.join(directory, "persistence.mjs");
buildSync({ entryPoints: ["frontend/src/lib/customIndicators.ts"], outfile: bundle, bundle: true, platform: "node", format: "esm", target: "node22", define: { "import.meta.env": "{}" }, logLevel: "silent" });
const lib = await import(pathToFileURL(bundle).href);
after(() => rmSync(directory, { recursive: true, force: true }));

const prepared = (source = lib.DEFAULT_PINE_INDICATOR_SOURCE) => ({
  kind: "prepare", source, language: "pine", pineVersion: 6,
  declaration: "indicator", name: "My Pine EMA", overlay: true,
  inputDefinitions: [{ id: "in_0", name: "EMA length", type: "int", defval: 20, minval: 1, maxval: 500 }], diagnostics: [],
});
const draft = (source = lib.DEFAULT_PINE_INDICATOR_SOURCE) => ({
  category: "custom", color: "#32d3ee", description: "Native EMA", id: "", inputs: { in_0: 33 },
  name: "My Pine EMA", preview: "trend", source, synonyms: ["ema"],
});

test("native save requires successful metadata bound to the exact source", () => {
  assert.equal(lib.saveCustomIndicator([], draft()).script, undefined);
  assert.equal(lib.saveCustomIndicator([], draft(), { pinePrepared: prepared("//@version=6\nindicator(\"Other\")") }).script, undefined);
  assert.equal(lib.saveCustomIndicator([], draft(), { pinePrepared: { ...prepared(), diagnostics: [{ code: "BAD", line: 1, column: 1, severity: "error", message: "failed" }] } }).script, undefined);
  const saved = lib.saveCustomIndicator([], draft(), { pinePrepared: prepared() });
  assert.equal(saved.script.pinePrepared.source, saved.script.source);
  assert.deepEqual(saved.script.inputs, { in_0: 33 });
});

test("native reload and chart instances preserve metadata and inputs without evaluating source", () => {
  const source = lib.DEFAULT_PINE_INDICATOR_SOURCE + "\n// globalThis.__pineReloadExecuted = true";
  const saved = lib.saveCustomIndicator([], draft(source), { pinePrepared: prepared(source) });
  const loaded = lib.sanitizeCustomIndicators(JSON.parse(JSON.stringify(saved.scripts)));
  assert.equal(loaded.length, 1);
  assert.equal(globalThis.__pineReloadExecuted, undefined);
  const instance = lib.createCustomIndicatorInstance(loaded[0]);
  assert.equal(instance.runtimeError, null);
  assert.deepEqual(instance.customPinePrepared, loaded[0].pinePrepared);
  assert.deepEqual(instance.settings.customInputs, { in_0: 33 });
  assert.equal(lib.sanitizeCustomIndicators([{ ...saved.script, source: source + "\n// changed" }]).length, 0);
});

test("native duplicate keeps source syntax and metadata binding across reload", () => {
  const saved = lib.saveCustomIndicator([], draft(), { pinePrepared: prepared() });
  const duplicate = lib.duplicateCustomIndicator(saved.script);
  assert.notEqual(duplicate.id, saved.script.id);
  assert.equal(duplicate.source, saved.script.source);
  assert.equal(duplicate.pinePrepared.source, duplicate.source);
  assert.equal(duplicate.revision, 1);
  assert.equal(lib.sanitizeCustomIndicators([duplicate])[0].name, "My Pine EMA copy");
  const resaved = lib.saveCustomIndicator([duplicate], duplicate, { pinePrepared: duplicate.pinePrepared });
  assert.equal(resaved.script.name, "My Pine EMA copy");
  assert.equal(lib.sanitizeCustomIndicators(resaved.scripts)[0].name, "My Pine EMA copy");
  const renamedSource = duplicate.source.replace('"My Pine EMA"', '"New title"');
  const renamed = lib.saveCustomIndicator(resaved.scripts, { ...resaved.script, source: renamedSource }, { pinePrepared: { ...prepared(renamedSource), name: "New title" } });
  assert.equal(renamed.script.name, "New title");
});

test("native revisions retain original sources and reject oversized UTF-8 metadata", () => {
  const first = lib.saveCustomIndicator([], draft(), { pinePrepared: prepared() });
  const source = first.script.source.replace("input.int(20", "input.int(30");
  const second = lib.saveCustomIndicator(first.scripts, { ...first.script, source }, { pinePrepared: prepared(source) });
  assert.equal(second.script.revision, 2);
  assert.equal(second.script.versions[0].source, first.script.source);
  const oversized = "//@version=6\n//" + "é".repeat(10000);
  assert.equal(lib.sanitizePinePrepared(prepared(oversized), oversized), undefined);
  assert.equal(lib.sanitizeCustomIndicators([{ ...second.script, source: oversized, pinePrepared: prepared(oversized) }]).length, 0);
  assert.equal(lib.isPineScriptSource("// License\n//@version=99\nindicator(\"Wrong\")"), true);
  assert.equal(lib.saveCustomIndicator([], draft("//@version=99\nindicator(\"Wrong\")"), { pinePrepared: prepared() }).script, undefined);
});

test("converting Quant to native Pine requires explicit label removal", () => {
  const quantSemantics = { modelProvenance: "fixture", probabilityLabel: "Unavailable", probabilityCalibrated: false, probabilityPlotName: null, probabilitySemantics: "No model", scoreLabel: "Score", scorePlotName: "Score", scoreSemantics: "Runtime score" };
  const legacy = lib.saveCustomIndicator([], { ...draft(), source: 'indicator "Quant" pane\nplot "Score" = close color "#32d3ee"', quantSemantics });
  const conversion = { ...legacy.script, source: lib.DEFAULT_PINE_INDICATOR_SOURCE };
  const blocked = lib.saveCustomIndicator(legacy.scripts, conversion, { pinePrepared: prepared() });
  assert.equal(blocked.script, undefined);
  assert.match(blocked.quantSemanticsWarning, /Confirm clearing/);
  const accepted = lib.saveCustomIndicator(legacy.scripts, conversion, { pinePrepared: prepared(), clearIncompatibleQuantSemantics: true });
  assert.equal(accepted.script.quantSemantics, undefined);
  assert.equal(accepted.script.revision, 2);
  assert.equal(accepted.script.versions[0].source, legacy.script.source);
});

test("chart context translates EdgeLab timeframes without inventing instrument metadata", () => {
  for (const [chart, native] of [["1m", "1"], ["5m", "5"], ["1h", "60"], ["4H", "240"], ["1D", "1D"], ["1W", "1W"], ["1M", "1M"]]) {
    assert.deepEqual(lib.pineContextForChart("ES", chart), { symbol: "ES", timeframe: native });
  }
  assert.throws(() => lib.pineContextForChart("ES", "bad"));
  assert.throws(() => lib.pineContextForChart("", "1m"));
});

test("starter indicator and strategy prepare and execute in the native engine", async () => {
  const workerBundle = buildSync({ entryPoints: ["frontend/src/workers/pineNative.worker.ts"], bundle: true, platform: "browser", format: "esm", target: "es2020", write: false, logLevel: "silent" }).outputFiles[0].text;
  const pine = await import(`data:text/javascript;base64,${Buffer.from(workerBundle).toString("base64")}`);
  const bars = Array.from({ length: 180 }, (_, index) => {
    const close = 100 + Math.sin(index / 8) * 12;
    return { time: 1700000040 + index * 60, open: close, high: close + 1, low: close - 1, close, volume: 100 };
  });
  for (const [source, declaration, plots] of [[lib.DEFAULT_PINE_INDICATOR_SOURCE, "indicator", 1], [lib.DEFAULT_PINE_STRATEGY_SOURCE, "strategy", 2]]) {
    const metadata = await pine.executePineRequest({ id: "starter", action: "prepare", source });
    assert.equal(metadata.declaration, declaration);
    assert.ok(metadata.inputDefinitions.length >= 2);
    assert.ok(lib.sanitizePinePrepared(metadata, source));
    const result = await pine.executePineRequest({ id: "starter", action: "run", source, bars, context: lib.pineContextForChart("TEST", "1m") });
    assert.equal(result.plots.length, plots);
    assert.equal(result.plots[0].points.length, bars.length);
    if (declaration === "strategy") assert.ok(result.strategy.closedTrades.length > 0);
  }
});

test("native settings reject wrong types, non-finite numbers, bounds, options and undeclared inputs before saving", () => {
  for (const inputs of [{ in_0: 0 }, { in_0: 501 }, { in_0: 2.5 }, { in_0: "33" }, { in_0: Infinity }, { in_99: 33 }]) {
    const saved = lib.saveCustomIndicator([], { ...draft(), inputs }, { pinePrepared: prepared() });
    assert.equal(saved.script, undefined);
    assert.equal(saved.diagnostics[0].severity, "error");
    assert.ok(saved.diagnostics[0].message);
  }
  const choice = { ...prepared(), inputDefinitions: [{ id: "in_0", name: "Choice", type: "string", defval: "one", options: ["one", "two"] }] };
  assert.equal(lib.saveCustomIndicator([], { ...draft(), inputs: { in_0: "three" } }, { pinePrepared: choice }).script, undefined);
  assert.ok(lib.saveCustomIndicator([], { ...draft(), inputs: {} }, { pinePrepared: prepared() }).script);
  const saved = lib.saveCustomIndicator([], draft(), { pinePrepared: prepared() });
  assert.equal(lib.sanitizeCustomIndicators([{ ...saved.script, inputs: { in_0: -1 } }]).length, 0);
});
