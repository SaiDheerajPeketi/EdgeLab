import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const root = fileURLToPath(new URL("../..", import.meta.url));
const bundle = buildSync({
  bundle: true, format: "esm", platform: "browser", target: "es2020", write: false, logLevel: "silent",
  stdin: { contents: 'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineProtocol.ts"; export * from "./frontend/src/lib/pinePacked.ts"; export * from "./frontend/src/lib/pineChartAdapter.ts"; export { Indicator, PineTS } from "pinets";', loader: "ts", resolveDir: root, sourcefile: "pine-capacity-fixture.ts" },
}).outputFiles[0].text;
const pine = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
async function nativeRun(input) {
  try { return await pine.executePineRequest(input); }
  catch (cause) { throw Object.assign(new Error(cause.message), { code: cause.code }); }
}
const context = { symbol: "TEST", timeframe: "1", mintick: 0.01, pointvalue: 1 };
const bars = Array.from({ length: 512 }, (_, index) => {
  const close = 100 + Math.sin(index / 8) * 12;
  return { time: 1_700_000_040 + index * 60, open: close - Math.cos(index / 3) * 0.7, high: close + 1, low: close - 1, close, volume: 100 + index };
});
const originals = [
  ["supertrend", "f693c60a20960bbd156455744838dc97892f2a5662810770c7677a66e9b5705d"],
  ["chandelier_exit", "d505921fb4b9b7933b45a443cd3c13c255b30fa6c6216e7061844d3fb62eceda"],
  ["halftrend", "efa1915b4d0812d8126bd27c7667f9408e90aeed94988058b1b1edeaa23f4a3c"],
];
const originalSource = (name) => readFileSync(new URL(`../../frontend/public/catalog/pine/everget/0b164e1e4f2fb7b06524c6d0a26e6132228c9448/trailing_stops/${name}.pine`, import.meta.url), "utf8");
const request = (source, snapshot = bars) => ({ id: "capacity-fixture", action: "run", source, bars: snapshot, context });
const scalarOptions = (options = {}) => Object.fromEntries(Object.entries(options).filter(([key]) => !key.startsWith("_")).map(([key, value]) => [key, value == null || typeof value === "number" && !Number.isFinite(value) ? null : value]));

// This oracle executes PineTS directly. It never calls EdgeLab's result packer,
// response validator or chart adapter.
async function rawRun(source, snapshot = bars) {
  const candles = snapshot.map((bar) => ({ openTime: bar.time * 1000, closeTime: (bar.time + 60) * 1000, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume }));
  const engine = new pine.PineTS(candles, context.symbol, context.timeframe, candles.length);
  engine.setTimezone("UTC");
  engine.setMaxLoops(10_000);
  return engine.run(new pine.Indicator(source));
}

for (const [name, hash] of originals) test(`unmodified ${name} preserves nine raw-engine channels and every historical point`, async () => {
  const source = originalSource(name);
  assert.equal(createHash("sha256").update(source).digest("hex"), hash);
  const raw = await rawRun(source);
  const native = await nativeRun(request(source));
  assert.equal(native.source, source);
  assert.equal(native.audit.engineVersion, "0.11.0");
  const expected = Object.entries(raw.plots).filter(([id]) => !id.startsWith("__"));
  assert.equal(expected.length, 9);
  assert.deepEqual(native.plots.map((plot) => plot.id), expected.map(([id]) => id));
  for (const [id, rawPlot] of expected) {
    const plot = native.plots.find((entry) => entry.id === id);
    assert.ok(pine.getPackedPinePlot(plot), `${name} ${id} must exercise packed transport`);
    assert.equal(plot.name, rawPlot.title ?? id);
    assert.equal(plot.style, rawPlot.options?.style ?? "line");
    assert.deepEqual(plot.options, scalarOptions(rawPlot.options), `${name} ${id} declared options`);
    assert.deepEqual(rawPlot.data.map((_, index) => pine.pointAtBar(plot, index)), rawPlot.data.map((point) => ({ time: point.time / 1000, value: point.value == null || typeof point.value === "number" && !Number.isFinite(point.value) ? null : point.value, options: scalarOptions(point.options) })), `${name} ${id} historical values/options`);
  }
  const fills = native.plots.filter((plot) => plot.style === "fill");
  assert.equal(fills.length, 2);
  for (const fill of fills) {
    assert.ok(native.plots.some((plot) => plot.id === fill.options.plot1));
    assert.ok(native.plots.some((plot) => plot.id === fill.options.plot2));
    assert.ok(bars.every((_, index) => pine.pointAtBar(fill, index).value === null));
    assert.ok(bars.some((_, index) => typeof pine.pointAtBar(fill, index).options.color === "string"));
  }
  if (name !== "halftrend") {
    assert.equal(native.plots.find((plot) => plot.id === "#2").options.display, "none");
    assert.ok(fills.every((fill) => bars.some((_, index) => pine.pointAtBar(fill, index).options.color === null)));
  } else {
    assert.ok(bars.some((_, index) => typeof pine.pointAtBar(native.plots.find((plot) => plot.id === "Arrow Up"), index).value === "number"));
    assert.ok(bars.some((_, index) => typeof pine.pointAtBar(native.plots.find((plot) => plot.id === "Arrow Down"), index).value === "number"));
  }
});

