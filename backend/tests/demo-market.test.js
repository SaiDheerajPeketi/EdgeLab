import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";

const code = buildSync({ entryPoints: [fileURLToPath(new URL("../../frontend/src/lib/demoMarket.ts", import.meta.url))],
  bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent" }).outputFiles[0].text;
const market = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

test("seeded regimes produce valid, varied continuous OHLCV without mutating earlier history", () => {
  const initial = market.createDemoMarket({ seed: 52 });
  const frozen = Object.freeze({ ...initial });
  const full = market.generateDemoBars(frozen, 4096);
  const first = market.generateDemoBars(initial, 256);
  const continuation = market.generateDemoBars(first.state, 3840);
  assert.deepEqual([...first.bars, ...continuation.bars], full.bars);
  assert.deepEqual(initial, frozen);
  assert.deepEqual(market.generateDemoBars(initial, 4096), full);
  assert.notDeepEqual(market.generateDemoBars(market.createDemoMarket({ seed: 53 }), 256).bars, first.bars);
  let rises = 0, declines = 0;
  for (const [index, bar] of full.bars.entries()) {
    assert.ok(Object.values(bar).every(Number.isFinite));
    assert.ok(bar.low > 0 && bar.low <= Math.min(bar.open, bar.close));
    assert.ok(bar.high >= Math.max(bar.open, bar.close));
    assert.ok(bar.volume > 0 && Number.isInteger(bar.volume));
    if (index) { assert.equal(bar.open, full.bars[index - 1].close); assert.equal(bar.time - full.bars[index - 1].time, 300); }
    rises += Number(bar.close > bar.open); declines += Number(bar.close < bar.open);
  }
  assert.ok(rises > 1000 && declines > 1000);
  assert.notDeepEqual(full.bars.slice(0, 128).map(bar => bar.close / bar.open), full.bars.slice(128, 256).map(bar => bar.close / bar.open));
});

test("rolling replay advances beyond its original end and bounds history without rewinding sequence", () => {
  let replay = market.createDemoReplay();
  const original = structuredClone(replay);
  const tail = replay.bars.at(-1);
  const next = market.appendDemoReplay(Object.freeze({ ...replay, bars: Object.freeze([...replay.bars]) }));
  assert.equal(next.cursor, 256);
  assert.equal(next.bars.at(-1).time, tail.time + 300);
  assert.deepEqual(replay, original);
  for (let index = 0; index < 3000; index++) replay = market.appendDemoReplay(replay);
  assert.equal(replay.bars.length, 2048);
  assert.equal(replay.firstIndex, 1208);
  assert.equal(replay.cursor, 3255);
  assert.equal(replay.bars.at(-1).time, tail.time + 3000 * 300);
  assert.equal(replay.bars[0].time, original.bars[0].time + replay.firstIndex * 300);
});

test("responsive windows stay dense and past-only, including short reviewed history", () => {
  assert.equal(market.demoVisibleBarCount(220, 256), 24);
  assert.equal(market.demoVisibleBarCount(640, 256), 71);
  assert.equal(market.demoVisibleBarCount(1400, 256), 155);
  assert.equal(market.demoVisibleBarCount(220, 12), 12);
  assert.equal(market.demoVisibleBarCount(0, 0), 0);
});

test("invalid synthetic configuration and unbounded batch allocations are rejected", () => {
  for (const args of [{ startPrice: 0 }, { startPrice: NaN }, { intervalSeconds: 1.5 }, { baseVolume: -1 }, { startTime: Infinity }, { seed: NaN }]) {
    assert.throws(() => market.createDemoMarket(args), RangeError);
  }
  for (const count of [-1, 1.5, Infinity, 20_001]) assert.throws(() => market.generateDemoBars(market.createDemoMarket(), count), RangeError);
});

test("different seeds retain pullbacks and advances inside dense64-bar windows", () => {
  for (const seed of [0, 1, 7, 17, 29, 43, 52, 99, 255, 2026]) {
    const generated = market.generateDemoBars(market.createDemoMarket({ seed }), 1024);
    for (let start = 0; start < generated.bars.length; start += 64) {
      const window = generated.bars.slice(start, start + 64);
      const up = window.filter(bar => bar.close > bar.open).length;
      const down = window.filter(bar => bar.close < bar.open).length;
      assert.ok(up > 10 && down > 10, `seed${seed}, window${start}: up${up}/down${down}`);
    }
  }
});
