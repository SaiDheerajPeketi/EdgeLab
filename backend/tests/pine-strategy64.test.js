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
    contents: 'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineProtocol.ts"; export * from "./frontend/src/lib/customIndicators.ts";',
    loader: "ts",
    resolveDir: root,
    sourcefile: "pine-strategy64-fixture.ts",
  },
})).outputFiles[0].text + "\n//# sourceURL=edgelab-strategy64-minified-worker.mjs\n";
const pine = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
console.info("STRATEGY64_BINDING " + JSON.stringify({
  minify: true,
  bundleSha256: sha(bundle),
  bundleBytes: Buffer.byteLength(bundle),
  workerSourceSha256: sha(fs.readFileSync(new URL("../../frontend/src/workers/pineNative.worker.ts", import.meta.url))),
  protocolSourceSha256: sha(fs.readFileSync(new URL("../../frontend/src/lib/pineProtocol.ts", import.meta.url))),
  engineManifestSha256: sha(fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json", import.meta.url))),
}));
const opens = [10, 20, 31, 45, 52, 67];
const closes = [14, 23, 36, 49, 59, 73];
const bars = opens.map((open, index) => ({ time: 1_700_000_040 + index * 60, open, close: closes[index], high: Math.max(open, closes[index]) + 2, low: Math.min(open, closes[index]) - 2, volume: 10 }));
const context = { symbol: "TEST", timeframe: "1", mintick: 0.5, pointvalue: 1 };
const source = `//@version=6
strategy("Trader settings",initial_capital=1000,default_qty_type=strategy.fixed,default_qty_value=1)
if bar_index==1
    strategy.entry("L",strategy.long)
if bar_index==3
    strategy.close("L")
plot(strategy.position_size,"Position")
plot(strategy.equity,"Equity")`;
const request = (strategySettings, extra = {}) => ({ id: "strategy64", action: "run", source, inputs: {}, bars, context, ...(strategySettings === undefined ? {} : { strategySettings }), ...extra });
const execute = (strategySettings, extra) => pine.executePineRequest(request(strategySettings, extra));

test("source defaults remain exact when no trader test settings are provided", async () => {
  const result = await execute();
  assert.equal(result.source, source);
  assert.equal(result.strategy.config.initial_capital, 1000);
  assert.equal(result.strategy.config.default_qty_value, 1);
  assert.deepEqual([result.strategy.closedTrades[0].entry_price, result.strategy.closedTrades[0].exit_price, result.strategy.closedTrades[0].size, result.strategy.metrics.netprofit], [31, 52, 1, 21]);
});

test("explicit trader capital and fixed quantity reach the actual broker calculation", async () => {
  const settings = { initial_capital: 2000, default_qty_type: "fixed", default_qty_value: 3 };
  const result = await execute(settings);
  assert.equal(result.source, source);
  assert.equal(result.strategy.config.initial_capital, 2000);
  assert.equal(result.strategy.config.default_qty_type, "fixed");
  assert.equal(result.strategy.config.default_qty_value, 3);
  assert.equal(result.strategy.closedTrades[0].size, 3);
  assert.equal(result.strategy.metrics.netprofit, 63);
  assert.equal(result.strategy.metrics.equity, 2063);
});


const values = (result, name) => result.plots.find((plot) => plot.name === name).points.map((point) => point.value);
const invalidSettings = (error) => error.code === "INVALID_STRATEGY_SETTINGS";

test("empty or partial overrides preserve all omitted authored settings", async () => {
  const authored = source.replace("default_qty_value=1", "default_qty_value=2,commission_type=strategy.commission.cash_per_order,commission_value=1,slippage=1,pyramiding=3,process_orders_on_close=true");
  for (const settings of [undefined, {}, { initial_capital: 2000 }]) {
    const result = await execute(settings, { source: authored });
    assert.equal(result.source, authored);
    assert.deepEqual([
      result.strategy.config.default_qty_value,
      result.strategy.config.commission_type,
      result.strategy.config.commission_value,
      result.strategy.config.slippage,
      result.strategy.config.pyramiding,
      result.strategy.config.process_orders_on_close,
    ], [2, "cash_per_order", 1, 1, 3, true]);
    assert.deepEqual([result.strategy.closedTrades[0].entry_price, result.strategy.closedTrades[0].exit_price, result.strategy.closedTrades[0].size], [23.5, 48.5, 2]);
    assert.equal(result.strategy.metrics.netprofit, 48);
    assert.equal(result.strategy.metrics.equity, (settings?.initial_capital ?? 1000) + 48);
  }
});

test("cash and equity sizing use real close-price fills while explicit order quantity wins", async () => {
  for (const version of [5, 6]) {
    const authored = source.replace("version=6", `version=${version}`);
    for (const settings of [
      { default_qty_type: "cash", default_qty_value: 46 },
      { default_qty_type: "percent_of_equity", default_qty_value: 4.6 },
    ]) {
      const result = await execute({ ...settings, process_orders_on_close: true }, { source: authored });
      assert.deepEqual([result.strategy.closedTrades[0].size, result.strategy.closedTrades[0].entry_price, result.strategy.closedTrades[0].exit_price, result.strategy.metrics.netprofit], [2, 23, 49, 52]);
    }
    const explicit = authored.replace('strategy.entry("L",strategy.long)', 'strategy.entry("L",strategy.long,qty=2)');
    const result = await execute({ default_qty_type: "fixed", default_qty_value: 7 }, { source: explicit });
    assert.equal(result.strategy.closedTrades[0].size, 2);
    assert.equal(result.strategy.metrics.netprofit, 42);
  }
});

test("commission modes and adverse tick slippage reach actual entry and exit legs", async () => {
  for (const scenario of [
    { type: "percent", value: 1, fee: 2.49, net: 57.51 },
    { type: "cash_per_contract", value: 2, fee: 12, net: 48 },
    { type: "cash_per_order", value: 2, fee: 4, net: 56 },
  ]) {
    const result = await execute({ default_qty_value: 3, slippage: 1, commission_type: scenario.type, commission_value: scenario.value });
    const trade = result.strategy.closedTrades[0];
    assert.deepEqual([trade.entry_price, trade.exit_price, trade.size], [31.5, 51.5, 3]);
    assert.equal(trade.commission, scenario.fee);
    // 3 * (51.5 - 31.5) minus two separately charged fill legs.
    assert.equal(trade.profit, scenario.net);
    assert.equal(result.strategy.metrics.netprofit, scenario.net);
    assert.equal(result.strategy.metrics.equity, 1000 + scenario.net);
  }
});

test("pyramiding changes accepted entry count without adding calculations", async () => {
  const authored = `//@version=6
strategy("Pyramid",initial_capital=1000,pyramiding=1)
var int calls=0
calls+=1
if bar_index<3
    strategy.entry("L",strategy.long)
if bar_index==4
    strategy.close_all()
plot(calls,"Calculations")
plot(strategy.position_size,"Position")`;
  for (const scenario of [{ count: 1, profit: 47 }, { count: 2, profit: 83 }]) {
    const result = await execute({ pyramiding: scenario.count }, { source: authored });
    assert.equal(result.strategy.closedTrades.length, scenario.count);
    assert.equal(result.strategy.metrics.netprofit, scenario.profit);
    assert.deepEqual(values(result, "Calculations"), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(result.strategy.closedTrades.map((trade) => trade.entry_price), scenario.count === 1 ? [20] : [20, 31]);
    assert.ok(result.strategy.closedTrades.every((trade) => trade.exit_price === 67));
  }
});

test("timing override replaces source true and default false in both directions", async () => {
  for (const enabled of [false, true]) {
    const authored = source.replace("default_qty_value=1", `default_qty_value=1,process_orders_on_close=${!enabled}`);
    const result = await execute({ process_orders_on_close: enabled }, { source: authored });
    assert.deepEqual([result.strategy.closedTrades[0].entry_price, result.strategy.closedTrades[0].exit_price, result.strategy.metrics.netprofit], enabled ? [23, 49, 26] : [31, 52, 21]);
    assert.equal(result.strategy.config.process_orders_on_close, enabled);
  }
});

test("strict protocol boundaries reject malformed, scheduler, unsafe and accessor settings", async () => {
  const invalid = [
    null, [], "settings", { initial_capital: 0 }, { initial_capital: 1e12 + 1 },
    { default_qty_value: 0 }, { default_qty_value: 1e9 + 1 },
    { commission_value: -1 }, { commission_value: 1e9 + 1 },
    { slippage: 0.5 }, { slippage: 10001 }, { pyramiding: 1.5 }, { pyramiding: 1001 },
    { initial_capital: NaN }, { initial_capital: Infinity }, { initial_capital: "2000" },
    { default_qty_type: "contracts" }, { commission_type: "cash" }, { process_orders_on_close: 1 },
    { currency: "INR" }, { calc_on_every_tick: true }, { calc_on_order_fills: 1 },
    { use_bar_magnifier: "true" }, { inherited: 1 },
  ];
  let reads = 0;
  invalid.push(Object.defineProperty({}, "initial_capital", { enumerable: true, get() { reads += 1; return 2000; } }));
  invalid.push(Object.defineProperty({}, "slippage", { value: 1 }));
  invalid.push({ [Symbol("settings")]: 1 });
  invalid.push(JSON.parse('{"__proto__":{"initial_capital":2000}}'));
  invalid.push(Object.create({ initial_capital: 2000 }));
  for (const value of invalid) assert.throws(() => pine.validatePineStrategySettings(value), /./);
  assert.equal(reads, 0);
  const upper = { initial_capital: 1e12, default_qty_value: 1e9, commission_value: 1e9, slippage: 10000, pyramiding: 1000, process_orders_on_close: false };
  assert.deepEqual(pine.validatePineStrategySettings(upper), upper);
  // Percent values above 100 are legitimate leveraged sizing/cost settings.
  assert.deepEqual(pine.validatePineStrategySettings({ default_qty_type: "percent_of_equity", default_qty_value: 300, commission_type: "percent", commission_value: 101 }), { default_qty_type: "percent_of_equity", default_qty_value: 300, commission_type: "percent", commission_value: 101 });
  const settings = { initial_capital: 2000 };
  const decoded = pine.validatePineRequest(request(settings));
  assert.deepEqual(decoded.strategySettings, settings);
  assert.notEqual(decoded.strategySettings, settings);
  settings.initial_capital = 3000;
  assert.equal(decoded.strategySettings.initial_capital, 2000);
  await assert.rejects(execute({ slippage: 0.5 }), invalidSettings);
});

test("strategy settings cannot cross indicator or tampered response boundaries", async () => {
  const indicator = '//@version=6\nindicator("No broker")\nplot(close)';
  for (const action of ["prepare", "run"]) await assert.rejects(execute({ initial_capital: 2000 }, { source: indicator, action }), invalidSettings);
  const input = request({ initial_capital: 2000, default_qty_value: 3 });
  const result = await pine.executePineRequest(input);
  for (const key of ["initial_capital", "default_qty_value"]) {
    const tampered = structuredClone(result);
    tampered.strategy.config[key] += 1;
    assert.throws(() => pine.validatePineResponse({ id: input.id, status: "completed", result: tampered }, input), invalidSettings);
  }
  assert.equal(pine.validatePineResponse({ id: input.id, status: "completed", result }, input).strategy.config.initial_capital, 2000);
});

test("saved strategy, versions, duplicate and chart instances retain independent settings", async () => {
  const prepared = await execute(undefined, { action: "prepare" });
  const originalSettings = { initial_capital: 2000, default_qty_value: 3, commission_type: "cash_per_order", commission_value: 2 };
  const draft = { category: "Trend", color: "#00ffaa", description: "Saved test strategy", id: "user64", inputs: {}, name: "Saved trader strategy", preview: "line", source, synonyms: [], strategySettings: originalSettings };
  const first = pine.saveCustomIndicator([], draft, { pinePrepared: prepared });
  assert.equal(first.scripts.length, 1);
  const saved = first.scripts[0];
  assert.equal(saved.source, source);
  assert.deepEqual(saved.strategySettings, originalSettings);
  assert.notEqual(saved.strategySettings, originalSettings);
  const changed = { initial_capital: 3000, default_qty_value: 4, process_orders_on_close: true };
  const second = pine.saveCustomIndicator(first.scripts, { ...draft, id: saved.id, strategySettings: changed }, { pinePrepared: prepared });
  const updated = second.scripts.find((script) => script.id === saved.id);
  assert.deepEqual(updated.strategySettings, changed);
  assert.deepEqual(updated.versions[0].strategySettings, originalSettings);
  const restored = pine.sanitizeCustomIndicators(JSON.parse(JSON.stringify(second.scripts)));
  assert.deepEqual(restored[0].strategySettings, changed);
  assert.deepEqual(restored[0].versions[0].strategySettings, originalSettings);
  const duplicate = pine.duplicateCustomIndicator(updated);
  assert.deepEqual(duplicate.strategySettings, changed);
  assert.notEqual(duplicate.strategySettings, updated.strategySettings);
  const instance = pine.createCustomIndicatorInstance(updated);
  assert.deepEqual(instance.settings.pineStrategySettings, changed);
  assert.notEqual(instance.settings.pineStrategySettings, updated.strategySettings);
  const result = await execute(instance.settings.pineStrategySettings, { source: instance.customScriptSource });
  assert.deepEqual([result.strategy.closedTrades[0].size, result.strategy.metrics.netprofit, result.strategy.metrics.equity], [4, 104, 3104]);
  assert.equal(pine.sanitizeCustomIndicators([{ ...updated, strategySettings: { slippage: -1 } }]).length, 0);
  const invalid = pine.saveCustomIndicator(second.scripts, { ...draft, strategySettings: { pyramiding: 0.1 } }, { pinePrepared: prepared });
  assert.equal(invalid.scripts, second.scripts);
  assert.ok(invalid.diagnostics.some((diagnostic) => diagnostic.code === "INVALID_STRATEGY_SETTINGS"));
  const reset = pine.saveCustomIndicator(second.scripts, { ...draft, id: saved.id, strategySettings: {} }, { pinePrepared: prepared });
  assert.equal(reset.scripts.find((script) => script.id === saved.id).strategySettings, undefined);
});
