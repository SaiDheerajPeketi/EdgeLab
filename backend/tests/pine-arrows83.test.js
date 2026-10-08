import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

async function load(contents, plugins = []) {
  const bundle = (await build({ bundle: true, format: "esm", platform: "browser", write: false, logLevel: "silent", plugins, stdin: {
    contents, loader: "ts", resolveDir: fileURLToPath(new URL("../..", import.meta.url)), sourcefile: "pine-arrows83-oracles.ts",
  } })).outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
}
// Keep the unmodified installed engine separate from the reviewed worker build.
const original = await load('export { Indicator, PineTS } from "pinets";');
const pine = await load('export * from "./frontend/src/lib/pineChartAdapter.ts"; export * from "./frontend/src/lib/pineVisualPrimitive.ts"; export * from "./frontend/src/lib/pinePacked.ts"; export * from "./frontend/src/workers/pineNative.worker.ts";', [createPineEnginePlugin()]);
const bytes = readFileSync(new URL("../../e2e/pine-visuals.bars.json", import.meta.url));
assert.equal(createHash("sha256").update(bytes).digest("hex"), "fc9a28c87aed819daae602ea45422d0d40979bd42f86097607310b0300645ea1");
const bars = JSON.parse(bytes);
const program = (body) => '//@version=6\nindicator("Arrows 83",overlay=false)\n' + body;
const call = (series = "bar_index==0?2:bar_index==1?-4:bar_index==2?0:na", extra = "", title = "Arrow") => `plotarrow(${series},${JSON.stringify(title)}${extra})`;
async function native(body, snapshot = bars) {
  return pine.executePineRequest({ id: "arrows83", action: "run", source: program(body), bars: snapshot, inputs: {}, context: { symbol: "TEST", timeframe: "1", mintick: .01, pointvalue: 1 } });
}
async function raw(body, snapshot = bars) {
  const candles = snapshot.map(bar => ({ openTime: bar.time * 1000, closeTime: (bar.time + 60) * 1000, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume }));
  const engine = new original.PineTS(candles, "TEST", "1", snapshot.length);
  engine.setTimezone("UTC"); engine.setMaxLoops(10_000);
  return engine.run(new original.Indicator(program(body)));
}
const measureText = text => ({ width: String(text).length * 7, actualBoundingBoxAscent: 9, actualBoundingBoxDescent: 3 });
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

const points = path => path.commands.filter(command => command.xy).map(command => command.xy);
function bounds(path) {
  const xy = points(path);
  return { minX: Math.min(...xy.map(p => p[0])), maxX: Math.max(...xy.map(p => p[0])), minY: Math.min(...xy.map(p => p[1])), maxY: Math.max(...xy.map(p => p[1])) };
}
const height = path => { const b = bounds(path); return b.maxY - b.minY; };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
async function fixture(body, snapshot = bars, from = 0, to = snapshot.length - 1) {
  const result = await native(body, snapshot), adapted = pine.adaptPineChartResult(result, snapshot), state = harness(snapshot, from, to);
  return { result, adapted, state, installed: pine.installPineChartPlots(state.chart, adapted.plots) };
}

test("reviewed worker preserves original signed samples and authored options with only arrow style tagging", async () => {
  const snapshot = bars.slice(0, 6), body = call("bar_index==0?2:bar_index==1?-4:bar_index==2?0:bar_index==3?na:bar_index==4?1:-2", ",colorup=#00ff00,colordown=#ff0000,minheight=8,maxheight=36,offset=2,show_last=3,force_overlay=true");
  const oracle = Object.values((await raw(body, snapshot)).plots)[0], result = await native(body, snapshot), plot = result.plots[0];
  assert.equal(oracle.options.style, "shape");
  assert.equal(Object.hasOwn(oracle.options, "shape"), false);
  assert.equal(plot.style, "arrow");
  assert.deepEqual(plot.options, { ...oracle.options, style: "arrow" });
  assert.deepEqual(plot.points.map(p => p.value), [2, -4, 0, null, 1, -2]);
  for (const [i, sample] of plot.points.entries()) {
    assert.equal(sample.time, oracle.data[i].time / 1000);
    for (const [key, value] of Object.entries(oracle.data[i].options ?? {})) assert.equal(sample.options[key], value ?? null, key);
  }
  assert.deepEqual(oracle.data.filter(p => p.options).map(p => p.options.height), [36, 36, 36, 36], "Native height metadata is a bound, not proportional geometry");
  const before = structuredClone(result), adapted = pine.adaptPineChartResult(result, snapshot);
  assert.equal(adapted.plots[0].visual.source, plot);
  assert.deepEqual(result, before);
  assert.equal(adapted.plots[0].visual.arrow.maxMagnitude, 4);
});

