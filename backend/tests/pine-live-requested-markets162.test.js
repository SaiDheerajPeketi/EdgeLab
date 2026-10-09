import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

// Real compiler, requested engines, rollback, strategy broker and ledger. The
// only input seam is authored closed history and explicitly received candles.
Error.stackTraceLimit = 0;
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser", target: "es2020", write: false,
  logLevel: "silent", plugins: [createPineEnginePlugin()], stdin: { loader: "ts", resolveDir: process.cwd(), sourcefile: "pine-live-requested-markets162.ts",
    contents: 'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineLiveProtocol.ts";' } })).outputFiles[0].text;
console.info("LIVE_REQUESTED162_BINDING " + JSON.stringify({ minified: true, sealedWorker: true,
  bundleSha256: createHash("sha256").update(bundle).digest("hex"), manifestSha256: createHash("sha256").update(fs.readFileSync("frontend/vendor/pinets/manifest.json")).digest("hex") }));
const pine = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const origin = Date.parse("2024-01-01T00:00:00Z") / 1000;
const candle = (index, close = 100 + index, extra = {}) => ({ time: origin + index * 60, open: close - 1, high: close + 2, low: close - 2, close, volume: index + 1, ...extra });
const meta = (symbol, timeframe = "1", extra = {}) => ({ symbol, timeframe, mintick: .01, pointvalue: 1, mincontract: .001,
  quantityStep: .001, currency: "USDT", basecurrency: symbol.includes("ETH") ? "ETH" : symbol.includes("SOL") ? "SOL" : "BTC", ...extra });
const binding = (symbol = "BINANCE:ETHUSDT", epoch = 3) => ({ symbol, timeframe: "1", epoch });
const snapshot = (symbol, count = 3, requestedTimeframe = "1", extra = {}) => ({ context: meta(symbol), requestedTimeframe,
  bars: Array.from({ length: count }, (_, i) => candle(i, (symbol.includes("SOL") ? 200 : 100) + i)), asOf: origin + count * 60, ...extra });
const values = (result, name) => result.plots.find(plot => plot.name === name).points.map(point => point.value);
const tail = (result, name) => values(result, name).at(-1);
const payload = result => structuredClone(Object.fromEntries(["plots", "lines", "labels", "strategy"].map(key => [key, result[key]])));
let number = 0;
async function live(body, { version = 6, chartTimeframe = "1", chart = [0, 1, 2].map(i => candle(i, 10 + i)), snapshots = [snapshot("BINANCE:ETHUSDT")], streams = [binding()], declaration = 'indicator("Requested live162",dynamic_requests=true)', viewport, inputs = {} } = {}) {
  const sessionId = "live-requested162-" + ++number, executor = pine.createPineLiveExecutor();
  const start = { protocol: "pine-live-v1", sessionId, sequence: 0, action: "start", request: { id: sessionId + ":0", action: "run", mode: "live",
    source: `//@version=${version}\n${declaration}\n${body}`, inputs, bars: chart, context: meta("BINANCE:BTCUSDT", chartTimeframe),
    marketData: { provider: "binance", snapshots }, ...(viewport !== undefined ? { viewport } : {}) }, ...(streams !== undefined ? { marketStreams: streams } : {}) };
  try {
    const initial = await executor.execute(start); let sequence = 0;
    return { initial, executor, start, send: command => executor.execute({ protocol: "pine-live-v1", sessionId, sequence: ++sequence, ...command }) };
  } catch (error) { executor.dispose(); throw error; }
}
const market = (index, sequence = 1, close = 100 + index, confirmed = false, extra = {}) => ({ ...binding(), sequence,
  bar: candle(index, close), confirmed, eventTime: confirmed ? (origin + (index + 1) * 60) * 1000 - 1 : (origin + index * 60) * 1000 + sequence,
  closeTime: (origin + (index + 1) * 60) * 1000 - 1, ...extra });

