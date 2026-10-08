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
    resolveDir: root, sourcefile: "pine-static-requests106.ts", loader: "ts" },
})).outputFiles[0].text;
console.info("STATIC106_BINDING " + JSON.stringify({ minify: true, sealed: true,
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
  id: "static106", action, source: source(body, version, declaration ??
    ('indicator("Static106"' + (dynamic === "default" ? "" : ",dynamic_requests=" + dynamic) + ")")),
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


test("nested no-argument wrappers reuse original static inputs at each distinct root path", async () => {
  const body = 'amount=input.int(2,"Amount")\nf()=>request.security("CHART:TEST","3",close+amount)\ng()=>f()\n' +
    'first=g()\nsecond=g()\n' + plot(request("first", 15), "First") + "\n" + plot(request("second", 15), "Second");
  for (const policy of policies) {
    const result = await run(body, policy);
    assert.deepEqual(values(result, "First"), outer([26, 41]));
    assert.deepEqual(values(result, "Second"), outer([26, 41]));
  }
});

test("nested typed arguments keep two written call paths separate", async () => {
  const body = 'f(int amount)=>request.security("CHART:TEST","3",close+amount)\ng(int amount)=>f(amount)\n' +
    'first=g(1)\nsecond=g(9)\n' + plot(request("first", 15), "First") + "\n" + plot(request("second", 15), "Second");
  for (const policy of policies) {
    const result = await run(body, policy);
    assert.deepEqual(values(result, "First"), outer([25, 40]));
    assert.deepEqual(values(result, "Second"), outer([33, 48]));
  }
});

test("more than two wrappers retain full argument and call identity", async () => {
  const body = 'f(int amount)=>request.security("CHART:TEST","3",close+amount)\ng(int value)=>f(value+2)\n' +
    'h(int value)=>g(value*2)\nk(int value)=>h(value+3)\nfirst=k(1)\nsecond=k(9)\n' +
    plot(request("first", 15), "First") + "\n" + plot(request("second", 15), "Second");
  for (const policy of policies) {
    const result = await run(body, policy);
    assert.deepEqual(values(result, "First"), outer([34, 49]));
    assert.deepEqual(values(result, "Second"), outer([50, 65]));
  }
});

test("static nested wrappers keep chart context while dynamic wrappers execute in the outer context", async () => {
  const body = 'f(int amount)=>request.security("","",(timeframe.period=="1"?1:15)+amount)\ng(int amount)=>f(amount)\n' +
    'first=g(1)\nsecond=g(9)\n' + plot(request("first", 15), "First") + "\n" + plot(request("second", 15), "Second");
  for (const policy of policies) {
    const result = await run(body, policy);
    assert.deepEqual(values(result, "First"), outer([2, 2]));
    assert.deepEqual(values(result, "Second"), outer([10, 10]));
  }
  for (const version of [5, 6]) {
    const result = await run(body, { version, dynamic: true });
    assert.deepEqual(values(result, "First"), outer([16, 16]));
    assert.deepEqual(values(result, "Second"), outer([24, 24]));
  }
});

test("native saved input IDs and unmodified source survive the nested function bridge", async () => {
  const body = 'amount=input.int(2,"Amount",minval=0,maxval=20)\nf()=>request.security("CHART:TEST","3",close+amount)\n' +
    'g()=>f()\nh()=>g()\nanswer=h()\n' + plot(request("answer", 15), "Saved");
  for (const policy of policies) {
    const prepared = await run(body, { ...policy, action: "prepare" });
    assert.deepEqual(prepared.inputDefinitions.map(input => [input.id, input.defval]), [["in_0", 2]]);
    for (const amount of [2, 7]) {
      const inputs = JSON.parse(JSON.stringify({ in_0: amount }));
      const result = await run(body, { ...policy, inputs });
      assert.deepEqual(result.inputs, inputs);
      assert.equal(result.source, source(body, policy.version, 'indicator("Static106"' + (policy.dynamic === "default" ? "" : ",dynamic_requests=false") + ")"));
      assert.deepEqual(values(result, "Saved"), outer([24 + amount, 39 + amount]));
    }
  }
});

test("named request arguments inside a nested wrapper preserve caller argument values", async () => {
  const body = 'f(int amount)=>request.security(expression=close+amount,symbol="CHART:TEST",timeframe="3")\n' +
    'g(int amount)=>f(amount=amount)\nfirst=g(amount=1)\nsecond=g(amount=9)\n' +
    'plot(request.security(expression=first,timeframe="15",symbol="CHART:TEST"),"First")\n' +
    'plot(request.security(expression=second,timeframe="15",symbol="CHART:TEST"),"Second")';
  for (const policy of policies) {
    const result = await run(body, policy);
    assert.deepEqual(values(result, "First"), outer([25, 40]));
    assert.deepEqual(values(result, "Second"), outer([33, 48]));
  }
});

test("nested tuple returns preserve each requested element and its original history", async () => {
  const body = 'f()=>request.security("CHART:TEST","3",[close,close[1]])\ng()=>f()\n[first,previous]=g()\n' +
    '[outerFirst,outerPrevious]=' + request("[first,previous]", 15) +
    '\nplot(outerFirst,"First")\nplot(outerPrevious,"Previous")';
  for (const policy of policies) {
    const result = await run(body, policy);
    assert.deepEqual(values(result, "First"), outer([24, 39]));
    assert.deepEqual(values(result, "Previous"), outer([21, 36]));
  }
});

test("history in remote expressions and history outside the frozen dependency remain distinct", async () => {
  const body = 'previous(float value)=>value[1]\nf()=>request.security("CHART:TEST","3",previous(close))\n' +
    'g()=>f()\ninner=g()\n' + plot(request("inner", 15), "Inner previous") + "\n" +
    plot(request("inner[1]", 15), "Outer previous");
  for (const policy of policies) {
    const result = await run(body, policy);
    assert.deepEqual(values(result, "Inner previous"), outer([21, 36]));
    assert.deepEqual(values(result, "Outer previous"), outer([null, 21]));
  }
});

test("independently written remote calls retain separate persistent function locals", async () => {
  const body = 'sum(int step)=>\n    var float total=0.0\n    total+=step\n    total\n' +
    'f(int step)=>request.security("CHART:TEST","3",close+sum(step))\ng(int step)=>f(step)\n' +
    'first=g(1)\nsecond=g(2)\n' + plot(request("first", 15), "First") + "\n" + plot(request("second", 15), "Second");
  for (const policy of policies) {
    const result = await run(body, policy);
    assert.deepEqual(values(result, "First"), outer([29, 49]));
    assert.deepEqual(values(result, "Second"), outer([34, 59]));
  }
});

test("an awaited request before a nested call does not lose the enclosing root call identity", async () => {
  const body = 'f(int amount)=>request.security("CHART:TEST","3",close+amount)\ng(int amount)=>\n' +
    '    prefix=request.security("","",close)\n    f(amount)+prefix\nfirst=g(1)\nsecond=g(9)\n' +
    plot(request("first", 15), "First") + "\n" + plot(request("second", 15), "Second");
  for (const policy of policies) {
    const result = await run(body, policy);
    assert.deepEqual(values(result, "First"), outer([49, 79]));
    assert.deepEqual(values(result, "Second"), outer([57, 87]));
  }
});

test("async wrappers preserve separate stateful call ledgers after an awaited request", async () => {
  const body = 'counter(int step)=>\n    var float total=0.0\n    total+=step\n    total\n' +
    'g(int step)=>\n    prefix=request.security("","",close)\n    counter(step)+prefix\n' +
    'first=g(1)\nsecond=g(9)\nplot(first,"First")\nplot(second,"Second")';
  for (const policy of policies) {
    const result = await run(body, policy);
    assert.deepEqual(values(result, "First"), bars.map((bar, i) => bar.close + i + 1));
    assert.deepEqual(values(result, "Second"), bars.map((bar, i) => bar.close + (i + 1) * 9));
  }
});

test("nested requested strategy quantities produce the independently expected fill ledger", async () => {
  const body = 'f()=>request.security("CHART:TEST","3",close+2)\ng()=>f()\ninner=g()\nqty=' + request("inner", 15) +
    '\nif bar_index==14\n    strategy.entry("Nested",strategy.long,qty=qty)\nif bar_index==24\n    strategy.close("Nested")\nplot(qty,"Quantity")';
  for (const version of [5, 6]) {
    const declaration = 'strategy("Nested106",dynamic_requests=false,initial_capital=100000)';
    const result = await run(body, { version, declaration });
    assert.equal(result.source, source(body, version, declaration));
    assert.deepEqual(values(result, "Quantity"), outer([26, 41]));
    assert.equal(result.strategy.closedTrades.length, 1);
    const trade = result.strategy.closedTrades[0];
    assert.equal(trade.size, 26); assert.equal(trade.entry_bar_index, 15); assert.equal(trade.exit_bar_index, 25);
    assert.equal(trade.entry_price, 24); assert.equal(trade.exit_price, 34); assert.equal(trade.profit, 260);
  }
});

test("nested function requests retain full symbol authority and a rejected job cannot affect the next run", async () => {
  for (const version of [5, 6]) {
    const body = 'f()=>request.security("OTHER:TEST","3",close)\ng()=>\n    prefix=request.security("","",close)\n    f()+prefix\n' +
      'inner=g()\n' + plot(request("inner", 15), "Foreign");
    await assert.rejects(run(body, { version }), cause => { assert.equal(cause.code, "UNAVAILABLE_DATA", cause.message); return true; });
    const followUp = await run('plot(close,"Ordinary")', { version });
    assert.deepEqual(values(followUp, "Ordinary"), bars.map(bar => bar.close));
  }
});

test("nested wrapper captures obey the requested scalar and tuple history budget", async () => {
  const names = Array.from({ length: 64 }, (_, i) => "v" + i);
  const body = 'f()=>request.security("CHART:TEST","3",[' + names.map(() => "close").join(",") + '])\ng()=>f()\n' +
    "[" + names.join(",") + "]=g()\n" + plot(request(names[0], 15), "Bounded");
  const small = await run(body);
  assert.deepEqual(values(small, "Bounded"), outer([24, 39]));
  const snapshot = Array.from({ length: 20_000 }, (_, i) => ({ time: start + i * 60,
    open: 9 + i, high: 12 + i, low: 8 + i, close: 10 + i, volume: 100 + i }));
  await assert.rejects(run(body, { snapshot }), cause => { assert.equal(cause.code, "REQUEST_LIMIT", cause.message); return true; });
});

// These scripts are valid stateful Pine. Refusal is a host replay-isolation limit,
// never a claim that mutable arrays, object fields, or global history are invalid.
async function refusesUnsafeReplay(body, expectedB, expectedPool) {
  for (const version of [5, 6]) {
    const original = await run(body, { version });
    assert.deepEqual(values(original, "B"), expectedB);
    if (expectedPool) assert.deepEqual(values(original, "Pool"), expectedPool);
    const requestedBody = body + "\n" + plot(request("b", 15), "Unsafe replay");
    await assert.rejects(run(requestedBody, { version }), cause => {
      assert.equal(cause.code, "UNSUPPORTED_REQUEST_EXPRESSION", cause.message);
      return true;
    });
  }
}

test("shared array aliases cannot silently substitute a truncated replay for original state", async () => {
  const body = 'var pool=array.new<float>()\nalias=pool\nf()=>\n    prefix=request.security("","",close)\n' +
    '    previous=array.size(alias)\n    array.push(alias,prefix)\n    previous\ng()=>f()\na=g()\nb=g()\n' +
    'plot(b,"B")\nplot(array.size(pool),"Pool")';
  await refusesUnsafeReplay(body, bars.map((_, i) => i * 2 + 1), bars.map((_, i) => (i + 1) * 2));
});

test("global collection mutation through a called function remains an explicit replay limitation", async () => {
  const body = 'var pool=array.new<float>()\ntouch(float value)=>array.push(pool,value)\nf()=>\n' +
    '    prefix=request.security("","",close)\n    previous=array.size(pool)\n    touch(prefix)\n    previous\n' +
    'g()=>f()\na=g()\nb=g()\nplot(b,"B")\nplot(array.size(pool),"Pool")';
  await refusesUnsafeReplay(body, bars.map((_, i) => i * 2 + 1), bars.map((_, i) => (i + 1) * 2));
});

test("mutable global UDT fields cannot be replaced with an isolated zero-state replay", async () => {
  const body = 'type Counter\n    int count=0\nvar Counter state=Counter.new()\nf()=>\n' +
    '    prefix=request.security("","",close)\n    previous=state.count\n    state.count+=1\n    previous\n' +
    'g()=>f()\na=g()\nb=g()\nplot(b,"B")\nplot(state.count,"Pool")';
  await refusesUnsafeReplay(body, bars.map((_, i) => i * 2 + 1), bars.map((_, i) => (i + 1) * 2));
});

test("a legal reassigned global primitive is refused when its replay history cannot be isolated", async () => {
  const body = 'var int total=0\ntotal+=1\nf()=>\n    prefix=request.security("","",close)\n' +
    '    prefix+total\ng()=>f()\na=g()\nb=g()\nplot(b,"B")';
  await refusesUnsafeReplay(body, bars.map((bar, i) => bar.close + i + 1));
});

test("bounded nested wrapper paths accept depth eight and refuse an unavailable ninth-level slice", async () => {
  const script = (depth) => {
    const functions = ['f0()=>request.security("CHART:TEST","3",close)'];
    for (let i = 1; i < depth; i++) functions.push("f" + i + "()=>f" + (i - 1) + "()");
    return functions.join("\n") + "\nanswer=f" + (depth - 1) + "()\n" + plot(request("answer", 15), "Depth");
  };
  for (const version of [5, 6]) {
    assert.deepEqual(values(await run(script(8), { version }), "Depth"), outer([24, 39]));
    await assert.rejects(run(script(9), { version }), cause => {
      assert.equal(cause.code, "UNSUPPORTED_REQUEST_EXPRESSION", cause.message);
      return true;
    });
  }
});
