import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const bundle = buildSync({
  bundle: true,
  define: { "import.meta.env": "{}" },
  format: "esm",
  logLevel: "silent",
  platform: "node",
  stdin: {
    contents: 'export * from "./frontend/src/lib/charting.ts";',
    loader: "ts",
    resolveDir: repoRoot,
    sourcefile: "indicator-calculations-entry.ts",
  },
  target: "node22",
  write: false,
}).outputFiles[0].text;
const charting = await import(
  `data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`,
);

function barsFromRows(rows) {
  return rows.map(([high, low, close], index) => ({
    close,
    ema_20: null,
    ema_50: null,
    high,
    low,
    open: close,
    rsi_14: null,
    time: 1_700_000_000 + index * 60,
    timestamp: new Date((1_700_000_000 + index * 60) * 1_000).toISOString(),
    volume: 100,
  }));
}

function assertValues(points, expected, message) {
  assert.equal(points.length, expected.length, message);
  expected.forEach((value, index) =>
    assert.ok(
      Math.abs(points[index].value - value) < 1e-10,
      `${message}: point ${index} expected ${value}, received ${points[index].value}`,
    ),
  );
}

function supertrend(bars, period = 2, multiplier = 1) {
  return charting.buildIndicatorDefinitions(bars, [{
    id: "supertrend-regression",
    kind: "supertrend",
    settings: { color: "#ffffff", period, stdDev: multiplier },
    visible: true,
  }])[0].data;
}

test("ATR waits for a full true-range seed and uses Wilder smoothing", () => {
  // True ranges: 2, 4, 3, 5, 3, 3. Seed at index 2 is (2 + 4 + 3) / 3.
  const bars = barsFromRows([
    [11, 9, 10], [14, 10, 12], [13, 10, 11],
    [16, 12, 14], [14, 11, 13], [16, 13, 15],
  ]);
  assert.deepEqual(charting.atrSeries([], 3), []);
  assert.deepEqual(charting.atrSeries(bars.slice(0, 2), 3), []);
  const output = charting.atrSeries(bars, 3);
  assertValues(output, [3, 11 / 3, 31 / 9, 89 / 27], "Wilder ATR");
  assert.equal(output[0].time, bars[2].time);
  assertValues(charting.atrSeries(bars, 1), [2, 4, 3, 5, 3, 3], "one-bar ATR");
});

test("SuperTrend trails bands and reverses only after a close crosses the active band", () => {
  const bars = barsFromRows([
    [11, 9, 10], [12, 10, 11], [15, 12, 14], [16, 14, 15],
    [15, 13, 14], [11, 8, 9], [10, 8, 9], [14, 11, 13],
  ]);
  assert.deepEqual(supertrend([]), []);
  assert.deepEqual(supertrend(bars.slice(0, 1)), []);
  const output = supertrend(bars);
  assertValues(
    output,
    [13, 10.5, 12.5, 12.5, 13.625, 12.0625, 8.46875],
    "SuperTrend trailing band",
  );
  assert.equal(output[0].time, bars[1].time);
  // A lower close at index 4 stays bullish because it remains above the trailing lower band.
  assert.ok(output[3].value < bars[4].close);
  assert.ok(output[4].value > bars[5].close);
  assert.ok(output[6].value < bars[7].close);
});

test("ATR and SuperTrend preserve every historical value when replay advances", () => {
  const bars = barsFromRows([
    [11, 9, 10], [12, 10, 11], [15, 12, 14], [16, 14, 15],
    [15, 13, 14], [11, 8, 9], [10, 8, 9], [14, 11, 13],
  ]);
  const original = structuredClone(bars);
  for (const calculate of [
    (sample) => charting.atrSeries(sample, 2),
    (sample) => supertrend(sample),
  ]) {
    const complete = calculate(bars);
    for (let length = 0; length <= bars.length; length += 1) {
      const prefix = bars.slice(0, length);
      assert.deepEqual(
        calculate(prefix),
        complete.filter((point) => prefix.some((bar) => bar.time === point.time)),
      );
    }
  }
  assert.deepEqual(bars, original);
});

test("RSI uses Wilder gains and losses with neutral flat-price behavior", () => {
  const sample = barsFromRows([
    [11, 9, 10], [14, 10, 12], [13, 10, 11],
    [16, 12, 14], [14, 11, 13], [16, 13, 15],
  ]);
  assertValues(charting.rsiSeries(sample, 3), [250 / 3, 200 / 3, 475 / 6], "Wilder RSI");
  assert.equal(charting.rsiSeries(sample, 3)[0].time, sample[3].time);
  assert.deepEqual(charting.rsiSeries(sample.slice(0, 3), 3), []);
  assert.deepEqual(charting.rsiSeries([], 3), []);
  for (const [closes, expected] of [
    [[10, 10, 10, 10, 10], [50, 50]],
    [[10, 11, 12, 13, 14], [100, 100]],
    [[10, 9, 8, 7, 6], [0, 0]],
  ]) {
    const bars = barsFromRows(closes.map((close) => [close + 1, close - 1, close]));
    assertValues(charting.rsiSeries(bars, 3), expected, "RSI direction limits");
  }
});