test("v5/v6 remote-only revisions do not calculate main; the next actual primary tick samples two markets and their own metadata", async () => {
  const body = `market=input.symbol("ETHUSDT","Market")
varip int executions=0
executions+=1
[price,tick,minimum,own,main]=request.security(market,"1",[close,syminfo.mintick,syminfo.mincontract,syminfo.tickerid=="BINANCE:ETHUSDT"?1:0,syminfo.main_tickerid=="BINANCE:BTCUSDT"?1:0])
plot(executions,"Main executions")
plot(close,"Main price")
plot(price,"ETH")
plot(tick,"ETH tick")
plot(minimum,"ETH minimum")
plot(own+main,"Identity")
plot(request.security("SOLUSDT","1",close),"SOL")
label.new(bar_index,close,str.tostring(executions))`;
  for (const version of [5, 6]) {
    const session = await live(body, { version, inputs: { in_0: "BINANCE:ETHUSDT" }, streams: [binding(), binding("BINANCE:SOLUSDT", 7)], snapshots: [
      snapshot("BINANCE:ETHUSDT", 3, "1", { context: meta("BINANCE:ETHUSDT", "1", { mintick: .05, mincontract: .002, quantityStep: .002 }) }), snapshot("BINANCE:SOLUSDT")] });
    try {
      assert.deepEqual(values(session.initial, "ETH"), [100, 101, 102]); assert.deepEqual(values(session.initial, "SOL"), [200, 201, 202]);
      const before = payload(session.initial);
      const ack = await session.send({ action: "markets", events: [market(3, 1, 120), market(3, 1, 230, false, { symbol: "BINANCE:SOLUSDT", epoch: 7 })] });
      assert.equal(ack.kind, "market-update"); assert.equal(Object.hasOwn(ack, "plots"), false);
      await session.send({ action: "markets", events: [market(3, 2, 125, false, { bar: candle(3, 125, { open: 119, low: 118, high: 130, volume: 9 }) })] });
      assert.deepEqual(payload(session.initial), before);
      const sampled = await session.send({ action: "update", bar: candle(3, 13), confirmed: false });
      assert.equal(tail(sampled, "Main executions"), 4); assert.equal(tail(sampled, "Main price"), 13);
      assert.equal(tail(sampled, "ETH"), 125); assert.equal(tail(sampled, "SOL"), 230);
      assert.equal(tail(sampled, "ETH tick"), .05); assert.equal(tail(sampled, "ETH minimum"), .002); assert.equal(tail(sampled, "Identity"), 2);
      assert.equal(sampled.labels.length, 4);
      assert.deepEqual(payload(session.initial), before);
    } finally { session.executor.dispose(); }
  }
});

test("closed requested candles catch up contiguously while quiet main samples only the latest forming state", async () => {
  const body = `state()=>
    var int bars=0
    bars+=1
    [bars,ta.sma(close,3)]
[count,average]=request.security("ETHUSDT","1",state())
plot(count,"Requested bars")
plot(average,"Requested SMA")
plot(request.security("ETHUSDT","1",close),"Requested close")
varip int mainExecutions=0
mainExecutions+=1
plot(mainExecutions,"Main executions")`;
  const session = await live(body, { chartTimeframe: "60", chart: [candle(0, 10), candle(60, 11)], snapshots: [snapshot("BINANCE:ETHUSDT", 120)] });
  try {
    assert.deepEqual(values(session.initial, "Requested bars"), [60, 120]);
    const before = payload(session.initial);
    await session.send({ action: "markets", events: [market(120, 1, 220, true), market(121, 2, 221, true), market(122, 3, 222, true), market(123, 4, 230)] });
    assert.deepEqual(payload(session.initial), before);
    const sampled = await session.send({ action: "update", bar: candle(120, 12), confirmed: false });
    assert.equal(tail(sampled, "Main executions"), 3); assert.equal(tail(sampled, "Requested bars"), 124);
    assert.equal(tail(sampled, "Requested close"), 230); assert.ok(Math.abs(tail(sampled, "Requested SMA") - (221 + 222 + 230) / 3) < 1e-10);
    await session.send({ action: "markets", events: [market(123, 5, 235, false, { bar: candle(123, 235, { open: 229, high: 240, low: 228, volume: 125 }) })] });
    const repeated = await session.send({ action: "update", bar: candle(120, 13, { open: 11, low: 10, high: 15, volume: 122 }), confirmed: false });
    assert.equal(tail(repeated, "Requested bars"), 124); assert.ok(Math.abs(tail(repeated, "Requested SMA") - (221 + 222 + 235) / 3) < 1e-10);
    assert.equal(tail(repeated, "Main executions"), 4); assert.deepEqual(payload(session.initial), before);
  } finally { session.executor.dispose(); }
});

