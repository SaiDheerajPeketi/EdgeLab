import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser",
  target: "es2020", write: false, logLevel: "silent", plugins: [createPineEnginePlugin()],
  stdin: { contents: 'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineLiveProtocol.ts"; export * from "./frontend/src/lib/pineProtocol.ts"; export * from "./frontend/src/lib/pineLiveFeed.ts";',
    resolveDir: process.cwd(), sourcefile: "pine-live-requests143.ts", loader: "ts" },
})).outputFiles[0].text;
console.info("LIVE_REQUEST143_BINDING " + JSON.stringify({ minify: true, sealed: true,
  bundleSha256: createHash("sha256").update(bundle).digest("hex"),
  manifestSha256: createHash("sha256").update(fs.readFileSync("frontend/vendor/pinets/manifest.json")).digest("hex") }));
const pine = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const origin = 1_700_001_000;
assert.equal(origin % 900, 0);
assert.equal(origin % 360, 0);
const minute = (index, close = 100 + index) => ({ time: origin + index * 60,
  open: 100 + index - .5, high: Math.max(100 + index - .5, close) + 2,
  low: Math.min(100 + index - .5, close) - 3, close, volume: index + 1 });
const history = Array.from({ length: 30 }, (_, i) => minute(i));
// This oracle groups the authored M1 input directly, without importing product aggregators.
function aggregate(minutes, width = 5) {
  const groups = new Map();
  for (const bar of minutes) {
    const time = Math.floor(bar.time / (width * 60)) * width * 60;
    const group = groups.get(time) ?? []; group.push(bar); groups.set(time, group);
  }
  return [...groups].map(([time, group]) => ({ time, open: group[0].open,
    high: Math.max(...group.map(bar => bar.high)), low: Math.min(...group.map(bar => bar.low)),
    close: group.at(-1).close, volume: group.reduce((sum, bar) => sum + bar.volume, 0) }));
}
const context = { symbol: "CHART:TEST", timeframe: "5", mintick: .01, pointvalue: 1 };
const body = `var int ordinary=0
varip int ticks=0
ordinary+=1
ticks+=1
plot(ordinary,"Ordinary")
plot(ticks,"Ticks")
intrabar=request.security_lower_tf(syminfo.tickerid,"1",close)
plot(array.size(intrabar),"Count")
plot(array.sum(intrabar),"Sum")
plot(request.security(syminfo.tickerid,"1",close,lookahead=barmerge.lookahead_on),"First")
plot(request.security(syminfo.tickerid,"1",close),"Last")
plot(request.security(syminfo.tickerid,"15",close),"Developing")
plot(request.security(syminfo.tickerid,"15",close,gaps=barmerge.gaps_on),"Confirmed HTF")
plot(request.security(syminfo.tickerid,"15",ta.sma(close,2)),"Remote SMA")
read(int amount)=>request.security(syminfo.tickerid,"15",close+amount)
plot(read(1),"Identity1")
plot(read(9),"Identity9")
plot(barstate.ishistory,"Historical")`;
const script = (version, text = body) => `//@version=${version}\nindicator("Live request143",overlay=true,dynamic_requests=true)\n${text}`;
const values = (result, name) => result.plots.find(plot => plot.name === name).points.map(point => point.value);
const tail = (result, name) => values(result, name).at(-1);
let ordinal = 0;
function initial(version, text = body, snapshot = history) {
  const sessionId = "live-request143-" + ++ordinal;
  return { protocol: "pine-live-v1", sessionId, sequence: 0, action: "start", request: {
    id: sessionId + ":0", action: "run", source: script(version, text), inputs: {}, mode: "live", context,
    bars: aggregate(snapshot), sourceSnapshot: { timeframe: "1", bars: snapshot } } };
}
function command(start, sequence, sources, confirmed = false) {
  const source = sources.at(-1);
  const chart = aggregate(sources).at(-1);
  return { protocol: "pine-live-v1", sessionId: start.sessionId, sequence, action: "update", bar: chart,
    confirmed: confirmed && (source.time + 60) % 300 === 0, source: { bar: source, confirmed } };
}
const fails = code => cause => { assert.equal(cause.code, code, cause.message); return true; };

