import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

const bundle = (await build({ plugins: [createPineEnginePlugin()], bundle: true, format: "esm", platform: "browser", write: false, logLevel: "silent", stdin: {
  contents: 'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineChartAdapter.ts"; export * from "./frontend/src/lib/pinePacked.ts"; export * from "./frontend/src/lib/pineProtocol.ts"; export { Indicator, PineTS } from "pinets";',
  loader: "ts", resolveDir: fileURLToPath(new URL("../..", import.meta.url)), sourcefile: "pine-barcolor-oracle.ts",
} })).outputFiles[0].text;
const pine = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const bars = Array.from({ length: 8 }, (_, index) => ({ time: 1_700_000_040 + index * 60, open: 100 + index, high: 102 + index, low: 98 + index, close: 101 + index, volume: 100 }));
const context = { symbol: "TEST", timeframe: "1", mintick: .01, pointvalue: 1 };
const program = (body, version = 6, overlay = false) => `//@version=${version}\nindicator("Bar color",overlay=${overlay})\n${body}`;
const request = (source, inputs = {}, snapshot = bars) => ({ id: "barcolor-proof", action: "run", source, bars: snapshot, inputs, context });
const native = (source, inputs = {}, snapshot = bars) => pine.executePineRequest(request(source, inputs, snapshot));
const normalize = (options) => Object.fromEntries(Object.entries(options ?? {}).filter(([key]) => !key.startsWith("_")).map(([key, value]) => [key, value === undefined || typeof value === "number" && !Number.isFinite(value) ? null : value]));
// Separate pinned engine named-call oracle, without the selected-context repair.
async function raw(source, inputs = {}, snapshot = bars) {
  const data = snapshot.map(bar => ({ openTime: bar.time * 1000, closeTime: (bar.time + 60) * 1000, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume }));
  const engine = new pine.PineTS(data, "TEST", "1", snapshot.length);
  engine.setTimezone("UTC"); engine.setMaxLoops(10_000);
  return engine.run(new pine.Indicator(source, inputs));
}
const at = (plot, index) => pine.getPackedPinePlot(plot) ? pine.pointAtBar(plot, index) : plot.points[index];
const projection = (result, snapshot = bars, timeline = snapshot) => {
  const adapted = pine.adaptPineChartResult(result, snapshot);
  return { adapted, colors: pine.projectPineBarColors(adapted.plots, timeline) };
};

test("six positional and mixed barcolor flags match named raw v5/v6 options and custom inputs", async () => {
  const prelude = 'shift=input.int(-2,"Shift")\nc=input.color(#ff000080,"Tint")\ne=input.bool(false,"Editable")\n';
  const named = 'barcolor(color=bar_index%3==0?na:c,offset=shift,editable=e,show_last=3,title="Tint",display=display.none)';
  const calls = ['barcolor(bar_index%3==0?na:c,shift,e,3,"Tint",display.none)', 'barcolor(bar_index%3==0?na:c,shift,editable=e,show_last=3,title="Tint",display=display.none)'];
  for (const version of [5, 6]) for (const inputs of [{}, { in_0: 2, in_1: "#0000ff00", in_2: true }]) {
    const expected = Object.values((await raw(program(prelude + named, version), inputs)).plots)[0];
    for (const call of calls) {
      const source = program(prelude + call, version), result = await native(source, inputs), plot = result.plots[0];
      assert.equal(result.source, source); assert.equal(result.inputs.in_0, inputs.in_0 ?? -2); assert.equal(result.inputs.in_1, inputs.in_1 ?? "#FF000080"); assert.equal(result.inputs.in_2, inputs.in_2 ?? false);
      assert.equal(plot.overlay, true); assert.equal(plot.name, "Tint");
      assert.deepEqual(plot.options, { ...normalize(expected.options), overlay: true });
      for (let index = 0; index < bars.length; index++) assert.deepEqual(at(plot, index), { time: bars[index].time, value: Number.isNaN(expected.data[index].value) ? null : expected.data[index].value ?? null, options: normalize(expected.data[index].options) });
      assert.deepEqual(projection(result).adapted.plots, []);
    }
  }
});

