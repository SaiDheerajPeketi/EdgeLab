import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

const bundle = (await build({ plugins: [createPineEnginePlugin()], bundle: true, format: "esm", platform: "browser", write: false, logLevel: "silent", stdin: {
  contents: 'export * from "./frontend/src/lib/pineChartAdapter.ts"; export * from "./frontend/src/lib/pineVisualPrimitive.ts"; export * from "./frontend/src/lib/pinePacked.ts"; export * from "./frontend/src/workers/pineNative.worker.ts"; export { Indicator, PineTS } from "pinets";',
  loader: "ts", resolveDir: fileURLToPath(new URL("../..", import.meta.url)), sourcefile: "pine-chars80-oracles.ts",
} })).outputFiles[0].text;
// Independent asymmetric middle-baseline glyph metrics expose clipped text and
// autoscale allowances inferred only from nominal font size.
const measureText = (text) => ({ width: String(text) === "W" ? 80 : Array.from(String(text)).length * 7, actualBoundingBoxAscent: 9, actualBoundingBoxDescent: 3 });
globalThis.OffscreenCanvas = class { getContext() { return { font: "9px sans-serif", textBaseline: "middle", measureText }; } };
const pine = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const bytes = readFileSync(new URL("../../e2e/pine-visuals.bars.json", import.meta.url));
assert.equal(createHash("sha256").update(bytes).digest("hex"), "fc9a28c87aed819daae602ea45422d0d40979bd42f86097607310b0300645ea1");
const bars = JSON.parse(bytes);
const program = (body) => '//@version=6\nindicator("Characters 80",overlay=false)\n' + body;
const charCall = (location = "absolute", active = "bar_index==2?0:na", extra = "") =>
  `plotchar(${active},"Character",char="λ",location=location.${location},color=#ff0000,size=size.tiny${extra})`;
async function native(body, snapshot = bars) {
  return pine.executePineRequest({ id: "chars80", action: "run", source: program(body), bars: snapshot, inputs: {}, context: { symbol: "TEST", timeframe: "1", mintick: .01, pointvalue: 1 } });
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
    points.push([glyph.xy[0] - measureText(glyph.value).width / 2, glyph.xy[1]], [glyph.xy[0] + measureText(glyph.value).width / 2, glyph.xy[1]]);
  }
  return { minX: Math.min(...points.map((point) => point[0])), maxX: Math.max(...points.map((point) => point[0])), minY: Math.min(...ys), maxY: Math.max(...ys) };
}
function assertMargins(target, range, anchor) {
  const actual = extent(target), margins = range.margins ?? { above: 0, below: 0 };
  const above = Math.max(0, anchor - actual.minY), below = Math.max(0, actual.maxY - anchor);
  assert.ok(margins.above >= above && margins.above <= above + 2, `Upper margin ${margins.above} must closely bound painted extent ${above}`);
  assert.ok(margins.below >= below && margins.below <= below + 2, `Lower margin ${margins.below} must closely bound painted extent ${below}`);
}


const locations = ["absolute", "abovebar", "belowbar", "top", "bottom"];
test("pinned engine and genuine worker preserve plotchar source values and all authored visual options", async () => {
  const snapshot = bars.slice(0, 4), body = locations.flatMap((location) => [-2, 0, 2].map((offset) =>
    charCall(location, "bar_index==0?0:bar_index==1?-7:na", `,offset=${offset},text="A\\nB",textcolor=#00ff00,show_last=3`).replace('"Character"', JSON.stringify(location + offset)).replace('char="λ"', 'char="😺X"'))).join("\n");
  const oracle = await raw(body, snapshot), result = await native(body, snapshot);
  assert.equal(result.plots.length, 15);
  for (const plot of result.plots) {
    const direct = Object.values(oracle.plots).find((candidate) => candidate.title === plot.name);
    assert.equal(plot.style, "char"); assert.deepEqual(plot.options, direct.options);
    assert.deepEqual(plot.points.map((point) => [point.time, point.value]), direct.data.map((point) => [point.time / 1000, Number.isFinite(point.value) ? point.value : null]));
    assert.deepEqual(plot.points.map((point) => point.value), [0, -7, null, null]);
    for (const [index, point] of plot.points.entries()) for (const key of ["char", "color", "textcolor", "location", "size", "offset"]) assert.equal(point.options[key], direct.data[index].options[key] ?? null);
    assert.equal(plot.options.char, "😺X", "The adapter owns the one-codepoint display policy without changing native output");
  }
  const before = structuredClone(result), adapted = pine.adaptPineChartResult(result, snapshot);
  assert.equal(adapted.plots.length, 15);
  assert.ok(!adapted.warnings.some((warning) => /not rendered|not drawn|unsupported/i.test(warning)));
  assert.ok(adapted.warnings.some((warning) => /local|calibration/i.test(warning)));
  for (const plot of adapted.plots) assert.equal(plot.visual.source, result.plots.find((source) => source.id === plot.id));
  assert.deepEqual(result, before);
  const after = await raw(body, snapshot);
  assert.deepEqual(Object.values(after.plots), Object.values(oracle.plots), "Rendering cannot alter fresh pinned PineTS behavior");
});

