import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser",
  target: "es2020", write: false, logLevel: "silent", plugins: [createPineEnginePlugin()],
  stdin: { loader: "ts", resolveDir: process.cwd(), contents:
    'export {executePineRequest,createPineLiveExecutor} from "./frontend/src/workers/pineNative.worker.ts";' },
})).outputFiles[0].text;
const pine = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
console.info("TA189_ENGINE_BINDING " + JSON.stringify({ minify: true,
  workerSha256: createHash("sha256").update(bundle).digest("hex"),
  manifestSha256: createHash("sha256").update(readFileSync("frontend/vendor/pinets/manifest.json")).digest("hex") }));
const context = { symbol: "TEST", timeframe: "1", mintick: .01, pointvalue: 1 };
const bar = (index, close, volume = 10, flat = false) => ({ time: 1_700_000_040 + index * 60,
  open: close, high: close + (flat ? 0 : 2), low: close - (flat ? 0 : 1), close, volume });
const data = (closes, volume = 10, flat = false) => closes.map((close, index) => bar(index, close, volume, flat));
const source = (version, length, expression = "close") => `//@version=${version}\nindicator("Degenerate TA189")
src=${expression}
plot(ta.cci(src,${length}),"CCI")
plot(ta.wpr(${length}),"WPR")
plot(ta.mfi(src,${length}),"MFI")`;
const values = (result, name) => result.plots.find(plot => plot.name === name).points.map(point => point.value);
const sum = sample => sample.reduce((total, value) => total + value, 0);

// Independent fixed-window definitions: no native TA helpers or shared mutable
// engine state. MFI sums retain the latest length non-na flow components.
function oracle(bars, length, src = bars.map(item => item.close)) {
  const CCI = src.map((value, index) => {
    const sample = src.slice(Math.max(0, index - length + 1), index + 1);
    if (sample.length < length || !sample.every(Number.isFinite)) return NaN;
    // Center the independent mean to avoid manufacturing a deviation for a
    // mathematically constant fractional window through summation rounding.
    const mean = sample[0] + sum(sample.map(item => item - sample[0])) / length;
    const deviation = sum(sample.map(item => Math.abs(item - mean))) / length;
    return (value - mean) / (.015 * deviation);
  });
  const WPR = bars.map((item, index) => {
    const sample = bars.slice(Math.max(0, index - length + 1), index + 1);
    if (sample.length < length) return NaN;
    const high = Math.max(...sample.map(row => row.high)), low = Math.min(...sample.map(row => row.low));
    return -100 * (high - item.close) / (high - low);
  });
  const upper = src.map((value, index) => bars[index].volume * (value - src[index - 1] <= 0 ? 0 : value));
  const lower = src.map((value, index) => bars[index].volume * (value - src[index - 1] >= 0 ? 0 : value));
  const MFI = src.map((_, index) => {
    const up = upper.slice(0, index + 1).filter(Number.isFinite).slice(-length);
    const down = lower.slice(0, index + 1).filter(Number.isFinite).slice(-length);
    return up.length < length || down.length < length ? NaN : 100 - 100 / (1 + sum(up) / sum(down));
  });
  return { CCI, WPR, MFI };
}
function compare(result, expected, label) {
  for (const [name, samples] of Object.entries(expected)) {
    const actual = values(result, name);
    assert.equal(actual.length, samples.length, `${label}:${name}:length`);
    samples.forEach((value, index) => {
      if (!Number.isFinite(value)) assert.equal(actual[index], null, `${label}:${name}:${index}:NA`);
      else assert.ok(typeof actual[index] === "number" && Number.isFinite(actual[index])
        && Math.abs(actual[index] - value) <= 1e-7, `${label}:${name}:${index}: ${actual[index]} != ${value}`);
    });
  }
}
let ordinal = 0;
const run = (source, bars) => pine.executePineRequest({ id: `ta-degenerate189-${++ordinal}`, action: "run", source, bars, context });

test("v5/v6 flat ranges and zero flow remain NA after warmup, including length one", async () => {
  for (const version of [5, 6]) for (const length of [1, 3]) {
    const bars = data(Array(8).fill(100), 10, true);
    const result = await run(source(version, length), bars);
    compare(result, oracle(bars, length), `flat:v${version}:${length}`);
    assert.deepEqual(values(result, "CCI"), Array(8).fill(null));
    assert.deepEqual(values(result, "WPR"), Array(8).fill(null));
    if (length === 3) assert.deepEqual(values(result, "MFI"), [null, null, 50, null, null, null, null, null]);
  }
});

test("zero-volume and constant custom sources do not manufacture 100 or zero signals", async () => {
  for (const version of [5, 6]) {
    const bars = data([100, 101, 99, 104, 98, 103, 103, 100], 0);
    compare(await run(source(version, 3), bars), oracle(bars, 3), `zero-volume:v${version}`);
    const withVolume = bars.map(item => ({ ...item, volume: 10 }));
    compare(await run(source(version, 3, "100.0"), withVolume), oracle(withVolume, 3, Array(8).fill(100)), `constant-source:v${version}`);
  }
});

