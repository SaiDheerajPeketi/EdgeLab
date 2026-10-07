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
async function native(source, snapshot = bars, inputs = {}) {
  try { return await pine.executePineRequest({ id: "visual-oracle", action: "run", source, bars: snapshot, inputs, context: { symbol: "TEST", timeframe: "1", mintick: 0.01, pointvalue: 1 } }); }
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
function recordingTarget(width = 2800, height = 1000) {
  const paths = [], text = [], states = [], gradients = [];
  let path = [], matrix = [1, 0, 0, 1, 0, 0];
  const xy = (x, y) => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
  const context = {
    fillStyle: "black", strokeStyle: "black", lineWidth: 1, font: "12px sans-serif", globalAlpha: 1, dash: [], lineCap: "butt", lineDashOffset: 0,
    save() { states.push({ matrix: [...matrix], fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, font: this.font, globalAlpha: this.globalAlpha, dash: [...this.dash], lineCap: this.lineCap, lineDashOffset: this.lineDashOffset }); },
    restore() { const state = states.pop(); if (state) { matrix = state.matrix; Object.assign(this, state); } },
    scale(x, y) { matrix[0] *= x; matrix[1] *= x; matrix[2] *= y; matrix[3] *= y; },
    translate(x, y) { matrix[4] += matrix[0] * x + matrix[2] * y; matrix[5] += matrix[1] * x + matrix[3] * y; },
    setTransform(a, b, c, d, e, f) { matrix = [a, b, c, d, e, f]; }, resetTransform() { matrix = [1, 0, 0, 1, 0, 0]; },
    beginPath() { path = []; }, moveTo(x, y) { path.push({ kind: "move", xy: xy(x, y) }); }, lineTo(x, y) { path.push({ kind: "line", xy: xy(x, y) }); },
    arc(x, y, radius) { path.push({ kind: "arc", xy: xy(x, y), radius: radius * matrix[0] }); },
    rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); },
    roundRect(x, y, w, h) { this.rect(x, y, w, h); }, closePath() { path.push({ kind: "close" }); },
    stroke() { paths.push({ mode: "stroke", style: this.strokeStyle, width: this.lineWidth, commands: [...path], alpha: this.globalAlpha, dash: [...this.dash], lineCap: this.lineCap, lineDashOffset: this.lineDashOffset }); },
    fill() { paths.push({ mode: "fill", style: this.fillStyle, commands: [...path], alpha: this.globalAlpha }); },
    fillRect(x, y, w, h) { const old = path; this.beginPath(); this.rect(x, y, w, h); this.fill(); path = old; },
    strokeRect(x, y, w, h) { const old = path; this.beginPath(); this.rect(x, y, w, h); this.stroke(); path = old; },
    fillText(value, x, y) { text.push({ value, xy: xy(x, y), color: this.fillStyle, font: this.font }); },
    measureText(value) { return { width: String(value).length * 7, actualBoundingBoxAscent: 9, actualBoundingBoxDescent: 3 }; },
    createLinearGradient(x0, y0, x1, y1) { const gradient = { from: xy(x0, y0), to: xy(x1, y1), stops: [], addColorStop(offset, color) { this.stops.push({ offset, color }); } }; gradients.push(gradient); return gradient; }, clip() {}, setLineDash(values) { this.dash = [...values]; }, getLineDash() { return [...this.dash]; }, clearRect() {},
  };
  const scope = { context, mediaSize: { width, height }, bitmapSize: { width, height }, horizontalPixelRatio: 1, verticalPixelRatio: 1 };
  return { paths, text, gradients, context, useMediaCoordinateSpace(callback) { callback(scope); }, useBitmapCoordinateSpace(callback) { callback(scope); } };
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
function draw(installation, width = 2800, height = 1000) {
  const target = recordingTarget(width, height);
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
  const { rendered, installed } = await visual('plotshape(bar_index == 10 ? 120 : na,"Multiline",style=shape.labelup,location=location.absolute,text="' + lines.join("\n") + '",textcolor=color.white,size=size.tiny)');
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

// Gradient expectations use the official mask/anchor semantics and WHATWG
// CanvasGradient RGBA interpolation, independent of the renderer's helpers.
const gradientBody = (call, upper = "110", lower = "90") =>
  'a=plot(' + upper + ',"Mask A",display=display.none)\nb=plot(' + lower + ',"Mask B",display=display.none)\n' + call;
function rgba(value) {
  if (value === null || value === "transparent") return [0, 0, 0, 0];
  if (/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value)) return [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16)).concat(value.length === 9 ? parseInt(value.slice(7, 9), 16) / 255 : 1);
  const match = String(value).match(/^rgba?\(([^)]+)\)$/);
  assert.ok(match, "Oracle expects a valid recorded RGBA color: " + value);
  const parts = match[1].split(",").map(Number);
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}
const linear = (left, right, fraction) => left.map((value, index) => value + (right[index] - value) * fraction);
function styleAt(style, x, y) {
  if (typeof style === "string") return rgba(style);
  assert.ok(style?.from && style?.to && style.stops.length >= 2, "Actual gradient stops must reach Canvas, never a fallback solid fill");
  const dx = style.to[0] - style.from[0], dy = style.to[1] - style.from[1];
  const fraction = Math.max(0, Math.min(1, ((x - style.from[0]) * dx + (y - style.from[1]) * dy) / (dx * dx + dy * dy)));
  const stops = [...style.stops].sort((left, right) => left.offset - right.offset);
  if (fraction <= stops[0].offset) return rgba(stops[0].color);
  if (fraction >= stops.at(-1).offset) return rgba(stops.at(-1).color);
  const index = stops.findIndex((stop) => stop.offset > fraction);
  return linear(rgba(stops[index - 1].color), rgba(stops[index].color), (fraction - stops[index - 1].offset) / (stops[index].offset - stops[index - 1].offset));
}
function expectGradientAt(rendered, x, y, expected) {
  const path = rendered.paths.find((path) => path.mode === "fill" && polygonContains(path.commands, x, y));
  assert.ok(path, "Gradient mask must cover this independent sample");
  const actual = styleAt(path.style, x, y);
  actual.forEach((component, index) => assert.ok(near(component, expected[index], 1e-6), "Gradient component " + index + ": " + actual + " versus " + expected));
  assert.ok(typeof path.style !== "string", "A solid fallback cannot satisfy a gradient");
}

