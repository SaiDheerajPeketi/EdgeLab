import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

// Exercise the same reviewed engine and minification path as the production worker.
const bundle = (await build({ bundle: true, minify: true, platform: "browser", format: "esm", write: false, logLevel: "silent", plugins: [createPineEnginePlugin()], stdin: {
  contents: 'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineChartAdapter.ts"; export * from "./frontend/src/lib/pineVisualPrimitive.ts";',
  resolveDir: fileURLToPath(new URL("../..", import.meta.url)), loader: "ts", sourcefile: "pine-linestyle86-oracles.ts",
} })).outputFiles[0].text;
const pine = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const bars = Array.from({ length: 12 }, (_, i) => ({ time: 1700000040 + i * 60, open: 10, high: 12, low: 8, close: 10, volume: 20 }));
const source = body => '//@version=6\nindicator("Styles",overlay=false)\n' + body;
const run = (body, inputs = {}) => pine.executePineRequest({ id: "styles86", action: "run", source: source(body), bars, inputs, context: { symbol: "TEST", timeframe: "1", mintick: .01, pointvalue: 1 } });
const plot = (style = "line", linestyle = "dashed", series = "10", extra = "") => `plot(${series},"Styled",color=#ff00ff,linewidth=2,style=plot.style_${style},linestyle=plot.linestyle_${linestyle}${extra})`;
function canvas() {
  const paths = [], stack = []; let points = [];
  const ctx = { fillStyle: "black", strokeStyle: "black", lineWidth: 1, lineCap: "butt", lineDashOffset: 0, dash: [],
    save() { stack.push({ fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, lineCap: this.lineCap, lineDashOffset: this.lineDashOffset, dash: [...this.dash] }); },
    restore() { Object.assign(this, stack.pop()); }, setLineDash(value) { this.dash = [...value]; },
    beginPath() { points = []; }, moveTo(x, y) { points.push([x, y]); }, lineTo(x, y) { points.push([x, y]); }, closePath() {}, arc(x, y, radius) { points.push([x, y, radius]); },
    rect(x, y, width, height) { points.push([x, y], [x + width, y + height]); }, clip() {},
    stroke() { paths.push({ mode: "stroke", points: [...points], color: this.strokeStyle, width: this.lineWidth, cap: this.lineCap, dash: [...this.dash], phase: this.lineDashOffset }); },
    fill() { paths.push({ mode: "fill", points: [...points], color: this.fillStyle }); },
  };
  return { ctx, paths, target: { useMediaCoordinateSpace(fn) { fn({ context: ctx, mediaSize: { width: 200, height: 100 } }); } } };
}
function harness(result, from = 0, to = 11, spacing = 7, origin = 0) {
  const adapted = pine.adaptPineChartResult(result, bars), listeners = new Set();
  const x = index => origin + (index - from) * spacing;
  const scale = { getVisibleLogicalRange: () => ({ from, to }), getVisibleRange: () => ({ from: bars[Math.max(0, Math.floor(from))]?.time, to: bars[Math.min(11, Math.ceil(to))]?.time }),
    timeToCoordinate: time => x(bars.findIndex(b => b.time === time)), logicalToCoordinate: x, coordinateToLogical: px => from + (px - origin) / spacing,
    subscribeVisibleLogicalRangeChange: cb => listeners.add(cb), unsubscribeVisibleLogicalRangeChange: cb => listeners.delete(cb), subscribeVisibleTimeRangeChange: cb => listeners.add(cb), unsubscribeVisibleTimeRangeChange: cb => listeners.delete(cb) };
  const chart = { timeScale: () => scale, paneSize: () => ({ width: 200, height: 100 }), subscribeSizeChange: cb => listeners.add(cb), unsubscribeSizeChange: cb => listeners.delete(cb), removeSeries() {},
    addLineSeries(options) { return { options: () => options, setData() {}, priceToCoordinate: value => 80 - value * 2, priceScale: () => ({ options: () => ({ invertScale: false }) }),
      subscribeDataChanged: cb => listeners.add(cb), unsubscribeDataChanged: cb => listeners.delete(cb), attachPrimitive(p) { p.attached({ chart, series: this, requestUpdate() {} }); }, detachPrimitive(p) { p.detached(); } }; } };
  const installed = pine.installPineChartPlots(chart, adapted.plots);
  return { adapted, installed, listeners, draw() { const recording = canvas(); installed.primitive.updateAllViews(); for (const view of installed.primitive.paneViews()) { const renderer = view.renderer(); renderer?.drawBackground?.(recording.target); renderer?.draw(recording.target); } return recording; } };
}

test("named mixed and sixteen positional arguments preserve native linestyle and placement", async () => {
  for (const body of [plot(), 'plot(10,"Styled",#ff00ff,2,plot.style_line,false,0,0,false,true,12,display.all,format.price,2,false,plot.linestyle_dashed)', 'plot(10,"Styled",#ff00ff,linestyle=plot.linestyle_dashed)']) {
    const result = await run(body), adapted = pine.adaptPineChartResult(result, bars);
    assert.equal(result.plots[0].options.linestyle, "linestyle_dashed");
    assert.equal(adapted.plots[0].visual.linestyle, "dashed"); assert.equal(adapted.plots[0].overlay, false);
    assert.ok(adapted.warnings.some(w => /local canvas metrics/.test(w)));
  }
  const typed = await run('plot_line_style chosen=plot.linestyle_dotted\nplot(10,linestyle=chosen)');
  assert.equal(typed.plots[0].options.linestyle, "linestyle_dotted");
  assert.equal(pine.adaptPineChartResult(await run('plot(10)'), bars).plots[0].visual.linestyle, "solid");
});