test("numeric duplicate and unnamed titles retain invocation order and independent channel identity", async () => {
  const source = program('plot(close,"edgelab-barcolor:0")\nbarcolor(#ff0000)\nbarcolor(#0000ff)\nbarcolor(#00ff00,title="Same")\nplot(close,"Sameedgelab-barcolor:3")\nbarcolor(#ffff00,title="Same")\nbarcolor(#ff0000,title="10")\nbarcolor(#0000ff,title="2")');
  const result = await native(source), colors = result.plots.filter(plot => plot.style === "barcolor");
  assert.equal(new Set(result.plots.map(plot => plot.id)).size, 8);
  assert.deepEqual(colors.map(plot => plot.name), ["Bar color 1", "Bar color 2", "Same", "Same", "10", "2"]);
  for (const [index, plot] of colors.entries()) {
    assert.equal(plot.points.length, bars.length);
    assert.ok(plot.points.every(point => point.value === true && point.options.color === ["#ff0000", "#0000ff", "#00ff00", "#ffff00", "#ff0000", "#0000ff"][index]));
  }
  const p = projection(result).colors;
  assert.equal(p.colorAt(0), "rgba(0,0,255,1)");
  const first = await native(program('barcolor(#ff0000)\nbarcolor(na)'));
  assert.equal(projection(first).colors.colorAt(0), "rgba(255,0,0,1)", "later na never erases an earlier color");
});

test("barcolor descriptors expose controls without hosts headers scale or candle mutation", async () => {
  const source = program('barcolor(bar_index%3==0?na:bar_index%3==1?#ff000000:#ff000080,title="Bodies")');
  const snapshot = structuredClone(bars), result = await native(source), { adapted, colors } = projection(result);
  assert.equal(adapted.plots.length, 1); assert.equal(adapted.adapterWarnings.length, 0);
  assert.equal(adapted.plots[0].kind, "barcolor"); assert.equal(adapted.plots[0].overlay, true);
  assert.deepEqual(adapted.plots[0].segments, []); assert.equal(pine.latestPineChartPoint(adapted.plots[0]), null);
  const chart = new Proxy({}, { get() { throw new Error("Bar colors must not touch a chart series"); } });
  const installed = pine.installPineChartPlots(chart, adapted.plots);
  assert.deepEqual(installed.series, []); assert.equal(installed.primitive, undefined); installed.dispose(); installed.dispose();
  assert.equal(colors.colorAt(0), undefined); assert.equal(colors.colorAt(1), "rgba(255,0,0,0)"); assert.equal(colors.colorAt(2), "rgba(255,0,0,0.5019607843137255)");
  assert.equal(colors.colorAt(-1), undefined); assert.equal(colors.colorAt(.5), undefined); assert.equal(colors.colorAt(8), undefined);
  assert.deepEqual(bars, snapshot); assert.equal(result.source, source);
});

test("source show_last precedes positive and negative shifts on sparse actual primary slots", async () => {
  const snapshot = [bars[0], bars[2], bars[5]], timeline = bars;
  for (const offset of [-2, 2]) {
    const result = await native(program('barcolor(#ff0000,offset=' + offset + ',show_last=2)'), {}, snapshot);
    const { colors } = projection(result, snapshot, timeline);
    for (let index = 0; index < timeline.length; index++) assert.equal(colors.colorAt(index), [2 + offset, 5 + offset].includes(index) ? "rgba(255,0,0,1)" : undefined);
    // Missing source samples stay absent instead of inheriting adjacent source data.
    const source = result.plots[0]; source.points = source.points.filter(point => point.time !== bars[2].time);
    assert.equal(projection(result, snapshot, timeline).colors.colorAt(2 + offset), undefined);
  }
  const recent = await native(program('barcolor(#0000ff,show_last=0)'));
  assert.ok(bars.every((_, index) => projection(recent).colors.colorAt(index) === undefined));
});

test("unsupported formats and crafted invalid metadata warn rather than paint fallback colors", async () => {
  const result = await native(program('barcolor(bar_index%3==0?"bad":bar_index%3==1?" #ff000080 ":na)'));
  const { adapted, colors } = projection(result);
  assert.ok(adapted.adapterWarnings.some(message => /color formats/.test(message)));
  assert.equal(colors.colorAt(0), undefined); assert.equal(colors.colorAt(1), "rgba(255,0,0,0.5019607843137255)"); assert.equal(colors.colorAt(2), undefined);
  for (const [key, value] of [["offset", 1.5], ["show_last", -1]]) {
    const altered = structuredClone(result); altered.plots[0].options[key] = value;
    const adapted = projection(altered).adapted;
    assert.deepEqual(adapted.plots, []); assert.ok(adapted.adapterWarnings.some(message => message.includes(key === "offset" ? "offset" : "show_last")));
  }
});

test("invalid scalar constant flags and conditional calls reject with a specific diagnostic", async () => {
  for (const body of ['barcolor(1)', 'barcolor(#ff0000,0,true,3,"T",display.all,true)', 'barcolor(#ff0000,force_overlay=true)', 'barcolor(#ff0000,offset=na)', 'barcolor(#ff0000,offset=1.5)', 'barcolor(#ff0000,offset=bar_index)', 'barcolor(#ff0000,editable=1)', 'barcolor(#ff0000,show_last=-1)', 'barcolor(#ff0000,title=1)', 'barcolor(#ff0000,display=display.pane)', 'barcolor(#ff0000,show_last=bar_index)', 'barcolor(#ff0000,editable=bar_index%2==0)', 'if bar_index>0\n    barcolor(#ff0000)']) {
    await assert.rejects(native(program(body)), error => { assert.equal(error.code, "UNSUPPORTED_BARCOLOR_OPTION", body); return true; });
  }
});

