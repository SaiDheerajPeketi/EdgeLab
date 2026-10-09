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
    contents: [
      'export * from "./frontend/src/lib/charting.ts";',
      'export * from "./frontend/src/lib/chartSessions.ts";',
      'export * from "./frontend/src/lib/indicatorDsl.ts";',
      'export * from "./frontend/src/lib/customIndicators.ts";',
    ].join("\n"),
    loader: "ts",
    resolveDir: repoRoot,
    sourcefile: "indicator-calculations-entry.ts",
  },
  target: "node22",
  write: false,
}).outputFiles[0].text;
const charting = await import(
  `data:text/javascript;base64,${Buffer.from(bundle + "\n//# sourceURL=indicator-calculations-bundle.js").toString("base64")}`,
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

function vwap(bars, context = {}) {
  return charting.buildIndicatorDefinitions(bars, [{
    id: "vwap-regression",
    kind: "vwap",
    settings: { color: "#ffffff", period: 1 },
  }], context)[0].data;
}

function timedBars(timestamps, prices) {
  return barsFromRows(prices.map((price) => [price + 1, price - 1, price]))
    .map((bar, index) => ({ ...bar, time: Date.parse(timestamps[index]) / 1_000, timestamp: timestamps[index], volume: 1 }));
}

test("VWAP follows exchange rollover across UTC midnight while legacy callers retain UTC days", () => {
  const bars = timedBars([
    "2026-06-01T21:59:00Z", "2026-06-01T22:00:00Z",
    "2026-06-01T23:59:00Z", "2026-06-02T00:00:00Z",
  ], [10, 20, 30, 40]);
  const original = structuredClone(bars);
  const context = { sessionTemplate: charting.getChartSessionTemplate("cme-futures") };
  const result = vwap(bars, context);
  assertValues(result, [10, 20, 25, 30], "CME session VWAP");
  assertValues(vwap(bars), [10, 15, 20, 40], "legacy UTC VWAP");
  for (let length = 0; length <= bars.length; length += 1) {
    assert.deepEqual(vwap(bars.slice(0, length), context), result.slice(0, length));
  }
  assert.deepEqual(bars, original);
});

test("forex VWAP rollover follows New York daylight saving time", () => {
  const context = { sessionTemplate: charting.getChartSessionTemplate("forex-24x5") };
  const summer = timedBars([
    "2026-06-01T20:59:00Z", "2026-06-01T21:00:00Z", "2026-06-01T22:00:00Z",
  ], [10, 20, 30]);
  const winter = timedBars([
    "2026-01-05T21:59:00Z", "2026-01-05T22:00:00Z", "2026-01-05T23:00:00Z",
  ], [10, 20, 30]);
  assertValues(vwap(summer, context), [10, 20, 25], "summer FX VWAP");
  assertValues(vwap(winter, context), [10, 20, 25], "winter FX VWAP");
});

test("VWAP uses source volumes before a multi-hour candle crosses session rollover", () => {
  const sourceBars = timedBars([
    "2026-06-01T20:30:00Z", "2026-06-01T21:00:00Z", "2026-06-01T22:00:00Z",
  ], [10, 20, 30]);
  sourceBars[1].volume = 3;
  const bars = charting.aggregateBars(sourceBars, "4H");
  assert.equal(bars.length, 1);
  const output = vwap(bars, {
    sessionTemplate: charting.getChartSessionTemplate("forex-24x5"),
    sourceBars,
    timeframe: "4H",
  });
  assertValues(output, [22.5], "volume-weighted post-rollover value");
  assert.equal(output[0].time, bars[0].time);
});

test("VWAP normalizes source ordering and duplicates exactly like plotted candles", () => {
  const rows = timedBars([
    "2026-06-01T20:30:00Z", "2026-06-01T21:00:00Z", "2026-06-01T22:00:00Z",
  ], [10, 20, 30]);
  const sourceBars = [rows[2], { ...rows[0], close: 999, volume: 999 }, rows[1], rows[0]];
  const original = structuredClone(sourceBars);
  const output = vwap(charting.aggregateBars(sourceBars, "1H"), {
    sessionTemplate: charting.getChartSessionTemplate("forex-24x5"),
    sourceBars,
    timeframe: "1H",
  });
  assertValues(output, [10, 20, 25], "normalized source VWAP");
  assert.deepEqual(sourceBars, original);
});

test("one-minute VWAP retains second-offset timestamps used by plotted candles", () => {
  const sourceBars = timedBars([
    "2026-06-01T20:30:15Z", "2026-06-01T21:00:15Z", "2026-06-01T22:00:15Z",
  ], [10, 20, 30]);
  const bars = charting.aggregateBars(sourceBars, "1m");
  const output = vwap(bars, {
    sessionTemplate: charting.getChartSessionTemplate("forex-24x5"),
    sourceBars,
    timeframe: "1m",
  });
  assertValues(output, [10, 20, 25], "one-minute VWAP");
  assert.deepEqual(output.map((point) => point.time), bars.map((bar) => bar.time));
});

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

function executeExpression(bars, expression) {
  return charting.executeEdgeIndicator({
    bars,
    source: `indicator "Calculation regression" pane\nplot "Value" = ${expression} color "#ffffff"`,
  }).plots[0].points;
}

test("DSL ATR and RSI match the native Wilder calculations", () => {
  const bars = barsFromRows([
    [11, 9, 10], [14, 10, 12], [13, 10, 11],
    [16, 12, 14], [14, 11, 13], [16, 13, 15],
  ]);
  assert.deepEqual(executeExpression(bars, "atr(3)"), charting.atrSeries(bars, 3));
  assert.deepEqual(executeExpression(bars, "rsi(close, 3)"), charting.rsiSeries(bars, 3));
  const flat = barsFromRows(Array.from({ length: 6 }, () => [11, 9, 10]));
  assertValues(executeExpression(flat, "rsi(close, 3)"), [50, 50, 50], "flat DSL RSI");
});

test("DSL ADX waits for seeded directional movement and a full Wilder DX average", () => {
  // Initial DM seed is +1/-0; following DX values are 100, 100/3, 100/9, 1100/27.
  const bars = barsFromRows([
    [11, 9, 10], [12, 10, 11], [13, 11, 12], [14, 12, 13],
    [13, 11, 12], [12, 10, 11], [11, 9, 10],
  ]);
  assert.deepEqual(executeExpression(bars.slice(0, 5), "adx(3)"), []);
  const output = executeExpression(bars, "adx(3)");
  assertValues(output, [1300 / 27, 3700 / 81], "Wilder ADX");
  assert.equal(output[0].time, bars[5].time);
  const flat = barsFromRows(Array.from({ length: 7 }, () => [11, 9, 10]));
  assertValues(executeExpression(flat, "adx(3)"), [0, 0], "flat ADX");
});

test("DSL MFI excludes unchanged typical prices and is neutral without directional flow", () => {
  const bars = barsFromRows([10, 11, 11, 9, 10].map((close) => [close + 1, close - 1, close]));
  assertValues(executeExpression(bars, "mfi(2)"), [100, 0, 1000 / 19], "MFI directional money flow");
  assert.equal(executeExpression(bars, "mfi(2)")[0].time, bars[2].time);
  const flat = barsFromRows(Array.from({ length: 5 }, () => [11, 9, 10]));
  assertValues(executeExpression(flat, "mfi(2)"), [50, 50, 50], "flat MFI");
  const noVolume = bars.map((bar) => ({ ...bar, volume: 0 }));
  assertValues(executeExpression(noVolume, "mfi(2)"), [50, 50, 50], "zero-volume MFI");
});

test("historical volatility requires valid returns and supports explicit annualization", () => {
  const bars = barsFromRows([100, 200, 100].map((close) => [close + 1, close - 1, close]));
  assert.deepEqual(executeExpression(bars.slice(0, 2), "histvol(close, 2)"), []);
  assertValues(
    executeExpression(bars, "histvol(close, 2)"),
    [Math.log(2) * Math.sqrt(252) * 100],
    "default historical volatility",
  );
  assertValues(
    executeExpression(bars, "histvol(close, 2, 1)"),
    [Math.log(2) * 100],
    "explicit historical volatility",
  );
  const invalid = barsFromRows([100, 0, 100, 200, 100].map((close) => [close + 1, close - 1, close]));
  const recovered = executeExpression(invalid, "histvol(close, 2, 1)");
  assertValues(recovered, [Math.log(2) * 100], "recovered historical volatility");
  assert.equal(recovered[0].time, invalid[4].time);
});

test("DSL studies preserve historical replay prefixes without mutating candle epochs", () => {
  const bars = barsFromRows([
    [11, 9, 10], [12, 10, 11], [13, 11, 12], [14, 12, 13],
    [13, 11, 12], [12, 10, 11], [11, 9, 10], [14, 11, 13],
  ]);
  const original = structuredClone(bars);
  for (const expression of ["atr(3)", "rsi(close, 3)", "adx(3)", "mfi(3)", "histvol(close, 3, 1)"]) {
    const complete = executeExpression(bars, expression);
    for (let length = 0; length <= bars.length; length += 1) {
      const prefix = bars.slice(0, length);
      assert.deepEqual(
        executeExpression(prefix, expression),
        complete.filter((point) => prefix.some((bar) => bar.time === point.time)),
        expression,
      );
    }
  }
  assert.deepEqual(bars, original);
});

test("every first-party study executes deterministically with finite chart points", () => {
  const bars = barsFromRows(Array.from({ length: 180 }, (_, index) => {
    const close = 100 + index * 0.2 + Math.sin(index / 5);
    return [close + 1, close - 1, close];
  }));
  // Native Pine entries execute through the genuine worker in pine-builtins186;
  // this existing DSL contract keeps all of its original studies and oracles.
  for (const study of charting.FIRST_PARTY_EDGE_INDICATORS.filter((item) => !charting.isPineScriptSource(item.source))) {
    const first = charting.executeEdgeIndicator({ bars, source: study.source });
    assert.ok(first.plots.length > 0, study.name);
    for (const plot of first.plots) {
      assert.ok(plot.points.length > 0, study.name);
      assert.ok(plot.points.every((point) => Number.isFinite(point.value)), study.name);
    }
    const second = charting.executeEdgeIndicator({ bars, source: study.source });
    assert.deepEqual(first.plots, second.plots, study.name);
  }
});

test("first-party historical volatility exposes its annualization setting", () => {
  const study = charting.FIRST_PARTY_EDGE_INDICATORS.find((item) => item.id === "first-party:historical-volatility");
  assert.ok(study);
  const parsed = charting.parseEdgeIndicator(study.source);
  const annualization = parsed.program.inputs.find((input) => input.name === "periodsPerYear");
  assert.ok(annualization);
  assert.equal(annualization.defaultValue, 252);
  const bars = barsFromRows([100, 200, 100].map((close) => [close + 1, close - 1, close]));
  const result = charting.executeEdgeIndicator({
    bars,
    inputs: { period: 2, periodsPerYear: 1 },
    source: study.source,
  });
  assertValues(result.plots[0].points, [Math.log(2) * 100], "catalog annualization");
});