test("pinned raw PineTS positional and named gradient overloads preserve all per-bar values and colors", async () => {
  const fields = 't=bar_index==4?na:150+bar_index\nd=bar_index-50\nc=bar_index%2==0?color.new(color.red,50):na\n';
  const results = [];
  for (const call of ["fill(a,b,t,d,c,color.blue)", "fill(a,b,top_value=t,bottom_value=d,top_color=c,bottom_color=color.blue)"]) {
    const source = program(gradientBody(fields + call)), oracle = await raw(source), result = await native(source);
    assert.equal(result.audit.engineVersion, "0.11.0");
    const rawFill = Object.values(oracle.plots).find((plot) => plot.options.gradient), fill = result.plots.find((plot) => plot.options.gradient);
    assert.ok(rawFill); assert.ok(fill); assert.equal(fill.points.length, bars.length);
    for (let index = 0; index < bars.length; index++) {
      const expected = { top_value: index === 4 ? null : 150 + index, bottom_value: index - 50, top_color: index % 2 === 0 ? "#F2364580" : null, bottom_color: "#2962FF" };
      assert.deepEqual(rawFill.data[index].options, Object.fromEntries(Object.entries(expected).map(([key, value]) => [key, value === null ? NaN : value])));
      assert.deepEqual(fill.points[index].options, expected);
      assert.equal(fill.points[index].time, rawFill.data[index].time / 1000);
      assert.equal(fill.points[index].value, null);
    }
    assert.equal(result.plots.find((plot) => plot.id === fill.options.plot1).points[0].value, 110);
    assert.equal(result.plots.find((plot) => plot.id === fill.options.plot2).points[0].value, 90);
    results.push(fill.points);
  }
  assert.deepEqual(results[0], results[1]);
});

test("gradient anchors remain independent of narrower and wider plot masks", async () => {
  for (const [upper, lower] of [[110, 90], [150, 50]]) {
    const { rendered, installed, chart, adapted } = await visual(gradientBody('fill(a,b,120,80,#ff0000,#0000ff)', String(upper), String(lower)));
    assert.equal(adapted.plots.length, 1);
    assert.equal(installed.series.length, 1);
    for (const price of [95, 100, 105]) expectGradientAt(rendered, 35, chart.price(price), linear([255, 0, 0, 1], [0, 0, 255, 1], (120 - price) / 40));
    if (upper > 120) {
      expectGradientAt(rendered, 35, chart.price(130), [255, 0, 0, 1]);
      expectGradientAt(rendered, 35, chart.price(70), [0, 0, 255, 1]);
    }
    assert.ok(!rendered.paths.some((path) => path.mode === "stroke"), "Hidden mask references never draw edges");
    assert.deepEqual(installed.primitive.rangeForVisible().priceRange, { minValue: lower, maxValue: upper });
    installed.dispose();
  }
});

