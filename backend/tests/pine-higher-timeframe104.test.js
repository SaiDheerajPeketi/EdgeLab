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
    resolveDir: root, sourcefile: "pine-higher-timeframe104.ts", loader: "ts" },
})).outputFiles[0].text;
console.info("HIGHER104_BINDING " + JSON.stringify({ minify: true, sealed: true,
  bundleSha256: createHash("sha256").update(bundle).digest("hex"),
  manifestSha256: createHash("sha256").update(fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json", import.meta.url))).digest("hex") }));
const pine = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const startTime = 1_700_000_100; // Exactly divisible by 15 minutes.
assert.equal(startTime % 900, 0);
const candle = (index, start = startTime) => ({ time: start + index * 60, open: 9 + index,
  high: 12 + index, low: 8 + index, close: 10 + index, volume: 100 + index });
const bars = Array.from({ length: 45 }, (_, index) => candle(index));
const context = { symbol: "CHART:TEST", timeframe: "1", mintick: .01, pointvalue: 1 };
const source = (body, version = 6, declaration = 'indicator("Higher104")') =>
  "//@version=" + version + "\n" + declaration + "\n" + body;
const run = (body, { version = 6, snapshot = bars, inputs = {}, mode = "historical", declaration, action = "run" } = {}) =>
  pine.executePineRequest({ id: "higher104", action, source: source(body, version, declaration), inputs, mode,
    ...(action === "run" ? { bars: snapshot, context } : {}) });
const values = (result, name) => result.plots.find(plot => plot.name === name).points.map(point => point.value);
const failUnavailable = cause => { assert.equal(cause.code, "UNAVAILABLE_DATA", cause.message); return true; };

// This oracle owns grouping and event timing; no engine output or host helper is used.
function complete(snapshot, minutes) {
  const buckets = new Map(), width = minutes * 60;
  for (const bar of snapshot) {
    const begin = Math.floor(bar.time / width) * width;
    if (!buckets.has(begin)) buckets.set(begin, []);
    buckets.get(begin).push(bar);
  }
  return [...buckets].sort((a, b) => a[0] - b[0]).flatMap(([time, children]) => {
    const sorted = [...children].sort((a, b) => a.time - b.time);
    if (sorted.length !== minutes || sorted.some((bar, index) => bar.time !== time + index * 60)) return [];
    return [{ time, end: time + width, open: sorted[0].open,
      high: Math.max(...sorted.map(bar => bar.high)), low: Math.min(...sorted.map(bar => bar.low)),
      close: sorted.at(-1).close, volume: sorted.reduce((sum, bar) => sum + bar.volume, 0) }];
  });
}
const average = (targets, index, length) => index < length - 1 ? null :
  targets.slice(index - length + 1, index + 1).reduce((sum, target) => sum + target.close, 0) / length;
function merge(snapshot, targets, expression, { on = false, gaps = false } = {}) {
  return snapshot.map(bar => {
    let chosen = -1;
    for (let index = 0; index < targets.length; index++) {
      const eligible = on ? targets[index].time <= bar.time : targets[index].end <= bar.time + 60;
      if (eligible) chosen = index;
    }
    if (chosen < 0) return null;
    const target = targets[chosen];
    if (gaps && (on ? bar.time !== target.time : !(bar.time < target.end && target.end <= bar.time + 60))) return null;
    return expression(target, chosen, targets);
  });
}
function remote(expression, minutes, { on = false, gaps = false, count } = {}) {
  return 'request.security("CHART:TEST","' + minutes + '",' + expression +
    ',gaps=barmerge.gaps_' + (gaps ? "on" : "off") +
    ',lookahead=barmerge.lookahead_' + (on ? "on" : "off") +
    (count === undefined ? "" : ",calc_bars_count=" + count) + ")";
}
const plot = (expression, name) => "plot(" + expression + ',"' + name + '")';

test("complete 3/5/15-minute candles evaluate independent remote OHLCV instead of aggregating chart expressions", async () => {
  for (const version of [5, 6]) for (const minutes of [3, 5, 15]) {
    const targets = complete(bars, minutes);
    const body = ["open", "high", "low", "close", "volume"].map(field => plot(remote(field, minutes), field)).join("\n") +
      "\n" + plot(remote("high-low", minutes), "Range");
    const result = await run(body, { version });
    for (const field of ["open", "high", "low", "close", "volume"])
      assert.deepEqual(values(result, field), merge(bars, targets, target => target[field]), version + "/" + minutes + "/" + field);
    assert.deepEqual(values(result, "Range"), merge(bars, targets, target => target.high - target.low));
    assert.ok(targets[0].high - targets[0].low > bars[0].high - bars[0].low);
  }
  for (const version of [5, 6]) {
    const body = [3, 5, 15].map(minutes => plot(remote("close", minutes), "Mixed" + minutes)).join("\n");
    const result = await run(body, { version });
    for (const minutes of [3, 5, 15])
      assert.deepEqual(values(result, "Mixed" + minutes), merge(bars, complete(bars, minutes), target => target.close));
  }
});

test("SMA is evaluated on remote closes with preserved saved input length and original source", async () => {
  for (const version of [5, 6]) {
    const minutes = 3, targets = complete(bars, minutes);
    const body = 'length=input.int(2,"Remote length",minval=1,maxval=10)\n' +
      plot(remote("ta.sma(close,length)", minutes), "Remote SMA") + "\nplot(ta.sma(close,length),\"Chart SMA\")";
    const prepared = await run(body, { version, action: "prepare" });
    assert.deepEqual(prepared.inputDefinitions.map(item => [item.id, item.defval]), [["in_0", 2]]);
    for (const length of [2, 3]) {
      const inputs = JSON.parse(JSON.stringify({ in_0: length }));
      const result = await run(body, { version, inputs });
      assert.equal(result.source, source(body, version)); assert.deepEqual(result.inputs, inputs);
      assert.deepEqual(values(result, "Remote SMA"), merge(bars, targets, (_, index) => average(targets, index, length)));
      const chart = bars.map((_, index) => index < length - 1 ? null :
        bars.slice(index - length + 1, index + 1).reduce((sum, bar) => sum + bar.close, 0) / length);
      assert.deepEqual(values(result, "Chart SMA"), chart);
      assert.notEqual(values(result, "Remote SMA")[8], values(result, "Chart SMA")[8]);
    }
  }
});

test("lookahead off publishes target closes at the last child and on at the first child", async () => {
  for (const version of [5, 6]) for (const minutes of [3, 5, 15]) {
    const targets = complete(bars, minutes);
    const body = plot(remote("close", minutes), "Off") + "\n" + plot(remote("close", minutes, { on: true }), "On") +
      "\n" + plot(remote("close[1]", minutes, { on: true }), "Previous");
    const result = await run(body, { version });
    assert.deepEqual(values(result, "Off"), merge(bars, targets, target => target.close));
    assert.deepEqual(values(result, "On"), merge(bars, targets, target => target.close, { on: true }));
    assert.deepEqual(values(result, "Previous"), merge(bars, targets, (_, index) => targets[index - 1]?.close ?? null, { on: true }));
    assert.equal(values(result, "Off")[minutes - 2], null);
    assert.equal(values(result, "Off")[minutes - 1], targets[0].close);
    assert.equal(values(result, "On")[0], targets[0].close);
  }
});

test("gaps on emits only opening or closing events while gaps off carries the confirmed value", async () => {
  for (const version of [5, 6]) {
    const targets = complete(bars, 5);
    const body = [false, true].flatMap(on => [false, true].map(gaps =>
      plot(remote("close", 5, { on, gaps }), (on ? "On" : "Off") + (gaps ? "Gapped" : "Carry")))).join("\n");
    const result = await run(body, { version });
    for (const on of [false, true]) for (const gaps of [false, true]) {
      const actual = values(result, (on ? "On" : "Off") + (gaps ? "Gapped" : "Carry"));
      assert.deepEqual(actual, merge(bars, targets, target => target.close, { on, gaps }));
      if (gaps) assert.equal(actual.filter(value => value !== null).length, targets.length);
    }
  }
});

test("remote tuple times period and qualified symbol belong to the target context", async () => {
  for (const version of [5, 6]) {
    const targets = complete(bars, 3);
    const expression = "[open,close,volume,time,time_close,timeframe.period,syminfo.tickerid]";
    const body = "[remoteOpen,remoteClose,remoteVolume,remoteTime,remoteEnd,remotePeriod,remoteSymbol]=" + remote(expression, 3) +
      '\nplot(remoteOpen,"Open")\nplot(remoteClose,"Close")\nplot(remoteVolume,"Volume")\nplot(remoteTime,"Time")\nplot(remoteEnd,"End")\nplot(na(remoteTime)?na:remotePeriod=="3"?1:0,"Period")\nplot(na(remoteTime)?na:remoteSymbol=="CHART:TEST"?1:0,"Symbol")';
    const result = await run(body, { version });
    for (const [name, field] of [["Open", "open"], ["Close", "close"], ["Volume", "volume"]])
      assert.deepEqual(values(result, name), merge(bars, targets, target => target[field]));
    assert.deepEqual(values(result, "Time"), merge(bars, targets, target => target.time * 1000));
    assert.deepEqual(values(result, "End"), merge(bars, targets, target => target.end * 1000));
    for (const name of ["Period", "Symbol"]) assert.deepEqual(values(result, name), merge(bars, targets, () => 1));
  }
});

test("partial first/final buckets and missing children never invent higher candles or reset carried values", async () => {
  const scenarios = [bars.slice(1, 44), bars.filter((_, index) => index !== 7), bars.slice(0, 2)];
  for (const version of [5, 6]) for (const snapshot of scenarios) {
    const targets = complete(snapshot, 3);
    const body = [false, true].flatMap(on => [false, true].map(gaps =>
      plot(remote("close", 3, { on, gaps }), (on ? "On" : "Off") + (gaps ? "Gapped" : "Carry")))).join("\n");
    const result = await run(body, { version, snapshot });
    for (const on of [false, true]) for (const gaps of [false, true])
      assert.deepEqual(values(result, (on ? "On" : "Off") + (gaps ? "Gapped" : "Carry")),
        merge(snapshot, targets, target => target.close, { on, gaps }));
  }
});

test("calc bars count bounds available remote history and its SMA warmup", async () => {
  for (const version of [5, 6]) {
    const targets = complete(bars, 3).slice(-3);
    const body = plot(remote("close", 3, { count: 3 }), "Close") + "\n" +
      plot(remote("ta.sma(close,2)", 3, { count: 3 }), "SMA") + "\n" +
      plot(remote("close[1]", 3, { count: 3, on: true }), "Previous");
    const result = await run(body, { version });
    assert.deepEqual(values(result, "Close"), merge(bars, targets, target => target.close));
    assert.deepEqual(values(result, "SMA"), merge(bars, targets, (_, index) => average(targets, index, 2)));
    assert.deepEqual(values(result, "Previous"), merge(bars, targets, (_, index) => targets[index - 1]?.close ?? null, { on: true }));
  }
});

test("closed future snapshots have identical merge semantics in historical and live snapshot modes", async () => {
  const futureStart = Math.ceil((Date.now() / 1000 + 86400) / 900) * 900;
  const snapshot = Array.from({ length: 44 }, (_, index) => candle(index, futureStart));
  const targets = complete(snapshot, 3);
  const body = plot(remote("close", 3), "Off") + "\n" + plot(remote("close", 3, { gaps: true }), "Gapped");
  for (const version of [5, 6]) for (const mode of ["historical", "live"]) {
    const result = await run(body, { version, mode, snapshot });
    assert.deepEqual(values(result, "Off"), merge(snapshot, targets, target => target.close));
    assert.deepEqual(values(result, "Gapped"), merge(snapshot, targets, target => target.close, { gaps: true }));
  }
});

test("higher context strategy quantities preserve actual source and independently expected fill ledger", async () => {
  for (const version of [5, 6]) {
    const body = 'requested=' + remote("close", 3) +
      '\nif bar_index==2\n    strategy.entry("Remote qty",strategy.long,qty=requested)\nif bar_index==8\n    strategy.close("Remote qty")\nplot(requested,"Remote")';
    const declaration = 'strategy("Higher quantity",initial_capital=100000)';
    const result = await run(body, { version, declaration });
    assert.equal(result.source, source(body, version, declaration));
    assert.deepEqual(values(result, "Remote"), merge(bars, complete(bars, 3), target => target.close));
    assert.equal(result.strategy.closedTrades.length, 1);
    const trade = result.strategy.closedTrades[0];
    assert.equal(trade.size, 12);
    assert.equal(trade.entry_bar_index, 3); assert.equal(trade.exit_bar_index, 9);
    assert.equal(trade.entry_time, bars[3].time); assert.equal(trade.exit_time, bars[9].time);
    assert.equal(trade.entry_price, 12); assert.equal(trade.exit_price, 18); assert.equal(trade.profit, 72);
  }
});

test("derived higher data never expands exchange session or chart-type identity authority", async () => {
  for (const version of [5, 6]) for (const symbol of ['"OTHER:TEST"', '"TEST"',
    'ticker.new("CHART","TEST",session.extended)', 'ticker.heikinashi(syminfo.tickerid)',
    'ticker.renko(syminfo.tickerid,"ATR",10)']) {
    const body = plot('request.security(' + symbol + ',"3",close)', "Foreign");
    await assert.rejects(run(body, { version }), failUnavailable);
  }
});

test("persistent live higher requests reject until secondary rollback is supported", async () => {
  for (const version of [5, 6]) {
    const executor = pine.createPineLiveExecutor(), sessionId = "higher-context104-" + version;
    try {
      await assert.rejects(executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 0, action: "start",
        request: { id: sessionId + ":0", action: "run", source: source(plot(remote("close", 3), "Remote"), version),
          bars, context, inputs: {}, mode: "live" } }), failUnavailable);
    } finally { executor.dispose(); }
  }
});

test("nested higher requests and blank aliases use their executing context while named arguments retain merge semantics", async () => {
  for (const version of [5, 6]) {
    const outer = remote('request.security("CHART:TEST","15",close)', 3);
    const blank = remote('request.security("","",close)', 3);
    const named = 'request.security(expression=ta.sma(close,2),timeframe="3",symbol="CHART:TEST",gaps=barmerge.gaps_on,lookahead=barmerge.lookahead_on)';
    const body = plot(outer, "Nested") + "\n" + plot(blank, "Executing blank") + "\n" + plot(named, "Named");
    const result = await run(body, { version, declaration: 'indicator("Nested higher104",dynamic_requests=true)' });
    assert.deepEqual(values(result, "Nested"), merge(bars, complete(bars, 15), target => target.close));
    const targets = complete(bars, 3);
    assert.deepEqual(values(result, "Executing blank"), merge(bars, targets, target => target.close));
    assert.deepEqual(values(result, "Named"), merge(bars, targets, (_, index) => average(targets, index, 2), { on: true, gaps: true }));
  }
});

test("dynamic nested dataflow stays remote while static dependencies preserve the original chart", async () => {
  const direct = 'inner=request.security("","",timeframe.period=="1"?1:15)\n' +
    plot(remote("inner", 15), "Nested value");
  const delegated = 'f()=>request.security("","",timeframe.period=="1"?1:15)\ninner=f()\n' +
    plot(remote("inner", 15), "Nested value");
  for (const body of [direct, delegated]) {
  for (const version of [5, 6]) {
    const dynamic = await run(body, { version, declaration: 'indicator("Dynamic higher104",dynamic_requests=true)' });
    assert.deepEqual(values(dynamic, "Nested value"), merge(bars, complete(bars, 15), () => 15));
    const fixed = await run(body, { version, declaration: 'indicator("Static higher104",dynamic_requests=false)' });
    assert.deepEqual(values(fixed, "Nested value"), merge(bars, complete(bars, 15), () => 1));
  }
  const defaultV5 = await run(body, { version: 5 });
  assert.deepEqual(values(defaultV5, "Nested value"), merge(bars, complete(bars, 15), () => 1));
  const defaultV6 = await run(body, { version: 6 });
  assert.deepEqual(values(defaultV6, "Nested value"), merge(bars, complete(bars, 15), () => 15));
  }
});

test("nested and distinct-callsite higher contexts stop at bounded request quotas", async () => {
  const many = count => Array.from({ length: count }, (_, index) =>
    "remote" + index + "=" + remote("close", 3)).join("\n") + "\nplot(remote" + (count - 1) + ',"Last")';
  const declaration = 'indicator("Bounded higher104",dynamic_requests=true)';
  const accepted = await run(many(8), { declaration });
  assert.deepEqual(values(accepted, "Last"), merge(bars, complete(bars, 3), target => target.close));
  const limited = cause => {
    assert.equal(cause.code, "REQUEST_LIMIT", cause.message);
    assert.match(cause.message, /request|depth|context|limit|bound/i);
    return true;
  };
  await assert.rejects(run(many(65), { declaration }), limited);
  let expression = "close";
  for (const minutes of [2, 3, 4, 5, 6, 8, 9, 10, 12].reverse()) expression = remote(expression, minutes);
  await assert.rejects(run(plot(expression, "Nested"), {
    declaration, snapshot: Array.from({ length: 60 }, (_, index) => candle(index)),
  }), limited);
});
