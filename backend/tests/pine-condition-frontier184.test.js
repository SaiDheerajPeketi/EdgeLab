import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

// Only transport scheduling is controlled. Compilation, execution, queue
// admission, calculation selection and parent validation remain real.
Error.stackTraceLimit = 0;
const root = new URL("../../", import.meta.url).pathname;
const transport = `
import {createPineLiveExecutor,executePineRequest} from '../workers/pineNative.worker';
import {toPineWireResponse} from './pinePacked';
let fixture;
export function configure(value){fixture=value;}
export function createSandboxWorkerJob(options){let stopped=false;const owned=fixture;
 return {id:options.request.id,cancel(){stopped=true;},promise:Promise.resolve().then(async()=>{
  if(owned.prepareGate)await owned.prepareGate;if(stopped)throw Error('cancelled');
  return options.validate(toPineWireResponse(options.request.id,await executePineRequest(options.request),options.request.bars));})};}
export function createSandboxWorkerSession(options){
 const owned=fixture,executor=createPineLiveExecutor();let chain=Promise.resolve(),stopped=false,bars=options.request.request.bars;
 const send=command=>{const copy=structuredClone(command);owned.commands.push(copy);
  const work=chain.then(async()=>{if(owned.gate)await owned.gate(copy);if(stopped)throw Error('cancelled');
   const result=await executor.execute(copy);if(copy.action==='update')bars=copy.bar.time===bars.at(-1).time?[...bars.slice(0,-1),copy.bar]:[...bars,copy.bar];
   const id=copy.sessionId+':'+copy.sequence;
   return options.validate({protocol:copy.protocol,sessionId:copy.sessionId,sequence:copy.sequence,response:result.kind==='market-update'?{id,status:'completed',ack:result}:toPineWireResponse(id,result,bars)},copy);});
  chain=work.catch(()=>{});return work;};
 return {id:options.id,promise:send(options.request),send,cancel(){stopped=true;executor.dispose();}};}
`;
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser", target: "es2020", write: false,
  logLevel: "silent", define: { "import.meta.env": "{}" }, plugins: [{ name: "frontier184-transport", setup(api) {
    api.onResolve({ filter: /^virtual:pine-worker-url$/ }, () => ({ path: "worker", namespace: "frontier184" }));
    api.onLoad({ filter: /.*/, namespace: "frontier184" }, () => ({ contents: 'export default "/trusted-pine.js";', loader: "js" }));
    api.onLoad({ filter: /\/pineSandbox\.ts$/ }, () => ({ contents: transport, loader: "js", resolveDir: root + "frontend/src/lib" }));
  } }, createPineEnginePlugin()], stdin: { loader: "ts", resolveDir: root,
    contents: 'export * from "./frontend/src/lib/pineRuntime.ts";export * from "./frontend/src/lib/pineLiveMarketCoordinator.ts";export {configure} from "./frontend/src/lib/pineSandbox.ts";' } })).outputFiles[0].text;
console.info("CONDITION_FRONTIER184_BINDING " + JSON.stringify({ actualHost: true, actualWorker: true,
  controlledTransportOnly: true, minified: true, bundleSha256: createHash("sha256").update(bundle).digest("hex") }));
const host = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const origin = Date.UTC(2024, 0, 1) / 1000;
const bar = (i, close = 100 + i) => ({ time: origin + i * 60, open: 100,
  high: Math.max(103, close + 2), low: 97, close, volume: i + 10 });
const context = timeframe => ({ symbol: "BINANCE:BTCUSDT", timeframe, mintick: .01, pointvalue: 1,
  mincontract: .001, quantityStep: .001, currency: "USDT", basecurrency: "BTC" });
const group = rows => {
  const buckets = new Map();
  for (const row of rows) { const time = Math.floor(row.time / 300) * 300;
    if (!buckets.has(time)) buckets.set(time, []); buckets.get(time).push(row); }
  return [...buckets].map(([time, values]) => ({ time, open: values[0].open,
    high: Math.max(...values.map(row => row.high)), low: Math.min(...values.map(row => row.low)),
    close: values.at(-1).close, volume: values.reduce((sum, row) => sum + row.volume, 0) }));
};
const source = (declaration = 'indicator("Frontier184")', body = 'alertcondition(close>110,"Threshold","{{close}}")\nplot(close,"Price")') => `//@version=6\n${declaration}\n${body}`;
const input = extra => ({ source: source(), inputs: {}, context: context("1"), bars: [bar(0), bar(1)], ...extra });
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const setup = extra => { const fixture = { commands: [], ...extra }; host.configure(fixture); return fixture; };

test("fresh start only and latest queued frontier resist mutations to returned results and state", async () => {
  const startup = gate(), update = gate();
  setup({ gate: command => command.action === "start" ? startup.promise : update.promise });
  const session = host.createPineLiveRuntimeSession(input());
  assert.equal(session.readConditionState(), undefined);
  const first = session.update(bar(2), false), closed = session.update(bar(2), true), next = session.update(bar(3), false);
  startup.resolve();
  const initial = await session.promise;
  initial.alertConditions[0].title = "Caller tampering";
  const state = session.readConditionState();
  assert.equal(state.conditions[0].title, "Threshold"); assert.equal(state.timeframe, "1");
  assert.deepEqual(state.frontier, { time: origin + 180, confirmed: false });
  state.conditions[0].message = "Changed"; state.conditions.push({ id: "alertcondition_9", title: "Forged", message: "" });
  state.context.symbol = "BINANCE:ETHUSDT"; state.frontier.time = 0;
  const fresh = session.readConditionState();
  assert.equal(fresh.conditions.length, 1); assert.equal(fresh.conditions[0].message, "{{close}}");
  assert.equal(fresh.context.symbol, "BINANCE:BTCUSDT"); assert.equal(fresh.frontier.time, origin + 180);
  update.resolve(); await Promise.all([first, closed, next]);
  session.cancel(); assert.equal(session.readConditionState(), undefined);
});

