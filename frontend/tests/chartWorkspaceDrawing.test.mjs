import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSync } from "esbuild";

const frontendRoot = fileURLToPath(new URL("..", import.meta.url));
const bundleDirectory = mkdtempSync(path.join(tmpdir(), "edgelab-chart-workspace-"));
const bundlePath = path.join(bundleDirectory, "chart-workspace-test.mjs");
buildSync({
  bundle: true,
  format: "esm",
  logLevel: "silent",
  outfile: bundlePath,
  platform: "node",
  stdin: {
    contents: [
      'export * from "./src/lib/chartWorkspace.ts";',
      'export * from "./src/lib/charting.ts";',
    ].join("\n"),
    loader: "ts",
    resolveDir: frontendRoot,
    sourcefile: "chart-workspace-test-entry.ts",
  },
  target: "node22",
});
const chartModules = await import(pathToFileURL(bundlePath).href);
after(() => rmSync(bundleDirectory, { force: true, recursive: true }));

const {
  buildChartSymbolUniverse,
  chartSymbolTypeaheadQuery,
  drawingRequiredPoints,
  isDrawingTool,
  isFibDrawingTool,
  mapDrawingToPane,
  nextWorkspaceRevision,
  normalizeChartCandles,
  sanitizeChartSyncSettings,
  searchChartSymbols,
  shouldMapDrawingToPane,
} = chartModules;

test("symbol universe is normalized, deduplicated, classified, and searchable", () => {
  const universe = buildChartSymbolUniverse({
    root: "/data",
    instruments: [
      {
        id: "eur-usd",
        name: "Euro / US Dollar",
        symbol: "FX:EUR/USD",
        currency: "USD",
        timezone: "UTC",
        pnl_multiplier: 1,
        folder_path: null,
        updated_at: null,
        timeframes: [{ timeframe: "5m" }],
      },
      {
        id: "btc",
        name: "Bitcoin perpetual",
        symbol: "BTCUSDT",
        currency: "USDT",
        timezone: "UTC",
        pnl_multiplier: 1,
        folder_path: null,
        updated_at: null,
        timeframes: [],
      },
    ],
  }, "fx:eur/usd");
  assert.equal(universe.length, 2);
  assert.equal(searchChartSymbols(universe, "euro")[0].symbol, "FX:EUR/USD");
  assert.equal(searchChartSymbols(universe, "crypto")[0].symbol, "BTCUSDT");
});

test("type-anywhere symbol search preserves existing chart shortcuts", () => {
  assert.equal(chartSymbolTypeaheadQuery({ key: "/" }), "");
  assert.equal(chartSymbolTypeaheadQuery({ key: "a" }), "a");
  for (const key of ["b", "s", "h", "v", "t", "r", "f", "l", "m", "1"]) {
    assert.equal(chartSymbolTypeaheadQuery({ key }), null);
  }
  assert.equal(chartSymbolTypeaheadQuery({ key: "a", metaKey: true }), null);
});

test("candle normalization detects order, duplicates, gaps, invalid rows, and staleness", () => {
  const epoch = 1_700_000_000;
  const bar = (time, close = 1) => ({
    time,
    timestamp: new Date(time > 1e11 ? time : time * 1000).toISOString(),
    open: 1,
    high: 2,
    low: 0,
    close,
    volume: 10,
    ema_20: null,
    ema_50: null,
    rsi_14: null,
  });
  const normalized = normalizeChartCandles([
    bar(epoch + 120),
    bar(epoch * 1000, 2),
    bar(epoch, 3),
    bar(epoch + 240),
    { ...bar(epoch + 300), close: Number.NaN },
  ], 60, { live: true, nowSeconds: epoch + 600, staleAfterBars: 3 });
  assert.deepEqual(normalized.bars.map((item) => [item.time, item.close]), [
    [epoch, 3],
    [epoch + 120, 1],
    [epoch + 240, 1],
  ]);
  assert.equal(normalized.continuity.duplicateCount, 1);
  assert.equal(normalized.continuity.outOfOrderCount, 1);
  assert.equal(normalized.continuity.invalidCount, 1);
  assert.equal(normalized.continuity.gapCount, 2);
  assert.equal(normalized.continuity.missingBars, 2);
  assert.equal(normalized.continuity.status, "stale");
});

test("pane sync defaults and drawing mapping policies are explicit", () => {
  const defaults = sanitizeChartSyncSettings(null);
  assert.equal(defaults.crosshair, true);
  assert.equal(defaults.visibleRange, true);
  assert.equal(defaults.drawings, false);
  const source = { id: "one", symbol: "NASDAQ:AAPL", timeframe: "5m" };
  const same = { id: "two", symbol: "AAPL", timeframe: "5m" };
  const other = { id: "three", symbol: "MSFT", timeframe: "15m" };
  assert.equal(shouldMapDrawingToPane("same-symbol-timeframe", source, same), true);
  assert.equal(shouldMapDrawingToPane("same-symbol-timeframe", source, other), false);
  assert.equal(shouldMapDrawingToPane("time-price", source, other), true);
});

test("mapped drawings retain a stable sync key and independent pane id", () => {
  const drawing = {
    id: "draw-1",
    tool: "ray",
    color: "#32d3ee",
    points: [{ time: 60, price: 100 }, { time: 120, price: 110 }],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const mapped = mapDrawingToPane(drawing, "pane-2");
  assert.equal(mapped.syncKey, "draw-1");
  assert.equal(mapped.id, "draw-1:pane-2");
  assert.notEqual(mapped.points, drawing.points);
});

test("workspace revisions recover stale writers without overwriting newer state", () => {
  assert.deepEqual(nextWorkspaceRevision(4, 4), { conflict: false, revision: 5 });
  assert.deepEqual(nextWorkspaceRevision(7, 4), { conflict: true, revision: 8 });
});

test("advanced drawing families expose deterministic anchor contracts", () => {
  assert.equal(isDrawingTool("harmonicPattern"), true);
  assert.equal(isFibDrawingTool("fibFan"), true);
  assert.equal(drawingRequiredPoints("horizontalRay"), 2);
  assert.equal(drawingRequiredPoints("parallelChannel"), 3);
  assert.equal(drawingRequiredPoints("chartPattern"), 4);
  assert.equal(drawingRequiredPoints("elliottWave"), 5);
  assert.equal(drawingRequiredPoints("harmonicPattern"), 5);
  assert.equal(drawingRequiredPoints("brush"), null);
  assert.equal(drawingRequiredPoints("eraser"), null);
});
