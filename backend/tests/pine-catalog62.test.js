import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";
import { refreshPineCatalog } from "../../scripts/refresh-pine-catalog.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const read = (name) => fs.readFileSync(path.join(root, name));
const json = (name) => JSON.parse(read(name));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const legacy = json("frontend/src/lib/pineCatalogManifest.json");
const expanded = json("frontend/src/lib/pineCatalogManifestV2.json");
const migrations = json("frontend/src/lib/pineCatalogMigrations.json").entries;
const added = expanded.entries.filter((entry) => !legacy.entries.some((old) => old.id === entry.id));
const bars = json("e2e/pine-visuals.bars.json");
assert.equal(sha(read("e2e/pine-visuals.bars.json")), "fc9a28c87aed819daae602ea45422d0d40979bd42f86097607310b0300645ea1");
const buildResult = await build({
  bundle: true, minify: true, format: "esm", platform: "browser", target: "es2020", write: false, logLevel: "silent",
  plugins: [createPineEnginePlugin()],
  define: { "import.meta.env": "{}" },
  stdin: {
    contents: 'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineCatalog.ts";',
    resolveDir: root, sourcefile: "pine-catalog62-fixture.ts", loader: "ts",
  },
});
const bundle = buildResult.outputFiles[0].text;
const pine = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const sourceOf = (entry) => read("frontend/public" + migrations.find((pin) => pin.catalogId === entry.id).sourcePath).toString();
const originalOf = (entry, catalog = expanded) => read(`frontend/public/catalog/pine/${catalog.entries.length === 21 ? "everget" : "everget-v2"}/${catalog.upstreamCommit}/${entry.path}`);
const run = (entry, inputs = {}) => pine.executePineRequest({
  id: "catalog62", action: "run", source: sourceOf(entry), inputs, bars,
  context: { symbol: "TEST", timeframe: "1", mintick: 0.01, pointvalue: 1 },
});
const defaults = {
  chande_momentum_oscillator: { Length: 9, "Overbought Level": 50, "Oversold Level": -50, "Highlight Overbought/Oversold Breakouts ?": true, Source: "close" },
  coppock_curve: { "Smoothing Length": 10, "Long ROC Length": 14, "Short ROC Length": 11, Source: "close" },
  tsi_true_strength_index: { "Long Length": 25, "Short Length": 13, "Signal Length": 13, Source: "close", "Overbought Level": 40, "Oversold Level": -40, "Max Level": 75, "Min Level": -75, "Show Histogram ?": false, "Highlight Overbought/Oversold Breakouts ?": true, "Highlight TSI/Signal Crossovers ?": true, "Highlight Zero Line Crossovers ?": true, "Apply Ribbon Filling ?": true },
  accumulation_distribution_line: { "Show Signal ?": true, "Signal Smoothing Type": "SMA", "Signal Smoothing Length": 21, "Highlight Crossovers ?": false, "Apply Ribbon Filling ?": true },
  price_volume_trend: { "Show Signal ?": true, "Signal Smoothing Type": "SMA", "Signal Smoothing Length": 21, Source: "close", "Highlight Crossovers ?": false, "Apply Ribbon Filling ?": true },
  momentum: {},
  rate_of_change: {},
  ulcer_index: { Length: 14, "Smoothing Length": 14, "Breakout Level": 1.5, "Signal Smoothing Type": "SMA", "Signal Smoothing Length": 52, Source: "close", "Show Signal ?": true, "Highlight Signal Crossovers ?": true, "Apply Ribbon Filling ?": true },
};
const changed = {
  chande_momentum_oscillator: { Length: 6, "Overbought Level": 20, "Oversold Level": -20, "Highlight Overbought/Oversold Breakouts ?": false, Source: "hlc3" },
  coppock_curve: { "Smoothing Length": 5, "Long ROC Length": 9, "Short ROC Length": 4, Source: "open" },
  tsi_true_strength_index: { "Long Length": 12, "Short Length": 5, "Signal Length": 4, Source: "hl2", "Overbought Level": 25, "Oversold Level": -25, "Max Level": 90, "Min Level": -90, "Show Histogram ?": true, "Highlight Overbought/Oversold Breakouts ?": false, "Highlight TSI/Signal Crossovers ?": false, "Highlight Zero Line Crossovers ?": false, "Apply Ribbon Filling ?": false },
  accumulation_distribution_line: { "Signal Smoothing Type": "EMA", "Signal Smoothing Length": 9, "Highlight Crossovers ?": true, "Apply Ribbon Filling ?": false },
  price_volume_trend: { "Signal Smoothing Type": "EMA", "Signal Smoothing Length": 9, Source: "open", "Highlight Crossovers ?": true, "Apply Ribbon Filling ?": false },
  ulcer_index: { Length: 8, "Smoothing Length": 5, "Breakout Level": 0.8, "Signal Smoothing Type": "EMA", "Signal Smoothing Length": 9, Source: "open", "Highlight Signal Crossovers ?": false, "Apply Ribbon Filling ?": false },
};
const nameOf = (entry) => path.basename(entry.path, ".pine");
const sum = (values) => values.reduce((a, b) => a + b, 0);
const rolling = (values, length, fn) => values.map((_, index) => {
  const sample = values.slice(Math.max(0, index - length + 1), index + 1);
  return sample.length === length && sample.every(Number.isFinite) ? fn(sample) : NaN;
});
const sma = (values, length) => rolling(values, length, (sample) => sum(sample) / length);
const wma = (values, length) => rolling(values, length, (sample) => sum(sample.map((value, index) => value * (index + 1))) / (length * (length + 1) / 2));
// Independent closed-form EMA; SMA initialization is the pinned engine contract,
// not a claim of TradingView startup parity. Mature values are also checked.
function ema(values, length) {
  const start = values.findIndex((_, index) => index >= length - 1 && values.slice(index - length + 1, index + 1).every(Number.isFinite));
  if (start < 0) return values.map(() => NaN);
  const seed = sum(values.slice(start - length + 1, start + 1)) / length;
  const a = 2 / (length + 1);
  return values.map((_, index) => index < start ? NaN : seed * (1 - a) ** (index - start)
    + sum(values.slice(start + 1, index + 1).map((value, j) => a * value * (1 - a) ** (index - start - j - 1))));
}
const change = (values, length = 1) => values.map((value, index) => index >= length ? value - values[index - length] : NaN);
const roc = (values, length) => change(values, length).map((value, index) => 100 * value / values[index - length]);
const cumulative = (values) => { let total = 0; return values.map((value) => { if (Number.isFinite(value)) total += value; return total; }); };
const inputSource = (alias) => bars.map((bar) => alias === "hl2" ? (bar.high + bar.low) / 2 : alias === "hlc3" ? (bar.high + bar.low + bar.close) / 3 : bar[alias]);
const legacyRed = "#FF5252";
const modernRed = legacyRed; // Authored v4 palette, not the changed v5 named-color palette.
const green = "#0EBB23";
const subtract = (a, b) => a.map((value, index) => value - b[index]);
function oracle(name, settings) {
  const get = (key) => settings[key];
  const src = inputSource(get("Source") ?? "close");
  if (name === "momentum") {
    const delta = change(src, 7);
    return { Simple: delta, "2": delta, "3": delta, "4": change(sma(src, 7)).map((value) => value * 7) };
  }
  if (name === "rate_of_change") {
    const delta = change(src, 7);
    return { "Built-in": roc(src, 7), "2": delta, "3": delta.map((value, index) => value / src[index - 7]), "4": roc(src, 7) };
  }
  if (name === "chande_momentum_oscillator") {
    const delta = change(src);
    const up = rolling(delta.map((value) => Math.max(value, 0)), get("Length"), sum);
    const down = rolling(delta.map((value) => -Math.min(value, 0)), get("Length"), sum);
    return { CMO: up.map((value, index) => 100 * (value - down[index]) / (value + down[index])) };
  }
  if (name === "coppock_curve") return { Coppock: wma(roc(src, get("Long ROC Length")).map((value, index) => value + roc(src, get("Short ROC Length"))[index]), get("Smoothing Length")) };
  if (name === "tsi_true_strength_index") {
    const delta = change(src);
    const numerator = ema(ema(delta, get("Long Length")), get("Short Length"));
    const denominator = ema(ema(delta.map(Math.abs), get("Long Length")), get("Short Length"));
    const tsi = numerator.map((value, index) => 100 * value / denominator[index]);
    const signal = ema(tsi, get("Signal Length"));
    return { TSI: tsi, Signal: signal, Histogram: subtract(tsi, signal).map((value) => get("Show Histogram ?") ? value : NaN) };
  }
  if (["accumulation_distribution_line", "price_volume_trend"].includes(name)) {
    const values = name === "accumulation_distribution_line"
      ? cumulative(bars.map((bar) => bar.high === bar.low ? 0 : bar.volume * (2 * bar.close - bar.low - bar.high) / (bar.high - bar.low)))
      : cumulative(change(bars.map((bar) => bar.close)).map((value, index) => value / bars[index - 1]?.close * bars[index].volume));
    const signal = get("Signal Smoothing Type") === "EMA" ? ema(values, get("Signal Smoothing Length")) : sma(values, get("Signal Smoothing Length"));
    return { [name === "price_volume_trend" ? "PVT" : "Accum/Dist"]: values, Signal: signal.map((value) => get("Show Signal ?") ? value : NaN) };
  }
  assert.equal(name, "ulcer_index");
  // Complete-window initialization follows pinned ta.highest; mature maxima
  // and drawdown/RMS calculations are independent of the runtime.
  const highest = rolling(src, get("Length"), (sample) => Math.max(...sample));
  const squared = src.map((value, index) => (100 * (value - highest[index]) / highest[index]) ** 2);
  const ulcer = sma(squared, get("Smoothing Length")).map(Math.sqrt);
  const signal = get("Signal Smoothing Type") === "EMA" ? ema(ulcer, get("Signal Smoothing Length")) : sma(ulcer, get("Signal Smoothing Length"));
  return { Ulcer: ulcer, Signal: signal.map((value) => get("Show Signal ?") ? value : NaN) };
}
function colorFor(name, plotName, expected, settings, index) {
  const value = expected[plotName][index];
  if (name === "momentum" || name === "rate_of_change") return { Simple: "#2196F3", "Built-in": "#2196F3", "2": "#4CAF50", "3": legacyRed, "4": "#9C27B0" }[plotName];
  if (name === "chande_momentum_oscillator") return value > settings["Overbought Level"] ? green : value < settings["Oversold Level"] ? "#FF0000" : "#F4B77D";
  if (name === "coppock_curve") return value > 0 ? green : legacyRed;
  if (name === "tsi_true_strength_index") {
    if (plotName === "Histogram") {
      const hist = subtract(expected.TSI, expected.Signal);
      return hist[index] >= 0 ? hist[index - 1] < hist[index] ? "#26A69A" : "#B2DFDB" : hist[index - 1] < hist[index] ? "#FFCDD2" : "#EF5350";
    }
    return settings["Apply Ribbon Filling ?"] ? expected.TSI[index] > expected.Signal[index] ? green : modernRed : plotName === "TSI" ? "#FF3E7D" : "#3C78D8";
  }
  if (name === "ulcer_index") return settings["Apply Ribbon Filling ?"]
    ? expected.Ulcer[index] > expected.Signal[index] ? green : modernRed
    : plotName === "Signal" ? "#1155CC" : expected.Ulcer[index] >= expected.Ulcer[index - 1] ? green : modernRed;
  const main = name === "price_volume_trend" ? "PVT" : "Accum/Dist";
  return settings["Apply Ribbon Filling ?"] ? expected[main][index] > expected.Signal[index] ? green : name === "price_volume_trend" ? modernRed : legacyRed : plotName === "Signal" ? "#FF6A00" : "#0094FF";
}
function verify(result, name, settings) {
  const expected = oracle(name, settings);
  for (const [plotName, values] of Object.entries(expected)) {
    const plot = result.plots.find((item) => item.name === plotName);
    assert.ok(plot, `${name}: missing ${plotName}`);
    assert.equal(plot.points.length, bars.length);
    let finiteCount = 0;
    for (let index = 0; index < bars.length; index++) {
      const point = plot.points[index];
      assert.equal(point.time, bars[index].time);
      if (Number.isFinite(values[index])) {
        finiteCount++;
        assert.ok(Math.abs(point.value - values[index]) <= 1e-6, `${name}/${plotName} at ${index}: actual ${point.value}, expected ${values[index]}`);
      } else assert.equal(point.value, null, `${name}/${plotName} null at ${index}`);
      const actualColor = String(point.options.color ?? plot.options.color).toUpperCase().replace(/FF$/, (suffix) => /^#[A-F0-9]{8}$/.test(String(point.options.color ?? plot.options.color).toUpperCase()) ? "" : suffix);
      assert.equal(actualColor, colorFor(name, plotName, expected, settings, index), `${name}/${plotName} color at ${index}`);
    }
    assert.ok(finiteCount > 50 || plotName === "Histogram" && !settings["Show Histogram ?"] || plotName === "Signal" && !settings["Show Signal ?"]);
  }
  if (name === "tsi_true_strength_index" || name === "ulcer_index") {
    const background = result.plots.find((plot) => plot.style === "background");
    assert.ok(background);
    for (let index = 0; index < bars.length; index++) {
      const expectedColor = name === "tsi_true_strength_index"
        ? settings["Highlight Zero Line Crossovers ?"] ? expected.TSI[index] > 0 ? "#4CAF501A" : "#FF52521A" : "#FFFFFF00"
        : expected.Ulcer[index] > settings["Breakout Level"] ? "#FF98001A" : null;
      assert.equal(background.points[index].options.color?.toUpperCase() ?? null, expectedColor, `${name} background alpha/na at ${index}`);
    }
  }
  const crossingName = name === "tsi_true_strength_index" ? "Highlight TSI/Signal Crossovers ?" : name === "ulcer_index" ? "Highlight Signal Crossovers ?" : "Highlight Crossovers ?";
  if (Object.hasOwn(settings, crossingName)) {
    const visible = oracle(name, { ...settings, "Show Signal ?": true });
    const mainName = name === "tsi_true_strength_index" ? "TSI" : name === "ulcer_index" ? "Ulcer" : name === "price_volume_trend" ? "PVT" : "Accum/Dist";
    for (const [direction, title] of [[1, name === "tsi_true_strength_index" ? "TSI/Signal Crossover" : "Crossover"], [-1, name === "tsi_true_strength_index" ? "TSI/Signal Crossunder" : "Crossunder"]]) {
      const marker = result.plots.find((plot) => plot.name === title);
      assert.ok(marker);
      for (let index = 0; index < bars.length; index++) {
        const crossed = index > 0 && Number.isFinite(visible.Signal[index - 1]) && settings[crossingName]
          && direction * (visible[mainName][index] - visible.Signal[index]) > 0
          && direction * (visible[mainName][index - 1] - visible.Signal[index - 1]) <= 0;
        const value = crossed ? visible[name === "ulcer_index" ? "Signal" : mainName][index] : null;
        assert.ok(value === null ? marker.points[index].value === null : Math.abs(marker.points[index].value - value) <= 1e-6, `${name} ${title} at ${index}`);
        const markerColor = String(marker.points[index].options.color ?? marker.options.color).toUpperCase();
        assert.equal(markerColor.length === 9 && markerColor.endsWith("FF") ? markerColor.slice(0, 7) : markerColor, direction === 1 ? "#4CAF50" : legacyRed);
      }
    }
  }
  assert.equal(result.source, sourceOf(added.find((entry) => nameOf(entry) === name)));
  assert.equal(result.pineVersion, 5);
  assert.equal(result.audit.engine, "PineTS");
  assert.equal(result.audit.bars, bars.length);
  return expected;
}
for (const entry of added) {
  test(`${entry.name}: independent original formulas, defaults and changed inputs/colors`, async () => {
    const name = nameOf(entry);
    const initial = await run(entry);
    const definitions = Object.fromEntries(initial.inputDefinitions.map((definition) => [definition.title || definition.name, definition.defval]));
    assert.deepEqual(definitions, defaults[name]);
    verify(initial, name, defaults[name]);
    if (!Object.keys(defaults[name]).length) return;
    const settings = { ...defaults[name], ...changed[name] };
    const inputs = Object.fromEntries(initial.inputDefinitions.map((definition) => [definition.id, settings[definition.title || definition.name]]));
    const custom = await run(entry, inputs);
    verify(custom, name, settings);
    if (name === "price_volume_trend") {
      const sourceOnly = await run(entry, { [initial.inputDefinitions.find((definition) => definition.title === "Source").id]: "open" });
      assert.deepEqual(sourceOnly.plots.find((plot) => plot.name === "PVT").points.map((point) => point.value), initial.plots.find((plot) => plot.name === "PVT").points.map((point) => point.value), "The original Source declaration is unused by built-in PVT.");
    }
    if (Object.hasOwn(settings, "Show Signal ?")) {
      const hidden = await run(entry, { ...inputs, [initial.inputDefinitions.find((definition) => definition.title === "Show Signal ?").id]: false });
      verify(hidden, name, { ...settings, "Show Signal ?": false });
    }
  });
}

function files(directory) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1).flatMap((entry) => {
    const relative = `${directory}/${entry.name}`;
    return entry.isDirectory() ? files(relative) : [relative];
  });
}
test("old 44 assets and 17 pins stay byte-identical; all added originals/derivatives retain provenance", async () => {
  const paths = ["frontend/src/lib/pineCatalogManifest.json", ...files("frontend/public/catalog/pine/everget"), ...files("frontend/public/catalog/pine/migrations/v1")];
  const receipt = paths.map((relative) => ({ path: relative, bytes: read(relative).length, sha256: sha(read(relative)) }));
  assert.equal(paths.length, 44);
  assert.equal(sha(JSON.stringify(receipt)), "4a2ffee31dfc93f0bb05612ec48fcbc104a5e7c1527d8c65c822b4ca9ada1913");
  assert.equal(sha(JSON.stringify(migrations.slice(0, 17))), "6a5c1e2e4e50a84a3fb394a1b5665d9c9d090689a3236c3dd12eddc12b264638");
  assert.equal(added.length, 8);
  assert.equal(migrations.length, 25);
  for (const entry of added) {
    const bytes = originalOf(entry);
    assert.equal(sha(bytes), entry.sourceSha256);
    assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), entry.upstreamBlobSha1);
    assert.equal(bytes.length, entry.sourceBytes);
    const pin = pine.pineCatalogMigration(expanded, entry.id);
    assert.equal(sha(Buffer.from(sourceOf(entry))), pin.sourceSha256);
    assert.ok(sourceOf(entry).includes(entry.copyright));
    assert.ok(sourceOf(entry).includes(entry.licenseNotice));
    assert.ok(sourceOf(entry).includes(`${expanded.upstreamCommit}/${entry.path}`));
  }
  console.info("CATALOG62_BINDING " + JSON.stringify({ minify: true, bundleSha256: sha(bundle), bundleBytes: Buffer.byteLength(bundle), engineManifestSha256: sha(read("frontend/vendor/pinets/manifest.json")), legacyFilesSha256: sha(JSON.stringify(receipt)), originalPinsSha256: sha(JSON.stringify(migrations.slice(0, 17))) }));
});