test("v5/v6 closed M1 warmup retains historical lower intrabars and HTF merge semantics", async () => {
  for (const version of [5, 6]) {
    const executor = pine.createPineLiveExecutor();
    try {
      const start = initial(version), result = await executor.execute(start);
      assert.deepEqual(values(result, "Count"), [5, 5, 5, 5, 5, 5]);
      assert.deepEqual(values(result, "Sum"), [510, 535, 560, 585, 610, 635]);
      assert.deepEqual(values(result, "First"), [100, 105, 110, 115, 120, 125]);
      assert.deepEqual(values(result, "Last"), [104, 109, 114, 119, 124, 129]);
      assert.deepEqual(values(result, "Developing"), [null, null, 114, 114, 114, 129]);
      assert.deepEqual(values(result, "Confirmed HTF"), [null, null, 114, null, null, 129]);
      assert.deepEqual(values(result, "Historical"), [true, true, true, true, true, true]);
      assert.equal(result.audit.bars, 6);
    } finally { executor.dispose(); }
  }
});

test("repeated genuine M1 ticks revise developing requests once while chart var rolls back and varip persists", async () => {
  for (const version of [5, 6]) {
    const executor = pine.createPineLiveExecutor(), start = initial(version);
    try {
      await executor.execute(start);
      let sequence = 0;
      const saved = [];
      for (const close of [200, 210, 210]) {
        const minutes = [...history, minute(30, close)];
        const result = await executor.execute(command(start, ++sequence, minutes));
        assert.equal(tail(result, "Count"), 1); assert.equal(tail(result, "Sum"), close);
        assert.equal(tail(result, "First"), close); assert.equal(tail(result, "Last"), close);
        assert.equal(tail(result, "Developing"), close); assert.equal(tail(result, "Confirmed HTF"), null);
        assert.equal(tail(result, "Remote SMA"), (129 + close) / 2);
        assert.equal(tail(result, "Identity1"), close + 1); assert.equal(tail(result, "Identity9"), close + 9);
        assert.equal(tail(result, "Ordinary"), 7); assert.equal(tail(result, "Ticks"), 6 + sequence);
        assert.equal(result.audit.bars, 7);
        saved.push({ result, serialized: JSON.stringify(result) });
      }
      for (const item of saved) assert.equal(JSON.stringify(item.result), item.serialized);
    } finally { executor.dispose(); }
  }
});

test("explicit M1 closures grow actual intrabar arrays and confirm HTF only at its boundary", async () => {
  for (const version of [5, 6]) {
    const executor = pine.createPineLiveExecutor(), start = initial(version);
    try {
      await executor.execute(start);
      const minutes = [...history]; let sequence = 0;
      for (let index = 30; index < 45; index++) {
        minutes.push(minute(index, 200 + index));
        const open = await executor.execute(command(start, ++sequence, minutes));
        const count = index % 5 + 1;
        assert.equal(tail(open, "Count"), count);
        assert.equal(tail(open, "Sum"), minutes.slice(-count).reduce((sum, bar) => sum + bar.close, 0));
        assert.equal(tail(open, "Developing"), 200 + index);
        assert.equal(tail(open, "Confirmed HTF"), null);
        const closed = await executor.execute(command(start, ++sequence, minutes, true));
        assert.equal(tail(closed, "Confirmed HTF"), index === 44 ? 244 : null);
        assert.equal(tail(closed, "Remote SMA"), (129 + 200 + index) / 2);
      }
      minutes.push(minute(45, 245));
      const next = await executor.execute(command(start, ++sequence, minutes));
      assert.equal(tail(next, "Count"), 1); assert.equal(tail(next, "Developing"), 245);
      assert.equal(tail(next, "Confirmed HTF"), null); assert.equal(tail(next, "Remote SMA"), (244 + 245) / 2);
      assert.equal(next.audit.bars, 10);
    } finally { executor.dispose(); }
  }
});

