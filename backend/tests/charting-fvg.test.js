import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const TSC_BIN = path.join(REPO_ROOT, "frontend", "node_modules", "typescript", "bin", "tsc");

async function loadChartingModule() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "edgelab-charting-"));
  const sourceDir = path.join(tempDir, "src");
  const outDir = path.join(tempDir, "out");
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.copyFileSync(
    path.join(REPO_ROOT, "frontend", "src", "lib", "charting.ts"),
    path.join(sourceDir, "charting.ts"),
  );
  fs.copyFileSync(
    path.join(REPO_ROOT, "frontend", "src", "lib", "colorTokens.ts"),
    path.join(sourceDir, "colorTokens.ts"),
  );
  fs.writeFileSync(
    path.join(sourceDir, "api.ts"),
    [
      "export type Candle = {",
      "  timestamp?: string | number;",
      "  time: number;",
      "  open: number;",
      "  high: number;",
      "  low: number;",
      "  close: number;",
      "  volume: number;",
      "  [key: string]: unknown;",
      "};",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(sourceDir, "lightweight-charts.d.ts"),
    [
      "declare module \"lightweight-charts\" {",
      "  export type UTCTimestamp = number;",
      "  export type CandlestickData = { time: UTCTimestamp; open: number; high: number; low: number; close: number };",
      "  export type LineData = { time: UTCTimestamp; value: number };",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  const compile = spawnSync(
    process.execPath,
    [
      TSC_BIN,
      "--module",
      "commonjs",
      "--target",
      "es2022",
      "--skipLibCheck",
      "--noEmitOnError",
      "false",
      "--outDir",
      outDir,
      path.join(sourceDir, "charting.ts"),
      path.join(sourceDir, "colorTokens.ts"),
      path.join(sourceDir, "api.ts"),
      path.join(sourceDir, "lightweight-charts.d.ts"),
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
    },
  );
  if (compile.status !== 0) {
    throw new Error(compile.stderr || compile.stdout || "Failed to compile charting.ts");
  }

  const moduleUrl = pathToFileURL(
    path.join(outDir, "charting.js"),
  ).href;
  const charting = await import(moduleUrl);
  return {
    charting,
    cleanup() {
      fs.rmSync(tempDir, { force: true, recursive: true });
    },
  };
}

function makeBar(time, open, high, low, close, volume = 100) {
  return { close, high, low, open, time, volume };
}

test("buildFvgZoneDefinitions detects bullish FVGs and marks untouched zones active", async () => {
  const { charting, cleanup } = await loadChartingModule();
  try {
    const bars = [
      makeBar(1, 96, 100, 95, 99),
      makeBar(2, 99, 103, 98, 102),
      makeBar(3, 103, 106, 104, 105),
      makeBar(4, 105, 108, 105, 107),
    ];

    const zones = charting.buildFvgZoneDefinitions(bars, [
      { id: "fvg-1", kind: "fvg", settings: { color: "#f59e0b", period: 1 }, visible: true },
    ]);

    const matchingZone = zones.find(
      (zone) =>
        zone.label === "Bull FVG" &&
        zone.active === true &&
        zone.mitigated === false &&
        zone.low === 100 &&
        zone.high === 104,
    );
    assert.ok(matchingZone);
  } finally {
    cleanup();
  }
});

test("buildFvgZoneDefinitions hides mitigated gaps when unmitigatedOnly is enabled", async () => {
  const { charting, cleanup } = await loadChartingModule();
  try {
    const bars = [
      makeBar(1, 96, 100, 95, 99),
      makeBar(2, 99, 103, 98, 102),
      makeBar(3, 103, 106, 104, 105),
      makeBar(4, 105, 107, 103, 104),
    ];

    const allZones = charting.buildFvgZoneDefinitions(bars, [
      { id: "fvg-1", kind: "fvg", settings: { color: "#f59e0b", period: 1 }, visible: true },
    ]);
    const activeOnlyZones = charting.buildFvgZoneDefinitions(bars, [
      {
        id: "fvg-2",
        kind: "fvg",
        settings: { color: "#f59e0b", period: 1, unmitigatedOnly: true },
        visible: true,
      },
    ]);

    assert.equal(allZones.length, 1);
    assert.equal(allZones[0].active, false);
    assert.equal(allZones[0].mitigated, true);
    assert.equal(activeOnlyZones.length, 0);
  } finally {
    cleanup();
  }
});

test("buildFvgZoneDefinitions detects bearish iFVGs after bullish gaps are invalidated", async () => {
  const { charting, cleanup } = await loadChartingModule();
  try {
    const bars = [
      makeBar(1, 96, 100, 95, 99),
      makeBar(2, 99, 103, 98, 102),
      makeBar(3, 103, 106, 104, 105),
      makeBar(4, 105, 106, 101, 102),
      makeBar(5, 102, 103, 97, 99),
    ];

    const zones = charting.buildFvgZoneDefinitions(bars, [
      { id: "ifvg-1", kind: "ifvg", settings: { color: "#2563eb", period: 1 }, visible: true },
    ]);

    assert.equal(zones.length, 1);
    assert.equal(zones[0].label, "Bear iFVG");
    assert.equal(zones[0].active, true);
    assert.equal(zones[0].mitigated, false);
    assert.equal(zones[0].low, 100);
    assert.equal(zones[0].high, 104);
  } finally {
    cleanup();
  }
});