test("omitted bounds and colors render disclosed local defaults without mutating native metadata", async () => {
  const f = await fixture(call(), bars.slice(0, 4)), source = f.result.plots[0];
  assert.equal(source.options.minheight, undefined); assert.equal(source.options.maxheight, undefined);
  assert.deepEqual(f.adapted.plots[0].visual.arrow, { minHeight: 5, maxHeight: 100, maxMagnitude: 4 });
  const target = draw(f.installed);
  assert.deepEqual(target.paths.map(p => p.color), ["#22c55e", "#fb7185"]);
  assert.deepEqual(target.paths.map(height), [50, 100]); assert.deepEqual(target.text, []);
  assert.ok(f.adapted.warnings.some(w => /calibration|normalization/i.test(w)));
  assert.ok(f.adapted.warnings.some(w => /omitted.*color/i.test(w)));
  f.installed.dispose();
});

test("proportional bounded heights use full retained source magnitudes including hidden outliers independently per channel", async () => {
  const body = call("bar_index==0?100:bar_index==1?25:bar_index==2?-25:bar_index==3?1:0", ",colorup=bar_index==0?na:#00ff00,colordown=#ff0000,minheight=10,maxheight=80,show_last=4") + "\n" +
    call("bar_index==1?25:0", ",colorup=#ffffff,minheight=10,maxheight=80", "Independent");
  const f = await fixture(body, bars.slice(0, 5));
  assert.deepEqual(f.adapted.plots.map(p => p.visual.arrow.maxMagnitude), [100, 25]);
  const target = draw(f.installed);
  assert.deepEqual(target.paths.map(height), [20, 20, 10, 80]);
  assert.ok(target.paths.every(p => p.mode === "fill" && !p.commands.some(c => c.kind === "arc")), "Each arrow is one filled polygon");
  assert.deepEqual(target.text, []);
  f.state.range(1, 1);
  assert.deepEqual(draw(f.installed).paths.map(height), [20, 80], "Pan must not renormalize arrows");
  f.installed.dispose();
});

test("zero and na remain identifiable arrow channels with no geometry or price range", async () => {
  for (const signal of ["0", "na"]) {
    const f = await fixture(call(signal), bars.slice(0, 3));
    assert.equal(f.result.plots[0].style, "arrow"); assert.equal(f.adapted.plots.length, 1);
    assert.equal(f.adapted.plots[0].visual.arrow.maxMagnitude, 0);
    assert.equal(draw(f.installed).paths.length, 0); assert.equal(f.installed.primitive.rangeForVisible(), null);
    f.installed.dispose();
  }
});

test("zero-height bounds hide numeric arrows without contributing price range", async () => {
  const f = await fixture(call("bar_index%2==0?10:-10", ",minheight=0,maxheight=0"), bars.slice(0, 4));
  assert.equal(f.adapted.plots[0].visual.arrow.maxMagnitude, 10);
  assert.equal(draw(f.installed).paths.length, 0); assert.equal(f.installed.primitive.rangeForVisible(), null);
  f.installed.dispose();
});

test("boolean signals and invalid or changing authored bounds offset and show_last reject explicitly", async () => {
  for (const signal of ["true", "bar_index%2==0"]) await assert.rejects(native(call(signal), bars.slice(0, 3)), /number|numeric|boolean/i);
  for (const options of [",minheight=-1", ",maxheight=-1", ",minheight=1.5", ",maxheight=na", ",minheight=20,maxheight=10", ",minheight=bar_index", ",maxheight=100+bar_index", ",offset=na", ",offset=0.5", ",offset=bar_index", ",show_last=-1", ",show_last=1.5", ",show_last=bar_index"]) {
    await assert.rejects(native(call("1", options), bars.slice(0, 3)), /integer|constant|height|offset|show_last/i, options);
  }
});

