import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

// Real runtime facade, strict parent admission and sealed worker. The sandbox
// transport alone controls asynchronous scheduling or injects hostile replies.
Error.stackTraceLimit = 0;
const root = new URL("../../", import.meta.url).pathname;
const transport = `
import {createPineLiveExecutor,executePineRequest} from '../workers/pineNative.worker';
import {toPineWireResponse} from './pinePacked';
let fixture;
export function configure(value){fixture=value;}
export function createSandboxWorkerJob(options){const owned=fixture;let stopped=false;
 return {id:options.request.id,cancel(){stopped=true;},promise:Promise.resolve().then(async()=>{
  if(owned.prepareGate)await owned.prepareGate;if(stopped)throw Error('cancelled');
  return options.validate(toPineWireResponse(options.request.id,await executePineRequest(options.request),options.request.bars));})};}
export function createSandboxWorkerSession(options){
 const owned=fixture,executor=createPineLiveExecutor();let stopped=false,chain=Promise.resolve(),rejectStop;
 const stopPromise=new Promise((_,reject)=>{rejectStop=reject;});void stopPromise.catch(()=>{});
 let bars=options.request.request.bars;
 const cancel=()=>{if(stopped)return;stopped=true;owned.cancelled++;executor.dispose();rejectStop(Error('cancelled'));};
 const send=command=>{const copy=structuredClone(command);owned.commands.push(copy);
  const work=chain.then(async()=>{if(stopped)throw Error('cancelled');if(owned.gate)await owned.gate(copy);
   if(stopped)throw Error('cancelled');const result=await executor.execute(copy);
   if(copy.action==='update')bars=copy.bar.time===bars.at(-1).time?[...bars.slice(0,-1),copy.bar]:[...bars,copy.bar];
   const id=copy.sessionId+':'+copy.sequence;
   const response=result.kind==='market-update'?{id,status:'completed',ack:result}:toPineWireResponse(id,result,bars);
   const wire={protocol:copy.protocol,sessionId:copy.sessionId,sequence:copy.sequence,response};
   if(stopped)throw Error('cancelled');return options.validate(owned.transform?owned.transform(wire,copy):wire,copy);});
  const result=Promise.race([work,stopPromise]).catch(error=>{cancel();throw error;});chain=result.catch(()=>{});return result;};
 return {id:options.id,promise:send(options.request),send,cancel};
}`;
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser", target: "es2020", write: false,
  logLevel: "silent", define: { "import.meta.env": "{}" }, plugins: [{ name: "condition-host-transport183", setup(api) {
    api.onResolve({ filter: /^virtual:pine-worker-url$/ }, () => ({ path: "worker", namespace: "virtual183" }));
    api.onLoad({ filter: /.*/, namespace: "virtual183" }, () => ({ contents: 'export default "/trusted-pine.js";', loader: "js" }));
    api.onLoad({ filter: /\/pineSandbox\.ts$/ }, () => ({ contents: transport, loader: "js", resolveDir: root + "frontend/src/lib" }));
  } }, createPineEnginePlugin()], stdin: { loader: "ts", resolveDir: root,
    contents: 'export * from "./frontend/src/lib/pineRuntime.ts";export {configure} from "./frontend/src/lib/pineSandbox.ts";' } })).outputFiles[0].text;
console.info("CONDITION_HOST183_BINDING " + JSON.stringify({ minified: true, actualHost: true, actualWorker: true,
  controlledTransportOnly: true, bundleSha256: createHash("sha256").update(bundle).digest("hex"),
  manifestSha256: createHash("sha256").update(fs.readFileSync("frontend/vendor/pinets/manifest.json")).digest("hex") }));
const host = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const origin = Date.UTC(2024, 0, 1) / 1000;
const candle = (i, close = 100 + i, span = 60) => ({ time: origin + i * span, open: 100,
  high: Math.max(103, close + 2), low: 97, close, volume: 10 + i });
const meta = timeframe => ({ symbol: "BINANCE:BTCUSDT", timeframe, mintick: .01, pointvalue: 1,
  mincontract: .001, quantityStep: .001, currency: "USDT", basecurrency: "BTC" });
const aggregate = (rows, seconds) => ({ time: Math.floor(rows[0].time / seconds) * seconds, open: rows[0].open,
  high: Math.max(...rows.map(bar => bar.high)), low: Math.min(...rows.map(bar => bar.low)), close: rows.at(-1).close,
  volume: rows.reduce((sum, bar) => sum + bar.volume, 0) });