test("mid-bucket start retains earlier confirmed M1 children without inventing a closed chart candle", async () => {
  for (const version of [5, 6]) {
    const executor = pine.createPineLiveExecutor(), closed = Array.from({ length: 33 }, (_, i) => minute(i));
    const start = initial(version, body, closed);
    start.request.bars = aggregate(history);
    try {
      const warm = await executor.execute(start);
      assert.equal(warm.audit.bars, 6);
      const current = await executor.execute(command(start, 1, [...closed, minute(33, 233)]));
      assert.equal(current.audit.bars, 7); assert.equal(tail(current, "Count"), 4);
      assert.equal(tail(current, "Sum"), 130 + 131 + 132 + 233);
      assert.equal(tail(current, "Developing"), 233);
      assert.equal(tail(current, "Confirmed HTF"), null);
      assert.equal(tail(current, "Remote SMA"), (129 + 233) / 2);
    } finally { executor.dispose(); }
  }
});

test("viewport replay retains latest closed and open M1 provenance before the next actual event", async () => {
  const executor = pine.createPineLiveExecutor(), start = initial(6, body + '\nplot(chart.left_visible_bar_time,"Left")');
  start.request.viewport = { from: origin, to: origin + 29 * 60 };
  const sources = [...history, minute(30, 205)];
  try {
    await executor.execute(start);
    await executor.execute(command(start, 1, sources));
    await executor.execute(command(start, 2, sources, true));
    const rerun = await executor.execute({ protocol: "pine-live-v1", sessionId: start.sessionId,
      sequence: 3, action: "viewport", viewport: { from: origin + 600, to: origin + 1800 } });
    assert.equal(rerun.audit.bars, 7); assert.equal(tail(rerun, "Count"), 1);
    assert.equal(tail(rerun, "Sum"), 205); assert.equal(tail(rerun, "Developing"), 205);
    assert.equal(values(rerun, "Left").every(value => value === (origin + 600) * 1000), true);
    sources.push(minute(31, 210));
    const next = await executor.execute(command(start, 4, sources));
    assert.equal(next.audit.bars, 7); assert.equal(tail(next, "Count"), 2);
    assert.equal(tail(next, "Sum"), 415); assert.equal(tail(next, "Developing"), 210);
  } finally { executor.dispose(); }
});

test("non-multiple requested6m boundary follows actual M1 time while the5m chart bar stays open", async () => {
  const text = 'plot(request.security(syminfo.tickerid,"6",close),"Developing6")\n'
    + 'plot(request.security(syminfo.tickerid,"6",close[1]),"Previous6")\n'
    + 'plot(request.security(syminfo.tickerid,"6",close,gaps=barmerge.gaps_on),"Confirmed6")';
  for (const version of [5, 6]) {
    const executor = pine.createPineLiveExecutor(), start = initial(version, text), minutes = [...history];
    try {
      await executor.execute(start); let sequence = 0, closed;
      for (let index = 30; index <= 35; index++) {
        minutes.push(minute(index, 200 + index));
        const open = await executor.execute(command(start, ++sequence, minutes));
        assert.equal(tail(open, "Developing6"), 200 + index);
        assert.equal(tail(open, "Previous6"), 129);
        assert.equal(tail(open, "Confirmed6"), null);
        closed = await executor.execute(command(start, ++sequence, minutes, true));
      }
      assert.equal(tail(closed, "Confirmed6"), 235);
      minutes.push(minute(36, 236));
      const next = await executor.execute(command(start, ++sequence, minutes));
      assert.equal(tail(next, "Developing6"), 236);
      assert.equal(tail(next, "Previous6"), 235); assert.equal(tail(next, "Confirmed6"), null);
      assert.equal(next.audit.bars, closed.audit.bars);
      assert.equal(next.plots[0].points.at(-1).time, origin + 35 * 60);
    } finally { executor.dispose(); }
  }
});

