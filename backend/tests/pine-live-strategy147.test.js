import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser",
  target: "es2020", write: false, logLevel: "silent", plugins: [createPineEnginePlugin()],
  stdin: { contents: 'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineLiveProtocol.ts"; export * from "./frontend/src/lib/pineProtocol.ts"; export * from "./frontend/src/lib/pinePacked.ts";',
    resolveDir: process.cwd(), sourcefile: "pine-live-strategy147.ts", loader: "ts" },
})).outputFiles[0].text;
console.info("LIVE_STRATEGY147_BINDING " + JSON.stringify({ minify: true,
  bundleSha256: createHash("sha256").update(bundle).digest("hex"),
  manifestSha256: createHash("sha256").update(fs.readFileSync("frontend/vendor/pinets/manifest.json")).digest("hex") }));
const pine = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const origin = 1_700_000_040;
const candle = (index, close = 100, extrema = {}) => ({ time: origin + index * 60, open: 100,
  high: Math.max(100, close), low: Math.min(100, close), close, volume: 10, ...extrema });
const history = [0, 1, 2].map(index => candle(index));
const context = { symbol: "STRATEGY:ORACLE", timeframe: "1", mintick: 1, pointvalue: 1, mincontract: 1, quantityStep: 1 };
const counters = `var int ordinary=0
varip int executions=0
ordinary+=1
executions+=1
plot(ordinary,"Ordinary")
plot(executions,"Executions")
plot(strategy.position_size,"Position")
plot(barstate.isconfirmed,"Confirmed")
plot(barstate.isnew,"New")`;
const script = (body = "", settings = "") => `//@version=6\nstrategy("Live strategy oracle",initial_capital=10000,overlay=true${settings ? "," + settings : ""})\n${body}`;
const values = (result, name) => result.plots.find(plot => plot.name === name)?.points.map(point => point.value) ?? [];
const tail = (result, name) => values(result, name).at(-1);
const ledger = result => ({ open: result.strategy.openTrades.map(trade => [trade.entry_id, trade.entry_price, trade.size, trade.entry_bar_index]),
  closed: result.strategy.closedTrades.map(trade => [trade.entry_id, trade.entry_price, trade.exit_price, trade.size, trade.profit, trade.entry_bar_index, trade.exit_bar_index]),
  pending: result.strategy.pendingOrders.map(order => [order.id, order.type, order.qty, order.limit, order.stop]),
  position: result.strategy.metrics.position_size, profit: result.strategy.metrics.netprofit });
const failure = code => cause => { assert.equal(cause.code, code, cause.message); return true; };
let ordinal = 0;
async function live(source, extra = {}, bars = history) {
  const sessionId = "live-strategy147-" + ++ordinal;
  const start = { protocol: "pine-live-v1", sessionId, sequence: 0, action: "start", request: {
    id: sessionId + ":0", action: "run", source, mode: "live", context, inputs: {}, bars, ...extra } };
  const executor = pine.createPineLiveExecutor();
  const result = await executor.execute(start);
  let sequence = 0;
  return { executor, start, result, step: (bar, confirmed = false) => executor.execute({ protocol: "pine-live-v1", sessionId,
    sequence: ++sequence, action: "update", bar, confirmed }) };
}

// Only authored chart events enter the seam. Broker, compiler, rollback and output are real.
test("default close-only strategy fills historical pending orders on actual ticks without calculating", async () => {
  const source = script(counters + '\nif bar_index==2\n    strategy.entry("A",strategy.long,qty=1)');
  const session = await live(source);
  try {
    assert.deepEqual(values(session.result, "Executions"), [1, 2, 3]);
    assert.equal(session.result.strategy.pendingOrders.length, 1);
    const open = await session.step(candle(3, 105));
    assert.deepEqual(ledger(open).open, [["A", 105, 1, 3]]);
    assert.deepEqual(values(open, "Executions").filter(value => value != null), [1, 2, 3]);
    const unchanged = await session.step(candle(3, 105));
    assert.deepEqual(ledger(unchanged).open, [["A", 105, 1, 3]]);
    const closed = await session.step(candle(3, 110), true);
    assert.deepEqual(values(closed, "Executions"), [1, 2, 3, 4]);
    assert.equal(tail(closed, "Position"), 1);
    assert.equal(tail(closed, "Confirmed"), true);
    assert.equal(tail(closed, "New"), false);
    const next = await session.step(candle(4, 110));
    assert.deepEqual(values(next, "Executions").filter(value => value != null), [1, 2, 3, 4]);
    assert.equal(next.strategy.openTrades.length, 1);
    assert.equal(next.strategy.openTrades[0].max_runup, 5);
  } finally { session.executor.dispose(); }
});

