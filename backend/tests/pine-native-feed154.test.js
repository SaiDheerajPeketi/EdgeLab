import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const bundle = await build({ entryPoints: [fileURLToPath(new URL("../../frontend/src/lib/pineLiveFeed.ts", import.meta.url))], bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent" });
const { createPineLiveFeed, pineFeedChartSnapshot, pineFeedNextSourceTime } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const utc = value => Date.parse(value) / 1000;
const candle = (time, close = 100) => ({ time, open: close - 1, high: close + 2, low: close - 2, close, volume: 10 });
const receive = (feed, time, confirmed, eventTime, close = 100) => feed.receive(candle(time, close), confirmed, eventTime, pineFeedNextSourceTime(time, feed.getSnapshot().sourceTimeframe) * 1000 - 1);
const times = (start, frame, count) => {
  const values = [start];
  for (let index = 1; index < count; index++) values.push(pineFeedNextSourceTime(values.at(-1), frame));
  return values;
};

test("all native Binance UTC intervals seed actual candles and advance after explicit closes", () => {
  for (const frame of ["1m", "3m", "5m", "15m", "30m", "1H", "2H", "4H", "6H", "8H", "12H", "1D", "1W", "1M"]) {
    const starts = times(utc("2024-01-01T00:00:00Z"), frame, 4);
    const feed = createPineLiveFeed("BTCUSDT", frame);
    feed.seed(starts.slice(0, 3).map(time => candle(time)));
    receive(feed, starts[2], false, 1, 105);
    assert.equal(pineFeedChartSnapshot(feed.getSnapshot(), frame).confirmed, false, frame);
    receive(feed, starts[2], true, 2, 106);
    assert.equal(pineFeedChartSnapshot(feed.getSnapshot(), frame).confirmed, true, frame);
    receive(feed, starts[3], false, 3, 107);
    const chart = pineFeedChartSnapshot(feed.getSnapshot(), frame);
    assert.equal(feed.getSnapshot().sourceTimeframe, frame);
    assert.equal(feed.getSnapshot().error, null, frame);
    assert.deepEqual(chart.history.map(bar => bar.time), starts.slice(0, 3), frame);
    assert.equal(chart.bar.time, starts[3]);
    assert.equal(chart.confirmed, false);
  }
  assert.throws(() => createPineLiveFeed("BTCUSDT", "7m"), /does not support/);
});

test("monthly source uses real month ends including leap February and the year boundary", () => {
  const dates = ["2023-12-01", "2024-01-01", "2024-02-01", "2024-03-01", "2024-04-01"].map(date => utc(`${date}T00:00:00Z`));
  for (let index = 0; index < dates.length - 1; index++) assert.equal(pineFeedNextSourceTime(dates[index], "1M"), dates[index + 1]);
  assert.equal((dates[3] - dates[2]) / 86400, 29);
  const feed = createPineLiveFeed("BTCUSDT", "1M");
  feed.seed(dates.slice(0, 3).map(time => candle(time)));
  receive(feed, dates[3], true, 1, 112);
  const chart = pineFeedChartSnapshot(feed.getSnapshot(), "1M");
  assert.equal(chart.history.length, 3);
  assert.equal(chart.bar.close, 112);
  assert.equal(chart.confirmed, true);
  assert.equal(feed.getSnapshot().bars.length, 4); // No synthetic minute expansion.
});

test("late monthly REST excludes its provisional tail and preserves queued authoritative updates", () => {
  const dates = times(utc("2024-01-01T00:00:00Z"), "1M", 6);
  const feed = createPineLiveFeed("BTCUSDT", "1M"), observed = [];
  feed.subscribe(snapshot => { if (snapshot.event) observed.push([snapshot.event.sequence, snapshot.event.confirmed, snapshot.bars.at(-1).close]); });
  receive(feed, dates[3], false, 1, 150);
  receive(feed, dates[3], true, 2, 151);
  receive(feed, dates[4], false, 3, 152);
  feed.seed(dates.map((time, index) => candle(time, 10 + index)));
  assert.deepEqual(observed, [[1, false, 150], [2, true, 151], [3, false, 152]]);
  assert.deepEqual(feed.getSnapshot().bars.map(bar => bar.close), [10, 11, 12, 151, 152]);
  assert.equal(feed.getSnapshot().error, null);
  assert.equal(pineFeedChartSnapshot(feed.getSnapshot(), "1M").history.at(-1).close, 151);
  feed.reset();
  assert.equal(feed.getSnapshot().sourceTimeframe, "1M");
  assert.equal(feed.getSnapshot().epoch, 1);
  assert.deepEqual(feed.getSnapshot().bars, []);
});

test("daily source confirms a Monday-aligned week only on Sunday's explicit closing event", () => {
  const starts = times(utc("2024-02-05T00:00:00Z"), "1D", 8);
  const feed = createPineLiveFeed("BTCUSDT", "1D");
  feed.seed([candle(starts[0], 100)]);
  for (let index = 0; index < 7; index++) {
    receive(feed, starts[index], false, index * 2 + 1, 100 + index);
    let chart = pineFeedChartSnapshot(feed.getSnapshot(), "1W");
    assert.equal(chart.bar.time, starts[0]);
    assert.equal(chart.confirmed, false);
    receive(feed, starts[index], true, index * 2 + 2, 100 + index);
    chart = pineFeedChartSnapshot(feed.getSnapshot(), "1W");
    assert.equal(chart.confirmed, index === 6);
    assert.equal(chart.bar.volume, (index + 1) * 10);
  }
  receive(feed, starts[7], false, 15, 107);
  const chart = pineFeedChartSnapshot(feed.getSnapshot(), "1W");
  assert.equal(chart.history.length, 1);
  assert.equal(chart.history[0].close, 106);
  assert.equal(chart.bar.time, starts[7]);
});

test("daily source month aggregation confirms February 29 rather than a nominal 30-day boundary", () => {
  const starts = times(utc("2024-02-01T00:00:00Z"), "1D", 30);
  const feed = createPineLiveFeed("BTCUSDT", "1D");
  feed.seed(starts.slice(0, 28).map(time => candle(time)));
  receive(feed, starts[28], false, 1, 110);
  assert.equal(pineFeedChartSnapshot(feed.getSnapshot(), "1M").confirmed, false);
  receive(feed, starts[28], true, 2, 110);
  const closed = pineFeedChartSnapshot(feed.getSnapshot(), "1M");
  assert.equal(closed.bar.time, starts[0]);
  assert.equal(closed.bar.volume, 290);
  assert.equal(closed.confirmed, true);
  receive(feed, starts[29], false, 3, 111);
  assert.equal(pineFeedChartSnapshot(feed.getSnapshot(), "1M").history[0].close, 110);
});

test("native source refuses shorter and indivisible chart intervals and weekly-to-monthly reconstruction", () => {
  for (const [source, target, time] of [["1D", "4H", utc("2024-01-01T00:00:00Z")], ["3m", "5m", utc("2024-01-01T00:00:00Z")], ["1W", "1M", utc("2024-01-01T00:00:00Z")], ["1M", "1D", utc("2024-01-01T00:00:00Z")]]) {
    const feed = createPineLiveFeed("BTCUSDT", source);
    feed.seed([candle(time)]);
    receive(feed, time, false, 1);
    assert.throws(() => pineFeedChartSnapshot(feed.getSnapshot(), target), error => error.code === "LIVE_TIMEFRAME");
  }
});

test("native seed rejects missing calendar months, wrong weekly starts, and off-grid fixed intervals", () => {
  for (const [frame, starts] of [["1M", [utc("2024-01-01T00:00:00Z"), utc("2024-03-01T00:00:00Z")]], ["1W", [utc("2024-01-02T00:00:00Z")]], ["3m", [utc("2024-01-01T00:01:00Z")]]]) {
    const feed = createPineLiveFeed("BTCUSDT", frame);
    feed.seed(starts.map(time => candle(time)));
    assert.match(feed.getSnapshot().error, /continuous/);
    assert.deepEqual(feed.getSnapshot().bars, []);
  }
});

test("native receive rejects an incorrect provider close time or a non-native candle start", () => {
  const february = utc("2024-02-01T00:00:00Z");
  for (const [time, closeTime] of [[february, february * 1000 + 30 * 86400_000 - 1], [february + 86400, utc("2024-03-01T00:00:00Z") * 1000 - 1]]) {
    const feed = createPineLiveFeed("BTCUSDT", "1M");
    feed.seed([candle(february)]);
    feed.receive(candle(time), false, 1, closeTime);
    assert.match(feed.getSnapshot().error, /invalid 1M candle event/);
    assert.equal(feed.getSnapshot().event, null);
  }
});

test("native confirmed ordering, transport replay, and committed revision invariants are preserved", () => {
  const dates = times(utc("2024-01-01T00:00:00Z"), "1M", 4);
  const feed = createPineLiveFeed("BTCUSDT", "1M");
  feed.seed([candle(dates[0])]);
  receive(feed, dates[1], false, 1);
  receive(feed, dates[1], false, 1);
  assert.equal(feed.getSnapshot().event.sequence, 1);
  receive(feed, dates[1], true, 2);
  receive(feed, dates[1], true, 3);
  assert.equal(feed.getSnapshot().event.sequence, 2);
  receive(feed, dates[1], true, 4, 101);
  assert.match(feed.getSnapshot().error, /revised a confirmed candle/);
  for (const [next, confirmed] of [[dates[2], false], [dates[3], true]]) {
    const gap = createPineLiveFeed("BTCUSDT", "1M");
    gap.seed([candle(dates[0])]);
    receive(gap, dates[1], confirmed, 1);
    receive(gap, next, false, 2);
    assert.match(gap.getSnapshot().error, /explicit closing event/);
  }
  const unordered = createPineLiveFeed("BTCUSDT", "1M");
  unordered.seed([candle(dates[0])]);
  receive(unordered, dates[1], false, 2);
  receive(unordered, dates[1], false, 1, 101);
  assert.match(unordered.getSnapshot().error, /out of order/);
});

test("legacy snapshots without sourceTimeframe continue to aggregate one-minute events", () => {
  const feed = createPineLiveFeed("BTCUSDT"), starts = times(utc("2024-01-01T00:00:00Z"), "1m", 5);
  feed.seed(starts.slice(0, 4).map(time => candle(time)));
  receive(feed, starts[4], true, 1);
  const { sourceTimeframe, ...legacy } = feed.getSnapshot();
  assert.equal(sourceTimeframe, "1m");
  const chart = pineFeedChartSnapshot(legacy, "5m");
  assert.equal(chart.bar.volume, 50);
  assert.equal(chart.confirmed, true);
});

test("native loading queues and stored history retain the bounded one-minute feed limits", () => {
  const start = utc("2024-01-01T00:00:00Z");
  const queue = createPineLiveFeed("BTCUSDT", "1D");
  for (let index = 0; index < 33; index++) receive(queue, start, false, index, 100 + index);
  assert.match(queue.getSnapshot().error, /history-loading queue/);
  queue.seed([candle(start)]);
  assert.deepEqual(queue.getSnapshot().bars, []);
  const history = createPineLiveFeed("BTCUSDT", "1D"), starts = times(start, "1D", 20_002);
  history.seed(starts.slice(0, 20_001).map(time => candle(time)));
  assert.equal(history.getSnapshot().bars.length, 20_000);
  assert.equal(history.getSnapshot().bars[0].time, starts[1]);
  receive(history, starts[20_001], false, 1);
  assert.match(history.getSnapshot().error, /20,000 candles/);
  assert.equal(history.getSnapshot().bars.length, 20_000);
});

test("first native event fails closed when the REST history ends before the previous source bucket", () => {
  const dates = times(utc("2024-01-01T00:00:00Z"), "1M", 4);
  const feed = createPineLiveFeed("BTCUSDT", "1M");
  feed.seed([candle(dates[0])]);
  receive(feed, dates[2], false, 1);
  assert.match(feed.getSnapshot().error, /history has a gap/);
  assert.deepEqual(feed.getSnapshot().bars.map(bar => bar.time), [dates[0]]);
});
