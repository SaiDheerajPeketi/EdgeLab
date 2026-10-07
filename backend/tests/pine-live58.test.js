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
    contents: 'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineLiveProtocol.ts"; export * from "./frontend/src/lib/pineProtocol.ts"; export * from "./frontend/src/lib/pinePacked.ts";',
    resolveDir: root,
    sourcefile: "pine-live58-worker-fixture.ts",
    loader: "ts",
  },
})).outputFiles[0].text + "\n//# sourceURL=edgelab-live58-minified-worker.mjs\n";
const pine = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const hash = (value) => createHash("sha256").update(value).digest("hex");
if (process.env.EDGELAB_PINE_ENGINE_RECEIPT === "1") {
  const bytes = fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json", import.meta.url));
  const manifest = JSON.parse(bytes.toString());
  console.info("ENGINE_BINDING " + JSON.stringify({
    version: manifest.version,
    patch: manifest.patch,
    manifestSha256: hash(bytes),
    sourceMapSha256: manifest.sourceMapSha256,
    minify: true,
    workerBundleSha256: hash(bundle),
    workerBundleBytes: Buffer.byteLength(bundle),
  }));
}

const bar = (index, close) => ({ time: 1_700_000_040 + index * 60, open: close - 1, high: close + 2, low: close - 2, close, volume: 10 });
const bars = [10, 20, 30, 40].map((close, index) => bar(index, close));
const context = { symbol: "TEST", timeframe: "1", mintick: 0.01, pointvalue: 1 };
const script = (body) => `//@version=6\nindicator("Persistent oracle",overlay=true)\n${body}`;
const source = script(`increment=input.int(1,"Increment",minval=1,maxval=10)
var int ordinary=0
varip int ticks=0
ordinary+=increment
ticks+=increment
plot(ordinary,"Ordinary")
plot(ticks,"Ticks")
plot(ta.ema(close,3),"EMA",color=close>=50?#ff0000:#0000ff)
plot(barstate.ishistory,"Historical")
plot(barstate.isrealtime,"Realtime")
plot(barstate.isconfirmed,"Confirmed")
plot(barstate.isnew,"New")`);
let ordinal = 0;
function initial(body = source, snapshot = bars, inputs = {}) {
  const sessionId = `independent-live-${++ordinal}`;
  const request = { id: `${sessionId}:0`, action: "run", source: body, bars: snapshot, inputs, mode: "live", context };
  return { protocol: "pine-live-v1", sessionId, sequence: 0, action: "start", request };
}
const update = (start, sequence, candle, confirmed = false) => ({ protocol: "pine-live-v1", sessionId: start.sessionId, sequence, action: "update", bar: candle, confirmed });
const values = (result, name) => result.plots.find((plot) => plot.name === name).points.map((point) => point.value);
const tail = (result, name) => values(result, name).at(-1);
const points = (result, name) => result.plots.find((plot) => plot.name === name).points;
const failure = (code) => (cause) => {
  assert.equal(cause.code, code, `${cause.name}: ${cause.message}`);
  return true;
};
async function live(body = source, snapshot = bars, inputs = {}) {
  const executor = pine.createPineLiveExecutor();
  const start = initial(body, snapshot, inputs);
  const result = await executor.execute(start);
  return { executor, start, result };
}

// Market input is the only seam: no context, engine, compiled function or output mocks.
test("persistent worker warms all bars closed and replaces a provisional tail through 64 ticks", async () => {
  const session = await live();
  const { executor, start, result } = session;
  assert.equal(result.source, source);
  assert.equal(result.audit.mode, "live");
  assert.deepEqual(values(result, "Ordinary"), [1, 2, 3, 4]);
  assert.deepEqual(values(result, "Ticks"), [1, 2, 3, 4]);
  assert.deepEqual(values(result, "Historical"), [true, true, true, true]);
  assert.deepEqual(values(result, "Realtime"), [false, false, false, false]);
  assert.deepEqual(values(result, "Confirmed"), [true, true, true, true]);
  const history = Object.fromEntries(result.plots.map((plot) => [plot.name, structuredClone(plot.points)]));
  let current = await executor.execute(update(start, 1, bar(4, 50)));
  assert.equal(tail(current, "New"), true);
  for (let tick = 1; tick <= 64; tick++) {
    current = await executor.execute(update(start, tick + 1, bar(4, 50 + tick)));
    assert.equal(tail(current, "Ordinary"), 5);
    assert.equal(tail(current, "Ticks"), 5 + tick);
    assert.equal(tail(current, "EMA"), (30 + 50 + tick) / 2);
    assert.equal(tail(current, "New"), false);
    assert.equal(tail(current, "Confirmed"), false);
    for (const plot of current.plots) {
      assert.equal(plot.points.length, 5);
      assert.deepEqual(plot.points.slice(0, 4), history[plot.name]);
      assert.deepEqual(plot.points.map((point) => point.time), [...bars, bar(4, 0)].map((item) => item.time));
      assert.equal(new Set(plot.points.map((point) => point.time)).size, 5);
    }
    assert.equal(points(current, "EMA").at(-1).options.color, "#ff0000");
  }
  executor.dispose();
});

