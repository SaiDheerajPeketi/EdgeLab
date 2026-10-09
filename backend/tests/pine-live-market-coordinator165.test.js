import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser", write: false, target: "es2020", logLevel: "silent",
  define: { "import.meta.env": "{}" }, plugins: [createPineEnginePlugin()], stdin: { loader: "ts", resolveDir: process.cwd(), sourcefile: "pine-live-market-coordinator165.ts", contents:
    'export * from "./frontend/src/lib/pineLiveMarketCoordinator.ts"; export * from "./frontend/src/lib/pineLiveMarketTransport.ts"; export {loadBinanceRequestHistory} from "./frontend/src/lib/binanceChartFeed.ts"; export * from "./frontend/src/workers/pineNative.worker.ts"; export {setStoredAuthSession,clearStoredAuthSession} from "./frontend/src/lib/authSession.ts";' } })).outputFiles[0].text;
console.info("LIVE_COORDINATOR165_BINDING " + JSON.stringify({ minified: true, actualWorker: true, actualResolver: true,
  bundleSha256: createHash("sha256").update(bundle).digest("hex"), manifestSha256: createHash("sha256").update(fs.readFileSync("frontend/vendor/pinets/manifest.json")).digest("hex") }));
let instance = 0;
const fresh = () => import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64") + "#" + ++instance);
const origin = Math.floor(Date.parse("2024-01-01T00:00:00Z") / 25200000) * 25200;
assert.equal(origin % 3600, 0); assert.equal(origin % 420, 0);
const bar = (minute, close = 10 + minute) => ({ time: origin + minute * 60, open: close - 1, high: close + 2, low: close - 2, close, volume: minute + 1 });
const metadata = { symbol: "BINANCE:BTCUSDT", timeframe: "1", mintick: .01, pointvalue: 1, mincontract: 1, quantityStep: 1, currency: "USDT", basecurrency: "BTC" };
const script = body => '//@version=6\nindicator("Coordinator165",dynamic_requests=true)\n' + body;
const body = 'varip int n=0\nn+=1\nplot(n,"Main executions")\nplot(request.security("ETHUSDT","1",close),"Remote")';
const input = (extra = {}) => ({ id: "coordinator165", action: "run", mode: "live", source: script(body), inputs: {}, context: metadata,
  bars: [0, 1, 2].map(i => bar(i)), ...extra });
const values = (result, name) => result.plots.find(plot => plot.name === name).points.map(point => point.value);
const tail = (result, name) => values(result, name).at(-1);
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const startAfterRealLoad = async (coordinator, request) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    await new Promise(resolve => setImmediate(resolve));
    const session = coordinator.start(request);
    if (session) return session;
  }
  assert.fail("The actual additional market history never completed startup.");
};
const session = id => ({ createdAt: new Date().toISOString(), expiresAt: "2099-01-01T00:00:00Z", token: "private165-" + id,
  user: { id, email: "owner@example.test", name: "Owner", provider: "google", approved: false, betaPosition: null, workspaceAccess: true,
    accessExpiresAt: "2099-01-01T00:00:00Z", deploymentMode: "production", plan: "pro", isBetaUser: false } });
const instrument = symbol => ({ symbol, label: symbol, description: symbol, status: "TRADING", asset_class: "crypto", base_asset: symbol.slice(0, -4),
  quote_asset: "USDT", tick_size: .01, min_quantity: 1, quantity_step: 1 });
