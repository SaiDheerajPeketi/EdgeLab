import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser", target: "es2020", write: false,
  define: { "import.meta.env": "{}" }, logLevel: "silent", plugins: [createPineEnginePlugin()],
  stdin: { loader: "ts", resolveDir: process.cwd(), sourcefile: "pine-volume190.ts", contents:
    'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineStarters.ts"; export {FIRST_PARTY_EDGE_INDICATORS} from "./frontend/src/lib/customIndicators.ts";' } })).outputFiles[0].text;
const api = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const ids = ["pine-cmf", "pine-chaikin-oscillator", "pine-elder-force"];
const entry = id => api.PINE_INDICATOR_STARTERS.find(item => item.id === id);
const context = { symbol: "BINANCE:BTCUSDT", timeframe: "1", mintick: .01, pointvalue: 1 };
const bars = Array.from({ length: 180 }, (_, i) => {
  const low = 95 + (i * 7 % 31), high = low + 6 + i % 5;
  const close = i % 11 === 0 ? low : low + (i * 3 % (high - low + 1));
  return { time: Date.UTC(2024, 0, 1) / 1000 + i * 60, open: i % 11 === 0 ? low : low + 2, high: i % 11 === 0 ? low : high,
    low, close, volume: i % 9 === 0 ? 0 : 10 + i % 7 };
});
const run = (id, inputs = {}, data = bars, source = entry(id).source) => api.executePineRequest({
  id: "volume190-" + id, action: "run", mode: "historical", source, inputs, bars: data, context });
const values = (result, name) => { const plot = result.plots.find(plot => plot.name === name); assert.ok(plot, name); return plot.points.map(point => point.value); };
const round = value => Math.round(value * 1e10) / 1e10;
function numeric(actual, expected, label) {
  assert.equal(actual.length, expected.length, label);
  actual.forEach((value, i) => expected[i] === null ? assert.equal(value, null, label + "[" + i + "]") :
    assert.ok(typeof value === "number" && Number.isFinite(value) && Math.abs(value - expected[i]) <= 1e-8,
      label + "[" + i + "]: expected " + expected[i] + ", received " + value));
}
// Independent whole-array formulas. The native engine seeds EMA from a complete SMA;
// this tests that explicit initialization, not external TradingView startup parity.
function ema(data, length) {
  const finite = []; let previous = null;
  return data.map(value => {
    if (value === null) return null;
    finite.push(value);
    if (previous === null) { if (finite.length < length) return null; previous = finite.reduce((sum, value) => sum + value, 0) / length; }
    else previous = previous + (value - previous) * 2 / (length + 1);
    return round(previous);
  });
}
function reference(id, data, inputs = {}) {
  const flow = data.map(bar => bar.high === bar.low ? 0 : bar.volume * ((bar.close - bar.low) - (bar.high - bar.close)) / (bar.high - bar.low));
  if (id === ids[0]) {
    const length = inputs.in_0 ?? 20;
    return data.map((_, i) => {
      if (i < length - 1) return null;
      const total = data.slice(i - length + 1, i + 1).reduce((sum, bar) => sum + bar.volume, 0);
      return total === 0 ? null : flow.slice(i - length + 1, i + 1).reduce((sum, value) => sum + value, 0) / total;
    });
  }
  if (id === ids[1]) {
    let sum = 0;
    const accumulated = flow.map(value => round(sum += value));
    const fast = ema(accumulated, inputs.in_0 ?? 3), slow = ema(accumulated, inputs.in_1 ?? 10);
    return fast.map((value, i) => value === null || slow[i] === null ? null : value - slow[i]);
  }
  const price = inputs.in_0 ?? "close";
  return ema(data.map((bar, i) => i ? round(bar[price] - data[i - 1][price]) * bar.volume : null), inputs.in_1 ?? 13);
}
const names = ["CMF", "Chaikin Oscillator", "EFI"];

test("native volume starters prepare exact sources and typed custom inputs without replacing legacy entries", async () => {
  const defaults = [[20], [3, 10], ["close", 13]];
  for (const [i, id] of ids.entries()) {
    const item = entry(id); assert.ok(item);
    const prepared = await api.executePineRequest({ id, action: "prepare", source: item.source });
    assert.equal(prepared.source, item.source); assert.equal(prepared.pineVersion, 6);
    assert.deepEqual(prepared.inputDefinitions.map(input => input.defval), defaults[i]);
  }
  const original = api.FIRST_PARTY_EDGE_INDICATORS.find(item => item.id === "first-party:pine-chaikin-oscillator");
  assert.equal(original.source, entry(ids[1]).source); assert.equal(original.category, "volume"); assert.equal(original.preview, "oscillator");
  assert.ok(original.synonyms.includes("adl momentum"));
  for (const id of ["first-party:cmf", "first-party:force-index"]) assert.ok(api.FIRST_PARTY_EDGE_INDICATORS.some(item => item.id === id));
  assert.equal(api.FIRST_PARTY_EDGE_INDICATORS.filter(item => item.name === "Chaikin Money Flow").length, 1);
});