const manySource = (count) => `//@version=6\nindicator("Capacity")\n${Array.from({ length: count }, (_, index) => `plot(close + ${index},"Channel ${index}")`).join("\n")}`;
const largeBars = (count) => Array.from({ length: count }, (_, index) => ({ time: 1_700_000_040 + index * 60, open: 100 + index / 100, high: 101 + index / 100, low: 99 + index / 100, close: 100 + index / 100, volume: 100 }));
const rejectsWire = (wire, input) => assert.throws(() => pine.validatePineResponse(wire, pine.validatePineRequest(input)), (error) => {
  assert.ok(["INVALID_MESSAGE", "RESULT_LIMIT", "PLOT_LIMIT", "POINT_LIMIT"].includes(error.code), `${error.code}: ${error.message}`);
  return true;
});

// Full-size execution is deliberately inspected as typed buffers. Calling a
// compatibility iterator or serializing all point objects would defeat this case.
test("64 native scalar channels retain 20,000 bars within packed transport and transfer ownership", async () => {
  const snapshot = largeBars(20_000), input = request(manySource(64), snapshot);
  const result = await nativeRun(input);
  assert.equal(result.plots.length, 64);
  const wire = pine.toPineWireResponse(input.id, result, snapshot);
  assert.equal(wire.encoding, "pine-packed-v1");
  assert.equal(wire.buffers.length, 64 * 3);
  assert.equal(new Set(wire.buffers).size, wire.buffers.length);
  assert.equal(wire.buffers.reduce((total, buffer) => total + buffer.byteLength, 0), 14_080_000);
  assert.ok(new TextEncoder().encode(JSON.stringify({ ...wire, buffers: [] })).length < 1_000_000);
  for (const [channel, plot] of result.plots.entries()) {
    const packed = pine.getPackedPinePlot(plot);
    assert.ok(packed, `Channel ${channel} must retain its packed backing`);
    assert.ok(packed.values instanceof Float64Array);
    assert.ok(packed.kinds instanceof Uint8Array);
    assert.ok(packed.optionIndices instanceof Uint16Array);
    assert.equal(packed.values.length, 20_000);
    assert.equal(packed.kinds.length, 20_000);
    for (let index = 0; index < snapshot.length; index++) {
      assert.equal(packed.values[index], snapshot[index].close + channel);
      assert.equal(packed.kinds[index], 4);
      assert.ok(packed.optionIndices[index] < packed.optionTable.length);
    }
    assert.deepEqual(pine.pointAtBar(plot, 19_999), { time: snapshot[19_999].time, value: snapshot[19_999].close + channel, options: { color: "#2962ff" } });
  }
  const transferred = structuredClone(wire, { transfer: wire.buffers });
  assert.ok(wire.buffers.every((buffer) => buffer.byteLength === 0));
  const received = pine.validatePineResponse(transferred, pine.validatePineRequest(input));
  for (const plot of received.plots) {
    const packed = pine.getPackedPinePlot(plot);
    assert.ok(transferred.buffers.includes(packed.values.buffer), "Receiver must own the transferred backing, not inflate/copy it");
    assert.ok(transferred.buffers.includes(packed.kinds.buffer));
    assert.ok(transferred.buffers.includes(packed.optionIndices.buffer));
  }
  assert.equal(pine.pointAtBar(received.plots[63], 19_999).value, snapshot[19_999].close + 63);
  await assert.rejects(nativeRun(request(manySource(65), snapshot.slice(0, 2))), (error) => error.code === "PLOT_LIMIT");
});

let wireFixture;
async function fixture() {
  wireFixture ??= (async () => {
    const input = request(manySource(1), largeBars(5000));
    const result = await nativeRun(input);
    return { input, wire: pine.toPineWireResponse(input.id, result, input.bars) };
  })();
  const value = await wireFixture;
  return { input: value.input, wire: structuredClone(value.wire) };
}

