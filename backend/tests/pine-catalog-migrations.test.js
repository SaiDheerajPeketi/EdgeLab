import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const root = fileURLToPath(new URL("../..", import.meta.url));
const bundle = buildSync({ bundle: true, format: "esm", platform: "browser", write: false, logLevel: "silent", stdin: {
  contents: 'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pinePacked.ts"; export { PineTS, Indicator } from "pinets";',
  loader: "ts", resolveDir: root, sourcefile: "migration-oracles.ts",
} }).outputFiles[0].text;
const pine = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const read = (path) => readFileSync(root + "/" + path, "utf8");
const manifest = JSON.parse(read("frontend/src/lib/pineCatalogManifest.json"));
const migrations = JSON.parse(read("frontend/src/lib/pineCatalogMigrations.json"));
const bars = JSON.parse(read("e2e/pine-visuals.bars.json"));
assert.equal(createHash("sha256").update(readFileSync(root + "/e2e/pine-visuals.bars.json")).digest("hex"), "fc9a28c87aed819daae602ea45422d0d40979bd42f86097607310b0300645ea1");
const sourceOf = (entry) => read("frontend/public" + entry.sourcePath);
const native = (source, inputs = {}) => pine.executePineRequest({ id: "migration-oracle", action: "run", source, inputs, bars,
  context: { symbol: "TEST", timeframe: "1", mintick: 0.01, pointvalue: 1 } });