test("the production M1 feed drives the genuine worker with exact lower data and no fabricated tick", async () => {
  const feed = pine.createPineLiveFeed("CHART:TEST"), executor = pine.createPineLiveExecutor(), start = initial(6);
  feed.seed(history);
  try {
    await executor.execute(start); let sequence = 0;
    for (const [index, close, confirmed] of [[30, 200, false], [30, 205, false], [30, 205, true], [31, 210, false]]) {
      const bar = minute(index, close);
      feed.receive(bar, confirmed, ++sequence, bar.time * 1000 + 59_999);
      const snapshot = feed.getSnapshot(), chart = pine.pineFeedChartSnapshot(snapshot, "5m");
      const result = await executor.execute({ protocol: "pine-live-v1", sessionId: start.sessionId,
        sequence, action: "update", bar: chart.bar, confirmed: chart.confirmed,
        source: { bar: snapshot.event.bar, confirmed: snapshot.event.confirmed } });
      assert.equal(tail(result, "Count"), index === 30 ? 1 : 2);
      assert.equal(tail(result, "Sum"), index === 30 ? close : 415);
      assert.equal(tail(result, "Developing"), close);
      assert.equal(tail(result, "Ticks"), 6 + sequence);
    }
  } finally { executor.dispose(); }
});

test("requested user-function var and varip retain their own realtime context across repeated parent ticks", async () => {
  const text = `state()=>
    var int ordinary=0
    varip int ticks=0
    ordinary+=1
    ticks+=1
    [ordinary,ticks]
[ordinary,ticks]=request.security(syminfo.tickerid,"15",state())
plot(ordinary,"Requested ordinary")
plot(ticks,"Requested ticks")`;
  for (const version of [5, 6]) {
    for (const count of [30, 33]) {
      const executor = pine.createPineLiveExecutor(), closed = Array.from({ length: count }, (_, i) => minute(i));
      const start = initial(version, text, closed); start.request.bars = aggregate(history);
      try {
        const warm = await executor.execute(start);
        assert.deepEqual(values(warm, "Requested ordinary"), [null, null, 1, 1, 1, 2]);
        assert.deepEqual(values(warm, "Requested ticks"), [null, null, 1, 1, 1, 2]);
        for (let sequence = 1; sequence <= 3; sequence++) {
          const current = await executor.execute(command(start, sequence, [...closed, minute(count, 200 + sequence)]));
          assert.equal(tail(current, "Requested ordinary"), 3);
          assert.equal(tail(current, "Requested ticks"), 2 + sequence, `seed${count},actualtick${sequence}`);
        }
      } finally { executor.dispose(); }
    }
  }
});

test("new realtime-only requested contexts and expressions fail before publishing uninitialized values", async () => {
  for (const text of [
    'float remote=na\nif barstate.isrealtime\n    remote:=request.security(syminfo.tickerid,"15",close)\nplot(remote,"Remote")',
    'seed=request.security(syminfo.tickerid,"15",close)\nfloat remote=na\nif barstate.isrealtime\n    remote:=request.security(syminfo.tickerid,"15",close+9)\nplot(seed,"Seed")\nplot(remote,"Remote")',
  ]) {
    const executor = pine.createPineLiveExecutor(), start = initial(6, text);
    try {
      const warm = await executor.execute(start); assert.equal(values(warm, "Remote").every(value => value === null), true);
      await assert.rejects(executor.execute(command(start, 1, [...history, minute(30, 200)])), fails("UNAVAILABLE_DATA"));
    } finally { executor.dispose(); }
  }
});