test("packed response rejects unsafe, aliased, malformed and unused buffers", async () => {
  const { input, wire } = await fixture();
  assert.equal(wire.encoding, "pine-packed-v1");
  const bad = (mutate) => { const copy = structuredClone(wire); mutate(copy); rejectsWire(copy, input); };
  bad((copy) => { copy.buffers.extra = "unsafe"; });
  bad((copy) => { Object.setPrototypeOf(copy.buffers, Object.create(Array.prototype)); });
  bad((copy) => { copy.buffers[0] = new Uint8Array(copy.buffers[0]); });
  bad((copy) => { copy.buffers[0] = new ArrayBuffer(copy.buffers[0].byteLength - 1); });
  bad((copy) => { copy.buffers[0] = new SharedArrayBuffer(copy.buffers[0].byteLength); });
  bad((copy) => { copy.buffers.push(new ArrayBuffer(1)); });
  bad((copy) => { copy.buffers[1] = copy.buffers[0]; });
  bad((copy) => { structuredClone(copy.buffers[0], { transfer: [copy.buffers[0]] }); });
  bad((copy) => { copy.result.plots[0].packed.values = copy.result.plots[0].packed.kinds; });
  bad((copy) => { copy.result.plots[0].packed.values = -1; });
  bad((copy) => { new Float64Array(copy.buffers[copy.result.plots[0].packed.values])[0] = Infinity; });
  bad((copy) => { new Uint8Array(copy.buffers[copy.result.plots[0].packed.kinds])[0] = 255; });
  if (new ArrayBuffer(1, { maxByteLength: 2 }).resizable) bad((copy) => { copy.buffers[0] = new ArrayBuffer(copy.buffers[0].byteLength, { maxByteLength: copy.buffers[0].byteLength + 8 }); });
});

test("packed response rejects invalid option references and dangling fill IDs", async () => {
  const { input, wire } = await fixture();
  const bad = (mutate) => { const copy = structuredClone(wire); mutate(copy); rejectsWire(copy, input); };
  bad((copy) => { new Uint16Array(copy.buffers[copy.result.plots[0].packed.optionIndices])[0] = 65535; });
  bad((copy) => { copy.result.plots[0].packed.optionTable[0] = { color: () => "red" }; });
  bad((copy) => { copy.result.plots[0].packed.optionTable[0] = { color: new Uint8Array([1]) }; });
  bad((copy) => { copy.result.plots[0].packed.optionTable[0] = JSON.parse('{"__proto__":"unsafe"}'); });
  bad((copy) => { const plot = copy.result.plots[0]; plot.style = "fill"; plot.options = { plot1: "missing", plot2: plot.id }; });
  bad((copy) => { copy.result.plots[0].packed.slots += 1; });
  bad((copy) => { copy.result.plots[0].packed.count += 1; });
});

test("metadata and structural guards reject oversized or recursively unsafe envelopes", async () => {
  const { input, wire } = await fixture();
  const oversized = structuredClone(wire);
  oversized.result.plots[0].packed.optionTable = Array.from({ length: 64 }, (_, index) => ({ color: "#2962ff", style: "x".repeat(4096), text: String(index) + "x".repeat(4094), location: "x".repeat(4096), size: "x".repeat(4096) }));
  assert.ok(new TextEncoder().encode(JSON.stringify({ ...oversized, buffers: [] })).length > 1_000_000);
  rejectsWire(oversized, input);
  const cycle = structuredClone(wire); cycle.result.plots[0].packed.optionTable[0].color = cycle.result.plots[0].packed.optionTable[0];
  rejectsWire(cycle, input);
  const deep = structuredClone(wire); deep.result.plots[0].packed.optionTable[0].color = Array.from({ length: 20 }).reduce((value) => ({ nested: value }), {});
  rejectsWire(deep, input);
  const nodes = structuredClone(wire); nodes.result.plots[0].packed.optionTable = Array.from({ length: 20_000 }, () => ({ color: null, text: null, style: null, size: null, linewidth: null }));
  assert.throws(() => pine.validatePineResponse(nodes, pine.validatePineRequest(input)), (error) => error.code === "RESULT_LIMIT" && /structural/.test(error.message));
});

