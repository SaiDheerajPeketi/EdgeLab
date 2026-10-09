import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createHash } from "node:crypto";

// Actual paired resolver, authenticated metadata API, HTTP range loading and
// socket acquisition. Only HTTP delivery and WebSocket events are controlled.
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "node", write: false, logLevel: "silent",
  define: { "import.meta.env": "{}" }, stdin: { loader: "ts", resolveDir: process.cwd(), contents:
    'export * from "./frontend/src/lib/pineLiveMarketTransport.ts"; export {setStoredAuthSession,clearStoredAuthSession} from "./frontend/src/lib/authSession.ts";' } })).outputFiles[0].text;
Error.stackTraceLimit = 0;
console.info("LIVE_TRANSPORT164_BINDING " + JSON.stringify({ minified: true, bundleSha256: createHash("sha256").update(bundle).digest("hex"), actualResolver: true }));
let instance = 0;
const fresh = () => import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64") + "#" + ++instance);
const origin = Date.parse("2024-01-01T00:00:00Z") / 1000;
const candle = (minute, close = 100) => ({ time: origin + minute * 60, open: 100, high: Math.max(101, close), low: Math.min(99, close), close, volume: 10 });
const session = id => ({ createdAt: new Date().toISOString(), expiresAt: "2099-01-01T00:00:00Z", token: "live164-private-" + id,
  user: { id, email: "owner@example.test", name: "Owner", provider: "google", approved: false, betaPosition: null, workspaceAccess: true,
    accessExpiresAt: "2099-01-01T00:00:00Z", deploymentMode: "production", plan: "pro", isBetaUser: false } });
const instrument = symbol => ({ symbol, label: symbol, description: symbol, status: "TRADING", asset_class: "crypto", base_asset: symbol.slice(0, -4),
  quote_asset: "USDT", tick_size: .01, min_quantity: .001, quantity_step: .001 });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const payload = (symbol = "ETHUSDT", minute = 3, confirmed = false, step = 1, extra = {}) => {
  const bar = candle(minute);
  return { e: "kline", s: symbol, E: confirmed ? (bar.time + 60) * 1000 - 1 : bar.time * 1000 + step,
    k: { s: symbol, i: "1m", t: bar.time * 1000, T: (bar.time + 60) * 1000 - 1, x: confirmed,
      o: String(bar.open), h: String(bar.high), l: String(bar.low), c: String(bar.close), v: String(bar.volume + step) }, ...extra };
};
class Socket extends EventTarget {
  constructor(url) { super(); this.url = url; this.callbacks = new Map(); this.closeCount = 0; }
  addEventListener(type, callback, options) { if (!this.callbacks.has(type)) this.callbacks.set(type, new Set()); this.callbacks.get(type).add(callback); super.addEventListener(type, callback, options); }
  removeEventListener(type, callback, options) { this.callbacks.get(type)?.delete(callback); super.removeEventListener(type, callback, options); }
  emit(type, data) { const event = new Event(type); if (data !== undefined) Object.defineProperty(event, "data", { value: data }); this.dispatchEvent(event); }
  message(value) { this.emit("message", typeof value === "string" ? value : JSON.stringify(value)); }
  close() { this.closeCount++; }
  listenerCount() { return [...this.callbacks.values()].reduce((sum, values) => sum + values.size, 0); }
}

