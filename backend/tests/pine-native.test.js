import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const bundle = buildSync({
  bundle: true, format: "esm", logLevel: "silent", platform: "browser", target: "es2020", write: false,
  stdin: { contents: 'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineProtocol.ts";', loader: "ts", resolveDir: fileURLToPath(new URL("../..", import.meta.url)), sourcefile: "pine-native-fixtures.ts" },
}).outputFiles[0].text;
const pine = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const bars = Array.from({ length: 6 }, (_, index) => ({ time: 1_700_000_040 + index * 60, open: index + 1, high: index + 2, low: index, close: index + 1, volume: 10 }));
const context = { symbol: "TEST", timeframe: "1", mintick: 0.01, pointvalue: 1 };
const source = '// Copyright fixture\n//@version=6\nindicator("Native", overlay=true)\nlen=input.int(3,"Length",minval=1,maxval=10)\nplot(ta.sma(close,len),"SMA",color=color.blue)';
const request = (extra = {}) => ({ id: "native-fixture", action: "run", source, bars, context, ...extra });
const fails = (code) => (error) => { assert.equal(error.code, code); return true; };

test("native Pine preparation preserves source and stable native input metadata", async () => {
  const result = await pine.executePineRequest(request({ action: "prepare" }));
  assert.equal(result.source, source);
  assert.equal(result.kind, "prepare");
  assert.equal(result.name, "Native");
  assert.equal(result.overlay, true);
  assert.equal(result.inputDefinitions[0].id, "in_0");
  assert.equal(result.inputDefinitions[0].varId, "len");
  assert.equal(result.inputDefinitions[0].minval, 1);
  assert.equal(result.inputDefinitions[0].maxval, 10);
});

test("native indicator evaluates exact SMA values, overrides, colors and na gaps", async () => {
  const result = await pine.executePineRequest(request());
  assert.equal(result.plots.length, 1); // Empty engine drawing buckets are not plots.
  assert.deepEqual(result.plots[0].points.map((point) => point.value), [null, null, 2, 3, 4, 5]);
  assert.equal(result.plots[0].points[0].options.color, "#2962FF");
  assert.equal(result.plots[0].points[2].time, bars[2].time);
  assert.deepEqual(result.inputs, { in_0: 3 });
  assert.equal(result.audit.engineVersion, "0.11.0");
  assert.equal("operations" in result.audit, false);
  const changed = await pine.executePineRequest(request({ inputs: { in_0: 2 } }));
  assert.deepEqual(changed.plots[0].points.map((point) => point.value), [null, 1.5, 2.5, 3.5, 4.5, 5.5]);
  await assert.rejects(pine.executePineRequest(request({ inputs: { in_0: 0 } })), fails("INVALID_INPUT"));
  await assert.rejects(pine.executePineRequest(request({ inputs: { in_99: 1 } })), fails("INVALID_INPUT"));
});

test("native v5 and v6 constant division follows the engine version semantics", async () => {
  for (const [version, expected] of [[5, 2], [6, 2.5]]) {
    const result = await pine.executePineRequest(request({ source: `//@version=${version}\nindicator("Division")\nplot(5 / 2,"Result")` }));
    assert.equal(result.pineVersion, version);
    assert.ok(result.plots[0].points.every((point) => point.value === expected));
  }
});

test("native force_overlay places a plot on the price chart while preserving pane plots", async () => {
  const result = await pine.executePineRequest(request({ source: '//@version=6\nindicator("Pane",overlay=false)\nplot(close,"Forced",force_overlay=true)\nplot(close,"Pane")' }));
  assert.equal(result.overlay, false);
  assert.equal(result.plots[0].overlay, true);
  assert.equal(result.plots[0].options.force_overlay, true);
  assert.equal(result.plots[1].overlay, false);
});