class Socket extends EventTarget {
  constructor(url) { super(); this.url = url; this.closed = 0; this.callbacks = new Map(); }
  addEventListener(type, callback, options) { if (!this.callbacks.has(type)) this.callbacks.set(type, new Set()); this.callbacks.get(type).add(callback); super.addEventListener(type, callback, options); }
  removeEventListener(type, callback, options) { this.callbacks.get(type)?.delete(callback); super.removeEventListener(type, callback, options); }
  emit(type, data) { const event = new Event(type); if (data !== undefined) Object.defineProperty(event, "data", { value: data }); this.dispatchEvent(event); }
  close() { this.closed++; }
  open() { this.emit("open"); }
  tick(minute = 3, close, confirmed = false, step = 1) {
    const symbol = this.url.includes("solusdt") ? "SOLUSDT" : "ETHUSDT", base = (symbol === "SOLUSDT" ? 200 : 100) + minute; close ??= base;
    this.emit("message", JSON.stringify({ e: "kline", s: symbol, E: confirmed ? (origin + (minute + 1) * 60) * 1000 - 1 : (origin + minute * 60) * 1000 + step,
      k: { s: symbol, i: "1m", t: (origin + minute * 60) * 1000, T: (origin + (minute + 1) * 60) * 1000 - 1, x: confirmed,
        o: String(base - 1), h: String(Math.max(base, close) + 2), l: String(Math.min(base, close) - 2), c: String(close), v: String(minute + step) } }));
  }
}

async function harness(run) {
  const old = { window: globalThis.window, fetch: globalThis.fetch }, storage = new Map(), window = new EventTarget(), listeners = new Map();
  const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
  window.addEventListener = (type, callback, options) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); add(type, callback, options); };
  window.removeEventListener = (type, callback, options) => { listeners.get(type)?.delete(callback); remove(type, callback, options); };
  window.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
  window.location = { origin: "https://edgelab.test" }; globalThis.window = window;
  const api = await fresh(); api.setStoredAuthSession(session(1));
  const census = () => [...listeners.values()].reduce((sum, list) => sum + list.size, 0), baseline = census();
  const sockets = [], socketsReady = [], http = [], workers = [], live = [], coordinators = []; let fetchHook, workerGate, sessionGate, holdHistory;
  globalThis.fetch = async (url, init = {}) => {
    const entry = { url: new URL(String(url), window.location.origin), signal: init.signal, headers: new Headers(init.headers), credentials: init.credentials, redirect: init.redirect };
    http.push(entry);
    if (fetchHook) { const overridden = await fetchHook(entry); if (overridden !== undefined) return overridden; }
    if (entry.url.pathname.includes("instruments")) { assert.equal(entry.headers.get("Authorization"), "Bearer private165-1"); return Response.json({ instruments: [instrument(entry.url.searchParams.get("search"))] }); }
    assert.equal(entry.url.origin, "https://data-api.binance.vision"); assert.equal(entry.headers.has("Authorization"), false); assert.equal(entry.credentials, "omit"); assert.equal(entry.redirect, "error");
    assert.equal(entry.url.searchParams.get("interval"), "1m");
    if (holdHistory) await holdHistory.promise;
    if (entry.signal.aborted) throw new DOMException("Retired HTTP", "AbortError");
    const symbol = entry.url.searchParams.get("symbol"), query = entry.url.searchParams;
    return Response.json(Array.from({ length: 400 }, (_, minute) => bar(minute, (symbol === "SOLUSDT" ? 200 : 100) + minute))
      .filter(bar => bar.time * 1000 >= Number(query.get("startTime")) && bar.time * 1000 <= Number(query.get("endTime")))
      .slice(0, Number(query.get("limit"))).map(bar => [bar.time * 1000, ...[bar.open, bar.high, bar.low, bar.close, bar.volume].map(String), (bar.time + 60) * 1000 - 1]));
  };
  const createSession = received => {
    const executor = api.createPineLiveExecutor(), id = "real-coordinator165-" + (live.length + 1), { marketStreams, ...request } = received;
    let sequence = 0, cancelled = false;
    const record = { request: structuredClone(request), bindings: structuredClone(marketStreams), commands: [], results: [] }; live.push(record);
    const promise = executor.execute({ protocol: "pine-live-v1", sessionId: id, sequence: 0, action: "start", marketStreams, request: { ...request, id: id + ":0" } })
      .then(async result => { record.results.push(result); if (sessionGate) await sessionGate.promise; return result; });
    let chain = promise;
    const send = command => {
      const next = { protocol: "pine-live-v1", sessionId: id, sequence: ++sequence, ...command };
      record.commands.push(structuredClone(next));
      const result = chain.then(() => { if (cancelled) throw new DOMException("Cancelled actual session", "AbortError"); return executor.execute(next); });
      chain = result; void chain.catch(() => {}); return result.then(value => { record.results.push(value); return value; });
    };
    return { id, promise, cancel() { cancelled = true; executor.dispose(); }, update: (bar, confirmed, source, collectAlerts, collectConditions) => send({ action: "update", bar, confirmed,
      ...(source ? { source } : {}), ...(collectAlerts !== undefined ? { collectAlerts } : {}), ...(collectConditions !== undefined ? { collectConditions } : {}) }),
      setViewport: viewport => send({ action: "viewport", viewport }), updateMarkets: events => send({ action: "markets", events }) };
  };
  const create = (initial = input(), owns = () => true) => {
    const asOf = initial.bars.at(-1).time + Number(initial.context.timeframe) * 60;
    const coordinator = api.createPineLiveMarketCoordinator(initial, { provider: "binance", chartSymbol: "BTCUSDT", revision: "coordinator165", range: { from: initial.bars[0].time, to: asOf - 1 }, asOf, owns }, 3,
      { createJob(request) { const record = { request: structuredClone(request), cancelled: false }; workers.push(record);
        return { cancel() { record.cancelled = true; }, promise: (async () => { if (workerGate) await workerGate.promise; if (record.cancelled) throw new DOMException("Cancelled actual job", "AbortError"); return api.executePineRequest(request); })() }; },
        createSession, history: api.loadBinanceRequestHistory, createResolver: (scope, epoch) => api.createPineLiveMarketDataResolver(scope, epoch, { transport: { socket(url) {
          const socket = new Socket(url), index = sockets.length; sockets.push(socket); socketsReady[index]?.resolve(socket); return socket;
        } } }) });
    coordinators.push(coordinator); return coordinator;
  };
  const waitSocket = index => { if (sockets[index]) return Promise.resolve(sockets[index]); socketsReady[index] ??= gate(); return socketsReady[index].promise; };
  try { await run({ api, create, waitSocket, sockets, http, workers, live, census, baseline, workerGate: value => { workerGate = value; }, sessionGate: value => { sessionGate = value; }, holdHistory: value => { holdHistory = value; }, fetch: value => { fetchHook = value; } }); }
  finally { for (const coordinator of coordinators) coordinator.cancel(); api.clearStoredAuthSession(); globalThis.fetch = old.fetch; if (old.window === undefined) delete globalThis.window; else globalThis.window = old.window; }
}