const group = (rows, seconds) => {
  const buckets = new Map(); for (const bar of rows) { const key = Math.floor(bar.time / seconds);
    if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(bar); }
  return [...buckets.values()].map(rows => aggregate(rows, seconds));
};
const source = (body, declaration = 'indicator("Owned condition host183")') => `//@version=6\n${declaration}\n${body}`;
const input = extra => ({ source: source('alertcondition(close>110,"Threshold","")\nplot(close,"Price")'), inputs: {},
  bars: [candle(0), candle(1)], context: meta("1"), ...extra });
const fixture = extra => ({ commands: [], cancelled: 0, ...extra });
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const actual = result => { assert.equal(result.conditionSamples.samples.length, 1); assert.equal(result.conditionSamples.dropped, 0); return result.conditionSamples.samples[0]; };
const stream = { symbol: "BINANCE:BTCUSDT", timeframe: "1", epoch: 3 };
const event = (bar, sequence) => ({ ...stream, sequence, bar, confirmed: false,
  closeTime: (bar.time + 60) * 1000 - 1, eventTime: bar.time * 1000 + sequence });

test("returned start metadata and inputs cannot rewrite the private generated calculation clock or trusted condition definitions", async () => {
  const children = Array.from({ length: 10 }, (_, i) => candle(i, 100 + i, 180)), state = fixture(); host.configure(state);
  const raw = input({ context: meta("15"), bars: group(children, 900), sourceSnapshot: { timeframe: "3", bars: children },
    source: source('authored=input.timeframe("1","Timeframe",group="Calculation")\nalertcondition(close>110,"Threshold","")\nplot(close,"Price")',
      'indicator("Colliding calculation labels",timeframe="3",timeframe_gaps=false)') });
  const session = host.createPineLiveRuntimeSession(raw);
  try {
    const initial = await session.promise;
    assert.equal(initial.inputDefinitions[0].id, "in_0"); assert.equal(initial.calculationInputs.timeframeInputId, "in_1");
    initial.alertConditions[0].title = "Caller mutated";
    initial.calculationInputs.timeframeInputId = "in_0"; initial.calculationInputs.defaultTimeframe = "1";
    initial.inputs.in_1 = "1"; initial.inputs.in_0 = "60";
    const bar = candle(10, 150, 180), result = await session.update(aggregate([bar], 900), false, { bar, confirmed: true }, undefined, true);
    assert.equal(result.conditionSamples.calculationTimeframe, "3"); assert.equal(actual(result).barIndex, 10);
    assert.deepEqual(actual(result).bar, bar); assert.equal(actual(result).confirmed, true);
    assert.deepEqual(actual(result).conditions, [true]); assert.equal(result.alertConditions[0].title, "Threshold");
    assert.equal(state.cancelled, 0);
  } finally { session.cancel(); }
});

test("a collected update queued before startup resolves uses the freshly compiled owner and immutable captured candle", async () => {
  const entered = gate(), release = gate(), state = fixture({ gate(command) { if (command.action === "start") { entered.resolve(); return release.promise; } } });
  host.configure(state); const session = host.createPineLiveRuntimeSession(input());
  const bar = candle(2, 120), pending = session.update(bar, false, undefined, undefined, true);
  const original = structuredClone(bar); bar.close = 999; await entered.promise; release.resolve();
  try {
    const initial = await session.promise, result = await pending;
    assert.equal(Object.hasOwn(initial, "conditionSamples"), false); assert.deepEqual(actual(result).bar, original);
    assert.deepEqual(actual(result).conditions, [true]); assert.equal(state.commands[1].collectConditions, true);
    assert.equal(state.cancelled, 0);
  } finally { session.cancel(); }
});

test("queued source confirmation is bound per command even after the next source candle becomes unconfirmed", async () => {
  const entered = gate(), release = gate(), state = fixture({ gate(command) { if (command.action === "update" && command.sequence === 1) { entered.resolve(); return release.promise; } } });
  host.configure(state); const children = Array.from({ length: 10 }, (_, i) => candle(i, 100 + i, 180));
  const session = host.createPineLiveRuntimeSession(input({ context: meta("15"), bars: group(children, 900), sourceSnapshot: { timeframe: "3", bars: children },
    source: source('alertcondition(barstate.isconfirmed,"Closed","")\nplot(close,"Price")', 'indicator("Source clock",timeframe="3",timeframe_gaps=false)') }));
  await session.promise;
  const first = candle(10, 150, 180), second = candle(11, 151, 180);
  const closed = session.update(aggregate([first], 900), false, { bar: first, confirmed: true }, undefined, true);
  const open = session.update(aggregate([first, second], 900), false, { bar: second, confirmed: false }, undefined, true);
  await entered.promise; release.resolve();
  try {
    const confirmed = await closed, forming = await open;
    assert.equal(actual(confirmed).confirmed, true); assert.deepEqual(actual(confirmed).conditions, [true]);
    assert.equal(actual(forming).confirmed, false); assert.deepEqual(actual(forming).conditions, [false]);
    assert.equal(actual(confirmed).barIndex, 10); assert.equal(actual(forming).barIndex, 11);
    assert.equal(state.cancelled, 0);
  } finally { session.cancel(); }
});

