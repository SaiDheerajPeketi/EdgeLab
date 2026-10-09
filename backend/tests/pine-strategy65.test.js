import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const bundle = (await build({
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  write: false,
  logLevel: "silent",
  plugins: [createPineEnginePlugin()],
  define: { "import.meta.env": "{}" },
  stdin: {
    contents: 'export * from "./frontend/src/workers/pineNative.worker.ts";',
    loader: "ts",
    resolveDir: root,
    sourcefile: "pine-strategy65-fixture.ts",
  },
})).outputFiles[0].text + "\n//# sourceURL=edgelab-strategy65-minified-worker.mjs\n";
const pine = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
console.info("STRATEGY65_BINDING " + JSON.stringify({
  minify: true,
  bundleSha256: sha(bundle),
  bundleBytes: Buffer.byteLength(bundle),
  workerSourceSha256: sha(fs.readFileSync(new URL("../../frontend/src/workers/pineNative.worker.ts", import.meta.url))),
  engineManifestSha256: sha(fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json", import.meta.url))),
}));
const bars = [
  { open: 70, high: 85, low: 65, close: 80 },
  { open: 100, high: 110, low: 80, close: 105 },
  { open: 120, high: 150, low: 110, close: 140 },
].map((bar, index) => ({ ...bar, time: 1700000040 + index * 60, volume: 100 + index }));
const context = { symbol: "TEST", timeframe: "1", mintick: 1, pointvalue: 1 };
const reversal = (enabled) => `//@version=6
strategy("Historical fill reversal",initial_capital=10000,default_qty_type=strategy.fixed,default_qty_value=1,calc_on_order_fills=${enabled})
varip int executions=-1
executions+=1
if strategy.position_size<=0
    strategy.entry("Long",strategy.long)
else
    strategy.entry("Short",strategy.short)
plot(executions,"Executions")
plot(executions[1],"Prior executions")
plot(bar_index,"Bar")
plot(barstate.ishistory,"Historical")
plot(open,"Open")
plot(high,"High")
plot(low,"Low")
plot(close,"Close")`;
const execute = async (source, extra = {}) => {
  try {
    return await pine.executePineRequest({ id: "strategy65", action: "run", source, bars, inputs: {}, context, ...extra });
  } catch (error) {
    // Keep genuine diagnostics while avoiding a base64 engine dump in test logs.
    error.stack = `${error.name}: ${error.message}\nCode: ${error.code ?? "none"}`;
    throw error;
  }
};
const values = (result, name) => result.plots.find((plot) => plot.name === name).points.map((point) => point.value);

// Primary contract: execution-model/#executions-on-historical-bars and
// concepts/strategies/#calc_on_order_fills. This uses final historical OHLC,
// not a fabricated realtime feed or a post-close loop over already-filled orders.
test("false-setting control still executes once per historical bar", async () => {
  const source = reversal(false);
  const result = await execute(source);
  assert.equal(result.source, source);
  assert.deepEqual(values(result, "Executions"), [0, 1, 2]);
  assert.deepEqual(values(result, "Prior executions"), [null, 0, 1]);
  assert.deepEqual(values(result, "Historical"), [true, true, true]);
  for (const plot of result.plots) assert.deepEqual(plot.points.map((point) => point.time), bars.map((bar) => bar.time));
});

test("fill scheduling interleaves four reversal fills with four calculations and no fifth close call", async () => {
  const source = reversal(true);
  const result = await execute(source);
  assert.equal(result.source, source);
  assert.equal(result.strategy.config.calc_on_order_fills, true);
  assert.deepEqual(values(result, "Executions"), [0, 4, 8]);
  assert.deepEqual(values(result, "Prior executions"), [null, 0, 4]);
  assert.deepEqual(values(result, "Bar"), [0, 1, 2]);
  assert.deepEqual(values(result, "Historical"), [true, true, true]);
  for (const name of ["Open", "High", "Low", "Close"]) assert.deepEqual(values(result, name), bars.map((bar) => bar[name.toLowerCase()]));
  for (const plot of result.plots) assert.deepEqual(plot.points.map((point) => point.time), bars.map((bar) => bar.time));
  // Open nearer high: O-H-L-C. Open nearer low: O-L-H-C.
  const expected = [
    [100, 110, 1, 10], [110, 80, -1, 30], [80, 105, 1, 25],
    [105, 120, -1, -15], [120, 110, 1, -10], [110, 150, -1, -40], [150, 140, 1, -10],
  ];
  assert.deepEqual(result.strategy.closedTrades.map((trade) => [trade.entry_price, trade.exit_price, trade.size, trade.profit]), expected);
  assert.equal(result.strategy.metrics.netprofit, -10);
  assert.equal(result.strategy.openTrades.length, 1);
  assert.equal(result.strategy.openTrades[0].entry_price, 140);
  assert.equal(result.strategy.openTrades[0].size, -1);
  assert.equal(result.strategy.pendingOrders.length, 1);
  assert.equal(result.strategy.pendingOrders[0].id, "Long");
  assert.equal(result.strategy.pendingOrders[0].status, "pending");
});


const forms = [
  { name: "literal", expression: "true", prefix: "", inputs: {} },
  { name: "const", expression: "enabled", prefix: "const bool enabled=true\n", inputs: {} },
  { name: "input", expression: "enabled", prefix: 'enabled=input.bool(false,"After fill")\n', inputs: { in_0: true } },
];
for (const version of [5, 6]) {
  test(`v${version} literal const and input settings resolve without altering authored source or inputs`, async () => {
    for (const form of forms) {
      const source = reversal(form.expression).replace("//@version=6\n", `//@version=${version}\n${form.prefix}`);
      const result = await execute(source, { inputs: form.inputs });
      assert.equal(result.source, source);
      assert.deepEqual(result.inputs, form.inputs);
      assert.equal(result.pineVersion, version);
      assert.equal(result.strategy.config.calc_on_order_fills, true);
      assert.deepEqual(values(result, "Executions"), [0, 4, 8]);
      assert.equal(result.strategy.metrics.netprofit, -10);
    }
  });
}

test("each fill calculation sees final historical OHLC and commits only one SMA/history slot", async () => {
  const source = reversal(true) + `
varip float accumulatedClose=0
accumulatedClose+=close
varip float accumulatedOpen=0
accumulatedOpen+=open
varip float accumulatedVolume=0
accumulatedVolume+=volume
plot(accumulatedClose,"Accumulated close")
plot(accumulatedOpen,"Accumulated open")
plot(accumulatedVolume,"Accumulated volume")
plot(ta.sma(close,2),"SMA")
plot(close[1],"Prior close")
plot(barstate.isrealtime,"Realtime")
plot(barstate.isconfirmed,"Confirmed")`;
  const result = await execute(source);
  assert.deepEqual(values(result, "Accumulated close"), [80, 500, 1060]);
  assert.deepEqual(values(result, "Accumulated open"), [70, 470, 950]);
  assert.deepEqual(values(result, "Accumulated volume"), [100, 504, 912]);
  assert.deepEqual(values(result, "SMA"), [null, 92.5, 122.5]);
  assert.deepEqual(values(result, "Prior close"), [null, 80, 105]);
  assert.deepEqual(values(result, "Realtime"), [false, false, false]);
  assert.deepEqual(values(result, "Confirmed"), [true, true, true]);
  for (const plot of result.plots) assert.deepEqual(plot.points.map((point) => point.time), bars.map((bar) => bar.time));
});

test("documented rollback model restores ordinary scalars and collections without undoing broker fills", async () => {
  // Ordinary historical fill rollback is inferred from the primary execution-model
  // rollback description; these are not claimed as independently observed TV outputs.
  const source = reversal(true) + `
var int ordinary=0
ordinary+=1
var array<int> ordinaryValues=array.new<int>()
array.push(ordinaryValues,bar_index)
varip array<int> persistentValues=array.new<int>()
array.push(persistentValues,bar_index)
plot(ordinary,"Ordinary")
plot(array.size(ordinaryValues),"Ordinary collection")
plot(array.size(persistentValues),"Persistent collection")
plot(strategy.position_size,"Position")`;
  const result = await execute(source);
  assert.deepEqual(values(result, "Ordinary"), [1, 2, 3]);
  assert.deepEqual(values(result, "Ordinary collection"), [1, 2, 3]);
  assert.deepEqual(values(result, "Persistent collection"), [1, 5, 9]);
  assert.deepEqual(values(result, "Position"), [0, -1, -1]);
  assert.equal(result.strategy.closedTrades.length, 7);
  assert.equal(result.strategy.metrics.netprofit, -10);
});

function rejectsSetting(setting) {
  return (error) => {
    assert.equal(error.code, "UNSUPPORTED_EXECUTION_SETTING");
    assert.ok(error.message.includes(setting), error.message);
    assert.ok(!error.message.includes("BODY_RAN"));
    return true;
  };
}
test("malformed fill flags and unsupported historical ticks fail before any script body", async () => {
  for (const version of [5, 6]) {
    for (const expression of ["1", "0", '\"true\"', '\"false\"', "na"]) {
      const source = `//@version=${version}\nstrategy("Invalid fill",calc_on_order_fills=${expression})\nruntime.error("BODY_RAN")`;
      await assert.rejects(execute(source), rejectsSetting("calc_on_order_fills"));
    }
    const source = `//@version=${version}\nstrategy("Unsupported history",calc_on_order_fills=true,calc_on_every_tick=true,calc_on_every_history_tick=true)\nruntime.error("BODY_RAN")`;
    await assert.rejects(execute(source), rejectsSetting("calc_on_every_history_tick"));
  }
});

test("persistent strategies retain historical warmup for false and true fill settings", async () => {
  for (const enabled of [false, true]) {
    const sessionId = `strategy65-live-${enabled}`;
    const executor = pine.createPineLiveExecutor();
    try {
      const initial = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 0, action: "start", request: {
        id: `${sessionId}:0`, action: "run", mode: "live", source: reversal(enabled), inputs: {}, bars, context,
      } });
      assert.deepEqual(initial.strategy, (await execute(reversal(enabled))).strategy);
    } finally {
      executor.dispose();
    }
  }
});