test("gaps_on follows the requested candle's own confirmation independently of main candle confirmation", async () => {
  const session = await live('plot(request.security("ETHUSDT","1",close),"Remote")\nplot(request.security("ETHUSDT","1",close,gaps=barmerge.gaps_on),"Confirmed remote")\nplot(barstate.isconfirmed,"Main confirmed")');
  try {
    await session.send({ action: "markets", events: [market(3, 1, 120)] });
    const open = await session.send({ action: "update", bar: candle(3, 13), confirmed: false });
    assert.equal(tail(open, "Remote"), 120); assert.equal(tail(open, "Confirmed remote"), null); assert.equal(tail(open, "Main confirmed"), false);
    await session.send({ action: "markets", events: [market(3, 2, 120, true)] });
    const remoteClosed = await session.send({ action: "update", bar: candle(3, 14), confirmed: false });
    assert.equal(tail(remoteClosed, "Confirmed remote"), 120); assert.equal(tail(remoteClosed, "Main confirmed"), false);
    await session.send({ action: "markets", events: [market(4, 3, 130)] });
    const mainClosed = await session.send({ action: "update", bar: candle(3, 14), confirmed: true });
    assert.equal(tail(mainClosed, "Remote"), 130); assert.equal(tail(mainClosed, "Confirmed remote"), null); assert.equal(tail(mainClosed, "Main confirmed"), true);
  } finally { session.executor.dispose(); }
});

test("security_lower_tf arrays contain actual foreign children, never primary prices or fabricated future candles", async () => {
  const body = 'children=request.security_lower_tf("ETHUSDT","1",close)\nplot(array.size(children),"Count")\nplot(array.sum(children),"Sum")\nplot(array.size(children)>0?array.get(children,array.size(children)-1):na,"Last")';
  const session = await live(body, { chartTimeframe: "5", chart: [candle(0, 10), candle(5, 11), candle(10, 12)], snapshots: [snapshot("BINANCE:ETHUSDT", 15)] });
  try {
    assert.deepEqual(values(session.initial, "Count"), [5, 5, 5]); assert.deepEqual(values(session.initial, "Sum"), [510, 535, 560]);
    await session.send({ action: "markets", events: [market(15, 1, 115, true), market(16, 2, 116)] });
    const sampled = await session.send({ action: "update", bar: candle(15, 13), confirmed: false });
    assert.equal(tail(sampled, "Count"), 2); assert.equal(tail(sampled, "Sum"), 231); assert.equal(tail(sampled, "Last"), 116);
    assert.deepEqual(values(session.initial, "Sum"), [510, 535, 560]);
  } finally { session.executor.dispose(); }
});

test("forming requested HTF uses only a contiguous actual prefix, omits a partial seed prefix and confirms at its own boundary", async () => {
  const supplied = snapshot("BINANCE:ETHUSDT", 15, "5"); supplied.bars = supplied.bars.slice(2);
  const session = await live('plot(request.security("ETHUSDT","5",close),"HTF")\nplot(request.security("ETHUSDT","5",close,gaps=barmerge.gaps_on),"Confirmed HTF")',
    { chart: Array.from({ length: 15 }, (_, i) => candle(i, 10 + i)), snapshots: [supplied] });
  try {
    assert.deepEqual(values(session.initial, "HTF"), [...Array(9).fill(null), 109, 109, 109, 109, 109, 114]);
    const originalBars = structuredClone(session.start.request.marketData.snapshots[0].bars);
    await session.send({ action: "markets", events: [market(15, 1, 250)] });
    const forming = await session.send({ action: "update", bar: candle(15, 25), confirmed: false });
    assert.equal(tail(forming, "HTF"), 250); assert.equal(tail(forming, "Confirmed HTF"), null);
    await session.send({ action: "markets", events: [market(15, 2, 250, true), market(16, 3, 251, true), market(17, 4, 252, true), market(18, 5, 253, true), market(19, 6, 254, true)] });
    const remoteClosed = await session.send({ action: "update", bar: candle(15, 26, { open: 24, low: 23, high: 28, volume: 17 }), confirmed: false });
    assert.equal(tail(remoteClosed, "HTF"), 254); assert.equal(tail(remoteClosed, "Confirmed HTF"), 254);
    await session.send({ action: "markets", events: [market(20, 7, 260)] });
    const nextRemote = await session.send({ action: "update", bar: candle(15, 26, { open: 24, low: 23, high: 28, volume: 17 }), confirmed: true });
    assert.equal(tail(nextRemote, "HTF"), 260); assert.equal(tail(nextRemote, "Confirmed HTF"), null);
    assert.deepEqual(session.start.request.marketData.snapshots[0].bars, originalBars);
    assert.equal(tail(forming, "HTF"), 250);
  } finally { session.executor.dispose(); }
});

