import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
const root = new URL("../../", import.meta.url).pathname;
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser",
  target: "es2020", write: false, logLevel: "silent", plugins: [createPineEnginePlugin()],
  stdin: { contents: 'export * from "./frontend/src/workers/pineNative.worker.ts";',
    resolveDir: root, sourcefile: "pine-static-requests105.ts", loader: "ts" },
})).outputFiles[0].text;
console.info("STATIC105_BINDING " + JSON.stringify({ minify: true, sealed: true,
  bundleSha256: createHash("sha256").update(bundle).digest("hex"),
  manifestSha256: createHash("sha256").update(fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json", import.meta.url))).digest("hex") }));
const pine = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const start = 1_700_000_100;
assert.equal(start % 900, 0);
const bars = Array.from({ length: 30 }, (_, i) => ({ time: start + i * 60,
  open: 9 + i, high: 12 + i, low: 8 + i, close: 10 + i, volume: 100 + i }));
const context = { symbol: "CHART:TEST", timeframe: "1", mintick: .01, pointvalue: 1 };
const source = (body, version, declaration) => "//@version=" + version + "\n" + declaration + "\n" + body;
const run = (body, { version = 6, dynamic = false, inputs = {}, action = "run",
  snapshot = bars, mode = "historical", declaration } = {}) => pine.executePineRequest({
  id: "static105", action, source: source(body, version, declaration ??
    ('indicator("Static105"' + (dynamic === "default" ? "" : ",dynamic_requests=" + dynamic) + ")")),
  inputs, mode, ...(action === "run" ? { bars: snapshot, context } : {}),
});
const values = (result, name) => result.plots.find(item => item.name === name).points.map(point => point.value);
const request = (expression, minutes, options = "") => 'request.security("CHART:TEST","' + minutes + '",' + expression + options + ")";
const plot = (expression, name) => "plot(" + expression + ',"' + name + '")';
const policies = [{ version: 5, dynamic: "default" }, { version: 5, dynamic: false }, { version: 6, dynamic: false }];

// Independent candle and historical merge oracle, never sourced from runtime helpers.
// Static transport samples the already calculated chart series at the target close.
function targets(snapshot, minutes) {
  const width = minutes * 60, grouped = new Map();
  for (const bar of snapshot) {
    const time = Math.floor(bar.time / width) * width;
    if (!grouped.has(time)) grouped.set(time, []);
    grouped.get(time).push(bar);
  }
  return [...grouped].sort((a, b) => a[0] - b[0]).flatMap(([time, group]) =>
    group.length !== minutes || group.some((bar, i) => bar.time !== time + i * 60) ? [] :
    [{ time, end: time + width, open: group[0].open, close: group.at(-1).close,
      high: Math.max(...group.map(bar => bar.high)), low: Math.min(...group.map(bar => bar.low)) }]);
}
function merge(snapshot, remoteBars, samples, { on = false, gaps = false } = {}) {
  return snapshot.map(bar => {
    let chosen = -1;
    remoteBars.forEach((target, i) => { if (on ? target.time <= bar.time : target.end <= bar.time + 60) chosen = i; });
    if (chosen < 0) return null;
    const target = remoteBars[chosen];
    if (gaps && (on ? target.time !== bar.time : !(bar.time < target.end && target.end <= bar.time + 60))) return null;
    return samples[chosen];
  });
}
const chartRemote = (minutes, expression = target => target.close, snapshot = bars) => {
  const remoteBars = targets(snapshot, minutes);
  return merge(snapshot, remoteBars, remoteBars.map(expression));
};
const sampleAtClose = (series, minutes = 15, snapshot = bars) =>
  targets(snapshot, minutes).map(target => series[snapshot.findIndex(bar => bar.time + 60 === target.end)] ?? null);
const outer = (samples, options = {}) => merge(bars, targets(bars, 15), samples, options);
const mean = (items, length) => items.map((_, i) => i < length - 1 || items.slice(i - length + 1, i + 1).some(x => x === null) ? null :
  items.slice(i - length + 1, i + 1).reduce((sum, x) => sum + x, 0) / length);

test("static v5 default and explicit false reuse chart-calculated values while dynamic nesting reexecutes", async () => {
  const body = 'inner=request.security("","",timeframe.period=="1"?1:15)\n' + plot(request("inner", 15), "Nested");
  for (const policy of policies) {
    const result = await run(body, policy);
    assert.deepEqual(values(result, "Nested"), outer([1, 1]), JSON.stringify(policy));
    assert.equal(result.source, source(body, policy.version, 'indicator("Static105"' + (policy.dynamic === "default" ? "" : ",dynamic_requests=false") + ")"));
  }
  for (const version of [5, 6]) {
    const result = await run(body, { version, dynamic: true });
    assert.deepEqual(values(result, "Nested"), outer([15, 15]));
  }
});

test("original 3m close values are sampled rather than recalculated as a nested 15m request", async () => {
  const body = "inner=" + request("close", 3) + "\n" + plot("inner", "Inner") + "\n" + plot(request("inner", 15), "Outer");
  const inner = chartRemote(3);
  assert.deepEqual(sampleAtClose(inner), [24, 39]);
  for (const policy of policies) {
    const result = await run(body, policy);
    assert.deepEqual(values(result, "Inner"), inner);
    assert.deepEqual(values(result, "Outer"), outer([24, 39]));
  }
});

test("inner arithmetic remains in its original context and outer arithmetic uses target OHLC", async () => {
  const body = "inner=" + request("close+open", 3) + "\n" +
    plot(request("inner*2+(high-low)", 15), "Arithmetic");
  const inner = chartRemote(3, target => target.close + target.open);
  const sampled = sampleAtClose(inner);
  assert.deepEqual(sampled, [45, 75]);
  const expected = targets(bars, 15).map((target, i) => sampled[i] * 2 + target.high - target.low);
  assert.deepEqual(expected, [108, 168]);
  for (const policy of policies) assert.deepEqual(values(await run(body, policy), "Arithmetic"), outer(expected));
});

test("TA applied outside a frozen request uses outer history while inner TA retains original history", async () => {
  const innerBars = targets(bars, 3);
  const innerSma = merge(bars, innerBars, mean(innerBars.map(bar => bar.close), 2));
  const body = "inner=" + request("close", 3) + "\nsmooth=" + request("ta.sma(close,2)", 3) + "\n" +
    plot(request("ta.sma(inner,2)", 15), "Outer SMA") + "\n" + plot(request("smooth", 15), "Inner SMA");
  assert.deepEqual(sampleAtClose(innerSma), [22.5, 37.5]);
  for (const policy of policies) {
    const result = await run(body, policy);
    assert.deepEqual(values(result, "Outer SMA"), outer([null, 31.5]));
    assert.deepEqual(values(result, "Inner SMA"), outer([22.5, 37.5]));
  }
});

test("history inside a request differs from history applied to the sampled outer dependency", async () => {
  const body = "inner=" + request("close", 3) + "\nprevious=" + request("close[1]", 3) + "\n" +
    plot(request("previous", 15), "Inner previous") + "\n" + plot(request("inner[1]", 15), "Outer previous");
  for (const policy of policies) {
    const result = await run(body, policy);
    assert.deepEqual(values(result, "Inner previous"), outer([21, 36]));
    assert.deepEqual(values(result, "Outer previous"), outer([null, 24]));
  }
});

test("named request bags and typed function aliases preserve static dependency identity", async () => {
  const bodies = [
    'inner=request.security(expression=close,timeframe="3",symbol="CHART:TEST")\n' +
      'plot(request.security(expression=inner,timeframe="15",symbol="CHART:TEST"),"Outer")',
    'f()=>request.security("","",timeframe.period=="1"?1:15)\ninner=f()\nalias=inner+2\n' + plot(request("alias", 15), "Outer"),
    "f(float value)=>value*2\ninner=" + request("close", 3) + "\n" + plot(request("f(inner)", 15), "Outer"),
  ];
  for (const policy of policies) for (const [i, body] of bodies.entries())
    assert.deepEqual(values(await run(body, policy), "Outer"), outer([[24, 39], [3, 3], [48, 78]][i]), JSON.stringify(policy) + "/" + i);
});

test("static chains reuse each original requested series through more than one dependent call", async () => {
  const body = "first=" + request("close", 3) + "\nsecond=" + request("first", 5) + "\n" +
    plot("second", "Second") + "\n" + plot(request("second", 15), "Third");
  const first = chartRemote(3), five = targets(bars, 5);
  const second = merge(bars, five, sampleAtClose(first, 5));
  for (const policy of policies) {
    const result = await run(body, policy);
    assert.deepEqual(values(result, "Second"), second);
    assert.deepEqual(values(result, "Third"), outer([24, 39]));
  }
});

test("saved native input IDs and exact original source survive frozen request transport", async () => {
  const body = 'length=input.int(2,"Length",minval=1,maxval=8)\ninner=' + request("ta.sma(close,length)", 3) + "\n" +
    plot(request("inner", 15), "Saved");
  for (const policy of policies) {
    const prepared = await run(body, { ...policy, action: "prepare" });
    assert.deepEqual(prepared.inputDefinitions.map(item => [item.id, item.defval]), [["in_0", 2]]);
    for (const length of [2, 3]) {
      const inputs = JSON.parse(JSON.stringify({ in_0: length }));
      const result = await run(body, { ...policy, inputs });
      assert.deepEqual(result.inputs, inputs);
      assert.equal(result.source, source(body, policy.version, 'indicator("Static105"' + (policy.dynamic === "default" ? "" : ",dynamic_requests=false") + ")"));
      assert.deepEqual(values(result, "Saved"), outer(length === 2 ? [22.5, 37.5] : [21, 36]));
    }
  }
});

test("independent sibling requests coexist with static dependent expressions", async () => {
  const body = "inner=" + request("close", 3) + "\n" + plot(request("inner", 15), "Dependent") + "\n" +
    plot(request("close", 5), "Independent five") + "\n" + plot(request("close", 15), "Independent fifteen");
  for (const policy of policies) {
    const result = await run(body, policy);
    assert.deepEqual(values(result, "Dependent"), outer([24, 39]));
    assert.deepEqual(values(result, "Independent five"), chartRemote(5));
    assert.deepEqual(values(result, "Independent fifteen"), chartRemote(15));
  }
});

test("missing children omit incomplete targets and do not invent frozen-series history", async () => {
  const snapshot = bars.filter((_, i) => i !== 7);
  const body = "inner=" + request("close", 3) + "\n" + plot(request("inner", 15), "Outer");
  const inner = chartRemote(3, undefined, snapshot), higher = targets(snapshot, 15);
  assert.equal(higher.length, 1);
  const expected = merge(snapshot, higher, sampleAtClose(inner, 15, snapshot));
  for (const policy of policies) assert.deepEqual(values(await run(body, { ...policy, snapshot }), "Outer"), expected);
});

test("closed future snapshots preserve static historical sampling in either snapshot mode", async () => {
  const future = Math.ceil((Date.now() / 1000 + 86400) / 900) * 900;
  const snapshot = bars.map((bar, i) => ({ ...bar, time: future + i * 60 }));
  const body = "inner=" + request("close", 3) + "\n" + plot(request("inner", 15), "Outer");
  for (const version of [5, 6]) for (const mode of ["historical", "live"])
    assert.deepEqual(values(await run(body, { version, mode, snapshot }), "Outer"), outer([24, 39]));
});

test("static requested strategy quantity produces an independent fill ledger without source mutation", async () => {
  const body = "inner=" + request("close", 3) + "\nqty=" + request("inner", 15) +
    '\nif bar_index==14\n    strategy.entry("Frozen",strategy.long,qty=qty)\nif bar_index==24\n    strategy.close("Frozen")\nplot(qty,"Quantity")';
  for (const version of [5, 6]) {
    const declaration = 'strategy("Static105 quantity",dynamic_requests=false,initial_capital=100000)';
    const result = await run(body, { version, declaration });
    assert.equal(result.source, source(body, version, declaration));
    assert.deepEqual(values(result, "Quantity"), outer([24, 39]));
    assert.equal(result.strategy.closedTrades.length, 1);
    const trade = result.strategy.closedTrades[0];
    assert.equal(trade.size, 24); assert.equal(trade.entry_bar_index, 15); assert.equal(trade.exit_bar_index, 25);
    assert.equal(trade.entry_price, 24); assert.equal(trade.exit_price, 34); assert.equal(trade.profit, 240);
  }
});

test("lookahead and gaps change publication timing without changing the frozen closing sample", async () => {
  const body = "inner=" + request("close", 3) + "\n" +
    plot(request("inner", 15, ",lookahead=barmerge.lookahead_on"), "On") + "\n" +
    plot(request("inner", 15, ",gaps=barmerge.gaps_on"), "Off events") + "\n" +
    plot(request("inner", 15, ",lookahead=barmerge.lookahead_on,gaps=barmerge.gaps_on"), "On events");
  for (const policy of policies) {
    const result = await run(body, policy);
    assert.deepEqual(values(result, "On"), outer([24, 39], { on: true }));
    assert.deepEqual(values(result, "Off events"), outer([24, 39], { gaps: true }));
    assert.deepEqual(values(result, "On events"), outer([24, 39], { on: true, gaps: true }));
  }
});

test("tuple transport and repeated function invocations preserve separate captured request series", async () => {
  const tuple = "inner=" + request("[close,close[1]]", 3) +
    "\n[first,second]=" + request("inner", 15) + '\nplot(first,"First")\nplot(second,"Second")';
  const repeated = 'f(int amount)=>request.security("CHART:TEST","3",close+amount)\nfirst=f(1)\nsecond=f(9)\n' +
    plot(request("first", 15), "First") + "\n" + plot(request("second", 15), "Second");
  for (const policy of policies) {
    const tuples = await run(tuple, policy);
    assert.deepEqual(values(tuples, "First"), outer([24, 39]));
    assert.deepEqual(values(tuples, "Second"), outer([21, 36]));
    const calls = await run(repeated, policy);
    assert.deepEqual(values(calls, "First"), outer([25, 40]));
    assert.deepEqual(values(calls, "Second"), outer([33, 48]));
  }
});

test("captured tuple nodes count toward the bounded requested-series budget", async () => {
  const names = Array.from({ length: 64 }, (_, i) => "v" + i);
  const body = "[" + names.join(",") + "]=" + request("[" + names.map(() => "close").join(",") + "]", 3) +
    "\n" + plot(request(names[0], 15), "Bounded");
  const small = await run(body);
  assert.deepEqual(values(small, "Bounded"), outer([24, 39]));
  const snapshot = Array.from({ length: 20_000 }, (_, i) => ({ time: start + i * 60,
    open: 9 + i, high: 12 + i, low: 8 + i, close: 10 + i, volume: 100 + i }));
  await assert.rejects(run(body, { snapshot }), cause => {
    assert.equal(cause.code, "REQUEST_LIMIT", cause.message);
    assert.match(cause.message, /history|series|requested/i);
    return true;
  });
});
