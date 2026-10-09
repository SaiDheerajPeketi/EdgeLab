import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser", target: "es2020", write: false,
  logLevel: "silent", plugins: [createPineEnginePlugin()], stdin: { loader: "ts", resolveDir: process.cwd(), sourcefile: "pine-alert-events177.ts",
    contents: 'export { Context } from "pinets"; export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineLiveProtocol.ts"; export * from "./frontend/src/lib/pineProtocol.ts"; export * from "./frontend/src/lib/pinePacked.ts";' } })).outputFiles[0].text;
console.info("PINE_ALERT_EVENTS177_BINDING " + JSON.stringify({ minified: true, actualWorker: true,
  bundleSha256: createHash("sha256").update(bundle).digest("hex"), manifestSha256: createHash("sha256").update(fs.readFileSync("frontend/vendor/pinets/manifest.json")).digest("hex") }));
const pine = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const origin = Date.UTC(2024, 0, 1) / 1000;
const candle = (i, close = 100) => ({ time: origin + i * 60, open: 100, high: Math.max(100, close), low: Math.min(100, close), close, volume: 10 });
const source = (body, version = 6) => `//@version=${version}\nindicator("Chart alert receipts177",dynamic_requests=true)\n${body}\nplot(close,"Price")`;
const request = (body, version = 6, count = 3, inputs = {}) => ({ id: "alert-events177", action: "run", mode: "historical", source: source(body, version), inputs,
  bars: Array.from({ length: count }, (_, i) => candle(i)), context: { symbol: "BINANCE:BTCUSDT", timeframe: "1", mintick: .01, pointvalue: 1 } });
const events = result => result.alertEvents?.events ?? [];
const expected = (id, message, freq, i = 3) => ({ id, message, freq, time: origin + i * 60, barIndex: i });
let ordinal = 0;
async function live(body, { version = 6, count = 3, inputs = {}, streams, ...options } = {}) {
  const executor = pine.createPineLiveExecutor(), sessionId = "alert-events177-live-" + ++ordinal;
  const start = { protocol: "pine-live-v1", sessionId, sequence: 0, action: "start", ...(streams ? { marketStreams: streams } : {}), request: {
    ...request(body, version, count, inputs), id: sessionId + ":0", mode: "live", ...options } };
  try {
    const initial = await executor.execute(start); let sequence = 0, bars = start.request.bars;
    return { executor, initial, start, async send(command) {
      const owned = { protocol: "pine-live-v1", sessionId, sequence: ++sequence, ...command };
      if (command.action === "update") bars = command.bar.time === bars.at(-1).time ? [...bars.slice(0, -1), command.bar] : [...bars, command.bar];
      const current = { ...start.request, id: sessionId + ":" + sequence, bars };
      const result = await executor.execute(owned);
      return { result, command: owned, current, wire: result.kind === "market-update" ? undefined : {
        protocol: "pine-live-v1", sessionId, sequence, response: pine.toPineWireResponse(current.id, result, bars) } };
    } };
  } catch (error) { executor.dispose(); throw error; }
}

test("v5/v6 first mid-bar arm remains eligible after unarmed updates; actual inputs, once/all/close messages and immutable outputs", async () => {
  const body = 'prefix=input.string("Default","Prefix")\nvarip int executions=0\nexecutions+=1\nalert(prefix+":"+str.tostring(close),alert.freq_once_per_bar)\nalert("Every:"+str.tostring(executions),alert.freq_all)\nalert("Close",alert.freq_once_per_bar_close)\nplot(executions,"Executions")';
  for (const version of [5, 6]) {
    const session = await live(body, { version, inputs: { in_0: "Custom" } });
    try {
      assert.equal(Object.hasOwn(session.initial, "alertEvents"), false);
      const quiet = await session.send({ action: "update", bar: candle(3, 101), confirmed: false });
      assert.equal(Object.hasOwn(quiet.result, "alertEvents"), false);
      const armed = await session.send({ action: "update", bar: candle(3, 102), confirmed: false, collectAlerts: true });
      assert.deepEqual(armed.result.alertEvents, { events: [expected("alert_0", "Custom:102", "once_per_bar"), expected("alert_1", "Every:5", "all")], dropped: 0 });
      const before = structuredClone(armed.result.alertEvents);
      const closed = await session.send({ action: "update", bar: candle(3, 103), confirmed: true, collectAlerts: true });
      assert.deepEqual(closed.result.alertEvents, { events: [expected("alert_1", "Every:6", "all"), expected("alert_2", "Close", "once_per_bar_close")], dropped: 0 });
      const next = await session.send({ action: "update", bar: candle(4, 104), confirmed: false, collectAlerts: true });
      assert.deepEqual(next.result.alertEvents, { events: [expected("alert_0", "Custom:104", "once_per_bar", 4), expected("alert_1", "Every:7", "all", 4)], dropped: 0 });
      assert.deepEqual(armed.result.alertEvents, before);
      assert.deepEqual(pine.validatePineLiveResponse(armed.wire, armed.command, armed.current).alertEvents, before);
    } finally { session.executor.dispose(); }
  }
});

