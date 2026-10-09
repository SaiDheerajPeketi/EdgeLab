import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser", write: false,
  target: "es2020", logLevel: "silent", define: { "import.meta.env": "{}" }, plugins: [createPineEnginePlugin()],
  stdin: { loader: "ts", resolveDir: process.cwd(), sourcefile: "pine-live-calculation168.ts", contents:
    'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineLiveMarketCoordinator.ts"; export * from "./frontend/src/lib/pineLiveMarketTransport.ts"; export {loadBinanceRequestHistory} from "./frontend/src/lib/binanceChartFeed.ts"; export {setStoredAuthSession,clearStoredAuthSession} from "./frontend/src/lib/authSession.ts";' } })).outputFiles[0].text;
console.info("LIVE_CALCULATION168_BINDING " + JSON.stringify({ minified: true, actualWorker: true, actualCoordinator: true,
  bundleSha256: createHash("sha256").update(bundle).digest("hex"), manifestSha256: createHash("sha256").update(fs.readFileSync("frontend/vendor/pinets/manifest.json")).digest("hex") }));
let instance = 0;
const fresh = () => import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64") + "#" + ++instance);
const origin = Date.UTC(2024, 0, 1) / 1000;
const minute = (index, close = 10 + index, step = 0) => ({ time: origin + index * 60, open: 9 + index,
  high: Math.max(12 + index, close), low: Math.min(8 + index, close), close, volume: 100 + index + step });
// Independent authored-timestamp OHLCV aggregation, without product helpers.
const aggregate = children => ({ time: Math.floor(children[0].time / 300) * 300, open: children[0].open,
  high: Math.max(...children.map(bar => bar.high)), low: Math.min(...children.map(bar => bar.low)),
  close: children.at(-1).close, volume: children.reduce((sum, bar) => sum + bar.volume, 0) });
const children = Array.from({ length: 30 }, (_, index) => minute(index));
const chart = Array.from({ length: 6 }, (_, index) => aggregate(children.slice(index * 5, index * 5 + 5)));
const context = { symbol: "BINANCE:BTCUSDT", timeframe: "5", mintick: .01, pointvalue: 1,
  mincontract: 1, quantityStep: 1, currency: "USDT", basecurrency: "BTC" };
const body = 'var int ordinary=0\nvarip int ticks=0\nordinary+=1\nticks+=1\nplot(ordinary,"Ordinary")\nplot(ticks,"Ticks")\nplot(close,"Close")\nplot(ta.sma(close,2),"SMA")\nplot(barstate.isconfirmed?1:0,"Confirmed")\nplot(timeframe.period=="1"?1:2,"Period")';
const script = (code = body, timeframe = "1", gaps = false) => `//@version=6\nindicator("Calculation168",timeframe="${timeframe}",timeframe_gaps=${gaps})\n${code}`;
const input = (extra = {}) => ({ id: "calculation168", action: "run", mode: "live", source: script(), inputs: {}, context, bars: chart, ...extra });
const values = (result, name) => result.plots.find(plot => plot.name === name).points.map(point => point.value);
const tail = (result, name) => values(result, name).at(-1);
const normalized = bars => bars.map(bar => ({ ...bar, timestamp: new Date(bar.time * 1000).toISOString(), ema_20: null, ema_50: null, rsi_14: null }));
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const session = id => ({ createdAt: new Date().toISOString(), expiresAt: "2099-01-01T00:00:00Z", token: "private168-" + id,
  user: { id, email: "owner@example.test", name: "Owner", provider: "google", approved: false, betaPosition: null,
    workspaceAccess: true, accessExpiresAt: "2099-01-01T00:00:00Z", deploymentMode: "production", plan: "pro", isBetaUser: false } });
