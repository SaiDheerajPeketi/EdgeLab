import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const bundle = buildSync({ bundle: true, format: "esm", platform: "browser", write: false, logLevel: "silent", stdin: {
  contents: 'export * from "./frontend/src/lib/pineChartAdapter.ts"; export * from "./frontend/src/lib/pineVisualPrimitive.ts"; export * from "./frontend/src/lib/pinePacked.ts"; export * from "./frontend/src/workers/pineNative.worker.ts"; export { Indicator, PineTS } from "pinets";',
  loader: "ts", resolveDir: fileURLToPath(new URL("../..", import.meta.url)), sourcefile: "pine-visual-oracles.ts",
} }).outputFiles[0].text;
const pine = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const fixtureBytes = readFileSync(new URL("../../e2e/pine-visuals.bars.json", import.meta.url));
assert.equal(createHash("sha256").update(fixtureBytes).digest("hex"), "fc9a28c87aed819daae602ea45422d0d40979bd42f86097607310b0300645ea1");
const bars = JSON.parse(fixtureBytes);
const sourceFor = (name) => readFileSync(new URL(`../../frontend/public/catalog/pine/everget/0b164e1e4f2fb7b06524c6d0a26e6132228c9448/trailing_stops/${name}.pine`, import.meta.url), "utf8");
const hashes = { supertrend: "f693c60a20960bbd156455744838dc97892f2a5662810770c7677a66e9b5705d", chandelier_exit: "d505921fb4b9b7933b45a443cd3c13c255b30fa6c6216e7061844d3fb62eceda", halftrend: "efa1915b4d0812d8126bd27c7667f9408e90aeed94988058b1b1edeaa23f4a3c" };
async function native(source, snapshot = bars) {
  try { return await pine.executePineRequest({ id: "visual-oracle", action: "run", source, bars: snapshot, context: { symbol: "TEST", timeframe: "1", mintick: 0.01, pointvalue: 1 } }); }
  catch (cause) { throw Object.assign(new Error(cause.message), { code: cause.code }); }
}
async function raw(source, snapshot = bars) {
  const candles = snapshot.map((bar) => ({ openTime: bar.time * 1000, closeTime: (bar.time + 60) * 1000, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume }));
  const engine = new pine.PineTS(candles, "TEST", "1", snapshot.length);
  engine.setTimezone("UTC"); engine.setMaxLoops(10_000);
  return engine.run(new pine.Indicator(source));
}