test("native strategy returns actual next-bar ledger, config and metrics", async () => {
  const strategy = '//@version=6\nstrategy("Ledger", initial_capital=1000)\nif bar_index == 1\n    strategy.entry("L", strategy.long, qty=2)\nif bar_index == 3\n    strategy.close("L")';
  const result = await pine.executePineRequest(request({ source: strategy }));
  assert.equal(result.declaration, "strategy");
  assert.equal(result.strategy.config.initial_capital, 1000);
  assert.equal(result.strategy.closedTrades.length, 1);
  const trade = result.strategy.closedTrades[0];
  assert.equal(trade.entry_bar_index, 2);
  assert.equal(trade.exit_bar_index, 4);
  assert.equal(trade.entry_time, bars[2].time);
  assert.equal(trade.exit_time, bars[4].time);
  assert.equal(trade.size, 2);
  assert.equal(trade.profit, 4);
  assert.equal(result.strategy.metrics.netprofit, 4);
  assert.equal(result.strategy.metrics.equity, 1004);
  assert.equal(result.strategy.metrics.position_avg_price, null);
  assert.deepEqual(result.strategy.openTrades, []);
  assert.deepEqual(result.strategy.pendingOrders, []);
});

test("native strategy preserves open positions and last-bar pending orders", async () => {
  const result = await pine.executePineRequest(request({ source: '//@version=6\nstrategy("Open")\nif bar_index == 1\n    strategy.entry("Open", strategy.long)\nif bar_index == 5\n    strategy.entry("Pending", strategy.short)' }));
  assert.equal(result.strategy.openTrades.length, 1);
  assert.equal(result.strategy.closedTrades.length, 0);
  assert.equal(result.strategy.pendingOrders.length, 1);
  assert.equal(result.strategy.pendingOrders[0].status, "pending");
  assert.equal(result.strategy.pendingOrders[0].time, bars[5].time);
});

test("security can use loaded chart data and rejects other symbol or timeframe", async () => {
  const security = (symbol, tf) => `//@version=6\nindicator("Security")\nplot(request.security("${symbol}","${tf}",close),"Close")`;
  const same = await pine.executePineRequest(request({ source: security("TEST", "1") }));
  assert.deepEqual(same.plots[0].points.map((point) => point.value), bars.map((bar) => bar.close));
  await assert.rejects(pine.executePineRequest(request({ source: security("OTHER", "1") })), fails("UNAVAILABLE_DATA"));
  await assert.rejects(pine.executePineRequest(request({ source: security("TEST", "60") })), fails("UNAVAILABLE_DATA"));
});

test("native loop protection and compiler errors are explicit", async () => {
  await assert.rejects(pine.executePineRequest(request({ source: '//@version=6\nindicator("Bad")\nplot(' })), fails("COMPILE_ERROR"));
  await assert.rejects(pine.executePineRequest(request({ source: '//@version=6\nindicator("Loop")\nint x = 0\nwhile true\n    x += 1\nplot(x)' })), fails("RUNTIME_ERROR"));
});

test("request validation rejects nonnative versions, UTF8 overflow and invalid bars/context", () => {
  for (const invalid of ['indicator("Missing")', '//@version=4\nindicator("Old")', '//@version=7\nindicator("Future")', '//@version=6\n//@version=5\nindicator("Duplicate")']) assert.throws(() => pine.validatePineRequest(request({ source: invalid })), fails("PINE_VERSION"));
  assert.throws(() => pine.validatePineRequest(request({ source: `//@version=6\n//${"é".repeat(10_000)}` })), fails("SOURCE_LIMIT"));
  assert.throws(() => pine.validatePineRequest(request({ bars: [...bars, bars[5]] })), fails("INVALID_BARS"));
  assert.throws(() => pine.validatePineRequest(request({ bars: [{ ...bars[0], close: NaN }] })));
  assert.throws(() => pine.validatePineRequest(request({ bars: [{ ...bars[0], time: 8_640_000_000_000 }] })), fails("INVALID_BARS"));
  assert.throws(() => pine.validatePineRequest(request({ context: undefined })), fails("INVALID_CONTEXT"));
  assert.throws(() => pine.validatePineRequest(request({ context: { ...context, timeframe: "not-a-timeframe" } })), fails("INVALID_CONTEXT"));
  assert.throws(() => pine.validatePineRequest(request({ inputs: { Length: 3 } })), fails("INVALID_INPUT"));
});

