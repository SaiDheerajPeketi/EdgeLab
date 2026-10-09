import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser", target: "es2020", write: false,
  logLevel: "silent", plugins: [createPineEnginePlugin()], stdin: { loader: "ts", resolveDir: process.cwd(), sourcefile: "pine-live-markets161.ts",
    contents: 'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineLiveMarkets.ts"; export * from "./frontend/src/lib/pineLiveProtocol.ts"; export * from "./frontend/src/lib/pineProtocol.ts";' } })).outputFiles[0].text;
console.info("LIVE_MARKETS161_BINDING " + JSON.stringify({ minified: true, sealedWorker: true,
  bundleSha256: createHash("sha256").update(bundle).digest("hex"), manifestSha256: createHash("sha256").update(fs.readFileSync("frontend/vendor/pinets/manifest.json")).digest("hex") }));
const moduleUrl = "data:text/javascript;base64," + Buffer.from(bundle).toString("base64");
const pine = await import(moduleUrl);
const start = Date.parse("2024-01-01T00:00:00Z") / 1000;
const bar = (time, close = 100, extra = {}) => ({ time, open: 100, high: Math.max(100, close), low: Math.min(100, close), close, volume: 10, ...extra });
const chart = [0, 1, 2].map(i => bar(start + i * 60));
const context = (symbol, timeframe = "1") => ({ symbol, timeframe, mintick: .01, pointvalue: 1, mincontract: 1, quantityStep: 1, currency: "USDT", basecurrency: symbol.includes("ETH") ? "ETH" : symbol.includes("SOL") ? "SOL" : "BTC" });
const binding = (symbol = "BINANCE:ETHUSDT", timeframe = "1", epoch = 3) => ({ symbol, timeframe, epoch });
const snapshot = (symbol = "BINANCE:ETHUSDT", requestedTimeframe = "1", bars = chart) => ({ context: context(symbol), requestedTimeframe, bars, asOf: start + 180 });
const source = '//@version=6\nindicator("Main161")\nvarip int n=0\nn+=1\nplot(n,"Executions")';
const request = (snapshots = [snapshot()], extra = {}) => pine.validatePineRequest({ id: "live-markets161:0", action: "run", mode: "live", source,
  inputs: {}, context: context("BINANCE:BTCUSDT"), bars: chart, marketData: { provider: "binance", snapshots }, ...extra });
const seed = (snapshots = [snapshot()], bindings = [binding()]) => pine.createPineLiveMarketLedger(request(snapshots), bindings);
const event = (sequence = 1, extra = {}) => {
  const candle = extra.bar ?? bar(start + 180, 101), timeframe = extra.timeframe ?? "1";
  let next = candle.time + (timeframe === "1W" ? 604800 : Number(timeframe) * 60);
  if (timeframe === "1M") { const date = new Date(candle.time * 1000); next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / 1000; }
  const closeTime = next * 1000 - 1;
  return { ...binding(), sequence, eventTime: extra.confirmed ? closeTime : candle.time * 1000 + sequence, closeTime, bar: candle, confirmed: false, ...extra };
};
const advance = (ledger, events, primary = { bars: chart }) => pine.advancePineLiveMarkets(ledger, events, primary);
const fail = code => error => { assert.equal(error.code, code, error.message); return true; };
const clone = value => structuredClone(value);
const payload = result => Object.fromEntries(["plots", "lines", "lineFills", "boxes", "labels", "tables", "polylines", "strategy"].map(key => [key, clone(result[key])]));
const values = (result, name) => result.plots.find(plot => plot.name === name).points.map(point => point.value);