test("selected native source frontier exceeds the chart index limit and owns confirmation", async () => {
  const held = gate(); setup({ gate: command => command.action === "update" ? held.promise : undefined });
  const rows = Array.from({ length: 20_005 }, (_, i) => bar(i));
  const session = host.createPineLiveRuntimeSession(input({ context: context("5"), bars: group(rows),
    sourceSnapshot: { timeframe: "1", bars: rows }, source: source('indicator("Native source",timeframe="1",timeframe_gaps=false)') }));
  await session.promise;
  const child = bar(20_005), pending = session.update(group([child])[0], false, { bar: child, confirmed: true });
  assert.deepEqual(session.readConditionState().frontier, { time: child.time, confirmed: true });
  assert.equal(session.readConditionState().timeframe, "1");
  held.resolve(); await pending; session.cancel();
});

test("independently queued remote tail is read with its own clock before the chart advances", async () => {
  const held = gate(); setup({ gate: command => command.action === "markets" ? held.promise : undefined });
  const rows = Array.from({ length: 10 }, (_, i) => bar(i));
  const stream = { symbol: "BINANCE:BTCUSDT", timeframe: "1", epoch: 3 };
  const session = host.createPineLiveRuntimeSession(input({ context: context("5"), bars: group(rows), marketStreams: [stream],
    marketData: { provider: "binance", snapshots: [{ context: context("1"), requestedTimeframe: "1", bars: rows, asOf: origin + 600 }] },
    source: source('indicator("Remote native",timeframe="1",timeframe_gaps=false)') }));
  await session.promise;
  const child = bar(10), pending = session.updateMarkets([{ ...stream, sequence: 1, bar: child, confirmed: false,
    closeTime: (child.time + 60) * 1000 - 1, eventTime: child.time * 1000 + 1 }]);
  assert.deepEqual(session.readConditionState().frontier, { time: child.time, confirmed: false });
  held.resolve(); await pending; session.cancel(); assert.equal(session.readConditionState(), undefined);
});

test("strategy startup cannot provide named indicator condition state", async () => {
  setup(); const session = host.createPineLiveRuntimeSession(input({ source: source('strategy("Strategy frontier")') }));
  await session.promise; assert.equal(session.readConditionState(), undefined); session.cancel();
});

test("saved enum migration forwards only fresh native metadata and queued calculation frontier", async () => {
  const held = gate(); setup({ prepareGate: held.promise });
  const raw = input({ source: source('indicator("Migrated frontier",timeframe="60",timeframe_gaps=false)',
    'enum Side\n    up="Up"\n    down="Down"\nchoice=input.enum(Side.up,"Side")\nalertcondition(choice==Side.up,"Fresh choice","")\nplot(close,"Price")'),
    inputs: { in_0: "Up" }, bars: Array.from({ length: 120 }, (_, i) => bar(i)) });
  raw.inputMetadata = { kind: "prepare", source: raw.source, alertConditions: [{ id: "alertcondition_0", title: "Cached forgery", message: "" }],
    inputDefinitions: [{ id: "in_0", type: "enum", name: "Side", defval: "Up", options: ["Up", "Down"] }] };
  const session = host.createPineLiveRuntimeSession(raw), pending = session.update(bar(120), false);
  assert.equal(session.readConditionState(), undefined); held.resolve();
  await session.promise; await pending;
  const state = session.readConditionState();
  assert.equal(state.conditions[0].title, "Fresh choice"); assert.equal(state.timeframe, "60");
  assert.deepEqual(state.frontier, { time: origin + 7200, confirmed: false });
  session.cancel(); assert.equal(session.readConditionState(), undefined);
});

test("coordinator forwards fresh state only after admission and while its source owner remains active", async () => {
  const held = gate(); setup({ gate: command => command.action === "start" ? held.promise : undefined });
  let owns = true; const controller = new AbortController();
  const pair = { signal: controller.signal, assertActive() { if (!owns || controller.signal.aborted) throw Error("retired"); },
    cancel() { controller.abort(); }, resolve() { throw Error("No foreign context was requested"); },
    transport: { drain: () => [], streams: () => [], subscribe: () => () => {}, failure: new Promise(() => {}) } };
  const raw = { ...input(), id: "coordinator-frontier184", action: "run", mode: "live" }, asOf = origin + 120;
  const coordinator = host.createPineLiveMarketCoordinator(raw,
    { provider: "binance", chartSymbol: "BTCUSDT", revision: "frontier184", range: { from: origin, to: asOf - 1 }, asOf, owns: () => owns }, 3,
    { createJob: request => host.createPineRuntimeJob(request), createSession: host.createPineLiveRuntimeSession,
      createResolver: () => pair, history() { throw Error("No history load was requested"); } });
  try {
    await coordinator.promise; const session = coordinator.start(raw);
    assert.ok(session); assert.equal(session.readConditionState(), undefined);
    held.resolve(); await session.promise;
    assert.deepEqual(session.readConditionState().frontier, { time: origin + 60, confirmed: true });
    owns = false; assert.equal(session.readConditionState(), undefined);
    owns = true; coordinator.cancel(); assert.equal(session.readConditionState(), undefined);
  } finally { held.resolve(); coordinator.cancel(); }
});