function bracket(profit, cap) {
  return `//@version=6
strategy("Fresh bracket",initial_capital=10000,default_qty_type=strategy.fixed,default_qty_value=1,calc_on_order_fills=true)
varip int executions=-1
executions+=1
if strategy.position_size==0 and strategy.closedtrades<${cap}
    strategy.entry("Buy",strategy.long)
if strategy.position_size>0
    strategy.exit("Exit","Buy",limit=strategy.position_avg_price+${profit})
plot(executions,"Executions")
plot(executions[1],"Prior executions")
plot(strategy.position_size,"Position")
plot(strategy.position_avg_price,"Average")
plot(high,"Final high")
plot(close,"Final close")`;
}
function bracketLedger(result, expected, calls) {
  assert.deepEqual(result.strategy.closedTrades.map((trade) => [trade.entry_price, trade.exit_price, trade.size, trade.profit]), expected);
  for (const trade of result.strategy.closedTrades) {
    assert.equal(trade.entry_bar_index, 1);
    assert.equal(trade.exit_bar_index, 1);
    assert.equal(trade.entry_time, bars[1].time);
    assert.equal(trade.exit_time, bars[1].time);
  }
  assert.deepEqual(values(result, "Executions"), [0, calls]);
  assert.deepEqual(values(result, "Prior executions"), [null, 0]);
  assert.deepEqual(values(result, "Position"), [0, 0]);
  assert.deepEqual(values(result, "Average"), [null, null]);
  assert.deepEqual(values(result, "Final high"), [85, 110]);
  assert.deepEqual(values(result, "Final close"), [80, 105]);
  assert.deepEqual(result.strategy.openTrades, []);
  assert.deepEqual(result.strategy.pendingOrders, []);
  for (const plot of result.plots) assert.deepEqual(plot.points.map((point) => point.time), bars.slice(0, 2).map((bar) => bar.time));
}

