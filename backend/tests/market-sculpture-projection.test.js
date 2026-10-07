import assert from "node:assert/strict";
import test from "node:test";
import { PerspectiveCamera, Vector3 } from "three";
import { build } from "esbuild";

const bundled = await build({ entryPoints: ["frontend/src/lib/marketSculptureGeometry.ts"], bundle: true,
  write: false, platform: "node", format: "esm" });
const model = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const { CANDLES, projectMarketSculpture } = model;
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-8, `${label}: ${actual} != ${expected}`);

test("software coordinates match genuine Three perspective and world rotation at all supported views", () => {
  for (const [width, height] of [[342, 360], [768, 460], [600, 500], [720, 500]]) {
    for (const yaw of [-0.42, 0, 0.42]) for (const pitch of [-0.3, 0, 0.3]) {
      const scene = projectMarketSculpture({ width, height, yaw, pitch });
      const distance = Math.max(20, 29 / (width / height));
      const camera = new PerspectiveCamera(36, width / height, 0.1, 100);
      camera.position.set(Math.sin(0.28 + yaw) * distance, distance * 0.34 + pitch * 6, Math.cos(0.28 + yaw) * distance);
      camera.lookAt(0, -0.8, 0); camera.updateMatrixWorld();
      const prices = CANDLES.flatMap(bar => [bar.low, bar.high]);
      const low = Math.min(...prices), high = Math.max(...prices);
      CANDLES.forEach((bar, index) => {
        for (const price of [bar.low, bar.high]) {
          const point = { x: (index - 47.5) * 0.18, y: (price - (low + high) / 2) * 8 / (high - low), z: Math.sin(index * 0.055) * 1.75 };
          const expected = new Vector3(point.x, point.y, point.z).applyAxisAngle(new Vector3(0, 1, 0), -0.08).project(camera);
          const actual = scene.project(point);
          near(actual.x, (expected.x + 1) * width / 2, "x");
          near(actual.y, (1 - expected.y) * height / 2, "y");
          assert.ok(actual.depth > 0);
        }
      });
      const center = scene.project({ x: 0, y: -0.8, z: 0 });
      near(center.x, width / 2, "camera target x"); near(center.y, height / 2, "camera target y");
    }
  }
});

test("every candle retains visible body, wick and volume with far-to-near occlusion order", () => {
  assert.equal(CANDLES.length, 96); assert.ok(Object.isFrozen(CANDLES));
  const original = JSON.stringify(CANDLES);
  for (const yaw of [-0.42, 0, 0.42]) {
    const scene = projectMarketSculpture({ width: 600, height: 500, yaw, pitch: 0.3 });
    for (let index = 0; index < 96; index++) {
      assert.ok(Object.isFrozen(CANDLES[index]));
      assert.equal(scene.primitives.filter(p => p.index === index && p.layer === "body").length, 3);
      assert.equal(scene.primitives.filter(p => p.index === index && p.layer === "volume").length, 3);
      assert.equal(scene.primitives.filter(p => p.index === index && p.layer === "wick").length, 1);
    }
    scene.primitives.forEach((primitive, index) => {
      if (index) assert.ok(scene.primitives[index - 1].depth >= primitive.depth);
      for (const point of primitive.points) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y) && point.depth > 0);
    });
  }
  assert.equal(JSON.stringify(CANDLES), original);
});

test("one-based decision landmarks and stop preserve the same market through every chapter", () => {
  const price = projectMarketSculpture({ width: 600, height: 500, chapter: "price" });
  for (const chapter of ["decisions", "review"]) {
    const scene = projectMarketSculpture({ width: 600, height: 500, chapter });
    assert.deepEqual(scene.primitives, price.primitives);
    assert.equal(scene.entry.index + 1, 44); assert.equal(scene.exit.index + 1, 82);
    const entry = CANDLES[43], exit = CANDLES[81];
    const low = Math.min(...CANDLES.map(bar => bar.low)), high = Math.max(...CANDLES.map(bar => bar.high));
    const y = value => (value - (low + high) / 2) * 8 / (high - low);
    near(scene.entry.world.y, y(entry.high) + 0.9, "entry anchor");
    near(scene.exit.world.y, y(exit.high) + 0.9, "exit anchor");
    const start = scene.project({ x: (43 - 47.5) * 0.18, y: y(entry.low) - 0.3, z: Math.sin(43 * 0.055) * 1.75 });
    for (const coordinate of ["x", "y", "depth"]) near(scene.stop[0][coordinate], start[coordinate], `stop ${coordinate}`);
    assert.deepEqual(scene.trail[0], scene.entry.point); assert.deepEqual(scene.trail.at(-1), scene.exit.point);
  }
});


test("measurement anchors retain complete numbers and reserve the endpoint caption row at orbit extremes", () => {
  for (const [width, height] of [[342, 360], [768, 460], [600, 500], [720, 500]]) {
    for (const yaw of [-0.55, 0, 0.55]) for (const pitch of [-0.45, 0, 0.45]) {
      const scene = projectMarketSculpture({ width, height, yaw, pitch });
      assert.equal(scene.priceTicks.length, 5); assert.equal(scene.timeTicks.length, 5);
      for (const tick of scene.priceTicks) {
        assert.ok(tick.label.x - tick.price.toFixed(1).length * 6 >= 8);
        assert.ok(tick.label.x <= width - 8 && tick.label.y >= 20 && tick.label.y <= height - 44);
      }
      for (const tick of scene.timeTicks) {
        assert.ok(tick.label.x >= 16 && tick.label.x <= width - 16);
        assert.ok(tick.label.y >= 20 && tick.label.y <= height - 44);
      }
    }
  }
});
