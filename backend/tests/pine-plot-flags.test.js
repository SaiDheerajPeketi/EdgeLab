import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

const bundle = (await build({ plugins: [createPineEnginePlugin()], bundle: true, format: "esm", platform: "browser", write: false, logLevel: "silent", stdin: {
  contents: 'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pinePacked.ts"; export { Indicator, PineTS } from "pinets";',
  loader: "ts", resolveDir: fileURLToPath(new URL("../..", import.meta.url)), sourcefile: "pine-plot-flags-oracle.ts",
} })).outputFiles[0].text;
const pine = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const bars = Array.from({ length: 8 }, (_, index) => ({ time: 1_700_000_040 + index * 60, open: 100 + index, high: 102 + index, low: 98 + index, close: 101 + index, volume: 100 }));
const context = { symbol: "TEST", timeframe: "1", mintick: .01, pointvalue: 1 };
const program = (body, version = 6, overlay = false) => `//@version=${version}\nindicator("Plot flags",overlay=${overlay})\n${body}`;
const request = (source, inputs = {}, snapshot = bars) => ({ id: "plot-flags", action: "run", source, bars: snapshot, inputs, context });
const native = (source, inputs = {}, snapshot = bars) => pine.executePineRequest(request(source, inputs, snapshot));
const normalize = (options) => Object.fromEntries(Object.entries(options ?? {}).filter(([key]) => !key.startsWith("_")).map(([key, value]) => [key, value === undefined || typeof value === "number" && !Number.isFinite(value) ? null : value]));
// Independent engine oracle uses named options, bypassing both the worker's
// compatibility wrapper and the pinned positional join type typo.
async function raw(source, inputs = {}, snapshot = bars) {
  const candles = snapshot.map((bar) => ({ openTime: bar.time * 1000, closeTime: (bar.time + 60) * 1000, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume }));
  const engine = new pine.PineTS(candles, "TEST", "1", snapshot.length);
  engine.setTimezone("UTC"); engine.setMaxLoops(10_000);
  return engine.run(new pine.Indicator(source, inputs));
}
function compare(result, oracle, snapshot = bars) {
  assert.equal(result.plots.length, Object.values(oracle.plots).filter((plot) => plot.data?.length && !["label", "drawing_line", "drawing_box", "linefill", "drawing_polyline", "table"].includes(plot.options?.style)).length);
  for (const plot of result.plots) {
    const expected = oracle.plots[plot.id]; assert.ok(expected, "Native callsite identities match the independent engine");
    assert.deepEqual(plot.options, normalize(expected.options));
    for (let index = 0; index < snapshot.length; index++) {
      const expectedPoint = expected.data[index];
      const point = pine.getPackedPinePlot(plot) ? pine.pointAtBar(plot, index) : plot.points[index];
      assert.deepEqual(point, { time: snapshot[index].time, value: Number.isNaN(expectedPoint.value) ? null : expectedPoint.value, options: normalize(expectedPoint.options) });
    }
  }
}
const positional = 'plot(close,"P",#ff000080,2,plot.style_line,false,0,-3,true,false,2,display.none,format.price,4,true)';
const named = 'plot(series=close,title="P",color=#ff000080,linewidth=2,style=plot.style_line,trackprice=false,histbase=0,offset=-3,join=true,editable=false,show_last=2,display=display.none,format=format.price,precision=4,force_overlay=true)';

test("v5/v6 all fifteen positional plot slots match independent named engine output", async () => {
  for (const version of [5, 6]) {
    const source = program(positional, version), result = await native(source);
    compare(result, await raw(program(named, version)));
    assert.equal(result.source, source);
    assert.equal(result.plots[0].options.display, "none");
    assert.equal(result.plots[0].options.join, true);
    assert.equal(result.plots[0].options.show_last, 2);
    assert.equal(result.plots[0].options.editable, false);
    assert.equal(result.plots[0].overlay, true);
  }
});

test("mixed options and integer input overrides preserve offset and following false flags", async () => {
  const inputs = 'shift=input.int(-2,"Shift")\nc=input.color(#ff000080,"Tint")\nflag=input.bool(false,"Editable")\n';
  const mixed = 'plot(close,"P",c,2,plot.style_line,false,0,shift,false,editable=flag,show_last=3,display=display.none,precision=2)';
  const equivalent = 'plot(close,title="P",color=c,linewidth=2,style=plot.style_line,trackprice=false,histbase=0,offset=shift,join=false,editable=flag,show_last=3,display=display.none,precision=2)';
  for (const override of [{}, { in_0: 3, in_1: "#00ff0040", in_2: true }]) {
    const source = program(inputs + mixed), result = await native(source, override);
    compare(result, await raw(program(inputs + equivalent), override));
    assert.equal(result.plots[0].options.offset, override.in_0 ?? -2);
    assert.ok(result.plots[0].points.every((point) => point.options.offset === (override.in_0 ?? -2)));
    assert.equal(result.source, source);
  }
});

