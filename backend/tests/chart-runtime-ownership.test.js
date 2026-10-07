import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

const bundle = buildSync({ entryPoints: ["frontend/src/lib/chartRuntimeOwnership.ts"], bundle: true,
  format: "cjs", platform: "node", write: false, logLevel: "silent" }).outputFiles[0].text;
const loaded = { exports: {} };
new Function("require", "module", "exports", bundle)(createRequire(import.meta.url), loaded, loaded.exports);
const { chartRuntimeOwnerMatches } = loaded.exports;
const owner = () => ({ bars: [{ time: 1, close: 100 }], indicators: [{ id: "saved", source: "plot(close)" }],
  mode: "live", symbol: "BTCUSDT", timeframe: "1m", contextKey: "replay:7", feed: {}, feedEpoch: 1, userId: 7, token: "first-session" });

test("completed output belongs only to its exact producing chart inputs", () => {
  const original = owner();
  assert.equal(chartRuntimeOwnerMatches(null, original), false);
  assert.equal(chartRuntimeOwnerMatches(original, { ...original }), true);
  // Equal-looking replacement data is a different execution, even for the same symbol.
  for (const change of [{ bars: [...original.bars] }, { indicators: [...original.indicators] },
    { mode: "historical" }, { symbol: "ETHUSDT" }, { timeframe: "5m" }, { contextKey: "replay:8" }, { feed: {} },
    { feedEpoch: 2 }, { userId: 8 }, { token: "second-session" }, { token: undefined }, { userId: undefined }]) {
    assert.equal(chartRuntimeOwnerMatches(original, { ...original, ...change }), false, JSON.stringify(change));
  }
});

test("switching a chart between persistent and session-filtered snapshots invalidates completed output", () => {
  const live = owner();
  // The raw feed remains owned even when regular-hours filtering selects a snapshot.
  const filtered = { ...live, bars: [...live.bars] };
  assert.equal(chartRuntimeOwnerMatches(live, filtered), false);
  assert.equal(chartRuntimeOwnerMatches(filtered, live), false);
  assert.equal(chartRuntimeOwnerMatches(filtered, { ...filtered }), true);
});