test("series gradient values/colors change by bar; na endpoint color fades while na anchor leaves no painted polygon", async () => {
  const body = gradientBody('fill(a,b,bar_index%4==0?na:120+bar_index%2*20,80-bar_index%2*20,bar_index%3==0?na:#ff0000,#0000ff)');
  const { rendered, installed, chart } = await visual(body);
  for (let index = 1; index < 16; index++) {
    const x = (chart.coordinate(bars[index - 1].time) + chart.coordinate(bars[index].time)) / 2, y = chart.price(100);
    if (index % 4 === 0) assert.ok(!rendered.paths.some((path) => path.mode === "fill" && polygonContains(path.commands, x, y)), "na gradient anchor cannot silently become a solid fill");
    else expectGradientAt(rendered, x, y, linear(index % 3 === 0 ? [0, 0, 0, 0] : [255, 0, 0, 1], [0, 0, 255, 1], .5));
  }
  installed.dispose();
});

test("explicit transparent red differs from na black and RGBA alpha is preserved at clipped anchors", async () => {
  for (const [topColor, expectedTop] of [["#ff000000", [255, 0, 0, 0]], ["na", [0, 0, 0, 0]], ["#ff000080", [255, 0, 0, 128 / 255]]]) {
    const { rendered, installed, chart } = await visual(gradientBody('fill(a,b,200,-100,' + topColor + ',#0000ff)'));
    expectGradientAt(rendered, 35, chart.price(100), linear(expectedTop, [0, 0, 255, 1], 1 / 3));
    installed.dispose();
  }
});

test("extreme gradient anchors are safely clipped without renormalizing the mask or visible ramp", async () => {
  const { rendered, installed, chart } = await visual(gradientBody('fill(a,b,1000000000,-1000000000,#ff000080,#0000ff)'));
  assert.ok(rendered.gradients.length);
  assert.ok(rendered.gradients.every((gradient) => [...gradient.from, ...gradient.to].every(Number.isFinite) && gradient.from[1] >= 0 && gradient.from[1] <= 1000 && gradient.to[1] >= 0 && gradient.to[1] <= 1000));
  for (const price of [95, 100, 105]) expectGradientAt(rendered, 35, chart.price(price), linear([255, 0, 0, 128 / 255], [0, 0, 255, 1], (1e9 - price) / 2e9));
  assert.deepEqual(installed.primitive.rangeForVisible().priceRange, { minValue: 90, maxValue: 110 }, "Only the mask, never gradient anchors, establishes fill-only range");
  installed.dispose();
});

test("crossing gradient masks retain both lobes and reversed anchors retain their endpoint identities", async () => {
  const body = gradientBody('fill(a,b,80,120,#ff0000,#0000ff)', "bar_index%2==0?110:90", "bar_index%2==0?90:110");
  const { rendered, installed, chart } = await visual(body);
  const x = chart.coordinate(bars[0].time) + 2.5;
  expectGradientAt(rendered, x, chart.price(102), linear([255, 0, 0, 1], [0, 0, 255, 1], (102 - 80) / 40));
  assert.ok(!rendered.paths.some((path) => path.mode === "fill" && polygonContains(path.commands, 25, chart.price(105))));
  installed.dispose();
});