test("fresh average-price bracket can fill inside the remaining segment on the entry bar", async () => {
  const source = bracket(5, 1);
  const result = await execute(source, { bars: bars.slice(0, 2) });
  assert.equal(result.source, source);
  // O100 entry -> limit105 crossing O-H -> regular close. The order did not
  // exist before the entry fill calculation and cannot be filled retrospectively.
  bracketLedger(result, [[100, 105, 1, 5]], 3);
  assert.equal(result.strategy.metrics.netprofit, 5);
  assert.equal(result.strategy.metrics.equity, 10005);
});

test("midbar exit recalculates and reenters at the next vertex without replaying the path", async () => {
  const source = bracket(10, 2);
  const result = await execute(source, { bars: bars.slice(0, 2) });
  assert.equal(result.source, source);
  // O100 entry -> H110 exit -> L80 reentry -> limit90 on L-C -> close.
  // Two closed trades stop further entries, making the five calculations finite.
  bracketLedger(result, [[100, 110, 1, 10], [80, 90, 1, 10]], 5);
  assert.equal(result.strategy.metrics.netprofit, 20);
  assert.equal(result.strategy.metrics.equity, 10020);
});

test("a bracket created after the high cannot retroactively consume that traversed high", async () => {
  const source = `//@version=6
strategy("No retroactive high",initial_capital=10000,default_qty_value=1,calc_on_order_fills=true)
varip int executions=-1
executions+=1
if strategy.position_size==0
    strategy.entry("Buy",strategy.long)
if strategy.position_size>0
    strategy.exit("Exit","Buy",limit=high)
plot(executions,"Executions")
plot(strategy.position_size,"Position")
plot(strategy.position_avg_price,"Average")`;
  const result = await execute(source, { bars: bars.slice(0, 2) });
  assert.deepEqual(values(result, "Executions"), [0, 4]);
  assert.deepEqual(values(result, "Position"), [0, 1]);
  assert.deepEqual(values(result, "Average"), [null, 80]);
  assert.deepEqual(result.strategy.closedTrades.map((trade) => [trade.entry_price, trade.exit_price, trade.profit]), [[100, 110, 10]]);
  assert.equal(result.strategy.openTrades.length, 1);
  assert.equal(result.strategy.openTrades[0].entry_price, 80);
  assert.equal(result.strategy.pendingOrders.length, 1);
  assert.equal(result.strategy.pendingOrders[0].limit, 110);
});