test("plot defaults, dynamic color, duplicate titles and returned fill references remain intact", async () => {
  const body = 'plot(close)\na=plot(close,"Same",color=bar_index%2==0?na:#ff000080)\nb=plot(close+1,"Same")\nfill(a,b,color=#0000ff80,title="Mask")';
  const source = program(body), result = await native(source); compare(result, await raw(source));
  const fill = result.plots.find((plot) => plot.style === "fill");
  assert.notEqual(fill.options.plot1, fill.options.plot2);
  assert.ok(result.plots.some((plot) => plot.id === fill.options.plot1));
  assert.ok(result.plots.some((plot) => plot.id === fill.options.plot2));
  assert.equal(Object.hasOwn(result.plots[0].options, "offset"), false);
  assert.equal(result.plots[0].points[0].options.color, "#2962ff");
});

test("false force_overlay preserves declaration placement for indicators and strategies", async () => {
  for (const declaration of ["indicator", "strategy"]) for (const overlay of [false, true]) for (const forced of [false, true]) {
    const source = `//@version=6\n${declaration}("Placement",overlay=${overlay})\nflag=input.bool(${forced},"Force")\nplot(close,"P",offset=-1,force_overlay=flag)`;
    const result = await native(source);
    assert.equal(result.overlay, overlay);
    assert.equal(result.plots[0].overlay, overlay || forced);
    assert.equal(result.plots[0].options.overlay, overlay || forced);
    assert.equal(result.plots[0].options.force_overlay, forced);
  }
});

test("invalid scalar types and changing offsets fail rather than coerce or disappear", async () => {
  for (const option of ['offset=na', 'offset=1.5', 'offset=bar_index', 'offset="2"', 'join=1', 'trackprice=na', 'editable=1', 'force_overlay=1', 'show_last=-1', 'show_last=1.5', 'linewidth=0', 'precision=-1', 'histbase=na', 'display=1', 'title=1', 'color=1']) {
    await assert.rejects(native(program('plot(close,' + option + ')')), (error) => { assert.equal(error.code, "UNSUPPORTED_PLOT_OPTION", option); return true; });
  }
  await assert.rejects(native(program('plot(close,"P",#ff0000,2,plot.style_line,false,0,2,1,false,2,display.none)')), (error) => error.code === "UNSUPPORTED_PLOT_OPTION");
  for (const call of ['plot(close,linestyle="dashed")', 'plot(close,"P",#ff0000,2,plot.style_line,false,0,2,false,false,2,display.all,format.price,4,false,plot.linestyle_dashed,true)']) {
    await assert.rejects(native(program(call)), (error) => error.code === "UNSUPPORTED_PLOT_OPTION");
  }
});

test("packed offsets retain exact source points and scoped repair leaves a fresh raw engine untouched", async () => {
  const snapshot = Array.from({ length: 5_000 }, (_, index) => ({ ...bars[index % bars.length], time: bars[0].time + index * 60 }));
  const source = program(positional);
  const result = await native(source, {}, snapshot);
  const backing = pine.getPackedPinePlot(result.plots[0]); assert.ok(backing);
  assert.equal(Array.isArray(result.plots[0].points), false);
  assert.deepEqual(backing.numericOptions, []);
  for (const index of [0, 2_499, 4_999]) {
    const point = pine.pointAtBar(result.plots[0], index);
    assert.equal(point.time, snapshot[index].time); assert.equal(point.value, snapshot[index].close); assert.equal(point.options.offset, -3);
  }
  const untouched = Object.values((await raw(source)).plots).find((plot) => plot.data?.length);
  assert.equal(Object.hasOwn(untouched.options, "join"), false);
  assert.equal(Object.hasOwn(untouched.options, "display"), false, "Repair is selected-context only; the pinned raw parser is unchanged");
  assert.equal(result.source, source);
});

test("plot normalization preserves the 64-channel capacity boundary", async () => {
  const channels = Array.from({ length: 64 }, (_, index) => `plot(close,"P${index}",offset=1,join=false,editable=false)`);
  assert.equal((await native(program(channels.join("\n")))).plots.length, 64);
  await assert.rejects(native(program([...channels, 'plot(close,"Overflow")'].join("\n"))), (error) => error.code === "PLOT_LIMIT");
});
