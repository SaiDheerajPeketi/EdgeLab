import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { buildSync } from "../../node_modules/esbuild/lib/main.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

async function bundle(relativePath) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "edgelab-crosshair-"));
  const output = path.join(directory, "module.mjs");
  buildSync({ bundle: true, entryPoints: [path.join(ROOT, relativePath)], format: "esm", outfile: output, platform: "node" });
  return { cleanup: () => fs.rmSync(directory, { force: true, recursive: true }), module: await import(pathToFileURL(output).href) };
}

test("crosshair bus coalesces pointer updates into one shared animation frame", async () => {
  const frames = new Map();
  const cancelled = [];
  let nextFrame = 0;
  const { cleanup, module } = await bundle("frontend/src/lib/chartCrosshairSync.ts");
  try {
    const bus = module.createChartCrosshairSyncBus({
      cancelFrame(frameId) { cancelled.push(frameId); frames.delete(frameId); },
      requestFrame(callback) { nextFrame += 1; frames.set(nextFrame, callback); return nextFrame; },
    });
    const events = Array.from({ length: 16 }, () => []);
    events.forEach((received) => bus.subscribe((event) => received.push(event)));

    for (const time of [100, 200, 300]) {
      bus.publish({ price: time / 10, revision: 0, sourcePaneId: "pane-1", time });
    }
    assert.equal(frames.size, 1);
    assert.deepEqual(events.map((received) => received.length), Array(16).fill(0));
    const firstFrame = frames.get(1);
    frames.delete(1);
    firstFrame(16);
    assert.deepEqual(
      events.map((received) => received.at(-1).value.time),
      Array(16).fill(300),
    );

    bus.publish({ price: 40, revision: 0, sourcePaneId: "pane-1", time: 400 });
    bus.setEnabled(false);
    assert.deepEqual(cancelled, [2]);
    assert.deepEqual(events.map((received) => received.at(-1).type), Array(16).fill("disabled"));
    bus.publish({ price: 50, revision: 0, sourcePaneId: "pane-1", time: 500 });
    assert.equal(frames.size, 0);

    bus.setEnabled(true);
    bus.publish({ price: 60, revision: 0, sourcePaneId: "pane-1", time: 600 });
    assert.equal(frames.size, 1);
    bus.dispose();
    assert.deepEqual(cancelled, [2, 3]);
  } finally {
    cleanup();
  }
});

test("candle snapshot store notifies only isolated header subscribers", async () => {
  const { cleanup, module } = await bundle("frontend/src/lib/chartCrosshairSync.ts");
  try {
    const store = module.createChartCandleSnapshotStore();
    const candle = { time: 100 };
    let notifications = 0;
    const unsubscribe = store.subscribe(() => { notifications += 1; });
    store.setSnapshot(candle);
    store.setSnapshot(candle);
    store.setSnapshot(null);
    unsubscribe();
    store.setSnapshot(candle);
    assert.equal(notifications, 2);
    assert.equal(store.getSnapshot(), candle);
  } finally {
    cleanup();
  }
});

test("live crosshair updates bypass workspace React state and use indexed candle lookup", () => {
  const workspace = fs.readFileSync(path.join(ROOT, "frontend/src/components/EdgeLabWorkspace.tsx"), "utf8");
  const chart = fs.readFileSync(path.join(ROOT, "frontend/src/components/TradingChart.tsx"), "utf8");
  assert.match(workspace, /crosshairSyncBus=\{crosshairSyncBus\}/);
  assert.doesNotMatch(workspace, /setSyncedCrosshair|useState<SyncedChartCrosshair/);
  assert.match(chart, /useSyncExternalStore/);
  assert.match(chart, /localPointerActiveRef\.current/);
  assert.match(chart, /addEventListener\("pointerenter"/);
  assert.match(chart, /barsByTimeRef\.current\.get|barsByTime\.get/);
  assert.doesNotMatch(chart, /bars\.find\(\(bar\) => bar\.time === time\)/);
  assert.match(chart, /if \(!linkedCrosshairAppliedRef\.current\) return/);
});