class Socket extends EventTarget {
  constructor(url, interval = "1m") { super(); this.url = url; this.interval = interval; this.closed = 0; this.callbacks = new Map(); }
  addEventListener(type, callback, options) { if (!this.callbacks.has(type)) this.callbacks.set(type, new Set()); this.callbacks.get(type).add(callback); super.addEventListener(type, callback, options); }
  removeEventListener(type, callback, options) { this.callbacks.get(type)?.delete(callback); super.removeEventListener(type, callback, options); }
  emit(type, data) { const event = new Event(type); if (data !== undefined) Object.defineProperty(event, "data", { value: data }); this.dispatchEvent(event); }
  close() { this.closed++; }
  open() { this.emit("open"); }
  tick(index = 30, close = 10 + index, confirmed = false, step = 1) {
    const bar = minute(index, close, step), closeTime = (bar.time + 60) * 1000 - 1;
    this.publish(bar, confirmed, confirmed ? closeTime : bar.time * 1000 + step, closeTime);
    return bar;
  }
  publish(bar, confirmed, eventTime, closeTime) {
    this.emit("message", JSON.stringify({ e: "kline", s: "BTCUSDT", E: eventTime,
      k: { s: "BTCUSDT", i: this.interval, t: bar.time * 1000, T: closeTime, x: confirmed,
        o: String(bar.open), h: String(bar.high), l: String(bar.low), c: String(bar.close), v: String(bar.volume) } }));
  }
}
async function harness(run, transport = {}) {
  const previous = { window: globalThis.window, fetch: globalThis.fetch }, window = new EventTarget(), storage = new Map(), listeners = new Map();
  const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
  window.addEventListener = (type, callback, options) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); add(type, callback, options); };
  window.removeEventListener = (type, callback, options) => { listeners.get(type)?.delete(callback); remove(type, callback, options); };
  window.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
  window.location = { origin: "https://edgelab.test" }; globalThis.window = window;
  const api = await fresh(); api.setStoredAuthSession(session(1));
  const census = () => [...listeners.values()].reduce((sum, entries) => sum + entries.size, 0), baseline = census();
  const sockets = [], http = [], jobs = [], live = [], coordinators = []; let historyGate;
  globalThis.fetch = async (url, init = {}) => {
    const entry = { url: new URL(String(url), window.location.origin), signal: init.signal, headers: new Headers(init.headers) }; http.push(entry);
    if (entry.url.pathname.includes("instruments")) {
      assert.equal(entry.headers.get("Authorization"), "Bearer private168-1");
      return Response.json({ instruments: [{ symbol: "BTCUSDT", label: "BTC/USDT", description: "Bitcoin", status: "TRADING",
        asset_class: "crypto", base_asset: "BTC", quote_asset: "USDT", tick_size: .01, min_quantity: 1, quantity_step: 1 }] });
    }
    assert.equal(entry.url.origin, "https://data-api.binance.vision"); assert.equal(entry.url.searchParams.get("symbol"), "BTCUSDT");
    assert.equal(entry.url.searchParams.get("interval"), transport.interval ?? "1m"); assert.equal(init.credentials, "omit"); assert.equal(init.redirect, "error");
    assert.equal(entry.headers.has("Authorization"), false);
    if (historyGate) await historyGate.promise;
    if (entry.signal.aborted) throw new DOMException("Retired HTTP", "AbortError");
    const query = entry.url.searchParams;
    return Response.json((transport.rows ?? children).filter(bar => bar.time * 1000 >= Number(query.get("startTime")) && bar.time * 1000 <= Number(query.get("endTime")))
      .slice(0, Number(query.get("limit"))).map(bar => [bar.time * 1000, ...[bar.open, bar.high, bar.low, bar.close, bar.volume].map(String),
        transport.closeTime ? transport.closeTime(bar) : (bar.time + 60) * 1000 - 1]));
  };
  const createSession = received => {
    const executor = api.createPineLiveExecutor(), id = "real-calculation168-" + (live.length + 1), { marketStreams, ...request } = received;
    let sequence = 0, cancelled = false;
    const record = { request: structuredClone(request), bindings: structuredClone(marketStreams), commands: [], results: [] }; live.push(record);
    const promise = executor.execute({ protocol: "pine-live-v1", sessionId: id, sequence: 0, action: "start", marketStreams,
      request: { ...request, id: id + ":0" } }).then(value => { record.results.push(value); return value; });
    let chain = promise;
    const send = command => {
      const next = { protocol: "pine-live-v1", sessionId: id, sequence: ++sequence, ...command }; record.commands.push(structuredClone(next));
      const pending = chain.then(() => { if (cancelled) throw new DOMException("Retired session", "AbortError"); return executor.execute(next); });
      chain = pending; void chain.catch(() => {}); return pending.then(value => { record.results.push(value); return value; });
    };
    return { id, promise, cancel() { cancelled = true; executor.dispose(); }, update: (bar, confirmed, source) => send({ action: "update", bar, confirmed, ...(source ? { source } : {}) }),
      updateMarkets: events => send({ action: "markets", events }), setViewport: viewport => send({ action: "viewport", viewport }) };
  };
  const create = (initial = input()) => {
    const asOf = initial.bars.at(-1).time + Number(initial.context.timeframe) * 60;
    const coordinator = api.createPineLiveMarketCoordinator(initial, { provider: "binance", chartSymbol: "BTCUSDT", revision: "calculation168",
      range: { from: initial.bars[0].time, to: asOf - 1 }, asOf, owns: () => true }, 3, {
      createJob(request) { jobs.push(structuredClone(request)); return { cancel() {}, promise: api.executePineRequest(request) }; }, createSession,
      history: api.loadBinanceRequestHistory, createResolver: (scope, epoch) => api.createPineLiveMarketDataResolver(scope, epoch, { transport: { socket(url) { const socket = new Socket(url, transport.interval); sockets.push(socket); return socket; } } }),
    });
    coordinators.push(coordinator); return coordinator;
  };
  const open = async coordinator => {
    let ended = false, failure; void coordinator.promise.then(() => { ended = true; }, error => { ended = true; failure = error; });
    for (let count = 0; count < 100 && !sockets.length && !ended; count++) await new Promise(resolve => setImmediate(resolve));
    if (failure) throw failure;
    assert.equal(sockets.length, 1, "Evaluated finer calculation must acquire one actual native socket.");
    const socket = sockets[0]; assert.equal(socket.url, "wss://data-stream.binance.vision/ws/btcusdt@kline_" + (transport.interval ?? "1m"));
    socket.open(); if (transport.first) transport.first(socket); else socket.tick(); return socket;
  };
  const settle = async () => { for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve)); };
  try { await run({ api, create, open, sockets, http, jobs, live, census, baseline, settle, holdHistory: value => { historyGate = value; } }); }
  finally { for (const coordinator of coordinators) coordinator.cancel(); api.clearStoredAuthSession(); globalThis.fetch = previous.fetch;
    if (previous.window === undefined) delete globalThis.window; else globalThis.window = previous.window; }
}