test("evaluated discovery never fetches a dead foreign name or regex-like source comment", async () => {
  await harness(async ({ create, sockets, http, workers, live }) => {
    const initial = input({ source: script('// request.security("SOLUSDT","1",close)\nif false\n    unused=request.security("SOLUSDT","1",close)\nplot(close,"Main")') });
    const coordinator = create(initial); await coordinator.promise;
    assert.equal(sockets.length, 0); assert.equal(http.length, 0); assert.equal(workers.length, 1); assert.equal(workers[0].request.mode, "historical");
    const actual = coordinator.start(initial); assert.ok(actual); const result = await actual.promise;
    assert.deepEqual(values(result, "Main"), [10, 11, 12]); assert.equal(live.length, 1);
  });
});

test("actual REST bridge requires a fresh primary cutoff and rebases old native transport sequence without inventing live history", async () => {
  await harness(async ({ create, waitSocket, http, live, holdHistory }) => {
    const held = gate(); holdHistory(held);
    const initial = input(), coordinator = create(initial), socket = await waitSocket(0); socket.open(); socket.tick(5, 200);
    assert.equal(coordinator.start({ ...initial, bars: [...initial.bars, bar(3), bar(4)] }), undefined);
    socket.tick(5, 200, true, 2); socket.tick(6, 210, true, 3); socket.tick(7, 220, false, 4);
    held.resolve(); await coordinator.promise;
    assert.equal(coordinator.start(initial), undefined); assert.equal(live.length, 0);
    assert.ok(http.some(entry => entry.url.pathname.includes("klines") && entry.url.searchParams.get("startTime") === String((origin + 180) * 1000)
      && entry.url.searchParams.get("endTime") === String((origin + 5 * 60 - 1) * 1000)));
    const fresh = { ...initial, bars: Array.from({ length: 7 }, (_, i) => bar(i)) }, actual = coordinator.start(fresh); assert.ok(actual);
    const warm = await actual.promise; assert.deepEqual(values(warm, "Main executions"), [1, 2, 3, 4, 5, 6, 7]);
    const sampled = await actual.update(bar(7), false); assert.equal(tail(sampled, "Main executions"), 8); assert.equal(tail(sampled, "Remote"), 220);
    const firstRemote = live[0].commands.find(command => command.action === "markets");
    assert.equal(firstRemote.events.length, 1); assert.equal(firstRemote.events[0].bar.time, origin + 7 * 60); assert.equal(firstRemote.events[0].sequence, 1);
    const closed = live[0].request.marketData.snapshots[0].bars;
    assert.deepEqual(closed.map(bar => bar.time), Array.from({ length: 7 }, (_, i) => origin + i * 60));
    assert.deepEqual(closed.map(bar => bar.close), [100, 101, 102, 103, 104, 200, 210]);
    assert.deepEqual(values(warm, "Main executions"), [1, 2, 3, 4, 5, 6, 7]);
  });
});

