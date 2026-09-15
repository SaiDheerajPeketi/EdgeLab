import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSync } from "esbuild";

const frontendRoot = fileURLToPath(new URL("..", import.meta.url));
const bundleDirectory = mkdtempSync(path.join(tmpdir(), "edgelab-series-updates-"));
const bundlePath = path.join(bundleDirectory, "chart-series-updates-test.mjs");
buildSync({
  bundle: true,
  entryPoints: [path.join(frontendRoot, "src/lib/chartSeriesUpdates.ts")],
  format: "esm",
  logLevel: "silent",
  outfile: bundlePath,
  platform: "node",
  target: "node22",
});
const { planSeriesDataUpdate } = await import(pathToFileURL(bundlePath).href);
after(() => rmSync(bundleDirectory, { force: true, recursive: true }));

const point = (time, value) => ({ time, value });

test("live append and tail replacement use bounded series updates", () => {
  const previous = [point(1, 10), point(2, 20)];
  assert.deepEqual(
    planSeriesDataUpdate(previous, [...previous, point(3, 30)]),
    { mode: "update", points: [point(3, 30)] },
  );
  assert.deepEqual(
    planSeriesDataUpdate(previous, [previous[0], point(2, 21)]),
    { mode: "update", points: [point(2, 21)] },
  );
  assert.deepEqual(
    planSeriesDataUpdate(previous, [point(1, 10), point(2, 21), point(3, 30)]),
    { mode: "update", points: [point(2, 21), point(3, 30)] },
  );
});

test("history, backfill, clearing, and style changes use setData", () => {
  const previous = [point(2, 20), point(3, 30)];
  assert.equal(
    planSeriesDataUpdate(previous, [point(1, 10), ...previous]).mode,
    "setData",
  );
  assert.equal(
    planSeriesDataUpdate(previous, [point(2, 22), point(3, 30)]).mode,
    "setData",
  );
  assert.equal(planSeriesDataUpdate(previous, []).mode, "setData");
  assert.equal(planSeriesDataUpdate(previous, previous.slice(), true).mode, "setData");
});

test("unchanged data performs no chart-engine write", () => {
  const previous = [point(1, 10), point(2, 20)];
  assert.deepEqual(planSeriesDataUpdate(previous, previous.map((item) => ({ ...item }))), {
    mode: "none",
    points: [],
  });
});

test("TradingChart creates only the active price and requested volume series", () => {
  const chart = readFileSync(
    path.join(frontendRoot, "src/components/TradingChart.tsx"),
    "utf8",
  );
  assert.match(chart, /primarySeriesKind === "line"/);
  assert.match(chart, /primarySeriesKind === "area"/);
  assert.match(chart, /chartSettings\.volume && hasVolumeData/);
  assert.match(chart, /planSeriesDataUpdate/);
  assert.doesNotMatch(chart, /visible: false,[\s\S]{0,240}chart\.addAreaSeries/);
});
