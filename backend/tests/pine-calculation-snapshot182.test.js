import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

// Actual sealed/minified compiler and executor. Only explicitly authored market
// histories/events are supplied; no engine, barstate or result is substituted.
Error.stackTraceLimit = 0;
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser", target: "es2020", write: false,
  logLevel: "silent", plugins: [createPineEnginePlugin()], stdin: { loader: "ts", resolveDir: process.cwd(), sourcefile: "pine-calculation-snapshot182.ts",
    contents: 'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineCalculationSnapshot.ts"; export * from "./frontend/src/lib/pineProtocol.ts"; export * from "./frontend/src/lib/pineLiveMarkets.ts";' } })).outputFiles[0].text;
console.info("CALCULATION_SNAPSHOT182_BINDING " + JSON.stringify({ minified: true, actualWorker: true,
  bundleSha256: createHash("sha256").update(bundle).digest("hex"), manifestSha256: createHash("sha256").update(fs.readFileSync("frontend/vendor/pinets/manifest.json")).digest("hex") }));
const api = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const origin = Date.UTC(2024, 0, 1) / 1000;
const candle = (index, close = 100 + index, span = 60) => ({ time: origin + index * span,
  open: close - 1, high: close + 3, low: close - 3, close, volume: index + 1 });
const normalized = bars => bars.map(bar => ({ ...bar, timestamp: new Date(bar.time * 1000).toISOString(), ema_20: null, ema_50: null, rsi_14: null }));
const meta = timeframe => ({ symbol: "BINANCE:BTCUSDT", timeframe, mintick: .01, pointvalue: 1,
  mincontract: .001, quantityStep: .001, currency: "USDT", basecurrency: "BTC" });
// Independent timestamp grouping; deliberately does not use the product's
// aggregate/selector helpers to construct the provider OHLCV oracle.
function group(children, seconds) {
  const groups = new Map();
  for (const child of children) {
    const time = Math.floor(child.time / seconds) * seconds;
    if (!groups.has(time)) groups.set(time, []);
    groups.get(time).push(child);
  }
  return [...groups].map(([time, rows]) => ({ time, open: rows[0].open,
    high: Math.max(...rows.map(bar => bar.high)), low: Math.min(...rows.map(bar => bar.low)),
    close: rows.at(-1).close, volume: rows.reduce((sum, bar) => sum + bar.volume, 0) }));
}
const body = 'var int ordinary=0\nvarip int executions=0\nordinary+=1\nexecutions+=1\nplot(close,"Close")\nplot(barstate.isconfirmed?1:0,"Confirmed")\nplot(ordinary,"Ordinary")\nplot(executions,"Executions")\nplot(ta.sma(close,2),"SMA")';
const script = (timeframe, version = 6, code = body) => `//@version=${version}\nindicator("Calculation snapshot182",timeframe="${timeframe}",timeframe_gaps=false)\n${code}`;
const request = (bars, display, target, extra = {}) => ({ id: "snapshot182", action: "run", mode: "live", source: script(target),
  inputs: {}, context: meta(display), bars, ...extra });
const prices = (result, name) => result.plots.find(plot => plot.name === name).points.map(point => point.value);
const tail = (result, name) => prices(result, name).at(-1);
const select = (input, target, extra = {}) => api.selectPineCalculationSnapshot({ request: input, timeframe: target,
  realtime: true, chartConfirmed: false, sourceConfirmed: false, revision: 7, ...extra });
let nextSession = 0;
async function live(input, streams) {
  const sessionId = "calculation-snapshot182-" + ++nextSession, executor = api.createPineLiveExecutor();
  try {
    const initial = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 0, action: "start",
      request: { ...input, id: sessionId + ":0" }, ...(streams ? { marketStreams: streams } : {}) });
    let sequence = 0;
    return { initial, executor, send: command => executor.execute({ protocol: "pine-live-v1", sessionId, sequence: ++sequence, ...command }) };
  } catch (error) { executor.dispose(); throw error; }
}
const stream = { symbol: "BINANCE:BTCUSDT", timeframe: "1", epoch: 3 };
const remote = (bar, sequence, confirmed = true) => ({ ...stream, sequence, bar, confirmed,
  eventTime: confirmed ? (bar.time + 60) * 1000 - 1 : bar.time * 1000 + sequence, closeTime: (bar.time + 60) * 1000 - 1 });

