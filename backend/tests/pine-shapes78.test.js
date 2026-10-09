import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

const bundle = (await build({ plugins: [createPineEnginePlugin()], bundle: true, format: "esm", platform: "browser", write: false, logLevel: "silent", stdin: {
  contents: 'export * from "./frontend/src/lib/pineChartAdapter.ts"; export * from "./frontend/src/lib/pineVisualPrimitive.ts"; export * from "./frontend/src/lib/pinePacked.ts"; export * from "./frontend/src/workers/pineNative.worker.ts"; export { Indicator, PineTS } from "pinets";',
  loader: "ts", resolveDir: fileURLToPath(new URL("../..", import.meta.url)), sourcefile: "pine-shapes78-oracles.ts",
} })).outputFiles[0].text;
// Independent asymmetric middle-baseline glyph metrics expose clipped text and
// autoscale allowances inferred only from nominal font size.
const measureText = (text) => ({ width: String(text).length * 7, actualBoundingBoxAscent: 9, actualBoundingBoxDescent: 3 });
globalThis.OffscreenCanvas = class { getContext() { return { font: "9px sans-serif", textBaseline: "middle", measureText }; } };
const pine = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const bytes = readFileSync(new URL("../../e2e/pine-visuals.bars.json", import.meta.url));
assert.equal(createHash("sha256").update(bytes).digest("hex"), "fc9a28c87aed819daae602ea45422d0d40979bd42f86097607310b0300645ea1");
const bars = JSON.parse(bytes);
const shapes = ["cross", "xcross", "diamond", "flag"];
const program = (body) => '//@version=6\nindicator("Shapes 7/8",overlay=false)\n' + body;
const shapeCall = (shape, location = "absolute", active = "bar_index==2?0:na", extra = "") =>
  `plotshape(${active},"${shape}",style=shape.${shape},location=location.${location},color=#ff0000,size=size.tiny${extra})`;
