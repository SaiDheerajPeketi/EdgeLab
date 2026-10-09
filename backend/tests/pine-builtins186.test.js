import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser", target: "es2020", write: false,
  define: { "import.meta.env": "{}" }, logLevel: "silent", plugins: [createPineEnginePlugin()],
  stdin: { loader: "ts", resolveDir: process.cwd(), sourcefile: "pine-builtins186.ts", contents:
    'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineStarters.ts"; export {FIRST_PARTY_EDGE_INDICATORS,isPineScriptSource} from "./frontend/src/lib/customIndicators.ts";' } })).outputFiles[0].text;
const hash = value => createHash("sha256").update(value).digest("hex");
console.info("PINE_BUILTINS186_BINDING " + JSON.stringify({ minified: true, actualWorker: true,
  bundleSha256: hash(bundle), startersSha256: hash(fs.readFileSync("frontend/src/lib/pineStarters.ts")),
  manifestSha256: hash(fs.readFileSync("frontend/vendor/pinets/manifest.json")) }));
const api = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const ids = ["pine-stochastic", "pine-stochastic-rsi", "pine-dmi", "pine-sar"];
const entry = id => { const item = api.PINE_INDICATOR_STARTERS.find(item => item.id === id); assert.ok(item, id); return item; };
const origin = Date.UTC(2024, 0, 1) / 1000;
const bars = Array.from({ length: 180 }, (_, i) => {
  // Alternating 15-bar trends exercise multiple genuine SAR reversals, rather than only an uptrend.
  const close = 100 + (Math.floor(i / 15) % 2 ? 15 - i % 15 : i % 15) * 2 + Math.sin(i * .7);
  const open = close + (i % 2 ? .5 : -.5);
  return { time: origin + i * 60, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume: 10 + i % 7 };
});
const context = { symbol: "BINANCE:BTCUSDT", timeframe: "1", mintick: .01, pointvalue: 1 };
const run = (id, inputs = {}, data = bars, source = entry(id).source) => api.executePineRequest({ id: "builtins186-" + id,
  action: "run", mode: "historical", source, inputs, bars: data, context });
