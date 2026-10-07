import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const bundle = buildSync({ bundle: true, format: "esm", platform: "browser", write: false, logLevel: "silent", stdin: {
  contents: 'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineProtocol.ts"; export * from "./frontend/src/lib/pinePacked.ts"; export { Indicator, PineTS } from "pinets";',
  loader: "ts", resolveDir: fileURLToPath(new URL("../..", import.meta.url)), sourcefile: "pine-levels-oracles.ts",
} }).outputFiles[0].text;
const pine = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const bars = JSON.parse(readFileSync(new URL("../../e2e/pine-visuals.bars.json", import.meta.url)));
const context = { symbol: "TEST", timeframe: "1", mintick: 0.01, pointvalue: 1 };
const program = (body) => '//@version=6\nindicator("Native levels",overlay=false)\n' + body;
const request = (source, snapshot = bars, inputs = {}) => ({ id: "levels-oracle", action: "run", source, bars: snapshot, inputs, context });
const normalize = (options = {}) => Object.fromEntries(Object.entries(options).filter(([key, value]) => !key.startsWith("_") && value !== undefined).map(([key, value]) => [key, value == null || typeof value === "number" && !Number.isFinite(value) ? null : value]));
async function native(input) {
  try { return await pine.executePineRequest(input); }
  catch (cause) { throw Object.assign(new Error(cause.message), { code: cause.code }); }
}
// The oracle uses the pinned engine directly, with no EdgeLab worker wrapper,
// packed encoder, response validator, or rendering helper.
async function raw(source, snapshot = bars, inputs = {}) {
  const candles = snapshot.map((bar) => ({ openTime: bar.time * 1000, closeTime: (bar.time + 60) * 1000, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume }));
  const engine = new pine.PineTS(candles, "TEST", "1", snapshot.length);
  engine.setTimezone("UTC"); engine.setMaxLoops(10_000);
  return engine.run(new pine.Indicator(source, inputs));
}
function compare(plot, oracle, snapshot) {
  assert.equal(plot.name, oracle.title);
  assert.equal(plot.style, "hline");
  assert.deepEqual(plot.options, normalize(oracle.options));
  assert.equal(plot.points.length, snapshot.length);
  for (let index = 0; index < snapshot.length; index++) {
    const expected = oracle.data[index];
    const actual = pine.getPackedPinePlot(plot) ? pine.pointAtBar(plot, index) : plot.points[index];
    assert.deepEqual(actual, { time: snapshot[index].time, value: typeof expected.value === "number" && Number.isNaN(expected.value) ? null : expected.value, options: normalize(expected.options) });
  }
}

test("pinned hline positional/named inputs preserve every style and declared qualifier", async () => {
  for (const named of [false, true]) {
    const lines = ["solid", "dashed", "dotted"].map((style, index) => named
      ? 'hline(price=p+' + index + ',title="' + style + '",color=#ff000080,linestyle=hline.style_' + style + ',linewidth=' + (index + 1) + ',editable=false,display=display.all)'
      : 'hline(p+' + index + ',"' + style + '",#ff000080,hline.style_' + style + ',' + (index + 1) + ',false,display.all)');
    const source = program('p=input.float(107.5,"Level")\n' + lines.join("\n"));
    for (const inputs of [{}, { in_0: 0 }, { in_0: 121.25 }]) {
      const oracle = await raw(source, bars, inputs), result = await native(request(source, bars, inputs));
      assert.equal(result.source, source);
      assert.equal(result.audit.engineVersion, "0.11.0");
      assert.equal(result.plots.length, 3);
      for (const [index, plot] of result.plots.entries()) {
        const expected = oracle.plots[plot.id];
        assert.ok(expected); compare(plot, expected, bars);
        assert.equal(plot.options.linestyle, ["solid", "dashed", "dotted"][index]);
        assert.equal(plot.options.linewidth, index + 1);
        assert.equal(plot.options.editable, false);
        assert.equal(plot.options.display, "all");
        assert.equal(plot.points[0].value, (inputs.in_0 ?? 107.5) + index);
      }
    }
  }
});