test("evaluated declaration demands its actual same-symbol finer data rather than fabricated chart children", async () => {
  const api = await fresh();
  await assert.rejects(api.executePineRequest(input({ mode: "historical", marketData: { provider: "binance", snapshots: [] } })), error => {
    assert.equal(error.code, "MARKET_DATA_REQUIRED"); const demand = JSON.parse(error.message);
    assert.equal(demand.symbol, "BINANCE:BTCUSDT"); assert.equal(demand.timeframe, "1"); return true;
  });
});

test("actual coordinator discovers native M1 history and computes 30 minute executions on six 5-minute candles", async () => {
  await harness(async ({ create, open, jobs, http, live }) => {
    const coordinator = create(), socket = await open(coordinator); await coordinator.promise;
    const actual = coordinator.start(input()); assert.ok(actual); const warm = await actual.promise;
    assert.equal(jobs.length, 2); assert.equal(jobs[0].marketData.snapshots.length, 0); assert.equal(jobs[1].marketData.snapshots.length, 1);
    assert.ok(http.some(entry => entry.url.pathname.includes("klines"))); assert.equal(socket.closed, 0);
    assert.deepEqual(live[0].bindings, [{ symbol: context.symbol, timeframe: "1", epoch: 3 }]);
    assert.deepEqual(live[0].request.marketData.snapshots[0].bars, normalized(children));
    assert.deepEqual(values(warm, "Ordinary"), [5, 10, 15, 20, 25, 30]);
    assert.deepEqual(values(warm, "Ticks"), [5, 10, 15, 20, 25, 30]); assert.equal(tail(warm, "SMA"), 38.5);
    assert.equal(warm.audit.bars, 6);
  });
});