test("held actual warmup flushes remote and primary commands in their genuine receipt order", async () => {
  await harness(async ({ create, waitSocket, sessionGate, live }) => {
    const initial = input(), coordinator = create(initial), socket = await waitSocket(0); socket.open(); socket.tick(); await coordinator.promise;
    const held = gate(); sessionGate(held); const actual = coordinator.start(initial); assert.ok(actual);
    const first = actual.update(bar(3), false); socket.tick(3, 110, false, 2); const second = actual.update(bar(3, 14), false);
    assert.equal(live[0].commands.length, 0); held.resolve(); const warm = await actual.promise;
    const [a, b] = await Promise.all([first, second]); assert.equal(tail(a, "Main executions"), 4); assert.equal(tail(a, "Remote"), 103);
    assert.equal(tail(b, "Main executions"), 5); assert.equal(tail(b, "Remote"), 110);
    assert.deepEqual(live[0].commands.map(command => command.action), ["markets", "update", "markets", "update"]);
    assert.deepEqual(values(warm, "Main executions"), [1, 2, 3]);
  });
});

test("queued condition collection survives genuine market warmup and samples each awaited foreign receipt without arming quiet updates", async () => {
  await harness(async ({ create, waitSocket, sessionGate, live }) => {
    const initial = input({ source: script('remote=request.security("ETHUSDT","1",close)\nalertcondition(remote>105,"Remote threshold","")\nplot(remote,"Remote")') });
    const coordinator = create(initial), socket = await waitSocket(0); socket.open(); socket.tick(); await coordinator.promise;
    const held = gate(); sessionGate(held); const actual = coordinator.start(initial); assert.ok(actual);
    const first = actual.update(bar(3), false, undefined, undefined, true);
    socket.tick(3, 110, false, 2); const quiet = actual.update(bar(3, 14), false);
    socket.tick(3, 111, false, 3); const second = actual.update(bar(3, 15), false, undefined, undefined, true);
    assert.equal(live[0].commands.length, 0); held.resolve(); const warm = await actual.promise;
    const [a, unarmed, b] = await Promise.all([first, quiet, second]);
    assert.equal(Object.hasOwn(warm, "conditionSamples"), false); assert.equal(Object.hasOwn(unarmed, "conditionSamples"), false);
    for (const [result, price, condition] of [[a, 103, false], [b, 111, true]]) {
      assert.equal(result.conditionSamples.chartTime, origin + 180); assert.equal(result.conditionSamples.chartBarIndex, 3);
      assert.equal(result.conditionSamples.samples.length, 1); assert.equal(result.conditionSamples.dropped, 0);
      assert.deepEqual(result.conditionSamples.samples[0].conditions, [condition]);
      assert.deepEqual(result.conditionSamples.samples[0].plots.numbered, [price]); assert.equal(tail(result, "Remote"), price);
    }
    assert.equal(tail(unarmed, "Remote"), 110);
    assert.deepEqual(live[0].commands.map(command => command.action), ["markets", "update", "markets", "update", "markets", "update"]);
    assert.deepEqual(live[0].commands.filter(command => command.action === "update").map(command => command.collectConditions), [true, undefined, true]);
    assert.deepEqual(a.conditionSamples.samples[0].conditions, [false]);
  });
});