async function native(body, snapshot = bars) {
  return pine.executePineRequest({ id: "shapes78", action: "run", source: program(body), bars: snapshot, inputs: {}, context: { symbol: "TEST", timeframe: "1", mintick: .01, pointvalue: 1 } });
}
async function raw(body, snapshot = bars) {
  const candles = snapshot.map((bar) => ({ openTime: bar.time * 1000, closeTime: (bar.time + 60) * 1000, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume }));
  const engine = new pine.PineTS(candles, "TEST", "1", snapshot.length);
  engine.setTimezone("UTC"); engine.setMaxLoops(10_000);
  return engine.run(new pine.Indicator(program(body)));
}
function recordingTarget(width, height) {
  const paths = [], text = [], states = [];
  let commands = [];
  const context = {
    fillStyle: "black", strokeStyle: "black", lineWidth: 1, font: "12px sans-serif", globalAlpha: 1,
    save() { states.push({ fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, font: this.font, globalAlpha: this.globalAlpha }); },
    restore() { Object.assign(this, states.pop()); },
    beginPath() { commands = []; }, moveTo(x, y) { commands.push({ kind: "move", xy: [x, y] }); }, lineTo(x, y) { commands.push({ kind: "line", xy: [x, y] }); },
    closePath() { commands.push({ kind: "close" }); }, arc(x, y, radius) { commands.push({ kind: "arc", xy: [x, y], radius }); },
    rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); },
    fill() { paths.push({ mode: "fill", color: this.fillStyle, commands: [...commands] }); },
    stroke() { paths.push({ mode: "stroke", color: this.strokeStyle, width: this.lineWidth, commands: [...commands] }); },
    fillRect(x, y, w, h) { const old = commands; this.beginPath(); this.rect(x, y, w, h); this.fill(); commands = old; },
    fillText(value, x, y) { text.push({ value, xy: [x, y], color: this.fillStyle, font: this.font }); }, measureText,
    clip() {}, setLineDash() {},
  };
  const scope = { context, mediaSize: { width, height }, bitmapSize: { width, height }, horizontalPixelRatio: 1, verticalPixelRatio: 1 };
  return { paths, text, useMediaCoordinateSpace(callback) { callback(scope); }, useBitmapCoordinateSpace(callback) { callback(scope); } };
}
function harness(snapshot, from = 0, to = snapshot.length - 1, height = 1000, globalBars = snapshot) {
  const indices = new Map(globalBars.map((bar, index) => [bar.time, index]));
  const listeners = new Set(), created = [], removed = [], detached = [];
  let inverted = false, unavailable = false, priceCalls = 0;
  const x = (index) => 20 + (index - from) * 10;
  const price = (value) => inverted ? 300 + value * 5 : 700 - value * 5;
  const timeScale = {
    getVisibleLogicalRange: () => ({ from, to }), getVisibleRange: () => ({ from: globalBars[Math.max(0, Math.floor(from))]?.time, to: globalBars[Math.min(globalBars.length - 1, Math.ceil(to))]?.time }),
    timeToCoordinate: (time) => x(indices.get(time)), logicalToCoordinate: x, coordinateToLogical: (coordinate) => from + (coordinate - 20) / 10,
    subscribeVisibleLogicalRangeChange: (callback) => listeners.add(callback), unsubscribeVisibleLogicalRangeChange: (callback) => listeners.delete(callback),
    subscribeVisibleTimeRangeChange: (callback) => listeners.add(callback), unsubscribeVisibleTimeRangeChange: (callback) => listeners.delete(callback),
  };
  const chart = {
    timeScale: () => timeScale, paneSize: () => ({ width: 720, height }),
    subscribeSizeChange: (callback) => listeners.add(callback), unsubscribeSizeChange: (callback) => listeners.delete(callback), removeSeries: (series) => removed.push(series),
    addLineSeries(options) {
      const series = { options: () => options, data: [], setData(data) { this.data = data; },
        priceToCoordinate(value) { priceCalls++; return unavailable ? null : price(value); }, priceScale: () => ({ options: () => ({ invertScale: inverted }) }),
        attachPrimitive(primitive) { primitive.attached({ chart, series: this, requestUpdate() {} }); },
        detachPrimitive(primitive) { detached.push(primitive); primitive.detached(); },
        subscribeDataChanged: (callback) => listeners.add(callback), unsubscribeDataChanged: (callback) => listeners.delete(callback),
      }; created.push(series); return series;
    },
  };
  return { chart, x, price, created, removed, detached, listeners, priceCalls: () => priceCalls,
    range(nextFrom, nextTo) { from = nextFrom; to = nextTo; for (const callback of listeners) callback(); },
    resize(nextHeight) { height = nextHeight; for (const callback of listeners) callback(); },
    invert(value) { inverted = value; }, unavailable(value = true) { unavailable = value; },
  };
}
function draw(installed, height = 1000, width = 720) {
  const target = recordingTarget(width, height);
  assert.ok(installed.primitive, "Accepted markers must reach the real grouped primitive");
  installed.primitive.updateAllViews();
  for (const view of installed.primitive.paneViews()) { const renderer = view.renderer(); renderer?.drawBackground?.(target); renderer?.draw(target); }
  return target;
}
async function fixture(body, snapshot = bars, from = 0, to = snapshot.length - 1, height = 1000) {
  const result = await native(body, snapshot), adapted = pine.adaptPineChartResult(result, snapshot), state = harness(snapshot, from, to, height);
  return { result, adapted, state, installed: pine.installPineChartPlots(state.chart, adapted.plots) };
}
const vertices = (target) => target.paths.flatMap((path) => path.commands.filter((command) => command.xy).map((command) => command.xy));
function extent(target) {
  const points = vertices(target), ys = points.map((point) => point[1]);
  for (const glyph of target.text.filter((glyph) => glyph.value.trim())) {
    ys.push(glyph.xy[1] - 9, glyph.xy[1] + 3);
    points.push([glyph.xy[0] - glyph.value.length * 7 / 2, glyph.xy[1]], [glyph.xy[0] + glyph.value.length * 7 / 2, glyph.xy[1]]);
  }
  return { minX: Math.min(...points.map((point) => point[0])), maxX: Math.max(...points.map((point) => point[0])), minY: Math.min(...ys), maxY: Math.max(...ys) };
}
function contains(target, x, y) {
  // Canvas fills overlapping subpaths as a union for these same-winding bodies.
  const polygons = [];
  for (const path of target.paths.filter((path) => path.mode === "fill")) {
    let polygon = [];
    for (const command of path.commands) {
      if (command.kind === "move" && polygon.length) { polygons.push(polygon); polygon = []; }
      if (command.xy) polygon.push(command.xy);
      if (command.kind === "close") { polygons.push(polygon); polygon = []; }
    }
    if (polygon.length) polygons.push(polygon);
  }
  return polygons.some((points) => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i], [xj, yj] = points[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });
}
function assertMargins(target, range, anchor) {
  const actual = extent(target), margins = range.margins ?? { above: 0, below: 0 };
  const above = Math.max(0, anchor - actual.minY), below = Math.max(0, actual.maxY - anchor);
  assert.ok(margins.above >= above && margins.above <= above + 2, `Upper margin ${margins.above} must closely bound painted extent ${above}`);
  assert.ok(margins.below >= below && margins.below <= below + 2, `Lower margin ${margins.below} must closely bound painted extent ${below}`);
}

