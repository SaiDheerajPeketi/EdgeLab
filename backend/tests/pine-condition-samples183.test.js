import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
// Real sealed compiler, native contexts and executor. Only provider histories
// and explicitly received primary/remote candles are authored test fixtures.
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser", target: "es2020", write: false,
  logLevel: "silent", plugins: [createPineEnginePlugin()], stdin: { loader: "ts", resolveDir: process.cwd(), sourcefile: "pine-condition-samples183.ts",
    contents: 'export * from "./frontend/src/workers/pineNative.worker";export * from "./frontend/src/lib/pineProtocol";export * from "./frontend/src/lib/pineLiveProtocol";export * from "./frontend/src/lib/pinePacked";export * from "./frontend/src/lib/pineConditionSamples";export * from "./frontend/src/lib/pineCalculationSnapshot";' } })).outputFiles[0].text;
console.info("CONDITION_SAMPLES183_BINDING " + JSON.stringify({ minified: true, actualWorker: true,
  bundleSha256: createHash("sha256").update(bundle).digest("hex"), manifestSha256: createHash("sha256").update(fs.readFileSync("frontend/vendor/pinets/manifest.json")).digest("hex") }));
const api = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const origin = Date.UTC(2024, 0, 1) / 1000;
const candle = (i, close = 100 + i, span = 60) => ({ time: origin + i * span, open: 100,
  high: Math.max(103, close + 1), low: Math.min(97, close - 1), close, volume: 10 + i });
const metadata = (timeframe = "1", symbol = "BINANCE:BTCUSDT") => ({ symbol, timeframe, mintick: .01, pointvalue: 1,
  mincontract: .001, quantityStep: .001, currency: "USDT", basecurrency: symbol.includes("ETH") ? "ETH" : "BTC" });
const aggregate = (rows, seconds) => ({ time: Math.floor(rows[0].time / seconds) * seconds, open: rows[0].open,
  high: Math.max(...rows.map(bar => bar.high)), low: Math.min(...rows.map(bar => bar.low)), close: rows.at(-1).close,
  volume: rows.reduce((sum, bar) => sum + bar.volume, 0) });
const grouped = (rows, seconds) => {
  const buckets = new Map();
  for (const bar of rows) { const key = Math.floor(bar.time / seconds); if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(bar); }
  return [...buckets.values()].map(rows => aggregate(rows, seconds));
};
const script = (body, version = 6, declaration = 'indicator("Condition samples183",dynamic_requests=true)') => `//@version=${version}\n${declaration}\n${body}`;
const request = (body, extra = {}, version = 6, declaration) => ({ id: "samples183", action: "run", mode: "live",
  source: script(body, version, declaration), inputs: {}, bars: [0, 1, 2].map(i => candle(i)), context: metadata(), ...extra });
const value = (result, name) => result.plots.find(plot => plot.name === name).points.at(-1).value;
let ordinal = 0;
async function live(input, marketStreams) {
  const executor = api.createPineLiveExecutor(), sessionId = "condition-samples183-" + ++ordinal;
  const start = { protocol: "pine-live-v1", sessionId, sequence: 0, action: "start", request: { ...input, id: sessionId + ":0" },
    ...(marketStreams ? { marketStreams } : {}) };
  try {
    const initial = await executor.execute(start); let sequence = 0;
    return { initial, start, executor, send: command => executor.execute({ protocol: "pine-live-v1", sessionId, sequence: ++sequence, ...command }) };
  } catch (error) { executor.dispose(); throw error; }
}
const stream = (symbol = "BINANCE:BTCUSDT") => ({ symbol, timeframe: "1", epoch: 3 });
const remote = (bar, sequence, confirmed = true, symbol = "BINANCE:BTCUSDT") => ({ ...stream(symbol), sequence, bar, confirmed,
  closeTime: (bar.time + 60) * 1000 - 1, eventTime: confirmed ? (bar.time + 60) * 1000 - 1 : bar.time * 1000 + sequence });
const sample = (result, chartTime, chartIndex, timeframe) => {
  const batch = result.conditionSamples; assert.ok(batch);
  assert.equal(batch.chartTime, chartTime); assert.equal(batch.chartBarIndex, chartIndex); assert.equal(batch.calculationTimeframe, timeframe);
  assert.equal(batch.samples.length, 1); assert.equal(batch.dropped, 0); return batch.samples[0];
};