for (const quantity of ["qty_percent=75", "qty=3"]) {
  test(`partial exit ${quantity} allocates its size separately to both entry lots`, async () => {
    const source = `//@version=6
strategy("Partial two lots",initial_capital=10000,pyramiding=2,calc_on_order_fills=true)
varip int executions=-1
executions+=1
varip bool placed=false
if bar_index==0
    strategy.entry("A",strategy.long,qty=2)
    strategy.entry("B",strategy.long,qty=2)
if strategy.position_size==4 and not placed
    placed:=true
    strategy.exit("X",limit=105,${quantity})
plot(executions,"Executions")
plot(strategy.position_size,"Position")`;
    const result = await execute(source, { bars: bars.slice(0, 2) });
    // strategy.exit creates a separate bracket per eligible entry. The whole-unit
    // grid floors 75% of each two-unit entry to one; qty3 caps each at its two units.
    const size = quantity === "qty_percent=75" ? 1 : 2;
    assert.deepEqual(result.strategy.closedTrades.map((trade) => [trade.entry_id, trade.entry_price, trade.exit_price, trade.size, trade.profit]), [
      ["A", 100, 105, size, size * 5], ["B", 100, 105, size, size * 5],
    ]);
    assert.equal(result.strategy.metrics.netprofit, size * 10);
    assert.equal(result.strategy.metrics.position_size, 4 - size * 2);
    assert.deepEqual(result.strategy.openTrades.map(t => [t.entry_id, t.size]).sort(([a],[b]) => a.localeCompare(b)),
      size === 1 ? [["A",1],["B",1]] : []);
    assert.deepEqual(values(result, "Executions"), [0, 5]);
    assert.deepEqual(values(result, "Position"), [0, 4 - size * 2]);
  });
}