test("pinned engine and native normalization preserve new shape/location samples and source options", async () => {
  const body = shapes.flatMap((shape) => ["absolute", "abovebar", "belowbar", "top", "bottom"].map((location) =>
    shapeCall(shape, location, "bar_index==0?0:bar_index==1?-7:na", ',text="A\\nB",textcolor=#00ff00,offset=1,show_last=3').replace('"' + shape + '"', '"' + shape + location + '"'))).join("\n");
  const snapshot = bars.slice(0, 4), oracle = await raw(body, snapshot), result = await native(body, snapshot);
  assert.equal(result.plots.length, 20);
  for (const plot of result.plots) {
    const direct = Object.values(oracle.plots).find((candidate) => candidate.title === plot.name);
    assert.ok(direct); assert.deepEqual(plot.options, direct.options);
    assert.deepEqual(plot.points.map((point) => ({ time: point.time, value: point.value, options: point.options })), direct.data.map((point) => ({ time: point.time / 1000, value: Number.isFinite(point.value) ? point.value : null, options: point.options ?? {} })));
    assert.deepEqual(plot.points.map((point) => point.value), [0, -7, null, null]);
  }
  const adapted = pine.adaptPineChartResult(result, snapshot);
  assert.equal(adapted.plots.length, 20);
  assert.ok(!adapted.warnings.some((warning) => /not rendered|not drawn|unsupported/i.test(warning)));
  assert.ok(adapted.warnings.some((warning) => /local.*pixel|calibration/i.test(warning)), "Local pixel policy remains disclosed");
  for (const plot of adapted.plots) assert.equal(plot.visual.source, result.plots.find((source) => source.id === plot.id));
  const after = await raw(body, snapshot);
  assert.deepEqual(Object.values(after.plots), Object.values(oracle.plots), "Adapter support must leave fresh pinned PineTS untouched");
});