test("native gradient optional title display editable and fillgaps survive without global engine mutation", async () => {
  const snapshot = bars.slice(0, 7);
  for (const form of ["positional", "named"]) {
    const tail = form === "positional" ? '120,80,#ff0000,#0000ff,"Hidden gradient",display.none,false,false' : 'top_value=120,bottom_value=80,top_color=#ff0000,bottom_color=#0000ff,title="Hidden gradient",display=display.none,fillgaps=false,editable=false';
    const result = await native(program(gradientBody("fill(a,b," + tail + ")")), snapshot);
    const fill = result.plots.find((plot) => plot.options.gradient);
    assert.equal(fill.name, "Hidden gradient");
    assert.equal(fill.options.display, "none");
    assert.equal(fill.options.fillgaps, false); assert.equal(fill.options.editable, false);
    assert.equal(pine.adaptPineChartResult(result, snapshot).plots.length, 0);
    const untouched = await raw(program(gradientBody("fill(a,b," + tail + ")")), snapshot);
    const untouchedFill = Object.values(untouched.plots).find((plot) => plot.options.gradient);
    for (const key of ["display", "fillgaps", "editable"]) assert.equal(untouchedFill.options[key], undefined, "Native selected-context wrapper must not mutate fresh direct PineTS");
  }
  for (const gaps of [true, false]) {
    const { rendered, installed } = await visual(gradientBody('fill(a,b,120,80,#ff0000,#0000ff,fillgaps=' + gaps + ')', "bar_index==2?na:110", "90"), snapshot);
    assert.equal(rendered.paths.filter((path) => path.mode === "fill").length, gaps ? 6 : 4);
    installed.dispose();
  }
  await assert.rejects(() => native(program(gradientBody('fill(a,b,120,80,#ff0000,#0000ff,show_last=3)'))), /show_last/);
  const solid = await native(program(gradientBody('fill(a,b,color=color.red,title="Solid",fillgaps=false,show_last=3)')));
  assert.equal(solid.plots.find((plot) => plot.name === "Solid").options.show_last, 3, "Gradient guard must not reject the valid solid overload");
});

test("packed 20k gradient channels decode only visible samples through pan and dispose", async () => {
  const snapshot = Array.from({ length: 20_000 }, (_, index) => ({ ...bars[0], time: bars[0].time + index * 60 }));
  const result = await native(program(gradientBody('fill(a,b,120+bar_index%2*20,80-bar_index%2*20,bar_index%2==0?#ff0000:#00ff00,#0000ff)')), snapshot);
  const wire = pine.encodePinePackedPlots(result.plots, snapshot), packed = { ...result, plots: pine.decodePinePackedPlots(wire.plots, wire.buffers, snapshot) };
  const adapted = pine.adaptPineChartResult(packed, snapshot), chart = harness(snapshot, 10_000, 10_024), installed = pine.installPineChartPlots(chart.chart, adapted.plots);
  assert.equal(installed.series.length, 1); assert.ok(pine.getPackedPinePlot(adapted.plots[0].visual.source));
  const rendered = draw(installed), before = installed.primitive.debugStats;
  expectGradientAt(rendered, 25, chart.price(100), [0, 127.5, 127.5, 1]);
  assert.ok(before.cacheEntries < 100); assert.ok(before.decodedSamples < 100);
  chart.range(15_000, 15_024);
  const panned = draw(installed);
  expectGradientAt(panned, 25, chart.price(100), [0, 127.5, 127.5, 1]);
  assert.ok(installed.primitive.debugStats.decodedSamples - before.decodedSamples < 100);
  installed.dispose(); installed.dispose();
  assert.equal(chart.listeners.size, 0); assert.equal(installed.primitive.debugStats.cacheEntries, 0);
});

test("equal/missing gradient anchors and two transparent endpoints follow disclosed empty-render policy", async () => {
  for (const call of ["fill(a,b,100,100,#ff0000,#0000ff)", "fill(a,b,na,80,#ff0000,#0000ff)", "fill(a,b,120,80,#ff000000,#0000ff00)"]) {
    const { rendered, installed, adapted } = await visual(gradientBody(call));
    if (call.includes("100,100")) assert.ok(adapted.warnings.some((warning) => /equal|zero.?span|degenerate/i.test(warning)), "Equal-anchor gap must be visibly disclosed");
    assert.equal(rendered.paths.filter((path) => path.mode === "fill").length, 0);
    assert.equal(installed.primitive.rangeForVisible(), null);
    installed.dispose();
  }
});

test("official hidden hline gradient overload uses hline IDs as mask without drawing them", async () => {
  const body = 'a=hline(110,"Hline A",display=display.none)\nb=hline(90,"Hline B",display=display.none)\nfill(a,b,120,80,#ff0000,#0000ff)';
  const source = program(body), oracle = await raw(source), result = await native(source), adapted = pine.adaptPineChartResult(result, bars);
  const rawFill = Object.values(oracle.plots).find((plot) => plot.options.gradient), fill = result.plots.find((plot) => plot.options.gradient);
  assert.equal(fill.options.plot1, rawFill.options.plot1);
  assert.equal(fill.options.plot2, rawFill.options.plot2);
  assert.equal(adapted.plots.length, 1);
  const chart = harness(), installed = pine.installPineChartPlots(chart.chart, adapted.plots), rendered = draw(installed);
  expectGradientAt(rendered, 35, chart.price(100), [127.5, 0, 127.5, 1]);
  assert.ok(!rendered.paths.some((path) => path.mode === "stroke"));
  installed.dispose();
});