test("exact chart and exact owned source choose their own boundary and confirmation, not the other feed", () => {
  const children = normalized(Array.from({ length: 5 }, (_, i) => candle(i)));
  const chart = normalized(group(children, 300));
  const input = request(chart, "5", "5", { sourceSnapshot: { timeframe: "1", bars: children } });
  const chartState = select(input, "5", { sourceConfirmed: true });
  assert.equal(chartState.authority, "chart"); assert.equal(chartState.baseTimeframe, "5");
  assert.equal(chartState.boundary, origin + 300); assert.equal(chartState.confirmed, false);
  assert.deepEqual(chartState.bars, chart);
  const sourceState = select(input, "1", { chartConfirmed: true });
  assert.equal(sourceState.authority, "source"); assert.equal(sourceState.baseTimeframe, "1");
  assert.equal(sourceState.boundary, origin + 300); assert.equal(sourceState.confirmed, false);
  assert.deepEqual(sourceState.bars, children);
  assert.equal(select(input, "1", { sourceConfirmed: true }).confirmed, true);
});

test("v5/v6 exact chart calculations stay open when the first M1 child closes; final child commits once", async () => {
  const children = Array.from({ length: 10 }, (_, i) => candle(i));
  for (const version of [5, 6]) {
    const session = await live(request(group(children, 300), "5", "5", {
      source: script("5", version), sourceSnapshot: { timeframe: "1", bars: children } }));
    try {
      const saved = structuredClone(session.initial), current = [];
      for (let i = 10; i < 15; i++) {
        current.push(candle(i));
        const result = await session.send({ action: "update", bar: group(current, 300)[0], confirmed: i === 14,
          source: { bar: current.at(-1), confirmed: true } });
        assert.equal(tail(result, "Close"), 100 + i);
        assert.equal(tail(result, "Confirmed"), i === 14 ? 1 : 0);
        assert.equal(tail(result, "Ordinary"), 3); assert.equal(tail(result, "Executions"), 3 + i - 10);
        assert.equal(tail(result, "SMA"), (109 + 100 + i) / 2);
      }
      const next = candle(15);
      const result = await session.send({ action: "update", bar: group([next], 300)[0], confirmed: false, source: { bar: next, confirmed: false } });
      assert.equal(tail(result, "Ordinary"), 4); assert.equal(tail(result, "Executions"), 8);
      assert.equal(tail(result, "Confirmed"), 0); assert.deepEqual(session.initial, saved);
    } finally { session.executor.dispose(); }
  }
});

test("v5/v6 exact M1 source commits independently while its five-minute display candle is open", async () => {
  const children = Array.from({ length: 10 }, (_, i) => candle(i));
  for (const version of [5, 6]) {
    const session = await live(request(group(children, 300), "5", "1", {
      source: script("1", version), sourceSnapshot: { timeframe: "1", bars: children } }));
    try {
      const opening = candle(10, 120), confirmed = { ...opening, high: 126, close: 124, volume: opening.volume + 2 };
      const first = await session.send({ action: "update", bar: group([opening], 300)[0], confirmed: false, source: { bar: opening, confirmed: false } });
      assert.equal(tail(first, "Confirmed"), 0); assert.equal(tail(first, "Ordinary"), 11); assert.equal(tail(first, "Executions"), 11);
      const close = await session.send({ action: "update", bar: group([confirmed], 300)[0], confirmed: false, source: { bar: confirmed, confirmed: true } });
      assert.equal(tail(close, "Confirmed"), 1); assert.equal(tail(close, "Close"), 124);
      assert.equal(tail(close, "Ordinary"), 11); assert.equal(tail(close, "Executions"), 12);
      const next = candle(11, 125);
      const result = await session.send({ action: "update", bar: group([confirmed, next], 300)[0], confirmed: false, source: { bar: next, confirmed: false } });
      assert.equal(tail(result, "Ordinary"), 12); assert.equal(tail(result, "Executions"), 13);
      assert.equal(tail(result, "Confirmed"), 0); assert.equal(tail(result, "SMA"), 124.5);
      assert.equal(tail(first, "Close"), 120); assert.equal(tail(close, "Close"), 124);
    } finally { session.executor.dispose(); }
  }
});