test("real forming requested HTF prefix learns an additional evaluated symbol during live warmup and retries without primary replay", async () => {
  await harness(async ({ api, create, waitSocket, live, sockets, holdHistory }) => {
    const text = 'varip int n=0\nn+=1\nplot(n,"Main executions")\nhtf=request.security("ETHUSDT","7",close)\nselected=htf>230?"SOLUSDT":"ETHUSDT"\nplot(htf,"HTF")\nplot(request.security(selected,"1",close),"Selected")';
    const initial = input({ source: script(text), context: { ...metadata, timeframe: "60" }, bars: [bar(0, 10), bar(60, 11)] });
    const coordinator = create(initial), eth = await waitSocket(0); eth.open(); eth.tick(137, 250); await coordinator.promise;
    assert.equal(sockets.length, 1); const fresh = { ...initial, bars: [...initial.bars, bar(120, 12)] };
    const held = gate(); holdHistory(held);
    const first = coordinator.start(fresh); assert.ok(first);
    const reloading = assert.rejects(first.promise, error => error.code === api.PINE_MARKETS_RELOADING);
    const sol = await waitSocket(1); sol.open(); sol.tick(137, 350); await reloading;
    first.cancel(); coordinator.assertActive();
    assert.equal(coordinator.start(fresh), undefined);
    for (let i = 0; i < 40; i++) await assert.rejects(first.update(bar(180, 13 + i), false), error => error.code === api.PINE_MARKETS_RELOADING);
    coordinator.assertActive(); assert.equal(live[0].commands.length, 0);
    held.resolve(); const second = await startAfterRealLoad(coordinator, fresh);
    let warm;
    try { warm = await second.promise; }
    catch (error) { console.info("ADDITIONAL_CONTEXT_WARMUP165", JSON.stringify({ code: error.code, sessions: live.map(item => ({ bindings: item.bindings,
      snapshots: item.request.marketData.snapshots.map(snapshot => ({ symbol: snapshot.context.symbol, requestedTimeframe: snapshot.requestedTimeframe, timeframe: snapshot.context.timeframe,
        count: snapshot.bars.length, tail: snapshot.bars.at(-1), asOf: snapshot.asOf })), commands: item.commands.map(command => command.action), results: item.results.length })) })); throw error; }
    // Main warmup is historical: native minutes 133..136 do not close their 7-minute candle.
    // The last complete child ends at 133, so its final constituent is minute 132.
    const lastCompleteRequestedMinute = Math.floor(137 / 7) * 7 - 1;
    assert.equal(tail(warm, "HTF"), 100 + lastCompleteRequestedMinute); assert.equal(tail(warm, "Selected"), 336);
    assert.deepEqual(values(warm, "Main executions"), [1, 2, 3]);
    let tick;
    try { tick = await second.update(bar(180, 13), false); }
    catch (error) { console.info("ADDITIONAL_CONTEXT_TICK165", JSON.stringify({ code: error.code, actions: live[1].commands.map(command => command.action), warmHTF: tail(warm, "HTF"), warmSelected: tail(warm, "Selected") })); throw error; }
    assert.equal(tail(tick, "Main executions"), 4); assert.equal(tail(tick, "Selected"), 350);
    assert.equal(live.length, 2); assert.equal(live[0].commands.length, 0);
  });
});

