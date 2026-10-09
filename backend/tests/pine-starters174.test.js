import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser", target: "es2020", write: false,
  logLevel: "silent", plugins: [createPineEnginePlugin()], stdin: { loader: "ts", resolveDir: process.cwd(), sourcefile: "pine-starters174.ts",
    contents: 'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineStarters.ts";' } })).outputFiles[0].text;
console.info("PINE_STARTERS174_BINDING " + JSON.stringify({ minified: true, actualWorker: true, actualStarters: true,
  bundleSha256: createHash("sha256").update(bundle).digest("hex"),
  startersSha256: createHash("sha256").update(fs.readFileSync("frontend/src/lib/pineStarters.ts")).digest("hex"),
  manifestSha256: createHash("sha256").update(fs.readFileSync("frontend/vendor/pinets/manifest.json")).digest("hex") }));
const pine = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const entries = pine.PINE_INDICATOR_STARTERS, get = id => { const entry = entries.find(item => item.id === id); assert.ok(entry, id); return entry; };
const origin = Date.UTC(2024, 0, 1, 23, 20) / 1000;
const bars = Array.from({ length: 180 }, (_, i) => {
  const time = origin + i * 60, close = 100 + i * .07 + [6, -8, 4, -5, 10, -3][i % 6], open = close + [-2, 3, -1, 4][i % 4];
  return { time, open, high: Math.max(open, close) + 2 + i % 3, low: Math.min(open, close) - 1 - i % 2,
    close, volume: i < 3 || time % 86400 < 180 ? 0 : 10 + i % 13 };
});
const context = { symbol: "BINANCE:BTCUSDT", timeframe: "1", mintick: .01, pointvalue: 1 };
const execute = (id, inputs = {}, action = "run", source = get(id).source) => pine.executePineRequest({ id: "starter174-" + id,
  action, source, inputs, ...(action === "run" ? { mode: "historical", bars, context } : {}) });
const plot = (result, name) => { const found = result.plots.find(item => item.name === name); assert.ok(found, `Missing ${name}`); return found; };
const values = (result, name) => plot(result, name).points.map(point => point.value);
function numeric(actual, expected, name) {
  assert.equal(actual.length, expected.length, name + " length");
  actual.forEach((value, i) => expected[i] === null ? assert.equal(value, null, `${name}[${i}]`) :
    assert.ok(typeof value === "number" && Math.abs(value - expected[i]) <= Math.max(1, Math.abs(expected[i])) * 1e-10,
      `${name}[${i}] expected ${expected[i]}, received ${value}`));
}
function ema(data, length) {
  let previous = null; const seed = [];
  return data.map(value => {
    if (value === null) return null;
    if (previous === null) { seed.push(value); if (seed.length < length) return null; previous = seed.reduce((sum, x) => sum + x, 0) / length; }
    else previous += 2 / (length + 1) * (value - previous);
    // Native TA returns 10-decimal values, but commits the unrounded EMA state.
    return Math.round(previous * 1e10) / 1e10;
  });
}
const window = (i, length) => bars.slice(Math.max(0, i - length + 1), i + 1);
// TV's execution-model time-series example explicitly leaves highest(high,20)
// NA for its first 19 bars: a window requires its full authored length.
const midpoint = (i, length) => i < length - 1 ? null : (Math.max(...window(i, length).map(bar => bar.high)) + Math.min(...window(i, length).map(bar => bar.low))) / 2;
const selected = key => bars.map(bar => key === "hl2" ? (bar.high + bar.low) / 2 : key === "hlc3" ? (bar.high + bar.low + bar.close) / 3 : bar[key]);

