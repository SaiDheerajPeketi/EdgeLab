import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

// Actual host facade, protocol and sealed worker; only sandbox message scheduling
// is controlled. Browser frame/CSP isolation is covered by existing sandbox gates.
Error.stackTraceLimit = 0;
const root = new URL("../../", import.meta.url).pathname;
const transport = `
import {createPineLiveExecutor,executePineRequest} from '../workers/pineNative.worker';
import {toPineWireResponse} from './pinePacked';
let fixture;
export function configure(value){fixture=value;}
export function createSandboxWorkerJob(options){let stopped=false;
 return {id:options.request.id,cancel(){stopped=true;},promise:Promise.resolve().then(async()=>{
   if(fixture.prepareGate)await fixture.prepareGate;
   if(stopped)throw Error('cancelled');return options.validate(toPineWireResponse(options.request.id,await executePineRequest(options.request),options.request.bars));})};}
export function createSandboxWorkerSession(options){
 const owned=fixture,executor=createPineLiveExecutor();let stopped=false,chain=Promise.resolve(),rejectStop;
 const stopPromise=new Promise((_,reject)=>{rejectStop=reject;});void stopPromise.catch(()=>{});
 let bars=options.request.request.bars;const cancel=()=>{if(stopped)return;stopped=true;owned.cancelled++;executor.dispose();rejectStop(Error('cancelled'));};
 const send=command=>{const copy=structuredClone(command);owned.commands.push(copy);owned.timeouts.push(options.requestTimeoutMs(copy));
   const work=chain.then(async()=>{if(stopped)throw Error('cancelled');if(owned.gate)await owned.gate(copy);
     if(stopped)throw Error('cancelled');const result=await executor.execute(copy);
     if(copy.action==='update')bars=copy.bar.time===bars.at(-1).time?[...bars.slice(0,-1),copy.bar]:[...bars,copy.bar];
     const id=copy.sessionId+':'+copy.sequence,response=result.kind==='market-update'?{id,status:'completed',ack:result}:toPineWireResponse(id,result,bars);
     const wire={protocol:copy.protocol,sessionId:copy.sessionId,sequence:copy.sequence,response};
     if(stopped)throw Error('cancelled');return options.validate(owned.transform?owned.transform(wire,copy):wire,copy);});
   const result=Promise.race([work,stopPromise]).catch(error=>{cancel();throw error;});chain=result.catch(()=>{});return result;};
 const promise=send(options.request);return {id:options.id,promise,send,cancel};
}`;
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser", target: "es2020", write: false, logLevel: "silent", define: { "import.meta.env": "{}" },
  plugins: [{ name: "controlled-sandbox-transport161", setup(api) {
    api.onResolve({ filter: /^virtual:pine-worker-url$/ }, () => ({ path: "worker", namespace: "virtual161" }));
    api.onLoad({ filter: /.*/, namespace: "virtual161" }, () => ({ contents: 'export default "/trusted-pine.js";', loader: "js" }));
    api.onLoad({ filter: /\/pineSandbox\.ts$/ }, () => ({ contents: transport, loader: "js", resolveDir: root + "frontend/src/lib" }));
  } }, createPineEnginePlugin()], stdin: { loader: "ts", resolveDir: root,
    contents: 'export * from "./frontend/src/lib/pineRuntime.ts";export {configure} from "./frontend/src/lib/pineSandbox.ts";' } })).outputFiles[0].text;
console.info("LIVE_HOST161_BINDING " + JSON.stringify({ minified: true, sealedWorker: true, controlledMessageTransport: true, bundleSha256: createHash("sha256").update(bundle).digest("hex") }));
const host = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const start = Date.parse("2024-01-01T00:00:00Z") / 1000;
const candle = (time, close = 100) => ({ time, open: 100, high: Math.max(101, close), low: Math.min(99, close), close, volume: 10 });
const context = symbol => ({ symbol, timeframe: "1", mintick: .01, mincontract: .001, pointvalue: 1, quantityStep: .001, currency: "USDT", basecurrency: symbol.includes("ETH") ? "ETH" : "BTC" });
const input = () => ({ source: '//@version=6\nindicator("Host ledger")\nvarip int ticks=0\nticks+=1\nplot(ticks,"Ticks")\nplot(close,"Price")', inputs: {},
  bars: [candle(start), candle(start + 60)], context: context("BINANCE:BTCUSDT"),
  marketData: { provider: "binance", snapshots: [{ context: context("BINANCE:ETHUSDT"), requestedTimeframe: "1", bars: [candle(start, 100), candle(start + 60, 101)], asOf: start + 120 }] },
  marketStreams: [{ symbol: "BINANCE:ETHUSDT", timeframe: "1", epoch: 4 }] });
const event = (sequence, close = 105, confirmed = false) => ({ symbol: "BINANCE:ETHUSDT", timeframe: "1", epoch: 4, sequence,
  bar: candle(start + 120, close), confirmed, closeTime: (start + 180) * 1000 - 1, eventTime: confirmed ? (start + 180) * 1000 : (start + 120) * 1000 + sequence * 100 });
const fixture = extra => ({ commands: [], timeouts: [], cancelled: 0, ...extra });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tail = (result, name) => result.plots.find(item => item.name === name).points.at(-1).value;

