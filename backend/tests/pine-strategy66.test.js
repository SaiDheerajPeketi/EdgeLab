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
    sourcefile: "pine-strategy66-fixture.ts",
  },
})).outputFiles[0].text + "\n//# sourceURL=edgelab-strategy66-minified-worker.mjs\n";
const pine = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
console.info("STRATEGY66_BINDING " + JSON.stringify({
  minify: true,
  bundleSha256: sha(bundle),
  bundleBytes: Buffer.byteLength(bundle),
  workerSourceSha256: sha(fs.readFileSync(new URL("../../frontend/src/workers/pineNative.worker.ts", import.meta.url))),
  engineManifestSha256: sha(fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json", import.meta.url))),
}));
const bars = [
  { open: 100, high: 102, low: 98, close: 100 },
  { open: 100, high: 120, low: 95, close: 105 },
].map((bar, index) => ({ ...bar, time: 1700000040 + index * 60, volume: 100 + index }));
const context = { symbol: "TEST", timeframe: "1", mintick: 1, pointvalue: 1 };
const execute = async (source, extra = {}) => {
  try {
    return await pine.executePineRequest({ id: "strategy66", action: "run", source, bars, inputs: {}, context, ...extra });
  } catch (error) {
    error.stack = `${error.name}: ${error.message}\nCode: ${error.code ?? "none"}`;
    throw error;
  }
};
const values = (result, name) => result.plots.find((plot) => plot.name === name).points.map((point) => point.value);
const source = (enabled) => `//@version=6
strategy("Historical trailing",initial_capital=10000,default_qty_value=1,calc_on_order_fills=${enabled})
varip int executions=-1
executions+=1
if bar_index==0
    strategy.entry("L",strategy.long)
if strategy.position_size>0
    strategy.exit("Trail","L",trail_price=110,trail_offset=5)
plot(executions,"Executions")
plot(strategy.position_size,"Position")`;

test("closed trailing control retains one calculation per bar", async () => {
  const result = await execute(source(false));
  assert.deepEqual(values(result, "Executions"), [0, 1]);
  assert.deepEqual(values(result, "Position"), [0, 1]);
  assert.deepEqual(result.strategy.closedTrades, []);
  assert.equal(result.strategy.openTrades[0].entry_price, 100);
});

test("long trailing arms on remaining rise and fills same-bar retrace at the ratcheted stop", async () => {
  const authored = source(true);
  const result = await execute(authored);
  assert.equal(result.source, authored);
  // Standard O-L-H-C: L95 occurs before activation110, H120 ratchets to115;
  // the following move to C105 crosses115. Mintick1 makes five ticks five units.
  assert.deepEqual(result.strategy.closedTrades.map((trade) => [trade.entry_price, trade.exit_price, trade.size, trade.profit]), [[100, 115, 1, 15]]);
  assert.equal(result.strategy.metrics.netprofit, 15);
  assert.deepEqual(values(result, "Executions"), [0, 3]);
  assert.deepEqual(values(result, "Position"), [0, 0]);
  assert.deepEqual(result.strategy.openTrades, []);
  assert.deepEqual(result.strategy.pendingOrders, []);
});


const market = (...candles) => candles.map((bar, index) => ({ ...bar, time: bars[0].time + 60 * index, volume: 100 + index }));
const shortBars = market(bars[0], { open: 100, high: 105, low: 80, close: 95 });
function program({ short = false, settings = "trail_price=110,trail_offset=5", options = "", qty = 1, once = false, version = 6 } = {}) {
  return `//@version=${version}
strategy("Trailing path",initial_capital=10000,calc_on_order_fills=true${options})
varip int executions=-1
executions+=1
varip bool placed=false
if bar_index==0
    strategy.entry("Trade",strategy.${short ? "short" : "long"},qty=${qty})
if strategy.position_size!=0${once ? " and not placed" : ""}
    placed:=true
    strategy.exit("Trail","Trade",${settings})
plot(executions,"Executions")
plot(executions[1],"Prior executions")
plot(strategy.position_size,"Position")
plot(high,"Final high")
plot(low,"Final low")`;
}
function single(result, { entry = 100, exit, qty = 1, profit = (exit - entry) * qty, exitBar = 1, commission = 0, snapshot = bars }) {
  assert.equal(result.strategy.closedTrades.length, 1);
  const trade = result.strategy.closedTrades[0];
  assert.deepEqual([trade.entry_price, trade.exit_price, trade.size, trade.profit, trade.commission], [entry, exit, qty, profit, commission]);
  assert.deepEqual([trade.entry_bar_index, trade.exit_bar_index, trade.entry_time, trade.exit_time], [1, exitBar, snapshot[1].time, snapshot[exitBar].time]);
  assert.equal(result.strategy.metrics.netprofit, profit);
  assert.deepEqual(result.strategy.openTrades, []);
  assert.deepEqual(result.strategy.pendingOrders, []);
  for (const plot of result.plots) assert.deepEqual(plot.points.map((point) => point.time), snapshot.map((bar) => bar.time));
}

test("short trailing arms on remaining decline and fills same-bar rebound", async () => {
  const result = await execute(program({ short: true, settings: "trail_price=90,trail_offset=5" }), { bars: shortBars });
  single(result, { exit: 85, qty: -1, snapshot: shortBars });
  assert.deepEqual(values(result, "Executions"), [0, 3]);
  assert.deepEqual(values(result, "Position"), [0, 0]);
});

test("relative activation and offset are actual tick distances on a fractional-tick instrument", async () => {
  const snapshot = market(bars[0], { open: 100, high: 105, low: 99, close: 103 });
  const result = await execute(program({ settings: "trail_points=8,trail_offset=4" }), { bars: snapshot, context: { ...context, mintick: 0.25 } });
  single(result, { exit: 104, snapshot });
});

test("a trail never activated by the remaining prices does not turn into an ordinary stop", async () => {
  const snapshot = market(bars[0], { open: 100, high: 109, low: 80, close: 105 });
  const result = await execute(program(), { bars: snapshot });
  assert.deepEqual(result.strategy.closedTrades, []);
  assert.equal(result.strategy.openTrades[0].entry_price, 100);
  assert.equal(result.strategy.openTrades[0].size, 1);
  assert.equal(result.strategy.pendingOrders.length, 1);
  assert.deepEqual(values(result, "Executions"), [0, 2]);
});

test("adverse-first low cannot retroactively hit a trailing stop armed on the later rise", async () => {
  const snapshot = market(bars[0], { open: 100, high: 110, low: 95, close: 109 });
  const result = await execute(program({ settings: "trail_price=105,trail_offset=3" }), { bars: snapshot });
  assert.deepEqual(result.strategy.closedTrades, []);
  assert.equal(result.strategy.metrics.position_size, 1);
  assert.deepEqual(values(result, "Executions"), [0, 2]);
});

test("creating a trail after the high does not activate it from the bar's immutable past high", async () => {
  const snapshot = market(bars[0], bars[1], { open: 105, high: 108, low: 90, close: 100 });
  const authored = `//@version=6
strategy("Late trail",initial_capital=10000,calc_on_order_fills=true)
varip int calls=0
varip int prior=-1
if bar_index!=prior
    prior:=bar_index
    calls:=0
calls+=1
if bar_index==0
    strategy.entry("Trade",strategy.long)
if bar_index==1 and calls==2
    strategy.exit("Trail","Trade",trail_price=110,trail_offset=5)
plot(calls,"Calls")`;
  const result = await execute(authored, { bars: snapshot });
  assert.deepEqual(values(result, "Calls"), [1, 2, 1]);
  assert.deepEqual(result.strategy.closedTrades, []);
  assert.equal(result.strategy.metrics.position_size, 1);
});

for (const short of [false, true]) {
  test(`${short ? "short" : "long"} armed stop carries across bars and gap-fills at the actual open`, async () => {
    const snapshot = short
      ? market(bars[0], { open: 100, high: 105, low: 80, close: 82 }, { open: 90, high: 95, low: 88, close: 92 })
      : market(bars[0], { open: 100, high: 120, low: 95, close: 118 }, { open: 110, high: 112, low: 100, close: 108 });
    for (const once of [false, true]) {
      const result = await execute(program({ short, once, settings: `trail_price=${short ? 90 : 110},trail_offset=5` }), { bars: snapshot });
      single(result, { exit: short ? 90 : 110, qty: short ? -1 : 1, exitBar: 2, snapshot });
      assert.deepEqual(values(result, "Executions"), [0, 2, 4]);
      assert.deepEqual(values(result, "Prior executions"), [null, 0, 2]);
    }
  });
}

test("an armed long stop never ratchets backward on subsequent lower highs", async () => {
  const snapshot = market(bars[0], { open: 100, high: 120, low: 95, close: 118 },
    { open: 118, high: 119, low: 116, close: 117 }, { open: 117, high: 118, low: 113, close: 114 });
  const result = await execute(program(), { bars: snapshot });
  single(result, { exit: 115, exitBar: 3, snapshot });
  assert.deepEqual(values(result, "Executions"), [0, 2, 3, 5]);
});

test("trailing stop uses stop-market slippage and real per-contract costs", async () => {
  const result = await execute(program({ qty: 2, options: ",slippage=1,commission_type=strategy.commission.cash_per_contract,commission_value=2" }));
  single(result, { entry: 101, exit: 114, qty: 2, profit: 18, commission: 8 });
  assert.equal(result.strategy.metrics.equity, 10018);
});

for (const stop of [false, true]) {
  test(`same-exit ${stop ? "fixed stop" : "take-profit"} wins before the later trailing retrace`, async () => {
    const result = await execute(program({ settings: `trail_price=110,trail_offset=5,${stop ? "stop=97" : "limit=112"}` }));
    single(result, { exit: stop ? 97 : 112 });
  });
}

test("a preceding exit reservation limits a later trailing exit to its one available unit", async () => {
  const authored = `//@version=6
strategy("Reserved trail",initial_capital=10000,calc_on_order_fills=true)
varip bool placed=false
if bar_index==0
    strategy.entry("Trade",strategy.long,qty=20)
if strategy.position_size==20 and not placed
    placed:=true
    strategy.exit("TP","Trade",limit=130,qty=19)
    strategy.exit("Trail","Trade",trail_price=110,trail_offset=5,qty=20)
plot(strategy.position_size,"Position")`;
  const result = await execute(authored);
  assert.deepEqual(result.strategy.closedTrades.map((trade) => [trade.exit_price, trade.size, trade.profit]), [[115, 1, 15]]);
  assert.equal(result.strategy.metrics.netprofit, 15);
  assert.equal(result.strategy.metrics.position_size, 19);
  assert.equal(result.strategy.pendingOrders.length, 1);
  assert.equal(result.strategy.pendingOrders[0].id, "TP");
});

for (const canceled of [true, false]) {
  test(`a later fill callback ${canceled ? "cancels" : "changes the offset of"} an already-armed trail`, async () => {
    const authored = `//@version=6
strategy("Update armed trail",initial_capital=10000,pyramiding=2,calc_on_order_fills=true)
varip bool placed=false
varip bool changed=false
if bar_index==0
    strategy.entry("A",strategy.long)
if strategy.position_size==1 and not placed
    placed:=true
    strategy.exit("Trail","A",trail_price=110,trail_offset=5)
    strategy.entry("B",strategy.long,stop=118)
if strategy.position_size==2 and not changed
    changed:=true
${canceled ? '    strategy.cancel("Trail")' : '    strategy.exit("Trail","A",trail_price=110,trail_offset=10)'}
plot(strategy.position_size,"Position")`;
    const result = await execute(authored);
    if (canceled) {
      assert.deepEqual(result.strategy.closedTrades, []);
      assert.deepEqual(result.strategy.openTrades.map((trade) => [trade.entry_id, trade.entry_price]), [["A", 100], ["B", 118]]);
      assert.equal(result.strategy.metrics.position_size, 2);
    } else {
      assert.deepEqual(result.strategy.closedTrades.map((trade) => [trade.entry_id, trade.exit_price, trade.profit]), [["A", 110, 10]]);
      assert.equal(result.strategy.metrics.netprofit, 10);
      assert.deepEqual(result.strategy.openTrades.map((trade) => [trade.entry_id, trade.entry_price]), [["B", 118]]);
    }
    assert.deepEqual(result.strategy.pendingOrders, []);
  });
}

for (const version of [5, 6]) {
  test(`v${version} paired absolute/relative trail activation retains its documented version rule`, async () => {
    const snapshot = market(bars[0], { open: 100, high: 110, low: 95, close: 106 });
    const result = await execute(program({ version, settings: "trail_price=115,trail_points=5,trail_offset=3" }), { bars: snapshot });
    if (version === 6) single(result, { exit: 107, snapshot });
    else {
      assert.deepEqual(result.strategy.closedTrades, []);
      assert.equal(result.strategy.metrics.position_size, 1);
      assert.equal(result.strategy.pendingOrders.length, 1);
    }
  });
}

test("unmodified reversal retains iteration65 source, ledger and one committed history slot", async () => {
  const snapshot = market({ open: 70, high: 85, low: 65, close: 80 },
    { open: 100, high: 110, low: 80, close: 105 }, { open: 120, high: 150, low: 110, close: 140 });
  const authored = `//@version=6
strategy("Reversal retained",initial_capital=10000,calc_on_order_fills=true)
varip int executions=-1
executions+=1
var int ordinary=0
ordinary+=1
if strategy.position_size<=0
    strategy.entry("Long",strategy.long)
else
    strategy.entry("Short",strategy.short)
plot(executions,"Executions")
plot(executions[1],"Prior executions")
plot(ordinary,"Ordinary")
plot(ta.sma(close,2),"SMA")`;
  const result = await execute(authored, { bars: snapshot });
  assert.equal(result.source, authored);
  assert.deepEqual(values(result, "Executions"), [0, 4, 8]);
  assert.deepEqual(values(result, "Prior executions"), [null, 0, 4]);
  // Historical ordinary rollback is the documented model/inference from65.
  assert.deepEqual(values(result, "Ordinary"), [1, 2, 3]);
  assert.deepEqual(values(result, "SMA"), [null, 92.5, 122.5]);
  assert.deepEqual(result.strategy.closedTrades.map((trade) => [trade.entry_price, trade.exit_price, trade.size, trade.profit]), [
    [100, 110, 1, 10], [110, 80, -1, 30], [80, 105, 1, 25],
    [105, 120, -1, -15], [120, 110, 1, -10], [110, 150, -1, -40], [150, 140, 1, -10],
  ]);
  assert.equal(result.strategy.metrics.netprofit, -10);
  for (const plot of result.plots) assert.deepEqual(plot.points.map((point) => point.time), snapshot.map((bar) => bar.time));
});


test("an optional na activation argument does not disable the other real trailing activation", async () => {
  for (const settings of ["trail_price=110,trail_points=na,trail_offset=5", "trail_price=na,trail_points=10,trail_offset=5"]) {
    const authored = program({ settings });
    const result = await execute(authored);
    assert.equal(result.source, authored);
    single(result, { exit: 115 });
  }
});

test("inactive na trailing fields alongside a valid take-profit remain inactive", async () => {
  const authored = program({ settings: "trail_price=na,trail_points=na,trail_offset=na,limit=110" });
  const result = await execute(authored);
  assert.equal(result.source, authored);
  single(result, { exit: 110 });
});

test("entry-relative activation and armed state belong to each physical lot", async () => {
  const snapshot = market(bars[0], { open: 100, high: 112, low: 95, close: 108 });
  const authored = `//@version=6
strategy("Physical trailing lots",initial_capital=10000,pyramiding=2,calc_on_order_fills=true)
varip int executions=-1
executions+=1
if bar_index==0
    strategy.entry("A",strategy.long,qty=1)
    strategy.entry("B",strategy.long,qty=1,stop=110)
if strategy.position_size>0
    strategy.exit("Trail",trail_points=5,trail_offset=3)
plot(executions,"Executions")`;
  const result = await execute(authored, { bars: snapshot });
  // A100 arms105 and peaks112 -> stop109; B110 requires115 and is still unarmed.
  assert.deepEqual(result.strategy.closedTrades.map((trade) => [trade.entry_id, trade.exit_price, trade.size, trade.profit]), [["A", 109, 1, 9]]);
  assert.deepEqual(result.strategy.openTrades.map((trade) => [trade.entry_id, trade.entry_price, trade.size]), [["B", 110, 1]]);
  assert.equal(result.strategy.metrics.netprofit, 9);
  assert.equal(result.strategy.pendingOrders.length, 1);
  assert.deepEqual(values(result, "Executions"), [0, 4]);
});


test("negative and nonnumeric trailing parameters fail explicitly", async () => {
  for (const settings of [
    "trail_price=110,trail_offset=-1",
    "trail_points=-1,trail_offset=5",
    'trail_price=110,trail_offset="5"',
    "trail_price=110,trail_offset=true",
    'trail_points="10",trail_offset=5',
    "trail_points=true,trail_offset=5",
  ]) {
    await assert.rejects(execute(program({ settings })), (error) => {
      assert.equal(error.code, "UNSUPPORTED_ORDER_FILL_CONTEXT");
      return true;
    });
  }
});

test("incomplete trailing legs use the qualified local valid-TP fallback but fail without another exit", async () => {
  // Qualified local policy, not a claim of independently observed TV diagnostics.
  for (const settings of ["trail_price=110", "trail_offset=5", "trail_price=110,trail_offset=na"]) {
    await assert.rejects(execute(program({ settings })), (error) => error.code === "UNSUPPORTED_ORDER_FILL_CONTEXT");
    const result = await execute(program({ settings: settings + ",limit=112" }));
    single(result, { exit: 112 });
  }
});


test("all trailing arguments na without another exit must not liquidate as a market close", async () => {
  const authored = program({ settings: "trail_price=na,trail_points=na,trail_offset=na" });
  const result = await execute(authored);
  assert.equal(result.source, authored);
  assert.deepEqual(result.strategy.closedTrades, []);
  assert.equal(result.strategy.metrics.netprofit, 0);
  assert.equal(result.strategy.metrics.position_size, 1);
  assert.equal(result.strategy.openTrades.length, 1);
  assert.equal(result.strategy.openTrades[0].entry_price, 100);
  assert.deepEqual(values(result, "Position"), [0, 1]);
  assert.deepEqual(result.strategy.pendingOrders, []);
});


test("closed non-fill trailing stop gap uses the opening price and one calculation per bar", async () => {
  const snapshot = market(bars[0], { open: 100, high: 120, low: 95, close: 119 },
    { open: 110, high: 114, low: 108, close: 112 });
  const authored = `//@version=6
strategy("Legacy armed gap",initial_capital=10000,calc_on_order_fills=false)
varip int executions=-1
executions+=1
if bar_index==0
    strategy.entry("Trade",strategy.long)
    strategy.exit("Trail","Trade",trail_price=110,trail_offset=5)
plot(executions,"Executions")
plot(strategy.position_size,"Position")`;
  const result = await execute(authored, { bars: snapshot });
  single(result, { exit: 110, exitBar: 2, snapshot });
  assert.deepEqual(values(result, "Executions"), [0, 1, 2]);
  assert.deepEqual(values(result, "Position"), [0, 1, 0]);
});


test("closed-mode already-armed opening-gap trail has priority over a later take-profit", async () => {
  const snapshot = market(bars[0], { open: 100, high: 120, low: 95, close: 119 },
    { open: 110, high: 130, low: 80, close: 125 });
  const authored = `//@version=6
strategy("Legacy opening priority",initial_capital=10000,calc_on_order_fills=false)
if bar_index==0
    strategy.entry("Trade",strategy.long)
    strategy.exit("Combined","Trade",limit=125,trail_points=10,trail_offset=5)
plot(strategy.position_size,"Position")`;
  const result = await execute(authored, { bars: snapshot });
  single(result, { exit: 110, exitBar: 2, snapshot });
  assert.deepEqual(values(result, "Position"), [0, 1, 0]);
});
