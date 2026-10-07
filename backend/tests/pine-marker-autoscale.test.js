import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const bundle = buildSync({ bundle: true, format: "esm", platform: "browser", write: false, logLevel: "silent", stdin: {
  contents: 'export * from "./frontend/src/lib/pineChartAdapter.ts"; export * from "./frontend/src/lib/pineVisualPrimitive.ts"; export * from "./frontend/src/lib/pinePacked.ts"; export * from "./frontend/src/workers/pineNative.worker.ts"; export { Indicator, PineTS } from "pinets";',
  loader: "ts", resolveDir: fileURLToPath(new URL("../..", import.meta.url)), sourcefile: "pine-marker-autoscale-oracles.ts",
} }).outputFiles[0].text;
// An independent Canvas measurement fixture. Its middle-baseline glyph
// bounds are deliberately asymmetric so centering guesses cannot pass.
globalThis.OffscreenCanvas = class { getContext() { return { font: "9px sans-serif", textBaseline: "middle", measureText: (text) => ({ width: String(text).length * 7, actualBoundingBoxAscent: 9, actualBoundingBoxDescent: 3 }) }; } };
const pine = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const fixtureBytes = readFileSync(new URL("../../e2e/pine-visuals.bars.json", import.meta.url));
assert.equal(createHash("sha256").update(fixtureBytes).digest("hex"), "fc9a28c87aed819daae602ea45422d0d40979bd42f86097607310b0300645ea1");
const bars = JSON.parse(fixtureBytes);
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

const program = (body) => '//@version=6\nindicator("Marker extents",overlay=false)\n' + body;
async function native(body, snapshot = bars) {
  return pine.executePineRequest({ id: "marker-extent", action: "run", source: program(body), bars: snapshot, inputs: {}, context: { symbol: "TEST", timeframe: "1", mintick: 0.01, pointvalue: 1 } });
}
async function fixture(body, snapshot = bars, from = 0, to = snapshot.length - 1, height = 128) {
  const result = await native(body, snapshot), adapted = pine.adaptPineChartResult(result, snapshot);
  const state = harness(snapshot, from, to); state.chart.paneSize = () => ({ width: 720, height });
  const installed = pine.installPineChartPlots(state.chart, adapted.plots);
  return { result, adapted, ...state, installed };
}
function margin(bounds) { return bounds?.margins ?? { above: 0, below: 0 }; }
const body = (shape, location, text = "", color = "#ff0000", textcolor = "#ffffff", active = "bar_index==2") =>
  'plotshape(' + (location === "absolute" ? active + '?0:na' : active) + ',"Marker",style=shape.' + shape + ',location=location.' + location + ',size=size.tiny,color=' + color + ',text=' + JSON.stringify(text) + ',textcolor=' + textcolor + ')';
