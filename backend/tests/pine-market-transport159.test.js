import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

// Exercise default dependencies, including the authenticated API request path.
// Only browser storage/events and HTTP response delivery are controlled seams.
const bundle = await build({ bundle: true, format: "esm", platform: "node", write: false, minify: true,
  logLevel: "silent", define: { "import.meta.env": "{}" }, stdin: { loader: "ts", resolveDir: process.cwd(), contents:
    'export * from "./frontend/src/lib/pineMarketDataResolver.ts"; export {setStoredAuthSession,clearStoredAuthSession,getStoredAuthSession} from "./frontend/src/lib/authSession.ts";' } });
let instance = 0;
const fresh = () => import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}#${++instance}`);
const start = Date.parse("2019-04-01T00:00:00Z") / 1000;
const session = (id = 1) => ({ createdAt: new Date().toISOString(), expiresAt: "2099-01-01T00:00:00Z", token: `private-owner-${id}`,
  user: { id, email: `owner${id}@example.test`, name: "Owner", provider: "google", approved: false, betaPosition: null,
    workspaceAccess: true, accessExpiresAt: "2099-01-01T00:00:00Z", deploymentMode: "production", plan: "pro", isBetaUser: false } });
const instrument = symbol => ({ symbol, label: symbol, description: symbol, status: "TRADING", asset_class: "crypto",
  base_asset: symbol.slice(0, -4), quote_asset: "USDT", tick_size: .001, min_quantity: .001, quantity_step: .001 });
const candle = (time, price = 20) => ({ time, open: price, high: price, low: price, close: price, volume: price });
const wire = bar => [bar.time * 1000, ...[bar.open, bar.high, bar.low, bar.close, bar.volume].map(String), (bar.time + 60) * 1000 - 1];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function changeIdentity(api, transition) {
  if (transition === "queued storage clear/restore") {
    const key = "edgelab.auth.session.v1", raw = window.localStorage.getItem(key);
    window.localStorage.removeItem(key); window.localStorage.setItem(key, raw);
    const event = new Event("storage"); Object.defineProperty(event, "key", { value: null }); window.dispatchEvent(event);
  } else {
    const options = { notify: transition !== "quiet auth ABA" };
    api.setStoredAuthSession(session(2), options); api.setStoredAuthSession(session(1), options);
  }
}

async function harness(run) {
  const previous = { window: globalThis.window, fetch: globalThis.fetch };
  const values = new Map(), window = new EventTarget(), ledger = [], resolvers = [];
  window.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  window.location = { origin: "https://edgelab.test" };
  globalThis.window = window;
  const api = await fresh(); api.setStoredAuthSession(session());
  const transport = handler => { globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(String(url), window.location.origin), entry = { url: parsed, headers: new Headers(init.headers), signal: init.signal,
      credentials: init.credentials, redirect: init.redirect };
    ledger.push(entry); return handler(entry);
  }; };
  const scope = overrides => ({ provider: "binance", chartSymbol: "BTCUSDT", revision: "transport159", range: { from: start, to: start + 180 },
    asOf: start + 240, owns: () => true, ...overrides });
  const create = overrides => { const resolver = api.createPineMarketDataResolver(scope(overrides)); resolvers.push(resolver); return resolver; };
  try { await run({ api, ledger, transport, create }); }
  finally {
    for (const resolver of resolvers) resolver.cancel(); api.clearStoredAuthSession();
    if (previous.window === undefined) delete globalThis.window; else globalThis.window = previous.window;
    globalThis.fetch = previous.fetch;
  }
}
const metadata = entry => entry.url.pathname === "/api/live/binance/instruments";
const metadataResponse = entry => Response.json({ instruments: [instrument(entry.url.searchParams.get("search"))] });
function historyResponse(entry, bars) {
  assert.equal(entry.url.origin, "https://data-api.binance.vision"); assert.equal(entry.url.pathname, "/api/v3/klines");
  assert.equal(entry.headers.has("Authorization"), false, "Session credentials never reach the public provider");
  assert.equal(entry.credentials, "omit"); assert.equal(entry.redirect, "error");
  const query = entry.url.searchParams;
  return Response.json(bars.filter(bar => bar.time * 1000 >= Number(query.get("startTime")) && bar.time * 1000 <= Number(query.get("endTime")))
    .slice(0, Number(query.get("limit"))).map(wire));
}
const demand = { symbol: "BINANCE:ETHUSDT", timeframe: "1", warmupPeriods: 2 };