for (const closeTiming of [false, true]) {
  test(`bounded immediate close uses actual ${closeTiming ? "closing" : "opening"} cursor price`, async () => {
    const source = `//@version=6
strategy("Bounded same-tick close",initial_capital=10000,default_qty_value=1,calc_on_order_fills=true,process_orders_on_close=${closeTiming})
varip int executions=-1
executions+=1
varip bool sent=false
if not sent
    sent:=true
    strategy.entry("Buy",strategy.long)
if strategy.position_size>0
    strategy.close("Buy",immediately=true)
plot(executions,"Executions")
plot(strategy.position_size,"Position")`;
    const result = await execute(source);
    const bar = closeTiming ? 0 : 1;
    const price = closeTiming ? 80 : 100;
    assert.deepEqual(values(result, "Executions"), closeTiming ? [2, 3, 4] : [0, 3, 4]);
    assert.deepEqual(values(result, "Position"), [0, 0, 0]);
    assert.equal(result.strategy.closedTrades.length, 1);
    const trade = result.strategy.closedTrades[0];
    assert.deepEqual([trade.entry_bar_index, trade.exit_bar_index, trade.entry_price, trade.exit_price, trade.profit], [bar, bar, price, price, 0]);
    assert.deepEqual(result.strategy.openTrades, []);
    assert.deepEqual(result.strategy.pendingOrders, []);
    assert.equal(result.strategy.metrics.netprofit, 0);
  });
}

test("first fill callback can cancel another pending same-cursor entry", async () => {
  const source = `//@version=6
strategy("Cancel candidate",initial_capital=10000,pyramiding=2,calc_on_order_fills=true)
varip int executions=-1
executions+=1
if bar_index==0
    strategy.entry("A",strategy.long,qty=1)
    strategy.entry("B",strategy.long,qty=1)
if strategy.position_size>0
    strategy.cancel("B")
plot(executions,"Executions")`;
  const result = await execute(source, { bars: bars.slice(0, 2) });
  assert.deepEqual(values(result, "Executions"), [0, 2]);
  assert.deepEqual(result.strategy.openTrades.map((trade) => [trade.entry_id, trade.entry_price, trade.size]), [["A", 100, 1]]);
  assert.deepEqual(result.strategy.pendingOrders, []);
  assert.deepEqual(result.strategy.closedTrades, []);
});

test("a fill callback replaces a pending limit before its old price is reached", async () => {
  const source = `//@version=6
strategy("Replace candidate",initial_capital=10000,pyramiding=2,calc_on_order_fills=true)
varip int executions=-1
executions+=1
varip bool replaced=false
if bar_index==0
    strategy.entry("A",strategy.long,qty=1)
    strategy.entry("B",strategy.long,qty=1,limit=95)
if strategy.position_size==1 and not replaced
    replaced:=true
    strategy.entry("B",strategy.long,qty=1,limit=85)
plot(executions,"Executions")`;
  const result = await execute(source, { bars: bars.slice(0, 2) });
  assert.deepEqual(values(result, "Executions"), [0, 3]);
  assert.deepEqual(result.strategy.openTrades.map((trade) => [trade.entry_id, trade.entry_price, trade.size]), [["A", 100, 1], ["B", 85, 1]]);
  assert.deepEqual(result.strategy.pendingOrders, []);
});

test("market entry and exit costs use fill-cursor slippage and actual per-contract commission", async () => {
  const source = `//@version=6
strategy("Costs on fills",initial_capital=10000,calc_on_order_fills=true,slippage=1,commission_type=strategy.commission.cash_per_contract,commission_value=2)
varip int executions=-1
executions+=1
if bar_index==0
    strategy.entry("Buy",strategy.long,qty=2)
if strategy.position_size>0
    strategy.close("Buy")
plot(executions,"Executions")`;
  const result = await execute(source, { bars: bars.slice(0, 2) });
  assert.deepEqual(values(result, "Executions"), [0, 3]);
  assert.equal(result.strategy.closedTrades.length, 1);
  const trade = result.strategy.closedTrades[0];
  assert.deepEqual([trade.entry_price, trade.exit_price, trade.size, trade.commission, trade.profit], [101, 109, 2, 8, 8]);
  assert.equal(result.strategy.metrics.netprofit, 8);
  assert.equal(result.strategy.metrics.equity, 10008);
});

test("an unbounded same-close entry/immediate-exit cycle fails with a controlled execution budget", async () => {
  const source = `//@version=6
strategy("Bounded failure",initial_capital=10000,calc_on_order_fills=true,process_orders_on_close=true)
if strategy.position_size==0
    strategy.entry("Buy",strategy.long,qty=1)
else
    strategy.close("Buy",immediately=true)
plot(close,"Close")`;
  await assert.rejects(execute(source, { bars: bars.slice(0, 1) }), (error) => {
    assert.equal(error.code, "STRATEGY_EXECUTION_LIMIT");
    return true;
  });
});


