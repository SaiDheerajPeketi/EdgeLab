import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;

// Genuine compiled condition samples feed the actual store. Only provider data,
// receipt clock and source ownership are controlled; no calculated replies are substituted.
const compiled = (await build({ bundle: true, minify: true, format: "esm", platform: "browser", write: false,
  logLevel: "silent", plugins: [createPineEnginePlugin()], stdin: { loader: "ts", resolveDir: process.cwd(), contents:
    'export * from "./frontend/src/workers/pineNative.worker";export * from "./frontend/src/lib/pineChartAlerts";' } })).outputFiles[0].text;
const hash = x => createHash("sha256").update(x).digest("hex");
console.info("CONDITION_DELIVERY184_BINDING " + JSON.stringify({ actualWorker: true, actualStore: true, minified: true,
  bundleSha256: hash(compiled), manifestSha256: hash(fs.readFileSync("frontend/vendor/pinets/manifest.json")) }));
const api = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));
const origin = Date.UTC(2024, 0, 1) / 1000;
const context = { symbol: "BINANCE:BTCUSDT", timeframe: "1", mintick: .01, pointvalue: 1, mincontract: .001,
  quantityStep: .001, currency: "USDT", basecurrency: "BTC" };
const candle = (index, close = 100 + index) => ({ time: origin + index * 60, open: 100, high: Math.max(103, close + 1), low: 97, close, volume: 10 + index });
const message = '{{ticker}} {{exchange}} {{interval}} {{close}} {{plot_0}} {{plot("After")}} {{timenow}}';
const body = `threshold=input.float(110,"Threshold")\nalertcondition(close>threshold,"Duplicate",${JSON.stringify(message)})\nalertcondition(barstate.isconfirmed,"Duplicate","Closed {{time}} {{close}}")\nplot(close+1,"After",offset=2,display=display.none)`;
let serial = 0;
async function fixture(frequency = "all", version = 6, extra = {}) {
  const executor = api.createPineLiveExecutor(), sessionId = "condition-delivery184-" + ++serial;
  const input = { id: sessionId + ":0", action: "run", mode: "live", source: `//@version=${version}\nindicator("Delivery184")\n${body}`,
    inputs: { in_0: 115 }, bars: [0, 1, 2].map(i => candle(i)), context, ...extra };
  const initial = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 0, action: "start", request: input });
  const current = { epoch: 7, sequence: 10 }, state = { conditions: initial.alertConditions, timeframe: "1",
    frontier: { time: candle(2).time, confirmed: true }, context: input.context, primaryCutoff: candle(3).time };
  let commandSequence = 0, receiptNow = Date.UTC(2024, 0, 1, 1, 2, 3), owned = true, onDelivery;
  const deliveries = [], store = new api.PineChartAlertStore({ ownsAccount: () => owned, now: () => receiptNow,
    deliver: signal => { deliveries.push(signal); onDelivery?.(signal); } });
  const handle = store.register({ name: "Delivery184", symbol: context.symbol, timeframe: "1m", readCurrent: () => ({ ...current }),
    owns: () => owned, readConditions: () => structuredClone(state) });
  assert.ok(handle); handle.setReady(initial.alertConditions);
  assert.equal(store.configure(handle.id, { conditionId: "alertcondition_0", frequency }), true);
  assert.equal(store.setEnabled(handle.id, true), true);
  return { executor, initial, store, handle, current, state, deliveries, input,
    now(value) { receiptNow = value; }, own(value) { owned = value; },
    onDelivery(callback) { onDelivery = callback; },
    arm(conditionId = "alertcondition_0", nextFrequency = frequency) {
      assert.equal(store.configure(handle.id, { conditionId, frequency: nextFrequency }), true);
      assert.equal(store.setEnabled(handle.id, true), true);
    },
    capture() { current.sequence++; const receipt = handle.capture(current.epoch, current.sequence); assert.notEqual(receipt, undefined);
      assert.equal(handle.collectConditions(receipt), true); return receipt; },
    async calculate(bar, confirmed = false, collect = true) {
      return executor.execute({ protocol: "pine-live-v1", sessionId, sequence: ++commandSequence, action: "update", bar, confirmed,
        ...(collect ? { collectConditions: true } : {}) });
    },
    async tick(bar, confirmed = false) { const receipt = this.capture(), result = await this.calculate(bar, confirmed);
      handle.receive(receipt, result.alertEvents, result.conditionSamples); return result; },
    close() { executor.dispose(); store.reset(); },
  };
}

