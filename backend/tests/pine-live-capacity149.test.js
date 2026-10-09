import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser",
  target: "es2020", write: false, logLevel: "silent", plugins: [createPineEnginePlugin()],
  stdin: { contents: 'export * from "./frontend/src/workers/pineNative.worker.ts";',
    resolveDir: process.cwd(), sourcefile: "pine-live-capacity149.ts", loader: "ts" },
})).outputFiles[0].text;
console.info("LIVE_CAPACITY149_BINDING " + JSON.stringify({ minify: true,
  bundleSha256: createHash("sha256").update(bundle).digest("hex"),
  manifestSha256: createHash("sha256").update(fs.readFileSync("frontend/vendor/pinets/manifest.json")).digest("hex") }));
const pine = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const origin = Math.floor(1_700_000_040 / 3600) * 3600;
const context = { symbol: "CAPACITY:ORACLE", timeframe: "60", mintick: 1, pointvalue: 1, mincontract: 1, quantityStep: 1 };
const candle = (index, close, high = Math.max(100, close)) => ({ time: origin + index * 3600,
  open: index < 3 ? close : 100, high, low: Math.min(100, close), close, volume: 10 });
const history = [90, 100, 110].map((close, index) => candle(index, close));
const values = (result, name) => result.plots.find(plot => plot.name === name)?.points.map(point => point.value) ?? [];
const tail = (result, name) => values(result, name).at(-1);
const reject = (code, message) => cause => {
  assert.equal(cause.code, code, cause.message);
  if (message) assert.match(cause.message, message);
  return true;
};
let ordinal = 0;
async function live(source) {
  const sessionId = "live-capacity149-" + ++ordinal;
  const executor = pine.createPineLiveExecutor();
  const request = { id: sessionId + ":0", action: "run", source, mode: "live", context, inputs: {}, bars: history };
  const result = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 0, action: "start", request });
  let sequence = 0;
  return { executor, request, result, step: (bar, confirmed = false) => executor.execute({ protocol: "pine-live-v1", sessionId,
    sequence: ++sequence, action: "update", bar, confirmed }) };
}

for (const version of [5, 6]) test(`v${version}: 1025 actual updates retain rollback, TA, history and late next-tick orders`, async () => {
  const source = `//@version=${version}
strategy("Long open candle",initial_capital=1000000,calc_on_every_tick=true)
var int ordinary=0
varip int cumulative=0
varip int tick=0
if barstate.isnew
    tick:=0
ordinary+=1
cumulative+=1
tick+=1
plot(ordinary,"Ordinary")
plot(cumulative,"Cumulative")
plot(tick,"Tick")
plot(ordinary[1],"Prior ordinary")
plot(close[1],"Prior close")
plot(ta.sma(close,3),"SMA")
plot(barstate.isnew,"New")
plot(barstate.isconfirmed,"Confirmed")
if barstate.isrealtime and tick==513
    strategy.entry("Late",strategy.long,qty=1)
if barstate.isrealtime and tick==1025
    strategy.close("Late")`;
  const session = await live(source);
  try {
    assert.deepEqual(values(session.result, "Ordinary"), [1, 2, 3]);
    assert.equal(tail(session.result, "SMA"), 100);
    const warmSnapshot = structuredClone(session.result);
    let result, first, held;
    for (let event = 1; event <= 1025; event++) {
      const close = 120 + event % 7;
      result = await session.step(candle(3, close, 128));
      assert.equal(result.audit.bars, 4);
      assert.equal(values(result, "Ordinary").length, 4, "one provisional slot, not one slot per update");
      assert.equal(tail(result, "Ordinary"), 4);
      assert.equal(tail(result, "Cumulative"), 3 + event);
      assert.equal(tail(result, "Tick"), event);
      assert.equal(tail(result, "Prior ordinary"), 3);
      assert.equal(tail(result, "Prior close"), 110);
      assert.ok(Math.abs(tail(result, "SMA") - (100 + 110 + close) / 3) < 1e-10);
      assert.equal(tail(result, "New"), event === 1);
      assert.equal(tail(result, "Confirmed"), false);
      if (event === 1) { first = result; held = structuredClone(result); }
      if (event === 513) {
        assert.equal(result.strategy.openTrades.length, 0);
        assert.deepEqual(result.strategy.pendingOrders.map(order => order.id), ["Late"]);
      }
      if (event >= 514) {
        assert.equal(result.strategy.openTrades.length, 1);
        assert.equal(result.strategy.openTrades[0].entry_price, 123);
        assert.equal(result.strategy.closedTrades.length, 0);
      }
    }
    assert.deepEqual(session.result, warmSnapshot, "warm output stays immutable");
    assert.deepEqual(first, held, "earlier provisional output stays immutable");
    assert.deepEqual(result.strategy.pendingOrders.map(order => [order.id, order.type]), [["Close entry(s) order Late", "market"]]);
    const confirmed = await session.step(candle(3, 128, 128), true);
    assert.equal(tail(confirmed, "Cumulative"), 1029);
    assert.equal(tail(confirmed, "Tick"), 1026);
    assert.equal(tail(confirmed, "Ordinary"), 4);
    assert.equal(tail(confirmed, "Confirmed"), true);
    assert.deepEqual(confirmed.strategy.closedTrades.map(trade => [trade.entry_id, trade.entry_price, trade.exit_price,
      trade.entry_bar_index, trade.exit_bar_index, trade.profit]), [["Late", 123, 128, 3, 3, 5]]);
    const next = await session.step(candle(4, 129));
    assert.equal(next.audit.bars, 5);
    assert.equal(tail(next, "Ordinary"), 5);
    assert.equal(tail(next, "Cumulative"), 1030);
    assert.equal(tail(next, "Tick"), 1);
    assert.equal(tail(next, "Prior ordinary"), 4);
    assert.equal(tail(next, "Prior close"), 128);
    assert.equal(tail(next, "New"), true);
    assert.ok(Math.abs(tail(next, "SMA") - (110 + 128 + 129) / 3) < 1e-10);
    assert.equal(next.strategy.closedTrades.length, 1);
    assert.equal(next.strategy.pendingOrders.length, 0);
  } finally { session.executor.dispose(); }
});