test("native input color overrides preserve exact gradient source values", async () => {
  const source = program('top=input.float(100,"Top")\nbottom=input.float(0,"Bottom")\ntc=input.color(#ff0000,"Top color")\nbc=input.color(#0000ff,"Bottom color")\na=plot(80,"Mask A",display=display.none)\nb=plot(20,"Mask B",display=display.none)\nfill(a,b,top,bottom,tc,bc,title="Gradient mask")');
  const result = await native(source, bars, { in_0: 120, in_1: 0, in_2: "#ff0000", in_3: "#0000ff" });
  const fill = result.plots.find((plot) => plot.options.gradient);
  assert.deepEqual(result.inputs, { in_0: 120, in_1: 0, in_2: "#ff0000", in_3: "#0000ff" });
  assert.deepEqual(fill.points[130].options, { top_value: 120, bottom_value: 0, top_color: "#ff0000", bottom_color: "#0000ff" });
  assert.equal(fill.name, "Gradient mask");
});

test("transparent gradient tangent contributes no paint/range while every positive sliver and crossing lobe remains", async () => {
  for (const crossing of [false, true]) {
    const upper = crossing ? "bar_index%2==0?130:120" : "130", lower = crossing ? "bar_index%2==0?120:130" : "120";
    const { rendered, installed } = await visual(gradientBody("fill(a,b,120,80,na,#0000ff)", upper, lower));
    assert.equal(rendered.paths.filter((path) => path.mode === "fill").length, 0, "A transparent boundary tangent has no positive-area painted mask");
    assert.equal(installed.primitive.rangeForVisible(), null);
    installed.dispose();
  }
  for (const crossing of [false, true]) {
    const low = 119.999999, upper = crossing ? "bar_index%2==0?130:119.999999" : "130", lower = crossing ? "bar_index%2==0?119.999999:130" : String(low);
    const { rendered, installed } = await visual(gradientBody("fill(a,b,120,80,na,#0000ff)", upper, lower));
    assert.deepEqual(installed.primitive.rangeForVisible().priceRange, { minValue: low, maxValue: 120 }, "Strictly positive alpha sliver cannot be rounded away by an area epsilon");
    assert.ok(rendered.paths.some((path) => path.mode === "fill"));
    installed.dispose();
  }
  const { rendered, installed, chart } = await visual(gradientBody("fill(a,b,120,80,na,#0000ff)", "bar_index%2==0?130:110", "bar_index%2==0?110:130"));
  expectGradientAt(rendered, 20.25, chart.price(115), linear([0, 0, 0, 0], [0, 0, 255, 1], .125));
  assert.deepEqual(installed.primitive.rangeForVisible().priceRange, { minValue: 110, maxValue: 120 }, "Visible lobes survive even though the entire self-crossing quad's signed area cancels");
  installed.dispose();
});