test("physical orientation and bar anchors survive inversion resize and offsets without magnitude prices", async () => {
  for (const offset of [-2, 0, 2]) {
    const f = await fixture(call("bar_index==2?1e9:bar_index==3?-5e8:0", `,minheight=5,maxheight=60,offset=${offset},colorup=#00ff00,colordown=#ff0000`), bars.slice(0, 6), offset, 5 + offset);
    for (const inverted of [false, true]) {
      f.state.invert(inverted); f.state.resize(500);
      const target = draw(f.installed, 500), [up, down] = target.paths.map(bounds);
      assert.equal(target.paths.length, 2);
      close((up.minX + up.maxX) / 2, f.state.x(2 + offset)); close((down.minX + down.maxX) / 2, f.state.x(3 + offset));
      close(up.minY, f.state.price(bars[2].low) + 4); close(up.maxY - up.minY, 60);
      close(down.maxY, f.state.price(bars[3].high) - 4); close(down.maxY - down.minY, 30);
      const range = f.installed.primitive.rangeForVisible();
      assert.deepEqual(range.priceRange, { minValue: bars[2].low, maxValue: bars[3].high });
      assert.ok(range.margins.below >= 64 && range.margins.below <= 66);
      assert.ok(range.margins.above >= 34 && range.margins.above <= 36);
      assert.equal(target.text.length, 0);
    }
    f.installed.dispose();
  }
});

test("source-first show_last with signed offsets includes future whitespace without reviving discarded arrows", async () => {
  for (const offset of [-2, 2]) {
    const f = await fixture(call("bar_index==2?100:bar_index==4?10:bar_index==5?-5:0", `,minheight=5,maxheight=100,offset=${offset},show_last=2`), bars.slice(0, 6), 4 + offset, 5 + offset);
    const target = draw(f.installed);
    assert.deepEqual(target.paths.map(height), [10, 5], "Discarded source magnitudes still participate in snapshot normalization");
    assert.deepEqual(target.paths.map(p => (bounds(p).minX + bounds(p).maxX) / 2), [f.state.x(4 + offset), f.state.x(5 + offset)]);
    f.state.range(2 + offset, 2 + offset);
    assert.equal(draw(f.installed).paths.length, 0); assert.equal(f.installed.primitive.rangeForVisible(), null);
    f.installed.dispose();
  }
});

test("explicit na direction color suppresses paint and margins while retaining its magnitude", async () => {
  const f = await fixture(call("bar_index==0?100:bar_index==1?-10:0", ",colorup=na,colordown=#ff0000,minheight=0,maxheight=100"), bars.slice(0, 3));
  const target = draw(f.installed); assert.deepEqual(target.paths.map(height), [10]);
  assert.deepEqual(f.installed.primitive.rangeForVisible().priceRange, { minValue: bars[1].high, maxValue: bars[1].high });
  f.state.range(0, 0); assert.equal(draw(f.installed).paths.length, 0); assert.equal(f.installed.primitive.rangeForVisible(), null);
  f.installed.dispose();
});

test("compressed glyphs centered several bars outside the pane still paint visible fringe without autoscale pollution", async () => {
  const f = await fixture(call("bar_index==90?1:0", ",minheight=10,maxheight=20"), bars.slice(0, 256), 100, 250);
  const scale = f.state.chart.timeScale();
  scale.logicalToCoordinate = i => (i - 100) * .2;
  scale.timeToCoordinate = time => (bars.findIndex(bar => bar.time === time) - 100) * .2;
  scale.coordinateToLogical = x => 100 + x / .2;
  f.state.chart.paneSize = () => ({ width: 30, height: 1000 });
  const target = draw(f.installed, 1000, 30);
  assert.equal(target.paths.length, 1); const b = bounds(target.paths[0]);
  assert.ok(b.minX < 0 && b.maxX > 0);
  assert.equal(f.installed.primitive.rangeForVisible(), null);
  f.installed.dispose();
});