for (const gaps of [false, true]) test(`quiet native events only acknowledge until an actual chart tick; own minute confirmation and rollback gaps=${gaps}`, async () => {
  await harness(async ({ create, open, live, settle }) => {
    const initial = input({ source: script(body, "1", gaps) }), coordinator = create(initial), socket = await open(coordinator); await coordinator.promise;
    const actual = coordinator.start(initial); assert.ok(actual); const warm = await actual.promise, preserved = structuredClone(warm);
    await settle(); const before = live[0].results.length;
    const current = socket.tick(30, 44, false, 2); await settle();
    const quiet = live[0].results.slice(before); assert.ok(quiet.length); assert.ok(quiet.every(result => result.kind === "market-update"));
    assert.deepEqual(warm, preserved);
    const first = await actual.update(aggregate([current]), false);
    assert.equal(tail(first, "Ordinary"), 31); assert.equal(tail(first, "Ticks"), 31); assert.equal(tail(first, "Close"), 44);
    assert.equal(tail(first, "Confirmed"), 0); assert.equal(tail(first, "SMA"), (39 + 44) / 2);
    const closed = socket.tick(30, 45, true, 3); await settle(); const confirmation = await actual.update(aggregate([closed]), false);
    assert.equal(tail(confirmation, "Ordinary"), 31); assert.equal(tail(confirmation, "Ticks"), 32); assert.equal(tail(confirmation, "Confirmed"), 1);
    const next = socket.tick(31, 46, false); await settle(); const result = await actual.update(aggregate([closed, next]), false);
    assert.equal(tail(result, "Ordinary"), 32); assert.equal(tail(result, "Ticks"), 33); assert.equal(tail(result, "SMA"), (45 + 46) / 2);
    assert.equal(tail(result, "Confirmed"), 0); assert.deepEqual(warm, preserved); assert.equal(tail(first, "Close"), 44);
    assert.deepEqual(values(result, "Close").slice(0, 6), [14, 19, 24, 29, 34, 39]);
  });
});

test("authored length and generated timeframe override execute on real two-minute children with stable original input IDs", async () => {
  await harness(async ({ create, open, live, settle }) => {
    const code = 'length=input.int(3,"Length")\nplot(ta.sma(close,length),"SMA")\nplot(timeframe.period=="2"?2:-1,"Period")';
    const initial = input({ source: script(code), inputs: { in_0: 3, in_1: "2", in_2: false } }), coordinator = create(initial), socket = await open(coordinator); await coordinator.promise;
    const actual = coordinator.start(initial); const warm = await actual.promise;
    assert.equal(tail(warm, "SMA"), (35 + 37 + 39) / 3); assert.equal(tail(warm, "Period"), 2);
    assert.deepEqual(warm.inputs, initial.inputs); assert.equal(live[0].bindings.length, 1);
    const current = socket.tick(30, 44, false, 2); await settle(); const result = await actual.update(aggregate([current]), false);
    assert.equal(tail(result, "SMA"), (37 + 39 + 44) / 3); assert.equal(tail(result, "Period"), 2);
  });
});

test("already supplied M1 history and chart-timeframe calculation need no redundant transport", async () => {
  await harness(async ({ create, sockets, http }) => {
    for (const initial of [input({ sourceSnapshot: { timeframe: "1", bars: children } }), input({ source: script(body, "5") })]) {
      const coordinator = create(initial); await coordinator.promise; const actual = coordinator.start(initial); assert.ok(actual);
      const result = await actual.promise; assert.equal(tail(result, "Ordinary"), initial.sourceSnapshot ? 30 : 6); coordinator.cancel();
    }
    assert.equal(sockets.length, 0); assert.equal(http.length, 0);
  });
});