test("insufficient-capital entry causes no extra fill calculation", async () => {
  const source = `//@version=6
strategy("Reject unaffordable lot",initial_capital=1,margin_long=100,calc_on_order_fills=true)
varip int executions=-1
executions+=1
if bar_index==0
    strategy.entry("A",strategy.long,qty=2)
plot(executions,"Executions")`;
  const result = await execute(source, { bars: bars.slice(0, 2) });
  assert.deepEqual(values(result, "Executions"), [0, 1]);
  assert.deepEqual(result.strategy.openTrades, []);
  assert.deepEqual(result.strategy.closedTrades, []);
  assert.deepEqual(result.strategy.pendingOrders, []);
});


const reservationBars = [bars[0], { ...bars[1], high: 105, close: 95 }];
function reservedSource(entries, exits) {
  return `//@version=6
strategy("Exit reservations",initial_capital=10000,pyramiding=2,calc_on_order_fills=true)
varip bool placed=false
if bar_index==0
${entries}
if strategy.position_size==20 and not placed
    placed:=true
${exits}
plot(strategy.position_size,"Position")`;
}

test("earlier take-profit reserves nineteen units so a later oversized stop closes only one", async () => {
  // Primary Strategies / Reserved exit demo explicitly uses qty19 then qty20.
  const source = reservedSource('    strategy.entry("Buy",strategy.long,qty=20)',
    '    strategy.exit("TP",limit=110,qty=19)\n    strategy.exit("SL",stop=90,qty=20)');
  const result = await execute(source, { bars: reservationBars });
  assert.deepEqual(result.strategy.closedTrades.map((trade) => [trade.entry_price, trade.exit_price, trade.size, trade.profit]), [[100, 90, 1, -10]]);
  assert.equal(result.strategy.metrics.netprofit, -10);
  assert.equal(result.strategy.metrics.position_size, 19);
  assert.deepEqual(values(result, "Position"), [0, 19]);
  assert.equal(result.strategy.pendingOrders.length, 1);
  assert.equal(result.strategy.pendingOrders[0].id, "TP");
  assert.equal(result.strategy.pendingOrders[0].limit, 110);
});

test("an oversized per-entry take-profit reserves both lots before a later stop", async () => {
  const source = reservedSource('    strategy.entry("A",strategy.long,qty=10)\n    strategy.entry("B",strategy.long,qty=10)',
    '    strategy.exit("TP",limit=110,qty=19)\n    strategy.exit("SL",stop=90,qty=20)');
  const result = await execute(source, { bars: reservationBars });
  assert.deepEqual(result.strategy.closedTrades, []);
  assert.deepEqual(result.strategy.openTrades.map((trade) => [trade.entry_id, trade.size]).sort(([a], [b]) => a.localeCompare(b)), [["A", 10], ["B", 10]]);
  assert.equal(result.strategy.metrics.netprofit, 0);
});

test("canceling the earlier take-profit releases its reservation to a new stop", async () => {
  const source = reservedSource('    strategy.entry("Buy",strategy.long,qty=20)',
    '    strategy.exit("TP",limit=110,qty=19)\n    strategy.cancel("TP")\n    strategy.exit("SL",stop=90,qty=20)');
  const result = await execute(source, { bars: reservationBars });
  assert.deepEqual(result.strategy.closedTrades.map((trade) => [trade.exit_price, trade.size, trade.profit]), [[90, 20, -200]]);
  assert.equal(result.strategy.metrics.netprofit, -200);
  assert.deepEqual(result.strategy.openTrades, []);
  assert.deepEqual(result.strategy.pendingOrders, []);
});