test("every-tick input values and var rollback preserve broker fills and exact received execution counts", async () => {
  const source = script('increment=input.int(1,"Increment",minval=1,maxval=4)\n' + counters.replace('ordinary+=1', 'ordinary+=increment').replace('executions+=1', 'executions+=increment')
    + '\nif barstate.isrealtime and executions==8\n    strategy.entry("A",strategy.long,qty=1)', 'calc_on_every_tick=true');
  const session = await live(source, { inputs: { in_0: 2 } });
  try {
    assert.deepEqual(values(session.result, "Executions"), [2, 4, 6]);
    const first = await session.step(candle(3, 100));
    assert.equal(tail(first, "Executions"), 8);
    assert.equal(tail(first, "Ordinary"), 8);
    assert.equal(first.strategy.openTrades.length, 0);
    assert.equal(first.strategy.pendingOrders.length, 1);
    const second = await session.step(candle(3, 100));
    assert.equal(tail(second, "Executions"), 10);
    assert.equal(tail(second, "Ordinary"), 8);
    assert.deepEqual(ledger(second).open, [["A", 100, 1, 3]]);
    const third = await session.step(candle(3, 102));
    assert.equal(tail(third, "Executions"), 12);
    assert.equal(tail(third, "Ordinary"), 8);
    assert.equal(third.strategy.openTrades.length, 1);
    const closed = await session.step(candle(3, 102), true);
    assert.deepEqual(values(closed, "Executions"), [2, 4, 6, 14]);
    assert.equal(tail(closed, "Ordinary"), 8);
    const next = await session.step(candle(4, 103));
    assert.deepEqual(values(next, "Executions"), [2, 4, 6, 14, 16]);
    assert.equal(tail(next, "Ordinary"), 10);
  } finally { session.executor.dispose(); }
});

for (const [type, level, received] of [["stop", 130, 140], ["limit", 80, 70]]) {
  test(`new ${type} never reuses earlier candle extremes and fills at the next actual marketable price`, async () => {
    const source = script(counters + `\nif barstate.isrealtime and executions==4\n    strategy.entry("A",strategy.long,qty=1,${type}=${level})`, 'calc_on_every_tick=true');
    const session = await live(source);
    try {
      await session.step(candle(3, 100, { high: 150, low: 50 }));
      const second = await session.step(candle(3, 110, { high: 150, low: 50 }));
      assert.equal(second.strategy.openTrades.length, 0);
      assert.equal(second.strategy.pendingOrders.length, 1);
      const third = await session.step(candle(3, received, { high: 150, low: 50 }));
      assert.deepEqual(ledger(third).open, [["A", received, 1, 3]]);
      assert.equal(third.strategy.openTrades[0].max_runup, 0);
      assert.equal(third.strategy.openTrades[0].max_drawdown, 0);
    } finally { session.executor.dispose(); }
  });
}

test("same-bar pending generation replacement and cancellation release the old price trigger", async () => {
  const source = script(counters + `
if barstate.isrealtime and executions==4
    strategy.entry("A",strategy.long,qty=1,limit=90)
if barstate.isrealtime and executions==5
    strategy.entry("A",strategy.long,qty=2,limit=80)
if barstate.isrealtime and executions==6
    strategy.cancel("A")`, 'calc_on_every_tick=true');
  const session = await live(source);
  try {
    await session.step(candle(3, 100));
    const replaced = await session.step(candle(3, 100));
    assert.deepEqual(ledger(replaced).pending, [["A", "limit", 2, 80, null]]);
    const canceled = await session.step(candle(3, 85));
    assert.equal(canceled.strategy.openTrades.length, 0);
    assert.equal(canceled.strategy.pendingOrders.length, 0);
    const oldTrigger = await session.step(candle(3, 75));
    assert.equal(oldTrigger.strategy.openTrades.length, 0);
    assert.equal(oldTrigger.strategy.pendingOrders.length, 0);
  } finally { session.executor.dispose(); }
});