test("packed byte budget admits 16 MB including metadata and rejects overflow from wire or engine", async () => {
  const snapshot = largeBars(20_000), input = request(manySource(64), snapshot);
  const result = await nativeRun(input);
  const wire = pine.toPineWireResponse(input.id, result, snapshot);
  const addOHLC = (plot) => {
    plot.style = "candle"; plot.packed.arity = 4;
    const values = new Float64Array(snapshot.length * 4);
    snapshot.forEach((bar, index) => values.set([bar.open, bar.high, bar.low, bar.close], index * 4));
    wire.buffers[plot.packed.values] = values.buffer;
    new Uint8Array(wire.buffers[plot.packed.kinds]).fill(5);
  };
  wire.result.plots.slice(0, 3).forEach(addOHLC);
  const bufferBytes = wire.buffers.reduce((total, buffer) => total + buffer.byteLength, 0);
  assert.equal(bufferBytes, 15_520_000);
  const table = Array.from({ length: 64 }, () => ({ text: "", textcolor: "", style: "", location: "" }));
  wire.result.plots[0].packed.optionTable = table;
  const metadataBytes = () => new TextEncoder().encode(JSON.stringify({ ...wire, buffers: [] })).length;
  let remaining = 16_000_000 - bufferBytes - metadataBytes();
  for (const options of table) for (const key of Object.keys(options)) { const bytes = Math.min(4096, remaining); options[key] = "x".repeat(bytes); remaining -= bytes; }
  assert.equal(remaining, 0);
  assert.equal(bufferBytes + metadataBytes(), 16_000_000);
  const admitted = pine.validatePineResponse(wire, pine.validatePineRequest(input));
  assert.deepEqual(pine.pointAtBar(admitted.plots[0], 19_999).value, [snapshot[19_999].open, snapshot[19_999].high, snapshot[19_999].low, snapshot[19_999].close]);
  const available = table.find((options) => Object.values(options).some((value) => value.length < 4096));
  available[Object.keys(available).find((key) => available[key].length < 4096)] += "x";
  assert.equal(bufferBytes + metadataBytes(), 16_000_001);
  assert.throws(() => pine.validatePineResponse(wire, pine.validatePineRequest(input)), (error) => error.code === "RESULT_LIMIT" && /16 MB/.test(error.message));
  const candlesSource = `//@version=6\nindicator("OHLC overflow")\n${Array.from({ length: 64 }, (_, index) => `plotcandle(open,high,low,close,"Channel ${index}")`).join("\n")}`;
  await assert.rejects(nativeRun(request(candlesSource, largeBars(8000))), (error) => error.code === "RESULT_LIMIT");
});


test("packed transport distinguishes absent, null, false, true, numeric and OHLC cells", async () => {
  const snapshot = largeBars(5000);
  const source = '//@version=6\nindicator("Value kinds")\nplotshape(bar_index % 2 == 0,"Booleans")\nplot(bar_index % 3 == 0 ? na : close,"Nullable")\nplotcandle(open,high,low,bar_index % 5 == 0 ? na : close,"OHLC")';
  const input = request(source, snapshot), raw = await rawRun(source, snapshot), native = await nativeRun(input);
  for (const plot of native.plots) {
    assert.ok(pine.getPackedPinePlot(plot));
    const expected = raw.plots[plot.id].data;
    expected.forEach((point, index) => {
      const value = Array.isArray(point.value) ? point.value.some((cell) => cell == null || Number.isNaN(cell)) ? null : point.value : point.value == null || typeof point.value === "number" && !Number.isFinite(point.value) ? null : point.value;
      const rawOptions = plot.style === "candle"
        ? Object.fromEntries(Object.entries(point.options).filter(([, option]) => option !== undefined))
        : point.options;
      assert.deepEqual(pine.pointAtBar(plot, index), { time: point.time / 1000, value, options: scalarOptions(rawOptions) });
    });
  }
  const wire = pine.toPineWireResponse(input.id, native, snapshot);
  const first = wire.result.plots[0];
  new Uint8Array(wire.buffers[first.packed.kinds])[17] = 0;
  first.packed.count -= 1;
  const received = pine.validatePineResponse(wire, pine.validatePineRequest(input));
  assert.equal(pine.pointAtBar(received.plots[0], 17), undefined);
  assert.equal(pine.pointAtBar(received.plots[0], 16).value, true);
  assert.equal(pine.pointAtBar(received.plots[0], 19).value, false);
  assert.equal(pine.pointAtBar(received.plots[1], 18).value, null);
  assert.deepEqual(pine.pointAtBar(received.plots[2], 16).value, [snapshot[16].open, snapshot[16].high, snapshot[16].low, snapshot[16].close]);
});