test("response validation rejects forged identity, source, audit and unsafe plot timestamps", async () => {
  const original = await pine.executePineRequest(request());
  const response = (result) => ({ id: "native-fixture", status: "completed", result });
  assert.throws(() => pine.validatePineResponse({ ...response(original), id: "wrong" }, request()));
  assert.throws(() => pine.validatePineResponse(response({ ...original, source: `${source}\n` }), request()));
  assert.throws(() => pine.validatePineResponse(response({ ...original, audit: { ...original.audit, bars: 99 } }), request()));
  for (const times of [[bars[1].time, bars[0].time], [bars[0].time, bars[0].time], [bars[0].time + 1]]) {
    const modified = structuredClone(original);
    modified.plots[0].points = times.map((time) => ({ time, value: 1, options: {} }));
    assert.throws(() => pine.validatePineResponse(response(modified), request()));
  }
  const unsafe = structuredClone(original);
  unsafe.plots[0].options.bad = () => 1;
  assert.throws(() => pine.validatePineResponse(response(unsafe), request()));
  unsafe.plots[0].options.bad = unsafe;
  assert.throws(() => pine.validatePineResponse(response(unsafe), request()));
});

test("plot count allows 64 real channels and refuses a 65th", async () => {
  const many = (count) => `//@version=6\nindicator("Many")\n${Array.from({ length: count }, (_, index) => `plot(close,"Plot ${index}")`).join("\n")}`;
  assert.equal((await pine.executePineRequest(request({ source: many(64) }))).plots.length, 64);
  await assert.rejects(pine.executePineRequest(request({ source: many(65) })), fails("PLOT_LIMIT"));
});


const values = (result) => Object.fromEntries(result.plots.map((plot) => [plot.name, plot.points.map((point) => point.value)]));

test("closed historical and live snapshots expose exact bar states independent of timestamp", async () => {
  for (const version of [5, 6]) for (const mode of ["historical", "live"]) for (const count of [1, 4]) for (const start of [946_684_800, 4_102_444_800]) {
    const snapshot = bars.slice(0, count).map((bar, index) => ({ ...bar, time: start + index * 60 }));
    const native = `//@version=${version}\nindicator("States")\n` + ["ishistory", "isrealtime", "isconfirmed", "isnew", "isfirst", "islast", "islastconfirmedhistory"].map((state) => `plot(barstate.${state} ? 1 : 0,"${state}")`).join("\n");
    const result = await pine.executePineRequest(request({ source: native, bars: snapshot, mode }));
    const ones = Array(count).fill(1), zeros = Array(count).fill(0);
    assert.deepEqual(values(result), { ishistory: ones, isrealtime: zeros, isconfirmed: ones, isnew: ones,
      isfirst: ones.map((_, index) => index === 0 ? 1 : 0), islast: ones.map((_, index) => index === count - 1 ? 1 : 0), islastconfirmedhistory: ones.map((_, index) => index === count - 1 ? 1 : 0) }, `${version} ${mode} ${count} ${start}`);
    assert.equal(result.source, native);
    assert.equal(result.audit.mode, mode);
    assert.deepEqual(result.plots[0].points.map((point) => point.time), snapshot.map((bar) => bar.time));
  }
});

test("historical persistent variables and committed history retain native v5/v6 semantics", async () => {
  for (const version of [5, 6]) for (const mode of ["historical", "live"]) {
    const native = `//@version=${version}\nindicator("History")\nint regular = 0\nregular += 10\nvar int persistent = 0\nvarip int intrabar = 0\nif barstate.isnew and barstate.isconfirmed\n    persistent += 10\n    intrabar += 10\nplot(regular,"regular")\nplot(persistent,"var")\nplot(intrabar,"varip")\nplot(persistent[1],"var history")\nplot(close[1],"close history")\nplot(5 / 2,"division")`;
    const result = await pine.executePineRequest(request({ source: native, mode }));
    assert.deepEqual(values(result), { regular: [10, 10, 10, 10, 10, 10], var: [10, 20, 30, 40, 50, 60], varip: [10, 20, 30, 40, 50, 60],
      "var history": [null, 10, 20, 30, 40, 50], "close history": [null, 1, 2, 3, 4, 5], division: Array(6).fill(version === 5 ? 2 : 2.5) });
    assert.equal(result.source, native);
  }
});