test("mutable requested collections are rejected rather than aliased across realtime updates", async () => {
  const executor = pine.createPineLiveExecutor(), start = initial(6,
    'read()=>array.from(close)\nremote=request.security(syminfo.tickerid,"15",read())\nplot(not na(remote),"Unsafe collection")');
  try { await assert.rejects(executor.execute(start), fails("UNSUPPORTED_REQUEST_EXPRESSION")); }
  finally { executor.dispose(); }
});

test("source-owning live sessions fail closed for missing event, malformed identity or mismatched aggregate", async () => {
  const valid = () => { const start = initial(6); return { start, update: command(start, 1, [...history, minute(30, 200)]) }; };
  for (const mutate of [
    request => { delete request.source; },
    request => { request.source.confirmed = "false"; },
    request => { request.source.foreign = true; },
    request => { request.source.bar = minute(32, 200); },
    request => { request.bar.close += 1; request.bar.high += 1; },
    request => { request.confirmed = true; },
  ]) {
    const executor = pine.createPineLiveExecutor(), { start, update } = valid();
    try {
      await executor.execute(start); mutate(update);
      await assert.rejects(executor.execute(update));
      await assert.rejects(executor.execute(command(start, 2, [...history, minute(30, 200)])), fails("LIVE_SESSION_HALTED"));
    } finally { executor.dispose(); }
  }
});

test("unowned lower data and foreign exchanges never substitute chart candles", async () => {
  for (const version of [5, 6]) {
    for (const text of ['plot(array.size(request.security_lower_tf("OTHER:TEST","1",close)),"Foreign")',
      'plot(request.security("OTHER:TEST","15",close),"Foreign")']) {
      const executor = pine.createPineLiveExecutor();
      try { await assert.rejects(executor.execute(initial(version, text)), fails("UNAVAILABLE_DATA")); }
      finally { executor.dispose(); }
    }
    const executor = pine.createPineLiveExecutor(), start = initial(version);
    delete start.request.sourceSnapshot;
    try { await assert.rejects(executor.execute(start), fails("UNAVAILABLE_DATA")); }
    finally { executor.dispose(); }
  }
});

test("static nested SMA and lower arrays retain original5m values through open viewport replay", async () => {
  const text = 'inner=request.security("","",ta.sma(close,2))\n'
    + 'children=request.security_lower_tf("","1",close)\n'
    + 'plot(request.security(syminfo.tickerid,"15",inner+close),"Static SMA")\n'
    + 'plot(request.security(syminfo.tickerid,"15",array.sum(children)),"Static children")\n'
    + 'plot(chart.left_visible_bar_time,"Left")';
  const executor = pine.createPineLiveExecutor(), start = initial(6, text), minutes = [...history];
  start.request.source = start.request.source.replace("dynamic_requests=true", "dynamic_requests=false");
  start.request.viewport = { from: origin, to: origin + 29 * 60 };
  try {
    const warm = await executor.execute(start);
    assert.equal(tail(warm, "Static SMA"), (124 + 129) / 2 + 129);
    assert.equal(tail(warm, "Static children"), 635);
    let sequence = 0;
    for (let index = 30; index <= 35; index++) {
      minutes.push(minute(index, 200 + index));
      const open = await executor.execute(command(start, ++sequence, minutes));
      if (index === 35) {
        assert.equal(tail(open, "Static SMA"), (234 + 235) / 2 + 235);
        assert.equal(tail(open, "Static children"), 235);
      }
      await executor.execute(command(start, ++sequence, minutes, true));
    }
    const replay = await executor.execute({ protocol: "pine-live-v1", sessionId: start.sessionId, sequence: ++sequence,
      action: "viewport", viewport: { from: origin + 600, to: origin + 1800 } });
    assert.equal(tail(replay, "Static SMA"), (234 + 235) / 2 + 235);
    assert.equal(tail(replay, "Static children"), 235);
    assert.equal(values(replay, "Left").every(value => value === (origin + 600) * 1000), true);
  } finally { executor.dispose(); }
});