test("valid solid na positional six/eight argument overloads preserve solid options without global mutation", async () => {
  const variants = [
    { title: "Solid six", tail: 'na,"Solid six",true,3', named: 'color=na,title="Solid six",editable=true,show_last=3', flags: { editable: true, show_last: 3 } },
    { title: "Solid eight", tail: 'na,"Solid eight",false,3,false,display.none', named: 'color=na,title="Solid eight",editable=false,show_last=3,fillgaps=false,display=display.none', flags: { editable: false, show_last: 3, fillgaps: false, display: "none" } },
  ];
  for (const variant of variants) {
    const positionalSource = program(gradientBody("fill(a,b," + variant.tail + ")"));
    const namedSource = program(gradientBody("fill(a,b," + variant.named + ")"));
    const before = await raw(namedSource);
    const positional = await native(positionalSource), named = await native(namedSource);
    for (const result of [positional, named]) {
      const fill = result.plots.find((plot) => plot.name === variant.title);
      assert.ok(fill, "Solid title must not be lost to the gradient overload");
      assert.equal(fill.options.gradient, undefined, "na color is not a numeric gradient anchor");
      for (const [key, value] of Object.entries(variant.flags)) assert.equal(fill.options[key], value);
      assert.equal(fill.options.color, null);
      assert.equal(fill.points.length, bars.length);
      for (const point of fill.points) {
        assert.equal(point.value, null);
        assert.deepEqual(point.options, { color: null });
      }
      const adapted = pine.adaptPineChartResult(result, bars);
      if (variant.flags.display === "none") assert.equal(adapted.plots.length, 0);
      else {
        const chart = harness(), installed = pine.installPineChartPlots(chart.chart, adapted.plots);
        assert.equal(draw(installed).paths.filter((path) => path.mode === "fill").length, 0);
        assert.equal(installed.primitive.rangeForVisible(), null);
        installed.dispose();
      }
    }
    const after = await raw(namedSource);
    const rawFill = (context) => Object.values(context.plots).find((plot) => plot.title === variant.title);
    assert.deepEqual(rawFill(after), rawFill(before), "Selected-context normalization cannot change fresh raw PineTS");
    const untouched = await raw(positionalSource);
    assert.ok(Object.values(untouched.plots).some((plot) => plot.options.gradient === true), "Pinned direct PineTS overload bug must remain untouched outside the native execution");
  }

  for (const [title, tail, namedTail, flags] of [
    ["Hline six", 'na,"Hline six",false,false', 'color=na,title="Hline six",editable=false,fillgaps=false', { editable: false, fillgaps: false }],
    ["Hline seven", 'na,"Hline seven",false,false,display.none', 'color=na,title="Hline seven",editable=false,fillgaps=false,display=display.none', { editable: false, fillgaps: false, display: "none" }],
  ]) {
    const body = 'a=hline(110,"Mask A",display=display.none)\nb=hline(90,"Mask B",display=display.none)\n';
    const source = program(body + "fill(a,b," + tail + ")");
    const namedSource = program(body + "fill(a,b," + namedTail + ")");
    const before = await raw(namedSource);
    const result = await native(source), fill = result.plots.find((plot) => plot.name === title);
    assert.ok(fill); assert.equal(fill.options.gradient, undefined);
    assert.equal(fill.options.show_last, null, "Absent hline show_last uses the existing canonical null normalization");
    for (const [key, value] of Object.entries(flags)) assert.equal(fill.options[key], value);
    assert.equal(fill.options.color, null);
    assert.ok(fill.points.every((point) => point.options.color === null));
    const after = await raw(namedSource);
    assert.deepEqual(Object.values(after.plots), Object.values(before.plots), "Hline correction also remains execution-local");
  }
  const dynamic = await native(program(gradientBody('fill(a,b,bar_index%2==0?na:color.red,"Dynamic solid",true,3,false,display.all)')));
  const fill = dynamic.plots.find((plot) => plot.name === "Dynamic solid");
  assert.equal(fill.options.gradient, undefined);
  assert.equal(fill.options.show_last, 3);
  assert.equal(fill.options.fillgaps, false);
  assert.equal(fill.options.display, "all");
  assert.equal(fill.points[0].options.color, null);
  assert.equal(fill.points[1].options.color, "#F23645");
  const adapted = pine.adaptPineChartResult(dynamic, bars), chart = harness(), installed = pine.installPineChartPlots(chart.chart, adapted.plots);
  assert.equal(filled(draw(installed), "#F23645").length, 1, "Solid show_last exposes slots 253 red, 254 na, 255 red; only the interval with right endpoint 255 paints");
  installed.dispose();
});