test("unsupported invalid na and historically changing line styles reject", async () => {
  for (const value of ['"dashed"', '"linestyle_wrong"', "na", "1", "true", 'bar_index<3?plot.linestyle_solid:plot.linestyle_dashed'])
    await assert.rejects(run(`plot(10,linestyle=${value})`), /linestyle|line style|solid|constant|Plot/i);
});

test("invalid or changing transferred metadata cannot silently render a solid fallback", async () => {
  const result = await run(plot());
  for (const value of [null, "dashed", 1, "linestyle_unknown"]) {
    const forged = structuredClone(result); forged.plots[0].options.linestyle = value;
    const adapted = pine.adaptPineChartResult(forged, bars);
    assert.equal(adapted.plots.length, 0); assert.ok(adapted.warnings.some(w => /invalid or changing/.test(w)));
  }
  const forged = structuredClone(result); forged.plots[0].points[3].options = { linestyle: "linestyle_dotted" };
  assert.equal(pine.adaptPineChartResult(forged, bars).plots.length, 0);
});

test("connected short bar intervals retain one dashed path and restore canvas state", async () => {
  const f = harness(await run(plot())), recording = f.draw(), strokes = recording.paths.filter(p => p.mode === "stroke");
  assert.equal(strokes.length, 1); assert.equal(strokes[0].points.length, 12); assert.deepEqual(strokes[0].dash, [12, 8]);
  assert.equal(strokes[0].cap, "butt"); assert.ok(strokes[0].phase === 0);
  assert.deepEqual(recording.ctx.dash, []); assert.equal(recording.ctx.lineDashOffset, 0); assert.equal(recording.ctx.lineCap, "butt");
  f.installed.dispose(); assert.equal(f.listeners.size, 0);
});

test("dash phase advances through color changes and clipped prefixes without restarting bars", async () => {
  const body = 'plot(10,color=bar_index<4?#ff00ff:#00ffff,linewidth=2,linestyle=plot.linestyle_dashed)';
  const f = harness(await run(body)), strokes = f.draw().paths.filter(p => p.mode === "stroke");
  assert.equal(strokes.length, 2); assert.equal(strokes[1].phase, -(21 % 20));
  f.installed.dispose();
  const clipped = harness(await run(plot()), 0, 11, 7, -5), path = clipped.draw().paths.find(p => p.mode === "stroke");
  assert.deepEqual(path.points[0], [0, 60]); assert.equal(path.phase, -5); clipped.installed.dispose();
});

test("dotted lines use round caps and linebr retains na breaks while line bridges", async () => {
  const dotted = harness(await run(plot("line", "dotted"))), path = dotted.draw().paths.find(p => p.mode === "stroke");
  assert.deepEqual(path.dash, [0, 4]); assert.equal(path.cap, "round"); dotted.installed.dispose();
  for (const [style, count] of [["line", 1], ["linebr", 2]]) {
    const f = harness(await run(plot(style, "dashed", "bar_index==4?na:10"))), strokes = f.draw().paths.filter(p => p.mode === "stroke");
    assert.equal(strokes.length, count); assert.ok(strokes.every(p => p.dash.length === 2)); f.installed.dispose();
  }
});

test("only the documented five styles use line patterns and area fills stay continuous", async () => {
  for (const style of ["line", "linebr", "stepline", "stepline_diamond", "area"]) {
    const f = harness(await run(plot(style))), output = f.draw().paths;
    assert.equal(f.adapted.plots[0].visual.linestyle, "dashed");
    assert.ok(output.filter(p => p.mode === "stroke").every(p => p.dash.length === 2));
    if (style === "area") {
      assert.equal(output.filter(p => p.mode === "fill").length, 1);
      assert.ok(output.find(p => p.mode === "fill").points.length >= 14);
    }
    f.installed.dispose();
  }
  for (const style of ["areabr", "steplinebr", "histogram", "columns", "circles", "cross"]) {
    const f = harness(await run(plot(style))), output = f.draw().paths;
    assert.ok(output.length > 0); assert.ok(output.filter(p => p.mode === "stroke").every(p => p.dash.length === 0));
    assert.ok(!f.adapted.warnings.some(w => /dash and dot/.test(w))); f.installed.dispose();
  }
});

test("diamond steps use corners and filled glyphs only at retained numeric changes", async () => {
  const f = harness(await run(plot("stepline_diamond", "dotted", "bar_index<3?10:bar_index<7?15:10"))), output = f.draw().paths;
  const strokes = output.filter(p => p.mode === "stroke"), diamonds = output.filter(p => p.mode === "fill");
  assert.equal(strokes.length, 1); assert.equal(strokes[0].points.length, 23); assert.equal(diamonds.length, 2);
  assert.deepEqual(diamonds.map(p => p.points[1][0] - 4), [21, 49]);
  assert.ok(diamonds.every(p => p.points.length === 4));
  const range = f.installed.primitive.rangeForVisible(); assert.deepEqual(range.priceRange, { minValue: 10, maxValue: 15 }); assert.equal(range.margins.above, 4); assert.equal(range.margins.below, 4);
  f.installed.dispose();
});

test("offsets source-first show_last and hidden placement survive linestyle geometry", async () => {
  const f = harness(await run(plot("line", "dashed", "10", ",offset=2,show_last=3,force_overlay=true"))), strokes = f.draw().paths.filter(p => p.mode === "stroke");
  assert.equal(f.adapted.plots[0].overlay, true); assert.equal(strokes.length, 1);
  assert.deepEqual(strokes[0].points.map(p => p[0]), [77, 84, 91]); f.installed.dispose();
  assert.equal(pine.adaptPineChartResult(await run(plot("line", "dashed", "10", ",display=display.none")), bars).plots.length, 0);
});