test("initial source validates real partial first history and rejects missing interiors, false aggregates and full future buckets", async () => {
  const partial = history.slice(2), accepted = initial(6, 'plot(array.size(request.security_lower_tf("","1",close)),"Count")', partial);
  const executor = pine.createPineLiveExecutor();
  try {
    const result = await executor.execute(accepted);
    assert.deepEqual(values(result, "Count"), [3, 5, 5, 5, 5, 5]);
  } finally { executor.dispose(); }
  for (const mutate of [
    start => { start.request.sourceSnapshot.bars[10].volume += 1; },
    start => { start.request.sourceSnapshot.bars.splice(15, 1); },
    start => { start.request.sourceSnapshot.bars = [...history, ...Array.from({ length: 5 }, (_, i) => minute(30 + i))]; },
    start => { start.request.sourceSnapshot = Object.assign(Object.create({ inherited: true }), start.request.sourceSnapshot); },
  ]) {
    const bad = initial(6), owner = pine.createPineLiveExecutor();
    // Mutations must never corrupt the shared authored input oracle.
    bad.request.sourceSnapshot = structuredClone(bad.request.sourceSnapshot);
    try { mutate(bad); await assert.rejects(owner.execute(bad)); }
    finally { owner.dispose(); }
  }
  let reads = 0;
  const accessor = initial(6);
  Object.defineProperty(accessor.request, "sourceSnapshot", { enumerable: true, get() { reads++; return { timeframe: "1", bars: history }; } });
  assert.throws(() => pine.validatePineLiveRequest(accessor));
  assert.equal(reads, 0);
  const nestedAccessor = initial(6);
  nestedAccessor.request.sourceSnapshot = structuredClone(nestedAccessor.request.sourceSnapshot);
  Object.defineProperty(nestedAccessor.request.sourceSnapshot.bars[0], "close", { enumerable: true, get() { reads++; return 100; } });
  assert.throws(() => pine.validatePineLiveRequest(nestedAccessor));
  assert.equal(reads, 0);
});

test("64 requested-context varip array mutations retain authentic received events without duplicate payload accounting", async () => {
  const text = `state()=>
    varip array<float> seen=array.new_float()
    if barstate.isrealtime
        array.push(seen,close)
    [array.size(seen),array.sum(seen)]
[count,total]=request.security(syminfo.tickerid,"15",state())
plot(count,"Requested count")
plot(total,"Requested total")`;
  const executor = pine.createPineLiveExecutor(), start = initial(6, text);
  try {
    await executor.execute(start); let total = 0;
    for (let sequence = 1; sequence <= 64; sequence++) {
      const close = 200 + sequence; total += close;
      const result = await executor.execute(command(start, sequence, [...history, minute(30, close)]));
      assert.equal(tail(result, "Requested count"), sequence);
      assert.equal(tail(result, "Requested total"), total);
      assert.equal(result.audit.bars, 7);
    }
  } finally { executor.dispose(); }
});

test("combined secondary mutable payload is bounded across otherwise individually valid requested contexts", async () => {
  const text = 'state(int amount)=>\n    var array<float> cells=array.new_float(50000,1)\n    array.size(cells)+amount\n'
    + Array.from({ length: 6 }, (_, index) => `plot(request.security(syminfo.tickerid,"15",state(${index + 1})),"Owner${index + 1}")`).join("\n");
  const executor = pine.createPineLiveExecutor(), start = initial(6, text);
  try {
    await assert.rejects(executor.execute(start), cause => {
      assert.equal(cause.code, "REQUEST_LIMIT", cause.message);
      assert.match(cause.message, /secondary mutable state/i);
      return true;
    });
    await assert.rejects(executor.execute(command(start, 1, [...history, minute(30, 200)])), fails("LIVE_SESSION_HALTED"));
  } finally { executor.dispose(); }
});