test("default star and first Unicode codepoint render without body fallback polygons", async () => {
  const f = await fixture('plotchar(bar_index==2,"Default")\n' + charCall("absolute", "bar_index==2?0:na").replace('"Character"', '"Emoji"').replace('char="λ"', 'char="😺X"') + '\n' + charCall("absolute", "bar_index==2?0:na").replace('"Character"', '"CJK"').replace('char="λ"', 'char="雪⭐"'));
  assert.equal(f.adapted.plots.length, 3);
  const target = draw(f.installed);
  assert.equal(target.paths.length, 0, "Characters cannot become a shape fallback");
  assert.deepEqual(target.text.map((glyph) => glyph.value), ["★", "😺", "雪"]);
  assert.ok(target.text.every((glyph) => glyph.xy[0] === f.state.x(2)));
  assert.ok(f.adapted.warnings.some((warning) => /default|omitted/i.test(warning)), "Local absent-option defaults remain disclosed");
  assert.equal(f.result.plots[0].options.char, undefined);
  assert.equal(f.result.plots[0].points[2].options.char, null, "Worker canonical null for an omitted declaration cannot hide the default star");
  assert.equal(f.result.plots[1].options.char, "😺X");
  f.installed.dispose();
});

test("zero absolute prices and nonzero negative conditions render while false na and other zero conditions do not", async () => {
  for (const location of locations) {
    const f = await fixture(charCall(location, "bar_index==0?0:bar_index==1?-7:na"), bars.slice(0, 4));
    const target = draw(f.installed);
    assert.equal(target.paths.length, 0);
    assert.equal(target.text.length, location === "absolute" ? 2 : 1);
    assert.deepEqual(target.text.map((glyph) => glyph.xy[0]), (location === "absolute" ? [0, 1] : [1]).map(f.state.x));
    const range = f.installed.primitive.rangeForVisible();
    if (location === "absolute") assert.deepEqual(range.priceRange, { minValue: -7, maxValue: 0 });
    else if (["top", "bottom"].includes(location)) assert.equal(range, null);
    else assert.deepEqual(range.priceRange, { minValue: bars[1][location === "abovebar" ? "high" : "low"], maxValue: bars[1][location === "abovebar" ? "high" : "low"] });
    f.installed.dispose();
  }
  for (const active of ["false", "na", "0"]) {
    const f = await fixture(charCall("top", active));
    assert.equal(draw(f.installed).text.length, 0); assert.equal(f.installed.primitive.rangeForVisible(), null); f.installed.dispose();
  }
});