for (const shape of shapes) test(shape + " has distinct painted geometry and retained source-price bounds", async () => {
  const f = await fixture(shapeCall(shape));
  assert.equal(f.adapted.plots.length, 1);
  const target = draw(f.installed), bounds = extent(target), x = f.state.x(2), y = f.state.price(0);
  assert.ok(target.paths.length > 0 && target.paths.every((path) => path.mode === "fill" && path.color === "#ff0000"));
  assert.ok(!target.paths.some((path) => path.commands.some((command) => command.kind === "arc")));
  assert.ok(bounds.maxX > bounds.minX && bounds.maxY > bounds.minY);
  const points = vertices(target), width = bounds.maxX - bounds.minX, height = bounds.maxY - bounds.minY;
  if (shape === "cross" || shape === "xcross") {
    const cx = (bounds.minX + bounds.maxX) / 2, cy = (bounds.minY + bounds.maxY) / 2;
    assert.ok(Math.abs(cx - x) < 1e-8 && Math.abs(cy - y) < 1e-8, "Both crosses center on their absolute source price");
    assert.ok(contains(target, cx + .05, cy + .05));
    const arm = shape === "cross" ? [cx + width * .35, cy + .05] : [cx + width * .3, cy + height * .3];
    const gap = shape === "cross" ? [cx + width * .35, cy + height * .35] : [cx + width * .35, cy + .05];
    assert.ok(contains(target, ...arm), "Named cross arm is painted");
    assert.ok(!contains(target, ...gap), "A cross leaves gaps between its arms");
  } else if (shape === "diamond") {
    assert.equal(points.length, 4, "Diamond is a quadrilateral, not a triangle fallback");
    assert.ok(points.some(([px, py]) => px === x && py === bounds.minY));
    assert.ok(points.some(([px, py]) => px === x && py === bounds.maxY));
    assert.ok(points.some(([px, py]) => py === y && px === bounds.minX));
    assert.ok(points.some(([px, py]) => py === y && px === bounds.maxX));
    assert.ok(!contains(target, bounds.minX + .05, bounds.minY + .05));
  } else {
    assert.ok(points.length >= 6, "Flag has a pole and cloth outline");
    assert.ok(points.some(([px, py]) => px === x && py === y), "Flag pole reaches its absolute anchor");
    assert.ok(bounds.maxX > x && (bounds.minY < y || bounds.maxY > y), "Flag cloth extends beside a pole anchored at the source price");
  }
  const range = f.installed.primitive.rangeForVisible();
  assert.deepEqual(range.priceRange, { minValue: 0, maxValue: 0 });
  assertMargins(target, range, y);
  f.state.invert(true);
  const invertedRange = f.installed.primitive.rangeForVisible();
  assert.deepEqual(invertedRange, range, "Inversion preserves retained prices and physical screen margins");
  assertMargins(draw(f.installed), invertedRange, f.state.price(0));
  f.installed.dispose();
});

test("new shapes distinguish absolute zero from false/na/zero conditions in every other location", async () => {
  for (const shape of shapes) for (const location of ["absolute", "abovebar", "belowbar", "top", "bottom"]) {
    const f = await fixture(shapeCall(shape, location, "bar_index==0?0:bar_index==1?-7:na"), bars.slice(0, 4));
    const target = draw(f.installed), paintedXs = new Set(vertices(target).map(([x]) => Math.round(x / 10)));
    assert.ok(target.paths.length > 0, "Nonzero negative condition remains active");
    if (location !== "absolute") assert.ok(!paintedXs.has(Math.round(f.state.x(0) / 10)), "Zero is not a viewport/bar marker condition");
    const range = f.installed.primitive.rangeForVisible();
    if (location === "absolute") assert.deepEqual(range.priceRange, { minValue: -7, maxValue: 0 });
    else if (["top", "bottom"].includes(location)) assert.equal(range, null);
    else assert.deepEqual(range.priceRange, { minValue: bars[1][location === "abovebar" ? "high" : "low"], maxValue: bars[1][location === "abovebar" ? "high" : "low"] });
    f.installed.dispose();
  }
  for (const active of ["false", "na", "0"]) {
    const f = await fixture(shapeCall("cross", "top", active));
    assert.equal(draw(f.installed).paths.length, 0); assert.equal(f.installed.primitive.rangeForVisible(), null); f.installed.dispose();
  }
});