test("fixed hline styles draw one full-pane path and autoscale before after and within history", async () => {
  const body = 'hline(90,"Solid",#ff0000,hline.style_solid,1)\nhline(100,"Dashed",#00ff00,hline.style_dashed,2)\nhline(110,"Dotted",#0000ff,hline.style_dotted,3)';
  const result = await native(program(body)), adapted = pine.adaptPineChartResult(result, bars), chart = harness(), installed = pine.installPineChartPlots(chart.chart, adapted.plots);
  assert.equal(adapted.plots.length, 3); assert.equal(installed.series.length, 1);
  for (const [from, to] of [[20, 50], [260, 290], [-30, -10], [250, 280]]) {
    chart.range(from, to);
    assert.deepEqual(installed.primitive.rangeForVisible().priceRange, { minValue: 90, maxValue: 110 });
    for (const width of [2800, 720]) {
      const strokes = draw(installed, width).paths.filter((path) => path.mode === "stroke");
      assert.equal(strokes.length, 3, "A level must use one pane-wide path rather than historical segments");
      for (const [index, shade] of ["#ff0000", "#00ff00", "#0000ff"].entries()) {
        const path = strokes.find((entry) => entry.style === shade);
        assert.ok(path);
        assert.deepEqual(path.commands, [{ kind: "move", xy: [0, chart.price(90 + index * 10)] }, { kind: "line", xy: [width, chart.price(90 + index * 10)] }]);
        assert.equal(path.width, index + 1);
      }
      const [solid, dashed, dotted] = ["#ff0000", "#00ff00", "#0000ff"].map((shade) => strokes.find((entry) => entry.style === shade).dash);
      assert.deepEqual(solid, []);
      assert.equal(dashed.length, 2); assert.equal(dotted.length, 2);
      assert.ok(dashed.every((value) => Number.isFinite(value) && value > 0));
      assert.ok(dotted.every(Number.isFinite) && dotted[0] >= 0 && dotted[1] > 0);
      if (dotted[0] === 0) assert.equal(strokes.find((entry) => entry.style === "#0000ff").lineCap, "round", "Zero-length dotted dashes need round caps to paint visible dots");
      assert.ok(dashed[0] / 2 > dotted[0] / 3, "Dashed on-segments are longer than dotted on-segments after width normalization");
    }
  }
  installed.dispose(); installed.dispose();
  assert.equal(chart.listeners.size, 0); assert.equal(chart.removed.length, 1);
  assert.equal(draw(installed).paths.length, 0);
});

test("bare zero level defaults to width one while na transparent and display-none levels do not paint or scale", async () => {
  const body = 'hline(0,"Bare")\nhline(5,"Visible",#00ff00,hline.style_solid,2)\nhline(1000000000,"Na color",color=na)\nhline(na,"Na price",color=#ff0000)\nhline(-1000000000,"Transparent",color=#ff000000)\nhline(2000000000,"Hidden",color=#ff0000,display=display.none)';
  const result = await native(program(body)), adapted = pine.adaptPineChartResult(result, bars), chart = harness(), installed = pine.installPineChartPlots(chart.chart, adapted.plots);
  assert.deepEqual(installed.primitive.rangeForVisible().priceRange, { minValue: 0, maxValue: 5 });
  const strokes = draw(installed).paths.filter((path) => path.mode === "stroke");
  assert.equal(strokes.length, 2);
  const bare = strokes.find((path) => path.commands.some((command) => command.xy?.[1] === chart.price(0)));
  assert.ok(bare); assert.equal(bare.width, 1);
  assert.ok(adapted.warnings.some((warning) => /default|omitted/i.test(warning)), "Omitted hline style/color uses a disclosed local default");
  installed.dispose();
});

test("raw accepted series-varying hline price or color and invalid styles are omitted with a reason", async () => {
  for (const body of [
    'hline(bar_index%2==0?5:6,"Changing price",color=#ff0000)',
    'hline(5,"Changing color",color=bar_index%2==0?#ff0000:#0000ff)',
    'hline(5,"Invalid style",color=#ff0000,linestyle="unsupported")',
  ]) {
    const result = await native(program(body)), adapted = pine.adaptPineChartResult(result, bars);
    assert.equal(adapted.plots.length, 0, "A local selected constant or solid fallback cannot substitute for unsupported native semantics");
    assert.ok(adapted.warnings.some((warning) => /hline|horizontal|level/i.test(warning) && /vary|chang|input|style|unsupported|not drawn/i.test(warning)));
  }
});

test("hidden hline references remain available to solid and gradient current-history fills without drawn edges", async () => {
  for (const call of ['fill(a,b,color=#ff0000)', 'fill(a,b,120,80,#ff0000,#0000ff)']) {
    const { result, adapted, rendered, installed, chart } = await visual('a=hline(110,"Upper",display=display.none)\nb=hline(90,"Lower",display=display.none)\n' + call);
    assert.equal(adapted.plots.length, 1);
    assert.ok(result.plots.filter((plot) => plot.style === "hline").every((plot) => plot.options.display === "none"));
    assert.ok(!rendered.paths.some((path) => path.mode === "stroke"));
    if (call.includes("120,80")) expectGradientAt(rendered, 35, chart.price(100), [127.5, 0, 127.5, 1]);
    else assert.ok(filled(rendered, "#ff0000").some((path) => polygonContains(path.commands, 35, chart.price(100))));
    assert.deepEqual(installed.primitive.rangeForVisible().priceRange, { minValue: 90, maxValue: 110 });
    installed.dispose();
  }
});

