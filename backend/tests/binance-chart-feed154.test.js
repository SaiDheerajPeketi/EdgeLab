import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
const bundle = await build({ entryPoints: ["frontend/src/lib/binanceChartFeed.ts"], bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent" });
const { binanceChartInterval, binanceChartCandle, binanceChartEvent } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const time = 1_700_000_040_000;
test("native mappings preserve monthly case and decline unsupported custom intervals", () => {
  for (const [chart, provider] of [["1H", "1h"], ["4H", "4h"], ["1D", "1d"], ["1W", "1w"], ["1M", "1M"], ["5m", "5m"]]) assert.equal(binanceChartInterval(chart), provider);
  assert.equal(binanceChartInterval("7m"), null);
  assert.equal(binanceChartInterval("invalid"), null);
});
test("native REST and stream OHLCV share strict validation and source identity", () => {
  const row = [time, "10", "13", "9", "12", "31"];
  const message = { e: "kline", E: time + 1000, s: "BTCUSDT", k: { t: time, T: time + 3599999, i: "1h", s: "BTCUSDT", o: "10", h: "13", l: "9", c: "12", v: "31", x: false } };
  assert.deepEqual(binanceChartEvent(message, "BTCUSDT", "1h").bar, binanceChartCandle(row));
  for (const changed of [{ ...message, s: "ETHUSDT" }, { ...message, k: { ...message.k, i: "1m" } }, { ...message, k: { ...message.k, x: "true" } }]) assert.throws(() => binanceChartEvent(changed, "BTCUSDT", "1h"));
  for (const invalid of [null, [], [time + 1, ...row.slice(1)], [time, "10", "9", "9", "12", "31"], [time, "10", "13", "9", "12", "NaN"]]) assert.throws(() => binanceChartCandle(invalid));
});