test("admitted finer ledger cannot replace exact source prices or its confirmation after a remote-only receipt", async () => {
  const m1 = Array.from({ length: 30 }, (_, i) => candle(i)), source = group(m1, 180), chart = group(m1, 900);
  const input = request(chart, "15", "3", { sourceSnapshot: { timeframe: "3", bars: source }, marketData: { provider: "binance",
    snapshots: [{ context: meta("1"), requestedTimeframe: "3", bars: m1, asOf: origin + 1800 }] } });
  const session = await live(input, [stream]);
  try {
    const saved = structuredClone(session.initial);
    const ack = await session.send({ action: "markets", events: [remote(candle(30, 999), 1)] });
    assert.equal(ack.kind, "market-update"); assert.equal(Object.hasOwn(ack, "plots"), false);
    const owned = candle(10, 150, 180);
    const result = await session.send({ action: "update", bar: group([owned], 900)[0], confirmed: false, source: { bar: owned, confirmed: true } });
    assert.equal(tail(result, "Close"), 150); assert.equal(tail(result, "Confirmed"), 1);
    assert.equal(tail(result, "Ordinary"), 11); assert.equal(tail(result, "Executions"), 11);
    assert.deepEqual(session.initial, saved);
  } finally { session.executor.dispose(); }
  const ledger = api.createPineLiveMarketLedger(api.validatePineRequest(input), [stream]);
  const advanced = api.advancePineLiveMarkets(ledger, [remote(candle(30, 999), 1), remote(candle(31, 1000), 2), remote(candle(32, 1001), 3)], input);
  const owned = normalized([...source, candle(10, 151, 180)]);
  const state = select({ ...input, bars: normalized([...chart, group([owned.at(-1)], 900)[0]]), sourceSnapshot: { timeframe: "3", bars: owned } }, "3", {
    marketLedger: advanced, sourceConfirmed: false, chartConfirmed: false });
  assert.equal(state.authority, "source"); assert.equal(state.confirmed, false); assert.equal(state.bars.at(-1).close, 151);
});

test("a longer calculation is developing until the actual final owned native child confirms", async () => {
  const history = Array.from({ length: 15 }, (_, i) => candle(i));
  const session = await live(request(group(history, 300), "5", "15", { sourceSnapshot: { timeframe: "1", bars: history } }));
  try {
    const current = [];
    for (let i = 15; i < 30; i++) {
      const child = candle(i); current.push(child);
      const bucket = current.filter(bar => Math.floor(bar.time / 300) === Math.floor(child.time / 300));
      const result = await session.send({ action: "update", bar: group(bucket, 300)[0], confirmed: i % 5 === 4, source: { bar: child, confirmed: true } });
      assert.equal(tail(result, "Close"), 100 + i); assert.equal(tail(result, "Confirmed"), i === 29 ? 1 : 0);
      assert.equal(tail(result, "Ordinary"), 2); assert.equal(tail(result, "Executions"), 2 + i - 15);
      assert.equal(tail(result, "SMA"), (114 + 100 + i) / 2);
    }
  } finally { session.executor.dispose(); }
});

test("weekly/monthly sparse histories omit incomplete groups without synthetic calendar candles", () => {
  const daily = Array.from({ length: 96 }, (_, i) => candle(i, 100 + i, 86400));
  const monthly = select(request(normalized(daily), "1D", "1M"), "1M", { chartConfirmed: true });
  assert.equal(monthly.authority, "primary"); assert.equal(monthly.confirmed, false);
  assert.deepEqual(monthly.bars.map(bar => [bar.time, bar.close]), [
    [Date.UTC(2024, 0, 1) / 1000, 130], [Date.UTC(2024, 1, 1) / 1000, 159],
    [Date.UTC(2024, 2, 1) / 1000, 190], [Date.UTC(2024, 3, 1) / 1000, 195] ]);
  const sparse = daily.slice(0, 10).filter((_, i) => i !== 2);
  const weekly = select(request(normalized(sparse), "1D", "1W"), "1W", { chartConfirmed: true });
  assert.equal(weekly.confirmed, false); assert.equal(weekly.bars.length, 1);
  assert.equal(weekly.bars[0].time, origin + 7 * 86400); assert.equal(weekly.bars[0].close, 109);
  assert.equal(sparse.length, 9); assert.equal(daily.length, 96);
  for (const target of ["1W", "1M"]) {
    const missingOpening = select(request(normalized(daily.slice(1, 5)), "1D", target), target, { chartConfirmed: true });
    assert.deepEqual(missingOpening.bars, []); assert.equal(missingOpening.confirmed, false);
  }
});