test("runtime infers only complete legacy or expanded roots and rejects changed pins before fetch", async () => {
  assert.equal(pine.CURATED_PINE_CATALOG.entries.length, 29);
  assert.equal(pine.validatePineCatalogManifest(legacy).entries.length, 21);
  const malformed = [expanded.entries.slice(1), [...legacy.entries.slice(1), added[0]], [...expanded.entries.slice(1), expanded.entries[1]]];
  for (const entries of malformed) assert.throws(() => pine.validatePineCatalogManifest({ ...expanded, entries }));
  const forged = structuredClone(expanded);
  forged.entries.at(-1).sourceSha256 = "0".repeat(64);
  let requests = 0;
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    requests++;
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-cache");
    return new Response(read("frontend/public" + url));
  };
  try {
    await assert.rejects(pine.loadPineCatalogSource(forged, forged.entries.at(-1).id));
    assert.equal(requests, 0);
    for (const catalog of [legacy, expanded]) {
      const entry = catalog.entries.at(-1);
      const loaded = await pine.loadPineCatalogSource(catalog, entry.id);
      assert.equal(loaded.source, originalOf(entry, catalog).toString());
      assert.equal(loaded.provenance.collection, catalog === expanded ? "expanded-v2" : undefined);
      assert.equal(pine.sanitizePineCatalogProvenance(loaded.provenance)?.catalogId, entry.id);
      assert.equal(pine.pineCatalogProvenanceLicenseUrl(loaded.provenance), `/catalog/pine/${catalog === expanded ? "everget-v2" : "everget"}/${catalog.upstreamCommit}/LICENSE.txt`);
    }
    assert.equal((await pine.loadPineCatalog()).entries.length, 29);
  } finally { globalThis.fetch = previous; }
});