// Record the renderer's public Canvas2D operations. Expected geometry is derived
// separately from raw PineTS points and these independent coordinate transforms.
function recordingTarget() {
  const paths = [], text = [], states = [];
  let path = [], matrix = [1, 0, 0, 1, 0, 0];
  const xy = (x, y) => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
  const context = {
    fillStyle: "black", strokeStyle: "black", lineWidth: 1, font: "12px sans-serif", globalAlpha: 1,
    save() { states.push({ matrix: [...matrix], fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, font: this.font, globalAlpha: this.globalAlpha }); },
    restore() { const state = states.pop(); if (state) { matrix = state.matrix; Object.assign(this, state); } },
    scale(x, y) { matrix[0] *= x; matrix[1] *= x; matrix[2] *= y; matrix[3] *= y; },
    translate(x, y) { matrix[4] += matrix[0] * x + matrix[2] * y; matrix[5] += matrix[1] * x + matrix[3] * y; },
    setTransform(a, b, c, d, e, f) { matrix = [a, b, c, d, e, f]; }, resetTransform() { matrix = [1, 0, 0, 1, 0, 0]; },
    beginPath() { path = []; }, moveTo(x, y) { path.push({ kind: "move", xy: xy(x, y) }); }, lineTo(x, y) { path.push({ kind: "line", xy: xy(x, y) }); },
    arc(x, y, radius) { path.push({ kind: "arc", xy: xy(x, y), radius: radius * matrix[0] }); },
    rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); },
    roundRect(x, y, w, h) { this.rect(x, y, w, h); }, closePath() { path.push({ kind: "close" }); },
    stroke() { paths.push({ mode: "stroke", style: this.strokeStyle, width: this.lineWidth, commands: [...path], alpha: this.globalAlpha }); },
    fill() { paths.push({ mode: "fill", style: this.fillStyle, commands: [...path], alpha: this.globalAlpha }); },
    fillRect(x, y, w, h) { const old = path; this.beginPath(); this.rect(x, y, w, h); this.fill(); path = old; },
    strokeRect(x, y, w, h) { const old = path; this.beginPath(); this.rect(x, y, w, h); this.stroke(); path = old; },
    fillText(value, x, y) { text.push({ value, xy: xy(x, y), color: this.fillStyle, font: this.font }); },
    measureText(value) { return { width: String(value).length * 7, actualBoundingBoxAscent: 9, actualBoundingBoxDescent: 3 }; },
    createLinearGradient() { return { addColorStop() {} }; }, clip() {}, setLineDash() {}, clearRect() {},
  };
  const scope = { context, mediaSize: { width: 2800, height: 1000 }, bitmapSize: { width: 2800, height: 1000 }, horizontalPixelRatio: 1, verticalPixelRatio: 1 };
  return { paths, text, context, useMediaCoordinateSpace(callback) { callback(scope); }, useBitmapCoordinateSpace(callback) { callback(scope); } };
}
function harness(snapshot = bars, from = 0, to = snapshot.length - 1, globalBars = snapshot) {
  const indices = new Map(globalBars.map((bar, index) => [bar.time, index]));
  const listeners = new Set(), created = [], removed = [], attached = [], detached = [];
  let coordinateCalls = 0;
  const coordinate = (time) => 20 + (indices.get(time) - from) * 10;
  const price = (value) => 700 - value * 5;
  const scale = { getVisibleLogicalRange: () => ({ from, to }), getVisibleRange: () => ({ from: globalBars[Math.max(0, Math.floor(from))]?.time, to: globalBars[Math.min(globalBars.length - 1, Math.ceil(to))]?.time }), timeToCoordinate(time) { coordinateCalls++; return coordinate(time); }, logicalToCoordinate(index) { return 20 + (index - from) * 10; }, coordinateToLogical(x) { return from + (x - 20) / 10; }, subscribeVisibleLogicalRangeChange(callback) { listeners.add(callback); }, unsubscribeVisibleLogicalRangeChange(callback) { listeners.delete(callback); }, subscribeVisibleTimeRangeChange(callback) { listeners.add(callback); }, unsubscribeVisibleTimeRangeChange(callback) { listeners.delete(callback); } };
  const chart = {
    timeScale: () => scale,
    subscribeSizeChange(callback) { listeners.add(callback); }, unsubscribeSizeChange(callback) { listeners.delete(callback); },
    removeSeries(series) { removed.push(series); },
    addLineSeries(options) {
      const series = { options: () => options, data: [], setData(data) { this.data = data; }, priceToCoordinate: price,
        attachPrimitive(primitive) { attached.push(primitive); primitive.attached({ chart, series: this, requestUpdate() {} }); },
        detachPrimitive(primitive) { detached.push(primitive); primitive.detached(); },
        subscribeDataChanged(callback) { listeners.add(callback); }, unsubscribeDataChanged(callback) { listeners.delete(callback); },
      }; created.push(series); return series;
    },
  };
  return { chart, created, removed, attached, detached, listeners, coordinate, price, coordinateCalls: () => coordinateCalls, range(nextFrom, nextTo) { from = nextFrom; to = nextTo; for (const listener of listeners) listener(); } };
}
function draw(installation) {
  const target = recordingTarget();
  const primitive = installation.primitive;
  assert.ok(primitive, "Grouped scalar output must use the actual primitive");
  primitive.updateAllViews();
  for (const view of primitive.paneViews()) { const renderer = view.renderer(); renderer?.drawBackground?.(target); renderer?.draw(target); }
  return target;
}
const near = (left, right, tolerance = 1e-8) => Math.abs(left - right) <= tolerance;
function polygonContains(commands, x, y) {
  const points = commands.filter((command) => command.xy && command.kind !== "arc").map((command) => command.xy);
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

for (const name of Object.keys(hashes)) test(`raw ${name} oracle reaches actual fill, circle/triangle and white label geometry`, async () => {
  const source = sourceFor(name);
  assert.equal(createHash("sha256").update(source).digest("hex"), hashes[name]);
  const oracle = await raw(source), result = await native(source), adapted = pine.adaptPineChartResult(result, bars);
  const chart = harness(), installed = pine.installPineChartPlots(chart.chart, adapted.plots);
  assert.equal(installed.series.length, 1);
  const rendered = draw(installed);
  const labels = Object.entries(oracle.plots).filter(([, plot]) => String(plot.options?.shape).includes("label"));
  for (const [id, plot] of labels) {
    const active = plot.data.filter((point) => typeof point.value === "number" && Number.isFinite(point.value));
    const wantedText = plot.options.text;
    assert.equal(rendered.text.filter((item) => item.value === wantedText).length, active.length, `${name} ${id} glyph count`);
    for (const point of active) {
      const x = chart.coordinate(point.time / 1000), y = chart.price(point.value);
      assert.ok(rendered.paths.some((path) => path.mode === "fill" && path.commands.some((command) => command.xy && near(command.xy[0], x) && near(command.xy[1], y))), `${name} ${id} tip must be at its absolute price`);
      assert.ok(rendered.text.some((item) => item.value === wantedText && near(item.xy[0], x) && Math.abs(item.xy[1] - y) < 40 && /^#fff(?:fff)?$/i.test(String(item.color))), `${name} ${id} retains separate white text`);
    }
  }
  for (const plot of Object.values(oracle.plots).filter((plot) => String(plot.options?.shape).includes("triangle"))) for (const point of plot.data.filter((point) => Number.isFinite(point.value))) {
    const x = chart.coordinate(point.time / 1000), y = chart.price(point.value);
    const direction = String(plot.options.shape).includes("down") ? -1 : 1;
    assert.ok(rendered.paths.some((path) => path.mode === "fill" && hasVertex([path], x, y) && hasVertex([path], x - 3, y + direction * 6)), "Native tiny triangle tip and base match raw absolute signal");
  }
  const circles = Object.values(oracle.plots).filter((plot) => plot.options?.shape === "shape_circle" || plot.options?.style === "style_circles");
  for (const plot of circles) for (const point of plot.data.filter((point) => typeof point.value === "number" && Number.isFinite(point.value))) {
    const x = chart.coordinate(point.time / 1000), y = chart.price(point.value);
    assert.ok(rendered.paths.some((path) => path.commands.some((command) => command.kind === "arc" && near(command.xy[0], x) && near(command.xy[1], y))), `${name} circle at raw price`);
  }
  for (const fill of Object.values(oracle.plots).filter((plot) => plot.options?.style === "fill")) {
    const upper = oracle.plots[fill.options.plot1], lower = oracle.plots[fill.options.plot2];
    const index = fill.data.findIndex((point, index) => index > 0 && index < bars.length && typeof point.options?.color === "string" && Number.isFinite(upper.data[index].value) && Number.isFinite(lower.data[index].value) && Number.isFinite(upper.data[index - 1].value) && Number.isFinite(lower.data[index - 1].value));
    assert.ok(index >= 0);
    const x = (chart.coordinate(bars[index - 1].time) + chart.coordinate(bars[index].time)) / 2;
    const y = chart.price((upper.data[index - 1].value + upper.data[index].value + lower.data[index - 1].value + lower.data[index].value) / 4);
    assert.ok(rendered.paths.some((path) => path.mode === "fill" && path.style === fill.data[index].options.color && polygonContains(path.commands, x, y)), `${name} ribbon fills between both raw reference boundaries`);
  }
  installed.dispose(); installed.dispose();
  assert.equal(chart.detached.length, 1); assert.equal(chart.removed.length, 1);
});

const program = (body, overlay = true) => `//@version=6\nindicator("Visual",overlay=${overlay})\n${body}`;
async function visual(body, snapshot = bars, from = 0, to = snapshot.length - 1) {
  const result = await native(program(body), snapshot), adapted = pine.adaptPineChartResult(result, snapshot);
  const chart = harness(snapshot, from, to), installed = pine.installPineChartPlots(chart.chart, adapted.plots);
  return { result, adapted, chart, installed, rendered: draw(installed) };
}
const filled = (target, shade) => target.paths.filter((path) => path.mode === "fill" && path.style === shade);
const hasVertex = (paths, x, y) => paths.some((path) => path.commands.some((command) => command.xy && near(command.xy[0], x) && near(command.xy[1], y)));

test("absolute zero triangles/circles and label direction retain native size and independent text color", async () => {
  const { rendered, chart, installed } = await visual('plotshape(bar_index == 2 ? 0 : na,"Zero",style=shape.triangleup,location=location.absolute,color=color.red,size=size.tiny)\nplotshape(bar_index == 4 ? 0 : na,"Large",style=shape.triangledown,location=location.absolute,color=color.blue,size=size.huge)\nplotshape(bar_index == 6 ? 0 : na,"Circle",style=shape.circle,location=location.absolute,color=color.green,size=size.tiny)\nplotshape(bar_index == 8 ? 0 : na,"Up",style=shape.labelup,location=location.absolute,color=color.red,text="UP",textcolor=color.white,size=size.tiny)\nplotshape(bar_index == 10 ? 0 : na,"Down",style=shape.labeldown,location=location.absolute,color=color.blue,text="DOWN",textcolor=color.white,size=size.tiny)');
  const y = chart.price(0), tiny = filled(rendered, "#F23645"), huge = filled(rendered, "#2962FF");
  assert.ok(hasVertex(tiny, chart.coordinate(bars[2].time), y));
  assert.ok(hasVertex(tiny, chart.coordinate(bars[2].time) - 3, y + 6));
  assert.ok(hasVertex(huge, chart.coordinate(bars[4].time) - 9, y - 18));
  assert.ok(rendered.paths.some((path) => path.commands.some((command) => command.kind === "arc" && near(command.xy[0], chart.coordinate(bars[6].time)) && near(command.xy[1], y) && command.radius === 3)));
  for (const [text, below] of [["UP", true], ["DOWN", false]]) {
    const glyph = rendered.text.find((item) => item.value === text);
    assert.ok(glyph); assert.equal(glyph.color.toLowerCase(), "#ffffff"); assert.equal(glyph.font, "9px sans-serif");
    assert.ok(below ? glyph.xy[1] > y : glyph.xy[1] < y);
  }
  installed.dispose();
});

test("dynamic fill null color leaves gaps; hidden reference edges neither draw nor distort shown range", async () => {
  const { rendered, installed, chart, adapted } = await visual('a=plot(999,"Hidden upper",display=display.none)\nb=plot(-999,"Hidden lower",display=display.none)\nplot(5,"Shown",color=color.blue)\nfill(a,b,color=bar_index % 4 < 2 ? color.new(color.red,50) : na,fillgaps=true)');
  assert.deepEqual(adapted.plots.map((plot) => plot.name), ["Shown", adapted.plots[1].name]);
  assert.deepEqual(installed.primitive.rangeForVisible().priceRange, { minValue: 5, maxValue: 5 });
  assert.ok(rendered.paths.filter((path) => path.mode === "stroke").every((path) => path.commands.filter((command) => command.xy).every((command) => near(command.xy[1], chart.price(5)))));
  const shade = "#F2364580", polygons = filled(rendered, shade);
  assert.equal(polygons.length, bars.slice(1).filter((_, index) => (index + 1) % 4 < 2).length);
  for (let index = 1; index < bars.length; index++) {
    const x = (chart.coordinate(bars[index - 1].time) + chart.coordinate(bars[index].time)) / 2;
    assert.equal(polygons.some((path) => polygonContains(path.commands, x, chart.price(0))), index % 4 < 2, "Null point color must remain unpainted");
  }
  installed.dispose();
});

test("fillgaps uses global chart logical spacing across irregular seconds and never extrapolates", async () => {
  const snapshot = bars.slice(0, 7).map((bar, index) => ({ ...bar, time: bars[0].time + [0, 60, 300, 360, 600, 660, 1200][index] }));
  const body = 'a=plot(bar_index == 0 or bar_index == 2 or bar_index == 6 ? na : bar_index * 2,"Upper",display=display.none)\nb=plot(-2,"Lower",display=display.none)\nfill(a,b,color=color.red,fillgaps=FILLGAPS)';
  for (const allow of [true, false]) {
    const { rendered, installed, chart } = await visual(body.replace("FILLGAPS", String(allow)), snapshot);
    const polygons = filled(rendered, "#F23645");
    assert.equal(polygons.length, allow ? 4 : 2);
    assert.equal(hasVertex(polygons, chart.coordinate(snapshot[2].time), chart.price(4)), allow, "Missing reference interpolates halfway on equally spaced chart bars, despite irregular timestamps");
    assert.ok(polygons.every((path) => path.commands.filter((command) => command.xy).every((command) => command.xy[0] >= chart.coordinate(snapshot[1].time) && command.xy[0] <= chart.coordinate(snapshot[5].time))));
    assert.deepEqual(installed.primitive.rangeForVisible().priceRange, { minValue: -2, maxValue: 10 });
    installed.dispose();
  }
});

test("sibling fills keep independent show_last cutoff and share hidden references safely", async () => {
  const { rendered, installed } = await visual('a=plot(8,"Upper",display=display.none)\nb=plot(2,"Lower",display=display.none)\nfill(a,b,color=color.red,show_last=2)\nfill(a,b,color=color.blue,show_last=6)');
  assert.equal(filled(rendered, "#F23645").length, 1);
  assert.equal(filled(rendered, "#2962FF").length, 5, "Earlier sibling cutoff must not poison shared source samples");
  installed.dispose();
});

test("hidden source show_last limits its own fill edges without hiding sibling references", async () => {
  const { rendered, installed } = await visual('a=plot(8,"Upper",display=display.none,show_last=3)\nb=plot(2,"Lower",display=display.none)\nfill(a,b,color=color.red,show_last=6)');
  assert.equal(filled(rendered, "#F23645").length, 2);
  installed.dispose();
});

test("packed 10,000 disconnected paths stay grouped and decode only viewport samples during pan", async () => {
  const snapshot = Array.from({ length: 20_000 }, (_, index) => ({ ...bars[0], time: bars[0].time + index * 60 }));
  const result = await native(program('plot(bar_index % 2 == 0 ? 5 : na,"Gaps",style=plot.style_linebr)\nplot(bar_index % 2 == 0 ? 5 : na,"Dots",style=plot.style_circles)'), snapshot);
  const wire = pine.encodePinePackedPlots(result.plots, snapshot);
  const packed = { ...result, plots: pine.decodePinePackedPlots(wire.plots, wire.buffers, snapshot) };
  const adapted = pine.adaptPineChartResult(packed, snapshot);
  assert.ok(adapted.plots.every((plot) => plot.segments.length === 0 && plot.markers.length === 0 && pine.getPackedPinePlot(plot.visual.source)));
  assert.deepEqual(adapted.warnings, result.diagnostics.map((item) => `${item.code}: ${item.message}`));
  const chart = harness(snapshot, 10_000, 10_024), installed = pine.installPineChartPlots(chart.chart, adapted.plots);
  assert.equal(chart.created.length, 1);
  const first = draw(installed), stats = installed.primitive.debugStats;
  assert.equal(first.paths.filter((path) => path.mode === "stroke").length, 0, "Disconnected singleton linebr must never bridge null bars");
  assert.equal(first.paths.flatMap((path) => path.commands).filter((command) => command.kind === "arc").length, 13);
  assert.ok(stats.decodedSamples <= 60); assert.ok(stats.cacheEntries <= 60); assert.ok(chart.coordinateCalls() <= 60);
  assert.deepEqual(installed.primitive.rangeForVisible().priceRange, { minValue: 5, maxValue: 5 });
  chart.range(15_000, 15_024);
  const second = draw(installed), after = installed.primitive.debugStats;
  assert.equal(second.paths.flatMap((path) => path.commands).filter((command) => command.kind === "arc").length, 13);
  assert.ok(after.decodedSamples - stats.decodedSamples <= 60); assert.ok(after.cacheEntries <= 60);
  installed.dispose(); installed.dispose();
  assert.equal(chart.listeners.size, 0); assert.equal(chart.removed.length, 1); assert.equal(chart.detached.length, 1);
  assert.equal(installed.primitive.debugStats.cacheEntries, 0); assert.equal(draw(installed).paths.length, 0);
});

test("snapshot timestamps map to globally offset chart positions and visible edge range ignores hidden history", async () => {
  const snapshot = bars.slice(100, 110), result = await native(program('plot(bar_index,"Line")\nplot(99999,"Hidden",display=display.none)'), snapshot);
  const chart = harness(snapshot, 103, 105, bars), adapted = pine.adaptPineChartResult(result, snapshot), installed = pine.installPineChartPlots(chart.chart, adapted.plots);
  const rendered = draw(installed);
  assert.deepEqual(installed.primitive.rangeForVisible().priceRange, { minValue: 3, maxValue: 5 });
  assert.ok(hasVertex(rendered.paths, chart.coordinate(snapshot[3].time), chart.price(3)));
  assert.ok(hasVertex(rendered.paths, chart.coordinate(snapshot[5].time), chart.price(5)));
  chart.range(0, 50); assert.equal(installed.primitive.rangeForVisible(), null); assert.equal(draw(installed).paths.length, 0);
  chart.range(200, 220); assert.equal(installed.primitive.rangeForVisible(), null); assert.equal(draw(installed).paths.length, 0);
  installed.dispose();
});

test("areabr keeps many discontinuities in one primitive and step lines draw right-angle joins", async () => {
  const { rendered, installed, chart } = await visual('plot(bar_index % 3 == 2 ? na : 5,"Area",style=plot.style_areabr,color=color.red)\nplot(bar_index,"Step",style=plot.style_stepline,color=color.blue)');
  assert.equal(installed.series.length, 1);
  const joins = rendered.paths.filter((path) => path.mode === "stroke" && path.style === "#2962FF");
  assert.ok(joins.length);
  assert.deepEqual(joins[0].commands.map((command) => command.xy), [[chart.coordinate(bars[0].time), chart.price(0)], [chart.coordinate(bars[1].time), chart.price(0)], [chart.coordinate(bars[1].time), chart.price(1)]]);
  const areas = rendered.paths.filter((path) => path.mode === "fill");
  assert.equal(areas.length, 85, "Each finite adjacent pair produces one area polygon without crossing na");
  installed.dispose();
});

test("sparse show_last counts bar slots and supported empty visuals retain identity without inventing range", () => {
  const make = (id, value, options = {}) => ({ id, name: id, style: "line", overlay: true, options, points: [{ time: bars[1].time, value, options: {} }, { time: bars[4].time, value, options: {} }, { time: bars[9].time, value, options: {} }] });
  const sparse = make("Sparse", 5, { show_last: 3 });
  const result = { kind: "run", plots: [sparse], diagnostics: [], overlay: true };
  const adapted = pine.adaptPineChartResult(result, bars.slice(0, 10));
  assert.equal(adapted.plots.length, 1);
  assert.equal(adapted.plots[0].visual.showFrom, 7);
  const chart = harness(bars.slice(0, 10)), installed = pine.installPineChartPlots(chart.chart, adapted.plots);
  assert.deepEqual(installed.primitive.rangeForVisible().priceRange, { minValue: 5, maxValue: 5 });
  const drawn = draw(installed);
  assert.equal(drawn.paths.length, 0, "An isolated last-slot line value must not connect to old hidden points");
  installed.dispose();
  for (const value of [null, false]) {
    const source = { ...make("Empty", value), style: value === false ? "shape" : "line", options: value === false ? { shape: "shape_triangle_up", location: "location_absolute" } : {} };
    const empty = pine.adaptPineChartResult({ ...result, plots: [source] }, bars.slice(0, 10));
    assert.equal(empty.plots.length, 1);
    const host = harness(bars.slice(0, 10)), instance = pine.installPineChartPlots(host.chart, empty.plots);
    assert.equal(instance.primitive.rangeForVisible(), null); assert.equal(draw(instance).paths.length, 0);
    instance.dispose();
  }
});

test("fill follows reference placement and unsafe offset references are visibly omitted", async () => {
  const result = await native(program('a=plot(8,"Upper",force_overlay=true)\nb=plot(2,"Lower",force_overlay=true)\nfill(a,b,color=color.red)', false));
  const adapted = pine.adaptPineChartResult(result, bars);
  assert.ok(adapted.plots.every((plot) => plot.overlay));
  result.plots[0].options.offset = 1;
  const shifted = pine.adaptPineChartResult(result, bars);
  assert.ok(!shifted.plots.some((plot) => plot.kind === "fill"));
  assert.ok(shifted.warnings.some((warning) => /offset/i.test(warning)));
});

test("fill-only autoscale respects visible native peers and explicit external primary price scale", async () => {
  const body = 'a=plot(1000000000,"Hidden upper",display=display.none)\nb=plot(-1000000000,"Hidden lower",display=display.none)\nfill(a,b,color=color.red)';
  for (const [peer, expected] of [['plot(100,"Histogram",style=plot.style_histogram)', null], ['plot(na,"Empty histogram",style=plot.style_histogram)', { minValue: -1000000000, maxValue: 1000000000 }]]) {
    const result = await native(program(body + "\n" + peer)), adapted = pine.adaptPineChartResult(result, bars), chart = harness();
    chart.chart.addHistogramSeries = chart.chart.addLineSeries;
    const installed = pine.installPineChartPlots(chart.chart, adapted.plots);
    assert.deepEqual(installed.primitive.rangeForVisible()?.priceRange ?? null, expected);
    installed.dispose();
  }
  const result = await native(program(body)), adapted = pine.adaptPineChartResult(result, bars), chart = harness();
  const overlay = pine.installPineChartPlots(chart.chart, adapted.plots, "right", { allowFillOnlyScale: false });
  assert.equal(overlay.primitive.rangeForVisible(), null, "An existing external primary chart scale must not include hidden reference extremes");
  overlay.dispose();
  const pane = pine.installPineChartPlots(chart.chart, adapted.plots);
  assert.deepEqual(pane.primitive.rangeForVisible().priceRange, { minValue: -1000000000, maxValue: 1000000000 });
  pane.dispose();
});

test("multiline shape labels preserve blank-line spacing and visible glyphs after the 32nd line", async () => {
  const lines = Array.from({ length: 40 }, (_, index) => index === 20 ? "" : "line" + (index + 1));
  const { rendered, installed } = await visual('plotshape(bar_index == 10 ? 120 : na,"Multiline",style=shape.labelup,location=location.absolute,text="' + lines.join("\\n") + '",textcolor=color.white,size=size.tiny)');
  assert.equal(rendered.text.filter((item) => item.value).length, 39);
  assert.ok(rendered.text.some((item) => item.value === "line40"));
  const before = rendered.text.find((item) => item.value === "line20"), after = rendered.text.find((item) => item.value === "line22");
  assert.ok(after.xy[1] - before.xy[1] > 20, "Blank line must still occupy its own line height");
  assert.ok(rendered.text.every((item) => item.color.toLowerCase() === "#ffffff"));
  installed.dispose();
});

test("extreme hidden fill geometry is clipped before Canvas rasterization without expanding primary range", async () => {
  const result = await native(program('a=plot(1000000000,"Hidden upper",display=display.none)\nb=plot(-1000000000,"Hidden lower",display=display.none)\nfill(a,b,color=color.red)'));
  const adapted = pine.adaptPineChartResult(result, bars), chart = harness(bars, 100, 120);
  const installed = pine.installPineChartPlots(chart.chart, adapted.plots, "right", { allowFillOnlyScale: false });
  const rendered = draw(installed), polygons = filled(rendered, "#F23645");
  assert.equal(installed.primitive.rangeForVisible(), null);
  assert.ok(polygons.length);
  assert.ok(polygons.every((path) => path.commands.filter((command) => command.xy).every((command) => command.xy.every(Number.isFinite) && command.xy[0] >= 0 && command.xy[0] <= 2800 && command.xy[1] >= 0 && command.xy[1] <= 1000)));
  assert.ok(polygons.some((path) => polygonContains(path.commands, 125, chart.price(85))), "Clipped extreme rectangle must still cover a visible primary-price pixel");
  installed.dispose();
});

test("crossing fill references preserve two simple lobes and the zero-width intersection", async () => {
  const { rendered, installed, chart } = await visual('a=plot(bar_index % 2 == 0 ? 8 : 2,"Upper",display=display.none)\nb=plot(bar_index % 2 == 0 ? 2 : 8,"Lower",display=display.none)\nfill(a,b,color=color.red)');
  const polygons = filled(rendered, "#F23645");
  assert.equal(polygons.length, 2 * (bars.length - 1));
  assert.ok(polygons.every((path) => path.commands.filter((command) => command.xy).every((command) => command.xy.every(Number.isFinite) && command.xy[0] >= 0 && command.xy[0] <= 2800 && command.xy[1] >= 0 && command.xy[1] <= 1000)));
  assert.ok(polygons.some((path) => polygonContains(path.commands, 22.5, chart.price(5))));
  assert.ok(!polygons.some((path) => polygonContains(path.commands, 25, chart.price(6))), "Crossing point must not become a filled rectangle through the opposite lobe");
  installed.dispose();
});

test("more than sixteen disconnected finite line paths all reach the renderer without bridging na", async () => {
  const { rendered, installed, chart } = await visual('plot(bar_index % 3 == 2 ? na : 5,"Disconnected",style=plot.style_linebr,color=color.red)');
  const paths = rendered.paths.filter((path) => path.mode === "stroke");
  assert.equal(installed.series.length, 1);
  assert.equal(paths.length, 85);
  for (let index = 0; index < paths.length; index++) {
    assert.deepEqual(paths[index].commands.map((command) => command.xy), [[chart.coordinate(bars[index * 3].time), chart.price(5)], [chart.coordinate(bars[index * 3 + 1].time), chart.price(5)]]);
  }
  installed.dispose();
});