test("validated requested target timeframes share one immutable native history and exact stream epoch", () => {
  const input = request([snapshot(), snapshot("BINANCE:ETHUSDT", "5", chart.slice(1))]);
  const ledger = pine.createPineLiveMarketLedger(input, [binding()]);
  assert.equal(ledger.length, 1); assert.deepEqual(ledger[0].requestedTimeframes, ["1", "5"]);
  assert.deepEqual(ledger[0].bars.map(bar => bar.time), chart.map(bar => bar.time));
  assert.equal(ledger[0].epoch, 3); assert.equal(ledger[0].sequence, 0); assert.equal(ledger[0].revision, 0);
  for (const value of [ledger, ledger[0], ledger[0].context, ledger[0].requestedTimeframes, ledger[0].bars, ...ledger[0].bars]) assert.equal(Object.isFrozen(value), true);
  input.marketData.snapshots[0].bars[0].close = 999;
  assert.equal(ledger[0].bars[0].close, 100); assert.throws(() => { ledger[0].bars[0].close = 999; }, TypeError);
  assert.throws(() => pine.createPineLiveMarketLedger(input, []), fail("INVALID_LIVE_MARKET"));
  assert.throws(() => pine.createPineLiveMarketLedger(request(), [binding(), binding("BINANCE:SOLUSDT")]), fail("INVALID_LIVE_MARKET"));
});

test("conflicting shared candles cannot silently select one requested interval's history", () => {
  const changed = chart.map(bar => ({ ...bar })); changed[1].volume = 11;
  const input = request([snapshot(), snapshot("BINANCE:ETHUSDT", "5", changed)]);
  assert.throws(() => pine.createPineLiveMarketLedger(input, [binding()]), fail("INVALID_LIVE_MARKET"));
});

test("received tick revisions, exact replay, confirmed repetition and next candle have independent transport order", () => {
  const initial = seed(), saved = JSON.stringify(initial), first = event();
  const opened = advance(initial, [first]); assert.equal(opened[0].revision, 1); assert.equal(opened[0].confirmed, false);
  assert.equal(opened[0].bars.length, 4); assert.equal(initial[0].bars.length, 3);
  const duplicate = advance(opened, [first]); assert.strictEqual(duplicate[0], opened[0]);
  const grown = event(2, { bar: bar(start + 180, 105, { high: 110, low: 90, volume: 15 }) });
  const progressed = advance(opened, [grown]); assert.equal(progressed[0].revision, 2); assert.equal(opened[0].bars.at(-1).close, 101);
  const closedEvent = event(3, { bar: grown.bar, confirmed: true }), closed = advance(progressed, [closedEvent]);
  assert.equal(closed[0].revision, 3); assert.equal(closed[0].confirmed, true);
  const repeated = advance(closed, [event(4, { bar: grown.bar, confirmed: true, eventTime: closedEvent.closeTime + 1 })]);
  assert.equal(repeated[0].sequence, 4); assert.equal(repeated[0].revision, 3); assert.strictEqual(repeated[0].bars, closed[0].bars);
  const next = advance(repeated, [event(5, { bar: bar(start + 240, 106) })]);
  assert.equal(next[0].revision, 4); assert.equal(next[0].bars.length, 5); assert.equal(JSON.stringify(initial), saved);
  assert.equal(Object.isFrozen(next[0].event), true); assert.equal(Object.isFrozen(next[0].event.bar), true);
  const normalized = pine.validatePineLiveMarketEvents([first]);
  assert.deepEqual(pine.validatePineLiveMarketEvents(normalized), normalized);
  assert.deepEqual(advance(initial, normalized), opened);
  grown.bar.close = 999; assert.equal(progressed[0].bars.at(-1).close, 105);
});

test("a later invalid batch member cannot partly commit another market or mutate prior histories", () => {
  const initial = seed([snapshot(), snapshot("BINANCE:SOLUSDT")], [binding(), binding("BINANCE:SOLUSDT")]);
  const before = JSON.stringify(initial), first = event(), wrong = event(2, { symbol: "BINANCE:SOLUSDT" });
  assert.throws(() => advance(initial, [first, wrong]), fail("INVALID_LIVE_MARKET"));
  assert.equal(JSON.stringify(initial), before);
  const accepted = advance(initial, [first, event(1, { symbol: "BINANCE:SOLUSDT" })]);
  assert.deepEqual(accepted.map(state => [state.sequence, state.revision]), [[1, 1], [1, 1]]);
  assert.deepEqual(initial.map(state => [state.sequence, state.revision]), [[0, 0], [0, 0]]);
  const closed = event(2, { confirmed: true, bar: first.bar });
  const appended = advance(accepted, [closed, event(3, { bar: bar(start + 240, 102) })]);
  assert.equal(appended[0].bars.length, 5); assert.equal(appended[0].sequence, 3);
});