test("per-bar character color size and separate multiline text retain measured autoscale extents", async () => {
  for (const location of ["absolute", "abovebar", "belowbar"]) {
    const body = charCall(location, location === "absolute" ? "bar_index==2?0:bar_index==3?10:na" : "bar_index==2 or bar_index==3", ',text="A\\n\\nB",textcolor=bar_index%2==0?#00ff00:#ffffff').replace('char="λ"', 'char=bar_index%2==0?"λ":"✓"').replace('color=#ff0000,size=size.tiny', 'color=bar_index%2==0?#ff0000:#0000ff,size=bar_index%2==0?size.tiny:size.huge');
    const f = await fixture(body), target = draw(f.installed);
    assert.equal(target.paths.length, 0);
    const chars = target.text.filter((glyph) => ["λ", "✓"].includes(glyph.value)), labels = target.text.filter((glyph) => ["A", "B"].includes(glyph.value));
    assert.deepEqual(chars.map((glyph) => glyph.value), ["λ", "✓"]);
    assert.deepEqual(chars.map((glyph) => glyph.color), ["#ff0000", "#0000ff"]);
    assert.ok(parseFloat(chars[1].font) > parseFloat(chars[0].font));
    assert.deepEqual(labels.map((glyph) => glyph.value), ["A", "B", "A", "B"]);
    assert.deepEqual(labels.map((glyph) => glyph.color), ["#00ff00", "#00ff00", "#ffffff", "#ffffff"]);
    f.state.range(2, 2);
    const one = draw(f.installed), targetOne = { paths: [], text: one.text.filter((glyph) => ["#ff0000", "#00ff00"].includes(glyph.color)) };
    const anchor = location === "absolute" ? 0 : bars[2][location === "abovebar" ? "high" : "low"], range = f.installed.primitive.rangeForVisible();
    assertMargins(targetOne, range, f.state.price(anchor));
    f.state.invert(true);
    assert.deepEqual(f.installed.primitive.rangeForVisible(), range, "Inversion retains physical glyph margins");
    f.installed.dispose();
  }
});

test("empty or na chars allow text-only output while blank hidden and transparent glyphs reserve no range", async () => {
  for (const char of ['""', "na"]) {
    const f = await fixture(charCall("absolute", "bar_index==2?0:na", ',text="Text",textcolor=#00ff00').replace('char="λ"', "char=" + char)), target = draw(f.installed);
    assert.equal(target.paths.length, 0); assert.deepEqual(target.text.map((glyph) => glyph.value), ["Text"]);
    assertMargins(target, f.installed.primitive.rangeForVisible(), f.state.price(0));
    f.installed.dispose();
  }
  for (const body of [
    charCall().replace('char="λ"', 'char=""'), charCall().replace('char="λ"', 'char=na'),
    charCall().replace('color=#ff0000', 'color=na'), charCall().replace('color=#ff0000', 'color=#ff000000'),
    charCall("absolute", "bar_index==2?1e9:na", ',display=display.none'),
    charCall("absolute", "bar_index==2?1e9:na", ',text="\\n\\n",textcolor=#00ff00').replace('char="λ"', 'char=""'),
    charCall("absolute", "bar_index==2?1e9:na", ',text="Hidden",textcolor=#00ff0000').replace('color=#ff0000', 'color=#ff000000'),
  ]) {
    const f = await fixture(body);
    if (body.includes("display.none")) assert.equal(f.adapted.plots.length, 0);
    else { assert.equal(draw(f.installed).text.length, 0); assert.equal(f.installed.primitive.rangeForVisible(), null); }
    f.installed.dispose();
  }
});

test("pane chars and text remain pinned through resize inversion and unavailable price coordinates", async () => {
  for (const location of ["top", "bottom"]) {
    const f = await fixture(charCall(location, "bar_index==2", ',text="A\\n\\nB",textcolor=#00ff00'), bars, 0, bars.length - 1, 128);
    assert.equal(f.adapted.plots.length, 1); f.state.unavailable();
    const target = draw(f.installed, 128), before = extent(target);
    assert.equal(target.paths.length, 0); assert.deepEqual(target.text.map((glyph) => glyph.value).sort(), ["A", "B", "λ"].sort());
    assert.ok(before.minY >= 4 && before.maxY <= 124);
    assert.equal(f.state.priceCalls(), 0); assert.equal(f.installed.primitive.rangeForVisible(), null);
    f.state.invert(true);
    assert.deepEqual(draw(f.installed, 128).text, target.text);
    f.state.resize(224);
    const after = extent(draw(f.installed, 224));
    assert.equal(after.minY - before.minY, location === "bottom" ? 96 : 0);
    assert.equal(after.maxY - before.maxY, location === "bottom" ? 96 : 0);
    f.installed.dispose();
  }
});

