import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const bundle = await build({ entryPoints: [fileURLToPath(new URL("../../frontend/src/lib/pineLiveFeed.ts", import.meta.url))], bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent" });
const { createPineLiveFeed, pineFeedChartSnapshot } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const start = 1_700_000_100; // UTC five-minute boundary.
const candle = (index, close = 100 + index) => ({ time: start + index * 60, open: close - 1, high: close + 2, low: close - 2, close, volume: 10 });
const receive = (feed, index, close, confirmed, eventTime) => feed.receive(candle(index, close), confirmed, eventTime, candle(index).time * 1000 + 59_999);

test("feed delivers received events in order and requires an explicit close before advancing", () => {
  const feed = createPineLiveFeed("BTCUSDT"), events = [];
  feed.seed([0, 1, 2].map(index => candle(index)));
  feed.subscribe(snapshot => { if (snapshot.event) events.push(snapshot.event); });
  receive(feed, 3, 110, false, 1);
  receive(feed, 3, 110, false, 2); // An unchanged newly received event still executes.
  receive(feed, 3, 110, false, 2); // Same transport event is idempotent.
  receive(feed, 3, 110, true, 3);
  receive(feed, 3, 110, true, 4); // Repeated committed close is idempotent.
  receive(feed, 4, 111, false, 5);
  assert.deepEqual(events.map(event => [event.sequence, event.confirmed]), [[1, false], [2, false], [3, true], [4, false]]);
  assert.equal(feed.getSnapshot().bars.length, 5);
  assert.deepEqual(feed.getSnapshot().bars.slice(0, 3).map(bar => bar.close), [100, 101, 102]);
  receive(feed, 5, 112, false, 6);
  assert.match(feed.getSnapshot().error, /explicit closing event/);
  assert.equal(feed.getSnapshot().bars.length, 5);
});

test("late REST history cannot overwrite queued authoritative candle updates", () => {
  const feed = createPineLiveFeed("BTCUSDT"), observed = [];
  feed.subscribe(snapshot => { if (snapshot.event) observed.push([snapshot.event.sequence, snapshot.bars.at(-1).close]); });
  receive(feed, 3, 150, false, 1);
  receive(feed, 3, 151, true, 2);
  receive(feed, 4, 152, false, 3);
  feed.seed([0, 1, 2, 3, 4, 5].map(index => candle(index, 10 + index)));
  assert.deepEqual(observed, [[1, 150], [2, 151], [3, 152]]);
  assert.deepEqual(feed.getSnapshot().bars.map(bar => bar.close), [10, 11, 12, 151, 152]);
  assert.equal(feed.getSnapshot().error, null);
  const epoch = feed.getSnapshot().epoch;
  feed.reset();
  assert.equal(feed.getSnapshot().epoch, epoch + 1);
  assert.deepEqual(feed.getSnapshot().bars, []);
  assert.equal(feed.getSnapshot().event, null);
});

test("five-minute execution includes unfinished constituents and confirms only the final explicit close", () => {
  const feed = createPineLiveFeed("BTCUSDT");
  feed.seed([0, 1, 2, 3, 4].map(index => candle(index)));
  for (let index = 5; index < 10; index++) {
    receive(feed, index, 200 + index, false, index * 2);
    let chart = pineFeedChartSnapshot(feed.getSnapshot(), "5m");
    assert.equal(chart.history.length, 1);
    assert.equal(chart.bar.time, start + 300);
    assert.equal(chart.bar.open, 204);
    assert.equal(chart.bar.close, 200 + index);
    assert.equal(chart.bar.volume, (index - 4) * 10);
    assert.equal(chart.confirmed, false);
    receive(feed, index, 200 + index, true, index * 2 + 1);
    chart = pineFeedChartSnapshot(feed.getSnapshot(), "5m");
    assert.equal(chart.confirmed, index === 9);
  }
  receive(feed, 10, 210, false, 30);
  const chart = pineFeedChartSnapshot(feed.getSnapshot(), "5m");
  assert.equal(chart.history.length, 2);
  assert.equal(chart.history.at(-1).close, 209);
  assert.equal(chart.bar.volume, 10);
  assert.equal(chart.confirmed, false);
});

test("loading queue overflow and committed revisions halt the feed without publishing later bars", () => {
  const queue = createPineLiveFeed("BTCUSDT");
  for (let index = 0; index < 33; index++) receive(queue, 0, 100 + index, false, index);
  assert.match(queue.getSnapshot().error, /history-loading queue/);
  queue.seed([candle(0)]);
  assert.deepEqual(queue.getSnapshot().bars, []);
  const feed = createPineLiveFeed("BTCUSDT");
  feed.seed([candle(0)]);
  receive(feed, 1, 101, true, 1);
  receive(feed, 1, 102, true, 2);
  assert.match(feed.getSnapshot().error, /revised a confirmed candle/);
  receive(feed, 2, 103, false, 3);
  assert.deepEqual(feed.getSnapshot().bars.map(bar => bar.close), [100, 101]);
  assert.throws(() => pineFeedChartSnapshot(feed.getSnapshot(), "1m"), /revised a confirmed candle/);
});