test("source native indices beyond the chart's 20,000 limit remain supported within the 200,000 source bound", async () => {
  const source = Array.from({ length: 20_005 }, (_, i) => candle(i));
  const input = request(group(source, 300), "5", "1", { mode: "historical", sourceSnapshot: { timeframe: "1", bars: source },
    source: script("1", 6, 'plot(close,"Close")\nplot(bar_index,"Native index")') });
  const state = select(input, "1", { realtime: false, sourceConfirmed: true, chartConfirmed: true });
  assert.equal(state.bars.length, 20_005); assert.equal(state.bars.at(-1).time, origin + 20_004 * 60);
  const result = await api.executePineRequest(input);
  assert.equal(result.plots[0].points.length, 4001); assert.equal(tail(result, "Close"), 20_104);
  assert.equal(tail(result, "Native index"), 20_004); assert.equal(source.length, 20_005);
});

test("verified earlier M1 prefix persists across actual replacements confirmations and next calculation buckets", async () => {
  const owned = candle(1), prefix = [candle(0), owned];
  const input = request([owned], "1", "2", { marketData: { provider: "binance", snapshots: [
    { context: meta("1"), requestedTimeframe: "2", bars: prefix, asOf: origin + 120 }] } });
  const session = await live(input);
  try {
    assert.equal(tail(session.initial, "Close"), 101); const saved = structuredClone(session.initial);
    for (const [i, close, confirmed, expectedClosed, ordinary] of [[2, 120, false, 0, 2], [2, 122, true, 0, 2],
      [3, 123, false, 0, 2], [3, 124, true, 1, 2], [4, 125, false, 0, 3]]) {
      const result = await session.send({ action: "update", bar: candle(i, close), confirmed });
      assert.equal(tail(result, "Close"), close); assert.equal(tail(result, "Confirmed"), expectedClosed);
      assert.equal(tail(result, "Ordinary"), ordinary); assert.equal(tail(result, "SMA"), ((i === 4 ? 124 : 101) + close) / 2);
    }
    assert.deepEqual(session.initial, saved); assert.deepEqual(prefix, [candle(0), owned]);
  } finally { session.executor.dispose(); }
  const conflicting = { ...input, marketData: { provider: "binance", snapshots: [
    { context: meta("1"), requestedTimeframe: "2", bars: [candle(0), candle(1, 999)], asOf: origin + 120 }] } };
  await assert.rejects(live(conflicting), error => error.code === "INVALID_LIVE_MARKET" && /conflict|match|owned/i.test(error.message));
});

test("historical exact target snapshot has its own prices while an explicit chart calculation keeps primary prices", async () => {
  const chart = Array.from({ length: 6 }, (_, i) => candle(i, 100 + i, 300));
  const historical = Array.from({ length: 10 }, (_, i) => candle(i, 200 + i, 180));
  const input = request(chart, "5", "3", { mode: "historical", marketData: { provider: "binance", snapshots: [
    { context: meta("3"), requestedTimeframe: "3", bars: historical, asOf: origin + 1800 }] } });
  const state = select(api.validatePineRequest(input), "3", { realtime: false, chartConfirmed: true });
  assert.equal(state.authority, "history"); assert.deepEqual(state.bars.map(bar => bar.close), historical.map(bar => bar.close));
  const result = await api.executePineRequest(input);
  assert.equal(tail(result, "Close"), 209); assert.equal(tail(result, "Confirmed"), 1);
  const primary = await api.executePineRequest({ ...input, source: script("5") });
  assert.deepEqual(prices(primary, "Close"), chart.map(bar => bar.close));
});