test("strategy.order pending ID replacement cancels the obsolete same-bar price trigger", async () => {
  const source = script(counters + `
if barstate.isrealtime and executions==4
    strategy.order("A",strategy.long,qty=1,limit=90)
if barstate.isrealtime and executions==5
    strategy.order("A",strategy.long,qty=2,limit=80)
if barstate.isrealtime and executions==6
    strategy.cancel("A")`, 'calc_on_every_tick=true');
  const session = await live(source);
  try {
    await session.step(candle(3, 100));
    const replaced = await session.step(candle(3, 100));
    assert.deepEqual(ledger(replaced).pending, [["A", "limit", 2, 80, null]]);
    const canceled = await session.step(candle(3, 85));
    assert.equal(canceled.strategy.openTrades.length, 0);
    assert.equal(canceled.strategy.pendingOrders.length, 0);
    const oldTrigger = await session.step(candle(3, 75));
    assert.equal(oldTrigger.strategy.openTrades.length, 0);
    assert.equal(oldTrigger.strategy.pendingOrders.length, 0);
  } finally { session.executor.dispose(); }
});

test("close processing waits for an actual confirmed event and immediate close is the explicit exception", async () => {
  for (const immediate of [false, true]) {
    const source = script(counters + `
if barstate.isrealtime and executions==4
    strategy.entry("A",strategy.long,qty=1)
if barstate.isrealtime and executions==6
    strategy.close("A",immediately=${immediate})`, 'calc_on_every_tick=true,process_orders_on_close=true');
    const session = await live(source);
    try {
      const first = await session.step(candle(3, 100));
      assert.equal(first.strategy.openTrades.length, 0, "open tick is not process_orders_on_close");
      await session.step(candle(3, 101));
      const closeOrder = await session.step(candle(3, 105));
      assert.equal(closeOrder.strategy.closedTrades.length, immediate ? 1 : 0);
      if (immediate) assert.deepEqual(ledger(closeOrder).closed, [["A", 101, 105, 1, 4, 3, 3]]);
      const confirmed = await session.step(candle(3, 108), true);
      assert.deepEqual(ledger(confirmed).closed, [["A", 101, immediate ? 105 : 108, 1, immediate ? 4 : 7, 3, 3]]);
    } finally { session.executor.dispose(); }
  }
  const atClose = await live(script(counters + '\nif barstate.isrealtime and barstate.isconfirmed\n    strategy.entry("A",strategy.long,qty=1)', 'process_orders_on_close=true'));
  try {
    await atClose.step(candle(3, 100));
    const closed = await atClose.step(candle(3, 109), true);
    assert.deepEqual(ledger(closed).open, [["A", 109, 1, 3]]);
    assert.equal(closed.strategy.pendingOrders.length, 0);
  } finally { atClose.executor.dispose(); }
});

test("trail activation on an earlier tick of the same bar survives to a later reversal", async () => {
  const source = script(counters + `
if barstate.isrealtime and executions==4
    strategy.entry("A",strategy.long,qty=1)
if barstate.isrealtime and executions==5
    strategy.exit("Trail","A",trail_price=110,trail_offset=5)`, 'calc_on_every_tick=true');
  const session = await live(source);
  try {
    await session.step(candle(3, 100));
    await session.step(candle(3, 100));
    await session.step(candle(3, 112));
    const peak = await session.step(candle(3, 120));
    assert.equal(peak.strategy.closedTrades.length, 0);
    const reversed = await session.step(candle(3, 113, { high: 120 }));
    assert.deepEqual(ledger(reversed).closed, [["A", 100, 113, 1, 13, 3, 3]]);
    assert.equal(reversed.strategy.closedTrades[0].exit_id, "Trail");
  } finally { session.executor.dispose(); }
});

test("actual same-bar prices apply quantity, slippage and commissions once per fill", async () => {
  const source = script(counters + `
if barstate.isrealtime and executions==4
    strategy.entry("A",strategy.long,qty=2)
if barstate.isrealtime and executions==6
    strategy.close("A")`, 'calc_on_every_tick=true,commission_type=strategy.commission.cash_per_order,commission_value=1,slippage=2');
  const session = await live(source);
  try {
    await session.step(candle(3, 100));
    const entry = await session.step(candle(3, 100));
    assert.deepEqual(ledger(entry).open, [["A", 102, 2, 3]]);
    await session.step(candle(3, 110));
    const exit = await session.step(candle(3, 110));
    assert.deepEqual(ledger(exit).closed, [["A", 102, 108, 2, 10, 3, 3]]);
    assert.equal(exit.strategy.closedTrades[0].commission, 2);
    assert.equal(exit.strategy.metrics.netprofit, 10);
    const unchanged = await session.step(candle(3, 110));
    assert.deepEqual(ledger(unchanged), ledger(exit));
  } finally { session.executor.dispose(); }
});