test("native default zero na transparent and hidden levels retain raw values and fill identities", async () => {
  const source = program('hline(0,"Zero")\nhline(na,"Missing",color=#ff0000)\nhline(2000000000,"Na color",color=na)\nhline(1000000000,"Transparent",color=#ff000000)\na=hline(110,"Hidden upper",display=display.none)\nb=hline(90,"Hidden lower",display=display.none)\nfill(a,b,color=#ff000080,title="Hidden masks")');
  const oracle = await raw(source), result = await native(request(source));
  for (const plot of result.plots.filter((entry) => entry.style === "hline")) compare(plot, oracle.plots[plot.id], bars);
  assert.equal(result.plots.find((plot) => plot.name === "Zero").points[0].value, 0);
  assert.equal(Object.hasOwn(result.plots.find((plot) => plot.name === "Zero").options, "color"), false, "Omitted default color cannot collapse into explicit na");
  assert.equal(result.plots.find((plot) => plot.name === "Na color").options.color, null);
  assert.ok(result.plots.find((plot) => plot.name === "Missing").points.every((point) => point.value === null));
  assert.equal(result.plots.find((plot) => plot.name === "Transparent").options.color, "#ff000000");
  const fill = result.plots.find((plot) => plot.style === "fill");
  for (const key of ["plot1", "plot2"]) {
    assert.equal(fill.options[key], Object.values(oracle.plots).find((plot) => plot.options.style === "fill").options[key]);
    assert.equal(result.plots.find((plot) => plot.id === fill.options[key]).style, "hline");
    assert.equal(result.plots.find((plot) => plot.id === fill.options[key]).options.display, "none");
  }
});

test("20k native hline history stays exact packed lazy and owned across transfer/re-encode", async () => {
  const snapshot = Array.from({ length: 20_000 }, (_, index) => ({ ...bars[0], time: bars[0].time + index * 60 }));
  const source = program('hline(0,"Zero",#ff0000,hline.style_solid,1,false,display.all)\nhline(110,"Upper",#00ff00,hline.style_dashed,2,true,display.all)\nhline(90,"Lower",#0000ff,hline.style_dotted,3,false,display.none)');
  const input = request(source, snapshot), oracle = await raw(source, snapshot), result = await native(input);
  for (const plot of result.plots) {
    compare(plot, oracle.plots[plot.id], snapshot);
    const backing = pine.getPackedPinePlot(plot);
    assert.ok(backing); assert.equal(Array.isArray(plot.points), false);
    assert.equal(Object.hasOwn(plot.points, "0"), false);
    assert.equal(backing.values.length, 20_000); assert.equal(backing.kinds.length, 20_000);
    assert.deepEqual(backing.numericOptions, [], "Constant level qualifiers must not allocate numeric series lanes");
    for (let index = 0; index < snapshot.length; index++) { assert.equal(backing.values[index], oracle.plots[plot.id].data[index].value); assert.equal(backing.kinds[index], 4); }
  }
  const wire = pine.toPineWireResponse(input.id, result, snapshot);
  assert.equal(wire.encoding, "pine-packed-v1");
  assert.equal(wire.buffers.length, 9);
  assert.equal(wire.buffers.reduce((total, buffer) => total + buffer.byteLength, 0), 660_000);
  const transferred = structuredClone(wire, { transfer: wire.buffers });
  assert.ok(wire.buffers.every((buffer) => buffer.byteLength === 0));
  const received = pine.validatePineResponse(transferred, pine.validatePineRequest(input));
  for (const plot of received.plots) {
    const backing = pine.getPackedPinePlot(plot);
    assert.ok(transferred.buffers.includes(backing.values.buffer));
    assert.ok(transferred.buffers.includes(backing.kinds.buffer));
    assert.ok(transferred.buffers.includes(backing.optionIndices.buffer));
    assert.equal(pine.pointAtBar(plot, 19_999).time, snapshot[19_999].time);
  }
  const forwarded = pine.toPineWireResponse(input.id, received, snapshot);
  assert.ok(forwarded.buffers.every((buffer) => transferred.buffers.includes(buffer)));
  const again = pine.validatePineResponse(structuredClone(forwarded), pine.validatePineRequest(input));
  assert.equal(pine.pointAtBar(again.plots[0], 19_999).value, 0);
  assert.equal(again.source, source);
});