test("v5/v6 every armed received execution observes false-to-true transitions despite prior unarmed/native once gates", async () => {
  const body = 'threshold=input.float(110,"Threshold")\nalertcondition(close>threshold,"Duplicate","{{plot_0}}")\nalertcondition(barstate.isconfirmed,"Duplicate","")\nplot(close,"After",offset=2,display=display.none)\nplot(close+1,"Repeated")\nplot(close+2,"Repeated")';
  for (const version of [5, 6]) {
    const session = await live(request(body, { inputs: { in_0: 115 } }, version));
    try {
      assert.equal(Object.hasOwn(session.initial, "conditionSamples"), false);
      assert.deepEqual(session.initial.alertConditions.map(definition => definition.id), ["alertcondition_0", "alertcondition_1"]);
      const quiet = await session.send({ action: "update", bar: candle(3, 120), confirmed: false });
      assert.equal(Object.hasOwn(quiet, "conditionSamples"), false);
      for (const [close, confirmed] of [[114, false], [116, false], [114, false], [116, false], [116, true]]) {
        const bar = candle(3, close), result = await session.send({ action: "update", bar, confirmed, collectConditions: true });
        const actual = sample(result, bar.time, 3, "1");
        assert.equal(actual.barIndex, 3); assert.deepEqual(actual.bar, bar); assert.equal(actual.confirmed, confirmed);
        assert.deepEqual(actual.conditions, [close > 115, confirmed]);
        assert.deepEqual(actual.plots, { numbered: [close, close + 1, close + 2], named: [{ title: "After", value: close }, { title: "Repeated", value: close + 1 }] });
        assert.equal(Object.hasOwn(result, "alertEvents"), false);
      }
      assert.equal(Object.hasOwn(session.initial, "conditionSamples"), false);
    } finally { session.executor.dispose(); }
  }
});

test("native raw scalar/OHLC placeholders are complete after the condition, before offsets and display filtering", async () => {
  const body = 'alertcondition(close>open,"Price","Raw")\nplot(close,"Hidden",display=display.none,offset=3)\nplot(na,"NA")\nplotbar(open,high,low,close,"OHLC",display=display.none)\nplotcandle(open,high,na,close,"Partial",display=display.none)\nplotshape(close>open,"Shape")\nplotchar(close>open,"Char")\nplotarrow(close-open,"Arrow")';
  const session = await live(request(body));
  try {
    const bar = candle(3, 120), result = await session.send({ action: "update", bar, confirmed: false, collectConditions: true });
    const actual = sample(result, bar.time, 3, "1");
    assert.deepEqual(actual.conditions, [true]);
    assert.deepEqual(actual.plots.numbered, [120, null, 100, 121, 97, 120, 100, 121, null, 120, 1, 1, 20]);
    assert.deepEqual(actual.plots.named, [{ title: "Hidden", value: 120 }, { title: "NA", value: null },
      { title: "Shape", value: 1 }, { title: "Char", value: 1 }, { title: "Arrow", value: 20 }]);
  } finally { session.executor.dispose(); }
});

test("selected source calculation samples own native candle and confirmation while the display candle remains open", async () => {
  const children = Array.from({ length: 10 }, (_, i) => candle(i, 100 + i, 180));
  const session = await live(request('alertcondition(barstate.isconfirmed,"Closed","")\nplot(close,"Source")', {
    context: metadata("15"), bars: grouped(children, 900), sourceSnapshot: { timeframe: "3", bars: children } }, 6,
    'indicator("Source samples183",timeframe="3",timeframe_gaps=false)'));
  try {
    const bar = candle(10, 150, 180);
    const result = await session.send({ action: "update", bar: aggregate([bar], 900), confirmed: false,
      source: { bar, confirmed: true }, collectConditions: true });
    const actual = sample(result, bar.time, 2, "3");
    assert.equal(actual.barIndex, 10); assert.deepEqual(actual.bar, bar); assert.equal(actual.confirmed, true);
    assert.deepEqual(actual.conditions, [true]); assert.deepEqual(actual.plots.numbered, [150]);
    assert.equal(value(result, "Source"), 150);
  } finally { session.executor.dispose(); }
});