test("close-only fill recalculation observes new position without a synthetic extra received tick", async () => {
  const source = script(counters + `
if bar_index==2
    strategy.entry("A",strategy.long,qty=1)
if barstate.isrealtime and strategy.position_size>0 and strategy.closedtrades==0
    strategy.exit("X","A",limit=110)
    label.new(bar_index,close,"Fill")`, 'calc_on_order_fills=true');
  const session = await live(source);
  try {
    const filled = await session.step(candle(3, 100));
    assert.equal(tail(filled, "Executions"), 4);
    assert.equal(tail(filled, "Position"), 1);
    assert.equal(filled.strategy.pendingOrders.length, 1);
    assert.equal(filled.labels.length, 1);
    const retainedLabels = structuredClone(filled.labels);
    const idle = await session.step(candle(3, 105));
    assert.equal(tail(idle, "Executions"), 4);
    assert.deepEqual(idle.labels, retainedLabels, "broker-only event does not rollback script drawings");
    const exited = await session.step(candle(3, 112));
    assert.equal(tail(exited, "Executions"), 5);
    assert.equal(tail(exited, "Position"), 0);
    assert.deepEqual(ledger(exited).closed, [["A", 100, 112, 1, 12, 3, 3]]);
    const closed = await session.step(candle(3, 112), true);
    assert.equal(tail(closed, "Executions"), 6);
    assert.equal(tail(closed, "Ordinary"), 4);
  } finally { session.executor.dispose(); }
});

test("every-tick plus fill recalculation retains distinct scheduled and fill executions", async () => {
  const source = script(counters + '\nif barstate.isrealtime and executions==4\n    strategy.entry("A",strategy.long,qty=1)', 'calc_on_every_tick=true,calc_on_order_fills=true');
  const session = await live(source);
  try {
    const first = await session.step(candle(3, 100));
    assert.equal(tail(first, "Executions"), 4);
    const filled = await session.step(candle(3, 101));
    assert.equal(tail(filled, "Executions"), 6, "one fill execution and one scheduled tick execution");
    assert.equal(tail(filled, "Ordinary"), 4);
    assert.equal(filled.strategy.openTrades.length, 1);
    const idle = await session.step(candle(3, 101));
    assert.equal(tail(idle, "Executions"), 7);
  } finally { session.executor.dispose(); }
});

test("closed warmup ledger equals a genuine snapshot and constant settings resolve before live execution", async () => {
  const source = `//@version=6
const bool every=true
strategy("Constant strategy",initial_capital=10000,calc_on_every_tick=every)
${counters}
if bar_index==0
    strategy.entry("A",strategy.long,qty=1)`;
  const session = await live(source);
  try {
    const snapshot = await pine.executePineRequest({ ...session.start.request, id: "snapshot-strategy147", mode: "historical" });
    assert.deepEqual(ledger(session.result), ledger(snapshot));
    assert.deepEqual(values(session.result, "Executions"), values(snapshot, "Executions"));
    const first = await session.step(candle(3, 103));
    assert.equal(tail(first, "Executions"), 4);
    assert.equal(first.strategy.config.calc_on_every_tick, true);
  } finally { session.executor.dispose(); }
});

test("live strategy sequence, explicit disposal and pending initialization never publish after ownership loss", async () => {
  for (const wrong of ["skip", "repeat", "foreign"]) {
    const session = await live(script(counters, 'calc_on_every_tick=true'));
    await session.step(candle(3, 100));
    const command = { protocol: "pine-live-v1", sessionId: wrong === "foreign" ? "foreign-strategy147" : session.start.sessionId,
      sequence: wrong === "repeat" ? 1 : wrong === "skip" ? 3 : 2, action: "update", bar: candle(3, 101), confirmed: false };
    await assert.rejects(session.executor.execute(command), failure(wrong === "foreign" ? "LIVE_SESSION_MISMATCH" : "LIVE_SEQUENCE"));
    await assert.rejects(session.step(candle(3, 102)), failure("LIVE_SESSION_HALTED"));
  }
  const executor = pine.createPineLiveExecutor(), sessionId = "disposed-strategy147";
  const pending = executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 0, action: "start", request: {
    id: sessionId + ":0", source: script(counters), action: "run", bars: history, context, mode: "live" } });
  executor.dispose(); executor.dispose();
  await assert.rejects(pending, failure("LIVE_SESSION_HALTED"));
});