test("existing editable originals keep their stable authored input IDs, names and exact source", async () => {
  const existingIds = ["pine-macd", "pine-bollinger", "pine-donchian", "pine-ichimoku", "pine-vwap", "pine-heikin-ashi"];
  assert.deepEqual(entries.filter(item => existingIds.includes(item.id)).map(item => item.id), existingIds);
  const definitions = {
    "pine-macd": [["source", "Source", "close"], ["int", "Fast length", 12], ["int", "Slow length", 26], ["int", "Signal length", 9]],
    "pine-bollinger": [["source", "Source", "close"], ["int", "Length", 20], ["float", "Standard deviations", 2]],
    "pine-donchian": [["int", "Length", 20]],
    "pine-ichimoku": [["int", "Conversion length", 9], ["int", "Base length", 26], ["int", "Span B length", 52], ["int", "Displacement", 26]],
    "pine-vwap": [["source", "Source", "hlc3"]],
  };
  for (const entry of entries.filter(item => existingIds.includes(item.id))) {
    assert.ok(entry.description.length > 15); assert.match(entry.source, /^\/\/@version=6\n/); assert.match(entry.source, /Original EdgeLab starter/);
    const result = await execute(entry.id, {}, "prepare"); assert.equal(result.source, entry.source); assert.equal(result.name, entry.name);
    assert.deepEqual(result.inputDefinitions.map(item => item.id), result.inputDefinitions.map((_, i) => "in_" + i));
    if (definitions[entry.id]) assert.deepEqual(result.inputDefinitions.map(item => [item.type, item.title, item.defval]), definitions[entry.id]);
    else assert.deepEqual(result.inputDefinitions.map(item => [item.type, item.title]), [["color", "Up color"], ["color", "Down color"]]);
  }
});

test("MACD defaults and custom source/lengths use independent SMA-seeded EMA warmup and signal recurrence", async () => {
  // Matches the pinned engine's existing documented EMA warmup; not a claim about every TV seed convention.
  for (const [key, fast, slow, signal, inputs] of [["close", 12, 26, 9, {}], ["hl2", 4, 7, 3, { in_0: "hl2", in_1: 4, in_2: 7, in_3: 3 }]]) {
    const price = selected(key), fastEMA = ema(price, fast), slowEMA = ema(price, slow);
    const macd = price.map((_, i) => fastEMA[i] === null || slowEMA[i] === null ? null : fastEMA[i] - slowEMA[i]);
    const average = ema(macd, signal), histogram = macd.map((value, i) => value === null || average[i] === null ? null : value - average[i]);
    const result = await execute("pine-macd", inputs);
    numeric(values(result, "MACD"), macd, "MACD"); numeric(values(result, "Signal"), average, "Signal"); numeric(values(result, "Histogram"), histogram, "Histogram");
    assert.equal(result.overlay, false); assert.equal(plot(result, "Histogram").options.style, "style_histogram");
  }
});

test("Bollinger Bands defaults and custom source use full-window population deviation and native fill boundaries", async () => {
  for (const [key, length, multiplier, inputs] of [["close", 20, 2, {}], ["open", 7, 1.5, { in_0: "open", in_1: 7, in_2: 1.5 }]]) {
    const price = selected(key), basis = price.map((_, i) => i < length - 1 ? null : price.slice(i - length + 1, i + 1).reduce((sum, x) => sum + x, 0) / length);
    const deviation = basis.map((mean, i) => mean === null ? null : Math.sqrt(price.slice(i - length + 1, i + 1).reduce((sum, x) => sum + (x - mean) ** 2, 0) / length) * multiplier);
    const result = await execute("pine-bollinger", inputs);
    numeric(values(result, "Basis"), basis, "Basis");
    numeric(values(result, "Upper"), basis.map((value, i) => value === null ? null : value + deviation[i]), "Upper");
    numeric(values(result, "Lower"), basis.map((value, i) => value === null ? null : value - deviation[i]), "Lower");
    assert.ok(result.plots.some(item => item.options.style === "fill")); assert.equal(result.overlay, true);
  }
});

test("Donchian channel includes the current actual high/low with independent default and custom windows", async () => {
  for (const length of [20, 5]) {
    const result = await execute("pine-donchian", length === 20 ? {} : { in_0: length });
    numeric(values(result, "Upper"), bars.map((_, i) => i < length - 1 ? null : Math.max(...window(i, length).map(bar => bar.high))), "Upper");
    numeric(values(result, "Lower"), bars.map((_, i) => i < length - 1 ? null : Math.min(...window(i, length).map(bar => bar.low))), "Lower");
    numeric(values(result, "Midpoint"), bars.map((_, i) => midpoint(i, length)), "Midpoint"); assert.equal(result.overlay, true);
  }
});

