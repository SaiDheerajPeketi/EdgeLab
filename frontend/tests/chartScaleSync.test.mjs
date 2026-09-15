import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSync } from "esbuild";

const frontendRoot = fileURLToPath(new URL("..", import.meta.url));
const bundleDirectory = mkdtempSync(path.join(tmpdir(), "edgelab-chart-scale-sync-"));
const bundlePath = path.join(bundleDirectory, "chart-scale-sync-test.mjs");
buildSync({
  bundle: true,
  entryPoints: [path.join(frontendRoot, "src/lib/chartScaleSync.ts")],
  format: "esm",
  logLevel: "silent",
  outfile: bundlePath,
  platform: "node",
  target: "node22",
});
const { createPriceScaleSettleScheduler } = await import(pathToFileURL(bundlePath).href);
after(() => rmSync(bundleDirectory, { force: true, recursive: true }));

test("deferred scale resets reproject overlays for three bounded settle frames", () => {
  const callbacks = [];
  let nextFrameId = 1;
  let scaleCoordinate = 120;
  let overlayCoordinate = scaleCoordinate;
  let synchronizationCount = 0;
  const scheduler = createPriceScaleSettleScheduler({
    cancelFrame(frameId) {
      const index = callbacks.findIndex((frame) => frame.id === frameId);
      if (index >= 0) callbacks.splice(index, 1);
    },
    requestFrame(callback) {
      const id = nextFrameId;
      nextFrameId += 1;
      callbacks.push({ callback, id });
      return id;
    },
    synchronize() {
      synchronizationCount += 1;
      overlayCoordinate = scaleCoordinate;
    },
  });

  scheduler.schedule();
  scaleCoordinate = 84;
  callbacks.shift().callback(0);
  assert.equal(overlayCoordinate, 84);

  scaleCoordinate = 72;
  callbacks.shift().callback(16);
  assert.equal(overlayCoordinate, 72);

  callbacks.shift().callback(32);
  assert.equal(synchronizationCount, 3);
  assert.equal(callbacks.length, 0, "settling must stop instead of becoming idle polling");
});

test("chart reset and gesture-end events schedule bounded price-scale settling", () => {
  const chart = readFileSync(
    path.join(frontendRoot, "src/components/TradingChart.tsx"),
    "utf8",
  );
  for (const eventBinding of [
    "onDoubleClickCapture={schedulePriceScaleSettle}",
    "onPointerCancelCapture={schedulePriceScaleSettle}",
    "onPointerUpCapture={schedulePriceScaleSettle}",
    "onTouchEndCapture={schedulePriceScaleSettle}",
  ]) {
    assert.ok(chart.includes(eventBinding), `missing price-scale settle binding: ${eventBinding}`);
  }
});