test("source show_last and signed offsets preserve char x positions including future whitespace", async () => {
  const snapshot = bars.slice(0, 8);
  for (const location of locations) for (const offset of [-2, 1, 3]) {
    const destination = 6 + offset, active = location === "absolute" ? "bar_index==3?1e9:bar_index==6?0:na" : "bar_index==3?1e9:bar_index==6?1:na";
    const f = await fixture(charCall(location, active, `,offset=${offset},show_last=2`), snapshot, destination, destination);
    assert.equal(f.adapted.plots.length, 1);
    const target = draw(f.installed);
    assert.equal(target.text.length, 1); assert.equal(target.text[0].xy[0], f.state.x(destination));
    const range = f.installed.primitive.rangeForVisible();
    if (location === "absolute") assert.deepEqual(range.priceRange, { minValue: 0, maxValue: 0 });
    else if (["top", "bottom"].includes(location)) assert.equal(range, null);
    f.state.range(3 + offset, 3 + offset);
    assert.equal(draw(f.installed).text.length, 0); assert.equal(f.installed.primitive.rangeForVisible(), null);
    f.installed.dispose();
  }
  for (const offset of ["na", "1.5", "bar_index%2"]) {
    const result = await native(charCall("top", "true", ",offset=" + offset)), adapted = pine.adaptPineChartResult(result, bars);
    assert.equal(adapted.plots.length, 0); assert.ok(adapted.warnings.some((warning) => /offset/i.test(warning)));
  }
});

test("packed 20k chars keep raw backing while pan redraw resize and disposal stay bounded", async () => {
  const snapshot = Array.from({ length: 20_000 }, (_, index) => ({ ...bars[0], time: bars[0].time + index * 60 }));
  const body = charCall("absolute", "bar_index%512==127?0:na", ',text="Packed",textcolor=#00ff00') + '\n' + charCall("top", "bar_index%512==255?1e9:na", ',text="Edge",textcolor=#ffffff,offset=2').replace('"Character"', '"Edge"').replace('char="λ"', 'char="😺X"');
  const result = await native(body, snapshot), adapted = pine.adaptPineChartResult(result, snapshot), state = harness(snapshot, 10355, 10380), installed = pine.installPineChartPlots(state.chart, adapted.plots);
  assert.equal(adapted.plots.length, 2); assert.equal(installed.series.length, 1);
  for (const plot of adapted.plots) {
    assert.ok(pine.getPackedPinePlot(plot.visual.source)); assert.equal(plot.visual.source, result.plots.find((source) => source.id === plot.id)); assert.deepEqual(plot.segments, []);
  }
  for (const [from, to, label] of [[10355, 10380, "Packed"], [10485, 10510, "Edge"], [11000, 11025, null]]) {
    state.range(from, to);
    const before = installed.primitive.debugStats.decodedSamples, target = draw(installed);
    assert.equal(target.paths.length, 0); assert.equal(target.text.filter((glyph) => glyph.value === label).length, label ? 1 : 0);
    if (label) assert.equal(target.text.filter((glyph) => glyph.value === (label === "Packed" ? "λ" : "😺")).length, 1);
    const range = installed.primitive.rangeForVisible();
    if (label === "Packed") { assert.deepEqual(range.priceRange, { minValue: 0, maxValue: 0 }); assertMargins(target, range, state.price(0)); }
    else assert.equal(range, null);
    assert.ok(installed.primitive.debugStats.decodedSamples - before < 240);
    state.resize(128); draw(installed, 128); state.resize(1000);
  }
  installed.dispose(); installed.dispose();
  assert.equal(state.listeners.size, 0); assert.equal(state.detached.length, 1); assert.equal(state.removed.length, 1);
  assert.equal(installed.primitive.debugStats.cacheEntries, 0); assert.equal(draw(installed).text.length, 0);
});


