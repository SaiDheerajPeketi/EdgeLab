import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
const baseline = process.env.PINE_ALERT176_BASELINE === "head";
const before = baseline ? fs.readFileSync(".artifacts/pine-alerts176/Core-before.ts", "utf8") : undefined;
const previousCore = { name: "alerts176-committed-core", setup(builder) {
  builder.onLoad({ namespace: "edgelab-pine-source", filter: /^src\/namespaces\/Core\.ts$/ }, () => ({ contents: before, loader: "ts" }));
} };
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser", target: "es2020", write: false,
  logLevel: "silent", plugins: [...(baseline ? [previousCore] : []), createPineEnginePlugin()], stdin: { loader: "ts", resolveDir: process.cwd(), sourcefile: "pine-alerts176.ts",
    contents: 'export { PineTS, Indicator, Context, Series } from "pinets"; export * from "./frontend/src/workers/pineNative.worker.ts";' } })).outputFiles[0].text;
console.info("PINE_ALERT176_BINDING " + JSON.stringify({ minified: true, actualEngine: true, actualWorker: true, committedCoreBaseline: baseline,
  ...(baseline ? { coreSha256: createHash("sha256").update(before).digest("hex") } : {}), bundleSha256: createHash("sha256").update(bundle).digest("hex"),
  manifestSha256: createHash("sha256").update(fs.readFileSync("frontend/vendor/pinets/manifest.json")).digest("hex") }));
const pine = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const origin = Date.UTC(2024, 0, 1);
const candle = (index, close = 100) => ({ openTime: origin + index * 60000, closeTime: origin + (index + 1) * 60000,
  open: 100, high: Math.max(100, close), low: Math.min(100, close), close, volume: 10 });
const script = (body, version = 6) => `//@version=${version}\nindicator("Alert foundation176")\n${body}\nplot(close,"Price")`;
async function live(body, version = 6) {
  const snapshot = [0, 1, 2].map(i => candle(i));
  const provider = { configure() {}, async getMarketData(_symbol, _timeframe, limit, start, end) {
    let data = snapshot.filter(bar => (start === undefined || bar.openTime >= start) && (end === undefined || bar.openTime <= end));
    if (limit !== undefined) data = data.slice(-limit); return data.map(bar => ({ ...bar }));
  }, async getSymbolInfo() { return { tickerid: "TEST", ticker: "TEST", timezone: "UTC", session: "24x7", currency: "USD", mintick: .01, pricescale: 100, minmove: 1, pointvalue: 1 }; } };
  const engine = new pine.PineTS(provider, "TEST", "1", snapshot.length);
  engine.setRealtimeMode(true, { initialTail: "historical" });
  const context = await engine.run(new pine.Indicator(script(body, version)));
  let index = 3;
  return { context, engine, async tick(close = 110, confirmed = false) {
    const bar = candle(index, close); if (snapshot.length === index) snapshot.push(bar); else snapshot[index] = bar;
    assert.equal(await engine.updateTail(context, { confirmed, received: true }), true);
    if (confirmed) index++;
  } };
}
const drain = context => context.alerts.splice(0).map(event => ({ type: event.type, message: event.message, freq: event.freq, index: event.bar_index, time: event.time, id: event.id }));
const expected = (message, freq, index, id) => ({ type: "alert", message, freq, index, time: origin + index * 60000, id });

// Official alert docs are inconsistent about global versus per-callsite once gating.
// This foundation preserves the pinned per-callsite behavior, not a blanket TV parity claim.
test("v5/v6 default and explicit once frequency remain per-callsite and survive draining and intrabar rollback", async () => {
  for (const version of [5, 6]) {
    const run = await live('alert("A")\nif close>105\n    alert("B",alert.freq_once_per_bar)', version);
    assert.deepEqual(drain(run.context), []);
    await run.tick(100); assert.deepEqual(drain(run.context), [expected("A", "once_per_bar", 3, "alert_0")]);
    await run.tick(110); assert.deepEqual(drain(run.context), [expected("B", "once_per_bar", 3, "alert_1")]);
    await run.tick(90); assert.deepEqual(drain(run.context), []);
    await run.tick(110, true); assert.deepEqual(drain(run.context), []);
    await run.tick(110); assert.deepEqual(drain(run.context), [expected("A", "once_per_bar", 4, "alert_0"), expected("B", "once_per_bar", 4, "alert_1")]);
  }
});