test("unarmed and explicit false commands do not transport or consume once gates; real unchanged armed executions retain all receipts", async () => {
  const session = await live('alert("Once")\nalert("All",alert.freq_all)');
  try {
    for (const options of [{}, { collectAlerts: false }]) {
      const quiet = await session.send({ action: "update", bar: candle(3, 110), confirmed: false, ...options });
      assert.equal(Object.hasOwn(quiet.result, "alertEvents"), false);
    }
    const first = await session.send({ action: "update", bar: candle(3, 110), confirmed: false, collectAlerts: true });
    assert.deepEqual(events(first.result), [expected("alert_0", "Once", "once_per_bar"), expected("alert_1", "All", "all")]);
    const unchanged = await session.send({ action: "update", bar: candle(3, 110), confirmed: false, collectAlerts: true });
    assert.deepEqual(events(unchanged.result), [expected("alert_1", "All", "all")]);
  } finally { session.executor.dispose(); }
});

test("event capacity64 and oversized message4097 are honestly dropped without failing or changing chart output", async () => {
  for (const [body, messages, dropped] of [
    ['for i=0 to 79\n    alert(str.tostring(i),alert.freq_all)', Array.from({ length: 64 }, (_, i) => String(i)), 16],
    ['alert("' + "x".repeat(4097) + '",alert.freq_all)\nalert("After",alert.freq_all)', ["After"], 1],
    ['alert("' + "x".repeat(4096) + '",alert.freq_all)', ["x".repeat(4096)], 0],
  ]) {
    const session = await live(body);
    try {
      const { result } = await session.send({ action: "update", bar: candle(3, 110), confirmed: false, collectAlerts: true });
      assert.deepEqual(events(result).map(event => event.message), messages); assert.equal(result.alertEvents.dropped, dropped);
      assert.ok(events(result).every(event => event.time === origin + 180 && event.barIndex === 3 && event.freq === "all"));
      assert.deepEqual(result.plots.find(plot => plot.name === "Price").points.map(point => point.value), [100, 100, 100, 110]);
    } finally { session.executor.dispose(); }
  }
});

test("history/start/viewport cannot emit receipts and collect admission is update-only boolean", async () => {
  const body = 'alert("Unavailable",alert.freq_all)\nplot(chart.left_visible_bar_time,"Left")';
  const historical = await pine.executePineRequest(request(body)); assert.equal(Object.hasOwn(historical, "alertEvents"), false);
  const session = await live(body);
  try {
    assert.equal(Object.hasOwn(session.initial, "alertEvents"), false);
    const viewport = await session.send({ action: "viewport", viewport: { from: origin, to: origin + 120 } });
    assert.equal(Object.hasOwn(viewport.result, "alertEvents"), false);
    for (const command of [session.start, { protocol: "pine-live-v1", sessionId: session.start.sessionId, sequence: 1, action: "viewport", viewport: null },
      { protocol: "pine-live-v1", sessionId: session.start.sessionId, sequence: 1, action: "markets", events: [] }]) {
      assert.throws(() => pine.validatePineLiveRequest({ ...command, collectAlerts: true }), error => error.code === "INVALID_LIVE_MESSAGE");
    }
    for (const value of [null, 1, "true", {}, []]) assert.throws(() => pine.validatePineLiveRequest({ protocol: "pine-live-v1", sessionId: session.start.sessionId,
      sequence: 1, action: "update", bar: candle(3), confirmed: false, collectAlerts: value }), error => error.code === "INVALID_LIVE_MESSAGE");
  } finally { session.executor.dispose(); }
});

test("strict receipt validation rejects forged time/index/frequency, overflow, sparse/accessor fields and noncollect/historical reuse", async () => {
  const session = await live('alert("Actual",alert.freq_all)');
  try {
    const actual = await session.send({ action: "update", bar: candle(3), confirmed: false, collectAlerts: true });
    assert.deepEqual(events(pine.validatePineLiveResponse(actual.wire, actual.command, actual.current)), [expected("alert_0", "Actual", "all")]);
    const mutations = [batch => batch.events[0].time--, batch => batch.events[0].barIndex--, batch => batch.events[0].freq = "once_per_bar_close",
      batch => batch.events[0].freq = "unknown", batch => batch.events[0].id = "x".repeat(129), batch => batch.events[0].message = "x".repeat(4097),
      batch => batch.dropped = -1, batch => batch.extra = true, batch => batch.events[0].extra = true,
      batch => batch.events = Array.from({ length: 65 }, () => ({ ...batch.events[0] })), batch => delete batch.events[0]];
    for (const mutate of mutations) {
      const wire = structuredClone(actual.wire); mutate(wire.response.result.alertEvents);
      assert.throws(() => pine.validatePineLiveResponse(wire, actual.command, actual.current));
    }
    let accessed = false; const accessor = structuredClone(actual.wire);
    Object.defineProperty(accessor.response.result.alertEvents.events[0], "message", { enumerable: true, get() { accessed = true; return "Actual"; } });
    assert.throws(() => pine.validatePineLiveResponse(accessor, actual.command, actual.current)); assert.equal(accessed, false);
    for (const collectAlerts of [undefined, false]) assert.throws(() => pine.validatePineLiveResponse(actual.wire, { ...actual.command, collectAlerts }, actual.current));
    assert.throws(() => pine.validatePineResponse(actual.wire.response, { ...actual.current, mode: "historical" }));
    const viewportCommand = { ...actual.command, action: "viewport", viewport: null }; delete viewportCommand.bar; delete viewportCommand.confirmed; delete viewportCommand.collectAlerts;
    assert.throws(() => pine.validatePineLiveResponse(actual.wire, viewportCommand, actual.current));
  } finally { session.executor.dispose(); }
});