const plot = (result, name) => { const value = result.plots.find(item => item.name === name); assert.ok(value, name); return value; };
const values = (result, name) => plot(result, name).points.map(point => point.value);
const round = value => Math.round(value * 1e10) / 1e10;
function numeric(actual, expected, label) {
  assert.equal(actual.length, expected.length, label + " count");
  actual.forEach((value, index) => expected[index] === null ? assert.equal(value, null, `${label}[${index}]`) :
    assert.ok(typeof value === "number" && Math.abs(value - expected[index]) <= 1e-8,
      `${label}[${index}]: expected ${expected[index]}, received ${value}`));
}
function sma(data, length) {
  const finite = [];
  return data.map(value => {
    if (value !== null) finite.push(value);
    if (finite.length < length) return null;
    return round(finite.slice(-length).reduce((a, b) => a + b, 0) / length);
  });
}
function stoch(price, high, low, length) {
  let previous = null;
  return price.map((value, index) => {
    if (index < length - 1 || value === null) return previous;
    const highs = high.slice(index - length + 1, index + 1).filter(value => value !== null);
    const lows = low.slice(index - length + 1, index + 1).filter(value => value !== null);
    const upper = Math.max(...highs), lower = Math.min(...lows);
    if (upper !== lower) previous = round(100 * (value - lower) / (upper - lower));
    return previous;
  });
}
function rma(data, length) {
  let average = null; const seed = [];
  return data.map(value => {
    if (value === null) return null;
    if (average === null) { seed.push(value); if (seed.length < length) return null; average = seed.reduce((a, b) => a + b, 0) / length; }
    else average = (average * (length - 1) + value) / length;
    return average;
  });
}
function rsi(price, length) {
  const gain = rma(price.map((value, i) => i ? Math.max(0, value - price[i - 1]) : null), length);
  const loss = rma(price.map((value, i) => i ? Math.max(0, price[i - 1] - value) : null), length);
  return gain.map((value, i) => value === null ? null : round(loss[i] === 0 ? 100 : 100 - 100 / (1 + value / loss[i])));
}
function dmi(data, length, smoothing) {
  const tr = [], plus = [], minus = [];
  data.forEach((bar, i) => {
    if (!i) { tr.push(null); plus.push(null); minus.push(null); return; }
    const prior = data[i - 1], up = bar.high - prior.high, down = prior.low - bar.low;
    tr.push(Math.max(bar.high - bar.low, Math.abs(bar.high - prior.close), Math.abs(bar.low - prior.close)));
    plus.push(up > down && up > 0 ? up : 0); minus.push(down > up && down > 0 ? down : 0);
  });
  const range = rma(tr, length), p = rma(plus, length), m = rma(minus, length);
  const pdi = p.map((value, i) => value === null ? null : range[i] === 0 ? 0 : 100 * value / range[i]);
  const mdi = m.map((value, i) => value === null ? null : range[i] === 0 ? 0 : 100 * value / range[i]);
  const dx = pdi.map((value, i) => value === null ? null : value + mdi[i] === 0 ? 0 : 100 * Math.abs(value - mdi[i]) / (value + mdi[i]));
  return { plus: pdi, minus: mdi, adx: rma(dx, smoothing) };
}
// Wilder's stop-and-reverse recurrence: trend/exreme/acceleration are committed per bar;
// stop cannot penetrate either of the previous two bars. This is a reference formula,
// not the native TA implementation or a claim about exact TradingView pixels.
function sar(data, start, increment, maximum) {
  let stop, extreme, acceleration, rising;
  return data.map((bar, i) => {
    if (!i) return null;
    let reset = i === 1;
    if (reset) { rising = bar.close > data[i - 1].close; extreme = rising ? bar.high : bar.low;
      stop = rising ? data[i - 1].low : data[i - 1].high; acceleration = start; }
    stop += acceleration * (extreme - stop);
    if (rising ? stop > bar.low : stop < bar.high) {
      rising = !rising; stop = rising ? Math.min(bar.low, extreme) : Math.max(bar.high, extreme);
      extreme = rising ? bar.high : bar.low; acceleration = start; reset = true;
    }
    if (!reset && (rising ? bar.high > extreme : bar.low < extreme)) {
      extreme = rising ? bar.high : bar.low; acceleration = Math.min(maximum, acceleration + increment);
    }
    const prior = data.slice(Math.max(0, i - 2), i);
    stop = rising ? Math.min(stop, ...prior.map(bar => bar.low)) : Math.max(stop, ...prior.map(bar => bar.high));
    return stop;
  });
}

test("five direct-library originals preserve exact source and genuine source-owned input metadata", async () => {
  for (const id of [...ids, "pine-ichimoku"]) {
    const original = entry(id), library = api.FIRST_PARTY_EDGE_INDICATORS.find(item => item.id === "first-party:" + id);
    assert.ok(library); assert.equal(library.source, original.source); assert.equal(library.name, original.name);
    assert.equal(api.isPineScriptSource(library.source), true);
    const prepared = await api.executePineRequest({ id: "prepare186-" + id, action: "prepare", source: original.source });
    assert.equal(prepared.source, original.source); assert.equal(prepared.pineVersion, 6);
    assert.deepEqual(prepared.inputDefinitions.map(item => item.id), prepared.inputDefinitions.map((_, i) => "in_" + i));
    const expected = { "pine-stochastic": [14, 3, 3, 80, 20], "pine-stochastic-rsi": ["close", 14, 14, 3, 3, 80, 20],
      "pine-dmi": [14, 14], "pine-sar": [.02, .02, .2], "pine-ichimoku": [9, 26, 52, 26] };
    assert.deepEqual(prepared.inputDefinitions.map(item => item.defval), expected[id]);
  }
});

test("Stochastic defaults/custom inputs calculate full high-low windows and both actual smoothing stages", async () => {
  for (const [length, kLength, dLength, inputs] of [[14, 3, 3, {}], [5, 2, 4, { in_0: 5, in_1: 2, in_2: 4, in_3: 75, in_4: 25 }]]) {
    const k = sma(stoch(bars.map(bar => bar.close), bars.map(bar => bar.high), bars.map(bar => bar.low), length), kLength);
    const result = await run(ids[0], inputs); numeric(values(result, "%K"), k, "%K"); numeric(values(result, "%D"), sma(k, dLength), "%D");
    assert.equal(result.overlay, false); assert.ok(result.plots.some(plot => plot.options.style === "fill"));
  }
});