test("actual host owns each queued remote ledger acknowledgement and preserves initial/main histories", async () => {
  const state = fixture(); host.configure(state);
  const raw = input(), session = host.createPineLiveRuntimeSession(raw);
  try {
    const initial = await session.promise, held = structuredClone(initial);
    raw.marketStreams[0].epoch = 999; raw.marketData.snapshots[0].bars[0].close = 999;
    const first = event(1), second = event(2, 110), one = session.updateMarkets([first]), two = session.updateMarkets([second]);
    first.bar.close = 999; second.epoch = 999;
    const accepted = await one, next = await two;
    assert.equal(accepted.kind, "market-update"); assert.equal(accepted.streams[0].revision, 1); assert.equal(next.streams[0].revision, 2);
    assert.deepEqual(Object.keys(accepted).sort(), ["kind", "streams"]); assert.deepEqual(initial, held);
    const unchanged = await session.setViewport(null);
    assert.deepEqual(unchanged.plots, initial.plots); assert.equal(tail(unchanged, "Ticks"), 2);
    const main = await session.update(candle(start + 120, 107), false);
    assert.equal(tail(main, "Ticks"), 3); assert.equal(tail(main, "Price"), 107);
    assert.deepEqual(state.commands.map(item => item.action), ["start", "markets", "markets", "viewport", "update"]);
    assert.deepEqual(state.timeouts, [10000, 2000, 2000, 10000, 2000]);
    assert.equal(state.commands[1].events[0].bar.close, 105); assert.equal(state.commands[2].events[0].epoch, 4);
    assert.equal(state.cancelled, 0);
  } finally { session.cancel(); }
  assert.equal(state.cancelled, 1);
});

for (const mutation of ["session", "sequence", "revision", "chart output", "extra field", "accessor"]) test(`host rejects ${mutation} in remote acknowledgements and retires the session`, async () => {
  let accessed = false;
  const state = fixture({ transform(wire, command) {
    if (command.action !== "markets") return wire;
    if (mutation === "session") wire.sessionId = "unowned-market-session";
    if (mutation === "sequence") wire.sequence++;
    if (mutation === "revision") wire.response.ack.streams[0].revision++;
    if (mutation === "chart output") wire.response = { id: wire.response.id, status: "completed", result: { kind: "run" } };
    if (mutation === "extra field") wire.response.ack.streams[0].token = "must-not-transport";
    if (mutation === "accessor") Object.defineProperty(wire.response.ack.streams[0], "revision", { enumerable: true, get() { accessed = true; throw Error("must not read"); } });
    return wire;
  } });
  host.configure(state); const session = host.createPineLiveRuntimeSession(input());
  await session.promise;
  await assert.rejects(session.updateMarkets([event(1)]));
  await assert.rejects(session.update(candle(start + 120), false), error => error.code === "LIVE_SESSION_HALTED");
  assert.equal(accessed, false); assert.equal(state.cancelled, 1);
});

test("invalid second event is rejected before transport and cannot partially publish a valid first event", async () => {
  const state = fixture(); host.configure(state); const session = host.createPineLiveRuntimeSession(input());
  await session.promise;
  await assert.rejects(session.updateMarkets([event(1), { ...event(2), epoch: 5 }]), error => error.code === "INVALID_LIVE_MARKET");
  assert.equal(state.commands.length, 1); assert.equal(state.cancelled, 1);
  await assert.rejects(session.setViewport(null), error => error.code === "LIVE_SESSION_HALTED");
});

test("cancellation during controlled remote transport promptly rejects held acknowledgements", async () => {
  const entered = deferred(), release = deferred();
  const state = fixture({ gate(command) { if (command.action === "markets") { entered.resolve(); return release.promise; } } });
  host.configure(state); const session = host.createPineLiveRuntimeSession(input()); await session.promise;
  const pending = session.updateMarkets([event(1)]); await entered.promise;
  const rejected = assert.rejects(pending, /cancelled/); session.cancel(); await rejected;
  release.resolve(); await new Promise(done => setImmediate(done));
  assert.equal(state.cancelled, 1);
  await assert.rejects(session.updateMarkets([event(2)]), error => error.code === "LIVE_SESSION_HALTED");
});

test("saved enum migration captures the original source, input, native epoch and queued candle before preparation waits", async () => {
  const release = deferred(), state = fixture({ prepareGate: release.promise }); host.configure(state);
  const raw = input();
  raw.source = '//@version=6\nindicator("Saved enum")\nenum Side\n    up="Up"\n    down="Down"\nselected=input.enum(Side.up,"Side")\nplot(selected==Side.up?1:0,"Choice")';
  raw.inputs = { in_0: "Up" };
  raw.inputMetadata = { kind: "prepare", source: raw.source, inputDefinitions: [{ id: "in_0", type: "enum", name: "Side", defval: "Up", options: ["Up", "Down"] }] };
  const original = raw.source, session = host.createPineLiveRuntimeSession(raw), first = event(1);
  const accepted = session.updateMarkets([first]);
  raw.source = input().source; raw.marketStreams[0].epoch = 999; raw.inputs.in_0 = "Down";
  raw.marketData.snapshots[0].bars[0].close = 999; raw.inputMetadata.inputDefinitions[0].type = "string";
  first.bar.close = 999; first.epoch = 999;
  release.resolve();
  try {
    const initial = await session.promise, receipt = await accepted;
    assert.equal(initial.source, original); assert.equal(initial.inputs.in_0, "Side.up"); assert.equal(tail(initial, "Choice"), 1);
    assert.equal(receipt.streams[0].epoch, 4); assert.equal(receipt.streams[0].revision, 1);
    assert.equal(state.commands[0].request.marketData.snapshots[0].bars[0].close, 100);
    assert.equal(state.commands[1].events[0].bar.close, 105);
  } finally { session.cancel(); }
});
