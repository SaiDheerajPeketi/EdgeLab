import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { webcrypto } from "node:crypto";

const root = process.cwd();
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const bar = (time, close = 10) => ({ time, open: close, high: close + 1, low: close - 1, close, volume: 10 });
const A = { from: 60, to: 120 }, B = { from: 120, to: 180 }, C = { from: 180, to: 240 };
const result = (usesVisibleRange, value = 1) => ({ kind: "run", usesVisibleRange, value });

// Execute the production hook; only React scheduling, auth and session transport
// are controlled here. Native calculation is covered independently by worker tests.
let fixture;
const react = {
  useState(initial) { const index = fixture.cursor++; if (!(index in fixture.slots)) fixture.slots[index] = initial;
    return [fixture.slots[index], next => { fixture.slots[index] = typeof next === "function" ? next(fixture.slots[index]) : next; fixture.dirty = true; }]; },
  useRef(initial) { const index = fixture.cursor++; return fixture.slots[index] ??= { current: initial }; },
  useMemo(fn) { fixture.cursor++; return fn(); },
  useEffect(fn, deps) { const index = fixture.cursor++, old = fixture.effects[index];
    if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) fixture.pending.push(() => {
      old?.cleanup?.(); fixture.effects[index] = { deps, cleanup: fn() };
    }); },
};
globalThis.__viewportHook140 = { react, getAuth: () => fixture.auth,
  createJob: input => {
    const wait = deferred();
    const job = { input, ...wait, cancelled: false, cancel() { this.cancelled = true; } };
    fixture.preparations.push(job); return job;
  },
  createSession: input => {
    const initial = deferred();
    const session = { input, initial, promise: initial.promise, events: [], cancelled: false,
      update(candle, confirmed) { const wait = deferred(); this.events.push({ action: "update", candle, confirmed, ...wait }); return wait.promise; },
      setViewport(viewport) { const wait = deferred(); this.events.push({ action: "viewport", viewport, ...wait }); return wait.promise; },
      cancel() { this.cancelled = true; },
    };
    fixture.sessions.push(session); return session;
  },
};
const hookBundle = await build({ bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent",
  stdin: { contents: 'export {useLivePineRuntime} from "./frontend/src/components/chart/useLivePineRuntime";', resolveDir: root, loader: "ts" },
  plugins: [{ name: "live-hook-boundaries", setup(plugin) {
    plugin.onResolve({ filter: /^react$|authSession$|customIndicators$|pineRuntime$|pineLiveFeed$/ }, args => ({ path: args.path, namespace: "hook140" }));
    plugin.onLoad({ filter: /.*/, namespace: "hook140" }, ({ path }) => ({ contents:
      path === "react" ? 'const r=globalThis.__viewportHook140.react;export const useEffect=r.useEffect,useMemo=r.useMemo,useRef=r.useRef,useState=r.useState;' :
      path.endsWith("authSession") ? 'export const getStoredAuthSession=()=>globalThis.__viewportHook140.getAuth();' :
      path.endsWith("customIndicators") ? 'export const isPersistentPineIndicator=x=>!!x.customScriptSource;export const sanitizePinePrepared=(x,source)=>x?.source===source?x:undefined;export const pineContextForChart=(symbol,timeframe)=>({symbol,timeframe});' :
      path.endsWith("pineLiveFeed") ? 'export const pineFeedChartSnapshot=x=>x.chart;' :
      'export const createPineLiveRuntimeSession=x=>globalThis.__viewportHook140.createSession(x);export const createPineRuntimeJob=x=>globalThis.__viewportHook140.createJob(x);', loader: "js" }));
  } }],
});
const { useLivePineRuntime } = await import('data:text/javascript;base64,' + Buffer.from(hookBundle.outputFiles[0].text).toString('base64'));
function harness(configure) {
  const current = { epoch: 1, event: { sequence: 1 }, chart: { history: [bar(60), bar(120)], bar: bar(180), confirmed: false } };
  const listeners = new Set();
  const feed = { getSnapshot: () => current, subscribe(fn) { listeners.add(fn); fn(current); return () => listeners.delete(fn); } };
  fixture = { cursor: 0, slots: [], effects: [], pending: [], sessions: [], preparations: [], auth: { user: { id: 1 }, token: "owner1" }, dirty: false };
  const options = { feed, timeframe: "1m", symbol: "TEST", userId: 1, token: "owner1", viewport: A,
    indicators: [{ id: "dependent", visible: true, customScriptSource: "//@version=6\nindicator('Dependent')", settings: {} },
      { id: "ordinary", visible: true, customScriptSource: "//@version=6\nindicator('Ordinary')", settings: {} }] };
  configure?.(options, current);
  const render = () => { fixture.cursor = 0; fixture.pending = []; fixture.dirty = false; const output = useLivePineRuntime(options); for (const effect of fixture.pending) effect(); return output; };
  const settle = async () => { await flush(); return render(); };
  render();
  return { options, current, render, settle, get sessions() { return fixture.sessions; }, get preparations() { return fixture.preparations; },
    tick(close = 20, confirmed = false) { current.event.sequence++; current.chart = { ...current.chart, bar: bar(180, close), confirmed }; for (const fn of listeners) fn(current); },
    dispose() { for (const item of fixture.effects) item?.cleanup?.(); },
  };
}
async function warm(h) {
  for (let i = 0; i < 2; i++) { h.sessions[i].initial.resolve(result(i === 0)); h.sessions[i].events[0].resolve(result(i === 0)); }
  return h.settle();
}