async function harness(run) {
  const prior = { window: globalThis.window, fetch: globalThis.fetch }, values = new Map(), window = new EventTarget(), callbacks = new Map();
  const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
  window.addEventListener = (type, callback, options) => { if (!callbacks.has(type)) callbacks.set(type, new Set()); callbacks.get(type).add(callback); add(type, callback, options); };
  window.removeEventListener = (type, callback, options) => { callbacks.get(type)?.delete(callback); remove(type, callback, options); };
  window.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  window.location = { origin: "https://edgelab.test" }; globalThis.window = window;
  const api = await fresh(); api.setStoredAuthSession(session(1));
  const census = () => [...callbacks.values()].reduce((sum, values) => sum + values.size, 0), baseline = census();
  const sockets = [], socketReady = [], http = [], order = [], pairs = []; let customFetch, socketHook;
  globalThis.fetch = async (url, init = {}) => {
    const entry = { url: new URL(String(url), window.location.origin), headers: new Headers(init.headers), signal: init.signal, credentials: init.credentials, redirect: init.redirect };
    http.push(entry); order.push(entry.url.pathname.includes("instruments") ? "metadata" : "REST");
    if (customFetch) return customFetch(entry);
    if (entry.url.pathname === "/api/live/binance/instruments") {
      assert.equal(entry.headers.get("Authorization"), "Bearer live164-private-1");
      return Response.json({ instruments: [instrument(entry.url.searchParams.get("search"))] });
    }
    assert.equal(entry.url.origin, "https://data-api.binance.vision"); assert.equal(entry.url.pathname, "/api/v3/klines");
    assert.equal(entry.headers.has("Authorization"), false); assert.equal(entry.credentials, "omit"); assert.equal(entry.redirect, "error");
    const bars = [0, 1, 2].map(i => candle(i)), query = entry.url.searchParams;
    return Response.json(bars.filter(bar => bar.time * 1000 >= Number(query.get("startTime")) && bar.time * 1000 <= Number(query.get("endTime")))
      .map(bar => [bar.time * 1000, ...[bar.open, bar.high, bar.low, bar.close, bar.volume].map(String), (bar.time + 60) * 1000 - 1]));
  };
  const create = () => {
    const pair = api.createPineLiveMarketDataResolver({ provider: "binance", chartSymbol: "BTCUSDT", revision: "live164", range: { from: origin, to: origin + 179 }, asOf: origin + 180, owns: () => true }, 3,
      { transport: { socket(url) { const socket = new Socket(url), index = sockets.length; sockets.push(socket); order.push("socket"); socketHook?.(socket); socketReady[index]?.resolve(socket); return socket; } } });
    pairs.push(pair); return pair;
  };
  const waitSocket = index => { if (sockets[index]) return Promise.resolve(sockets[index]); socketReady[index] ??= deferred(); return socketReady[index].promise; };
  const openFirst = (socket, symbol = "ETHUSDT") => { order.push("OPEN"); socket.emit("open"); order.push("first event"); socket.message(payload(symbol)); };
  try { await run({ api, create, sockets, http, order, waitSocket, openFirst, census, baseline, fetch: fn => { customFetch = fn; }, onSocket: fn => { socketHook = fn; } }); }
  finally { for (const pair of pairs) pair.cancel(); api.clearStoredAuthSession(); globalThis.fetch = prior.fetch; if (prior.window === undefined) delete globalThis.window; else globalThis.window = prior.window; }
}

test("actual metadata qualifies the socket, and OPEN plus first valid event precede any real history HTTP", async () => {
  await harness(async ({ create, sockets, http, order, waitSocket, openFirst }) => {
    const pair = create(), pending = pair.resolve({ symbol: "ETHUSDT", timeframe: "1" }), socket = await waitSocket(0);
    assert.deepEqual(order, ["metadata", "socket"]); assert.equal(http.length, 1);
    socket.emit("open"); assert.equal(http.length, 1); socket.message(payload());
    const result = await pending; assert.equal(result.bars.length, 3); assert.equal(http.length, 2);
    assert.equal(socket.url, "wss://data-stream.binance.vision/ws/ethusdt@kline_1m");
    assert.equal(new URL(socket.url).username, ""); assert.equal(new URL(socket.url).search, ""); assert.doesNotMatch(socket.url, /private|token|owner/);
    assert.equal(result.context.symbol, "BINANCE:ETHUSDT");
    const journal = pair.transport.drain(); assert.equal(journal.length, 1); assert.equal(journal[0].event.bar.time, origin + 180);
    assert.equal(pair.transport.drain().length, 0); assert.equal(sockets.length, 1);
    assert.deepEqual(result.bars.map(bar => bar.time), [origin, origin + 60, origin + 120]);
  });
});

test("invalid symbol never opens a socket, while main symbol history needs no independent stream", async () => {
  await harness(async ({ create, fetch, sockets, http }) => {
    fetch(() => Response.json({ instruments: [] }));
    await assert.rejects(create().resolve({ symbol: "ABSENTUSDT", timeframe: "1" }), error => error.code === "INVALID_REQUEST_SYMBOL");
    assert.equal(sockets.length, 0); assert.equal(http.length, 1);
  });
  await harness(async ({ create, sockets, http }) => {
    const pair = create(), result = await pair.resolve({ symbol: "BTCUSDT", timeframe: "1" });
    assert.equal(result.context.symbol, "BINANCE:BTCUSDT"); assert.equal(sockets.length, 0); assert.equal(http.length, 2);
    assert.deepEqual(pair.transport.streams(), []); assert.deepEqual(pair.transport.drain(), []);
  });
});

test("native M1 acquisition is shared by target1 and custom7 without duplicate credentials, sockets or first-event buffers", async () => {
  await harness(async ({ create, waitSocket, openFirst, sockets, http }) => {
    const pair = create(), one = pair.resolve({ symbol: "ETHUSDT", timeframe: "1" }), seven = pair.resolve({ symbol: "BINANCE:ETHUSDT", timeframe: "7" });
    const socket = await waitSocket(0); openFirst(socket); const [a, b] = await Promise.all([one, seven]);
    assert.equal(a.sourceTimeframe, "1"); assert.equal(b.sourceTimeframe, "1"); assert.equal(b.context.timeframe, "7"); assert.equal(sockets.length, 1);
    assert.equal(http.filter(entry => entry.url.pathname.includes("instruments")).length, 1);
    const streams = pair.transport.streams(); assert.equal(streams.length, 1); assert.deepEqual(streams[0].binding, { symbol: "BINANCE:ETHUSDT", timeframe: "1", epoch: 3 });
    assert.equal(pair.transport.drain().length, 1);
  });
});