test("Ichimoku default and custom windows preserve inclusive displacement in native plot metadata", async () => {
  for (const [conversion, base, span, displacement, inputs] of [[9, 26, 52, 26, {}], [3, 6, 10, 4, { in_0: 3, in_1: 6, in_2: 10, in_3: 4 }]]) {
    const result = await execute("pine-ichimoku", inputs), a = bars.map((_, i) => midpoint(i, conversion)), b = bars.map((_, i) => midpoint(i, base));
    numeric(values(result, "Conversion"), a, "Conversion"); numeric(values(result, "Base"), b, "Base");
    numeric(values(result, "Span A"), a.map((value, i) => value === null || b[i] === null ? null : (value + b[i]) / 2), "Span A");
    numeric(values(result, "Span B"), bars.map((_, i) => midpoint(i, span)), "Span B"); numeric(values(result, "Lagging close"), selected("close"), "Lagging close");
    for (const name of ["Span A", "Span B", "Lagging close"]) {
      const offset = name === "Lagging close" ? 1 - displacement : displacement - 1;
      assert.equal(plot(result, name).options.offset, offset); assert.ok(plot(result, name).points.every(point => point.options.offset === offset));
    }
    assert.equal(plot(result, "Conversion").options.offset ?? 0, 0); assert.ok(result.plots.some(item => item.options.style === "fill"));
  }
});

test("UTC daily VWAP resets volume at midnight, returns NA for zero-volume prefix, and honors custom source", async () => {
  for (const key of ["hlc3", "close"]) {
    const price = selected(key); let day = null, weighted = 0, volume = 0;
    const expected = bars.map((bar, i) => { const current = Math.floor(bar.time / 86400); if (current !== day) { day = current; weighted = 0; volume = 0; }
      weighted += price[i] * bar.volume; volume += bar.volume; return volume > 0 ? weighted / volume : null; });
    const result = await execute("pine-vwap", key === "hlc3" ? {} : { in_0: key }); numeric(values(result, "VWAP"), expected, "VWAP");
    assert.equal(values(result, "VWAP")[40], null); assert.equal(values(result, "VWAP")[42], null); numeric([values(result, "VWAP")[43]], [price[43]], "First nonzero volume after daily reset");
    assert.notEqual(expected[39], expected[43]);
  }
});

test("Heikin Ashi starter emits original OHLC candles and custom up/down colors without changing market bars", async () => {
  const expected = []; for (const bar of bars) { const prior = expected.at(-1), close = (bar.open + bar.high + bar.low + bar.close) / 4;
    const open = prior ? (prior[0] + prior[3]) / 2 : (bar.open + bar.close) / 2;
    expected.push([open, Math.max(bar.high, open, close), Math.min(bar.low, open, close), close]); }
  assert.ok(expected.some(([open, , , close]) => close >= open)); assert.ok(expected.some(([open, , , close]) => close < open));
  const before = structuredClone(bars);
  for (const inputs of [{}, { in_0: "#12ab34", in_1: "#cd5678" }]) {
    const result = await execute("pine-heikin-ashi", inputs), candles = plot(result, "Heikin-Ashi");
    for (let i = 0; i < bars.length; i++) {
      numeric(candles.points[i].value, expected[i], "HA candle " + i); assert.equal(candles.points[i].time, bars[i].time);
      if (Object.keys(inputs).length) {
        const color = expected[i][3] >= expected[i][0] ? "#12ab34" : "#cd5678";
        for (const key of ["color", "wickcolor", "bordercolor"]) assert.equal(candles.points[i].options[key], color);
      }
    }
    assert.equal(result.overlay, false);
  }
  assert.deepEqual(bars, before);
});

test("every starter remains directly editable source with genuine appended plot and independent custom input IDs", async () => {
  for (const entry of entries) {
    const edited = entry.source + '\nprobe=input.float(2,"Editable multiplier",minval=1,maxval=10)\nplot(close*probe,"Edited")';
    const prepared = await execute(entry.id, {}, "prepare", edited), input = prepared.inputDefinitions.at(-1);
    assert.equal(input.title, "Editable multiplier"); assert.equal(input.id, "in_" + (prepared.inputDefinitions.length - 1));
    const result = await execute(entry.id, { [input.id]: 3 }, "run", edited);
    assert.equal(result.source, edited); assert.equal(result.inputs[input.id], 3); numeric(values(result, "Edited"), bars.map(bar => bar.close * 3), entry.id + " edit");
  }
});