test("a redundant same-symbol primary-interval binding is still refused while finer calculation requires an owned stream", async () => {
  const api = await fresh(), executor = api.createPineLiveExecutor(), unbound = api.createPineLiveExecutor();
  try {
    await assert.rejects(executor.execute({ protocol: "pine-live-v1", sessionId: "redundant-primary-168", sequence: 0, action: "start",
      marketStreams: [{ symbol: context.symbol, timeframe: "5", epoch: 3 }], request: input({ id: "redundant-primary-168:0", source: script(body, "5"), marketData: { provider: "binance", snapshots: [{ context,
        requestedTimeframe: "5", bars: chart, asOf: origin + 1800 }] } }) }), error => error.code === "INVALID_LIVE_MARKET");
    await assert.rejects(unbound.execute({ protocol: "pine-live-v1", sessionId: "unbound-calculation-168", sequence: 0, action: "start", marketStreams: [],
      request: input({ id: "unbound-calculation-168:0", marketData: { provider: "binance", snapshots: [{ context: { ...context, timeframe: "1" },
        requestedTimeframe: "1", bars: children, asOf: origin + 1800 }] } }) }), error => error.code === "INVALID_LIVE_MARKET" && /stream|owned|live/i.test(error.message));
  } finally { executor.dispose(); unbound.dispose(); }
});

test("durable auth ABA while finer history is pending retires socket HTTP and prevents stale startup", async () => {
  await harness(async ({ api, create, open, holdHistory, live, sockets, http, census, baseline }) => {
    const held = gate(); holdHistory(held); const coordinator = create();
    const rejection = assert.rejects(coordinator.promise, error => error.name === "AbortError");
    await open(coordinator); await new Promise(resolve => setImmediate(resolve));
    assert.ok(http.some(entry => entry.url.pathname.includes("klines")));
    api.setStoredAuthSession(session(2), { notify: false }); api.setStoredAuthSession(session(1), { notify: false }); held.resolve();
    await rejection; assert.equal(live.length, 0); assert.equal(census(), baseline);
    assert.ok(sockets.every(socket => socket.closed > 0 && [...socket.callbacks.values()].every(entries => entries.size === 0)));
    assert.ok(http.every(entry => entry.signal.aborted)); assert.throws(() => coordinator.start(input()), error => error.name === "AbortError");
  });
});

test("empty monthly calculation acquires actual calendar-native history and only samples its forming month on a chart tick", async () => {
  const months = [9, 10, 11].map((month, index) => ({ time: Date.UTC(2023, month, 1) / 1000,
    open: 99 + index * 10, high: 102 + index * 10, low: 98 + index * 10, close: 100 + index * 10, volume: 1000 + index }));
  const nextMonth = bar => { const date = new Date(bar.time * 1000); return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - 1; };
  const forming = { time: origin, open: 129, high: 132, low: 128, close: 130, volume: 1003 };
  await harness(async ({ create, open, settle, live }) => {
    const initial = input({ bars: [minute(0, 130)], context: { ...context, timeframe: "1" },
      source: script(body + '\nplot(timeframe.main_period=="1M"?1:-1,"Main period")', "1M") });
    const coordinator = create(initial), socket = await open(coordinator); await coordinator.promise;
    const actual = coordinator.start(initial); assert.ok(actual); const warm = await actual.promise;
    assert.deepEqual(live[0].bindings, [{ symbol: context.symbol, timeframe: "1M", epoch: 3 }]);
    assert.deepEqual(live[0].request.marketData.snapshots[0].bars, normalized(months));
    assert.equal(tail(warm, "Ordinary"), 3); assert.equal(tail(warm, "Ticks"), 3); assert.equal(tail(warm, "SMA"), 115);
    const before = live[0].results.length;
    socket.publish({ ...forming, high: 134, close: 132, volume: 1004 }, false, (origin + 60) * 1000 + 2, nextMonth(forming));
    await settle(); assert.ok(live[0].results.slice(before).every(result => result.kind === "market-update"));
    const result = await actual.update(minute(1, 132), false);
    assert.equal(tail(result, "Close"), 132); assert.equal(tail(result, "SMA"), 126);
    assert.equal(tail(result, "Ordinary"), 4); assert.equal(tail(result, "Ticks"), 4); assert.equal(tail(result, "Confirmed"), 0);
    assert.equal(tail(result, "Main period"), 1); assert.equal(tail(warm, "SMA"), 115);
  }, { interval: "1M", rows: months, closeTime: nextMonth,
    first: socket => socket.publish(forming, false, (origin + 60) * 1000 + 1, nextMonth(forming)) });
});

