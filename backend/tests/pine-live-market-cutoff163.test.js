import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser", target: "es2020", write: false,
  logLevel: "silent", plugins: [createPineEnginePlugin()], stdin: { loader: "ts", resolveDir: process.cwd(), sourcefile: "pine-live-market-cutoff163.ts",
    contents: 'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineProtocol.ts"; export * from "./frontend/src/lib/pineLiveProtocol.ts";' } })).outputFiles[0].text;
console.info("LIVE_CUTOFF163_BINDING " + JSON.stringify({ minified: true, sealedWorker: true,
  bundleSha256: createHash("sha256").update(bundle).digest("hex"), manifestSha256: createHash("sha256").update(fs.readFileSync("frontend/vendor/pinets/manifest.json")).digest("hex") }));
const pine = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const origin = Date.parse("2024-01-01T00:00:00Z") / 1000;
const bar = (minute, close = 10 + minute) => ({ time: origin + minute * 60, open: close - 1, high: close + 2, low: close - 2, close, volume: minute + 1 });
const meta = (symbol, timeframe) => ({ symbol, timeframe, mintick: .01, pointvalue: 1, mincontract: 1, quantityStep: 1, currency: "USDT", basecurrency: symbol.includes("ETH") ? "ETH" : "BTC" });
const closedChart = [bar(0, 10), bar(60, 11)];
const observation = (extra = {}) => ({ bar: bar(120, 50), confirmed: false, eventTime: (origin + 135 * 60 + 15) * 1000,
  closeTime: (origin + 180 * 60) * 1000 - 1, ...extra });
const remote = (count = 135, asOf = origin + 135 * 60 + 15) => ({ context: meta("BINANCE:ETHUSDT", "1"), requestedTimeframe: "1",
  bars: Array.from({ length: count }, (_, i) => bar(i, 100 + i)), asOf });
const request = (extra = {}) => ({ id: "cutoff163", action: "run", mode: "live", source: '//@version=6\nindicator("Cutoff163")\nplot(close)', inputs: {},
  bars: closedChart, context: meta("BINANCE:BTCUSDT", "60"), liveObservation: observation(), marketData: { provider: "binance", snapshots: [remote()] }, ...extra });
const validate = value => pine.validatePineRequest(value);
const values = (result, name) => result.plots.find(plot => plot.name === name).points.map(point => point.value);
const clone = value => structuredClone(value);
// Independent grouping of authored native candles; no product aggregation helper.
function aggregate(children) {
  return { time: children[0].time, open: children[0].open, high: Math.max(...children.map(bar => bar.high)), low: Math.min(...children.map(bar => bar.low)),
    close: children.at(-1).close, volume: children.reduce((sum, bar) => sum + bar.volume, 0) };
}

test("actual native observation admits already-closed foreign M1 history beyond completed 60-minute chart history", () => {
  const input = request(), checked = validate(input);
  assert.equal(checked.bars.length, 2); assert.equal(checked.liveObservation.bar.time, origin + 120 * 60);
  assert.equal(checked.marketData.snapshots[0].bars.length, 135); assert.equal(checked.marketData.snapshots[0].bars.at(-1).time, origin + 134 * 60);
  assert.equal(checked.marketData.snapshots[0].asOf, origin + 135 * 60 + 15);
  assert.throws(() => validate({ ...input, liveObservation: undefined }));
  assert.throws(() => validate({ ...input, mode: "historical", liveObservation: undefined }));
  const historical = validate({ ...input, mode: "historical", liveObservation: undefined, marketData: { provider: "binance", snapshots: [remote(120, origin + 120 * 60)] } });
  assert.equal(historical.marketData.snapshots[0].bars.length, 120);
});

test("observation copies explicit native data and never invokes observation or candle accessors", () => {
  const input = request(), checked = validate(input), original = checked.liveObservation.bar.close;
  input.liveObservation.bar.close = 999; input.liveObservation.eventTime = 0;
  assert.equal(checked.liveObservation.bar.close, original); assert.equal(checked.liveObservation.eventTime, (origin + 135 * 60 + 15) * 1000);
  let calls = 0;
  for (const path of ["liveObservation", "bar", "confirmed", "eventTime", "closeTime", "volume"]) {
    const input = request(); input.liveObservation = clone(input.liveObservation);
    const target = path === "liveObservation" ? input : path === "volume" ? input.liveObservation.bar : input.liveObservation;
    Object.defineProperty(target, path, { get() { calls++; return 1; }, enumerable: true });
    assert.throws(() => validate(input));
  }
  assert.equal(calls, 0);
});

test("observation ownership and native timestamp boundaries reject forged future and prematurely confirmed candles", () => {
  for (const extra of [{ action: "prepare" }, { mode: "historical" }]) assert.throws(() => validate(request(extra)));
  for (const patch of [{ bar: bar(60) }, { bar: bar(180) }, { bar: bar(121) }, { confirmed: 1 }, { eventTime: (origin + 120 * 60) * 1000 - 1 },
    { eventTime: (origin + 180 * 60) * 1000 }, { eventTime: 1.5 }, { closeTime: (origin + 180 * 60) * 1000 },
    { confirmed: true, eventTime: (origin + 135 * 60) * 1000 }, { extra: true }]) assert.throws(() => validate(request({ liveObservation: observation(patch) })));
  const withoutVolume = observation(); delete withoutVolume.bar.volume; assert.throws(() => validate(request({ liveObservation: withoutVolume })));
  const inherited = Object.assign(Object.create({ inherited: true }), observation()); assert.throws(() => validate(request({ liveObservation: inherited })));
});

