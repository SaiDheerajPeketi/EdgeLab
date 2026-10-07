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
  stdin: {
    contents: 'export * from "./frontend/src/workers/pineNative.worker.ts";',
    loader: "ts",
    resolveDir: root,
    sourcefile: "pine-strategy63-fixture.ts",
  },
})).outputFiles[0].text + "\n//# sourceURL=edgelab-strategy63-minified-worker.mjs\n";
const pine = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
console.info("STRATEGY63_BINDING " + JSON.stringify({
  minify: true,
  bundleSha256: sha(bundle),
  bundleBytes: Buffer.byteLength(bundle),
  workerSourceSha256: sha(fs.readFileSync(new URL("../../frontend/src/workers/pineNative.worker.ts", import.meta.url))),
  engineManifestSha256: sha(fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json", import.meta.url))),
}));
const opens = [10, 20, 31, 45, 52, 67];
const closes = [14, 23, 36, 49, 59, 73];
const bars = opens.map((open, index) => ({
  time: 1_700_000_040 + index * 60,
  open,
  close: closes[index],
  high: Math.max(open, closes[index]) + 2,
  low: Math.min(open, closes[index]) - 2,
  volume: 10,
}));
const context = { symbol: "TEST", timeframe: "1", mintick: 0.01, pointvalue: 1 };
const execute = (source, inputs = {}, extra = {}) => pine.executePineRequest({
  id: "strategy63", action: "run", source, inputs, bars, context, ...extra,
});
function program(version, expression = "true", prefix = "", options = "", closeOptions = "") {
  return `//@version=${version}
${prefix}strategy("Closed tick setting",initial_capital=1000,calc_on_every_tick=${expression}${options})
var int calculations=0
calculations+=1
if bar_index == 1
    strategy.entry("L",strategy.long,qty=2)
if bar_index == 3
    strategy.close("L"${closeOptions})
plot(calculations,"Calculations")
plot(strategy.position_size,"Position")
plot(strategy.position_avg_price,"Average")
plot(barstate.ishistory,"Historical")
plot(barstate.isrealtime,"Realtime")
plot(barstate.isconfirmed,"Confirmed")
plot(barstate.isnew,"New")
plot(barstate.islastconfirmedhistory,"Last confirmed history")`;
}
const values = (result, name) => result.plots.find((plot) => plot.name === name).points.map((point) => point.value);
function countAndStates(result, source) {
  assert.equal(result.source, source);
  assert.equal(result.declaration, "strategy");
  assert.deepEqual(values(result, "Calculations"), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(values(result, "Historical"), Array(6).fill(true));
  assert.deepEqual(values(result, "Realtime"), Array(6).fill(false));
  assert.deepEqual(values(result, "Confirmed"), Array(6).fill(true));
  assert.deepEqual(values(result, "New"), Array(6).fill(true));
  assert.deepEqual(values(result, "Last confirmed history"), [false, false, false, false, false, true]);
  for (const plot of result.plots) assert.deepEqual(plot.points.map((point) => point.time), bars.map((bar) => bar.time));
}
function nextOpenLedger(result) {
  assert.equal(result.strategy.closedTrades.length, 1);
  const trade = result.strategy.closedTrades[0];
  assert.deepEqual([trade.entry_bar_index, trade.exit_bar_index, trade.entry_price, trade.exit_price, trade.size, trade.profit], [2, 4, 31, 52, 2, 42]);
  assert.deepEqual([trade.entry_time, trade.exit_time], [bars[2].time, bars[4].time]);
  assert.equal(result.strategy.metrics.netprofit, 42);
  assert.equal(result.strategy.metrics.equity, 1042);
  assert.deepEqual(result.strategy.openTrades, []);
  assert.deepEqual(result.strategy.pendingOrders, []);
  assert.deepEqual(values(result, "Position"), [0, 0, 2, 2, 0, 0]);
  assert.deepEqual(values(result, "Average"), [null, null, 31, 31, null, null]);
}

test("closed false-setting control has one calculation per bar and exact next-open ledger", async () => {
  const source = program(6, "false");
  const result = await execute(source);
  countAndStates(result, source);
  nextOpenLedger(result);
  assert.equal(result.strategy.config.calc_on_every_tick, false);
});

test("closed true-setting v6 snapshot must retain one calculation per historical bar", async () => {
  const source = program(6);
  const result = await execute(source);
  countAndStates(result, source);
  nextOpenLedger(result);
  assert.equal(result.strategy.config.calc_on_every_tick, true);
});

const forms = [
  { name: "literal", settings: (enabled) => ({ expression: String(enabled), prefix: "", inputs: {} }) },
  { name: "const", settings: (enabled) => ({ expression: "enabled", prefix: `const bool enabled=${enabled}\n`, inputs: {} }) },
  { name: "input override", settings: (enabled) => ({ expression: "enabled", prefix: `enabled=input.bool(${!enabled},"Recalculate")\n`, inputs: { in_0: enabled } }) },
];
for (const version of [5, 6]) for (const form of forms) {
  test(`v${version} ${form.name} true/false remain closed historical settings with exact ledger`, async () => {
    for (const enabled of [false, true]) for (const mode of ["historical", "live"]) {
      const settings = form.settings(enabled);
      const source = program(version, settings.expression, settings.prefix);
      const prepared = await execute(source, settings.inputs, { action: "prepare", mode });
      assert.equal(prepared.source, source);
      assert.equal(prepared.pineVersion, version);
      assert.ok(prepared.diagnostics.some((diagnostic) => diagnostic.code === "CLOSED_BAR_SNAPSHOT"));
      if (form.name === "input override") assert.equal(prepared.inputDefinitions[0].defval, !enabled);
      const result = await execute(source, settings.inputs, { mode });
      countAndStates(result, source);
      nextOpenLedger(result);
      assert.equal(result.strategy.config.calc_on_every_tick, enabled);
      assert.equal(result.strategy.config.initial_capital, 1000);
      assert.equal(result.audit.mode, mode);
      assert.deepEqual(result.inputs, settings.inputs);
    }
  });
}

const fillCases = [
  { name: "process_orders_on_close", options: ",process_orders_on_close=true", closeOptions: "", entryBar: 1, entryPrice: 23, exitBar: 3, exitPrice: 49, profit: 52 },
  { name: "immediately", options: "", closeOptions: ",immediately=true", entryBar: 2, entryPrice: 31, exitBar: 3, exitPrice: 49, profit: 36 },
  { name: "both close settings", options: ",process_orders_on_close=true", closeOptions: ",immediately=true", entryBar: 1, entryPrice: 23, exitBar: 3, exitPrice: 49, profit: 52 },
];
for (const version of [5, 6]) {
  test(`v${version} permitted tick setting preserves close-price fills without extra calculations`, async () => {
    for (const scenario of fillCases) {
      const source = program(version, "true", "", scenario.options, scenario.closeOptions);
      const result = await execute(source);
      countAndStates(result, source);
      assert.equal(result.strategy.config.calc_on_every_tick, true);
      assert.equal(result.strategy.closedTrades.length, 1);
      const trade = result.strategy.closedTrades[0];
      assert.deepEqual([trade.entry_bar_index, trade.entry_price, trade.exit_bar_index, trade.exit_price, trade.profit], [scenario.entryBar, scenario.entryPrice, scenario.exitBar, scenario.exitPrice, scenario.profit], scenario.name);
      assert.deepEqual([trade.entry_time, trade.exit_time], [bars[scenario.entryBar].time, bars[scenario.exitBar].time]);
      assert.equal(trade.size, 2);
      assert.equal(result.strategy.metrics.netprofit, scenario.profit);
      assert.equal(result.strategy.metrics.equity, 1000 + scenario.profit);
      // Orders fill after this bar's script, so the plotted position changes on
      // the next calculation; this is distinct from the actual ledger bar.
      assert.deepEqual(values(result, "Position"), [0, 0, 2, 2, 0, 0]);
      assert.deepEqual(values(result, "Average"), [null, null, scenario.entryPrice, scenario.entryPrice, null, null]);
      assert.deepEqual(result.strategy.openTrades, []);
      assert.deepEqual(result.strategy.pendingOrders, []);
    }
  });
}

function rejectsSetting(setting) {
  return (error) => {
    assert.equal(error.code, "UNSUPPORTED_EXECUTION_SETTING");
    assert.ok(error.message.includes(setting), error.message);
    assert.ok(!error.message.includes("BODY_RAN"));
    return true;
  };
}
test("fill/history recalculation true fails before script orders or runtime body, even with tick true", async () => {
  for (const version of [5, 6]) for (const setting of ["calc_on_order_fills", "calc_on_every_history_tick"]) for (const form of forms) {
    const resolved = form.settings(true);
    const source = `//@version=${version}\n${resolved.prefix}strategy("Rejected scheduler",calc_on_every_tick=true,${setting}=${resolved.expression})\nstrategy.entry("L",strategy.long)\nruntime.error("BODY_RAN")`;
    await assert.rejects(execute(source, resolved.inputs), rejectsSetting(setting));
  }
});

test("numeric string and na tick flags fail closed before body instead of gaining truthiness", async () => {
  for (const version of [5, 6]) for (const expression of ["1", "0", '"true"', '"false"', "na"]) {
    const source = `//@version=${version}\nstrategy("Malformed tick setting",calc_on_every_tick=${expression})\nruntime.error("BODY_RAN")`;
    await assert.rejects(execute(source), rejectsSetting("calc_on_every_tick"));
  }
});

test("omitted tick flag and one future-timestamp closed bar retain ordinary historical execution", async () => {
  for (const version of [5, 6]) {
    const source = `//@version=${version}\nstrategy("Closed singleton")\nvar int calls=0\ncalls+=1\nplot(calls,"Calculations")\nplot(barstate.ishistory,"Historical")\nplot(barstate.isrealtime,"Realtime")\nplot(barstate.isconfirmed,"Confirmed")\nplot(barstate.islastconfirmedhistory,"Last confirmed history")`;
    const result = await execute(source, {}, { bars: [{ ...bars[0], time: 4_102_444_800 }] });
    assert.equal(result.strategy.config.calc_on_every_tick, false);
    assert.deepEqual(values(result, "Calculations"), [1]);
    assert.deepEqual(values(result, "Historical"), [true]);
    assert.deepEqual(values(result, "Realtime"), [false]);
    assert.deepEqual(values(result, "Confirmed"), [true]);
    assert.deepEqual(values(result, "Last confirmed history"), [true]);
    assert.equal(result.source, source);
  }
});

test("persistent realtime strategies stay refused for default, false and true configurations", async () => {
  for (const version of [5, 6]) for (const expression of [undefined, "false", "true"]) {
    const source = expression === undefined ? `//@version=${version}\nstrategy("Live refusal")\nplot(close)` : program(version, expression);
    const sessionId = `strategy-live-${version}-${expression ?? "default"}`;
    const executor = pine.createPineLiveExecutor();
    const command = { protocol: "pine-live-v1", sessionId, sequence: 0, action: "start", request: {
      id: `${sessionId}:0`, action: "run", mode: "live", source, inputs: {}, bars, context,
    } };
    await assert.rejects(executor.execute(command), (error) => {
      assert.equal(error.code, "LIVE_STRATEGY_UNAVAILABLE");
      return true;
    });
    await assert.rejects(executor.execute(command), (error) => {
      assert.equal(error.code, "LIVE_SESSION_HALTED");
      return true;
    });
    executor.dispose();
  }
});
