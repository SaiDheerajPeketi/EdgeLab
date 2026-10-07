import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const bundle = buildSync({ bundle: true, format: "esm", logLevel: "silent", platform: "browser", write: false,
  stdin: { contents: 'export * from "./frontend/src/lib/pineChartAdapter.ts"; export * from "./frontend/src/workers/pineNative.worker.ts";', loader: "ts", resolveDir: fileURLToPath(new URL("../..", import.meta.url)), sourcefile: "pine-chart-fixture.ts" },
}).outputFiles[0].text;
const pine = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const bars = Array.from({ length: 8 }, (_, index) => ({ time: 1_700_000_040 + index * 60, open: index + 1, high: index + 2, low: index, close: index + 1, volume: 10 }));
async function run(body, declaration = 'indicator("Adapter",overlay=false)') {
  try {
    return await pine.executePineRequest({ id: "adapter", action: "run", source: `//@version=6\n${declaration}\n${body}`, bars, context: { symbol: "TEST", timeframe: "1" } });
  } catch (error) {
    // Keep a rejected in-memory engine bundle out of the test reporter’s stack.
    throw Object.assign(new Error(error.message), { code: error.code });
  }
}

test("native chart adapter preserves gaps, point colors and mixed overlay placement", async () => {
  const result = await run('plot(bar_index == 3 ? na : close,"Gap",style=plot.style_linebr,color=bar_index % 2 == 0 ? color.red : color.blue)\nplot(close,"Overlay",force_overlay=true)');
  const adapted = pine.adaptPineChartResult(result, bars);
  assert.equal(adapted.plots[0].overlay, false);
  assert.equal(adapted.plots[1].overlay, true);
  assert.deepEqual(adapted.plots[0].segments.map((segment) => segment.length), [3, 4]);
  assert.notEqual(adapted.plots[0].segments[0][0].color, adapted.plots[0].segments[0][1].color);
  assert.equal(adapted.plots[0].segments[1][0].time, bars[4].time);
});

test("native chart adapter maps histogram, area and step styles without turning them into ordinary lines", async () => {
  const result = await run('plot(close,"Histogram",style=plot.style_histogram,histbase=2)\nplot(close,"Area",style=plot.style_area,histbase=1)\nplot(close,"Step",style=plot.style_stepline)');
  const adapted = pine.adaptPineChartResult(result, bars);
  assert.deepEqual(adapted.plots.map((plot) => plot.kind), ["histogram", "area", "line"]);
  assert.equal(adapted.plots[0].base, 2);
  assert.equal(adapted.plots[1].base, 1);
  assert.equal(adapted.plots[2].step, true);
  const calls = [];
  const series = () => ({ setData(data) { calls.push(["data", data]); }, setMarkers() {} });
  const chart = { addHistogramSeries(options) { calls.push(["histogram", options]); return series(); }, addBaselineSeries(options) { calls.push(["baseline", options]); return series(); }, addLineSeries(options) { calls.push(["line", options]); return series(); } };
  adapted.plots.filter((plot) => !plot.visual).forEach((plot) => pine.installPineChartPlot(chart, plot));
  assert.equal(calls[0][0], "histogram");
  assert.equal(calls[2][0], "baseline");
  assert.equal(calls[2][1].baseValue.price, 1);
  assert.equal(adapted.plots[2].visual.style, "stepline");
  assert.equal(adapted.plots[2].visual.source, result.plots[2]);
});

test("unsupported native output warns while valid plots remain usable", async () => {
  const result = await run('plot(close,"Supported")');
  result.plots.push({ ...result.plots[0], id: "unsupported", name: "Unsupported", style: "made-up-style" });
  const adapted = pine.adaptPineChartResult(result, bars);
  assert.equal(adapted.plots.length, 1);
  assert.ok(adapted.warnings.some((warning) => warning.includes("made-up-style")));
  result.plots[0].options.offset = 3;
  assert.equal(pine.adaptPineChartResult(result, bars).plots[0].visual.plotOffset, 3);
});

test("native shapes keep their requested position, color and true bars only", async () => {
  const result = await run('plotshape(close > 3,"Signals",style=shape.circle,location=location.belowbar,color=color.red)');
  const adapted = pine.adaptPineChartResult(result, bars);
  assert.ok(adapted.plots.length, JSON.stringify({ plots: result.plots, warnings: adapted.warnings }));
  assert.equal(adapted.plots[0].kind, "markers");
  assert.equal(adapted.plots[0].markers.length, 5);
  assert.equal(adapted.plots[0].markers[0].time, bars[3].time);
  assert.equal(adapted.plots[0].markers[0].position, "belowBar");
  assert.equal(adapted.plots[0].markers[0].shape, "circle");
  assert.equal(adapted.plots[0].segments[0][0].value, bars[3].low);
});