test("v5/v6 selected conditions honor all, once, native per-bar and close frequencies using genuine repeated executions", async () => {
  for (const version of [5, 6]) for (const frequency of ["all", "once", "once_per_bar", "once_per_bar_close"]) {
    const h = await fixture(frequency, version); try {
      await h.calculate(candle(3, 120), false, false); // Unarmed/native once gates cannot consume subscriber eligibility.
      await h.tick(candle(3, 114)); await h.tick(candle(3, 116));
      if (frequency !== "once") {
        await h.tick(candle(3, 114)); await h.tick(candle(3, 117)); await h.tick(candle(3, 118), true);
        await h.tick(candle(4, 119)); await h.tick(candle(4, 120), true);
      }
      const expected = frequency === "all" ? [116, 117, 118, 119, 120] : frequency === "once" ? [116]
        : frequency === "once_per_bar" ? [116, 119] : [118, 120];
      assert.deepEqual(h.deliveries.map(signal => Number(signal.message.split(" ")[3])), expected);
      assert.equal(h.store.getSnapshot().events.length, expected.length);
      assert.equal(h.store.getSnapshot().sources[0].enabled, frequency !== "once");
      assert.equal(h.store.getSnapshot().sources[0].ready, true);
      assert.equal(Object.hasOwn(h.initial, "conditionSamples"), false);
    } finally { h.close(); }
  }
});

test("messages use raw completed plots, custom threshold and captured receipt time rather than completion time", async () => {
  const h = await fixture(); try {
    const receipt = h.capture(); h.now(Date.UTC(2025, 1, 2));
    const result = await h.calculate(candle(3, 116));
    assert.deepEqual(result.conditionSamples.samples[0].plots.numbered, [117]);
    h.handle.receive(receipt, undefined, result.conditionSamples);
    assert.equal(h.deliveries[0].message, "BTCUSDT BINANCE 1 116 117 117 2024-01-01T01:02:03Z");
    assert.equal(h.deliveries[0].receivedAt, Date.UTC(2024, 0, 1, 1, 2, 3));
    assert.equal(h.store.getSnapshot().toast.message, h.deliveries[0].message);
    h.handle.receive(receipt, undefined, result.conditionSamples); assert.equal(h.deliveries.length, 1);
  } finally { h.close(); }
});

test("arming snapshots both native closed/forming frontier and primary clock and excludes old catch-up samples", async () => {
  for (const confirmed of [true, false]) {
    const h = await fixture(); try {
      h.state.frontier = { time: candle(3).time, confirmed };
      h.state.primaryCutoff = candle(4).time;
      h.arm();
      const receipt = h.capture(); // Advance getter after capture; receipt owns the original dual gate.
      h.state.frontier = { time: candle(6).time, confirmed: true }; h.state.primaryCutoff = candle(6).time;
      const old = await h.calculate(candle(3, 116)); h.handle.receive(receipt, undefined, old.conditionSamples);
      assert.equal(h.deliveries.length, 0);
      h.state.frontier = { time: candle(3).time, confirmed }; h.state.primaryCutoff = candle(3).time;
      h.arm(); await h.tick(candle(3, 117));
      assert.equal(h.deliveries.length, confirmed ? 0 : 1);
      await h.tick(candle(3, 118), true); await h.tick(candle(4, 119));
      assert.equal(h.deliveries.at(-1).time, candle(4).time);
    } finally { h.close(); }
  }
});

test("duplicate titles select authored IDs; configure retires pending replies and never replays old history", async () => {
  const h = await fixture(); try {
    assert.deepEqual(h.store.getSnapshot().sources[0].conditions.map(x => x.id), ["alertcondition_0", "alertcondition_1"]);
    const receipt = h.capture(), result = await h.calculate(candle(3, 116));
    h.arm("alertcondition_1", "all"); h.handle.receive(receipt, undefined, result.conditionSamples);
    assert.equal(h.deliveries.length, 0); await h.tick(candle(3, 117)); assert.equal(h.deliveries.length, 0);
    await h.tick(candle(3, 118), true); assert.equal(h.deliveries.length, 1);
    assert.equal(h.deliveries[0].message, "Closed 2024-01-01T00:03:00Z 118");
    assert.equal(h.store.configure(h.handle.id, { conditionId: "alertcondition_99" }), false);
    assert.equal(h.store.getSnapshot().events.length, 1);
  } finally { h.close(); }
});