test("a verified earlier prefix is copied and reusable without replacing later primary candles", () => {
  const initialSource = { timeframe: "1", bars: normalized([candle(1)]) };
  const snapshot = { context: meta("1"), requestedTimeframe: "2", bars: normalized([candle(0), candle(1)]), asOf: origin + 120 };
  const before = structuredClone({ initialSource, snapshot });
  const prefix = api.preparePineCalculationPrefix(initialSource, snapshot);
  assert.ok(prefix);
  const bars = normalized([candle(1), candle(2, 140), candle(3, 150)]);
  const input = request(bars, "1", "2", { marketData: { provider: "binance", snapshots: [snapshot] } });
  const state = select(input, "2", { initialSource, prefix, chartConfirmed: true });
  assert.deepEqual(state.bars.map(bar => [bar.time, bar.close]), [[origin, 101], [origin + 120, 150]]);
  assert.equal(state.confirmed, true); assert.equal(state.bars.at(-1).volume, 3 + 4);
  assert.deepEqual({ initialSource, snapshot }, before);
  assert.throws(() => api.preparePineCalculationPrefix(initialSource, { ...snapshot,
    bars: normalized([candle(0), candle(1, 999)]) }), error => error.code === "INVALID_LIVE_MARKET");
});

test("a short source snapshot cannot defer the already confirmed exact chart tail", async () => {
  const children = Array.from({ length: 10 }, (_, i) => candle(i));
  const input = request(group(children, 300), "5", "5", { sourceSnapshot: { timeframe: "1", bars: children.slice(0, 5) } });
  const state = select(api.validatePineRequest(input), "5", { chartConfirmed: true, sourceConfirmed: true });
  assert.equal(state.authority, "chart"); assert.equal(state.boundary, origin + 600); assert.equal(state.confirmed, true);
  const session = await live(input);
  try {
    assert.deepEqual(prices(session.initial, "Close"), [104, 109]);
    assert.deepEqual(prices(session.initial, "Confirmed"), [1, 1]);
    assert.deepEqual(prices(session.initial, "Ordinary"), [1, 2]);
    assert.deepEqual(prices(session.initial, "Executions"), [1, 2]);
  } finally { session.executor.dispose(); }
});

test("empty owned source warms verified closed prefix without a synthetic open-tail execution", async () => {
  const children = Array.from({ length: 30 }, (_, i) => candle(i));
  const sourceSnapshot = { timeframe: "1", bars: [] }, snapshot = {
    context: meta("1"), requestedTimeframe: "10", bars: children, asOf: origin + 1800 };
  const input = request(group(children.slice(20), 300), "5", "10", { sourceSnapshot,
    marketData: { provider: "binance", snapshots: [snapshot] } });
  const state = select(api.validatePineRequest(input), "10", { chartConfirmed: true, sourceConfirmed: true });
  assert.equal(state.confirmed, true); assert.equal(state.boundary, origin + 1800);
  assert.deepEqual(state.bars.map(bar => bar.close), [109, 119, 129]);
  const emptyExact = select(api.validatePineRequest(input), "1", { chartConfirmed: true, sourceConfirmed: true });
  assert.equal(emptyExact.authority, "source"); assert.deepEqual(emptyExact.bars, []); assert.equal(emptyExact.confirmed, false);
  const session = await live(input);
  try {
    assert.equal(tail(session.initial, "Close"), 129); assert.equal(tail(session.initial, "Confirmed"), 1);
    assert.equal(tail(session.initial, "Ordinary"), 3); assert.equal(tail(session.initial, "Executions"), 3);
    const child = candle(30, 150);
    const result = await session.send({ action: "update", bar: group([child], 300)[0], confirmed: false,
      source: { bar: child, confirmed: false } });
    assert.equal(tail(result, "Close"), 150); assert.equal(tail(result, "Confirmed"), 0);
    assert.equal(tail(result, "Ordinary"), 4); assert.equal(tail(result, "Executions"), 4);
    assert.equal(tail(result, "SMA"), 139.5); assert.equal(tail(session.initial, "Close"), 129);
  } finally { session.executor.dispose(); }
});