test("all three volume studies match independent equations for defaults and custom inputs", async () => {
  const variants = [[{}, { in_0: 5 }, { in_0: 1 }], [{}, { in_0: 2, in_1: 7 }, { in_0: 1, in_1: 1 }],
    [{}, { in_0: "open", in_1: 5 }, { in_0: "close", in_1: 1 }]];
  const before = structuredClone(bars);
  for (const [i, id] of ids.entries()) for (const inputs of variants[i]) {
    const result = await run(id, inputs);
    numeric(values(result, names[i]), reference(id, bars, inputs), id); assert.equal(result.overlay, false);
    assert.ok(result.plots.some(plot => plot.options.style === "hline"));
  }
  assert.deepEqual(bars, before);
});

test("CMF includes flat-candle volume and leaves a zero-volume denominator missing", async () => {
  const tiny = [[12, 8, 12, 10], [10, 10, 10, 30], [12, 8, 8, 20]].map(([high, low, close, volume], i) =>
    ({ time: bars[i].time, open: close, high, low, close, volume }));
  numeric(values(await run(ids[0], { in_0: 2 }, tiny), names[0]), [null, .25, -.4], "flat CMF");
  const zero = bars.map(bar => ({ ...bar, volume: 0 }));
  assert.ok(values(await run(ids[0], {}, zero), names[0]).every(value => value === null));
  const small = tiny.map(bar => ({ ...bar, volume: bar.volume * 1e-14 }));
  numeric(values(await run(ids[0], { in_0: 2 }, small), names[0]), [null, .25, -.4], "tiny-volume CMF");
});

test("Chaikin oscillator equal lengths and zero-volume history respect native EMA warmup", async () => {
  numeric(values(await run(ids[1], { in_0: 5, in_1: 5 }), names[1]), bars.map((_, i) => i < 4 ? null : 0), "equal lengths");
  const zero = bars.map(bar => ({ ...bar, volume: 0 }));
  numeric(values(await run(ids[1], {}, zero), names[1]), zero.map((_, i) => i < 9 ? null : 0), "zero flow");
});

test("zero-volume bars let oscillator and EFI decay instead of erasing their accumulated signal", async () => {
  const data = bars.map((bar, i) => ({ ...bar, volume: i >= 70 ? 0 : bar.volume }));
  for (const [i, id] of ids.entries()) numeric(values(await run(id, {}, data), names[i]), reference(id, data), id + " zero tail");
  assert.notEqual(values(await run(ids[1], {}, data), names[1])[70], 0);
  assert.notEqual(values(await run(ids[2], {}, data), names[2])[70], 0);
});

test("editable copies retain originals and run genuinely added custom inputs", async () => {
  for (const id of ids) {
    const original = entry(id).source, source = original + '\nscale=input.float(2,"Editable multiplier")\nplot(close*scale,"Edited")';
    const prepared = await api.executePineRequest({ id, action: "prepare", source });
    assert.equal(prepared.source, source);
    const input = prepared.inputDefinitions.find(input => input.title === "Editable multiplier"); assert.ok(input);
    numeric(values(await run(id, { [input.id]: 3 }, bars, source), "Edited"), bars.map(bar => bar.close * 3), "edited");
    assert.equal(entry(id).source, original);
  }
});

test("live volume studies rollback repeated same-bar flow and confirm/append without double counting", async () => {
  for (const [i, id] of ids.entries()) {
    const executor = api.createPineLiveExecutor(), sessionId = "volume190-live-" + id;
    const history = bars.slice(0, -1), inputs = i === 2 ? { in_0: "open", in_1: 5 } : {};
    await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 0, action: "start",
      request: { id: sessionId + ":0", action: "run", mode: "live", source: entry(id).source, inputs, bars: history, context } });
    const first = { ...bars.at(-1), high: 150, low: 90, close: 145, open: 140, volume: 40 };
    const zero = { ...first, volume: 0 };
    const final = { ...first, close: 95, open: 96, volume: 55 };
    for (const [sequence, bar, confirmed] of [[1, first, false], [2, zero, false], [3, final, false], [4, final, true]]) {
      const result = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence, action: "update", bar, confirmed });
      numeric(values(result, names[i]), reference(id, [...history, bar], inputs), id + " live " + sequence);
    }
    const next = { ...first, time: first.time + 60, close: 141, open: 142, volume: 15 };
    const result = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 5, action: "update", bar: next, confirmed: false });
    numeric(values(result, names[i]), reference(id, [...history, final, next], inputs), id + " append");
    executor.dispose();
  }
});