test("packed 20k normalization retains backing arrays while pan redraw resize cache and disposal stay bounded", async () => {
  const snapshot = Array.from({ length: 20_000 }, (_, i) => ({ ...bars[0], time: bars[0].time + i * 60 }));
  const result = await native(call("bar_index==0?1000:bar_index%512==127?100:bar_index%512==255?-50:0", ",minheight=5,maxheight=100,offset=2"), snapshot);
  const adapted = pine.adaptPineChartResult(result, snapshot), state = harness(snapshot, 10355, 10380), installed = pine.installPineChartPlots(state.chart, adapted.plots);
  assert.equal(adapted.plots.length, 1); const source = adapted.plots[0].visual.source;
  assert.ok(pine.getPackedPinePlot(source)); assert.equal(source, result.plots[0]);
  assert.deepEqual(adapted.plots[0].segments, []); assert.deepEqual(adapted.plots[0].markers, []);
  assert.equal(adapted.plots[0].visual.arrow.maxMagnitude, 1000);
  for (const [from, to, expected] of [[10355, 10380, 10], [10485, 10510, 5], [11100, 11125, null]]) {
    state.range(from, to); const before = installed.primitive.debugStats.decodedSamples, target = draw(installed);
    assert.deepEqual(target.paths.map(height), expected === null ? [] : [expected]); assert.equal(target.text.length, 0);
    installed.primitive.rangeForVisible();
    assert.ok(installed.primitive.debugStats.decodedSamples - before < 240);
    const after = installed.primitive.debugStats.decodedSamples; draw(installed);
    assert.equal(installed.primitive.debugStats.decodedSamples, after);
    state.resize(128); draw(installed, 128); state.resize(1000);
  }
  assert.ok(installed.primitive.debugStats.cacheEntries < 20_000);
  installed.dispose(); installed.dispose();
  assert.equal(state.listeners.size, 0); assert.equal(state.removed.length, 1); assert.equal(state.detached.length, 1);
  assert.equal(installed.primitive.debugStats.cacheEntries, 0); assert.equal(draw(installed).paths.length, 0);
});

test("full positional arrow arguments and input bounds preserve native metadata alongside ordinary shape arrows", async () => {
  const body = 'lo=input.int(7,"Minimum")\nhi=input.int(42,"Maximum")\nplotarrow(bar_index%2==0?2:-1,"Positional",#00ff00,#ff0000,-1,lo,hi,false,3,display.all,format.price,2,true)\nplotshape(bar_index==1,"Shape",style=shape.arrowup,location=location.belowbar,color=#ffffff)';
  const snapshot = bars.slice(0, 4), oracle = Object.values((await raw(body, snapshot)).plots), result = await native(body, snapshot);
  const arrow = result.plots.find(p => p.name === "Positional"), shape = result.plots.find(p => p.name === "Shape");
  assert.equal(oracle.find(p => p.title === "Positional").options.minheight, undefined, "Original native positional option loss is repaired at the binding");
  const named = Object.values((await raw(call("bar_index%2==0?2:-1", ",colorup=#00ff00,colordown=#ff0000,offset=-1,minheight=7,maxheight=42,editable=false,show_last=3,display=display.all,format=format.price,precision=2,force_overlay=true", "Positional"), snapshot)).plots)[0];
  assert.deepEqual(arrow.options, { ...named.options, style: "arrow" });
  assert.equal(arrow.overlay, true); assert.equal(shape.style, "shape");
  const adapted = pine.adaptPineChartResult(result, snapshot);
  assert.deepEqual(adapted.plots.find(p => p.name === "Positional").visual.arrow, { minHeight: 7, maxHeight: 42, maxMagnitude: 2 });
  assert.equal(adapted.plots.find(p => p.name === "Shape").visual.arrow, undefined);
});

test("overlay declarations and force_overlay false preserve indicator pane choice", async () => {
  for (const overlay of [false, true]) for (const force of [false, true]) {
    const source = program(call("1", ",force_overlay=" + force)).replace("overlay=false", "overlay=" + overlay);
    const result = await pine.executePineRequest({ id: "overlay83", action: "run", source, bars: bars.slice(0, 2), inputs: {}, context: { symbol: "TEST", timeframe: "1", mintick: .01, pointvalue: 1 } });
    assert.equal(result.plots[0].overlay, overlay || force);
    assert.equal(pine.adaptPineChartResult(result, bars.slice(0, 2)).plots[0].overlay, overlay || force);
  }
});