test("packed 20k fixed levels preserve raw backing and draw bounded geometry in future whitespace", async () => {
  const snapshot = Array.from({ length: 20_000 }, (_, index) => ({ ...bars[0], time: bars[0].time + index * 60 }));
  const result = await native(program('hline(5,"Packed",#ff0000,hline.style_dashed,2)'), snapshot);
  const adapted = pine.adaptPineChartResult(result, snapshot), chart = harness(snapshot, 15000, 15024), installed = pine.installPineChartPlots(chart.chart, adapted.plots);
  assert.ok(pine.getPackedPinePlot(result.plots[0]));
  assert.equal(adapted.plots[0].visual.source, result.plots[0]);
  assert.deepEqual(adapted.plots[0].segments, []);
  for (const range of [[15000, 15024], [20020, 20050], [-50, -20]]) {
    chart.range(...range);
    const strokes = draw(installed, 720).paths.filter((path) => path.mode === "stroke");
    assert.equal(strokes.length, 1);
    assert.deepEqual(strokes[0].commands.map((command) => command.xy), [[0, chart.price(5)], [720, chart.price(5)]]);
    assert.deepEqual(installed.primitive.rangeForVisible().priceRange, { minValue: 5, maxValue: 5 });
  }
  assert.ok(installed.primitive.debugStats.decodedSamples < 10, "Drawing a fixed level cannot inflate 20k historical point objects");
  installed.dispose();
  assert.equal(installed.primitive.debugStats.cacheEntries, 0);
  assert.equal(chart.listeners.size, 0);
});

test("hline dash state never leaks into ordinary plots and grouped disposal remains idempotent", async () => {
  const { rendered, installed, chart } = await visual('hline(5,"Dotted",#ff0000,hline.style_dotted,2)\nplot(bar_index%2==0?6:7,"Ordinary",color=#00ff00)');
  const dotted = rendered.paths.filter((path) => path.mode === "stroke" && path.style === "#ff0000");
  const ordinary = rendered.paths.filter((path) => path.mode === "stroke" && path.style === "#00ff00");
  assert.equal(dotted.length, 1); assert.ok(dotted[0].dash.length > 0);
  assert.ok(ordinary.length > 16);
  assert.ok(ordinary.every((path) => path.dash.length === 0));
  installed.dispose(); installed.dispose();
  assert.equal(chart.detached.length, 1); assert.equal(chart.removed.length, 1); assert.equal(chart.listeners.size, 0);
  assert.equal(draw(installed).paths.length, 0);
});

test("newer real timeline scale anchor keeps an owned seed while its price never enters level autoscale", async () => {
  const snapshot = bars.slice(0, 200), before = structuredClone(snapshot);
  const source = program('hline(5,"Fixed",#ff0000,hline.style_solid,2)'), result = await native(source, snapshot), resultBefore = structuredClone(result);
  const adapted = pine.adaptPineChartResult(result, snapshot), anchor = { time: bars[255].time, close: 1e9 };
  const chart = harness(snapshot, 240, 255, bars), installed = pine.installPineChartPlots(chart.chart, adapted.plots, "right", { scaleAnchor: anchor });
  const host = installed.series[0], endpoint = host.data.at(-1);
  assert.equal(host.data.length, snapshot.length + 1);
  assert.deepEqual(endpoint, { time: anchor.time, value: 1e9, color: "transparent" });
  assert.notEqual(endpoint, anchor);
  assert.deepEqual(host.options().autoscaleInfoProvider().priceRange, { minValue: 5, maxValue: 5 });
  assert.deepEqual(snapshot, before); assert.deepEqual(result, resultBefore);
  assert.equal(adapted.plots[0].visual.source, result.plots[0]);
  assert.equal(adapted.plots[0].visual.bars, snapshot);
  anchor.close = -1e9;
  assert.equal(endpoint.value, 1e9, "Host owns its scalar seed rather than aliasing a caller-owned anchor");
  installed.dispose();
  for (const invalid of [{ time: snapshot.at(-1).time, close: 1e9 }, { time: bars[255].time, close: NaN }, { time: Infinity, close: 1e9 }]) {
    const other = harness(snapshot, 240, 255, bars), owned = pine.installPineChartPlots(other.chart, adapted.plots, "right", { scaleAnchor: invalid });
    assert.equal(owned.series[0].data.length, snapshot.length);
    assert.deepEqual(owned.series[0].options().autoscaleInfoProvider().priceRange, { minValue: 5, maxValue: 5 });
    owned.dispose(); assert.equal(other.listeners.size, 0);
  }
});