test("a quiet foreign receipt cannot sample main conditions; the actual primary execution awaits foreign request values", async () => {
  const symbol = "BINANCE:ETHUSDT", history = [0, 1, 2].map(i => candle(i));
  const input = request('remote=request.security("ETHUSDT","1",close)\nalertcondition(remote>110,"Remote","")\nplot(remote,"Awaited")', {
    marketData: { provider: "binance", snapshots: [{ context: metadata("1", symbol), requestedTimeframe: "1", bars: history, asOf: origin + 180 }] } });
  const session = await live(input, [stream(symbol)]);
  try {
    const initial = structuredClone(session.initial);
    const ack = await session.send({ action: "markets", events: [remote(candle(3, 150), 1, false, symbol)] });
    assert.equal(ack.kind, "market-update"); assert.equal(Object.hasOwn(ack, "conditionSamples"), false);
    const bar = candle(3, 120), result = await session.send({ action: "update", bar, confirmed: false, collectConditions: true });
    const actual = sample(result, bar.time, 3, "1");
    assert.deepEqual(actual.conditions, [true]); assert.deepEqual(actual.plots.numbered, [150]);
    assert.deepEqual(actual.bar, bar); assert.equal(value(result, "Awaited"), 150); assert.deepEqual(session.initial, initial);
  } finally { session.executor.dispose(); }
});

test("finer admitted calculation captures all chronological actual native executions before projection", async () => {
  const history = Array.from({ length: 15 }, (_, i) => candle(i));
  const input = request('alertcondition(close>116,"Threshold","")\nplot(close,"Native")', {
    context: metadata("5"), bars: grouped(history, 300), marketData: { provider: "binance", snapshots: [
      { context: metadata("1"), requestedTimeframe: "1", bars: history, asOf: origin + 900 }] } }, 6,
    'indicator("Finer samples183",timeframe="1",timeframe_gaps=false)');
  const session = await live(input, [stream()]);
  try {
    const children = [15, 16, 17, 18].map(i => candle(i));
    await session.send({ action: "markets", events: children.map((bar, i) => remote(bar, i + 1, i !== 3)) });
    const result = await session.send({ action: "update", bar: aggregate(children, 300), confirmed: false, collectConditions: true });
    const batch = result.conditionSamples;
    assert.equal(batch.chartTime, origin + 900); assert.equal(batch.chartBarIndex, 3); assert.equal(batch.calculationTimeframe, "1");
    assert.equal(batch.dropped, 0); assert.deepEqual(batch.samples.map(actual => actual.barIndex), [15, 16, 17, 18]);
    assert.deepEqual(batch.samples.map(actual => actual.bar), children);
    assert.deepEqual(batch.samples.map(actual => actual.confirmed), [true, true, true, false]);
    assert.deepEqual(batch.samples.map(actual => actual.conditions), [[false], [false], [true], [true]]);
    assert.deepEqual(batch.samples.map(actual => actual.plots.numbered), [[115], [116], [117], [118]]);
    assert.equal(value(result, "Native"), 118);
  } finally { session.executor.dispose(); }
});

test("native sample indices beyond 20,000 retain exact source OHLCV rather than a display-bar index", async () => {
  const children = Array.from({ length: 20_005 }, (_, i) => candle(i));
  const session = await live(request('alertcondition(bar_index>20000,"Long source","")\nplot(bar_index,"Index")', {
    context: metadata("5"), bars: grouped(children, 300), sourceSnapshot: { timeframe: "1", bars: children } }, 6,
    'indicator("Long source183",timeframe="1",timeframe_gaps=false)'));
  try {
    const bar = candle(20_005), result = await session.send({ action: "update", bar: aggregate([bar], 300), confirmed: false,
      source: { bar, confirmed: false }, collectConditions: true });
    const actual = sample(result, bar.time, 4001, "1");
    assert.equal(actual.barIndex, 20_005); assert.deepEqual(actual.bar, bar); assert.deepEqual(actual.conditions, [true]);
    assert.deepEqual(actual.plots.numbered, [20_005]); assert.equal(value(result, "Index"), 20_005);
  } finally { session.executor.dispose(); }
});

test("sample overflow is bounded and disclosed while all genuine calculation outputs continue", async () => {
  const history = Array.from({ length: 120 }, (_, i) => candle(i));
  const input = request('alertcondition(close>250,"Threshold","")\nplot(close,"Native")', {
    context: metadata("120"), bars: [aggregate(history, 7200)], marketData: { provider: "binance", snapshots: [
      { context: metadata("1"), requestedTimeframe: "1", bars: history, asOf: origin + 7200 }] } }, 6,
    'indicator("Sample capacity183",timeframe="1",timeframe_gaps=false)');
  const session = await live(input, [stream()]);
  try {
    const children = Array.from({ length: 70 }, (_, i) => candle(120 + i));
    await session.send({ action: "markets", events: children.map((bar, i) => remote(bar, i + 1, true)) });
    const result = await session.send({ action: "update", bar: aggregate(children, 7200), confirmed: false, collectConditions: true });
    assert.equal(result.conditionSamples.samples.length, 64); assert.equal(result.conditionSamples.dropped, 6);
    assert.deepEqual(result.conditionSamples.samples.map(actual => actual.barIndex), Array.from({ length: 64 }, (_, i) => 120 + i));
    assert.deepEqual(result.conditionSamples.samples.map(actual => actual.bar.close), children.slice(0, 64).map(bar => bar.close));
    assert.equal(value(result, "Native"), 289);
  } finally { session.executor.dispose(); }
});