test("omitted text color inherits glyph color while explicit and per-bar na retain suppression", async () => {
  const inherited = await fixture(charCall("absolute", "bar_index==2?0:na", ',text="Text"'));
  assert.deepEqual(draw(inherited.installed).text.map((glyph) => [glyph.value, glyph.color]), [["λ", "#ff0000"], ["Text", "#ff0000"]]);
  inherited.installed.dispose();
  for (const [body, expected] of [
    [charCall("absolute", "bar_index==2?0:na", ',text="Text",textcolor=na'), ["λ"]],
    [charCall("absolute", "bar_index==2?0:na", ',text="Text",textcolor=#00ff00').replace('color=#ff0000', 'color=na'), ["Text"]],
    [charCall().replace('char="λ"', 'char=bar_index==2?na:"λ"'), []],
    [charCall().replace('color=#ff0000', 'color=bar_index==2?na:#ff0000'), []],
    [charCall("absolute", "bar_index==2?0:na", ',text="Text",textcolor=bar_index==2?na:#00ff00'), ["λ"]],
  ]) {
    const f = await fixture(body), target = draw(f.installed);
    assert.deepEqual(target.text.map((glyph) => glyph.value), expected);
    const range = f.installed.primitive.rangeForVisible();
    if (expected.length) { assert.deepEqual(range.priceRange, { minValue: 0, maxValue: 0 }); assertMargins(target, range, f.state.price(0)); }
    else assert.equal(range, null);
    f.installed.dispose();
  }
});

test("measured wide character ink remains visible outside compressed viewport centers with signed offsets", async () => {
  for (const offset of [-2, 0, 2]) {
    const sourceIndex = offset < 0 ? 2 : 0, snapshot = bars.slice(0, 32);
    const result = await native(charCall("top", "bar_index==" + sourceIndex, ",offset=" + offset).replace('char="λ"', 'char="W"'), snapshot);
    const adapted = pine.adaptPineChartResult(result, snapshot), state = harness(snapshot, 0, 20, 128), indices = new Map(snapshot.map((bar, index) => [bar.time, index])), scale = state.chart.timeScale();
    // Logical 10..20 spans pixels 0..30. The independent wide-glyph fixture
    // reaches into the pane from an older source more than one bar away.
    scale.timeToCoordinate = (time) => (indices.get(time) - 10) * 3;
    scale.logicalToCoordinate = (index) => (index - 10) * 3;
    scale.coordinateToLogical = (x) => 10 + x / 3;
    state.chart.paneSize = () => ({ width: 30, height: 128 });
    const installed = pine.installPineChartPlots(state.chart, adapted.plots), full = extent(draw(installed, 128, 30));
    assert.ok(full.minX < 0 && full.maxX > 0);
    state.range(10, 20);
    const clipped = draw(installed, 128, 30);
    assert.deepEqual(clipped.text.map((glyph) => glyph.value), ["W"]);
    assert.equal(clipped.text[0].xy[0], (sourceIndex + offset - 10) * 3);
    assert.equal(installed.primitive.rangeForVisible(), null);
    const decoded = installed.primitive.debugStats.decodedSamples;
    draw(installed, 128, 30);
    assert.equal(installed.primitive.debugStats.decodedSamples, decoded);
    assert.ok(installed.primitive.debugStats.cacheEntries <= snapshot.length);
    installed.dispose(); assert.equal(state.listeners.size, 0);
  }
});

test("headless first-query character estimates yield to independently measured drawing extents", async () => {
  const headless = await import(`data:text/javascript;base64,${Buffer.from(bundle + "\n// independent char headless oracle").toString("base64")}`), offscreen = globalThis.OffscreenCanvas;
  delete globalThis.OffscreenCanvas;
  try {
    const result = await native(charCall()), adapted = headless.adaptPineChartResult(result, bars), state = harness(bars), installed = headless.installPineChartPlots(state.chart, adapted.plots);
    const estimate = structuredClone(installed.primitive.rangeForVisible()), target = draw(installed), measured = installed.primitive.rangeForVisible();
    assert.equal(target.text[0].value, "λ");
    assertMargins(target, measured, state.price(0));
    assert.notDeepEqual(measured.margins, estimate.margins, "Glyph measurement cannot leave stale estimated bounds cached");
    installed.dispose();
  } finally { globalThis.OffscreenCanvas = offscreen; }
});