test("packed strategy snapshots transfer only owned buffers and preserve the live broker ledger", async () => {
  const bars = Array.from({ length: 600 }, (_, index) => candle(index));
  const source = script(Array.from({ length: 8 }, (_, index) => `plot(close+${index},"Channel${index}")`).join("\n")
    + '\nif barstate.isrealtime\n    strategy.entry("A",strategy.long,qty=1)', 'calc_on_every_tick=true');
  const session = await live(source, {}, bars);
  try {
    const envelope = pine.toPineWireResponse(session.start.request.id, session.result, bars);
    assert.equal(envelope.encoding, "pine-packed-v1");
    const received = structuredClone(envelope, { transfer: envelope.buffers });
    assert.ok(envelope.buffers.every(buffer => buffer.byteLength === 0));
    const canonical = pine.validatePineResponse(received, session.start.request);
    assert.equal(canonical.strategy.openTrades.length, 0);
    const first = await session.step(candle(600, 101));
    assert.equal(first.strategy.pendingOrders.length, 1);
    const second = await session.step(candle(600, 102));
    assert.deepEqual(ledger(second).open, [["A", 102, 1, 600]]);
    assert.equal(pine.pointAtBar(canonical.plots[7], 599).value, 107);
    assert.equal(pine.pointAtBar(second.plots[7], 600).value, 109);
  } finally { session.executor.dispose(); }
});


test("more than 512 received updates remain usable in one chart bar", async () => {
  const session = await live(script(counters, 'calc_on_every_tick=true'));
  try {
    for (let index = 0; index < 640; index++) {
      const result = await session.step(candle(3, 100));
      assert.equal(tail(result, "Executions"), 4 + index);
    }
    const confirmed = await session.step(candle(3, 100), true);
    assert.equal(tail(confirmed, "Executions"), 644);
    const next = await session.step(candle(4, 100));
    assert.equal(tail(next, "Executions"), 645);
  } finally { session.executor.dispose(); }
});

test("more than 2048 broker transitions across distinct received events preserve next-tick eligibility", async () => {
  const source = script(counters + `
if barstate.isrealtime and (executions==4 or executions==7)
    for i=0 to 599
        strategy.order("A"+str.tostring(i),strategy.long,qty=1,stop=110,limit=90)
if barstate.isrealtime and executions==6
    strategy.close_all(immediately=true)`, 'calc_on_every_tick=true').replace('initial_capital=10000', 'initial_capital=1000000');
  const session = await live(source);
  try {
    await session.step(candle(3, 100));
    const firstActivation = await session.step(candle(3, 120));
    assert.equal(firstActivation.strategy.openTrades.length, 0);
    const firstFills = await session.step(candle(3, 80, { high: 120 }));
    assert.equal(firstFills.strategy.closedTrades.length, 600);
    await session.step(candle(3, 100, { high: 120, low: 80 }));
    await session.step(candle(3, 120, { low: 80 }));
    const secondFills = await session.step(candle(3, 80, { high: 120 }));
    assert.equal(secondFills.strategy.closedTrades.length, 600);
    assert.equal(secondFills.strategy.openTrades.length, 600);
    assert.equal(secondFills.strategy.pendingOrders.length, 0);
    assert.equal(secondFills.strategy.metrics.position_size, 600);
    for (const trade of secondFills.strategy.closedTrades) {
      assert.deepEqual([trade.entry_price, trade.exit_price, trade.profit], [80, 80, 0]);
    }
    for (const trade of secondFills.strategy.openTrades) assert.equal(trade.entry_price, 80);
  } finally { session.executor.dispose(); }
});