test("genuine legal-title sampling exhausts the byte budget before the count limit and retains a chronological prefix", async () => {
  const history = Array.from({ length: 120 }, (_, i) => candle(i));
  // Native map keys are wire IDs, currently bounded to 128 characters. These
  // 64 distinct legal IDs stress the byte cap without bypassing that contract.
  const titles = Array.from({ length: 64 }, (_, i) => "x".repeat(125) + String(i).padStart(2, "0"));
  const body = 'alertcondition(true,"Observed","")\n' + titles.map((title, i) => `plot(close+${i},"${title}")`).join("\n");
  const input = request(body, { context: metadata("120"), bars: [aggregate(history, 7200)],
    marketData: { provider: "binance", snapshots: [{ context: metadata("1"), requestedTimeframe: "1", bars: history, asOf: origin + 7200 }] } },
    6, 'indicator("Byte capacity183",timeframe="1",timeframe_gaps=false)');
  assert.ok(new TextEncoder().encode(input.source).byteLength < 20_000);
  const session = await live(input, [stream()]);
  try {
    const children = Array.from({ length: 70 }, (_, i) => candle(120 + i));
    await session.send({ action: "markets", events: children.map((bar, i) => remote(bar, i + 1, true)) });
    const result = await session.send({ action: "update", bar: aggregate(children, 7200), confirmed: false, collectConditions: true });
    const batch = result.conditionSamples, count = batch.samples.length;
    assert.ok(count > 0 && count < 64, "Actual legal titles exhaust bytes before the 64-sample count cap.");
    assert.equal(count + batch.dropped, 70);
    assert.ok(new TextEncoder().encode(JSON.stringify(batch)).byteLength <= 262_144);
    assert.deepEqual(batch.samples.map(actual => actual.barIndex), Array.from({ length: count }, (_, i) => 120 + i));
    assert.deepEqual(batch.samples.map(actual => actual.bar), children.slice(0, count));
    assert.ok(batch.samples.every(actual => actual.confirmed && actual.conditions.length === 1 && actual.conditions[0]));
    assert.deepEqual(batch.samples.at(-1).plots.named.map(entry => entry.title), titles);
    for (let i = 0; i < titles.length; i++) assert.equal(value(result, titles[i]), 289 + i);
    assert.equal(history.length, 120); assert.equal(session.initial.conditionSamples, undefined);
    console.info("BYTE_CAPACITY183 " + JSON.stringify({ samples: count, dropped: batch.dropped,
      serializedBytes: new TextEncoder().encode(JSON.stringify(batch)).byteLength, finalNativeClose: value(result, titles[0]) }));
  } finally { session.executor.dispose(); }
});

test("custom methods retain native source ordinals while history/start/viewport and strategy cannot publish samples", async () => {
  const body = 'type Marker\n    float value\nmethod alertcondition(Marker self,bool condition,string title,string message)=>condition\nm=Marker.new(1)\ncustom=m.alertcondition(close>open,"Method","")\ndirect=alertcondition(m,close>open,"Direct","")\nalertcondition(close>110,"Native","")\nalertcondition(message="Named",title="Native",condition=close<110)\nplot(custom?1:0,"Custom")\nplot(direct?1:0,"Direct")';
  for (const version of [5, 6]) {
    const input = request(body, {}, version), historical = await api.executePineRequest({ ...input, mode: "historical" });
    assert.equal(Object.hasOwn(historical, "conditionSamples"), false);
    const session = await live(input);
    try {
      assert.equal(Object.hasOwn(session.initial, "conditionSamples"), false);
      const viewport = await session.send({ action: "viewport", viewport: { from: origin, to: origin + 120 } });
      assert.equal(Object.hasOwn(viewport, "conditionSamples"), false);
      const bar = candle(3, 120), result = await session.send({ action: "update", bar, confirmed: false, collectConditions: true });
      assert.deepEqual(sample(result, bar.time, 3, "1").conditions, [true, false]);
      assert.deepEqual(result.alertConditions.map(definition => definition.id), ["alertcondition_0", "alertcondition_1"]);
      assert.deepEqual(result.conditionSamples.samples[0].plots.numbered, [1, 1]);
    } finally { session.executor.dispose(); }
  }
  const strategy = await live(request('alertcondition(close>open,"No subscription","")\nplot(close,"Close")', {}, 6, 'strategy("No strategy conditions183")'));
  try {
    assert.equal(Object.hasOwn(strategy.initial, "conditionSamples"), false);
    await assert.rejects(strategy.send({ action: "update", bar: candle(3, 120), confirmed: false, collectConditions: true }),
      error => error.code === "UNSUPPORTED_EXECUTION_CONTEXT" && /strateg|condition/i.test(error.message));
  } finally { strategy.executor.dispose(); }
});