test("per-bar body/text colors and size survive native output while text extents determine margins", async () => {
  for (const shape of shapes) for (const location of ["absolute", "abovebar", "belowbar"]) {
    const body = shapeCall(shape, location, location === "absolute" ? "bar_index==2?0:bar_index==3?10:na" : "bar_index==2 or bar_index==3", ',text="A\\n\\nB",textcolor=bar_index%2==0?#00ff00:#ffffff').replace("color=#ff0000,size=size.tiny", "color=bar_index%2==0?#ff0000:#0000ff,size=bar_index%2==0?size.tiny:size.huge");
    const f = await fixture(body), target = draw(f.installed);
    const red = target.paths.filter((path) => path.color === "#ff0000"), blue = target.paths.filter((path) => path.color === "#0000ff");
    assert.ok(red.length && blue.length);
    assert.ok(extent({ paths: blue, text: [] }).maxX - extent({ paths: blue, text: [] }).minX > extent({ paths: red, text: [] }).maxX - extent({ paths: red, text: [] }).minX);
    assert.deepEqual(target.text.map((glyph) => glyph.value), ["A", "B", "A", "B"]);
    assert.deepEqual(target.text.map((glyph) => glyph.color), ["#00ff00", "#00ff00", "#ffffff", "#ffffff"]);
    // Pan to one source sample to compare the independent painter against its
    // autoscale entry without mixing differently anchored prices.
    f.state.range(2, 2);
    const one = draw(f.installed), price = location === "absolute" ? 0 : bars[2][location === "abovebar" ? "high" : "low"];
    assertMargins({ paths: one.paths.filter((path) => path.color === "#ff0000"), text: one.text.filter((glyph) => glyph.color === "#00ff00") }, f.installed.primitive.rangeForVisible(), f.state.price(price));
    f.installed.dispose();
  }
});

test("pane locations remain inside resized panes and ignore price conversion and inverted scale", async () => {
  for (const shape of [...shapes, "circle", "labelup", "labeldown"]) for (const location of ["top", "bottom"]) {
    const f = await fixture(shapeCall(shape, location, "bar_index==2", ',text="A\\n\\nB",textcolor=#00ff00'), bars, 0, bars.length - 1, 128);
    assert.equal(f.adapted.plots.length, 1);
    f.state.unavailable();
    const initial = draw(f.installed, 128), before = extent(initial);
    assert.ok(initial.paths.length && initial.text.length === 2);
    assert.ok(before.minY >= 4 && before.maxY <= 124, "Body and measured text share the pane-edge inset");
    assert.equal(f.state.priceCalls(), 0, "Pane markers do not need any valid price conversion");
    assert.equal(f.installed.primitive.rangeForVisible(), null, "Pane markers add no scale price or margin");
    f.state.invert(true);
    const inverted = draw(f.installed, 128);
    assert.deepEqual(inverted.paths, initial.paths); assert.deepEqual(inverted.text, initial.text);
    f.state.resize(224);
    const larger = extent(draw(f.installed, 224));
    assert.equal(larger.minY - before.minY, location === "bottom" ? 96 : 0);
    assert.equal(larger.maxY - before.maxY, location === "bottom" ? 96 : 0);
    assert.equal(f.installed.primitive.rangeForVisible(), null);
    f.installed.dispose();
  }
});

test("show_last filters source bars before positive negative and future-whitespace marker offsets", async () => {
  const snapshot = bars.slice(0, 8);
  for (const location of ["absolute", "top", "bottom"]) for (const offset of [-2, 1, 3]) {
    const active = location === "absolute" ? "bar_index==3?1e9:bar_index==6?0:na" : "bar_index==3?1e9:bar_index==6?1:na";
    const destination = 6 + offset;
    const f = await fixture(shapeCall("diamond", location, active, `,offset=${offset},show_last=2,text="Kept",textcolor=#00ff00`), snapshot, destination, destination, 128);
    assert.equal(f.adapted.plots.length, 1);
    const target = draw(f.installed, location === "absolute" ? 1000 : 128);
    assert.equal(target.text.filter((glyph) => glyph.value === "Kept").length, 1);
    assert.equal(target.text[0].xy[0], f.state.x(destination), "Offset applies to the retained source bar's logical x position");
    if (location === "absolute") assert.deepEqual(f.installed.primitive.rangeForVisible().priceRange, { minValue: 0, maxValue: 0 });
    else assert.equal(f.installed.primitive.rangeForVisible(), null);
    f.state.range(3 + offset, 3 + offset);
    assert.equal(draw(f.installed).paths.length, 0, "An older destination cannot revive a source outside show_last");
    assert.equal(f.installed.primitive.rangeForVisible(), null);
    f.installed.dispose();
  }
});