test("initial source and input copies survive caller mutation while fresh mismatched ownership cannot start", async () => {
  await harness(async ({ create, workerGate, waitSocket, workers }) => {
    const held = gate(); workerGate(held);
    const original = input({ source: script('n=input.int(2,"Multiplier")\nplot(request.security("ETHUSDT","1",close)*n,"Remote")'), inputs: { in_0: 2 } }), fresh = structuredClone(original);
    const coordinator = create(original); original.source = script('plot(close,"Changed")'); original.inputs.in_0 = 9;
    workerGate(undefined); held.resolve(); const socket = await waitSocket(0); socket.open(); socket.tick(); await coordinator.promise;
    assert.equal(workers[0].request.source, fresh.source); assert.equal(workers[0].request.inputs.in_0, 2);
    assert.throws(() => coordinator.start(original), error => error.code === "INVALID_LIVE_MARKET");
    const actual = coordinator.start(fresh); assert.ok(actual); const warm = await actual.promise; assert.equal(tail(warm, "Remote"), 204);
  });
});

test("viewport discovery loads a previously unevaluated foreign symbol and restarts without replaying primary ticks captured while loading", async () => {
  await harness(async ({ api, create, waitSocket, live, sockets, holdHistory }) => {
    const text = body + `\nif chart.left_visible_bar_time>${origin * 1000}\n    plot(request.security("SOLUSDT","1",close),"Viewport market")`;
    const initial = input({ source: script(text), viewport: { from: origin, to: origin + 120 } });
    const coordinator = create(initial), eth = await waitSocket(0); eth.open(); eth.tick(); await coordinator.promise;
    const actual = coordinator.start(initial); assert.ok(actual); const original = await actual.promise;
    assert.deepEqual(values(original, "Main executions"), [1, 2, 3]); assert.equal(sockets.length, 1);
    const held = gate(); holdHistory(held);
    const viewport = { from: origin + 60, to: origin + 120 };
    const reloading = assert.rejects(actual.setViewport(viewport), error => error.code === api.PINE_MARKETS_RELOADING);
    const sol = await Promise.race([waitSocket(1), reloading.then(() => waitSocket(1))]); sol.open(); sol.tick(3, 250); await reloading;
    assert.equal(coordinator.start({ ...initial, viewport }), undefined);
    for (let i = 0; i < 40; i++) await assert.rejects(actual.update(bar(3, 20 + i), false), error => error.code === api.PINE_MARKETS_RELOADING);
    coordinator.assertActive(); actual.cancel(); held.resolve();
    const restarted = await startAfterRealLoad(coordinator, { ...initial, viewport }); const rebuilt = await restarted.promise;
    assert.deepEqual(values(rebuilt, "Main executions"), [1, 2, 3]); assert.equal(tail(rebuilt, "Viewport market"), 202);
    assert.equal(live.length, 2); assert.deepEqual(live[0].commands.map(command => command.action), ["markets", "viewport"]);
    const sampled = await restarted.update(bar(3, 13), false);
    assert.equal(tail(sampled, "Main executions"), 4); assert.equal(tail(sampled, "Viewport market"), 250);
    assert.deepEqual(values(original, "Main executions"), [1, 2, 3]);
  });
});