test("real alert batch survives genuine packed output and hostile buffer metadata does not bypass receipt ownership", async () => {
  const body = 'alert("Packed",alert.freq_all)\n' + Array.from({ length: 16 }, (_, i) => `plot(close+${i},"Lane ${i}")`).join("\n");
  const session = await live(body, { count: 400 });
  try {
    const actual = await session.send({ action: "update", bar: candle(400, 110), confirmed: false, collectAlerts: true });
    assert.equal(actual.wire.response.encoding, "pine-packed-v1", "Actual native output crosses packing threshold");
    assert.deepEqual(events(pine.validatePineLiveResponse(actual.wire, actual.command, actual.current)), [expected("alert_0", "Packed", "all", 400)]);
    const bad = structuredClone(actual.wire); bad.response.buffers.push(new ArrayBuffer(0));
    assert.throws(() => pine.validatePineLiveResponse(bad, actual.command, actual.current));
    const reused = structuredClone(actual.wire); reused.sequence--;
    assert.throws(() => pine.validatePineLiveResponse(reused, actual.command, actual.current));
  } finally { session.executor.dispose(); }
});

test("worker native queues drain for collected and uncollected updates without retaining earlier event batches", async () => {
  const seen = new Set(), original = pine.Context.prototype.initVar;
  pine.Context.prototype.initVar = function(...args) { seen.add(this); return Reflect.apply(original, this, args); };
  let session;
  try {
    session = await live('varip int ticks=0\nticks+=1\nfor i=0 to 79\n    alert(str.tostring(ticks)+":"+str.tostring(i),alert.freq_all)');
    for (let i = 0; i < 100; i++) {
      const collectAlerts = i % 2 === 0, { result } = await session.send({ action: "update", bar: candle(3, 110), confirmed: false, collectAlerts });
      if (collectAlerts) { assert.equal(events(result).length, 64); assert.equal(result.alertEvents.dropped, 16); assert.equal(events(result)[0].message, `${i + 4}:0`); }
      else assert.equal(Object.hasOwn(result, "alertEvents"), false);
      assert.ok(seen.size > 0); for (const context of seen) assert.equal(context.alerts.length, 0);
    }
  } finally { session?.executor.dispose(); pine.Context.prototype.initVar = original; }
});

test("real remote updates acknowledge without main receipts and requested ETH alert effects remain secondary-silent", async () => {
  const body = 'read()=>\n    alert(syminfo.tickerid,alert.freq_all)\n    close\nremote=request.security("ETHUSDT","1",read())\nplot(remote,"ETH")\nalert("Main",alert.freq_once_per_bar)';
  const stream = { symbol: "BINANCE:ETHUSDT", timeframe: "1", epoch: 7 };
  for (const version of [5, 6]) {
    const session = await live(body, { version, streams: [stream], marketData: { provider: "binance", snapshots: [{
      context: { symbol: "BINANCE:ETHUSDT", timeframe: "1", mintick: .05, pointvalue: 1, mincontract: .001, quantityStep: .001, currency: "USDT", basecurrency: "ETH" }, requestedTimeframe: "1",
      bars: [0, 1, 2].map(i => candle(i, 200 + i)), asOf: origin + 180 }] } });
    try {
      const before = structuredClone(session.initial), remote = candle(3, 220);
      const ack = await session.send({ action: "markets", events: [{ ...stream, sequence: 1, bar: remote, confirmed: false,
        eventTime: remote.time * 1000 + 1, closeTime: (remote.time + 60) * 1000 - 1 }] });
      assert.equal(ack.result.kind, "market-update"); assert.equal(Object.hasOwn(ack.result, "alertEvents"), false); assert.equal(Object.hasOwn(ack.result, "plots"), false);
      assert.deepEqual(session.initial, before);
      const primary = await session.send({ action: "update", bar: candle(3, 110), confirmed: false, collectAlerts: true });
      assert.equal(primary.result.plots.find(plot => plot.name === "ETH").points.at(-1).value, 220);
      assert.equal(primary.result.plots.find(plot => plot.name === "Price").points.at(-1).value, 110);
      assert.equal(events(primary.result).filter(event => event.message === "Main").length, 1);
      assert.ok(events(primary.result).every(event => event.message === "Main" || event.message === "BINANCE:BTCUSDT"), "Main-argument evaluation may alert; actual requested ETH context must remain silent");
      assert.ok(events(primary.result).every(event => event.time === origin + 180 && event.barIndex === 3));
      assert.equal(primary.result.alertEvents.dropped, 0);
    } finally { session.executor.dispose(); }
  }
});