test("collected command admission is update-only, strictly boolean and never inherited from a historical request", async () => {
  const input = request('alertcondition(true,"Condition","")\nplot(close,"Close")');
  const session = await live(input);
  try {
    for (const command of [session.start, { protocol: "pine-live-v1", sessionId: session.start.sessionId, sequence: 1, action: "viewport", viewport: null },
      { protocol: "pine-live-v1", sessionId: session.start.sessionId, sequence: 1, action: "markets", events: [] }]) {
      assert.throws(() => api.validatePineLiveRequest({ ...command, collectConditions: true }), error => error.code === "INVALID_LIVE_MESSAGE");
    }
    for (const collectConditions of [null, 1, "true", {}, []]) {
      assert.throws(() => api.validatePineLiveRequest({ protocol: "pine-live-v1", sessionId: session.start.sessionId,
        sequence: 1, action: "update", bar: candle(3), confirmed: false, collectConditions }), error => error.code === "INVALID_LIVE_MESSAGE");
    }
    const result = await session.send({ action: "update", bar: candle(3), confirmed: false, collectConditions: false });
    assert.equal(Object.hasOwn(result, "conditionSamples"), false);
  } finally { session.executor.dispose(); }
});

test("strict batch validation rejects hostile fields bounds dense-array violations and accessor evaluation", async () => {
  const session = await live(request('alertcondition(close>open,"First","")\nalertcondition(false,"Second","")\nplot(close,"Price")'));
  try {
    const result = await session.send({ action: "update", bar: candle(3, 120), confirmed: false, collectConditions: true });
    const actual = result.conditionSamples, validated = api.validatePineConditionSamples(actual, 2);
    assert.deepEqual(validated, actual);
    const mutations = [
      batch => batch.extra = true, batch => delete batch.calculationTimeframe,
      batch => batch.chartBarIndex = 20_000, batch => batch.chartTime = -1,
      batch => batch.dropped = -1, batch => batch.dropped = 1_000_000_001,
      batch => batch.samples = [structuredClone(batch.samples[0]), structuredClone(batch.samples[0])],
      batch => batch.samples = Array.from({ length: 65 }, () => structuredClone(batch.samples[0])),
      batch => delete batch.samples[0], batch => batch.samples[0].extra = true,
      batch => batch.samples[0].barIndex = 200_000, batch => batch.samples[0].barIndex = -1,
      batch => batch.samples[0].bar.timestamp = "Not one of six owned fields",
      batch => batch.samples[0].bar.high = Infinity, batch => batch.samples[0].bar.low = batch.samples[0].bar.high + 1,
      batch => batch.samples[0].confirmed = "false", batch => batch.samples[0].conditions = [true],
      batch => batch.samples[0].conditions[0] = 1, batch => delete batch.samples[0].conditions[0],
      batch => batch.samples[0].plots.numbered = Array.from({ length: 21 }, () => 1),
      batch => batch.samples[0].plots.named[0].extra = true,
      batch => batch.samples[0].plots.named[0].value = Infinity,
    ];
    for (const mutate of mutations) {
      const batch = structuredClone(actual); mutate(batch);
      assert.throws(() => api.validatePineConditionSamples(batch, 2), error => typeof error.code === "string" && /INVALID/.test(error.code));
    }
    let getters = 0;
    for (const target of ["sample", "bar", "conditions", "plots"]) {
      const batch = structuredClone(actual), first = batch.samples[0];
      const object = target === "sample" ? first : target === "bar" ? first.bar : target === "conditions" ? first.conditions : first.plots;
      const key = target === "sample" ? "confirmed" : target === "bar" ? "close" : target === "conditions" ? "0" : "numbered";
      Object.defineProperty(object, key, { enumerable: true, get() { getters++; return target === "plots" ? [120] : 120; } });
      assert.throws(() => api.validatePineConditionSamples(batch, 2));
    }
    assert.equal(getters, 0);
    const symbols = structuredClone(actual); symbols.samples[0][Symbol("unexpected")] = true;
    assert.throws(() => api.validatePineConditionSamples(symbols, 2));
    assert.notEqual(validated, actual); assert.notEqual(validated.samples[0].bar, actual.samples[0].bar);
    Reflect.set(validated.samples[0].bar, "close", 999); assert.equal(actual.samples[0].bar.close, 120);
    const excessiveBytes = structuredClone(actual);
    excessiveBytes.samples[0].plots.named = Array.from({ length: 64 }, (_, i) => ({ title: "x".repeat(4090) + String(i).padStart(2, "0"), value: 1 }));
    assert.ok(new TextEncoder().encode(JSON.stringify(excessiveBytes)).byteLength > api.PINE_CONDITION_SAMPLE_BYTES);
    assert.throws(() => api.validatePineConditionSamples(excessiveBytes, 2));
  } finally { session.executor.dispose(); }
});