test("replacing a take-profit with smaller quantity releases capacity for subsequent stop generation", async () => {
  const source = reservedSource('    strategy.entry("Buy",strategy.long,qty=20)',
    '    strategy.exit("TP",limit=110,qty=19)\n    strategy.exit("TP",limit=110,qty=10)\n    strategy.exit("SL",stop=90,qty=20)');
  const result = await execute(source, { bars: reservationBars });
  assert.deepEqual(result.strategy.closedTrades.map((trade) => [trade.exit_price, trade.size, trade.profit]), [[90, 10, -100]]);
  assert.equal(result.strategy.metrics.netprofit, -100);
  assert.equal(result.strategy.metrics.position_size, 10);
  assert.equal(result.strategy.pendingOrders.length, 1);
  assert.equal(result.strategy.pendingOrders[0].id, "TP");
});

for (const boundary of ["incomplete trailing exit", "intrabar liquidation"]) {
  test(`unsupported ${boundary} fails explicitly rather than returning a plausible partial test`, async () => {
    const source = boundary === "incomplete trailing exit" ? `//@version=6
strategy("Trailing boundary",initial_capital=10000,calc_on_order_fills=true)
if bar_index==0
    strategy.entry("Buy",strategy.long)
if strategy.position_size>0
    strategy.exit("Trail","Buy",trail_points=5)` : `//@version=6
strategy("Liquidation boundary",initial_capital=1100,margin_long=50,calc_on_order_fills=true)
if bar_index==0
    strategy.entry("Buy",strategy.long,qty=20)`;
    await assert.rejects(execute(source, { bars: bars.slice(0, 2) }), (error) => {
      assert.equal(error.code, "UNSUPPORTED_ORDER_FILL_CONTEXT");
      return true;
    });
  });
}


const crossbarBars = [
  bars[0], bars[1],
  { ...bars[2], open: 105, high: 110, low: 100, close: 108 },
  { ...bars[2], time: bars[2].time + 60, open: 112, high: 120, low: 110, close: 118 },
];
const crossbarPrefix = `//@version=6
strategy("Crossbar allocation",initial_capital=10000,pyramiding=3,calc_on_order_fills=true)
varip int calls=0
varip int previous=-1
if bar_index!=previous
    previous:=bar_index
    calls:=0
calls+=1
if bar_index==0
    strategy.entry("A",strategy.long,qty=2)
if bar_index==1 and calls==1
    strategy.entry("B",strategy.long,qty=2)
if bar_index==1 and calls==3
    strategy.exit("X",profit=5,qty=3)
plot(calls,"Calls")`;

test("a three-unit exit caps each physical entry across separate fill bars", async () => {
  const result = await execute(crossbarPrefix, { bars: crossbarBars });
  assert.deepEqual(result.strategy.closedTrades.map((trade) => [trade.entry_id, trade.entry_price, trade.exit_price, trade.size, trade.profit, trade.exit_bar_index]), [
    ["A", 100, 105, 2, 10, 2], ["B", 110, 115, 2, 10, 3],
  ]);
  assert.equal(result.strategy.metrics.netprofit, 20);
  assert.deepEqual(result.strategy.openTrades.map((trade) => [trade.entry_id, trade.entry_price, trade.size]), []);
  assert.deepEqual(result.strategy.pendingOrders, []);
  assert.deepEqual(values(result, "Calls"), [1, 3, 2, 2]);
});

for (const version of [5, 6]) {
  test(`v${version} paired relative and absolute profit/stop prices preserve their version semantics`, async () => {
    for (const short of [false, true]) {
      const source = `//@version=${version}
strategy("Paired exit",initial_capital=10000,calc_on_order_fills=true)
if bar_index==0
    strategy.entry("Trade",strategy.${short ? "short" : "long"},qty=1)
if strategy.position_size!=0
    strategy.exit("X","Trade",${short ? "loss=5,stop=110" : "profit=5,limit=110"})
plot(strategy.position_size,"Position")`;
      const result = await execute(source, { bars: bars.slice(0, 2) });
      const price = version === 6 ? 105 : 110;
      const profit = (price - 100) * (short ? -1 : 1);
      assert.equal(result.strategy.closedTrades.length, 1);
      const trade = result.strategy.closedTrades[0];
      assert.deepEqual([trade.entry_price, trade.exit_price, trade.size, trade.profit], [100, price, short ? -1 : 1, profit]);
      assert.equal(result.strategy.metrics.netprofit, profit);
      assert.deepEqual(result.strategy.openTrades, []);
    }
  });
}

