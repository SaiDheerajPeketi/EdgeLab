import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
const bundle = await build({ entryPoints: ["frontend/src/lib/pineProtocol.ts"], bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent", define: { "import.meta.env": "{}" } });
const protocol = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const start = Date.parse("2020-01-01T00:00:00Z") / 1000;
const bar = time => ({ time, open: 1, high: 3, low: 1, close: 2, volume: 5 });
const context = { symbol: "BINANCE:ETHUSDT", timeframe: "1", mintick: .001, mincontract: .01, quantityStep: .01, pointvalue: 1, currency: "USDT", basecurrency: "ETH" };
const snapshot = () => ({ context: { ...context }, requestedTimeframe: "1", bars: [bar(start), bar(start + 60)], asOf: start + 120 });
const input = marketData => ({ id: "market-test160", action: "run", mode: "historical", source: '//@version=6\nindicator("market")\nplot(close)', context: { ...context, symbol: "BTCUSDT" }, bars: [bar(start), bar(start + 60)], marketData });
const valid = () => ({ provider: "binance", snapshots: [snapshot()] });
test("market protocol preserves exact secondary metadata and rejects source/context conflicts", () => {
  const normalized = protocol.validatePineRequest(input(valid()));
  assert.deepEqual(normalized.marketData.snapshots[0], { ...snapshot(), bars: snapshot().bars.map(protocol.validatePineBar) });
  for (const config of [{ ...valid(), url: "https://evil.test" }, { ...valid(), provider: "coinbase" }, { provider: "binance", snapshots: [snapshot(), snapshot()] }, { ...valid(), invalidSymbols: [context.symbol] }]) assert.throws(() => protocol.validatePineRequest(input(config)));
  for (const change of [{ context: { ...context, symbol: "ETHUSDT" } }, { context: { ...context, mintick: undefined } }, { context: { ...context, timeframe: "7" } }, { asOf: start + 121 }, { bars: [bar(start + 60), bar(start)] }, { bars: [bar(start + 1)] }, { bars: [bar(start + 120)] }]) assert.throws(() => protocol.validatePineRequest(input({ provider: "binance", snapshots: [{ ...snapshot(), ...change }] })));
});
test("snapshot and candle arrays reject holes, getters and named data without reading accessors", () => {
  for (const target of ["snapshots", "bars"]) {
    for (const kind of ["hole", "getter", "named", "symbol"]) {
      const config = valid(), array = target === "snapshots" ? config.snapshots : config.snapshots[0].bars;
      let read = false;
      if (kind === "hole") delete array[0];
      if (kind === "getter") Object.defineProperty(array, "0", { enumerable: true, get() { read = true; throw Error("must not read"); } });
      if (kind === "named") array.token = "must not transport";
      if (kind === "symbol") array[Symbol("secret")] = true;
      assert.throws(() => protocol.validatePineRequest(input(config)), e => e.code === "INVALID_MARKET_DATA");
      assert.equal(read, false);
    }
  }
});
test("absent-symbol registry is qualified unique bounded and immutable after normalization", () => {
  const config = { provider: "binance", snapshots: [], invalidSymbols: ["BINANCE:UNKNOWN"] };
  const normalized = protocol.validatePineRequest(input(config)); config.invalidSymbols[0] = "BINANCE:ETHUSDT";
  assert.deepEqual(normalized.marketData.invalidSymbols, ["BINANCE:UNKNOWN"]);
  for (const invalidSymbols of [["UNKNOWN"], ["BINANCE:UNKNOWN", "BINANCE:UNKNOWN"], Array.from({ length: 65 }, (_, i) => `BINANCE:UNKNOWN${i}`)]) assert.throws(() => protocol.validatePineRequest(input({ provider: "binance", snapshots: [], invalidSymbols })));
});
test("market snapshots require execution bars and cannot accompany compilation", () => {
  for (const override of [{ action: "prepare" }, { bars: [] }, { context: { ...context, symbol: "COINBASE:BTCUSDT" } }]) assert.throws(() => protocol.validatePineRequest({ ...input(valid()), ...override }));
});