test("source tampering, chunked overflow and changed seed refetch cannot publish an import", async () => {
  const previous = globalThis.fetch;
  const entry = added[0];
  try {
    globalThis.fetch = async () => new Response(Buffer.concat([originalOf(entry), Buffer.from("\n// tampered")]));
    await assert.rejects(pine.loadPineCatalogMigration(expanded, entry.id), /pinned revision|pinned source|pinned/);
    let reads = 0;
    let cancelled = false;
    globalThis.fetch = async () => new Response(new ReadableStream({
      pull(controller) { reads++; controller.enqueue(new Uint8Array(12_000)); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 }));
    await assert.rejects(pine.loadPineCatalogSource(expanded, entry.id));
    assert.equal(reads, 2);
    assert.equal(cancelled, true);
    const forged = structuredClone(expanded);
    forged.entries[0].name = "Forged source title";
    globalThis.fetch = async (url) => new Response(JSON.stringify(url.endsWith("index.json")
      ? { schemaVersion: 1, repository: expanded.repository, revisions: [expanded.upstreamCommit] } : forged));
    await assert.rejects(pine.loadPineCatalog(), /Pinned seed/);
  } finally { globalThis.fetch = previous; }
});

test("explicit refetch collections append isolated complete revisions and reject substituted seed bytes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pine-catalog62-"));
  try {
    for (const [collection, catalog] of [["legacy-v1", legacy], ["expanded-v2", expanded]]) {
      const outputDir = path.join(directory, collection);
      const requests = [];
      const fetchImpl = async (url, options) => {
        assert.equal(options.redirect, "error");
        const prefix = `https://raw.githubusercontent.com/${catalog.repository}/${catalog.upstreamCommit}/`;
        assert.ok(url.startsWith(prefix));
        const relative = url.slice(prefix.length);
        requests.push(relative);
        const assetRoot = catalog === expanded ? "everget-v2" : "everget";
        return new Response(read(`frontend/public/catalog/pine/${assetRoot}/${catalog.upstreamCommit}/${relative === "LICENSE" ? "LICENSE.txt" : relative}`));
      };
      const refreshed = await refreshPineCatalog({ collection, commit: catalog.upstreamCommit, outputDir, fetchImpl });
      assert.deepEqual(refreshed.entries, catalog.entries);
      assert.equal(requests.length, catalog.entries.length + 1);
      await refreshPineCatalog({ collection, commit: catalog.upstreamCommit, outputDir, fetchImpl: () => { throw new Error("Immutable refetch must not fetch."); } });
      const rejectedDir = path.join(directory, collection + "-rejected");
      await assert.rejects(refreshPineCatalog({ collection, commit: catalog.upstreamCommit, outputDir: rejectedDir, fetchImpl: async (url, options) => {
        const response = await fetchImpl(url, options);
        return url.endsWith(catalog.entries[0].path) ? new Response(Buffer.concat([Buffer.from(await response.arrayBuffer()), Buffer.from("\n// substituted")])) : response;
      } }), /pinned seed/);
      assert.deepEqual(fs.readdirSync(rejectedDir), []);
    }
    await assert.rejects(refreshPineCatalog({ collection: "unknown", outputDir: directory }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