test("ordinary live study retains session and result across viewport changes", async () => {
  const h = harness(), studies = await warm(h), ordinary = studies.find(x => x.sourceId === "ordinary");
  h.options.viewport = B;
  const next = h.render();
  assert.equal(next.find(x => x.sourceId === "ordinary").result, ordinary.result);
  assert.equal(next.some(x => x.sourceId === "dependent"), false);
  assert.equal(h.sessions.length, 2);
  assert.deepEqual(h.sessions[1].events.map(x => x.action), ["update"]);
  assert.deepEqual(h.sessions[0].events[1].viewport, B);
  h.dispose();
});

test("first held dependent result reruns latest viewport before publication", async () => {
  const h = harness();
  h.options.viewport = B; h.render();
  assert.equal(h.sessions[0].events.length, 1);
  h.sessions[0].initial.resolve(result(true));
  await flush();
  assert.deepEqual(h.sessions[0].events[1].viewport, B);
  h.sessions[0].events[0].resolve(result(true));
  assert.equal((await h.settle()).some(x => x.sourceId === "dependent"), false);
  h.sessions[0].events[1].resolve(result(true, 2));
  const next = await h.settle();
  assert.equal(next.find(x => x.sourceId === "dependent").result.value, 2);
  h.dispose();
});

test("viewport coalescing retains every ordered feed tick and withholds held old ranges", async () => {
  const h = harness(); await warm(h);
  h.options.viewport = B; h.render();
  h.options.viewport = C; h.render();
  h.tick(25); h.tick(30, true);
  assert.deepEqual(h.sessions[0].events.map(x => x.action), ["update", "viewport", "update", "update"]);
  h.sessions[0].events[1].resolve(result(true, 2));
  await flush();
  assert.deepEqual(h.sessions[0].events[4].viewport, C);
  h.sessions[0].events[2].resolve(result(true, 3)); h.sessions[0].events[3].resolve(result(true, 4));
  assert.equal((await h.settle()).some(x => x.sourceId === "dependent"), false);
  h.sessions[0].events[4].resolve(result(true, 5));
  assert.equal((await h.settle()).find(x => x.sourceId === "dependent").result.value, 5);
  assert.deepEqual(h.sessions[0].events.filter(x => x.action === "update").map(x => [x.candle.close, x.confirmed]), [[10, false], [25, false], [30, true]]);
  h.dispose();
});

