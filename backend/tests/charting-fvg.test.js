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

test("FVGs render as the three-candle pattern box with a label", async () => {
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
        zone.label === "Bullish FVG" &&
        zone.active === true &&
        zone.mitigated === false &&
        zone.low === 100 &&
        zone.high === 104,
    );
    assert.ok(matchingZone);
    assert.equal(matchingZone.startLogical, -0.5);
    assert.equal(matchingZone.endLogical, 2.5);
    assert.equal(matchingZone.anchorLogical, 0);
    assert.equal(matchingZone.showLabel, true);
  } finally {
    cleanup();
  }
});

test("FVG mitigation is tracked and touched zones are filtered when requested", async () => {
  const { charting, cleanup } = await loadChartingModule();
  try {
    const bars = [
      makeBar(1, 96, 100, 95, 99),
      makeBar(2, 99, 103, 98, 102),
      makeBar(3, 103, 106, 104, 105),
      makeBar(4, 105, 107, 103, 104),
      makeBar(5, 104, 109, 102, 108),
    ];

    const allZones = charting.buildFvgZoneDefinitions(bars, [
      {
        id: "fvg-1",
        kind: "fvg",
        settings: {
          color: "#f59e0b",
          period: 1,
          unmitigatedOnly: false,
          unmitigatedOnlyUserSet: true,
        },
        visible: true,
      },
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
    assert.equal(allZones[0].startLogical, -0.5);
    assert.equal(allZones[0].endLogical, 2.5);
    assert.equal(activeOnlyZones.length, 0);
  } finally {
    cleanup();
  }
});

test("a wick through an FVG does not create an iFVG without a close beyond it", async () => {
  const { charting, cleanup } = await loadChartingModule();
  try {
    const bars = [
      makeBar(1, 96, 100, 95, 99),
      makeBar(2, 99, 103, 98, 102),
      makeBar(3, 103, 106, 104, 105),
      makeBar(4, 105, 106, 99, 101),
      makeBar(5, 101, 105, 100, 103),
    ];

    const zones = charting.buildFvgZoneDefinitions(bars, [
      { id: "ifvg-1", kind: "ifvg", settings: { color: "#2563eb", period: 1 }, visible: true },
    ]);

    assert.equal(zones.length, 0);
  } finally {
    cleanup();
  }
});

test("iFVGs begin on the closing invalidation candle and extend while untouched", async () => {
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
    assert.equal(zones[0].label, "Bearish iFVG");
    assert.equal(zones[0].active, true);
    assert.equal(zones[0].mitigated, false);
    assert.equal(zones[0].low, 100);
    assert.equal(zones[0].high, 104);
    assert.equal(zones[0].startLogical, 3.5);
    assert.equal(zones[0].endLogical, 4.5);
    assert.equal(zones[0].anchorLogical, 4);
  } finally {
    cleanup();
  }
});

test("iFVG mitigation occurs on its first later touch", async () => {
  const { charting, cleanup } = await loadChartingModule();
  try {
    const bars = [
      makeBar(1, 96, 100, 95, 99),
      makeBar(2, 99, 103, 98, 102),
      makeBar(3, 103, 106, 104, 105),
      makeBar(4, 105, 106, 97, 99),
      makeBar(5, 99, 99, 95, 96),
      makeBar(6, 96, 101, 95, 100),
      makeBar(7, 100, 102, 98, 101),
    ];

    const allZones = charting.buildFvgZoneDefinitions(bars, [
      {
        id: "ifvg-1",
        kind: "ifvg",
        settings: {
          color: "#2563eb",
          period: 1,
          unmitigatedOnly: false,
          unmitigatedOnlyUserSet: true,
        },
        visible: true,
      },
    ]);
    const untouchedZones = charting.buildFvgZoneDefinitions(bars, [
      {
        id: "ifvg-2",
        kind: "ifvg",
        settings: { color: "#2563eb", period: 1, unmitigatedOnly: true },
        visible: true,
      },
    ]);

    assert.equal(allZones.length, 1);
    assert.equal(allZones[0].active, false);
    assert.equal(allZones[0].mitigated, true);
    assert.equal(allZones[0].startLogical, 2.5);
    assert.equal(allZones[0].endLogical, 5.5);
    assert.equal(untouchedZones.length, 0);
  } finally {
    cleanup();
  }
});

test("FVG and iFVG default to unmitigated-only filtering", async () => {
  const { charting, cleanup } = await loadChartingModule();
  try {
    const bars = [
      makeBar(1, 96, 100, 95, 99),
      makeBar(2, 99, 103, 98, 102),
      makeBar(3, 103, 106, 104, 105),
      makeBar(4, 105, 106, 97, 99),
      makeBar(5, 99, 99, 95, 96),
      makeBar(6, 96, 101, 95, 100),
    ];

    const fvgZones = charting.buildFvgZoneDefinitions(bars, [
      { id: "fvg-1", kind: "fvg", settings: { color: "#f59e0b", period: 1 }, visible: true },
    ]);
    const ifvgZones = charting.buildFvgZoneDefinitions(bars, [
      { id: "ifvg-1", kind: "ifvg", settings: { color: "#2563eb", period: 1 }, visible: true },
    ]);

    assert.equal(fvgZones.length, 0);
    assert.equal(ifvgZones.length, 0);
  } finally {
    cleanup();
  }
});

test("old saved FVG all-zone defaults migrate to unmitigated-only", async () => {
  const { charting, cleanup } = await loadChartingModule();
  try {
    const legacyDefault = charting.mergeIndicatorSettings("fvg", {
      color: "#f59e0b",
      period: 1,
      unmitigatedOnly: false,
    });
    const explicitChoice = charting.mergeIndicatorSettings("fvg", {
      color: "#f59e0b",
      period: 1,
      unmitigatedOnly: false,
      unmitigatedOnlyUserSet: true,
    });

    assert.equal(legacyDefault.unmitigatedOnly, true);
    assert.equal(explicitChoice.unmitigatedOnly, false);
  } finally {
    cleanup();
  }
});

test("label visibility and bullish and bearish colors are applied independently", async () => {
  const { charting, cleanup } = await loadChartingModule();
  try {
    const bars = [
      makeBar(1, 96, 100, 95, 99),
      makeBar(2, 99, 103, 98, 102),
      makeBar(3, 103, 106, 104, 105),
      makeBar(4, 105, 108, 105, 107),
      makeBar(5, 107, 108, 102, 103),
      makeBar(6, 103, 104, 99, 100),
    ];

    const zones = charting.buildFvgZoneDefinitions(bars, [
      {
        id: "fvg-1",
        kind: "fvg",
        settings: {
          color: "#22c55e",
          period: 1,
          secondaryColor: "#ef4444",
          showLabels: false,
          unmitigatedOnly: false,
          unmitigatedOnlyUserSet: true,
        },
        visible: true,
      },
    ]);

    assert.equal(zones.find((zone) => zone.label === "Bullish FVG")?.color, "#22c55e");
    assert.equal(zones.find((zone) => zone.label === "Bearish FVG")?.color, "#ef4444");
    assert.equal(zones.every((zone) => zone.showLabel === false), true);
  } finally {
    cleanup();
  }
});

test("FVG visible spans are not clamped to the viewport left edge", async () => {
  const { charting, cleanup } = await loadChartingModule();
  try {
    const zone = {
      startLogical: 8.5,
      endLogical: 14.5,
    };

    assert.equal(charting.fvgZoneVisibleSpan(zone, { from: 9, to: 16 }), null);
    assert.deepEqual(charting.fvgZoneVisibleSpan(zone, { from: 8, to: 16 }), {
      startLogical: 8.5,
      endLogical: 14.5,
    });
  } finally {
    cleanup();
  }
});

test("FVG visible spans preserve the three-candle pattern width", async () => {
  const { charting, cleanup } = await loadChartingModule();
  try {
    const bars = [
      makeBar(1, 96, 100, 95, 99),
      makeBar(2, 99, 103, 98, 102),
      makeBar(3, 103, 106, 104, 105),
      makeBar(4, 105, 108, 105, 107),
      makeBar(5, 107, 109, 105, 108),
      makeBar(6, 108, 110, 105, 109),
    ];

    const [zone] = charting.buildFvgZoneDefinitions(bars, [
      { id: "fvg-1", kind: "fvg", settings: { color: "#f59e0b", period: 1 }, visible: true },
    ]);

    assert.equal(zone.endLogical, 2.5);
    assert.deepEqual(charting.fvgZoneVisibleSpan(zone, { from: -1, to: 4 }), {
      startLogical: -0.5,
      endLogical: 2.5,
    });
  } finally {
    cleanup();
  }
});