test("bar magnifier without smaller candles uses disclosed chart OHLC fallback", async () => {
  const source = '//@version=6\nstrategy("Missing intrabars",calc_on_order_fills=true,use_bar_magnifier=true)\nplot(close,"Close")';
  const result = await execute(source);
  assert.equal(result.strategy.config.use_bar_magnifier, true);
  assert.deepEqual(values(result, "Close"), bars.map(bar => bar.close));
  assert.ok(result.diagnostics.some(item => item.code === "BAR_MAGNIFIER_COVERAGE" && item.message.includes("0 of 3") && item.message.includes("chart OHLC")));
});

for (const canceled of [false, true]) {
  test(`full unscoped exit ${canceled ? "cancellation releases" : "propagates to"} a later entry while the position remains open`, async () => {
    const source = crossbarPrefix.replace('qty=2', 'qty=1').replace('qty=2', 'qty=1')
      .replace('strategy.exit("X",profit=5,qty=3)', 'strategy.exit("X",profit=5)') + `
if bar_index==2 and calls==1
${canceled ? '    strategy.cancel("X")' : '    // Keep the existing unscoped full exit.'}
    strategy.entry("C",strategy.long,qty=1)`;
    const result = await execute(source, { bars: crossbarBars });
    const trades = result.strategy.closedTrades.map((trade) => [trade.entry_id, trade.exit_price, trade.size, trade.profit]);
    assert.deepEqual(trades, canceled ? [["A", 105, 1, 5]] : [["A", 105, 1, 5], ["B", 115, 1, 5], ["C", 115, 1, 5]]);
    assert.equal(result.strategy.metrics.netprofit, canceled ? 5 : 15);
    const opened = result.strategy.openTrades.map((trade) => [trade.entry_id, trade.entry_price, trade.size]).sort(([a], [b]) => a.localeCompare(b));
    assert.deepEqual(opened, canceled ? [["B", 110, 1], ["C", 110, 1]] : []);
    assert.deepEqual(result.strategy.pendingOrders, []);
  });
}

test("a full exit from a flat prior position must not catch a subsequently reopened position", async () => {
  const source = `//@version=6
strategy("New position lifetime",initial_capital=10000,calc_on_order_fills=true)
varip bool exited=false
varip bool reopened=false
if bar_index==0
    strategy.entry("A",strategy.long,qty=1)
if strategy.position_size>0 and not exited
    exited:=true
    strategy.exit("X",profit=5)
if strategy.position_size==0 and strategy.closedtrades==1 and not reopened
    reopened:=true
    strategy.entry("B",strategy.long,qty=1)
plot(strategy.position_size,"Position")`;
  const result = await execute(source);
  assert.deepEqual(result.strategy.closedTrades.map((trade) => [trade.entry_id, trade.exit_price, trade.profit]), [["A", 105, 5]]);
  assert.deepEqual(result.strategy.openTrades.map((trade) => [trade.entry_id, trade.entry_price, trade.size]), [["B", 110, 1]]);
  assert.deepEqual(values(result, "Position"), [0, 1, 1]);
  assert.deepEqual(result.strategy.pendingOrders, []);
});


test("reissued same-id scoped partial exit is a new generation eligible at the next vertex", async () => {
  const source = `//@version=6
strategy("Reissue same exit",initial_capital=10000,calc_on_order_fills=true)
varip int executions=-1
executions+=1
if bar_index==0
    strategy.entry("Buy",strategy.long,qty=2)
if strategy.position_size>0
    strategy.exit("TP","Buy",limit=105,qty=1)
plot(executions,"Executions")`;
  const result = await execute(source, { bars: bars.slice(0, 2) });
  // Standard inferred O-H-L-C path: first partial crosses105, newly reissued
  // marketable105 limit waits for H110, rather than rerunning at its birth price.
  assert.deepEqual(result.strategy.closedTrades.map((trade) => [trade.exit_id, trade.exit_price, trade.size, trade.profit]), [["TP", 105, 1, 5], ["TP", 110, 1, 10]]);
  assert.deepEqual(values(result, "Executions"), [0, 4]);
  assert.equal(result.strategy.metrics.netprofit, 15);
  assert.deepEqual(result.strategy.openTrades, []);
  assert.deepEqual(result.strategy.pendingOrders, []);
});