test("latest bars and replacement owner prevent stale publication", async () => {
  const h = harness(); await warm(h);
  h.tick(25); h.tick(30);
  h.sessions[1].events[1].resolve(result(false, 25));
  assert.equal((await h.settle()).find(x => x.sourceId === "ordinary").result.value, 1);
  h.sessions[1].events[2].resolve(result(false, 30));
  assert.equal((await h.settle()).find(x => x.sourceId === "ordinary").result.value, 30);
  h.options.viewport = B; h.render();
  fixture.auth = { user: { id: 2 }, token: "owner2" };
  h.sessions[0].events.at(-1).resolve(result(true, 99));
  assert.deepEqual(await h.settle(), []);
  h.dispose(); assert.equal(h.sessions.every(x => x.cancelled), true);
});

test("source/epoch changes cancel owned sessions, absent viewport does not loop", async () => {
  const h = harness(); await warm(h);
  h.options.viewport = undefined; h.render();
  assert.equal(h.sessions[0].events[1].viewport, null);
  h.sessions[0].events[1].resolve(result(true)); await h.settle();
  assert.equal(h.sessions[0].events.length, 2);
  h.options.indicators = [{ ...h.options.indicators[0], customScriptSource: "changed", settings: {} }]; h.render();
  assert.equal(h.sessions[0].cancelled, true); assert.equal(h.sessions[1].cancelled, true);
  const replacement = h.sessions[2];
  h.current.epoch++; h.tick();
  assert.equal(replacement.cancelled, true);
  h.dispose();
});

function savedDependency(options, flag = true, source = options.indicators[0].customScriptSource) {
  options.indicators[0].settings.pineInputPrepared = { source, usesVisibleRange: flag };
}
async function warmOrdinary(h) {
  h.sessions[1].initial.resolve(result(false)); h.sessions[1].events[0].resolve(result(false));
  return h.settle();
}

test("known failed dependent recovers at a new range while ordinary owner remains intact", async () => {
  const h = harness(options => { options.viewport = null; savedDependency(options); });
  const ordinary = (await warmOrdinary(h)).find(x => x.sourceId === "ordinary");
  const failed = h.sessions[0];
  failed.initial.reject(new Error("Select visible candles"));
  const before = await h.settle();
  assert.equal(before.find(x => x.sourceId === "dependent").error, "Select visible candles");
  assert.equal(h.preparations.length, 0);
  h.options.viewport = B; h.render();
  assert.equal(h.sessions.length, 3);
  assert.equal(h.sessions[1].cancelled, false);
  const replacement = h.sessions[2];
  assert.deepEqual(replacement.input.viewport, B);
  assert.deepEqual(replacement.input.bars.map(x => x.time), [60, 120]);
  assert.deepEqual(replacement.events.map(x => [x.action, x.candle.time, x.confirmed]), [["update", 180, false]]);
  replacement.initial.resolve(result(true)); replacement.events[0].resolve(result(true, 7));
  const after = await h.settle();
  assert.equal(after.find(x => x.sourceId === "dependent").result.value, 7);
  assert.equal(after.find(x => x.sourceId === "ordinary").result, ordinary.result);
  h.dispose();
});

test("unknown failure learns only exact owned source and immediately recovers the already changed range", async () => {
  const h = harness(options => { savedDependency(options, true, "unrelated source"); });
  await warmOrdinary(h);
  h.options.viewport = B; h.render();
  h.sessions[0].initial.reject(new Error("Old range failure"));
  await h.settle();
  assert.equal(h.preparations.length, 1);
  assert.deepEqual(h.preparations[0].input, { action: "prepare", source: h.options.indicators[0].customScriptSource });
  h.preparations[0].resolve({ kind: "prepare", usesVisibleRange: true });
  await h.settle();
  assert.equal(h.sessions.length, 3);
  assert.deepEqual(h.sessions[2].input.viewport, B);
  h.dispose();
});