test("packed metadata admits exactly one megabyte and rejects the next UTF8 byte", async () => {
  const { input, wire } = await fixture();
  const table = Array.from({ length: 64 }, () => ({ text: "", textcolor: "", style: "", location: "" }));
  wire.result.plots[0].packed.optionTable = table;
  const metadataBytes = () => new TextEncoder().encode(JSON.stringify({ ...wire, buffers: [] })).length;
  let remaining = 1_000_000 - metadataBytes();
  for (const options of table) for (const key of Object.keys(options)) {
    const bytes = Math.min(4096, remaining); options[key] = "x".repeat(bytes); remaining -= bytes;
  }
  assert.equal(remaining, 0);
  assert.equal(metadataBytes(), 1_000_000);
  const admitted = pine.validatePineResponse(wire, pine.validatePineRequest(input));
  assert.equal(pine.pointAtBar(admitted.plots[0], 4999).value, input.bars[4999].close);
  const available = table.find((options) => Object.values(options).some((value) => value.length < 4096));
  const key = Object.keys(available).find((name) => available[name].length < 4096);
  available[key] += "x";
  assert.equal(metadataBytes(), 1_000_001);
  assert.throws(() => pine.validatePineResponse(wire, pine.validatePineRequest(input)), (error) => error.code === "RESULT_LIMIT" && /metadata/.test(error.message));
});


test("a small externally packed result remains transferable across canonical roundtrip", async () => {
  const input = request(manySource(1), largeBars(2));
  const native = await nativeRun(input);
  const packed = pine.encodePinePackedPlots(native.plots, input.bars);
  const wire = { id: input.id, status: "completed", encoding: "pine-packed-v1", result: { ...native, plots: packed.plots }, buffers: packed.buffers };
  const canonical = pine.validatePineResponse(wire, pine.validatePineRequest(input));
  const forwarded = pine.toPineWireResponse(input.id, canonical, input.bars);
  assert.equal(forwarded.encoding, "pine-packed-v1");
  const transferred = structuredClone(forwarded, { transfer: forwarded.buffers });
  assert.ok(forwarded.buffers.every((buffer) => buffer.byteLength === 0));
  const decoded = pine.validatePineResponse(transferred, pine.validatePineRequest(input));
  assert.equal(pine.pointAtBar(decoded.plots[0], 1).value, input.bars[1].close);
});

const continuousGradientSource = '//@version=6\nindicator("Continuous gradient")\na=plot(110,"Hidden upper",display=display.none)\nb=plot(90,"Hidden lower",display=display.none)\nfill(a,b,120+bar_index/1000,80-bar_index/2000,bar_index%2==0?#ff0000:#00ff00,#0000ff,title="Continuous")';
let gradientFixture;
async function continuousGradient() {
  gradientFixture ??= (async () => {
    const input = request(continuousGradientSource, largeBars(20_000));
    const oracle = await rawRun(input.source, input.bars);
    const result = await nativeRun(input);
    return { input, oracle, result, wire: pine.toPineWireResponse(input.id, result, input.bars) };
  })();
  const value = await gradientFixture;
  return { ...value, wire: structuredClone(value.wire) };
}