test("Stochastic RSI honors custom price/RSI/stochastic/K/D inputs with Wilder RSI and native NA warmup", async () => {
  for (const [key, rLength, sLength, kLength, dLength, inputs] of [["close", 14, 14, 3, 3, {}],
    ["open", 6, 8, 2, 4, { in_0: "open", in_1: 6, in_2: 8, in_3: 2, in_4: 4 }]]) {
    const strength = rsi(bars.map(bar => bar[key]), rLength), k = sma(stoch(strength, strength, strength, sLength), kLength);
    const result = await run(ids[1], inputs); numeric(values(result, "%K"), k, "RSI %K"); numeric(values(result, "%D"), sma(k, dLength), "RSI %D");
    assert.equal(result.overlay, false);
  }
});

test("DMI defaults/custom lengths use independent directional movement, true range and Wilder ADX", async () => {
  for (const [length, smoothing, inputs] of [[14, 14, {}], [5, 8, { in_0: 5, in_1: 8 }]]) {
    const expected = dmi(bars, length, smoothing), result = await run(ids[2], inputs);
    numeric(values(result, "+DI"), expected.plus, "+DI"); numeric(values(result, "−DI"), expected.minus, "−DI"); numeric(values(result, "ADX"), expected.adx, "ADX");
  }
});

test("SAR crosses reverse on actual trends and custom acceleration without mutating underlying candles", async () => {
  const before = structuredClone(bars);
  for (const [start, increment, maximum, inputs] of [[.02, .02, .2, {}], [.04, .03, .3, { in_0: .04, in_1: .03, in_2: .3 }]]) {
    const result = await run(ids[3], inputs); numeric(values(result, "SAR"), sar(bars, start, increment, maximum), "SAR");
    assert.equal(result.overlay, true); assert.equal(plot(result, "SAR").options.style, "style_cross");
  }
  assert.deepEqual(bars, before);
});

test("flat candles remain NA for stochastic ranges, zero for warmed DMI and finite for SAR", async () => {
  const flat = bars.map(bar => ({ ...bar, open: 100, high: 100, low: 100, close: 100 }));
  for (const id of ids.slice(0, 2)) { const result = await run(id, {}, flat); assert.ok(values(result, "%K").every(value => value === null)); assert.ok(values(result, "%D").every(value => value === null)); }
  const direction = await run(ids[2], {}, flat);
  for (const name of ["+DI", "−DI", "ADX"]) assert.ok(values(direction, name).slice(name === "ADX" ? 27 : 14).every(value => value === 0));
  numeric(values(await run(ids[3], {}, flat), "SAR"), flat.map((_, i) => i ? 100 : null), "flat SAR");
});

test("editable original copies preserve source and appended custom-input execution for all four studies", async () => {
  for (const id of ids) {
    const source = entry(id).source + '\nprobe=input.float(2,"Editable multiplier")\nplot(close*probe,"Edited")';
    const prepared = await api.executePineRequest({ id: "edited186-" + id, action: "prepare", source });
    assert.equal(prepared.source, source); const definition = prepared.inputDefinitions.find(item => item.title === "Editable multiplier"); assert.ok(definition);
    numeric(values(await run(id, { [definition.id]: 3 }, bars, source), "Edited"), bars.map(bar => bar.close * 3), "Edited");
    assert.equal(entry(id).source.includes("Editable multiplier"), false);
  }
});

test("live same-bar replacements rollback Stochastic/DMI/SAR state and confirmation matches full history", async () => {
  for (const id of [ids[0], ids[2], ids[3]]) {
    const executor = api.createPineLiveExecutor(), sessionId = "builtins186-live-" + id, source = entry(id).source;
    await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 0, action: "start",
      request: { id: sessionId + ":0", action: "run", mode: "live", source, inputs: {}, bars: bars.slice(0, 179), context } });
    const first = { ...bars[179], high: bars[179].high + 8, close: bars[179].close + 6, volume: 30 };
    const second = { ...first, low: first.low - 3, close: first.close - 10, volume: 35 };
    for (const [sequence, bar, confirmed] of [[1, first, false], [2, second, false], [3, second, true]]) {
      const result = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence, action: "update", bar, confirmed });
      const reference = await run(id, {}, [...bars.slice(0, 179), bar]);
      for (const item of reference.plots.filter(item => ["%K", "%D", "+DI", "−DI", "ADX", "SAR"].includes(item.name))) numeric(values(result, item.name), values(reference, item.name), "live " + item.name);
    }
    executor.dispose();
  }
});