test("a later queued remote revision cannot replace the ledger captured for an earlier main response", async () => {
  const entered = gate(), release = gate(), state = fixture({ gate(command) { if (command.action === "update" && command.sequence === 2) { entered.resolve(); return release.promise; } } });
  host.configure(state); const history = Array.from({ length: 10 }, (_, i) => candle(i));
  const session = host.createPineLiveRuntimeSession(input({ context: meta("5"), bars: group(history, 300), marketStreams: [stream],
    marketData: { provider: "binance", snapshots: [{ context: meta("1"), requestedTimeframe: "1", bars: history, asOf: origin + 600 }] },
    source: source('alertcondition(close>125,"Threshold","")\nplot(close,"Price")', 'indicator("Independent ledger",timeframe="1",timeframe_gaps=false)') }));
  await session.promise; const first = candle(10, 120); await session.updateMarkets([event(first, 1)]);
  const before = session.update(aggregate([first], 300), false, undefined, undefined, true);
  const second = { ...first, high: 132, close: 130, volume: first.volume + 1 }, later = session.updateMarkets([event(second, 2)]);
  await entered.promise; release.resolve();
  try {
    const result = await before; assert.equal(actual(result).bar.close, 120); assert.deepEqual(actual(result).conditions, [false]);
    assert.equal((await later).kind, "market-update");
    const latest = await session.update(aggregate([second], 300), false, undefined, undefined, true);
    assert.equal(actual(latest).bar.close, 130); assert.deepEqual(actual(latest).conditions, [true]);
    assert.equal(actual(result).bar.close, 120); assert.equal(state.cancelled, 0);
  } finally { session.cancel(); }
});

test("saved enum migration forwards the fifth collection flag and keeps genuine generated timeframe binding", async () => {
  const release = gate(), state = fixture({ prepareGate: release.promise }); host.configure(state);
  const raw = input({ bars: Array.from({ length: 120 }, (_, i) => candle(i)), inputs: { in_0: "Up" }, source: source(
    'enum Side\n    up="Up"\n    down="Down"\nselected=input.enum(Side.up,"Side")\nalertcondition(selected==Side.up,"Choice","")\nplot(close,"Price")',
    'indicator("Saved calculation",timeframe="60",timeframe_gaps=false)') });
  raw.inputMetadata = { kind: "prepare", source: raw.source, inputDefinitions: [
    { id: "in_0", type: "enum", name: "Side", defval: "Up", options: ["Up", "Down"] }] };
  const session = host.createPineLiveRuntimeSession(raw), pending = session.update(candle(120, 250), false, undefined, undefined, true);
  release.resolve();
  try {
    const initial = await session.promise, result = await pending;
    assert.equal(initial.inputs.in_0, "Side.up"); assert.equal(result.conditionSamples.calculationTimeframe, "60");
    assert.equal(actual(result).barIndex, 2); assert.equal(actual(result).bar.time, origin + 7200);
    assert.deepEqual(actual(result).conditions, [true]); assert.equal(state.commands[1].collectConditions, true);
    assert.equal(state.cancelled, 0);
  } finally { session.cancel(); }
});

test("wrong native bar metadata missing batch and unsolicited startup samples halt the actual host", async () => {
  for (const mutation of ["bar", "metadata", "missing", "unsolicited start"]) {
    const state = fixture({ transform(wire, command) {
      if (mutation === "unsolicited start" && command.action === "start") wire.response.result.conditionSamples = {
        chartTime: origin + 60, chartBarIndex: 1, calculationTimeframe: "1", samples: [], dropped: 0 };
      if (command.action === "update") {
        if (mutation === "bar") wire.response.result.conditionSamples.samples[0].bar.close = 119;
        if (mutation === "metadata") wire.response.result.alertConditions[0].title = "Untrusted response";
        if (mutation === "missing") delete wire.response.result.conditionSamples;
      }
      return wire;
    } });
    host.configure(state); const session = host.createPineLiveRuntimeSession(input());
    if (mutation === "unsolicited start") await assert.rejects(session.promise, error => error.code === "INVALID_LIVE_MESSAGE");
    else {
      await session.promise;
      await assert.rejects(session.update(candle(2, 120), false, undefined, undefined, true),
        error => ["INVALID_CONDITION_SAMPLES", "INVALID_LIVE_MESSAGE"].includes(error.code));
    }
    await assert.rejects(session.update(candle(2, 120), false), error => error.code === "LIVE_SESSION_HALTED");
    assert.equal(state.cancelled, 1);
  }
});