test("confirmed higher-timeframe recovery warms the closed current tail without a synthetic update", async () => {
  const h = harness((options, current) => {
    options.viewport = null; options.timeframe = "5m"; savedDependency(options);
    current.chart = { history: [bar(300), bar(600)], bar: bar(900, 30), confirmed: true };
  });
  await warmOrdinary(h);
  h.sessions[0].initial.reject(new Error("Empty range")); await h.settle();
  h.options.viewport = { from: 600, to: 900 }; h.render();
  const replacement = h.sessions[2];
  assert.deepEqual(replacement.input.bars.map(x => x.time), [300, 600, 900]);
  assert.deepEqual(replacement.events, []);
  replacement.initial.resolve(result(true, 9));
  assert.equal((await h.settle()).find(x => x.sourceId === "dependent").result.value, 9);
  h.current.chart = { history: [...h.current.chart.history, h.current.chart.bar], bar: bar(1200, 40), confirmed: false };
  h.tick(40);
  assert.equal(replacement.events.length, 1);
  assert.equal(replacement.events[0].confirmed, false);
  h.dispose();
});

test("cancelled entry callbacks cannot poison or publish into its replacement", async () => {
  const h = harness(options => savedDependency(options)); await warm(h);
  h.options.viewport = B; h.render();
  const old = h.sessions[0], failingRange = old.events[1];
  h.tick(25);
  h.options.viewport = C; h.render();
  failingRange.reject(new Error("Range B failure")); await h.settle();
  const replacement = h.sessions[2];
  assert.deepEqual(replacement.input.viewport, C);
  old.events[2].reject(new Error("Cancelled old tick")); await h.settle();
  assert.equal(replacement.cancelled, false);
  replacement.initial.resolve(result(true)); replacement.events[0].resolve(result(true, 42));
  assert.equal((await h.settle()).find(x => x.sourceId === "dependent").result.value, 42);
  h.dispose();
});

test("held unknown preparation is cancelled on source, epoch, auth and unmount ownership changes", async () => {
  for (const change of ["source", "epoch", "auth", "unmount"]) {
    const h = harness(); await warmOrdinary(h);
    h.sessions[0].initial.reject(new Error("Unknown failure")); await h.settle();
    const preparation = h.preparations[0];
    if (change === "source") { h.options.indicators = [{ ...h.options.indicators[0], customScriptSource: "new source", settings: {} }]; h.render(); }
    else if (change === "epoch") { h.current.epoch++; h.tick(); }
    else if (change === "auth") { h.options.userId = 2; h.options.token = "owner2"; fixture.auth = { user: { id: 2 }, token: "owner2" }; h.render(); }
    else h.dispose();
    assert.equal(preparation.cancelled, true, change);
    const count = h.sessions.length;
    preparation.resolve({ kind: "prepare", usesVisibleRange: true }); await flush();
    assert.equal(h.sessions.length, count, change);
    h.dispose();
  }
});

test("same failed range and known ordinary failures do not restart, failed preparation keeps the original error", async () => {
  const h = harness(options => savedDependency(options)); await warmOrdinary(h);
  h.sessions[0].initial.reject(new Error("Range A failure")); await h.settle();
  h.render(); h.tick(); await h.settle();
  assert.equal(h.sessions.length, 2); assert.equal(h.preparations.length, 0);
  h.dispose();
  const ordinary = harness(options => savedDependency(options, false)); await warmOrdinary(ordinary);
  ordinary.sessions[0].initial.reject(new Error("Ordinary failure")); await ordinary.settle();
  ordinary.options.viewport = B; ordinary.render();
  assert.equal(ordinary.sessions.length, 2); assert.equal(ordinary.preparations.length, 0);
  ordinary.dispose();
  const unknown = harness(); await warmOrdinary(unknown);
  unknown.sessions[0].initial.reject(new Error("Original calculation error")); await unknown.settle();
  unknown.preparations[0].reject(new Error("Preparation failed"));
  assert.equal((await unknown.settle()).find(x => x.sourceId === "dependent").error, "Original calculation error");
  unknown.options.viewport = B; unknown.render();
  assert.equal(unknown.sessions.length, 2); assert.equal(unknown.preparations.length, 1);
  unknown.dispose();
});