test("20,000 continuous native gradient anchors match independent PineTS while transport remains lazy and transferable", async () => {
  const { input, oracle, result, wire } = await continuousGradient();
  assert.equal(result.source, continuousGradientSource);
  assert.equal(result.audit.engineVersion, "0.11.0");
  const rawFill = Object.values(oracle.plots).find((plot) => plot.options.gradient === true);
  const fill = result.plots.find((plot) => plot.options.gradient === true);
  assert.ok(rawFill); assert.ok(fill);
  const backing = pine.getPackedPinePlot(fill);
  assert.ok(backing);
  assert.deepEqual([...backing.numericOptions].sort(), ["bottom_value", "top_value"]);
  assert.equal(backing.numericValues.length, 40_000);
  assert.equal(backing.numericKinds.length, 40_000);
  assert.equal(backing.values.length, 20_000);
  assert.equal(backing.kinds.length, 20_000);
  assert.equal(backing.numericValues.buffer, backing.values.buffer);
  assert.equal(backing.numericKinds.buffer, backing.kinds.buffer);
  assert.ok(backing.optionTable.length < 10);
  assert.ok(backing.optionTable.every((options) => !Object.hasOwn(options, "top_value") && !Object.hasOwn(options, "bottom_value")));
  assert.equal(Array.isArray(fill.points), false, "20k canonical points must remain a lazy view");
  assert.equal(Object.hasOwn(fill.points, "0"), false, "No historical point object may be retained at an indexed property");
  assert.equal(fill.points.length, 20_000);
  for (let index = 0; index < input.bars.length; index++) {
    const expected = { top_value: 120 + index / 1000, bottom_value: 80 - index / 2000, top_color: index % 2 === 0 ? "#ff0000" : "#00ff00", bottom_color: "#0000ff" };
    for (const [lane, key] of backing.numericOptions.entries()) {
      assert.equal(backing.numericKinds[lane * input.bars.length + index], 1);
      assert.equal(backing.numericValues[lane * input.bars.length + index], expected[key]);
    }
    assert.deepEqual(rawFill.data[index].options, expected, "Independent raw engine resolves each series anchor");
    assert.deepEqual(pine.pointAtBar(fill, index), { time: input.bars[index].time, value: null, options: expected });
  }
  assert.equal(wire.encoding, "pine-packed-v1");
  const metadataBytes = new TextEncoder().encode(JSON.stringify({ ...wire, buffers: [] })).length;
  const binaryBytes = wire.buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0);
  assert.ok(metadataBytes < 10_000, "Continuous numeric values cannot return as a per-bar JSON dictionary");
  assert.ok(binaryBytes < 2_000_000, "Three continuous channels must fit bounded typed storage without changing global limits");
  assert.ok(metadataBytes + binaryBytes < pine.PINE_LIMITS.resultBytes);
  const transferred = structuredClone(wire, { transfer: wire.buffers });
  assert.ok(wire.buffers.every((buffer) => buffer.byteLength === 0));
  const received = pine.validatePineResponse(transferred, pine.validatePineRequest(input));
  const receivedFill = received.plots.find((plot) => plot.options.gradient);
  assert.equal(Array.isArray(receivedFill.points), false);
  for (const view of received.plots.map(pine.getPackedPinePlot)) {
    assert.ok(transferred.buffers.includes(view.values.buffer));
    assert.ok(transferred.buffers.includes(view.kinds.buffer));
    assert.ok(transferred.buffers.includes(view.optionIndices.buffer));
  }
  const forwarded = pine.toPineWireResponse(input.id, received, input.bars);
  assert.equal(forwarded.buffers.length, transferred.buffers.length);
  assert.ok(forwarded.buffers.every((buffer) => transferred.buffers.includes(buffer)), "Re-encoding retains received buffer ownership rather than rematerializing points");
  const again = structuredClone(forwarded, { transfer: forwarded.buffers });
  assert.ok(forwarded.buffers.every((buffer) => buffer.byteLength === 0));
  const redecoded = pine.validatePineResponse(again, pine.validatePineRequest(input));
  for (const index of [0, 1, 9999, 19999]) {
    const plot = redecoded.plots.find((entry) => entry.options.gradient);
    assert.deepEqual(pine.pointAtBar(plot, index), { time: input.bars[index].time, value: null, options: { top_value: 120 + index / 1000, bottom_value: 80 - index / 2000, top_color: index % 2 === 0 ? "#ff0000" : "#00ff00", bottom_color: "#0000ff" } });
  }
});

test("numeric option lanes preserve optional missing null zero and mixed scalar fallbacks", async () => {
  const snapshot = largeBars(5000), input = request(manySource(1), snapshot), base = await nativeRun(input);
  const optionsAt = (index) => ({ linewidth: 2, offset: 0, ...[
    { color: "#ff0000" },
    { color: "#ff0000", level: null },
    { color: "#ff0000", level: 0 },
    { color: "#ff0000", level: index / 8 },
    { color: "#ff0000", level: false },
    { color: "#ff0000", level: "text" },
    { color: "#ff0000", level: true },
  ][index % 7] });
  const plot = { ...base.plots[0], points: snapshot.map((bar, index) => ({ time: bar.time, value: bar.close, options: optionsAt(index) })) };
  const encoded = pine.encodePinePackedPlots([plot], snapshot);
  const wire = { id: input.id, status: "completed", encoding: "pine-packed-v1", result: { ...base, plots: encoded.plots }, buffers: encoded.buffers };
  assert.deepEqual(encoded.plots[0].packed.numericOptions, ["level"]);
  assert.equal(encoded.buffers.length, 3);
  assert.ok(encoded.plots[0].packed.optionTable.length < 10, "Numeric series does not expand the scalar dictionary");
  assert.ok(encoded.plots[0].packed.optionTable.slice(1).every((options) => options.linewidth === 2 && options.offset === 0), "Constant numeric fields stay in dictionary rather than consume numeric lanes");
  const received = pine.validatePineResponse(wire, pine.validatePineRequest(input)), view = pine.getPackedPinePlot(received.plots[0]);
  assert.deepEqual(view.numericOptions, ["level"]);
  assert.equal(view.numericValues.length, snapshot.length);
  assert.equal(view.numericKinds.length, snapshot.length);
  assert.equal(view.numericValues.buffer, view.values.buffer);
  assert.equal(view.numericKinds.buffer, view.kinds.buffer);
  for (let index = 0; index < snapshot.length; index++) {
    assert.deepEqual(pine.pointAtBar(received.plots[0], index), { time: snapshot[index].time, value: snapshot[index].close, options: optionsAt(index) });
    const hasNumber = index % 7 === 2 || index % 7 === 3;
    assert.equal(view.numericKinds[index], hasNumber ? 1 : 0);
    assert.equal(view.numericValues[index], hasNumber ? optionsAt(index).level : 0);
  }
  assert.equal(Object.hasOwn(pine.pointAtBar(received.plots[0], 0).options, "level"), false);
  assert.equal(pine.pointAtBar(received.plots[0], 1).options.level, null);
  assert.equal(pine.pointAtBar(received.plots[0], 2).options.level, 0);
  const forwarded = pine.toPineWireResponse(input.id, received, snapshot);
  assert.ok(forwarded.buffers.every((buffer) => wire.buffers.includes(buffer)));
  const again = pine.validatePineResponse(structuredClone(forwarded), pine.validatePineRequest(input));
  for (const index of [0, 1, 2, 3, 4, 5, 6, 4999]) assert.deepEqual(pine.pointAtBar(again.plots[0], index).options, optionsAt(index));
});