test("an empty two-minute aggregate extends verified historical M1 prefix without opening a duplicate primary socket", async () => {
  await harness(async ({ create, sockets, http, jobs }) => {
    const initial = input({ context: { ...context, timeframe: "1" }, bars: [minute(1)], source: script(body, "2") });
    const coordinator = create(initial); await coordinator.promise; const actual = coordinator.start(initial); assert.ok(actual);
    const warm = await actual.promise; assert.equal(sockets.length, 0); assert.ok(http.some(entry => entry.url.pathname.includes("klines")));
    assert.equal(jobs.at(-1).marketData.snapshots[0].bars[0].time, origin);
    assert.equal(tail(warm, "Ordinary"), 1); assert.equal(tail(warm, "Ticks"), 1); assert.equal(tail(warm, "Close"), 11);
    const updates = [[2, 12, false, 2, 2, 0], [2, 14, true, 2, 3, 0], [3, 15, false, 2, 4, 0], [3, 16, true, 2, 5, 1], [4, 17, false, 3, 6, 0]];
    for (const [index, close, confirmed, ordinary, ticks, calculationClosed] of updates) {
      const result = await actual.update(minute(index, close), confirmed);
      assert.equal(tail(result, "Ordinary"), ordinary); assert.equal(tail(result, "Ticks"), ticks);
      assert.equal(tail(result, "Confirmed"), calculationClosed);
      assert.equal(tail(result, "SMA"), ((index === 4 ? 16 : 11) + close) / 2);
    }
    assert.equal(tail(warm, "Close"), 11); assert.equal(sockets.length, 0);
  }, { rows: [minute(0), minute(1)] });
});

test("same-symbol historical prefix may not overwrite the actual owned primary candle", async () => {
  await harness(async ({ create, sockets, live }) => {
    const initial = input({ context: { ...context, timeframe: "1" }, bars: [minute(1)], source: script(body, "2") });
    const coordinator = create(initial);
    await assert.rejects(coordinator.promise, error => /conflict|match|owned|history/i.test(error.message));
    assert.equal(sockets.length, 0); assert.equal(live.length, 0);
  }, { rows: [minute(0), minute(1, 999)] });
});

test("authenticated same-symbol metadata mismatch rejects discovery and retires the entire native HTTP pair", async () => {
  await harness(async ({ create, open, sockets, http, live, census, baseline }) => {
    const initial = input({ context: { ...context, mintick: .1 } }), coordinator = create(initial);
    const rejection = assert.rejects(coordinator.promise, error => error.code === "INVALID_MARKET_DATA");
    await open(coordinator); await rejection;
    assert.equal(live.length, 0); assert.equal(census(), baseline);
    assert.equal(sockets.length, 1); assert.ok(sockets[0].closed > 0);
    assert.ok([...sockets[0].callbacks.values()].every(entries => entries.size === 0));
    assert.ok(http.some(entry => entry.url.pathname.includes("instruments")));
    assert.ok(http.every(entry => entry.signal.aborted));
    assert.throws(() => coordinator.start(initial), error => error.code === "INVALID_MARKET_DATA");
  });
});