test("viewport recalculation retains the latest owned remote ledger rather than reopening its stale seed", async () => {
  const session = await live('plot(request.security("ETHUSDT","1",close),"Remote")\nplot(chart.left_visible_bar_time,"Left")', { viewport: { from: origin, to: origin + 120 } });
  try {
    await session.send({ action: "markets", events: [market(3, 1, 140)] });
    const sampled = await session.send({ action: "update", bar: candle(3, 13), confirmed: false }); assert.equal(tail(sampled, "Remote"), 140);
    const rebuilt = await session.send({ action: "viewport", viewport: { from: origin + 60, to: origin + 180 } });
    assert.equal(rebuilt.usesVisibleRange, true); assert.equal(tail(rebuilt, "Left"), (origin + 60) * 1000); assert.equal(tail(rebuilt, "Remote"), 140);
    await session.send({ action: "markets", events: [market(3, 2, 145, false, { bar: candle(3, 145, { open: 139, low: 138, high: 150, volume: 6 }) })] });
    const next = await session.send({ action: "update", bar: candle(3, 14), confirmed: false }); assert.equal(tail(next, "Remote"), 145);
    assert.equal(tail(sampled, "Remote"), 140);
  } finally { session.executor.dispose(); }
});

test("static nested requests refresh BTC inputs on BTC-only ticks even when the ETH ledger revision is unchanged", async () => {
  const session = await live('inner=request.security("","",close)\nplot(request.security("ETHUSDT","1",inner+close),"Mixed")\nplot(request.security("ETHUSDT","1",close),"Remote")',
    { declaration: 'indicator("Static nested162",dynamic_requests=false)' });
  try {
    assert.deepEqual(values(session.initial, "Mixed"), [110, 112, 114]);
    await session.send({ action: "markets", events: [market(3, 1, 120)] });
    const first = await session.send({ action: "update", bar: candle(3, 13), confirmed: false });
    assert.equal(tail(first, "Mixed"), 133); assert.equal(tail(first, "Remote"), 120);
    const second = await session.send({ action: "update", bar: candle(3, 14, { open: 12, low: 11, high: 16, volume: 5 }), confirmed: false });
    assert.equal(tail(second, "Mixed"), 134); assert.equal(tail(second, "Remote"), 120);
    assert.equal(tail(first, "Mixed"), 133);
  } finally { session.executor.dispose(); }
});

test("an unbound remote snapshot cannot silently become a live engine or inherit the primary stream", async () => {
  const executor = pine.createPineLiveExecutor(), sessionId = "live-requested162-unbound";
  try {
    await assert.rejects(executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 0, action: "start", request: {
      id: sessionId + ":0", action: "run", mode: "live", source: '//@version=6\nindicator("Unbound162")\nplot(request.security("ETHUSDT","1",close))',
      inputs: {}, context: meta("BINANCE:BTCUSDT"), bars: [0, 1, 2].map(i => candle(i, 10 + i)), marketData: { provider: "binance", snapshots: [snapshot("BINANCE:ETHUSDT")] } } }), error => error.code === "UNAVAILABLE_DATA");
  } finally { executor.dispose(); }
});

test("foreign prices can inform a strategy only on actual primary execution and never fill a main order on remote events", async () => {
  const body = `varip int executions=0
executions+=1
remote=request.security("ETHUSDT","1",close)
plot(remote,"Remote")
plot(executions,"Main executions")
if bar_index==2
    strategy.entry("Main",strategy.long,qty=1,limit=80)`;
  const session = await live(body, { chart: [0, 1, 2].map(i => candle(i, 100)), declaration: 'strategy("Requested strategy162",calc_on_every_tick=true,initial_capital=10000)' });
  try {
    const before = payload(session.initial); assert.equal(session.initial.strategy.pendingOrders.length, 1);
    await session.send({ action: "markets", events: [market(3, 1, 70), market(3, 2, 70, true), market(4, 3, 60)] });
    assert.deepEqual(payload(session.initial), before);
    const actual = await session.send({ action: "update", bar: candle(3, 70), confirmed: false });
    assert.equal(tail(actual, "Main executions"), 4); assert.equal(tail(actual, "Remote"), 60);
    assert.equal(actual.strategy.openTrades.length, 1); assert.equal(actual.strategy.openTrades[0].entry_price, 70); assert.equal(actual.strategy.openTrades[0].entry_bar_index, 3);
    assert.deepEqual(payload(session.initial), before);
  } finally { session.executor.dispose(); }
});