test("numeric option packed metadata and binary lanes reject malformed unsafe or contradictory state", async () => {
  const { input, wire } = await continuousGradient();
  const fillAt = (copy) => copy.result.plots.find((plot) => plot.options.gradient);
  const bad = (mutate) => { const copy = structuredClone(wire); mutate(copy, fillAt(copy)); rejectsWire(copy, input); };
  const numericSlot = (plot, key, index = 13) => input.bars.length * (plot.packed.arity + plot.packed.numericOptions.indexOf(key)) + index;
  const numericKind = (plot, key, index = 13) => input.bars.length * (1 + plot.packed.numericOptions.indexOf(key)) + index;
  for (const value of [Infinity, -Infinity, NaN]) bad((copy, plot) => { new Float64Array(copy.buffers[plot.packed.values])[numericSlot(plot, "top_value")] = value; });
  bad((copy, plot) => { new Uint8Array(copy.buffers[plot.packed.kinds])[numericKind(plot, "top_value")] = 2; });
  bad((copy, plot) => { new Uint8Array(copy.buffers[plot.packed.kinds])[numericKind(plot, "top_value")] = 0; });
  bad((copy, plot) => { const kinds = new Uint8Array(copy.buffers[plot.packed.kinds]); kinds[13] = 0; plot.packed.count--; });
  bad((copy, plot) => { copy.buffers[plot.packed.values] = copy.buffers[plot.packed.values].slice(0, -8); });
  bad((copy, plot) => { copy.buffers[plot.packed.kinds] = copy.buffers[plot.packed.kinds].slice(0, -1); });
  bad((copy, plot) => { plot.packed.values = copy.result.plots[0].packed.values; });
  bad((copy, plot) => { copy.buffers[plot.packed.values] = copy.buffers[copy.result.plots[0].packed.values]; });
  bad((copy, plot) => { copy.buffers[plot.packed.values].unsafe = 1; });
  bad((copy, plot) => { copy.buffers[plot.packed.values] = new Float64Array(copy.buffers[plot.packed.values]); });
  bad((copy, plot) => { structuredClone(copy.buffers[plot.packed.values], { transfer: [copy.buffers[plot.packed.values]] }); });
  bad((copy, plot) => { plot.packed.numericOptions = ["top_value", "top_value"]; });
  bad((copy, plot) => { plot.packed.numericOptions = ["top_value", "__proto__"]; });
  bad((copy, plot) => { plot.packed.numericOptions = ["constructor", "bottom_value"]; });
  bad((copy, plot) => { plot.packed.numericOptions = ["x".repeat(129), "bottom_value"]; });
  bad((copy, plot) => { plot.packed.numericOptions = Array.from({ length: 65 }, (_, index) => "field_" + index); });
  bad((copy, plot) => { plot.packed.numericOptions.extra = "unsafe"; });
  bad((copy, plot) => { plot.packed.numericOptions[Symbol("extra")] = "unsafe"; });
  bad((copy, plot) => { Object.setPrototypeOf(plot.packed.numericOptions, Object.create(Array.prototype)); });
  bad((copy, plot) => { plot.packed.numericOptions = { 0: "top_value", 1: "bottom_value", length: 2 }; });
  bad((copy, plot) => { plot.packed.numericOptions.pop(); });
  bad((copy, plot) => { delete plot.packed.numericOptions; });
  bad((copy, plot) => { plot.packed.numericValues = plot.packed.values; });
  bad((copy, plot) => { plot.packed.optionTable[0].top_value = 120; });
  bad((copy, plot) => { const options = Object.fromEntries(Array.from({ length: 64 }, (_, index) => ["field_" + index, "text"])); plot.packed.optionTable.push(options); new Uint16Array(copy.buffers[plot.packed.optionIndices]).fill(plot.packed.optionTable.length - 1); });
  bad((copy, plot) => { plot.packed.optionTable[0].extra = new Float64Array([1]); });
  bad((copy) => { copy.buffers.push(new ArrayBuffer(1)); });
});

