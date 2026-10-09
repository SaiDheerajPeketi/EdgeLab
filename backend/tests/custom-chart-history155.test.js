import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({ stdin: { contents: 'export * from "./frontend/src/lib/binanceChartFeed.ts"; export * from "./frontend/src/lib/chartSourceWindow.ts"; export * from "./frontend/src/lib/pineLiveFeed.ts";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent" });
const { binanceChartPlan, loadBinanceChartHistory, trimChartSourceWindow, createPineLiveFeed, pineFeedChartSnapshot } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const candle = (index, seconds = 3600) => ({ time: index * seconds, open: 100 + index, high: 103 + index, low: 98 + index, close: 102 + index, volume: index + 10 });
const row = bar => [bar.time * 1000, String(bar.open), String(bar.high), String(bar.low), String(bar.close), String(bar.volume), (bar.time + 3600) * 1000 - 1];
const signal = () => new AbortController().signal;
const prices = bars => bars.map(({ time, open, high, low, close, volume }) => ({ time, open, high, low, close, volume }));

test("custom plans select the largest aligned source and remain bounded", () => {
  for (const [frame, source, interval, target] of [["3H", "1H", "1h", 3002], ["7m", "1m", "1m", 7006], ["5H", "1H", "1h", 5004], ["2W", "1D", "1d", 14013], ["19H", "1H", "1h", 16000]]) {
    assert.deepEqual(binanceChartPlan(frame), { chartTimeframe: frame, sourceTimeframe: source, interval, targetBars: target });
  }
  assert.equal(binanceChartPlan("1M").interval, "1M");
  assert.equal(binanceChartPlan("1H").targetBars, 1000);
  assert.equal(binanceChartPlan("invalid"), null);
});

test("backward pagination retains ordered native history with decreasing exclusive cursors", async () => {
  const bars = Array.from({ length: 4000 }, (_, index) => candle(index + 10)), requests = [];
  const history = await loadBinanceChartHistory("BTCUSDT", binanceChartPlan("3H"), { signal: signal(), fetcher: async url => {
    const query = new URL(url).searchParams, limit = Number(query.get("limit")), before = query.has("endTime") ? Number(query.get("endTime")) : Infinity;
    requests.push({ limit, before });
    return { ok: true, json: async () => bars.filter(bar => bar.time * 1000 <= before).slice(-limit).map(row) };
  } });
  assert.equal(history.length, 3002);
  assert.deepEqual(prices(history), bars.slice(-3002));
  assert.deepEqual(requests.map(request => request.limit), [1000, 1000, 1000, 2]);
  assert.ok(requests.every((request, index) => !index || request.before < requests[index - 1].before));
});

test("a short or empty older page is honest exhaustion without padding", async () => {
  for (const count of [20, 1000, 1200]) {
    const bars = Array.from({ length: count }, (_, index) => candle(index + 10)); let calls = 0;
    const history = await loadBinanceChartHistory("BTCUSDT", binanceChartPlan("3H"), { signal: signal(), fetcher: async url => {
      calls++; const query = new URL(url).searchParams, before = query.has("endTime") ? Number(query.get("endTime")) : Infinity;
      return { ok: true, json: async () => bars.filter(bar => bar.time * 1000 <= before).slice(-Number(query.get("limit"))).map(row) };
    } });
    assert.deepEqual(prices(history), bars); assert.ok(calls <= 2);
  }
});

test("missing, repeated, oversized and misaligned provider pages fail closed", async () => {
  const good = Array.from({ length: 1000 }, (_, index) => candle(index + 2000)).map(row);
  for (const older of [good, [row(candle(1998))], Array.from({ length: 1001 }, (_, index) => row(candle(index))), [[3600001, "100", "103", "98", "102", "10", 7200000]]]) {
    let calls = 0;
    await assert.rejects(loadBinanceChartHistory("BTCUSDT", binanceChartPlan("3H"), { signal: signal(), fetcher: async () => ({ ok: true, json: async () => ++calls === 1 ? good : older }) }));
    assert.equal(calls, 2);
  }
});

test("retiring an owner after a received page prevents the next request", async () => {
  let owned = true, requests = 0;
  await assert.rejects(loadBinanceChartHistory("BTCUSDT", binanceChartPlan("3H"), { signal: signal(), owns: () => owned, fetcher: async () => {
    requests++; return { ok: true, json: async () => { owned = false; return Array.from({ length: 1000 }, (_, index) => row(candle(index))); } };
  } }), { name: "AbortError" });
  assert.equal(requests, 1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(loadBinanceChartHistory("BTCUSDT", binanceChartPlan("3H"), { signal: controller.signal, fetcher: async () => { throw Error("A retired request reached the provider"); } }), { name: "AbortError" });
});

test("partial leading buckets are omitted while complete history and current constituents remain intact", () => {
  const bars = Array.from({ length: 8 }, (_, index) => candle(index + 1)), before = structuredClone(bars);
  assert.deepEqual(trimChartSourceWindow(bars, "3H"), bars.slice(2));
  assert.deepEqual(bars, before);
  const aligned = bars.slice(2); assert.equal(trimChartSourceWindow(aligned, "3H"), aligned);
  const empty = []; assert.equal(trimChartSourceWindow(empty, "3H"), empty);
  assert.deepEqual(trimChartSourceWindow([candle(1), candle(2)], "3H"), []);
});

for (const [target, source, seconds, ratio] of [["3H", "1H", 3600, 3], ["7m", "1m", 60, 7]]) test(`${target}: live OHLCV includes actual constituents and confirms only at the closing child`, () => {
  const feed = createPineLiveFeed("BTCUSDT", source);
  feed.seed(Array.from({ length: ratio * 2 - 1 }, (_, index) => candle(index + 1, seconds)));
  const receive = (index, confirmed) => { const bar = candle(index, seconds); feed.receive(bar, confirmed, index * 2 + (confirmed ? 1 : 0), (bar.time + seconds) * 1000 - 1); };
  for (let index = ratio * 2; index < ratio * 3; index++) {
    receive(index, false); let chart = pineFeedChartSnapshot(feed.getSnapshot(), target);
    assert.equal(chart.history.length, 1); assert.equal(chart.history[0].time, ratio * seconds);
    assert.equal(chart.history[0].open, 100 + ratio); assert.equal(chart.history[0].close, 102 + ratio * 2 - 1);
    assert.equal(chart.bar.time, ratio * 2 * seconds); assert.equal(chart.bar.open, 100 + ratio * 2);
    assert.equal(chart.bar.volume, Array.from({ length: index - ratio * 2 + 1 }, (_, offset) => ratio * 2 + offset + 10).reduce((a, b) => a + b, 0));
    assert.equal(chart.confirmed, false);
    receive(index, true); chart = pineFeedChartSnapshot(feed.getSnapshot(), target);
    assert.equal(chart.confirmed, index === ratio * 3 - 1);
  }
});

test("an incomplete sole developing bucket waits instead of failing a live study", () => {
  const feed = createPineLiveFeed("BTCUSDT", "1H"); feed.seed([candle(1)]);
  const bar = candle(2); feed.receive(bar, false, 1, (bar.time + 3600) * 1000 - 1);
  assert.equal(pineFeedChartSnapshot(feed.getSnapshot(), "3H"), null);
  assert.equal(feed.getSnapshot().error, null);
});