test("default authenticated metadata and real range pagination preserve the requested market without leaking credentials", async () => {
  await harness(async ({ ledger, transport, create }) => {
    const bars = Array.from({ length: 1504 }, (_, i) => candle(start - 120 + i * 60, i + .25));
    transport(entry => metadata(entry) ? metadataResponse(entry) : historyResponse(entry, bars));
    const resolver = create({ range: { from: start, to: start + 1501 * 60 }, asOf: start + 1502 * 60 });
    const result = await resolver.resolve(demand);
    assert.deepEqual(result.bars.map(({ time, open, high, low, close, volume }) => ({ time, open, high, low, close, volume })), bars);
    for (const bar of result.bars) assert.deepEqual({ timestamp: bar.timestamp, ema_20: bar.ema_20, ema_50: bar.ema_50, rsi_14: bar.rsi_14 },
      { timestamp: new Date(bar.time * 1000).toISOString(), ema_20: null, ema_50: null, rsi_14: null });
    assert.equal(result.context.symbol, "BINANCE:ETHUSDT"); assert.equal(result.context.basecurrency, "ETH");
    const [catalog, first, second] = ledger;
    assert.equal(ledger.length, 3); assert.equal(catalog.url.origin, "https://edgelab.test");
    assert.equal(catalog.headers.get("Authorization"), "Bearer private-owner-1");
    assert.equal(catalog.url.searchParams.get("search"), "ETHUSDT"); assert.equal(catalog.url.searchParams.get("limit"), "5000");
    assert.equal(first.url.searchParams.get("startTime"), String((start - 120) * 1000));
    assert.equal(second.url.searchParams.get("startTime"), String(bars[1000].time * 1000));
    assert.equal(first.url.searchParams.get("endTime"), second.url.searchParams.get("endTime"));
    assert.equal(result.coverage.requests, 2); assert.equal(result.coverage.exhausted, true); assert.equal(result.coverage.capped, false);
    assert.strictEqual(await resolver.resolve({ ...demand, symbol: "ethusdt" }), result); assert.equal(ledger.length, 3);
    assert.equal(Object.isFrozen(result.bars[0]), true); assert.doesNotMatch(JSON.stringify(result), /private-owner|example\.test/);
  });
});

for (const boundary of ["metadata", "history"]) for (const transition of ["auth ABA", "quiet auth ABA", "queued storage clear/restore"])
  test(`real ${transition} during ${boundary} response delivery aborts old-owner transport and prevents a late commit`, async () => {
  await harness(async ({ api, ledger, transport, create }) => {
    const entered = deferred(), release = deferred(); let heldSignal;
    transport(entry => {
      const response = metadata(entry) ? metadataResponse(entry) : historyResponse(entry, [candle(start)]);
      if ((boundary === "metadata") === metadata(entry)) {
        heldSignal = entry.signal; const method = boundary === "metadata" ? "text" : "json", read = response[method].bind(response);
        response[method] = async () => { entered.resolve(); await release.promise; return read(); };
      }
      return response;
    });
    const resolver = create(), pending = resolver.resolve(demand), rejected = assert.rejects(pending, error => error.name === "AbortError");
    await entered.promise; const bytesBefore = resolver.stats().bytes; changeIdentity(api, transition);
    assert.equal(heldSignal.aborted, true); release.resolve(); await rejected;
    assert.equal(resolver.stats().retired, true); assert.equal(resolver.stats().candles, 0); assert.equal(resolver.stats().bytes, bytesBefore);
    assert.equal(ledger.length, boundary === "metadata" ? 1 : 2); assert.equal(api.getStoredAuthSession().token, "private-owner-1");
    await assert.rejects(resolver.resolve(demand), error => error.name === "AbortError");
    assert.equal(ledger.length, boundary === "metadata" ? 1 : 2);
  });
});

test("the real authenticated API rejects denial and malformed catalog bodies before any provider request", async () => {
  for (const [status, body] of [[401, { detail: "Expired identity" }], [403, { detail: "No market access" }], [200, {}], [200, { instruments: [] }]]) {
    await harness(async ({ ledger, transport, create }) => {
      transport(entry => { assert.equal(metadata(entry), true); return Response.json(body, { status }); });
      const resolver = create();
      await assert.rejects(resolver.resolve(demand), error => status === 200 ? ["UNAVAILABLE_DATA", "INVALID_REQUEST_SYMBOL"].includes(error.code) : error.status === status);
      await assert.rejects(resolver.resolve(demand)); assert.equal(ledger.length, 1);
      assert.equal(resolver.stats().candles, 0); assert.equal(resolver.stats().bytes, 0);
      assert.equal(ledger[0].headers.get("Authorization"), "Bearer private-owner-1");
    });
  }
});

test("input revision ownership is rechecked after a real provider body even without an auth event", async () => {
  await harness(async ({ ledger, transport, create }) => {
    let owned = true;
    transport(entry => {
      if (metadata(entry)) return metadataResponse(entry);
      const response = historyResponse(entry, [candle(start)]), read = response.json.bind(response);
      response.json = async () => { const value = await read(); owned = false; return value; }; return response;
    });
    const resolver = create({ owns: () => owned });
    await assert.rejects(resolver.resolve(demand), error => error.name === "AbortError");
    assert.equal(resolver.stats().candles, 0); assert.equal(resolver.stats().bytes, Buffer.byteLength(JSON.stringify(instrument("ETHUSDT")))); assert.equal(ledger.length, 2);
    await assert.rejects(resolver.resolve(demand), error => error.name === "AbortError"); assert.equal(ledger.length, 2);
  });
});