test("canonical identities, dense arrays, ordinary data fields and bounded transport counters fail closed without running getters", () => {
  for (const item of [binding("ETHUSDT"), binding("binance:ethusdt"), binding("COINBASE:ETHUSDT"), binding(undefined, "1m"), binding(undefined, "7"), binding(undefined, "1", -1), binding(undefined, "1", 1e9 + 1)])
    assert.throws(() => pine.validatePineLiveMarketStreams([item]));
  assert.throws(() => pine.validatePineLiveMarketStreams([binding(), binding()]), fail("INVALID_LIVE_MARKET"));
  for (const mutate of [value => { delete value[0]; }, value => { value.extra = 1; }, value => { Object.setPrototypeOf(value, null); }, value => { Object.defineProperty(value, "0", { get() { throw new Error("Array getter ran"); }, enumerable: true }); }]) {
    const values = [binding()]; mutate(values); assert.throws(() => pine.validatePineLiveMarketStreams(values), fail("INVALID_LIVE_MARKET"));
  }
  let accessed = 0;
  for (const path of ["symbol", "bar", "volume"]) {
    const value = event(), target = path === "volume" ? value.bar : value;
    Object.defineProperty(target, path, { get() { accessed++; return 1; }, enumerable: true });
    assert.throws(() => pine.validatePineLiveMarketEvents([value]), fail("INVALID_LIVE_MARKET"));
  }
  assert.equal(accessed, 0);
  for (const patch of [{ sequence: 0 }, { sequence: 1e9 + 1 }, { confirmed: 1 }, { closeTime: 0 }, { eventTime: start * 1000 }, { epoch: -1 }, { unknown: true }, { bar: { ...event().bar, time: start + 181 } }])
    assert.throws(() => pine.validatePineLiveMarketEvents([event(1, patch)]));
  const missing = event(); delete missing.bar.volume; assert.throws(() => pine.validatePineLiveMarketEvents([missing]), fail("INVALID_LIVE_MARKET"));
  assert.throws(() => pine.validatePineLiveMarketEvents([]), fail("INVALID_LIVE_MARKET"));
  assert.throws(() => pine.validatePineLiveMarketEvents(Array.from({ length: 129 }, () => event())), fail("INVALID_LIVE_MARKET"));
  assert.equal(pine.validatePineLiveMarketEvents(Array.from({ length: 128 }, () => event())).length, 128);
});

test("epoch, exact sequence, confirmation, timestamp, candle range and cumulative volume are independently enforced", () => {
  const initial = seed(), opened = advance(initial, [event(1, { bar: bar(start + 180, 105, { high: 110, low: 90, volume: 15 }) })]);
  for (const update of [event(2, { epoch: 4 }), event(3), event(2, { symbol: "BINANCE:SOLUSDT" }), event(2, { eventTime: start * 1000 }),
    event(2, { eventTime: (start + 180) * 1000 }),
    event(2, { bar: bar(start + 240) }), event(2, { bar: bar(start + 180, 101, { open: 101, high: 110, low: 90, volume: 15 }) }),
    event(2, { bar: bar(start + 180, 101, { high: 109, low: 90, volume: 15 }) }), event(2, { bar: bar(start + 180, 101, { high: 110, low: 91, volume: 15 }) }),
    event(2, { bar: bar(start + 180, 101, { high: 110, low: 90, volume: 14 }) }), event(2, { confirmed: true, eventTime: (start + 180) * 1000 + 10 })])
    assert.throws(() => advance(opened, [update]));
  assert.throws(() => advance(initial, [event(1, { bar: bar(start + 120, 101) })]), fail("INVALID_LIVE_MARKET"));
  assert.throws(() => advance(initial, [event(1, { bar: bar(start + 240) })]), fail("INVALID_LIVE_MARKET"));
  const closed = advance(opened, [event(2, { confirmed: true, bar: opened[0].bars.at(-1) })]);
  assert.throws(() => advance(closed, [event(3, { bar: bar(start + 180, 106, { high: 110, low: 90, volume: 15 }) })]), fail("INVALID_LIVE_MARKET"));
  assert.equal(opened[0].sequence, 1); assert.equal(opened[0].bars.at(-1).volume, 15);
});

