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
  fs.copyFileSync(
    path.join(REPO_ROOT, "frontend", "src", "lib", "indicatorMath.ts"),
    path.join(sourceDir, "indicatorMath.ts"),
  );
  fs.copyFileSync(
    path.join(REPO_ROOT, "frontend", "src", "lib", "chartSessions.ts"),
    path.join(sourceDir, "chartSessions.ts"),
  );
  fs.writeFileSync(
    path.join(sourceDir, "pineCatalog.ts"),
    'export type PineCatalogProvenance = { catalogId: string; sourceSha256: string };\n',
    "utf8",
  );
  // Pine is a type-only dependency here; this fixture tests FVG behavior only.
  // Native metadata validation and runtime behavior have their own focused suite.
  fs.writeFileSync(
    path.join(sourceDir, "pineProtocol.ts"),
    'export type PinePrepareResult = { kind: "prepare"; language: "pine"; source: string; overlay: boolean };\nexport type PineStrategySettings = Record<string, string | number | boolean>;\n',
    "utf8",
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
    path.join(sourceDir, "customIndicators.ts"),
    "export type QuantIndicatorSemantics = { scorePlot: string; probabilityPlot?: string | null; probabilityCalibrated: boolean; };\n",
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
      path.join(sourceDir, "customIndicators.ts"),
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

    assert.equal(charting.fvgZoneVisibleSpan(zone, null), null);
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


test("FVG anchors use actual pattern times on a shared sparse study timeline", async () => {
  const { charting, cleanup } = await loadChartingModule();
  try {
    const time = 1_700_001_000;
    const bars = [
      makeBar(time, 98, 100, 96, 99),
      makeBar(time + 300, 102, 105, 99, 104),
      makeBar(time + 600, 105, 108, 104, 106),
    ];
    const [zone] = charting.buildFvgZoneDefinitions(bars, [
      { id: "fvg", kind: "fvg", settings: { period: 1 }, visible: true },
    ]);
    assert.equal(zone.startTime, bars[0].time);
    assert.equal(zone.endTime, bars[2].time);
    const timeline = [time - 1200, time - 600, time, time + 60, time + 300, time + 600, time + 900];
    const mapped = charting.fvgZoneOnChartTimeline(zone, value => {
      const index = timeline.indexOf(value);
      return index === -1 ? null : index;
    });
    assert.equal(mapped.anchorLogical, 2);
    assert.equal(mapped.startLogical, 1.5);
    assert.equal(mapped.endLogical, 5.5);
    assert.equal(mapped.low, 100);
    assert.equal(mapped.high, 104);
    assert.deepEqual(charting.fvgZoneVisibleSpan(mapped, { from: 1, to: 6 }), {
      startLogical: 1.5, endLogical: 5.5,
    });
    // Removing the unrelated study changes indices, not the candle-owned zone.
    const plain = charting.fvgZoneOnChartTimeline(zone, value => bars.findIndex(bar => bar.time === value));
    assert.equal(plain.startLogical, -0.5);
    assert.equal(plain.endLogical, 2.5);
    assert.equal(charting.fvgZoneOnChartTimeline(zone, () => null), null);
    assert.equal(charting.fvgZoneOnChartTimeline(zone, () => NaN), null);
  } finally {
    cleanup();
  }
});

test("iFVG retains the causal inversion and first later touch timestamps through replay", async () => {
  const { charting, cleanup } = await loadChartingModule();
  try {
    const time = 1_700_001_000;
    const bars = [
      makeBar(time, 98, 100, 96, 99),
      makeBar(time + 300, 102, 105, 99, 104),
      makeBar(time + 600, 105, 108, 104, 106),
      makeBar(time + 900, 105, 107, 101, 102),
      makeBar(time + 1200, 99, 103, 97, 99),
      makeBar(time + 1500, 97, 99, 95, 96),
      makeBar(time + 1800, 99, 102, 98, 100),
    ];
    const instance = { id: "ifvg", kind: "ifvg", settings: { period: 1,
      unmitigatedOnly: false, unmitigatedOnlyUserSet: true }, visible: true };
    assert.equal(charting.buildFvgZoneDefinitions(bars.slice(0, 4), [instance]).length, 0);
    const [forming] = charting.buildFvgZoneDefinitions(bars.slice(0, 5), [instance]);
    assert.equal(forming.startTime, bars[4].time);
    assert.equal(forming.endTime, bars[4].time);
    assert.equal(forming.active, true);
    const [extended] = charting.buildFvgZoneDefinitions(bars.slice(0, 6), [instance]);
    assert.equal(extended.startTime, bars[4].time);
    assert.equal(extended.endTime, bars[5].time);
    assert.equal(extended.mitigated, false);
    const [touched] = charting.buildFvgZoneDefinitions(bars, [instance]);
    assert.equal(touched.startTime, bars[4].time);
    assert.equal(touched.endTime, bars[6].time);
    assert.equal(touched.mitigated, true);
    const timeline = [...bars.map(bar => bar.time), time - 600, time - 300, time + 60, time + 1260]
      .sort((a, b) => a - b);
    const mapped = charting.fvgZoneOnChartTimeline(touched, value => timeline.indexOf(value));
    assert.equal(mapped.startLogical, timeline.indexOf(bars[4].time) - 0.5);
    assert.equal(mapped.endLogical, timeline.indexOf(bars[6].time) + 0.5);
    assert.equal(mapped.label, "Bearish iFVG");
    // Rewind recomputes from its own prefix: later inversion/mitigation cannot leak.
    const [rewound] = charting.buildFvgZoneDefinitions(bars.slice(0, 5), [instance]);
    assert.equal(rewound.mitigated, false);
    assert.equal(rewound.endTime, bars[4].time);
  } finally {
    cleanup();
  }
});


test("FVG half-candle coordinates interpolate integer-only chart scales through pan and zoom", async () => {
  const { charting, cleanup } = await loadChartingModule();
  try {
    for (const [spacing, translation] of [[6, 280], [18, -300], [2.5, 0]]) {
      const calls = [];
      const scale = index => {
        calls.push(index);
        // This is the installed LWC contract: fractional indices return zero.
        return Number.isInteger(index) ? translation + index * spacing : 0;
      };
      assert.equal(scale(7.5), 0);
      calls.length = 0;
      const left = charting.fvgLogicalToCoordinate(7.5, scale);
      const right = charting.fvgLogicalToCoordinate(11.5, scale);
      assert.equal(left, translation + 7.5 * spacing);
      assert.equal(right, translation + 11.5 * spacing);
      assert.equal(right - left, 4 * spacing);
      assert.deepEqual(calls, [7, 8, 11, 12]);
      assert.equal(charting.fvgLogicalToCoordinate(-0.5, scale), translation - spacing / 2);
    }
    assert.equal(charting.fvgLogicalToCoordinate(0, () => 0), 0);
    assert.equal(charting.fvgLogicalToCoordinate(1.5, index => index === 1 ? 12 : null), null);
    assert.equal(charting.fvgLogicalToCoordinate(1.5, () => NaN), null);
    assert.equal(charting.fvgLogicalToCoordinate(Infinity, () => assert.fail("invalid index queried")), null);
  } finally {
    cleanup();
  }
});