test("one actual primary command delivers each eligible chronological native calculation rather than only the latest toast", async () => {
  const history = Array.from({ length: 15 }, (_, i) => candle(i));
  const aggregate = rows => ({ time: Math.floor(rows[0].time / 300) * 300, open: rows[0].open,
    high: Math.max(...rows.map(bar => bar.high)), low: Math.min(...rows.map(bar => bar.low)), close: rows.at(-1).close,
    volume: rows.reduce((sum, bar) => sum + bar.volume, 0) });
  const executor = api.createPineLiveExecutor(), sessionId = "delivery184-catchup", binding = { symbol: context.symbol, timeframe: "1", epoch: 3 };
  const input = { id: sessionId + ":0", action: "run", mode: "live", context: { ...context, timeframe: "5" }, inputs: {},
    source: '//@version=6\nindicator("Catchup184",timeframe="1",timeframe_gaps=false)\nalertcondition(true,"Every native bar","{{close}}/{{plot_0}}")\nplot(close+1,"Raw",display=display.none)',
    bars: [history.slice(0, 5), history.slice(5, 10), history.slice(10, 15)].map(aggregate),
    marketData: { provider: "binance", snapshots: [{ context, requestedTimeframe: "1", bars: history, asOf: origin + 900 }] } };
  const initial = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 0, action: "start", request: input, marketStreams: [binding] });
  const deliveries = [], current = { epoch: 7, sequence: 10 };
  const store = new api.PineChartAlertStore({ ownsAccount: () => true, now: () => Date.UTC(2024, 0, 1), deliver: signal => deliveries.push(signal) });
  const handle = store.register({ name: "Catchup184", symbol: context.symbol, timeframe: "5m", owns: () => true, readCurrent: () => current,
    readConditions: () => ({ conditions: initial.alertConditions, timeframe: "1", context,
      frontier: { time: candle(14).time, confirmed: true }, primaryCutoff: candle(15).time }) });
  try {
    handle.setReady(initial.alertConditions); assert.equal(store.configure(handle.id, { conditionId: "alertcondition_0", frequency: "all" }), true);
    assert.equal(store.setEnabled(handle.id, true), true); current.sequence++;
    const receipt = handle.capture(7, current.sequence), children = [15, 16, 17, 18].map(i => candle(i));
    assert.equal(handle.collectConditions(receipt), true);
    const ack = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 1, action: "markets", events: children.map((bar, i) => ({ ...binding,
      sequence: i + 1, bar, confirmed: i !== 3, closeTime: (bar.time + 60) * 1000 - 1,
      eventTime: i === 3 ? bar.time * 1000 + 1 : (bar.time + 60) * 1000 - 1 })) });
    assert.equal(ack.kind, "market-update"); assert.equal(deliveries.length, 0);
    const result = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 2, action: "update", bar: aggregate(children), confirmed: false, collectConditions: true });
    assert.deepEqual(result.conditionSamples.samples.map(x => x.confirmed), [true, true, true, false]);
    handle.receive(receipt, undefined, result.conditionSamples);
    assert.deepEqual(deliveries.map(x => x.message), ["115/116", "116/117", "117/118", "118/119"]);
    assert.deepEqual(store.getSnapshot().events.map(x => x.message), ["118/119", "117/118", "116/117", "115/116"]);
    assert.equal(store.getSnapshot().toast.message, "118/119");
  } finally { executor.dispose(); store.reset(); }
});