test("zero-offset trailing activation cannot manufacture a fill on its own activation event", async () => {
  const source = script(counters + `
if barstate.isrealtime and executions==4
    strategy.entry("A",strategy.long,qty=1)
if barstate.isrealtime and executions==5
    strategy.exit("Trail","A",trail_price=110,trail_offset=0)`, 'calc_on_every_tick=true');
  const session = await live(source);
  try {
    await session.step(candle(3, 100));
    await session.step(candle(3, 100));
    const activation = await session.step(candle(3, 110));
    assert.equal(activation.strategy.closedTrades.length, 0);
    const nextActualTick = await session.step(candle(3, 110));
    assert.deepEqual(ledger(nextActualTick).closed, [["A", 100, 110, 1, 10, 3, 3]]);
  } finally { session.executor.dispose(); }
});


test("a live entry generation replaces a warmed pending strategy.order with the same ID", async () => {
  const source = script(counters + `
if bar_index==2
    strategy.order("A",strategy.long,qty=1,limit=90)
if barstate.isrealtime and executions==4
    strategy.entry("A",strategy.long,qty=2,limit=80)`, 'calc_on_every_tick=true');
  const session = await live(source);
  try {
    assert.equal(session.result.strategy.pendingOrders.length, 1);
    const replaced = await session.step(candle(3, 100));
    assert.deepEqual(ledger(replaced).pending, [["A", "limit", 2, 80, null]]);
    const oldTrigger = await session.step(candle(3, 85));
    assert.equal(oldTrigger.strategy.openTrades.length, 0);
    const realTrigger = await session.step(candle(3, 75));
    assert.deepEqual(ledger(realTrigger).open, [["A", 75, 2, 3]]);
  } finally { session.executor.dispose(); }
});


test("viewport historical reload magnifies newly owned M1 coverage instead of retaining the start-only source", async () => {
  const base = 1_700_001_000;
  assert.equal(base % 300, 0);
  const minute = (index, high = 100, low = 100) => ({ time: base + index * 60, open: 100, high, low, close: 100, volume: 10 });
  const minutes = Array.from({ length: 5 }, (_, index) => minute(index));
  const chartBar = group => ({ time: Math.floor(group[0].time / 300) * 300, open: group[0].open,
    high: Math.max(...group.map(bar => bar.high)), low: Math.min(...group.map(bar => bar.low)),
    close: group.at(-1).close, volume: group.reduce((sum, bar) => sum + bar.volume, 0) });
  const firstBar = chartBar(minutes);
  const source = script(`if bar_index==0
    strategy.entry("A",strategy.long,qty=1,limit=95)
strategy.exit("X","A",stop=85,limit=105)
plot(chart.left_visible_bar_time,"Left")`, 'calc_on_order_fills=true,use_bar_magnifier=true');
  const session = await live(source, { context: { ...context, timeframe: "5" },
    sourceSnapshot: { timeframe: "1", bars: [...minutes] }, viewport: { from: base, to: base } }, [firstBar]);
  try {
    let sequence = 0, current;
    // After entry95, minute6 precedes profit105 at minute7; the later minute8
    // low80 cannot stop an already closed trade. Aggregate OHLC reverses that order.
    const next = [minute(5), minute(6, 100, 90), minute(7, 110, 100), minute(8, 100, 80), minute(9)];
    for (const child of next) {
      minutes.push(child);
      current = await session.executor.execute({ protocol: "pine-live-v1", sessionId: session.start.sessionId,
        sequence: ++sequence, action: "update", bar: chartBar(minutes.slice(5)), confirmed: child === next.at(-1),
        source: { bar: child, confirmed: true } });
      assert.equal(current.strategy.closedTrades.length, 0, "received closes100 never crossed entry95");
      assert.equal(current.strategy.openTrades.length, 0);
    }
    const allBars = [firstBar, chartBar(next)];
    const fresh = await pine.executePineRequest({ ...session.start.request, id: "fresh-magnifier147", mode: "historical",
      bars: allBars, sourceSnapshot: { timeframe: "1", bars: minutes }, viewport: { from: base + 300, to: base + 300 } });
    assert.deepEqual(ledger(fresh).closed, [["A", 95, 105, 1, 10, 1, 1]]);
    const rerun = await session.executor.execute({ protocol: "pine-live-v1", sessionId: session.start.sessionId,
      sequence: ++sequence, action: "viewport", viewport: { from: base + 300, to: base + 300 } });
    assert.deepEqual(ledger(rerun), ledger(fresh));
    assert.equal(rerun.strategy.closedTrades[0].entry_time, minute(6).time);
    assert.equal(rerun.strategy.closedTrades[0].exit_time, minute(7).time);
  } finally { session.executor.dispose(); }
});