test("transparent bodies retain visible text while hidden blank and transparent markers add no paint or range", async () => {
  for (const shape of shapes) {
    const visible = await fixture(shapeCall(shape).replace("color=#ff0000", "color=#ff000000") + '\n' + shapeCall(shape, "absolute", "bar_index==2?0:na", ',text="Text",textcolor=#00ff00').replace('"' + shape + '"', '"Text"').replace("color=#ff0000", "color=#ff000000"));
    const target = draw(visible.installed);
    assert.equal(target.paths.length, 0); assert.equal(target.text.length, 1);
    assert.deepEqual(visible.installed.primitive.rangeForVisible().priceRange, { minValue: 0, maxValue: 0 });
    assertMargins(target, visible.installed.primitive.rangeForVisible(), visible.state.price(0));
    visible.installed.dispose();
    for (const extra of [',display=display.none', ',text="\\n\\n",textcolor=#00ff00', ',text="Invisible",textcolor=#00ff0000']) {
      const f = await fixture(shapeCall(shape, "absolute", "bar_index==2?1e9:na", extra).replace("color=#ff0000", "color=#ff000000"));
      if (extra.includes("display.none")) assert.equal(f.adapted.plots.length, 0);
      else { assert.equal(draw(f.installed).paths.length, 0); assert.equal(draw(f.installed).text.length, 0); assert.equal(f.installed.primitive.rangeForVisible(), null); }
      f.installed.dispose();
    }
  }
});

test("packed 20k shapes retain raw backing and bound viewport decoding across pan and disposal", async () => {
  const snapshot = Array.from({ length: 20_000 }, (_, index) => ({ ...bars[0], time: bars[0].time + index * 60 }));
  const body = shapes.map((shape) => shapeCall(shape, "absolute", "bar_index%512==127?0:na", ',text="Packed",textcolor=#00ff00')).join("\n") + '\n' + shapeCall("flag", "top", "bar_index%512==255?1e9:na", ',text="Edge",textcolor=#ffffff,offset=2').replace('"flag"', '"Edge"');
  const result = await native(body, snapshot), adapted = pine.adaptPineChartResult(result, snapshot), state = harness(snapshot, 10355, 10380), installed = pine.installPineChartPlots(state.chart, adapted.plots);
  assert.equal(adapted.plots.length, 5);
  for (const plot of adapted.plots) {
    assert.ok(pine.getPackedPinePlot(plot.visual.source));
    assert.equal(plot.visual.source, result.plots.find((source) => source.id === plot.id));
    assert.deepEqual(plot.segments, []);
  }
  assert.equal(installed.series.length, 1);
  for (const [from, to, expectedText] of [[10355, 10380, "Packed"], [10485, 10510, "Edge"], [11000, 11025, null]]) {
    state.range(from, to);
    const before = installed.primitive.debugStats.decodedSamples, target = draw(installed);
    assert.equal(target.text.filter((glyph) => glyph.value === expectedText).length, expectedText === "Packed" ? 4 : expectedText === "Edge" ? 1 : 0);
    const range = installed.primitive.rangeForVisible();
    if (expectedText === "Packed") { assert.deepEqual(range.priceRange, { minValue: 0, maxValue: 0 }); assertMargins(target, range, state.price(0)); }
    else assert.equal(range, null, "Pane signal magnitude never enters retained price bounds");
    assert.ok(installed.primitive.debugStats.decodedSamples - before < 400, "Packed history must decode only bounded visible neighborhoods");
  }
  installed.dispose(); installed.dispose();
  assert.equal(state.listeners.size, 0); assert.equal(state.removed.length, 1); assert.equal(state.detached.length, 1);
  assert.equal(installed.primitive.debugStats.cacheEntries, 0); assert.equal(draw(installed).paths.length, 0);
});