test("numeric lanes count toward existing total byte limits without replacing metadata guards", async () => {
  const { input, wire } = await continuousGradient(), fill = wire.result.plots.find((plot) => plot.options.gradient);
  const binaryBytes = wire.buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0);
  assert.equal(binaryBytes, 1_020_000, "Three scalar channels plus two Float64/presence lanes use exactly 1.02 MB");
  const oversized = structuredClone(wire);
  const table = Array.from({ length: 64 }, (_, index) => ({ color: "#ff0000", text: String(index) + "x".repeat(4094), textcolor: "x".repeat(4096), style: "x".repeat(4096), location: "x".repeat(4096) }));
  oversized.result.plots.find((plot) => plot.options.gradient).packed.optionTable = table;
  assert.ok(new TextEncoder().encode(JSON.stringify({ ...oversized, buffers: [] })).length > 1_000_000);
  assert.throws(() => pine.validatePineResponse(oversized, pine.validatePineRequest(input)), (error) => error.code === "RESULT_LIMIT" && /metadata/.test(error.message));
  const overflow = structuredClone(wire);
  overflow.buffers[fill.packed.values] = new ArrayBuffer(16_000_001);
  assert.throws(() => pine.validatePineResponse(overflow, pine.validatePineRequest(input)), (error) => error.code === "RESULT_LIMIT" && /16 MB/.test(error.message));
  assert.equal(pine.PINE_LIMITS.metadataBytes, 1_000_000);
  assert.equal(pine.PINE_LIMITS.resultBytes, 16_000_000);
});

test("numeric option lanes retain chart qualifier guards and one equal-anchor disclosure", async () => {
  // Synthetic wire-only qualifiers exercise the existing consumer's rejection
  // boundary; engine fidelity is independently proved by the raw/native case.
  const snapshot = largeBars(5000), input = request(manySource(1), snapshot), base = await nativeRun(input);
  const cases = [
    { style: "line", options: (index) => ({ offset: index === 4999 ? 1 : 0 }), warning: /offset/i, drawn: 0 },
    { style: "line", options: (index) => ({ linewidth: index === 4999 ? 5 : 1 }), warning: /line width/i, drawn: 1 },
    { style: "shape", options: (index) => ({ shape: index % 2 + 1, location: "absolute" }), warning: /shape or location/i, drawn: 0 },
    { style: "shape", options: (index) => ({ shape: "circle", location: index % 2 + 1 }), warning: /shape or location/i, drawn: 0 },
    { style: "shape", options: (index) => ({ shape: "circle", location: "absolute", size: index % 2 + 1 }), warning: /size.*local pixel|local pixel.*size/i, drawn: 1 },
  ];
  for (const specimen of cases) {
    const plot = { ...base.plots[0], style: specimen.style, options: {}, points: snapshot.map((bar, index) => ({ time: bar.time, value: bar.close, options: specimen.options(index) })) };
    const encoded = pine.encodePinePackedPlots([plot], snapshot);
    assert.ok(encoded.plots[0].packed.numericOptions.length > 0);
    const received = pine.validatePineResponse({ id: input.id, status: "completed", encoding: "pine-packed-v1", result: { ...base, plots: encoded.plots }, buffers: encoded.buffers }, pine.validatePineRequest(input));
    const adapted = pine.adaptPineChartResult(received, snapshot);
    assert.equal(adapted.plots.length, specimen.drawn);
    assert.ok(adapted.warnings.some((warning) => specimen.warning.test(warning)), "Promoted numeric qualifiers cannot disappear from consumer warnings");
  }
  const source = continuousGradientSource.replace("120+bar_index/1000", "bar_index==9999?100:120+bar_index/1000").replace("80-bar_index/2000", "bar_index==9999?100:80-bar_index/2000");
  const native = await nativeRun(request(source, largeBars(20_000)));
  const fill = native.plots.find((plot) => plot.options.gradient);
  assert.equal(pine.pointAtBar(fill, 9999).options.top_value, 100);
  assert.equal(pine.pointAtBar(fill, 9999).options.bottom_value, 100);
  assert.deepEqual([...pine.getPackedPinePlot(fill).numericOptions].sort(), ["bottom_value", "top_value"]);
  assert.ok(pine.adaptPineChartResult(native, largeBars(20_000)).warnings.some((warning) => /equal.*zero span|zero.span.*equal/i.test(warning)), "A single degenerate gradient bar must retain its visible local-policy disclosure");
});