test("scoped repair leaves fresh raw engine parsing and prototypes untouched", async () => {
  const source = program('barcolor(#ff0000,-2,false,3,"Positional",display.none)');
  const project = result => Object.values(result.plots).map(plot => ({ title: plot.title, options: normalize(plot.options), points: plot.data.map(point => ({ value: point.value, options: normalize(point.options) })) }));
  const before = project(await raw(source)); await native(source); const after = project(await raw(source));
  assert.deepEqual(after, before); assert.equal(after[0].options.offset, undefined);
  const fresh = await native(program('barcolor(#00ff00)'));
  assert.equal(fresh.plots[0].name, "Bar color 1"); assert.equal(fresh.plots[0].points.length, bars.length);
});

test("20k packed barcolors stay zero-copy through transfer and query without point projection", async () => {
  const snapshot = Array.from({ length: 20_000 }, (_, index) => ({ ...bars[0], time: bars[0].time + index * 60 }));
  const source = program('barcolor(bar_index%3==0?na:bar_index%3==1?#ff000000:#0000ff,offset=2,show_last=50)');
  const req = request(source, {}, snapshot), result = await native(source, {}, snapshot), plot = result.plots[0], backing = pine.getPackedPinePlot(plot);
  assert.ok(backing); assert.equal(Array.isArray(plot.points), false);
  const wire = pine.toPineWireResponse(req.id, result, snapshot);
  assert.equal(wire.buffers.length, 3); assert.equal(wire.buffers.reduce((n, b) => n + b.byteLength, 0), 220_000);
  const moved = structuredClone(wire, { transfer: wire.buffers }); assert.ok(wire.buffers.every(b => b.byteLength === 0));
  const decoded = pine.validatePineResponse(moved, pine.validatePineRequest(req));
  const preserved = pine.getPackedPinePlot(decoded.plots[0]); assert.ok(moved.buffers.includes(preserved.values.buffer));
  const lazyPoints = decoded.plots[0].points;
  let pointsReads = 0;
  Object.defineProperty(decoded.plots[0], "points", { get() { pointsReads++; return lazyPoints; } });
  const { adapted, colors } = projection(decoded, snapshot);
  assert.equal(adapted.plots[0].visual.source, decoded.plots[0]);
  const readsAfterConstruction = pointsReads;
  for (let index = 0; index < snapshot.length; index++) {
    const sourceIndex = index - 2;
    assert.equal(colors.colorAt(index), sourceIndex < 19_950 || sourceIndex % 3 === 0 ? undefined : sourceIndex % 3 === 1 ? "rgba(255,0,0,0)" : "rgba(0,0,255,1)");
  }
  assert.equal(pointsReads, readsAfterConstruction, "Every queried slot uses packed backing without reading the point collection");
  const encoded = pine.toPineWireResponse(req.id, decoded, snapshot);
  assert.deepEqual(encoded.buffers, moved.buffers); assert.equal(decoded.source, source);
});

test("barcolor retains 64-channel capacity and rejects the65th", async () => {
  const source = count => program(Array.from({ length: count }, (_, index) => 'barcolor(#ff000080,title="B' + index + '")').join("\n"));
  assert.equal((await native(source(64))).plots.length, 64);
  await assert.rejects(native(source(65)), error => error.code === "PLOT_LIMIT");
});


test("native CSS percentage and fractional colors project to primary-series-safe integer RGBA", async () => {
  const source = program('barcolor(bar_index%4==0?"rgba(100%,0%,0%,50%)":bar_index%4==1?"rgb(1.5,2.5,3.5)":bar_index%4==2?"rgba(0%,100%,0%,0%)":" #ff000080 ")');
  const result = await native(source), rawColors = result.plots[0].points.map(point => point.options.color);
  const tiny = await native(program('barcolor("rgba(255,0,0,0.00000001)")'));
  assert.equal(projection(tiny).colors.colorAt(0), "rgba(255,0,0,0.00000001)");
  const { colors, adapted } = projection(result);
  assert.deepEqual(adapted.adapterWarnings, []);
  for (let index = 0; index < bars.length; index++) assert.equal(colors.colorAt(index), ["rgba(255,0,0,0.5)", "rgba(2,3,4,1)", "rgba(0,255,0,0)", "rgba(255,0,0,0.5019607843137255)"][index % 4]);
  assert.deepEqual(result.plots[0].points.map(point => point.options.color), rawColors);
  assert.equal(result.source, source);
});