test("pane markers do not alter a neighboring price plot or a real timeline anchor", async () => {
  const snapshot = bars.slice(0, 8), before = structuredClone(snapshot);
  const result = await native('plot(5,"Price",color=#0000ff)\n' + shapeCall("cross", "top", "true", ',offset=2,text="Edge",textcolor=#00ff00'), snapshot), resultBefore = structuredClone(result);
  const adapted = pine.adaptPineChartResult(result, snapshot), state = harness(snapshot, 6, 10, 128, bars), anchor = { time: bars[12].time, close: 1e9 };
  assert.equal(adapted.plots.length, 2);
  const installed = pine.installPineChartPlots(state.chart, adapted.plots, "right", { scaleAnchor: anchor });
  assert.ok(draw(installed, 128).text.some((glyph) => glyph.value === "Edge"));
  assert.deepEqual(installed.primitive.rangeForVisible().priceRange, { minValue: 5, maxValue: 5 });
  assert.deepEqual(installed.primitive.rangeForVisible().margins ?? { above: 0, below: 0 }, { above: 0, below: 0 });
  assert.deepEqual(installed.series[0].data.at(-1), { time: anchor.time, value: 1e9, color: "transparent" });
  assert.notEqual(installed.series[0].data.at(-1), anchor);
  assert.deepEqual(snapshot, before); assert.deepEqual(result, resultBefore);
  state.range(12, 14);
  assert.equal(installed.primitive.rangeForVisible(), null, "Host anchor seeds cannot create artificial marker or plot prices");
  installed.dispose(); assert.equal(state.listeners.size, 0);
});


test("compressed time scales retain visible body and text slivers with either marker offset direction", async () => {
  for (const [shape, sourceIndex, offset, text] of [["cross", 8, 0, ""], ["flag", 6, 2, ""], ["xcross", 10, -2, ""], ["diamond", 2, 0, "WIDE LABEL"]]) {
    const snapshot = bars.slice(0, 32), body = shapeCall(shape, "top", "bar_index==" + sourceIndex, `,offset=${offset},text=${JSON.stringify(text)},textcolor=#00ff00`).replace("size=size.tiny", "size=size.huge");
    const result = await native(body, snapshot), adapted = pine.adaptPineChartResult(result, snapshot), state = harness(snapshot, 0, 20, 128);
    const indices = new Map(snapshot.map((bar, index) => [bar.time, index])), scale = state.chart.timeScale();
    // A real compressed viewport: logical 10..20 spans media pixels 0..30.
    scale.timeToCoordinate = (time) => (indices.get(time) - 10) * 3;
    scale.logicalToCoordinate = (index) => (index - 10) * 3;
    scale.coordinateToLogical = (x) => 10 + x / 3;
    state.chart.paneSize = () => ({ width: 30, height: 128 });
    const installed = pine.installPineChartPlots(state.chart, adapted.plots), whole = draw(installed, 128, 30), painted = extent(whole);
    assert.ok(painted.minX < 0 && painted.maxX > 0, "The native marker really intersects the pane before logical culling");
    state.range(10, 20);
    const clipped = draw(installed, 128, 30);
    assert.ok(clipped.paths.length > 0, "Logical culling must retain the marker that intersects the pane");
    if (text) assert.equal(clipped.text[0]?.value, text, "Wide text survives when its entire body lies outside the pane");
    assert.equal(installed.primitive.rangeForVisible(), null);
    assert.ok(installed.primitive.debugStats.cacheEntries <= snapshot.length, "Expanded candidate windows keep bounded sample caches");
    const decoded = installed.primitive.debugStats.decodedSamples;
    draw(installed, 128, 30);
    assert.equal(installed.primitive.debugStats.decodedSamples, decoded, "Repeated drawing reuses candidate sample cache");
    installed.dispose();
  }
});


test("omitted marker offsets render while authored na fractional or changing offsets remain disclosed omissions", async () => {
  const omitted = await fixture(shapeCall("cross", "top", "bar_index==2"));
  assert.equal(omitted.result.plots[0].options.offset, undefined);
  assert.equal(omitted.result.plots[0].points[2].options.offset, null, "Pinned engine records an omitted per-bar option as null");
  assert.equal(omitted.adapted.plots.length, 1); assert.ok(draw(omitted.installed).paths.length);
  omitted.installed.dispose();
  for (const offset of ["na", "1.5", "bar_index%2"]) {
    const result = await native(shapeCall("cross", "top", "true", ",offset=" + offset)), adapted = pine.adaptPineChartResult(result, bars);
    assert.equal(adapted.plots.length, 0, "Unsupported declared offset cannot silently become zero");
    assert.ok(adapted.warnings.some((warning) => /offset/i.test(warning) && /constant|changing|integer/i.test(warning)));
  }
});