test("monthly leap-year closes and Monday weekly streams use actual calendar successors", () => {
  for (const [timeframe, first, next, following] of [["1M", "2024-01-01", "2024-02-01", "2024-03-01"], ["1W", "2024-01-01", "2024-01-08", "2024-01-15"]]) {
    const t = value => Date.parse(`${value}T00:00:00Z`) / 1000, bars = [bar(t(first))], cutoff = t(next);
    const input = pine.validatePineRequest({ ...request([]), context: context("BINANCE:BTCUSDT", timeframe), bars,
      marketData: { provider: "binance", snapshots: [{ context: context("BINANCE:ETHUSDT", timeframe), requestedTimeframe: timeframe, bars, asOf: cutoff }] } });
    const ledger = pine.createPineLiveMarketLedger(input, [binding(undefined, timeframe)]);
    const value = event(1, { timeframe, bar: bar(t(next), 102), confirmed: true });
    const accepted = advance(ledger, [value], { bars });
    assert.equal(value.closeTime, t(following) * 1000 - 1); assert.equal(accepted[0].bars.at(-1).time, t(next));
    assert.throws(() => advance(ledger, [event(1, { timeframe, bar: bar(t(next) + 86400), confirmed: true })], { bars }));
  }
});

test("pure counting budgets include primary source history and secondary append atomically", () => {
  const ledger = seed(), unchanged = JSON.stringify(ledger);
  // This is the pure API's counting boundary, not a fabricated worker history.
  const primary = { bars: { length: 199996 }, sourceSnapshot: { bars: { length: 1 } } };
  assert.throws(() => advance(ledger, [event()], primary), fail("BAR_LIMIT"));
  assert.equal(JSON.stringify(ledger), unchanged);
  const accepted = advance(ledger, [event()], { bars: { length: 199996 } }); assert.equal(accepted[0].bars.length, 4);
  assert.throws(() => pine.assertPineLiveMarketBudget(accepted, { bars: { length: 199997 } }), fail("BAR_LIMIT"));
  const large = Object.freeze([{ ...ledger[0], bars: Object.freeze(Array.from({ length: 100000 }, (_, i) => Object.freeze(pine.validatePineBar(bar(start - 99997 * 60 + i * 60, 12345678.901234567))))) }]);
  assert.ok(Buffer.byteLength(JSON.stringify(large)) > 16_000_000);
  assert.throws(() => advance(large, [event()], { bars: chart }), fail("REQUEST_LIMIT"));
});

test("empty requested histories accept an actual daily candle spanning a midday cutoff but never ended or pre-cutoff events", () => {
  const noon = start + 12 * 3600, cutoff = noon + 900;
  const input = request([], { bars: [bar(noon)], context: context("BINANCE:BTCUSDT", "15"), marketData: { provider: "binance", snapshots: [
    { context: context("BINANCE:ETHUSDT", "1D"), requestedTimeframe: "1D", bars: [], asOf: cutoff }] } });
  const initial = pine.createPineLiveMarketLedger(input, [binding(undefined, "1D")]);
  const active = { ...binding(undefined, "1D"), sequence: 1, bar: bar(start, 105), confirmed: false,
    closeTime: (start + 86400) * 1000 - 1, eventTime: cutoff * 1000 };
  const accepted = advance(initial, [active], input);
  assert.equal(accepted[0].bars.length, 1); assert.equal(accepted[0].bars[0].time, start); assert.equal(initial[0].bars.length, 0);
  assert.throws(() => advance(initial, [{ ...active, eventTime: cutoff * 1000 - 1 }], input), fail("INVALID_LIVE_MARKET"));
  assert.throws(() => advance(initial, [{ ...active, bar: bar(start - 86400), closeTime: start * 1000 - 1, confirmed: true }], input), fail("INVALID_LIVE_MARKET"));
});