test("close frequency fires only on an actual closing execution, once for each reached callsite", async () => {
  for (const version of [5, 6]) {
    const run = await live('alert("Close A",alert.freq_once_per_bar_close)\nif close>105\n    alert("Close B",alert.freq_once_per_bar_close)', version);
    assert.deepEqual(drain(run.context), []);
    await run.tick(110); assert.deepEqual(drain(run.context), []); await run.tick(90); assert.deepEqual(drain(run.context), []);
    await run.tick(110, true); assert.deepEqual(drain(run.context), [expected("Close A", "once_per_bar_close", 3, "alert_0"), expected("Close B", "once_per_bar_close", 3, "alert_1")]);
    await run.tick(110); assert.deepEqual(drain(run.context), []);
    await run.tick(100, true); assert.deepEqual(drain(run.context), [expected("Close A", "once_per_bar_close", 4, "alert_0")]);
  }
});

test("all frequency emits every actual accepted execution including unchanged received price and multiple callsites", async () => {
  for (const version of [5, 6]) {
    const run = await live('alert("All A",alert.freq_all)\nalert("All B",alert.freq_all)', version);
    assert.deepEqual(drain(run.context), []);
    for (const confirmed of [false, false, true]) {
      await run.tick(110, confirmed); assert.deepEqual(drain(run.context), [expected("All A", "all", 3, "alert_0"), expected("All B", "all", 3, "alert_1")]);
    }
    await run.tick(120); assert.deepEqual(drain(run.context), [expected("All A", "all", 4, "alert_0"), expected("All B", "all", 4, "alert_1")]);
  }
});

test("frequency defaults only for omitted raw argument; explicit falsy, NA and unknown values cannot silently become once or all", async () => {
  const run = await live("var int owner=0\nowner+=1");
  for (const value of ["", false, 0, null, NaN, "sometimes", pine.Series.from(undefined)]) {
    assert.throws(() => run.context.pine.alert.any("Invalid", value), /frequency|freq/i, `Rejected ${String(value)}`);
    assert.equal(run.context.alerts.length, 0);
  }
  for (const body of ['alert("Invalid","")', 'alert("Invalid","sometimes")']) {
    await assert.rejects(live(body), /frequency|freq/i);
  }
});

test("legacy fully qualified frequency literals preserve their native meanings", async () => {
  const run = await live('alert("Legacy once","alert.freq_once_per_bar")\nalert("Legacy all","alert.freq_all")\nalert("Legacy close","alert.freq_once_per_bar_close")');
  await run.tick(110); assert.deepEqual(drain(run.context).map(event => [event.message, event.freq]), [["Legacy once", "once_per_bar"], ["Legacy all", "all"]]);
  await run.tick(110, true); assert.deepEqual(drain(run.context).map(event => [event.message, event.freq]), [["Legacy all", "all"], ["Legacy close", "once_per_bar_close"]]);
});

test("v5/v6 named defaults, named frequency and mixed positional-message named-frequency retain exact callsite behavior", async () => {
  for (const version of [5, 6]) {
    const run = await live('frequency=input.string("all","Frequency")\nalert(message="Named default")\nalert(message="Named all",freq=frequency)\nalert("Mixed",freq=alert.freq_all)', version);
    assert.deepEqual(drain(run.context), []);
    await run.tick(110);
    assert.deepEqual(drain(run.context), [expected("Named default", "once_per_bar", 3, "alert_0"), expected("Named all", "all", 3, "alert_1"), expected("Mixed", "all", 3, "alert_2")]);
    await run.tick(110);
    assert.deepEqual(drain(run.context), [expected("Named all", "all", 3, "alert_1"), expected("Mixed", "all", 3, "alert_2")]);
    for (const invalid of ['alert(message="Invalid",freq="")', 'alert(message="Invalid",freq=na)', 'alert("Invalid",freq="")']) {
      await assert.rejects(live(invalid, version), /frequency|freq/i);
    }
  }
});

test("retained gate collections remain proportional to current callsites rather than all prior bars", async () => {
  const run = await live('alert("A",alert.freq_once_per_bar)\nalert("B",alert.freq_once_per_bar_close)');
  for (let i = 0; i < 750; i++) {
    await run.tick(110, true); const events = drain(run.context); assert.equal(events.length, 2); assert.equal(events[0].index, 3 + i);
    const helper = run.context.pine.alert;
    for (const [key, value] of Object.entries(helper)) if (value instanceof Set || value instanceof Map) assert.ok(value.size <= 2, `${key} retained ${value.size} historical gates`);
  }
});

const chartBars = [0, 1, 2].map(i => ({ time: origin / 1000 + i * 60, open: 100, high: 100, low: 100, close: 100, volume: 10 }));
const request = body => ({ id: "alert176", action: "run", mode: "historical", source: script(body), inputs: {}, bars: chartBars,
  context: { symbol: "TEST", timeframe: "1", mintick: .01, pointvalue: 1 } });
const price = result => result.plots.find(plot => plot.name === "Price").points.map(point => point.value);