for (const transition of ["cancel", "auth ABA", "source ownership"]) test(`${transition} during the first actual-worker await never opens transports or publishes startup`, async () => {
  await harness(async ({ api, create, workerGate, sockets, workers, census, baseline }) => {
    const held = gate(); workerGate(held); let owned = true;
    const coordinator = create(input(), () => owned), rejected = assert.rejects(coordinator.promise, error => error.name === "AbortError");
    if (transition === "cancel") coordinator.cancel();
    else if (transition === "auth ABA") { api.setStoredAuthSession(session(2), { notify: false }); api.setStoredAuthSession(session(1), { notify: false }); }
    else owned = false;
    held.resolve(); await rejected; assert.equal(sockets.length, 0); assert.equal(workers.length, 1); assert.equal(census(), baseline);
    assert.throws(() => coordinator.start(input()));
  });
});

test("auth ABA during actual held history cancels the native socket and REST without restoring the old owner", async () => {
  await harness(async ({ api, create, waitSocket, holdHistory, http, live, census, baseline }) => {
    const held = gate(); holdHistory(held);
    const coordinator = create(input()), rejected = assert.rejects(coordinator.promise, error => error.name === "AbortError");
    const socket = await waitSocket(0); socket.open(); socket.tick();
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(http.some(entry => entry.url.pathname.includes("klines")));
    api.setStoredAuthSession(session(2), { notify: false }); api.setStoredAuthSession(session(1), { notify: false });
    held.resolve(); await rejected;
    assert.equal(live.length, 0); assert.equal(census(), baseline); assert.ok(socket.closed > 0);
    assert.ok([...socket.callbacks.values()].every(listeners => listeners.size === 0)); assert.ok(http.every(entry => entry.signal.aborted));
    assert.throws(() => coordinator.start(input()), error => error.name === "AbortError");
  });
});

test("later additional history failure remains fatal after the earlier reload notice", async () => {
  await harness(async ({ api, create, waitSocket, fetch, sockets, live, census, baseline }) => {
    const text = 'plot(request.security("ETHUSDT","7",close),"HTF")\nif request.security("ETHUSDT","7",close)>230\n    plot(request.security("SOLUSDT","1",close),"Selected")';
    const initial = input({ source: script(text), context: { ...metadata, timeframe: "60" }, bars: [bar(0, 10), bar(60, 11)] });
    const coordinator = create(initial), eth = await waitSocket(0); eth.open(); eth.tick(137, 250); await coordinator.promise;
    const fresh = { ...initial, bars: [...initial.bars, bar(120, 12)] };
    fetch(entry => entry.url.pathname.includes("klines") && entry.url.searchParams.get("symbol") === "SOLUSDT" ? new Response("Provider unavailable", { status: 502 }) : undefined);
    const actual = coordinator.start(fresh); assert.ok(actual);
    const reloading = assert.rejects(actual.promise, error => error.code === api.PINE_MARKETS_RELOADING);
    const loadFailed = error => error.message === "Requested symbol history could not be loaded. Retry the indicator.";
    const failed = assert.rejects(coordinator.failure, loadFailed);
    const sol = await waitSocket(1); sol.open(); sol.tick(137, 350);
    await reloading; await failed;
    assert.throws(() => coordinator.assertActive(), loadFailed);
    assert.equal(live.length, 1); assert.equal(live[0].commands.length, 0); assert.equal(census(), baseline);
    assert.ok(sockets.every(socket => socket.closed > 0 && [...socket.callbacks.values()].every(listeners => listeners.size === 0)));
  });
});

test("a genuinely new realtime expression is refused without fetching or replacing its admitted historical session", async () => {
  await harness(async ({ create, waitSocket, sockets, http, live }) => {
    const initial = input({ source: script(body + '\nif barstate.isrealtime\n    plot(request.security("ETHUSDT","1",high),"New realtime expression")') });
    const coordinator = create(initial), socket = await waitSocket(0); socket.open(); socket.tick(); await coordinator.promise;
    const actual = coordinator.start(initial); assert.ok(actual); const warm = await actual.promise;
    const httpBefore = http.length;
    await assert.rejects(actual.update(bar(3), false), error => error.code === "UNAVAILABLE_DATA" && /historical bars/.test(error.message));
    assert.equal(http.length, httpBefore); assert.equal(sockets.length, 1); assert.equal(live.length, 1);
    assert.deepEqual(values(warm, "Main executions"), [1, 2, 3]);
    assert.throws(() => coordinator.assertActive(), error => error.code === "UNAVAILABLE_DATA");
  });
});