test("actual socket receipts preserve global delivery order, immutable OHLCV, duplicates and explicit confirmations without REST events", async () => {
  await harness(async ({ create, waitSocket, openFirst }) => {
    const pair = create(), eth = pair.resolve({ symbol: "ETHUSDT", timeframe: "1" }), sol = pair.resolve({ symbol: "SOLUSDT", timeframe: "1" });
    const ethSocket = await waitSocket(0), solSocket = await waitSocket(1); openFirst(ethSocket); openFirst(solSocket, "SOLUSDT"); await Promise.all([eth, sol]);
    const initial = pair.transport.drain(); assert.deepEqual(initial.map(item => [item.ordinal, item.event.symbol, item.event.sequence]), [[1, "BINANCE:ETHUSDT", 1], [2, "BINANCE:SOLUSDT", 1]]);
    let notifications = 0; const unsubscribe = pair.transport.subscribe(() => { notifications++; });
    const update = payload("ETHUSDT", 3, false, 2); ethSocket.message(update); ethSocket.message(update); update.k.c = "999";
    const close = payload("SOLUSDT", 3, true, 2); solSocket.message(close); solSocket.message(close);
    solSocket.message(payload("SOLUSDT", 4, false, 3));
    const received = pair.transport.drain(); assert.deepEqual(received.map(item => [item.ordinal, item.event.symbol, item.event.sequence, item.event.confirmed]),
      [[3, "BINANCE:ETHUSDT", 2, false], [4, "BINANCE:SOLUSDT", 2, true], [5, "BINANCE:SOLUSDT", 3, false]]);
    assert.equal(received[0].event.bar.close, 100); assert.equal(notifications, 3); assert.equal(pair.transport.drain().length, 0);
    for (const value of [received, ...received, ...received.map(item => item.event), ...received.map(item => item.event.bar)]) assert.equal(Object.isFrozen(value), true);
    assert.equal(initial[0].event.sequence, 1); assert.equal(initial[0].event.bar.volume, 11); unsubscribe();
  });
});

for (const transition of ["cancel", "quiet auth ABA", "queued storage clear/restore"]) test(`${transition} while OPEN waits for first event retires socket/listeners and prevents REST`, async () => {
  await harness(async ({ api, create, waitSocket, http, census, baseline }) => {
    const pair = create(), pending = pair.resolve({ symbol: "ETHUSDT", timeframe: "1" }), rejected = assert.rejects(pending, error => error.name === "AbortError");
    const socket = await waitSocket(0); socket.emit("open");
    if (transition === "cancel") pair.cancel();
    else if (transition === "quiet auth ABA") { api.setStoredAuthSession(session(2), { notify: false }); api.setStoredAuthSession(session(1), { notify: false }); }
    else { const key = "edgelab.auth.session.v1", raw = window.localStorage.getItem(key); window.localStorage.removeItem(key); window.localStorage.setItem(key, raw);
      const event = new Event("storage"); Object.defineProperty(event, "key", { value: null }); window.dispatchEvent(event); }
    await rejected; assert.equal(socket.closeCount, 1); assert.equal(socket.listenerCount(), 0); assert.equal(census(), baseline);
    socket.message(payload()); assert.equal(http.length, 1); assert.equal(pair.signal.aborted, true);
  });
});

for (const fault of ["gap", "malformed", "oversized UTF-8", "nontext", "wrong symbol", "wrong interval", "close", "error", "message before OPEN"])
  test(`${fault} fails the whole pair and aborts held REST rather than creating history`, async () => {
    await harness(async ({ create, fetch, waitSocket, openFirst, sockets, http, census, baseline }) => {
      const entered = deferred(); let restSignal;
      fetch(entry => {
        if (entry.url.pathname.includes("instruments")) return Response.json({ instruments: [instrument(entry.url.searchParams.get("search"))] });
        restSignal = entry.signal; entered.resolve(); return new Promise((_, reject) => entry.signal.addEventListener("abort", () => reject(new DOMException("Aborted REST", "AbortError")), { once: true }));
      });
      const pair = create(), pending = pair.resolve({ symbol: "ETHUSDT", timeframe: "1" }), rejected = assert.rejects(pending);
      const failed = assert.rejects(pair.transport.failure), socket = await waitSocket(0);
      if (fault === "message before OPEN") socket.message(payload());
      else {
        openFirst(socket); await entered.promise;
        if (fault === "gap") socket.message(payload("ETHUSDT", 5, false, 2));
        else if (fault === "malformed") socket.message("{broken");
        else if (fault === "oversized UTF-8") socket.message("🐱".repeat(5000));
        else if (fault === "nontext") socket.emit("message", new Uint8Array([1, 2, 3]));
        else if (fault === "wrong symbol") socket.message(payload("SOLUSDT", 3, false, 2));
        else if (fault === "wrong interval") { const bad = payload("ETHUSDT", 3, false, 2); bad.k.i = "5m"; socket.message(bad); }
        else socket.emit(fault);
      }
      await Promise.all([rejected, failed]); assert.equal(pair.signal.aborted, true); if (restSignal) assert.equal(restSignal.aborted, true);
      assert.equal(socket.closeCount, 1); assert.equal(socket.listenerCount(), 0); assert.equal(census(), baseline);
      assert.throws(() => pair.transport.drain()); assert.equal(http.length, fault === "message before OPEN" ? 1 : 2); assert.equal(sockets.length, 1);
    });
  });