test("an empty remote ledger preserves existing independent primary and source history budgets", () => {
  // Counting seam only: there are no foreign bars and no new combined budget.
  assert.doesNotThrow(() => pine.assertPineLiveMarketBudget(Object.freeze([]), { bars: { length: 20000 }, sourceSnapshot: { bars: { length: 200000 } } }));
  const input = request([]); assert.deepEqual(pine.createPineLiveMarketLedger(input, []), []);
});

test("acknowledgements match the exact owned ledger and cannot carry chart output, prices or stale stream fields", () => {
  const ledger = advance(seed(), [event()]), receipt = pine.pineLiveMarketReceipt(ledger);
  assert.deepEqual(receipt, { kind: "market-update", streams: [{ ...binding(), sequence: 1, revision: 1, confirmed: false, tailTime: start + 180 }] });
  assert.deepEqual(pine.validatePineLiveMarketReceipt(receipt, ledger), receipt);
  for (const key of ["symbol", "timeframe", "epoch", "sequence", "revision", "confirmed", "tailTime"]) {
    const stale = clone(receipt); stale.streams[0][key] = key === "confirmed" ? true : "wrong";
    assert.throws(() => pine.validatePineLiveMarketReceipt(stale, ledger), fail("INVALID_LIVE_MARKET"));
  }
  for (const invalid of [{ ...receipt, plots: [] }, { ...receipt, streams: [] }, { ...receipt, kind: "run" }, { ...receipt, streams: [{ ...receipt.streams[0], close: 101 }] }])
    assert.throws(() => pine.validatePineLiveMarketReceipt(invalid, ledger), fail("INVALID_LIVE_MARKET"));
  const sessionId = "live-market161-ack", expected = { ...request(), id: sessionId + ":1" };
  const command = { protocol: "pine-live-v1", sessionId, sequence: 1, action: "markets", events: [event()] };
  const wire = { protocol: "pine-live-v1", sessionId, sequence: 1, response: { id: expected.id, status: "completed", ack: receipt } };
  assert.deepEqual(pine.validatePineLiveMarketResponse(wire, command, expected, ledger), receipt);
  for (const invalid of [{ ...wire, sequence: 2 }, { ...wire, sessionId: "live-market161-other" }, { ...wire, response: { ...wire.response, result: {} } }, { ...wire, response: { ...wire.response, id: "stale" } }])
    assert.throws(() => pine.validatePineLiveMarketResponse(invalid, command, expected, ledger), fail("INVALID_LIVE_MESSAGE"));
});

test("genuine remote-only native events never execute main varip, drawing setters, barstate or a pending strategy order", async () => {
  const sessionId = "live-market161-main", executor = pine.createPineLiveExecutor();
  const source = `//@version=6
strategy("Remote isolation161",calc_on_every_tick=true,initial_capital=10000,overlay=true)
var int ordinary=0
varip int executions=0
ordinary+=1
executions+=1
plot(ordinary,"Ordinary")
plot(executions,"Executions")
plot(barstate.isnew,"New")
plot(barstate.isconfirmed,"Confirmed")
plot(barstate.isrealtime,"Realtime")
var line held=line.new(0,close,1,close)
line.set_y2(held,executions)
line.new(bar_index,close,bar_index+1,close)
label.new(bar_index,close,str.tostring(executions))
if bar_index==2
    strategy.entry("Main",strategy.long,qty=1,limit=80)`;
  let sequence = 0;
  const send = command => executor.execute({ protocol: "pine-live-v1", sessionId, sequence: ++sequence, ...command });
  const input = request([snapshot(), snapshot("BINANCE:ETHUSDT", "5")], { id: sessionId + ":0", source });
  try {
    const original = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 0, action: "start", request: input, marketStreams: [binding()] });
    const originalPayload = payload(original); assert.deepEqual(values(original, "Executions"), [1, 2, 3]);
    assert.equal(original.strategy.pendingOrders.length, 1); assert.equal(original.strategy.openTrades.length, 0);
    const remoteOpen = event(1, { bar: bar(start + 180, 70, { low: 60, high: 150, volume: 20 }) });
    const openedAck = await send({ action: "markets", events: [remoteOpen] });
    assert.deepEqual(openedAck, { kind: "market-update", streams: [{ ...binding(), sequence: 1, revision: 1, confirmed: false, tailTime: start + 180 }] });
    const remoteClose = event(2, { bar: remoteOpen.bar, confirmed: true });
    await send({ action: "markets", events: [remoteClose, event(3, { bar: bar(start + 240, 65, { low: 50, high: 200 }) })] });
    const quiet = await send({ action: "viewport", viewport: null });
    assert.deepEqual(payload(quiet), originalPayload); assert.deepEqual(payload(original), originalPayload);
    const actual = await send({ action: "update", bar: bar(start + 180, 70), confirmed: false });
    assert.deepEqual(values(actual, "Executions"), [1, 2, 3, 4]); assert.deepEqual(values(actual, "Ordinary"), [1, 2, 3, 4]);
    assert.equal(actual.strategy.openTrades.length, 1); assert.equal(actual.strategy.openTrades[0].entry_price, 70);
    assert.equal(actual.strategy.openTrades[0].entry_bar_index, 3); assert.equal(actual.strategy.pendingOrders.length, 0);
    assert.equal(actual.labels.length, 4); assert.equal(actual.lines.length, 5);
    const actualPayload = payload(actual);
    await send({ action: "markets", events: [event(4, { bar: bar(start + 240, 60, { low: 50, high: 200, volume: 15 }) })] });
    const quietOpen = await send({ action: "viewport", viewport: null }); assert.deepEqual(payload(quietOpen), actualPayload);
    const closed = await send({ action: "update", bar: bar(start + 180, 75), confirmed: true });
    assert.deepEqual(values(closed, "Executions"), [1, 2, 3, 5]); assert.deepEqual(values(closed, "Ordinary"), [1, 2, 3, 4]);
    assert.deepEqual(values(closed, "Confirmed"), [true, true, true, true]);
  } finally { executor.dispose(); }
});