let transport;
globalThis.__viewportRuntime140 = { createSession: options => {
  transport = { options, commands: [], pending: [], cancel() { this.cancelled = true; },
    promise: Promise.resolve(result(false)), send(command) { this.commands.push(command); const wait = deferred(); this.pending.push(wait); return wait.promise; } };
  return transport;
} };
const runtimeBundle = await build({ bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent",
  stdin: { contents: 'export {createPineLiveRuntimeSession} from "./frontend/src/lib/pineRuntime";export {validatePineLiveRequest} from "./frontend/src/lib/pineLiveProtocol";', resolveDir: root, loader: "ts" },
  plugins: [{ name: "live-runtime-transport", setup(plugin) {
    plugin.onResolve({ filter: /^virtual:pine-worker-url$|pineSandbox$/ }, args => ({ path: args.path, namespace: "transport140" }));
    plugin.onLoad({ filter: /.*/, namespace: "transport140" }, ({ path }) => ({ contents: path.startsWith("virtual:") ? 'export default "/worker.js";' :
      'export const createSandboxWorkerSession=x=>globalThis.__viewportRuntime140.createSession(x);export const createSandboxWorkerJob=()=>{throw Error("Unexpected migration");};', loader: "js" }));
  } }],
});
const runtime = await import('data:text/javascript;base64,' + Buffer.from(runtimeBundle.outputFiles[0].text).toString('base64'));
globalThis.crypto ??= webcrypto;

test("production live client sequences viewport with ticks, retains confirmation and command-specific bounds", async () => {
  const session = runtime.createPineLiveRuntimeSession({ source: "//@version=6\nindicator('Runtime')", bars: [bar(60), bar(120)], context: { symbol: "TEST", timeframe: "1" }, viewport: A });
  await session.promise;
  const tick = session.update(bar(180), false);
  const range = session.setViewport(B);
  const closed = session.update(bar(180, 12), true);
  const next = session.update(bar(240, 15), false);
  assert.deepEqual(transport.commands.map(x => [x.sequence, x.action]), [[1, "update"], [2, "viewport"], [3, "update"], [4, "update"]]);
  assert.deepEqual(transport.commands[1].viewport, B);
  assert.deepEqual(transport.commands.filter(x => x.action === "update").map(x => [x.bar.time, x.confirmed]), [[180, false], [180, true], [240, false]]);
  assert.equal(transport.options.requestTimeoutMs(transport.commands[0]), 2000);
  assert.equal(transport.options.requestTimeoutMs(transport.commands[1]), 10000);
  for (const pending of transport.pending) pending.resolve(result(false));
  await Promise.all([tick, range, closed, next]); session.cancel();
});

test("viewport commands fail closed for missing, fractional, reversed and foreign fields", () => {
  const owner = { protocol: "pine-live-v1", sessionId: "live-viewport140-test", sequence: 1, action: "viewport" };
  for (const change of [{}, { viewport: undefined }, { viewport: { from: 1.5, to: 2 } }, { viewport: { from: 2, to: 1 } }, { viewport: A, bar: bar(60) }]) {
    assert.throws(() => runtime.validatePineLiveRequest({ ...owner, ...change }));
  }
  assert.equal(runtime.validatePineLiveRequest({ ...owner, viewport: null }).viewport, null);
  assert.deepEqual(runtime.validatePineLiveRequest({ ...owner, viewport: A }).viewport, A);
});