async function raw(source, inputs) {
  const data = bars.map((b) => ({ ...b, openTime: b.time * 1000, closeTime: (b.time + 60) * 1000 }));
  const engine = new pine.PineTS(data, "TEST", "1", data.length);
  engine.setTimezone("UTC"); engine.setMaxLoops(10000);
  return engine.run(new pine.Indicator(source, inputs));
}
const finite = Number.isFinite;
const sum = (values) => values.reduce((a, b) => a + b, 0);
const mean = (values) => sum(values) / values.length;
const windowed = (values, length, f) => values.map((_, i) => {
  const sample = values.slice(i - length + 1, i + 1);
  return i >= length - 1 && sample.every(finite) ? f(sample) : NaN;
});
const sma = (v, n) => windowed(v, n, mean);
const wma = (v, n) => windowed(v, n, (a) => sum(a.map((x, j) => x * (j + 1))) / (n * (n + 1) / 2));
// Closed-form exponentially weighted sum, independent of the engine's mutable EMA state.
// Its SMA initialization is the pinned local runtime contract, not a TradingView oracle.
function smooth(v, n, alpha = 2 / (n + 1)) {
  const start = v.findIndex((_, i) => i >= n - 1 && v.slice(i - n + 1, i + 1).every(finite));
  if (start < 0) return v.map(() => NaN);
  const seed = mean(v.slice(start - n + 1, start + 1));
  return v.map((_, i) => i < start ? NaN : seed * (1 - alpha) ** (i - start)
    + sum(v.slice(start + 1, i + 1).map((x, j) => alpha * x * (1 - alpha) ** (i - start - j - 1))));
}
const diff = (v) => v.map((x, i) => i ? x - v[i - 1] : NaN);
const cumulative = (v) => { let total = 0; return v.map((x) => finite(x) ? (total += x) : NaN); };
function source(alias) {
  const close = bars.map((b) => b.close);
  if (["open", "high", "low", "close", "volume"].includes(alias)) return bars.map((b) => b[alias]);
  if (alias === "acc/dist") return cumulative(bars.map((b) => b.high === b.low ? 0 : b.volume * (2 * b.close - b.low - b.high) / (b.high - b.low)));
  if (alias === "on balance volume") return cumulative(diff(close).map((x, i) => Math.sign(x) * bars[i].volume));
  if (alias === "price volume trend") return cumulative(diff(close).map((x, i) => x / close[i - 1] * bars[i].volume));
  return bars.map((b, i) => {
    const previous = bars[i - 1];
    const aliases = { oo2: (b.open + (previous?.open ?? 0)) / 2, oh2: (b.open + b.high) / 2,
      ol2: (b.open + b.low) / 2, oc2: (b.open + b.close) / 2, hh2: (b.high + (previous?.high ?? 0)) / 2,
      hl2: (b.high + b.low) / 2, hc2: (b.high + b.close) / 2, ll2: (b.low + (previous?.low ?? 0)) / 2,
      lc2: (b.low + b.close) / 2, cc2: (b.close + (previous?.close ?? 0)) / 2,
      hlc3: (b.high + b.low + b.close) / 3, ohlc4: (b.open + b.high + b.low + b.close) / 4,
      wc: (2 * b.close + b.high + b.low) / 4 };
    assert.ok(Object.hasOwn(aliases, alias), alias); return aliases[alias];
  });
}
const minus = (a, b) => a.map((x, i) => x - b[i]);
const rsi = (v, n) => {
  const changes = diff(v), gains = smooth(changes.map((x) => finite(x) ? Math.max(0, x) : NaN), n, 1 / n);
  const losses = smooth(changes.map((x) => finite(x) ? Math.max(0, -x) : NaN), n, 1 / n);
  return gains.map((x, i) => !finite(x) ? NaN : losses[i] === 0 ? 100 : 100 - 100 / (1 + x / losses[i]));
};
function oracle(name, settings) {
  const get = (key) => settings[key], n = get("Length"), v = source(get("Source") ?? "close");
  if (name === "simple_moving_average") return { SMA: sma(v, n) };
  if (name === "weighted_moving_average") return { WMA: wma(v, n) };
  if (name === "exponential_moving_average") return { EMA: smooth(v, n) };
  if (name === "hull_moving_average") return { HMA: wma(minus(wma(v, Math.floor(n / 2)).map((x) => 2 * x), wma(v, n)), Math.round(Math.sqrt(n))) };
  if (name === "double_exponential_moving_average") { const e = smooth(v, n); return { DEMA: minus(e.map((x) => 2 * x), smooth(e, n)) }; }
  if (name === "t3_moving_average") {
    // Compose generalized exponential filters using the independent closed-form
    // smoother. SMA warm-up at each stage prevents an equivalent six-power
    // expansion from sharing the same initial conditions.
    const factor = get("Factor");
    let filtered = v;
    for (let stage = 0; stage < 3; stage++) {
      const first = smooth(filtered, n), second = smooth(first, n);
      filtered = first.map((x, i) => (1 + factor) * x - factor * second[i]);
    }
    return { T3: filtered };
  }
  if (name === "zero_lag_exponential_moving_average") return { ZLEMA: smooth(v.map((x, i) => 2 * x - v[i - Math.floor((n - 1) / 2)]), n) };
  if (name === "arnaud_legoux_moving_average") {
    const weights = Array.from({ length: n }, (_, j) => Math.exp(-((j - get("Offset") * (n - 1)) ** 2) / (2 * (n / get("Sigma")) ** 2)));
    return { ALMA: windowed(v, n, (a) => sum(a.map((x, j) => x * weights[j])) / sum(weights)) };
  }
  if (name === "kaufman_adaptive_moving_average") {
    let previous = NaN;
    return { KAMA: v.map((x, i) => {
      // Pinned math.sum returns zero until its full window is available.
      const travel = i < n ? 0 : sum(diff(v).slice(i - n + 1, i + 1).map(Math.abs));
      const efficiency = travel ? Math.abs(x - v[i - n]) / travel : 0;
      const slow = 2 / (get("Slow EMA Length") + 1), fast = 2 / (get("Fast EMA Length") + 1);
      const alpha = (slow + efficiency * (fast - slow)) ** 2;
      previous = alpha * x + (1 - alpha) * (finite(previous) ? previous : x); return previous;
    }) };
  }
  if (name === "rsi_relative_strength_index") return { RSI: rsi(v, n) };
  if (name === "cci_commodity_channel_index") {
    // Preserve upstream's local-zero PVT branch instead of silently repairing it to close PVT.
    if (get("Source") === "price volume trend") return { CCI: v.map(() => NaN) };
    const averages = sma(v, n), deviation = windowed(v, n, (a) => mean(a.map((x) => Math.abs(x - mean(a)))));
    return { CCI: v.map((x, i) => (x - averages[i]) / (0.015 * deviation[i])) };
  }
  if (name === "stochastic") {
    const length = get("K"), lows = windowed(source("low"), length, (a) => Math.min(...a)), highs = windowed(source("high"), length, (a) => Math.max(...a));
    const k = sma(v.map((x, i) => 100 * (x - lows[i]) / (highs[i] - lows[i])), get("Smooth"));
    const d = sma(k, get("D"));
    return { "%K": k, "%D": d, Histogram: get("Show Histogram ?") ? minus(k, d) : v.map(() => NaN) };
  }
  if (name === "mfi_money_flow_index") {
    const changes = diff(v), money = v.map((x, i) => x * bars[i].volume);
    const up = windowed(money.map((x, i) => changes[i] <= 0 ? 0 : x), n, sum);
    const down = windowed(money.map((x, i) => changes[i] >= 0 ? 0 : x), n, sum);
    const mfi = up.map((x, i) => down[i] === 0 ? 100 : 100 - 100 / (1 + x / down[i]));
    const signal = smooth(mfi, get("Signal Length"));
    return { MFI: mfi, Signal: signal, Histogram: get("Show Histogram ?") ? minus(mfi, signal) : v.map(() => NaN) };
  }
  if (name === "awesome_oscillator") return { AO: minus(sma(source("hl2"), get("Fast Length")), sma(source("hl2"), get("Slow Length"))) };
  if (name === "percentage_price_oscillator") {
    const slow = smooth(v, get("Slow Length")), ppo = minus(smooth(v, get("Fast Length")), slow).map((x, i) => 100 * x / slow[i]), signal = smooth(ppo, get("Signal Length"));
    return { PPO: ppo, Signal: signal, Histogram: minus(ppo, signal) };
  }
  if (name === "trix") {
    const triple = smooth(smooth(smooth(v, n), n), n), trix = diff(triple).map((x, i) => get("TRIX Value Multiplier") * 100 * x / triple[i - 1]);
    const signal = get("Signal Smoothing Type") === "EMA" ? smooth(trix, get("Signal Smoothing Length")) : sma(trix, get("Signal Smoothing Length"));
    return { TRIX: trix, Signal: get("Show Signal Line ?") ? signal : v.map(() => NaN), Histogram: get("Show Histogram ?") ? minus(trix, signal) : v.map(() => NaN) };
  }
  if (name === "on_balance_volume") {
    const obv = cumulative(diff(v).map((x, i) => Math.sign(x) * bars[i].volume));
    const signal = get("Signal Smoothing Type") === "EMA" ? smooth(obv, get("Signal Smoothing Length")) : sma(obv, get("Signal Smoothing Length"));
    return { OBV: obv, Signal: get("Show Signal ?") ? signal : v.map(() => NaN) };
  }
  assert.fail("Missing independent formula: " + name);
}
const custom = {
  hull_moving_average: { Length: 9, Source: "hl2" },
  exponential_moving_average: { Length: 9, Source: "hl2" }, simple_moving_average: { Length: 9, Source: "hl2" },
  weighted_moving_average: { Length: 9, Source: "hl2" }, double_exponential_moving_average: { Length: 9, Source: "hl2" },
  t3_moving_average: { Length: 7, Factor: 0.4, Source: "hlc3", "Highlight ?": false },
  kaufman_adaptive_moving_average: { Length: 10, "Fast EMA Length": 3, "Slow EMA Length": 25, Source: "hl2", "Highlight ?": false },
  arnaud_legoux_moving_average: { Length: 11, Offset: 0.3, Sigma: 4, Source: "hl2" },
  zero_lag_exponential_moving_average: { Length: 9, Source: "hlc3", "Highlight ?": false },
  rsi_relative_strength_index: { Length: 9, "Overbought Level": 65, "Oversold Level": 35, "Highlight Overbought/Oversold Breakouts ?": false, Source: "wc" },
  cci_commodity_channel_index: { Length: 11, "Overbought Level": 85, "Oversold Level": -85, "Max Level": 240, "Min Level": -240, "Highlight Breakouts ?": false, Source: "wc" },
  stochastic: { K: 9, D: 4, Smooth: 2, Source: "hlc3", "Show Histogram ?": true, "Highlight Overbought/Oversold Breakouts ?": false, "Highlight K/D Crossovers ?": false, "Highlight Middle Line Crossovers ?": false, "Apply Ribbon Filling ?": false },
  mfi_money_flow_index: { Length: 9, "Signal Length": 5, Source: "hl2", "Show Histogram ?": true, "Highlight Overbought/Oversold Breakouts ?": false, "Highlight MFI/Signal Crossovers ?": false, "Highlight Middle Line Crossovers ?": false, "Apply Ribbon Filling ?": false },
  awesome_oscillator: { "Fast Length": 3, "Slow Length": 11 },
  percentage_price_oscillator: { "Fast Length": 7, "Slow Length": 19, "Signal Length": 5, Source: "hlc3", "Apply Filling ?": true },
  trix: { Length: 8, "TRIX Value Multiplier": 3, "Signal Smoothing Type": "EMA", "Signal Smoothing Length": 5, Source: "hl2", "Show Histogram ?": true, "Highlight TRIX/Signal Crossovers ?": false, "Highlight Zero Line Crossovers ?": true, "Apply Ribbon Filling ?": true },
  on_balance_volume: { "Signal Smoothing Type": "EMA", "Signal Smoothing Length": 7, "Highlight Crossovers ?": true, "Apply Ribbon Filling ?": false, Source: "hl2" },
};
function overrides(definitions, settings) {
  return Object.fromEntries(Object.entries(settings).map(([title, value]) => {
    const input = definitions.find((entry) => entry.title === title || entry.name === title);
    assert.ok(input, "Missing input " + title); return [input.id, value];
  }));
}
const settingsOf = (result) => Object.fromEntries(result.inputDefinitions.map((input) => [input.title ?? input.name, result.inputs[input.id]]));
const options = (value, hline) => Object.fromEntries(Object.entries(value ?? {}).filter(([key, val]) => !key.startsWith("_") && (!hline || val !== undefined)).map(([key, val]) => [key, val == null || typeof val === "number" && !finite(val) ? null : val]));
const at = (plot, i) => pine.getPackedPinePlot(plot) ? pine.pointAtBar(plot, i) : plot.points[i];
function rawCompare(result, oracle) {
  oracle.plots = Object.fromEntries(Object.entries(oracle.plots).filter(([,plot]) => !["label", "drawing_line", "drawing_box", "linefill", "drawing_polyline", "table"].includes(plot.options?.style)));
  assert.equal(result.plots.length, Object.keys(oracle.plots).length);
  for (const plot of result.plots) {
    const expected = oracle.plots[plot.id]; assert.ok(expected, plot.id);
    assert.equal(plot.name, expected.title ?? plot.id); assert.deepEqual(plot.options, options(expected.options, plot.style === "hline"));
    for (let i = 0; i < bars.length; i++) {
      const point = at(plot, i);
      assert.equal(point.time, bars[i].time);
      assert.equal(point.value, finite(expected.data[i].value) || typeof expected.data[i].value === "boolean" ? expected.data[i].value : null, plot.name + " raw@" + i);
      assert.deepEqual(point.options, options(expected.data[i].options, plot.style === "hline"));
    }
  }
}
function mathCompare(result, name, settings) {
  for (const [title, expected] of Object.entries(oracle(name, settings))) {
    const plot = result.plots.find((entry) => entry.name === title); assert.ok(plot, title);
    let samples = 0;
    for (let i = 0; i < bars.length; i++) {
      const actual = at(plot, i).value;
      if (!finite(expected[i])) { assert.equal(actual, null, name + "/" + title + " warmup@" + i); continue; }
      assert.equal(typeof actual, "number", name + "/" + title + "@" + i);
      assert.ok(Math.abs(actual - expected[i]) <= 1e-6, name + "/" + title + "@" + i + ": " + actual + " != " + expected[i]);
      samples++;
    }
    assert.ok(samples > 50 || expected.every((value) => !finite(value)), title + " meaningful coverage");
  }
}
test("all 17 derivatives bind immutable original bytes, commit, GPL attribution and separate v5 bytes", () => {
  assert.equal(migrations.entries.length, 17);
  const legacy = manifest.entries.filter((entry) => entry.pineVersion < 5);
  assert.deepEqual(migrations.entries.map((entry) => entry.catalogId).sort(), legacy.map((entry) => entry.id).sort());
  for (const entry of migrations.entries) {
    const original = legacy.find((item) => item.id === entry.catalogId), text = sourceOf(entry);
    const originalBytes = readFileSync(root + "/frontend/public/catalog/pine/everget/" + manifest.upstreamCommit + "/" + original.path);
    assert.equal(entry.originalPineVersion, original.pineVersion); assert.equal(entry.upstreamBlobSha1, original.upstreamBlobSha1);
    assert.equal(entry.path, original.path); assert.equal(entry.upstreamCommit, manifest.upstreamCommit);
    assert.equal(entry.originalSourceSha256, createHash("sha256").update(originalBytes).digest("hex"));
    assert.equal(entry.originalSourceSha256, original.sourceSha256);
    assert.equal(entry.targetVersion, 5); assert.equal(entry.sourceBytes, Buffer.byteLength(text));
    assert.equal(entry.sourceSha256, createHash("sha256").update(text).digest("hex"));
    assert.notEqual(entry.sourceSha256, entry.originalSourceSha256);
    assert.ok(text.startsWith("//@version=5\n")); assert.ok(text.includes(original.copyright)); assert.ok(text.includes(original.licenseNotice));
    assert.ok(text.includes(entry.upstreamCommit + "/" + entry.path));
  }
});
for (const entry of migrations.entries) {
  const name = entry.path.split("/").at(-1).replace(".pine", "");
  test(name + ": genuine worker defaults/custom inputs match raw pinned engine and independent legacy mathematics", async () => {
    const text = sourceOf(entry), defaults = await native(text);
    // Bind all 86 declared defaults to the immutable original rather than
    // deriving expected settings from the migrated engine's own metadata.
    const originalText = read("frontend/public/catalog/pine/everget/" + entry.upstreamCommit + "/" + entry.path);
    const declarations = [...originalText.matchAll(/input\([^)]*?title="([^"]+)"[^)]*?defval=([^,\)\n]+)/g)];
    assert.equal(defaults.inputDefinitions.length, declarations.length);
    for (const [, title, literal] of declarations) {
      const token = literal.trim();
      const expected = token.startsWith('"') ? JSON.parse(token) : token === "true" || token === "false" ? token === "true" : Number.isFinite(Number(token)) ? Number(token) : token;
      const definition = defaults.inputDefinitions.find((input) => input.title === title);
      assert.ok(definition, title); assert.equal(definition.defval, expected, entry.path + "/" + title);
    }
    for (const [result, inputs] of [[defaults, {}], [await native(text, overrides(defaults.inputDefinitions, custom[name])), overrides(defaults.inputDefinitions, custom[name])]]) {
      assert.equal(result.source, text); assert.equal(result.audit.engineVersion, "0.11.0");
      rawCompare(result, await raw(text, inputs));
      const settings = settingsOf(result);
      for (const [title, value] of Object.entries(inputs)) assert.equal(result.inputs[title], value);
      mathCompare(result, name, settings);
      if (name === "t3_moving_average") {
        const expected = oracle(name, settings).T3, plot = result.plots.find((entry) => entry.name === "T3");
        assert.equal(plot.points.findIndex((point) => typeof point.value === "number"), 6 * (settings.Length - 1));
        for (let i = 0; i < bars.length; i++) assert.equal(at(plot, i).options.color,
          settings["Highlight ?"] ? expected[i] > expected[i - 1] ? "#4CAF50" : "#FF5252" : "#6d1e7f");
      }
    }
  });
}
test("HMA odd/even integer windows discriminate fractional-half and sqrt-floor migrations", async () => {
  const text = sourceOf(migrations.entries.find((entry) => entry.path.includes("hull_moving"))), base = await native(text);
  for (const length of [5, 9, 10, 15]) {
    const result = await native(text, overrides(base.inputDefinitions, { Length: length, Source: "close" }));
    mathCompare(result, "hull_moving_average", settingsOf(result));
  }
});
test("RSI all twenty legacy aliases and CCI local-zero PVT preserve source selection", async () => {
  const text = sourceOf(migrations.entries.find((entry) => entry.path.includes("rsi_relative"))), base = await native(text);
  const input = base.inputDefinitions.find((item) => item.title === "Source"); assert.equal(input.options.length, 20);
  for (const alias of input.options) {
    const result = await native(text, overrides(base.inputDefinitions, { Length: 9, Source: alias }));
    mathCompare(result, "rsi_relative_strength_index", settingsOf(result));
  }
  const cciText = sourceOf(migrations.entries.find((entry) => entry.path.includes("cci_commodity"))), cci = await native(cciText);
  const result = await native(cciText, overrides(cci.inputDefinitions, { Source: "price volume trend" }));
  mathCompare(result, "cci_commodity_channel_index", settingsOf(result));
});
test("Stochastic ribbon, histogram, middle-cross background and absolute crossover channels retain independent predicates", async () => {
  const text = sourceOf(migrations.entries.find((entry) => entry.path.includes("/stochastic."))), base = await native(text);
  const k = oracle("stochastic", settingsOf(base))["%K"], d = oracle("stochastic", settingsOf(base))["%D"];
  for (const [title, direction] of [["K/D Crossover", 1], ["K/D Crossunder", -1]]) {
    const plot = base.plots.find((entry) => entry.name === title); assert.equal(plot.options.location.toLowerCase(), "absolute");
    for (let i = 1; i < bars.length; i++) {
      const crossed = direction > 0 ? k[i] > d[i] && k[i - 1] <= d[i - 1] : k[i] < d[i] && k[i - 1] >= d[i - 1];
      const value = at(plot, i).value;
      if (crossed) assert.ok(Math.abs(value - k[i]) < 1e-6); else assert.equal(value, null);
    }
  }
  const off = await native(text, overrides(base.inputDefinitions, custom.stochastic));
  assert.ok(off.plots.find((plot) => plot.name === "Ribbon").points.every((point) => point.options.color === null));
  assert.ok(off.plots.filter((plot) => /K\/D Cross/.test(plot.name)).every((plot) => plot.points.every((point) => point.value === null)));
  const background = base.plots.find((plot) => plot.style === "background");
  assert.ok(background, "Original middle-line background must survive migration");
  for (let i = 0; i < bars.length; i++) assert.equal(at(background, i).options.color?.toLowerCase(), (k[i] > 50 ? "#4caf501a" : "#ff52521a"));
  assert.ok(off.plots.find((plot) => plot.style === "background").points.every((point) => point.options.color === null));
});