test("short arrows respect sub-head bounds with one translucent silhouette and show_last zero hides all", async () => {
  const f = await fixture(call("bar_index==0?1:bar_index==1?-1:0", ",minheight=0,maxheight=1,colorup=color.new(#00ff00,50),colordown=color.new(#ff0000,50)"), bars.slice(0, 3));
  const target = draw(f.installed);
  assert.equal(target.paths.length, 2); assert.deepEqual(target.paths.map(height), [1, 1]);
  assert.ok(target.paths.every(path => path.mode === "fill" && /^#[0-9a-f]{8}$/i.test(path.color) && parseInt(path.color.slice(-2), 16) > 0 && parseInt(path.color.slice(-2), 16) < 255));
  assert.deepEqual(target.paths.map(path => path.color), f.result.plots[0].points.slice(0, 2).map(point => point.options.color));
  for (const path of target.paths) assert.equal(path.commands.filter(c => c.kind === "close").length, 1);
  f.installed.dispose();
  const hidden = await fixture(call("1", ",show_last=0"), bars.slice(0, 3));
  assert.equal(draw(hidden.installed).paths.length, 0); assert.equal(hidden.installed.primitive.rangeForVisible(), null);
  hidden.installed.dispose();
});

async function preparedArrowInputs(source, snapshot, overrides) {
  const request = { id: "arrow-inputs83", action: "prepare", source, bars: snapshot, inputs: {}, context: { symbol: "TEST", timeframe: "1", mintick: .01, pointvalue: 1 } };
  const prepared = await pine.executePineRequest(request);
  const inputs = Object.fromEntries(Object.entries(overrides).map(([title, value]) => {
    const definition = prepared.inputDefinitions.find(item => item.title === title || item.name === title);
    assert.ok(definition, "Prepare must expose " + title); return [definition.id, value];
  }));
  return { request: { ...request, action: "run", inputs }, inputs };
}

test("prepared custom input IDs apply non-default arrow min/max/offset to worker and drawing", async () => {
  const source = program('lo=input.int(7,"Minimum")\nhi=input.int(42,"Maximum")\nshift=input.int(0,"Shift")\n' + call("bar_index==1?2:bar_index==2?-1:0", ",minheight=lo,maxheight=hi,offset=shift"));
  const snapshot = bars.slice(0, 4), { request, inputs } = await preparedArrowInputs(source, snapshot, { Minimum: 2, Maximum: 28, Shift: -2 });
  assert.equal(Object.keys(inputs).length, 3);
  const result = await pine.executePineRequest(request), plot = result.plots[0];
  assert.deepEqual(result.inputs, inputs);
  assert.equal(plot.options.minheight, 2); assert.equal(plot.options.maxheight, 28); assert.equal(plot.options.offset, -2);
  assert.deepEqual(plot.points.filter(p => p.options.height !== undefined).map(p => p.options.height), [28, 28]);
  const adapted = pine.adaptPineChartResult(result, snapshot), state = harness(snapshot, -2, 1), installed = pine.installPineChartPlots(state.chart, adapted.plots);
  assert.deepEqual(adapted.plots[0].visual.arrow, { minHeight: 2, maxHeight: 28, maxMagnitude: 2 });
  const target = draw(installed); assert.deepEqual(target.paths.map(height), [28, 14]);
  assert.deepEqual(target.paths.map(p => (bounds(p).minX + bounds(p).maxX) / 2), [state.x(-1), state.x(0)]);
  installed.dispose();
});

test("persistent genuine live arrows preserve input options and signed tails through rollback confirmation and next-bar append", async () => {
  const candle = (index, close) => ({ time: 1_700_000_040 + index * 60, open: close - 1, high: close + 2, low: close - 2, close, volume: 10 });
  const snapshot = [40, 45, 55, 60].map((close, i) => candle(i, close));
  const source = program('lo=input.int(5,"Minimum")\nhi=input.int(100,"Maximum")\nshift=input.int(0,"Shift")\nvar int ordinary=0\nvarip int ticks=0\nordinary+=1\nticks+=1\n' +
    call("close-50", ",minheight=lo,maxheight=hi,offset=shift,show_last=1,colorup=#00ff00,colordown=#ff0000", "Signal") + '\n' +
    call("ordinary", ",minheight=lo,maxheight=hi,offset=shift", "Rollback") + '\n' +
    call("ticks", ",minheight=lo,maxheight=hi,offset=shift", "Ticks"));
  const { request, inputs } = await preparedArrowInputs(source, snapshot, { Minimum: 6, Maximum: 36, Shift: 2 });
  const sessionId = "independent-arrows83-live";
  const executor = pine.createPineLiveExecutor();
  const start = { protocol: "pine-live-v1", sessionId, sequence: 0, action: "start", request: { ...request, id: sessionId + ":0", mode: "live" } };
  try {
    const initial = await executor.execute(start);
    assert.deepEqual(initial.plots.find(p => p.name === "Signal").points.map(p => p.value), [-10, -5, 5, 10]);
    const historical = Object.fromEntries(initial.plots.map(p => [p.name, structuredClone(p.points)]));
    let confirmedHistory;
    const updates = [
      [4, 80, false, 30, 30, 36],
      [4, 45, false, -5, 10, 18],
      [4, 50, false, 0, 10, null],
      [4, 40, true, -10, 10, 36],
      [5, 60, false, 10, 10, 36],
      [5, 55, true, 5, 10, 18],
    ];
    for (const [index, row] of updates.entries()) {
      const [barIndex, closeValue, confirmed, value, maxMagnitude, paintedHeight] = row, sequence = index + 1;
      const currentBars = barIndex === 4 ? [...snapshot, candle(4, closeValue)] : [...snapshot, candle(4, 40), candle(5, closeValue)];
      const result = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence, action: "update", bar: candle(barIndex, closeValue), confirmed });
      assert.deepEqual(result.inputs, inputs);
      for (const plot of result.plots) {
        assert.equal(plot.style, "arrow"); assert.equal(plot.options.style, "arrow");
        assert.equal(plot.options.minheight, 6); assert.equal(plot.options.maxheight, 36); assert.equal(plot.options.offset, 2);
        assert.equal(plot.points.length, barIndex + 1);
        assert.deepEqual(plot.points.slice(0, 4), historical[plot.name]);
        if (confirmedHistory) assert.deepEqual(plot.points.slice(0, 5), confirmedHistory[plot.name]);
        for (const point of plot.points.filter(p => typeof p.value === "number" && p.value !== 0)) assert.equal(point.options.height, 36);
      }
      const signal = result.plots.find(p => p.name === "Signal");
      assert.equal(signal.points.at(-1).value, value);
      assert.equal(result.plots.find(p => p.name === "Rollback").points.at(-1).value, barIndex + 1, "Ordinary variables rollback on provisional ticks");
      assert.equal(result.plots.find(p => p.name === "Ticks").points.at(-1).value, 4 + sequence, "varip retains received tick increments");
      if (value) {
        assert.equal(signal.points.at(-1).options.color, value > 0 ? "#00ff00" : "#ff0000");
        assert.equal(signal.points.at(-1).options.shape, value > 0 ? "shape_arrow_up" : "shape_arrow_down");
      }
      const adapted = pine.adaptPineChartResult(result, currentBars);
      const visual = adapted.plots.find(p => p.name === "Signal");
      assert.equal(visual.visual.arrow.maxMagnitude, maxMagnitude, "Rolled-back provisional outlier cannot persist in normalization");
      const state = harness(currentBars, barIndex + 2, barIndex + 2), installed = pine.installPineChartPlots(state.chart, [visual]);
      assert.deepEqual(draw(installed).paths.map(height), paintedHeight === null ? [] : [paintedHeight]);
      installed.dispose();
      if (barIndex === 4 && confirmed) confirmedHistory = Object.fromEntries(result.plots.map(p => [p.name, structuredClone(p.points)]));
    }
  } finally { executor.dispose(); }
});