test("missing, hostile and overflow collected responses pause a source without replaying or changing engine output", async () => {
  for (const mode of ["missing", "accessor", "overflow"]) {
    const h = await fixture(); try {
      const receipt = h.capture(), result = await h.calculate(candle(3, 116)); let reads = 0;
      let batch = result.conditionSamples;
      if (mode === "missing") batch = undefined;
      if (mode === "accessor") { batch = { ...batch }; Object.defineProperty(batch, "samples", { enumerable: true, get() { reads++; return result.conditionSamples.samples; } }); }
      if (mode === "overflow") batch = { ...batch, dropped: 2 };
      assert.doesNotThrow(() => h.handle.receive(receipt, undefined, batch)); assert.equal(reads, 0);
      const snapshot = h.store.getSnapshot(); assert.equal(snapshot.sources[0].enabled, false); assert.ok(snapshot.sources[0].reason);
      assert.equal(h.deliveries.length, mode === "overflow" ? 1 : 0);
      h.handle.receive(receipt, undefined, result.conditionSamples); assert.equal(h.deliveries.length, mode === "overflow" ? 1 : 0);
      assert.equal(result.plots.find(plot => plot.name === "After").points.at(-1).value, 117);
    } finally { h.close(); }
  }
});

test("once auto-pause requires explicit rearm; source/account retirement fences held genuine samples", async () => {
  const h = await fixture("once"); try {
    await h.tick(candle(3, 116)); assert.equal(h.store.getSnapshot().sources[0].enabled, false);
    assert.equal(h.handle.capture(7, ++h.current.sequence), undefined);
    assert.equal(h.store.setEnabled(h.handle.id, true), true); await h.tick(candle(3, 117)); assert.equal(h.deliveries.length, 2);
    h.arm("alertcondition_0", "all"); const receipt = h.capture(), result = await h.calculate(candle(3, 118));
    h.store.reset(); h.handle.receive(receipt, undefined, result.conditionSamples);
    assert.equal(h.deliveries.length, 2); assert.deepEqual(h.store.getSnapshot().sources, []); assert.deepEqual(h.store.getSnapshot().events, []);
  } finally { h.close(); }
});

test("armed definitions are immutable copies and disabled ownership or disposed pane cannot deliver a held native response", async () => {
  const h = await fixture(); try {
    const receipt = h.capture(), result = await h.calculate(candle(3, 116));
    h.initial.alertConditions[0].message = "Mutated startup";
    h.store.getSnapshot().sources[0].conditions[0].message = "Mutated public snapshot";
    h.handle.receive(receipt, undefined, result.conditionSamples);
    assert.equal(h.deliveries[0].message, "BTCUSDT BINANCE 1 116 117 117 2024-01-01T01:02:03Z");
    const retired = h.capture(), actual = await h.calculate(candle(3, 117));
    h.own(false); h.handle.receive(retired, undefined, actual.conditionSamples); assert.equal(h.deliveries.length, 1);
    h.own(true); const removed = h.capture(), tail = await h.calculate(candle(3, 118));
    h.handle.dispose(); h.handle.receive(removed, undefined, tail.conditionSamples); assert.equal(h.deliveries.length, 1);
  } finally { h.close(); }
});

test("reentrant delivery cannot fire once twice or let a retired receipt pause a freshly configured arm", async () => {
  const once = await fixture("once"); try {
    const first = once.capture(), firstResult = await once.calculate(candle(3, 116));
    const second = once.capture(), secondResult = await once.calculate(candle(3, 117));
    once.onDelivery(() => once.handle.receive(second, undefined, secondResult.conditionSamples));
    once.handle.receive(first, undefined, firstResult.conditionSamples);
    assert.equal(once.deliveries.length, 1); assert.equal(once.store.getSnapshot().events.length, 1);
    assert.equal(once.store.getSnapshot().sources[0].enabled, false);
  } finally { once.close(); }
  for (const overflow of [false, true]) {
    const h = await fixture("once"); try {
      const receipt = h.capture(), result = await h.calculate(candle(3, 116));
      h.onDelivery(() => h.arm("alertcondition_1", "all"));
      h.handle.receive(receipt, undefined, { ...result.conditionSamples, ...(overflow ? { dropped: 2 } : {}) });
      const current = h.store.getSnapshot().sources[0];
      assert.equal(current.conditionId, "alertcondition_1"); assert.equal(current.enabled, true); assert.equal(current.reason, undefined);
      h.onDelivery(undefined); await h.tick(candle(3, 118), true);
      assert.equal(h.deliveries.length, 2); assert.equal(h.deliveries[1].message, "Closed 2024-01-01T00:03:00Z 118");
    } finally { h.close(); }
  }
});