test("event proof bounds the foreign cutoff at actual native end; neither wall clock nor far-future confirmed timestamps extend it", () => {
  const early = observation({ eventTime: (origin + 135 * 60) * 1000 - 1 });
  assert.throws(() => validate(request({ liveObservation: early })));
  assert.throws(() => validate(request({ marketData: { provider: "binance", snapshots: [remote(136)] } })));
  assert.throws(() => validate(request({ marketData: { provider: "binance", snapshots: [remote(135, origin + 136 * 60)] } })));
  const atClose = observation({ confirmed: true, eventTime: (origin + 180 * 60) * 1000 - 1 });
  assert.doesNotThrow(() => validate(request({ liveObservation: atClose, marketData: { provider: "binance", snapshots: [remote(179, origin + 180 * 60 - 1)] } })));
  const delayedClose = observation({ confirmed: true, eventTime: Date.parse("2030-01-01T00:00:00Z") });
  assert.doesNotThrow(() => validate(request({ liveObservation: delayedClose, marketData: { provider: "binance", snapshots: [remote(180, origin + 180 * 60)] } })));
  assert.throws(() => validate(request({ liveObservation: delayedClose, marketData: { provider: "binance", snapshots: [remote(181, origin + 181 * 60)] } })));
});

test("custom seven-minute chart requires its real contiguous confirmed native prefix immediately before the observed native candle", () => {
  // 2024-01-01 midnight is not a seven-minute boundary; derive an aligned UTC bucket.
  const aligned = Math.floor(origin / 420) * 420, offset = (aligned - origin) / 60;
  const native = Array.from({ length: 10 }, (_, i) => ({ ...bar(offset + i), volume: i + 1 }));
  const current = { ...bar(offset + 10), volume: 11 }, cutoff = current.time + 15;
  const input = request({ bars: [aggregate(native.slice(0, 7))], context: meta("BINANCE:BTCUSDT", "7"), sourceSnapshot: { timeframe: "1", bars: native },
    liveObservation: { bar: current, confirmed: false, eventTime: cutoff * 1000, closeTime: (current.time + 60) * 1000 - 1 },
    marketData: { provider: "binance", snapshots: [{ context: meta("BINANCE:ETHUSDT", "1"), requestedTimeframe: "1", bars: native.map(bar => ({ ...bar, close: bar.open })), asOf: cutoff }] } });
  const checked = validate(input); assert.equal(checked.sourceSnapshot.bars.length, 10); assert.equal(checked.marketData.snapshots[0].asOf, cutoff);
  assert.equal(checked.liveObservation.bar.time, native.at(-1).time + 60);
  for (const mutate of [value => { value.sourceSnapshot.bars.splice(8, 1); }, value => { value.sourceSnapshot.bars.pop(); },
    value => { value.liveObservation.bar.time += 60; value.liveObservation.closeTime += 60000; value.liveObservation.eventTime += 60000; },
    value => { value.sourceSnapshot.bars[9].time += 60; }]) {
    const changed = clone(input); mutate(changed); assert.throws(() => validate(changed));
  }
});

test("source prefix proves only its closed native constituents and cannot make the forming observation a completed source candle", () => {
  const native = Array.from({ length: 135 }, (_, i) => bar(i)), current = bar(135);
  const input = request({ bars: [aggregate(native.slice(0, 60)), aggregate(native.slice(60, 120))], sourceSnapshot: { timeframe: "1", bars: native },
    liveObservation: { bar: current, confirmed: false, eventTime: (current.time + 15) * 1000, closeTime: (current.time + 60) * 1000 - 1 } });
  assert.doesNotThrow(() => validate(input));
  const includedCurrent = clone(input); includedCurrent.sourceSnapshot.bars.push(current); assert.throws(() => validate(includedCurrent));
  const withoutObservation = clone(input); delete withoutObservation.liveObservation;
  // Prefix alone supports its final actual close, not the later partial second.
  withoutObservation.marketData.snapshots[0].asOf = current.time;
  assert.doesNotThrow(() => validate(withoutObservation));
  withoutObservation.marketData.snapshots[0].asOf = current.time + 15; assert.throws(() => validate(withoutObservation));
});

test("sealed worker keeps observed main candle out of closed warmup and samples extended foreign history only on real primary execution", async () => {
  const sessionId = "live-cutoff163-main", executor = pine.createPineLiveExecutor();
  const body = `//@version=6
indicator("Observed main163")
varip int n=0
n+=1
plot(n,"Executions")
plot(barstate.isrealtime,"Realtime")
plot(barstate.isconfirmed,"Confirmed")
plot(close,"Main")
plot(request.security("ETHUSDT","1",close),"Remote")`;
  const input = request({ id: sessionId + ":0", source: body }), before = clone(input);
  try {
    const warm = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 0, action: "start", request: input,
      marketStreams: [{ symbol: "BINANCE:ETHUSDT", timeframe: "1", epoch: 4 }] });
    assert.equal(warm.audit.bars, 2); assert.deepEqual(values(warm, "Executions"), [1, 2]); assert.deepEqual(values(warm, "Realtime"), [false, false]);
    assert.deepEqual(values(warm, "Confirmed"), [true, true]); assert.deepEqual(values(warm, "Main"), [10, 11]); assert.deepEqual(values(warm, "Remote"), [159, 219]);
    const actual = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 1, action: "update", bar: input.liveObservation.bar, confirmed: false });
    assert.equal(actual.audit.bars, 3); assert.deepEqual(values(actual, "Executions"), [1, 2, 3]); assert.deepEqual(values(actual, "Confirmed"), [true, true, false]);
    assert.deepEqual(values(actual, "Realtime"), [false, false, true]); assert.equal(values(actual, "Main").at(-1), 50); assert.equal(values(actual, "Remote").at(-1), 234);
    assert.deepEqual(values(warm, "Main"), [10, 11]); assert.deepEqual(input, before);
  } finally { executor.dispose(); }
});