test("actual range transport caps each context at 16000 candles without requesting a seventeenth page", async () => {
  await harness(async ({ ledger, transport, create }) => {
    const bars = Array.from({ length: 16001 }, (_, i) => candle(start + i * 60, 0));
    transport(entry => metadata(entry) ? metadataResponse(entry) : historyResponse(entry, bars));
    const resolver = create({ range: { from: start, to: bars.at(-1).time }, asOf: bars.at(-1).time + 60 });
    const request = { symbol: "ETHUSDT", timeframe: "1" }, result = await resolver.resolve(request);
    assert.equal(result.bars.length, 16000); assert.equal(result.coverage.requests, 16); assert.equal(result.coverage.capped, true);
    assert.equal(result.coverage.exhausted, false); assert.equal(result.bars[0].time, start); assert.equal(result.bars.at(-1).time, start + 15999 * 60);
    assert.equal(resolver.stats().candles, 16000); assert.equal(ledger.length, 17); assert.equal(resolver.stats().pending, 0);
    assert.strictEqual(await resolver.resolve(request), result); assert.equal(ledger.length, 17);
  });
});

test("serialized-byte exhaustion cannot partially commit a fetched context or refetch its rejected demand", async () => {
  await harness(async ({ api, ledger, transport, create }) => {
    const bars = Array.from({ length: 16000 }, (_, i) => candle(start + i * 60, 12345678.901234567));
    transport(entry => metadata(entry) ? metadataResponse(entry) : historyResponse(entry, bars));
    const resolver = create({ range: { from: start, to: bars.at(-1).time }, asOf: bars.at(-1).time + 60 });
    let serialized = 0, committed = 0, denied;
    for (let i = 0; i < 12; i++) {
      const request = { symbol: `BYTES${i}USDT`, timeframe: "1" };
      serialized += Buffer.byteLength(JSON.stringify(instrument(request.symbol)));
      try {
        const result = await resolver.resolve(request); serialized += Buffer.byteLength(JSON.stringify(result)); committed++;
        assert.equal(resolver.stats().bytes, serialized); assert.equal(resolver.stats().candles, committed * 16000);
      } catch (error) {
        assert.equal(error.code, "REQUEST_LIMIT"); assert.match(error.message, /memory limit/); denied = request; break;
      }
    }
    assert.ok(denied, "Actual serialized candle payload must reach the byte budget before the candle budget");
    assert.ok(serialized <= api.PINE_MARKET_DATA_LIMITS.bytes); assert.equal(resolver.stats().bytes, serialized);
    assert.equal(resolver.stats().candles, committed * 16000); assert.equal(resolver.stats().pending, 0);
    const before = ledger.length; await assert.rejects(resolver.resolve(denied), error => error.code === "REQUEST_LIMIT");
    assert.equal(ledger.length, before); assert.equal(resolver.stats().bytes, serialized);
  });
});

test("a real 5000-row metadata response charges only its normalized requested row", async () => {
  await harness(async ({ ledger, transport, create }) => {
    const instruments = Array.from({ length: 4999 }, (_, i) => ({ ...instrument(`EXTRA${i}USDT`), description: "unrelated instrument ".repeat(32) }));
    instruments.push({ ...instrument("ETHUSDT"), description: "unused description ".repeat(4096), ignored: "never retained".repeat(1024) });
    transport(entry => metadata(entry) ? Response.json({ instruments }) : historyResponse(entry, [candle(start)]));
    const resolver = create(), result = await resolver.resolve(demand);
    const retained = Buffer.byteLength(JSON.stringify(instrument("ETHUSDT")));
    assert.equal(resolver.stats().bytes - Buffer.byteLength(JSON.stringify(result)), retained);
    assert.ok(Buffer.byteLength(JSON.stringify({ instruments })) > 1000 * retained);
    await resolver.resolve({ ...demand, warmupPeriods: 0 }); assert.equal(ledger.filter(metadata).length, 1);
    assert.equal(result.context.basecurrency, "ETH"); assert.doesNotMatch(JSON.stringify(result), /unused description|never retained|EXTRA/);
  });
});

for (const transition of ["quiet auth ABA", "queued storage clear/restore"]) test(`cached actual market data cannot survive ${transition}`, async () => {
  await harness(async ({ api, ledger, transport, create }) => {
    transport(entry => metadata(entry) ? metadataResponse(entry) : historyResponse(entry, [candle(start)]));
    const resolver = create(); await resolver.resolve(demand); const before = ledger.length;
    changeIdentity(api, transition); await assert.rejects(resolver.resolve(demand), error => error.name === "AbortError");
    assert.equal(resolver.stats().retired, true); assert.equal(ledger.length, before);
  });
});