test("worker historical and live startup remain silent and disclose unavailable delivery rather than exporting alert events", async () => {
  const historical = await pine.executePineRequest(request('alert("Historical",alert.freq_all)\nalertcondition(true,"Condition","Condition message")'));
  assert.deepEqual(price(historical), [100, 100, 100]); assert.equal(Object.hasOwn(historical, "alerts"), false);
  assert.equal(historical.diagnostics.filter(item => item.code === "ALERT_DELIVERY_UNAVAILABLE").length, 1);
  const executor = pine.createPineLiveExecutor(), sessionId = "alert176-silent-start";
  try {
    const initial = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 0, action: "start", request: { ...request('alert("Live",alert.freq_all)'), mode: "live", id: sessionId + ":0" } });
    assert.deepEqual(price(initial), [100, 100, 100]); assert.equal(Object.hasOwn(initial, "alerts"), false);
  } finally { executor.dispose(); }
});

test("worker drains large all-call loops and a thousand genuine updates without changing plots or accumulating unavailable events", async () => {
  const contexts = new Set(), original = pine.Context.prototype.initVar; let actualAlertCalls = 0;
  pine.Context.prototype.initVar = function(...args) {
    if (!contexts.has(this)) {
      contexts.add(this); const helper = this.pine.alert, send = helper.any;
      helper.any = function(...args) { actualAlertCalls++; return Reflect.apply(send, this, args); };
    }
    return Reflect.apply(original, this, args);
  };
  const executor = pine.createPineLiveExecutor(), sessionId = "alert176-worker-stress";
  try {
    const body = 'varip int executions=0\nexecutions+=1\nfor i=0 to 1499\n    alert(str.tostring(i),alert.freq_all)\nalertcondition(true,"Condition","Unavailable")\nplot(executions,"Executions")\nplot(chart.left_visible_bar_time,"Left")';
    const initial = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 0, action: "start", request: { ...request(body), mode: "live", id: sessionId + ":0" } });
    assert.deepEqual(price(initial), [100, 100, 100]); assert.ok(contexts.size > 0, "Passive observer saw actual engine context");
    for (const context of contexts) assert.equal(context.alerts.length, 0, "Historical startup queue empty");
    for (let sequence = 1; sequence <= 1000; sequence++) {
      const result = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence, action: "update", bar: { ...chartBars[2], time: origin / 1000 + 180, close: 110, high: 110 }, confirmed: false });
      assert.deepEqual(price(result), [100, 100, 100, 110]);
      assert.equal(result.plots.find(plot => plot.name === "Executions").points.at(-1).value, 3 + sequence);
      assert.equal(Object.hasOwn(result, "alerts"), false); assert.equal(result.diagnostics.filter(item => item.code === "ALERT_DELIVERY_UNAVAILABLE").length, 1);
      for (const context of contexts) assert.equal(context.alerts.length, 0, "Unavailable worker queue drained");
    }
    assert.ok(actualAlertCalls >= 1504500, `Observed ${actualAlertCalls} actual helper calls, expected at least 1500 per historical/received iteration`);
    const priorContexts = contexts.size;
    const rebuilt = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 1001, action: "viewport", viewport: { from: origin / 1000 + 60, to: origin / 1000 + 180 } });
    assert.equal(rebuilt.usesVisibleRange, true); assert.ok(contexts.size > priorContexts, "Viewport rebuild executed a new actual engine context");
    assert.deepEqual(price(rebuilt), [100, 100, 100, 110]);
    for (const context of contexts) assert.equal(context.alerts.length, 0, "Rebuilt queue drained");
  } finally { executor.dispose(); pine.Context.prototype.initVar = original; }
});

test("worker finally drains already-emitted events when a later invalid call fails execution", async () => {
  const contexts = new Set(), original = pine.Context.prototype.initVar;
  pine.Context.prototype.initVar = function(...args) { contexts.add(this); return Reflect.apply(original, this, args); };
  const executor = pine.createPineLiveExecutor(), sessionId = "alert176-failure";
  try {
    const body = 'var int owner=0\nowner+=1\nif barstate.isrealtime\n    alert("Before failure",alert.freq_all)\n    alert("Invalid","bad_frequency")';
    await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 0, action: "start", request: { ...request(body), mode: "live", id: sessionId + ":0" } });
    await assert.rejects(executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 1, action: "update", bar: { ...chartBars[2], time: origin / 1000 + 180 }, confirmed: false }), /frequency|freq/i);
    assert.ok(contexts.size > 0); for (const context of contexts) assert.equal(context.alerts.length, 0);
    await assert.rejects(executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 2, action: "update", bar: { ...chartBars[2], time: origin / 1000 + 180 }, confirmed: false }), error => error.code === "LIVE_SESSION_HALTED");
  } finally { executor.dispose(); pine.Context.prototype.initVar = original; }
});