const shapes = ["circle", "square", "triangleup", "triangledown", "arrowup", "arrowdown", "labelup", "labeldown"];
const locations = ["absolute", "abovebar", "belowbar"];
function renderedExtents(target, anchorY) {
  let minimum = Infinity, maximum = -Infinity;
  for (const path of target.paths) {
    if (/^#[0-9a-f]{6}00$/i.test(String(path.style)) || String(path.style) === "rgba(0,0,0,0)") continue;
    for (const command of path.commands) {
      if (!command.xy) continue;
      minimum = Math.min(minimum, command.xy[1] - (command.radius ?? 0));
      maximum = Math.max(maximum, command.xy[1] + (command.radius ?? 0));
    }
  }
  for (const glyph of target.text) {
    if (!glyph.value.trim() || /^#[0-9a-f]{6}00$/i.test(String(glyph.color)) || String(glyph.color) === "rgba(0,0,0,0)") continue;
    // The recorder supplies a 9px ascent / 3px descent. Account for the
    // selected middle baseline independently of the production layout helper.
    minimum = Math.min(minimum, glyph.xy[1] - 9);
    maximum = Math.max(maximum, glyph.xy[1] + 3);
  }
  return { above: Number.isFinite(minimum) ? Math.max(0, anchorY - minimum) : 0, below: Number.isFinite(maximum) ? Math.max(0, maximum - anchorY) : 0 };
}
test("tiny unlabelled circle reserves exactly its painted directional extent in a128px pane", async () => {
  for (const [location, expected] of [["absolute", { above: 3, below: 3 }], ["abovebar", { above: 13, below: 0 }], ["belowbar", { above: 0, below: 13 }]]) {
    for (const text of ["", undefined]) {
      const source = text === undefined ? body("circle", location).replace(',text=""', "") : body("circle", location, text);
      const f = await fixture(source);
      assert.deepEqual(margin(f.installed.primitive.rangeForVisible()), expected, location + " must not reserve a label box for absent text");
      const target = draw(f.installed, 720, 1000);
      const price = location === "abovebar" ? bars[2].high : location === "belowbar" ? bars[2].low : 0;
      assert.deepEqual(renderedExtents(target, f.price(price)), expected);
      assert.equal(target.text.filter((glyph) => glyph.value).length, 0);
      f.installed.dispose();
    }
  }
});
for (const shape of shapes) test(shape + " margins bound actual independent body geometry in every location", async () => {
  for (const location of locations) {
    const f = await fixture(body(shape, location), bars, 0, bars.length - 1, 1000);
    const target = draw(f.installed, 720, 1000), anchor = location === "abovebar" ? bars[2].high : location === "belowbar" ? bars[2].low : 0;
    const actual = renderedExtents(target, f.price(anchor)), reserved = margin(f.installed.primitive.rangeForVisible());
    assert.ok(reserved.above + 1e-8 >= actual.above && reserved.above <= actual.above + 1, shape + "/" + location + " upper spare cannot be an unrelated label allowance");
    assert.ok(reserved.below + 1e-8 >= actual.below && reserved.below <= actual.below + 1, shape + "/" + location + " lower spare cannot be an unrelated label allowance");
    f.installed.dispose();
  }
});
test("empty and blank multiline text reserve only painted glyph rows with directional geometry", async () => {
  for (const shape of ["circle", "labelup", "labeldown"]) for (const location of locations) for (const text of ["A", "A\n\nB", "\nA\n", "\n\n", ""]) {
    const f = await fixture(body(shape, location, text), bars, 0, bars.length - 1, 1000);
    const target = draw(f.installed, 720, 1000), anchor = location === "abovebar" ? bars[2].high : location === "belowbar" ? bars[2].low : 0;
    const extent = renderedExtents(target, f.price(anchor)), reserved = margin(f.installed.primitive.rangeForVisible());
    assert.ok(reserved.above + 1e-8 >= extent.above && reserved.above <= extent.above + 2, shape + "/" + location + "/" + JSON.stringify(text) + " upper");
    assert.ok(reserved.below + 1e-8 >= extent.below && reserved.below <= extent.below + 2, shape + "/" + location + "/" + JSON.stringify(text) + " lower");
    assert.deepEqual(target.text.filter((glyph) => glyph.value.trim()).map((glyph) => glyph.value), text.split("\n").filter((line) => line.trim()));
    f.installed.dispose();
  }
});
test("false null absent transparent and past show_last markers cannot change scale or margins", async () => {
  for (const source of [
    body("circle", "abovebar", "", "#ff0000", "#ffffff", "false"),
    body("circle", "absolute", "", "#ff0000", "#ffffff", "false"),
    body("circle", "absolute", "", "#ff000000", "#ffffff"),
    body("labelup", "absolute", "", "#ff000000", "#ffffff"),
    body("labeldown", "absolute", "Text", "#ff000000", "#ffffff00"),
    body("circle", "absolute").replace("textcolor=#ffffff)", "textcolor=#ffffff,show_last=2)"),
  ]) {
    const f = await fixture(source);
    assert.equal(f.installed.primitive.rangeForVisible(), null, source);
    const rendered = draw(f.installed, 720, 1000);
    assert.deepEqual(renderedExtents(rendered, f.price(0)), { above: 0, below: 0 });
    f.installed.dispose();
  }
});
test("transparent body with visible text retains its price and only visible glyph extent", async () => {
  for (const shape of ["circle", "labelup", "labeldown"]) {
    const f = await fixture(body(shape, "absolute", "Text", "#ff000000", "#ffffff"), bars, 0, bars.length - 1, 1000);
    const range = f.installed.primitive.rangeForVisible(); assert.deepEqual(range.priceRange, { minValue: 0, maxValue: 0 });
    const rendered = draw(f.installed, 720, 1000), extent = renderedExtents(rendered, f.price(0));
    assert.ok(rendered.text.some((glyph) => glyph.value === "Text"));
    const reserved = margin(range);
    assert.ok(reserved.above + 1e-8 >= extent.above && reserved.above <= extent.above + 2);
    assert.ok(reserved.below + 1e-8 >= extent.below && reserved.below <= extent.below + 2);
    f.installed.dispose();
  }
});
test("20k packed marker blocks honor only visible active glyphs across pan resize and idempotent disposal", async () => {
  const snapshot = Array.from({ length: 20000 }, (_, i) => ({ ...bars[0], time: bars[0].time + i * 60 }));
  const source = 'plotshape(bar_index%512==127?0:na,"Tiny",style=shape.circle,location=location.absolute,size=size.tiny,color=#ff0000)\nplotshape(bar_index%512==255?0:na,"Large text",style=shape.labelup,location=location.absolute,size=size.huge,color=#00000000,text="TALL\\nBLOCK",textcolor=#ffffff)';
  const f = await fixture(source, snapshot, 10100, 10120, 128);
  assert.ok(f.result.plots.every((plot) => pine.getPackedPinePlot(plot)));
  assert.ok(f.adapted.plots.every((plot) => plot.visual.source === f.result.plots.find((raw) => raw.id === plot.id) && plot.segments.length === 0));
  for (const [from, to, visible] of [[10100,10120,false], [10360,10375,true], [10480,10500,true], [11100,11120,false]]) {
    f.range(from, to);
    const before = f.installed.primitive.debugStats.decodedSamples;
    const range = f.installed.primitive.rangeForVisible();
    assert.equal(range !== null, visible);
    if (from === 10360) assert.deepEqual(margin(range), { above: 3, below: 3 });
    draw(f.installed, 720, 128); draw(f.installed, 390, 128);
    assert.ok(f.installed.primitive.debugStats.decodedSamples - before <= 300, "Viewport/block summaries cannot inflate20k point objects");
  }
  f.installed.dispose(); f.installed.dispose();
  assert.equal(f.listeners.size, 0); assert.equal(f.removed.length, 1); assert.equal(f.detached.length, 1);
  assert.equal(f.installed.primitive.debugStats.cacheEntries, 0);
  assert.equal(draw(f.installed).paths.length, 0);
});

test("same-window inverted price scale retains physical asymmetric screen margins", async () => {
  for (const shape of ["labelup", "labeldown"]) {
    const f = await fixture(body(shape, "absolute", "A\n\nB"), bars, 0, bars.length - 1, 1000);
    let inverted = false;
    f.installed.series[0].priceScale = () => ({ options: () => ({ invertScale: inverted }) });
    const normal = structuredClone(f.installed.primitive.rangeForVisible());
    assert.notEqual(normal.margins.above, normal.margins.below);
    inverted = true;
    const flipped = f.installed.primitive.rangeForVisible();
    assert.deepEqual(flipped.priceRange, normal.priceRange);
    // Pinned LWC swaps its internal margin getters and then reverses the coordinate transform.
    // These cancel: public above/below margins remain physical screen extents in either mode.
    assert.deepEqual(flipped.margins, normal.margins);
    inverted = false;
    assert.deepEqual(f.installed.primitive.rangeForVisible(), normal);
    f.installed.dispose();
  }
});
test("headless first-query estimates are replaced by actual drawing-context glyph measurements", async () => {
  const fallbackBundle = await import(`data:text/javascript;base64,${Buffer.from(bundle + "\n// distinct no-canvas module").toString("base64")}`);
  const offscreen = globalThis.OffscreenCanvas;
  delete globalThis.OffscreenCanvas;
  try {
    const result = await native(body("circle", "absolute", "A", "#ff000000", "#ffffff"));
    const adapted = fallbackBundle.adaptPineChartResult(result, bars), state = harness();
    state.chart.paneSize = () => ({ width: 720, height: 1000 });
    const installed = fallbackBundle.installPineChartPlots(state.chart, adapted.plots);
    const estimated = structuredClone(installed.primitive.rangeForVisible());
    const rendered = draw(installed, 720, 1000);
    const measured = installed.primitive.rangeForVisible(), actual = renderedExtents(rendered, state.price(0));
    assert.ok(measured.margins.above + 1e-8 >= actual.above && measured.margins.above <= actual.above + 1);
    assert.ok(measured.margins.below + 1e-8 >= actual.below && measured.margins.below <= actual.below + 1);
    assert.notDeepEqual(measured.margins, estimated.margins);
    installed.dispose();
  } finally { globalThis.OffscreenCanvas = offscreen; }
});