test("hidden native plot colors do not become fallback-colored signals", async () => {
  const result = await run('plot(close,"Hidden",color=na)');
  const adapted = pine.adaptPineChartResult(result, bars);
  assert.ok(adapted.plots[0].segments[0].every((point) => point.color === "rgba(0,0,0,0)"));
});

test("absolute native shapes preserve a real zero value instead of treating it as false", async () => {
  const result = await run('plotshape(0,"Zero",style=shape.square,location=location.absolute)');
  const adapted = pine.adaptPineChartResult(result, bars);
  assert.equal(adapted.plots[0].markers.length, bars.length);
  assert.ok(adapted.plots[0].segments[0].every((point) => point.value === 0));
  assert.equal(adapted.plots[0].visual.source.options.location, "Absolute");
});

test("native display.none and data-window-only plots stay off the chart", async () => {
  const result = await run('plot(close,"Hidden",display=display.none)\nplot(close,"Data only",display=display.data_window)\nplot(close,"Shown",display=display.all)');
  const adapted = pine.adaptPineChartResult(result, bars);
  assert.deepEqual(adapted.plots.map((plot) => plot.name), ["Shown"]);
});

test("required OHLC na creates a candle gap without failing other valid plots", async () => {
  const result = await run('plotcandle(open,high,low,bar_index == 2 ? na : close,"Candles")\nplot(close,"Line")');
  const adapted = pine.adaptPineChartResult(result, bars);
  const candle = adapted.plots.find((plot) => plot.kind === "candles");
  assert.ok(candle);
  assert.equal(candle.segments[0].find((point) => point.time === bars[2].time)?.open, undefined);
  assert.ok(adapted.plots.some((plot) => plot.name === "Line"));
});

test("OHLC missing values become gaps while malformed and infinite arrays remain rejected", () => {
  for (const missing of [null, undefined, NaN]) assert.equal(pine.normalizePinePlotValue([1, 2, 0, missing]), null);
  assert.deepEqual(pine.normalizePinePlotValue([1, 2, 0, 1]), [1, 2, 0, 1]);
  for (const invalid of [[1, 2, 0], [1, 2, 0, 1, 9], [1, 2, 0, "1"], [1, 2, 0, Infinity], [1, 2, 0, -Infinity], [1, 2, null, Infinity], [1, 2, null, {}]]) {
    assert.throws(() => pine.normalizePinePlotValue(invalid), (error) => error.code === "UNSUPPORTED_RESULT");
  }
});

test("native shape text colors and size retain raw options with honest calibration disclosure", async () => {
  const result = await run('plotshape(close > 3,"Signals",style=shape.circle,text="GO",textcolor=color.blue,size=size.huge)');
  const adapted = pine.adaptPineChartResult(result, bars);
  assert.equal(adapted.plots[0].visual.source.options.textcolor, "#2962FF");
  assert.equal(adapted.plots[0].visual.source.options.size, "huge");
  assert.ok(!adapted.warnings.some((warning) => /text.?colo(?:u)?r/i.test(warning)));
  assert.ok(adapted.warnings.some((warning) => /calibration/i.test(warning)));
});

test("native plot width clipping and ignored tracking are disclosed", async () => {
  const result = await run('plot(close,"Wide",linewidth=8,trackprice=true)');
  const adapted = pine.adaptPineChartResult(result, bars);
  assert.ok(adapted.warnings.some((warning) => /width/i.test(warning)));
  assert.ok(adapted.warnings.some((warning) => /track/i.test(warning)));
});

test("disconnected native plots have a bounded series count and preserve na rather than bridging", async () => {
  const result = await run('plot(close,"Gap",style=plot.style_linebr)');
  const snapshot = Array.from({ length: 40 }, (_, index) => ({ ...bars[0], time: bars[0].time + index * 60 }));
  result.plots[0].points = snapshot.map((bar, index) => ({ time: bar.time, value: index % 2 ? null : index, options: {} }));
  const adapted = pine.adaptPineChartResult(result, snapshot);
  assert.equal(adapted.plots.length, 1);
  assert.equal(adapted.plots[0].segments.length, 20);
  assert.equal(adapted.plots[0].visual.source, result.plots[0]);
  assert.ok(!adapted.warnings.some((warning) => warning.includes("disconnected segments")));
});

test("strategy markers come from executed engine trades and omit pending orders", async () => {
  const result = await run('if bar_index == 1\n    strategy.entry("L",strategy.long,qty=2)\nif bar_index == 4\n    strategy.close("L")', 'strategy("Ledger",initial_capital=1000)');
  const adapted = pine.adaptPineChartResult(result, bars);
  assert.equal(adapted.strategyMarkers.length, 2);
  assert.equal(adapted.strategyMarkers[0].time, bars[2].time);
  assert.equal(adapted.strategyMarkers[1].time, bars[5].time);
  assert.match(adapted.strategyMarkers[0].text, /Pine entry L/);
});