test("coordinator loading receipt overflow fails closed and cancels every held native/HTTP owner", async () => {
  await harness(async ({ create, waitSocket, holdHistory, http, census, baseline }) => {
    const held = gate(); holdHistory(held);
    const coordinator = create(input()), rejected = assert.rejects(coordinator.promise), failed = assert.rejects(coordinator.failure, error => error.code === "LIVE_QUEUE_LIMIT");
    const socket = await waitSocket(0); socket.open(); for (let step = 1; step <= 33; step++) socket.tick(3, 103, false, step);
    await failed; held.resolve(); await rejected;
    assert.ok(socket.closed > 0); assert.ok([...socket.callbacks.values()].every(listeners => listeners.size === 0)); assert.equal(census(), baseline);
    assert.ok(http.every(entry => entry.signal.aborted));
  });
});

test("held real live startup has a hard shared command queue and never executes overflowed primary ticks", async () => {
  await harness(async ({ create, waitSocket, sessionGate, live, census, baseline }) => {
    const initial = input(), coordinator = create(initial), socket = await waitSocket(0); socket.open(); socket.tick(); await coordinator.promise;
    const held = gate(); sessionGate(held);
    const actual = coordinator.start(initial); assert.ok(actual);
    const rejected = assert.rejects(actual.promise, error => error.code === "LIVE_QUEUE_LIMIT");
    const failed = assert.rejects(coordinator.failure, error => error.code === "LIVE_QUEUE_LIMIT");
    const pending = Array.from({ length: 32 }, (_, i) => {
      const promise = actual.update(bar(3, 13 + i), false); void promise.catch(() => {}); return promise;
    });
    await failed; held.resolve(); await rejected;
    assert.ok((await Promise.allSettled(pending)).every(item => item.status === "rejected" && item.reason.code === "LIVE_QUEUE_LIMIT"));
    assert.equal(live.length, 1); assert.equal(live[0].commands.length, 0); assert.equal(census(), baseline); assert.ok(socket.closed > 0);
  });
});

test("remote-only prices cannot execute or fill the main strategy before the next actual primary candle", async () => {
  await harness(async ({ create, waitSocket }) => {
    const source = '//@version=6\nstrategy("Coordinator broker165",calc_on_every_tick=true,initial_capital=10000)\nvarip int n=0\nn+=1\nplot(n,"Main executions")\nplot(request.security("ETHUSDT","1",close),"Remote")\nif bar_index==2\n    strategy.entry("Main",strategy.long,qty=1,limit=80)';
    const initial = input({ source, bars: [0, 1, 2].map(i => bar(i, 100)) }), coordinator = create(initial), socket = await waitSocket(0);
    socket.open(); socket.tick(3, 70); await coordinator.promise; const actual = coordinator.start(initial), warm = await actual.promise;
    assert.equal(warm.strategy.pendingOrders.length, 1); assert.equal(warm.strategy.openTrades.length, 0);
    socket.tick(3, 60, false, 2); const quiet = await actual.setViewport(null);
    assert.deepEqual(values(quiet, "Main executions"), [1, 2, 3]); assert.equal(quiet.strategy.pendingOrders.length, 1); assert.equal(quiet.strategy.openTrades.length, 0);
    const received = await actual.update(bar(3, 70), false); assert.equal(tail(received, "Main executions"), 4); assert.equal(tail(received, "Remote"), 60);
    assert.equal(received.strategy.openTrades[0].entry_price, 70); assert.equal(received.strategy.openTrades[0].entry_bar_index, 3);
    assert.equal(warm.strategy.openTrades.length, 0);
  });
});