test("unsupported historical strategy recalculation rejects true literals, constants and resolved inputs before the body runs", async () => {
  for (const version of [5, 6]) for (const setting of ["calc_on_order_fills", "calc_on_every_history_tick"]) {
    for (const [prefix, expression, inputs] of [["", "true", {}], ["const bool enabled = true\n", "enabled", {}], ['enabled = input.bool(false,"Recalculate")\n', "enabled", { in_0: true }]]) {
      const native = `//@version=${version}\n${prefix}strategy("Recalculate",${setting}=${expression})\nstrategy.entry("L",strategy.long)\nplot(not_a_real_function(close))`;
      await assert.rejects(pine.executePineRequest(request({ source: native, inputs })), (error) => {
        assert.equal(error.code, "UNSUPPORTED_EXECUTION_SETTING"); assert.match(error.message, new RegExp(setting)); return true;
      });
    }
  }
});

test("false strategy aliases normalize to booleans and retain the actual next-bar ledger", async () => {
  for (const version of [5, 6]) for (const prefix of ["const bool disabled = false", 'disabled = input.bool(true,"Recalculate")']) {
    const native = `//@version=${version}\n${prefix}\nstrategy("False aliases",initial_capital=1000,calc_on_every_tick=disabled,calc_on_order_fills=disabled,calc_on_every_history_tick=disabled)\nif barstate.ishistory and barstate.isconfirmed and bar_index == 1\n    strategy.entry("L",strategy.long,qty=2)\nif bar_index == 3\n    strategy.close("L")`;
    const result = await pine.executePineRequest(request({ source: native, inputs: prefix.startsWith("const") ? {} : { in_0: false } }));
    for (const setting of ["calc_on_every_tick", "calc_on_order_fills", "calc_on_every_history_tick"]) assert.equal(result.strategy.config[setting], false);
    assert.equal(result.strategy.closedTrades.length, 1);
    assert.deepEqual([result.strategy.closedTrades[0].entry_bar_index, result.strategy.closedTrades[0].exit_bar_index, result.strategy.closedTrades[0].profit], [2, 4, 4]);
    assert.equal(result.strategy.metrics.netprofit, 4);
    assert.equal(result.source, native);
  }
});

test("preparation and execution disclose closed snapshots and unsupported strategy scheduling", async () => {
  for (const declaration of ['indicator("Notice")', 'strategy("Notice",calc_on_order_fills=true)']) {
    const native = `//@version=6\n${declaration}\nplot(close)`;
    const prepared = await pine.executePineRequest(request({ action: "prepare", source: native }));
    assert.equal(prepared.source, native);
    const snapshotNotice = prepared.diagnostics.find((item) => item.code === "CLOSED_BAR_SNAPSHOT");
    assert.equal(snapshotNotice.severity, "warning");
    assert.match(snapshotNotice.message, /closed historical snapshots/); assert.match(snapshotNotice.message, /rollback/); assert.match(snapshotNotice.message, /varip/);
    if (prepared.declaration === "strategy") {
      const schedulingNotice = prepared.diagnostics.find((item) => item.code === "UNSUPPORTED_EXECUTION_SETTINGS");
      assert.equal(schedulingNotice.severity, "warning"); assert.match(schedulingNotice.message, /calc_on_order_fills/);
      await assert.rejects(pine.executePineRequest(request({ source: native })), fails("UNSUPPORTED_EXECUTION_SETTING"));
    } else {
      const result = await pine.executePineRequest(request({ source: native }));
      assert.ok(result.diagnostics.some((item) => item.code === "CLOSED_BAR_SNAPSHOT"));
    }
  }
});