test("identical received OHLCV ticks and unchanged close each execute once without a synthetic close", async () => {
  const { executor, start } = await live();
  const open = bar(4, 50);
  const first = await executor.execute(update(start, 1, open));
  const identical = await executor.execute(update(start, 2, open));
  assert.equal(tail(first, "Ticks"), 5);
  assert.equal(tail(identical, "Ticks"), 6);
  assert.equal(tail(identical, "Ordinary"), 5);
  const close = await executor.execute(update(start, 3, open, true));
  assert.equal(tail(close, "Ticks"), 7);
  assert.equal(tail(close, "Confirmed"), true);
  const committed = Object.fromEntries(close.plots.map((plot) => [plot.name, structuredClone(plot.points)]));
  const next = await executor.execute(update(start, 4, bar(5, 60)));
  assert.equal(tail(next, "Ticks"), 8);
  assert.equal(tail(next, "Ordinary"), 6);
  assert.equal(tail(next, "New"), true);
  assert.equal(tail(next, "EMA"), 50);
  for (const plot of next.plots) assert.deepEqual(plot.points.slice(0, 5), committed[plot.name]);
  executor.dispose();
});

test("fresh source and input owners restart state rather than inherit a prior session", async () => {
  const first = await live();
  await first.executor.execute(update(first.start, 1, bar(4, 50)));
  first.executor.dispose();
  const changed = await live(source, bars, { in_0: 2 });
  assert.equal(changed.result.source, source);
  assert.deepEqual(changed.result.inputs, { in_0: 2 });
  assert.deepEqual(values(changed.result, "Ticks"), [2, 4, 6, 8]);
  const modifiedSource = source + '\nplot(close+100,"Different source")';
  const modified = await live(modifiedSource);
  assert.equal(modified.result.source, modifiedSource);
  assert.deepEqual(values(modified.result, "Ticks"), [1, 2, 3, 4]);
  assert.deepEqual(values(modified.result, "Different source"), [110, 120, 130, 140]);
  changed.executor.dispose();
  modified.executor.dispose();
});

test("skipped repeated and foreign sequence commands halt the owning executor", async () => {
  for (const kind of ["skip", "repeat", "foreign"]) {
    const { executor, start } = await live();
    await executor.execute(update(start, 1, bar(4, 50)));
    const command = update(start, kind === "repeat" ? 1 : kind === "skip" ? 3 : 2, bar(4, 51));
    if (kind === "foreign") command.sessionId = "independent-foreign-session";
    await assert.rejects(executor.execute(command), failure(kind === "foreign" ? "LIVE_SESSION_MISMATCH" : "LIVE_SEQUENCE"));
    await assert.rejects(executor.execute(update(start, 2, bar(4, 52))), failure("LIVE_SESSION_HALTED"));
    executor.dispose();
  }
});

test("concurrent start update and dispose during await cannot publish stale initialization", async () => {
  const executor = pine.createPineLiveExecutor();
  const start = initial();
  const pending = executor.execute(start);
  await assert.rejects(executor.execute(update(start, 1, bar(4, 50))), failure("LIVE_CONCURRENT"));
  await assert.rejects(pending, failure("LIVE_SESSION_HALTED"));
  const disposed = pine.createPineLiveExecutor();
  const beginning = disposed.execute(initial());
  disposed.dispose();
  await assert.rejects(beginning, failure("LIVE_SESSION_HALTED"));
});