test("plain and packed genuine samples require independent selected history and trusted definition proof", async () => {
  for (const count of [3, 400]) {
    const body = 'alertcondition(close>110,"Owned","")\n' + Array.from({ length: count === 3 ? 1 : 16 }, (_, i) => `plot(close+${i},"Lane ${i}")`).join("\n");
    const input = request(body, { bars: Array.from({ length: count }, (_, i) => candle(i)) }), session = await live(input);
    try {
      const bar = candle(count, 150), result = await session.send({ action: "update", bar, confirmed: false, collectConditions: true });
      const expected = { ...session.start.request, id: session.start.sessionId + ":1", bars: [...input.bars, bar] };
      const command = { protocol: "pine-live-v1", sessionId: session.start.sessionId, sequence: 1, action: "update", bar, confirmed: false, collectConditions: true };
      const wire = { protocol: "pine-live-v1", sessionId: session.start.sessionId, sequence: 1,
        response: api.toPineWireResponse(expected.id, result, expected.bars) };
      if (count === 400) assert.equal(wire.response.encoding, "pine-packed-v1");
      const calculation = api.selectPineCalculationSnapshot({ request: api.validatePineRequest(expected), timeframe: "1", realtime: true,
        chartConfirmed: false, sourceConfirmed: true, revision: 1 });
      const proof = { conditions: session.initial.alertConditions, calculation };
      assert.deepEqual(api.validatePineLiveResponse(wire, command, expected, proof).conditionSamples, result.conditionSamples);
      assert.throws(() => api.validatePineLiveResponse(wire, command, expected));
      for (const collectConditions of [undefined, false]) {
        assert.throws(() => api.validatePineLiveResponse(wire, { ...command, collectConditions }, expected, proof));
      }
      for (const mutate of [
        batch => batch.chartTime -= 60, batch => batch.chartBarIndex--, batch => batch.calculationTimeframe = "5",
        batch => batch.samples[0].barIndex--, batch => batch.samples[0].bar.time -= 60,
        batch => batch.samples[0].bar.close = 149, batch => batch.samples[0].confirmed = true,
      ]) {
        const forged = structuredClone(wire); mutate(forged.response.result.conditionSamples);
        assert.throws(() => api.validatePineLiveResponse(forged, command, expected, proof));
      }
      const definitions = structuredClone(wire); definitions.response.result.alertConditions[0].title = "Forged descriptor";
      assert.throws(() => api.validatePineLiveResponse(definitions, command, expected, proof));
      assert.throws(() => api.validatePineLiveResponse(wire, command, expected, { ...proof, conditions: [] }));
      assert.throws(() => api.validatePineResponse(wire.response, { ...expected, mode: "historical" }));
      const reused = structuredClone(wire); reused.sequence = 0;
      assert.throws(() => api.validatePineLiveResponse(reused, command, expected, proof));
      if (count === 400) {
        const buffer = structuredClone(wire); buffer.response.buffers.push(new ArrayBuffer(0));
        assert.throws(() => api.validatePineLiveResponse(buffer, command, expected, proof));
      }
    } finally { session.executor.dispose(); }
  }
});