test("actual minified worker message handler publishes only an owned market ack and rejects chart-result substitution", async () => {
  const previous = globalThis.self, sent = [], scope = { postMessage(value) { sent.push(value); } };
  globalThis.self = scope;
  try {
    const api = await import(moduleUrl + "#wire161"), sessionId = "live-market161-wire";
    const input = request(undefined, { id: sessionId + ":0" });
    await scope.onmessage({ data: { protocol: "pine-live-v1", sessionId, sequence: 0, action: "start", request: input, marketStreams: [binding()] } });
    assert.equal(sent[0].response.status, "completed"); assert.equal(sent[0].response.result.kind, "run");
    const command = { protocol: "pine-live-v1", sessionId, sequence: 1, action: "markets", events: [event()] };
    await scope.onmessage({ data: command });
    const ledger = api.advancePineLiveMarkets(api.createPineLiveMarketLedger(api.validatePineRequest(input), [binding()]), command.events, input);
    assert.deepEqual(Object.keys(sent[1].response).sort(), ["ack", "id", "status"]);
    assert.deepEqual(api.validatePineLiveMarketResponse(sent[1], command, { ...input, id: sessionId + ":1" }, ledger), api.pineLiveMarketReceipt(ledger));
    assert.throws(() => api.validatePineLiveResponse(sent[1], command, { ...input, id: sessionId + ":1" }), error => error.code === "INVALID_LIVE_MESSAGE");
    await scope.onmessage({ data: { ...command, sequence: 2, events: [event(2, { epoch: 99 })] } });
    assert.equal(sent[2].response.status, "failed"); assert.equal(sent[2].response.error.code, "INVALID_LIVE_MARKET");
    await scope.onmessage({ data: { ...command, sequence: 3, events: [event(2)] } });
    assert.equal(sent[3].response.error.code, "LIVE_SESSION_HALTED");
  } finally { if (previous === undefined) delete globalThis.self; else globalThis.self = previous; }
});

test("foreign realtime expressions stay refused without an independently admitted stream", async () => {
  const executor = pine.createPineLiveExecutor(), sessionId = "live-market161-refusal";
  try {
    await assert.rejects(executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 0, action: "start",
      request: request(undefined, { id: sessionId + ":0", source: '//@version=6\nindicator("No premature realtime161")\nplot(request.security("ETHUSDT","1",close))' }) }), fail("UNAVAILABLE_DATA"));
  } finally { executor.dispose(); }
});