test("positive, negative and mixed trends preserve independent equation values and custom sources", async () => {
  for (const version of [5, 6]) for (const closes of [
    [100, 101, 102, 103, 104, 105, 106, 107], [107, 106, 105, 104, 103, 102, 101, 100],
    [100, 103, 101, 101, 104, 99, 101, 102, 100, 104],
  ]) for (const length of [1, 3, 5]) {
    const bars = data(closes).map((item, index) => ({ ...item, volume: 3 + index % 5 }));
    compare(await run(source(version, length), bars), oracle(bars, length), `trend:v${version}:${length}`);
    const custom = bars.map(item => (item.high + item.low + item.close) / 3 + item.open * .1);
    compare(await run(source(version, length, "hlc3+open*0.1"), bars), oracle(bars, length, custom), `custom:v${version}:${length}`);
  }
});

test("warm and cold custom-source NA retains genuine finite MFI sums and documented equation output", async () => {
  const bars = data([100, 101, 102, 101, 100, 103, 104, 102, 100, 102, 103, 101]);
  for (const version of [5, 6]) for (const length of [1, 3]) for (const missing of [[5], [0, 1, 5, 6]]) {
    const expression = `${missing.map(index => `bar_index==${index}`).join(" or ")}?na:close`;
    const src = bars.map((item, index) => missing.includes(index) ? NaN : item.close);
    const result = await run(source(version, length, expression), bars);
    compare(result, oracle(bars, length, src), `NA:v${version}:${length}:${missing}`);
    if (length === 3 && missing.length === 1) assert.ok(Math.abs(values(result, "MFI")[5] - 33.6633663366) < 1e-7);
  }
});

test("fractional flows expire into genuine zero windows without erasing tiny nonzero flow", async () => {
  for (const version of [5, 6]) for (const length of [3, 5]) {
    const bars = data([100.1, 101.2, 99.3, 100.4, ...Array(9).fill(100.4)])
      .map((item, index) => ({ ...item, volume: .11 + index % 3 * .07 }));
    compare(await run(source(version, length), bars), oracle(bars, length), `expired:v${version}:${length}`);
    const cancellation = data([101, 101 + 7 / 13, 99 + 7 / 11, ...Array(9).fill(102 + 7 / 17)])
      .map((item, index) => ({ ...item, volume: (index % 3 + 1) / 13 }));
    compare(await run(source(version, length), cancellation), oracle(cancellation, length), `cancellation:v${version}:${length}`);
    const tiny = data([100, 101, 102, 101, 100, 102, 104, 103]).map(item => ({ ...item, volume: 1e-14 }));
    compare(await run(source(version, length), tiny), oracle(tiny, length), `tiny:v${version}:${length}`);
  }
});

test("same-bar ticks roll back tentative flows and range state before confirmation and append", async () => {
  for (const version of [5, 6]) for (const length of [1, 3]) {
    const bars = data([100, 101, 102, 101, 100]);
    const code = source(version, length, "close==999?na:close");
    const executor = pine.createPineLiveExecutor(), sessionId = `ta-live-degenerate189-${++ordinal}`;
    const start = { protocol: "pine-live-v1", sessionId, sequence: 0, action: "start",
      request: { id: `${sessionId}:0`, action: "run", source: code, bars, context, mode: "live" } };
    try {
      compare(await executor.execute(start), oracle(bars, length), `start:v${version}:${length}`);
      let sequence = 0;
      for (const item of [bar(5, 103), bar(5, 999), bar(5, 100, 0, true), bar(5, 104)]) {
        const snapshot = [...bars, item], src = snapshot.map(row => row.close === 999 ? NaN : row.close);
        const result = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: ++sequence, action: "update", bar: item, confirmed: false });
        compare(result, oracle(snapshot, length, src), `tick:v${version}:${length}:${sequence}`);
      }
      const final = bar(5, 999);
      const committed = [...bars, final];
      const closed = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: ++sequence, action: "update", bar: final, confirmed: true });
      compare(closed, oracle(committed, length, committed.map(row => row.close === 999 ? NaN : row.close)), `close:v${version}:${length}`);
      const next = bar(6, 102), snapshot = [...committed, next];
      const appended = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: ++sequence, action: "update", bar: next, confirmed: false });
      compare(appended, oracle(snapshot, length, snapshot.map(row => row.close === 999 ? NaN : row.close)), `append:v${version}:${length}`);
      for (const name of ["CCI", "WPR", "MFI"]) assert.deepEqual(values(appended, name).slice(0, -1), values(closed, name));
    } finally { executor.dispose(); }
  }
});