test("per-stream32 receipts and global128 receipts are hard bounds before any extra event is accepted", async () => {
  await harness(async ({ create, waitSocket, openFirst }) => {
    const pair = create(), pending = pair.resolve({ symbol: "ETHUSDT", timeframe: "1" }), socket = await waitSocket(0);
    let accepted = 0; pair.transport.subscribe(() => { accepted++; }); openFirst(socket); await pending;
    for (let i = 2; i <= 32; i++) socket.message(payload("ETHUSDT", 3, false, i));
    assert.equal(accepted, 32); const failed = assert.rejects(pair.transport.failure, error => error.code === "LIVE_QUEUE_LIMIT");
    socket.message(payload("ETHUSDT", 3, false, 33)); await failed; assert.equal(accepted, 32); assert.equal(socket.closeCount, 1);
  });
  await harness(async ({ create, waitSocket, openFirst, sockets }) => {
    const pair = create(), symbols = ["ETHUSDT", "SOLUSDT", "ADAUSDT", "XRPUSDT"]; let accepted = 0;
    pair.transport.subscribe(() => { accepted++; });
    for (const [index, symbol] of symbols.entries()) { const pending = pair.resolve({ symbol, timeframe: "1" }), socket = await waitSocket(index); openFirst(socket, symbol); await pending;
      for (let i = 2; i <= 32; i++) socket.message(payload(symbol, 3, false, i)); }
    assert.equal(accepted, 128);
    const next = pair.resolve({ symbol: "BNBUSDT", timeframe: "1" }), rejected = assert.rejects(next), failed = assert.rejects(pair.transport.failure, error => error.code === "LIVE_QUEUE_LIMIT");
    const socket = await waitSocket(4); openFirst(socket, "BNBUSDT"); await Promise.all([rejected, failed]);
    assert.equal(accepted, 128); assert.ok(sockets.every(socket => socket.closeCount === 1 && socket.listenerCount() === 0));
  });
});

for (const when of ["before", "after"]) test(`durable identity cancellation ${when} native listener registration leaves no late socket listeners`, async () => {
  await harness(async ({ api, create, onSocket, waitSocket, http, census, baseline }) => {
    onSocket(socket => {
      const add = socket.addEventListener.bind(socket); let revoked = false;
      socket.addEventListener = (type, listener, options) => {
        const revoke = () => { if (type === "message" && !revoked) { revoked = true; api.setStoredAuthSession(session(2), { notify: false }); api.setStoredAuthSession(session(1), { notify: false }); } };
        if (when === "before") revoke(); add(type, listener, options); if (when === "after") revoke();
      };
    });
    const pair = create(), rejected = assert.rejects(pair.resolve({ symbol: "ETHUSDT", timeframe: "1" }), error => error.name === "AbortError");
    const socket = await waitSocket(0); await rejected;
    assert.ok(socket.closeCount >= 1); assert.equal(socket.listenerCount(), 0); assert.equal(census(), baseline);
    socket.emit("open"); socket.message(payload()); assert.equal(http.length, 1);
  });
});

test("the actual default first-event timeout closes an OPEN socket without fetching REST", { timeout: 15000 }, async () => {
  await harness(async ({ create, waitSocket, http, census, baseline }) => {
    const pair = create(), pending = pair.resolve({ symbol: "ETHUSDT", timeframe: "1" }), rejected = assert.rejects(pending),
      failed = assert.rejects(pair.transport.failure, error => error.code === "TIMEOUT");
    const socket = await waitSocket(0); socket.emit("open"); await Promise.all([rejected, failed]);
    assert.equal(http.length, 1); assert.equal(socket.closeCount, 1); assert.equal(socket.listenerCount(), 0); assert.equal(census(), baseline);
  });
});