test("a trail armed before update512 retains its peak and exits after update512", async () => {
  const session = await live(`//@version=6
strategy("Long lived trailing order",initial_capital=1000000,calc_on_every_tick=true)
varip int tick=0
if barstate.isnew
    tick:=0
tick+=1
if bar_index==2
    strategy.entry("A",strategy.long,qty=1)
if barstate.isrealtime and tick==1
    strategy.exit("Trail","A",trail_price=130,trail_offset=5)
plot(tick,"Tick")`);
  try {
    const entered = await session.step(candle(3, 100));
    assert.equal(entered.strategy.openTrades[0].entry_price, 100);
    const armed = await session.step(candle(3, 130));
    assert.equal(armed.strategy.closedTrades.length, 0);
    for (let event = 3; event <= 512; event++) {
      const peak = await session.step(candle(3, 140));
      assert.equal(tail(peak, "Tick"), event);
      assert.equal(peak.strategy.closedTrades.length, 0);
    }
    const exited = await session.step(candle(3, 133, 140));
    assert.equal(tail(exited, "Tick"), 513);
    assert.deepEqual(exited.strategy.closedTrades.map(trade => [trade.entry_price, trade.exit_price, trade.profit]), [[100, 133, 33]]);
    const idle = await session.step(candle(3, 133, 140));
    assert.equal(idle.strategy.closedTrades.length, 1);
  } finally { session.executor.dispose(); }
});

test("more than512 fill recalculations inside one received event still halt the session", async () => {
  const session = await live(`//@version=6
strategy("Bounded event calculations",initial_capital=1000000,calc_on_every_tick=true,calc_on_order_fills=true)
if bar_index==2
    for i=0 to 512
        strategy.order("A"+str.tostring(i),strategy.long,qty=1)
plot(close,"Price")`);
  try {
    assert.equal(session.result.strategy.pendingOrders.length, 513);
    await assert.rejects(session.step(candle(3, 100)), reject("STRATEGY_EXECUTION_LIMIT", /512 calculations in one received event/));
    await assert.rejects(session.step(candle(3, 101)), reject("LIVE_SESSION_HALTED"));
  } finally { session.executor.dispose(); }
});

test("more than2048 broker transitions inside one received event still halt the session", async () => {
  const session = await live(`//@version=6
strategy("Bounded event transitions",initial_capital=1000000,calc_on_every_tick=true)
if bar_index==2
    for i=0 to 2048
        strategy.order("A"+str.tostring(i),strategy.long,qty=1,stop=120,limit=90)
plot(close,"Price")`);
  try {
    assert.equal(session.result.strategy.pendingOrders.length, 2049);
    await assert.rejects(session.step(candle(3, 130)), reject("STRATEGY_EXECUTION_LIMIT", /2,048 broker transitions in one received event/));
    await assert.rejects(session.step(candle(3, 80, 130)), reject("LIVE_SESSION_HALTED"));
  } finally { session.executor.dispose(); }
});

test("historical same-close fill cascades remain bounded per historical bar", async () => {
  const source = `//@version=6
strategy("Bounded historical calculations",initial_capital=1000000,calc_on_order_fills=true,process_orders_on_close=true)
if strategy.position_size==0
    strategy.entry("A",strategy.long,qty=1)
else
    strategy.close("A",immediately=true)
plot(close,"Price")`;
  await assert.rejects(pine.executePineRequest({ id: "historical-capacity149", action: "run", mode: "historical",
    source, context, bars: history.slice(0, 1), inputs: {} }), reject("STRATEGY_EXECUTION_LIMIT", /512 calculations in one bar/));
});