test("invalid bars and committed history revisions fail closed without later output", async () => {
  for (const [candle, code] of [
    [{ ...bar(4, 50), close: Infinity }, "INVALID_MESSAGE"],
    [{ ...bar(4, 50), low: 60 }, "INVALID_BARS"],
    [{ ...bar(4, 50), volume: -1 }, "INVALID_BARS"],
  ]) {
    const { executor, start } = await live();
    await assert.rejects(executor.execute(update(start, 1, candle)), failure(code));
    await assert.rejects(executor.execute(update(start, 2, bar(4, 50))), failure("LIVE_SESSION_HALTED"));
  }
  const { executor, start } = await live();
  await assert.rejects(executor.execute(update(start, 1, bar(3, 41))), /committed|closed|history|revision/i);
  await assert.rejects(executor.execute(update(start, 2, bar(4, 50))), failure("LIVE_SESSION_HALTED"));
});

test("strategies and preparation requests never enter persistent indicator execution", async () => {
  const strategy = initial('//@version=6\nstrategy("No live strategy")\nplot(close)');
  await assert.rejects(pine.createPineLiveExecutor().execute(strategy), failure("LIVE_STRATEGY_UNAVAILABLE"));
  const prepare = initial();
  prepare.request.action = "prepare";
  await assert.rejects(pine.createPineLiveExecutor().execute(prepare), failure("INVALID_LIVE_MESSAGE"));
});

test("runtime failure and explicit disposal latch before subsequent commands", async () => {
  const { executor, start } = await live(script('if close==99\n    runtime.error("live oracle stop")\nplot(close,"Close")'));
  await assert.rejects(executor.execute(update(start, 1, bar(4, 99))), /live oracle stop/);
  await assert.rejects(executor.execute(update(start, 2, bar(4, 50))), failure("LIVE_SESSION_HALTED"));
  const fresh = await live();
  fresh.executor.dispose();
  fresh.executor.dispose();
  await assert.rejects(fresh.executor.execute(update(fresh.start, 1, bar(4, 50))), failure("LIVE_SESSION_HALTED"));
});

test("transferred packed snapshots detach their sender buffers while live engine state survives", async () => {
  const snapshot = Array.from({ length: 600 }, (_, index) => bar(index, index + 1));
  const packedSource = script(Array.from({ length: 8 }, (_, index) => `plot(close+${index},"Channel ${index}")`).join("\n"));
  const { executor, start, result } = await live(packedSource, snapshot);
  const envelope = pine.toPineWireResponse(`${start.sessionId}:0`, result, snapshot);
  assert.equal(envelope.encoding, "pine-packed-v1");
  assert.equal(envelope.buffers.length, 24);
  const before = envelope.buffers.map((buffer) => buffer.byteLength);
  assert.deepEqual(before, Array.from({ length: 8 }, () => [4800, 600, 1200]).flat());
  const received = structuredClone(envelope, { transfer: envelope.buffers });
  assert.ok(envelope.buffers.every((buffer) => buffer.byteLength === 0));
  const canonical = pine.validatePineResponse(received, start.request);
  assert.equal(pine.pointAtBar(canonical.plots[7], 599).value, 607);
  const nextBars = [...snapshot, bar(600, 700)];
  const next = await executor.execute(update(start, 1, nextBars.at(-1)));
  assert.equal(pine.pointAtBar(next.plots[7], 600).value, 707);
  assert.equal(pine.pointAtBar(next.plots[7], 599).value, 607);
  assert.equal(pine.pointAtBar(canonical.plots[7], 599).value, 607, "received historical snapshot stays intact");
  const second = pine.toPineWireResponse(`${start.sessionId}:1`, next, nextBars);
  assert.ok(second.buffers.every((buffer) => !received.buffers.includes(buffer)), "fresh result owns fresh transferable backing");
  executor.dispose();
});

test("live histories enforce the 20000-bar cap before an append can exceed it", async () => {
  const snapshot = Array.from({ length: 20_000 }, (_, index) => bar(index, index + 1));
  const { executor, start, result } = await live(script('plot(close,"Close")'), snapshot);
  assert.equal(result.audit.bars, 20_000);
  await assert.rejects(executor.execute(update(start, 1, bar(20_000, 20_001))), failure("BAR_LIMIT"));
  await assert.rejects(executor.execute(update(start, 2, bar(19_999, 20_000))), failure("LIVE_SESSION_HALTED"));
});
