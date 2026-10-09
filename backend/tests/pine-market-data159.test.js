import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({ entryPoints: ["frontend/src/lib/pineMarketDataResolver.ts"], bundle: true,
  format: "esm", platform: "node", write: false, logLevel: "silent", define: { "import.meta.env": "{}" } });
const { createPineMarketDataResolver, pineBinanceRequestedSymbol } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const feed = await build({ entryPoints: ["frontend/src/lib/binanceChartFeed.ts"], bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent" });
const { loadBinanceRequestHistory } = await import(`data:text/javascript;base64,${Buffer.from(feed.outputFiles[0].text).toString("base64")}`);
const start = Date.parse("2019-04-01T00:00:00Z") / 1000;
const session = () => ({ token: "owner-one-private-token", expiresAt: "2099-01-01T00:00:00Z", user: { id: 1,
  workspaceAccess: true, accessExpiresAt: "2099-01-01T00:00:00Z", deploymentMode: "production", plan: "pro", isBetaUser: false } });
const instrument = symbol => ({ symbol, asset_class: "crypto", status: "TRADING", base_asset: symbol.slice(0, -4), quote_asset: "USDT",
  tick_size: symbol === "ETHUSDT" ? .001 : .01, min_quantity: .001, quantity_step: .001 });
const bar = (time, close = 200) => ({ time, open: close - 1, high: close + 2, low: close - 2, close, volume: 5 });
const row = (b, seconds = 60) => [b.time * 1000, String(b.open), String(b.high), String(b.low), String(b.close), String(b.volume), (b.time + seconds) * 1000 - 1];
function fixture(overrides = {}, scopeOverride = {}) {
  let auth = session(), active = true;
  const listeners = new Set(), metadata = [], transport = [];
  const scope = { provider: "binance", chartSymbol: "BTCUSDT", revision: "script-input-revision159", range: { from: start, to: start + 180 }, asOf: start + 240, owns: () => active, ...scopeOverride };
  const deps = { getSession: () => auth, subscribeSession: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    instruments: async (symbol, limit, signal) => { metadata.push({ symbol, limit, signal }); return { instruments: [instrument("BTCUSDT"), instrument("ETHUSDT"), instrument("ETHBTC")] }; },
    history: (symbol, plan, options) => loadBinanceRequestHistory(symbol, plan, { ...options, fetcher: async (url, init) => {
      const query = new URL(url).searchParams; transport.push({ query, signal: init.signal });
      const rows = [bar(start - 60), bar(start, symbol === "ETHUSDT" ? 200 : 60000), bar(start + 120, 203), bar(start + 180, 205)].map(b => row(b));
      return { ok: true, json: async () => rows.filter(b => b[0] >= Number(query.get("startTime")) && b[0] <= Number(query.get("endTime"))).slice(0, Number(query.get("limit"))) };
    } }), ...overrides };
  const resolver = createPineMarketDataResolver(scope, deps);
  return { ...resolver, scope, metadata, transport, listeners,
    changeAuth(value) { auth = value; for (const listener of listeners) listener(); }, retire() { active = false; }, deps };
}
const eth = { symbol: "BINANCE:ETHUSDT", timeframe: "1", warmupPeriods: 1 };

test("another market loads its own exact authenticated metadata and historical dates without a chart pane", async () => {
  const f = fixture();
  const result = await f.resolve(eth);
  assert.equal(f.scope.chartSymbol, "BTCUSDT"); assert.equal(result.providerSymbol, "ETHUSDT");
  assert.deepEqual(result.context, { symbol: "BINANCE:ETHUSDT", timeframe: "1", mintick: .001, mincontract: .001, quantityStep: .001, pointvalue: 1, currency: "USDT", basecurrency: "ETH" });
  assert.deepEqual(result.bars.map(b => [b.time, b.close]), [[start - 60, 200], [start, 200], [start + 120, 203], [start + 180, 205]]);
  assert.equal(f.metadata.length, 1); assert.equal(f.metadata[0].symbol, "ETHUSDT"); assert.equal(f.metadata[0].limit, 5000);
  const q = f.transport[0].query; assert.equal(q.get("symbol"), "ETHUSDT"); assert.equal(q.get("startTime"), String((start - 60) * 1000)); assert.equal(q.get("endTime"), String((start + 180) * 1000));
  assert.equal(result.coverage.first, start - 60); assert.equal(result.coverage.last, start + 180);
  assert.equal(result.coverage.capped, false); assert.equal(result.coverage.exhausted, true);
  assert.doesNotMatch(JSON.stringify(result), /private-token|owner-one/); f.cancel();
});
test("qualified provider identity rejects exchange collisions, ticker modifiers and forged demand fields before transport", async () => {
  assert.equal(pineBinanceRequestedSymbol(" binance:ethusdt "), "ETHUSDT");
  const f = fixture();
  for (const symbol of ["COINBASE:ETHUSDT", "BINANCE:ETH/USDT", "BINANCE:ETHUSDT!", "https://evil.test", "BINANCE:BINANCE:ETHUSDT", "ETH_USDT"]) await assert.rejects(f.resolve({ ...eth, symbol }), e => e.code === "UNAVAILABLE_DATA");
  for (const extra of [{ url: "https://evil.test" }, { token: "stolen" }, { warmupPeriods: 16001 }]) await assert.rejects(f.resolve({ ...eth, ...extra }));
  let read = false; const getter = { timeframe: "1", get symbol() { read = true; return "ETHUSDT"; } };
  await assert.rejects(f.resolve(getter)); assert.equal(read, false);
  await assert.rejects(f.resolve({ ...eth, timeframe: "1S" }), e => e.code === "UNAVAILABLE_DATA");
  assert.equal(f.metadata.length, 0); assert.equal(f.transport.length, 0); f.cancel();
});
test("unknown and duplicate symbols never receive chart prices or generic default metadata", async () => {
  for (const instruments of [[], [instrument("BTCUSDT")], [{ ...instrument("ETHUSDT"), status: "HALT" }]]) {
    let loads = 0; const f = fixture({ instruments: async () => ({ instruments }), history: async () => { loads++; } });
    await assert.rejects(f.resolve(eth), e => e.code === "INVALID_REQUEST_SYMBOL"); assert.equal(loads, 0); f.cancel();
  }
  for (const response of [{}, { instruments: [instrument("ETHUSDT"), instrument("ETHUSDT")] }, { instruments: [{ ...instrument("ETHUSDT"), tick_size: null }] }]) {
    let loads = 0; const f = fixture({ instruments: async () => response, history: async () => { loads++; } });
    await assert.rejects(f.resolve(eth)); assert.equal(loads, 0); f.cancel();
  }
});
test("contexts are immutable and cache keys retain timeframe and warmup within their fixed range/revision", async () => {
  const f = fixture(); const [a, b] = await Promise.all([f.resolve(eth), f.resolve({ ...eth, symbol: "ethusdt" })]);
  assert.strictEqual(a, b); assert.equal(f.transport.length, 1);
  assert.throws(() => { a.bars[0].close = 90000; }); assert.throws(() => { a.context.mintick = 99; });
  assert.throws(() => a.bars.push(bar(start))); assert.throws(() => { a.coverage.from = 0; });
  await f.resolve({ ...eth, warmupPeriods: 0 }); assert.equal(f.transport.length, 2); assert.equal(f.metadata.length, 1);
  const custom = await f.resolve({ ...eth, timeframe: "7" });
  assert.equal(custom.context.timeframe, "7"); assert.equal(custom.sourceTimeframe, "1"); assert.equal(custom.interval, "1m");
  assert.equal(custom.bars[0].close, 200); assert.equal(f.transport.length, 3); f.cancel();
});
test("requested partial candles are excluded beyond the owned observation cutoff without padding gaps", async () => {
  const f = fixture({}, { asOf: start + 180 }); const r = await f.resolve(eth);
  assert.equal(r.coverage.omittedUnconfirmed, true); assert.equal(r.bars.at(-1).time, start + 120);
  assert.deepEqual(r.bars.map(b => b.time), [start - 60, start, start + 120]); f.cancel();
});
test("account changes abort delayed loads and discard the late old-owner result", async () => {
  let release, began; const started = new Promise(r => { began = r; }); let signal;
  const f = fixture({ history: async (symbol, plan, options) => { signal = options.signal; began(); await new Promise(r => { release = r; });
    return { bars: [bar(start)], sourceTimeframe: "1m", from: start, to: start + 180, warmupFrom: start, requests: 1, exhausted: true, capped: false }; } });
  const pending = f.resolve(eth); await started;
  f.changeAuth({ ...session(), token: "owner-two-token", user: { ...session().user, id: 2 } });
  assert.equal(signal.aborted, true); release(); await assert.rejects(pending, e => e.name === "AbortError");
  assert.equal(f.stats().contexts, 0); assert.equal(f.stats().candles, 0); assert.equal(f.listeners.size, 0);
});
test("cached data and metadata completion cannot survive revoked access or a retired input revision", async () => {
  const f = fixture(); await f.resolve(eth); f.changeAuth({ ...session(), user: { ...session().user, workspaceAccess: false } });
  await assert.rejects(f.resolve(eth), e => e.name === "AbortError"); assert.equal(f.stats().retired, true);
  let release; const g = fixture({ instruments: () => new Promise(r => { release = r; }) });
  const pending = g.resolve(eth); g.retire(); release({ instruments: [instrument("ETHUSDT")] });
  await assert.rejects(pending, e => e.name === "AbortError"); assert.equal(g.transport.length, 0); assert.equal(g.listeners.size, 0);
});
test("external cancellation, missing access and provider mismatch stop before any network request", async () => {
  const controller = new AbortController(); const f = fixture({}, { signal: controller.signal }); controller.abort();
  await assert.rejects(f.resolve(eth), e => e.name === "AbortError"); assert.equal(f.metadata.length, 0); assert.equal(f.listeners.size, 0);
  for (const provider of ["coinbase", "dukascopy"]) assert.throws(() => fixture({}, { provider }), e => e.code === "UNAVAILABLE_DATA");
  assert.throws(() => fixture({ getSession: () => null }), e => e.code === "MARKET_ACCESS_REQUIRED");
  assert.throws(() => fixture({}, { chartSymbol: "COINBASE:BTCUSDT" }), e => e.code === "UNAVAILABLE_DATA");
});
test("failed contexts stay bounded and do not retry on every historical script bar", async () => {
  const f = fixture();
  for (let n = 0; n < 64; n++) await assert.rejects(f.resolve({ symbol: `UNKNOWN${n}`, timeframe: "1" }));
  assert.equal(f.metadata.length, 64); assert.equal(f.stats().contexts, 64);
  await assert.rejects(f.resolve({ symbol: "UNKNOWN0", timeframe: "1" })); assert.equal(f.metadata.length, 64);
  await assert.rejects(f.resolve({ symbol: "UNKNOWN64", timeframe: "1" }), e => e.code === "REQUEST_LIMIT"); assert.equal(f.metadata.length, 64); f.cancel();
});
test("concurrent dependency discovery is bounded and identical demands share one load", async () => {
  const releases = []; const f = fixture({ instruments: () => new Promise(r => releases.push(r)) });
  const pending = ["1", "3", "5", "7"].map(timeframe => f.resolve({ ...eth, timeframe }));
  assert.equal(releases.length, 1); assert.equal(f.stats().pending, 4);
  await assert.rejects(f.resolve({ ...eth, timeframe: "15" }), e => e.code === "REQUEST_LIMIT");
  f.cancel(); releases[0]({ instruments: [instrument("ETHUSDT")] });
  for (const p of pending) await assert.rejects(p, e => e.name === "AbortError"); assert.equal(f.stats().pending, 0);
});
