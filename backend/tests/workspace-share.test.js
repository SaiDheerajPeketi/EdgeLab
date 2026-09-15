import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tscBin = path.join(repoRoot, "frontend/node_modules/typescript/bin/tsc");

function loadWorkspaceShareModule() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "edgelab-workspace-share-"));
  const sourceDir = path.join(tempDir, "src");
  const outDir = path.join(tempDir, "out");
  fs.mkdirSync(sourceDir, { recursive: true });
  for (const file of [
    "workspaceShare.ts",
    "chartSettings.ts",
    "chartSessions.ts",
    "chartTimezones.ts",
    "colorTokens.ts",
    "orderFlowPresentation.ts",
  ]) {
    fs.copyFileSync(
      path.join(repoRoot, "frontend/src/lib", file),
      path.join(sourceDir, file),
    );
  }
  fs.writeFileSync(
    path.join(sourceDir, "charting.ts"),
    [
      "export type ChartDrawing = any;",
      "export type ChartIndicatorInstance = any;",
      "export type ChartStyle = any;",
      "export type ChartTimeframe = any;",
      "export type DrawingTool = any;",
      "export type MagnetMode = any;",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(sourceDir, "chartLayouts.ts"),
    "export type ChartPaneLayoutId = any;\n",
  );
  fs.writeFileSync(
    path.join(sourceDir, "serverStorage.ts"),
    [
      "export function getCachedAppStorageItem<T>(_key: string, fallback: T): T { return fallback; }",
      "export async function loadAppStorageItem<T>(_key: string, fallback: T): Promise<T> { return fallback; }",
      "export async function saveAppStorageItem<T>(_key: string, value: T): Promise<T> { return value; }",
      "export function subscribeAppStorageItem<T>(_key: string, _listener: (value: T) => void) { return () => undefined; }",
    ].join("\n"),
  );
  const inputs = fs.readdirSync(sourceDir).map((file) => path.join(sourceDir, file));
  const compile = spawnSync(
    process.execPath,
    [
      tscBin,
      "--module",
      "commonjs",
      "--target",
      "es2022",
      "--skipLibCheck",
      "--outDir",
      outDir,
      ...inputs,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (compile.status !== 0) {
    fs.rmSync(tempDir, { force: true, recursive: true });
    throw new Error(compile.stderr || compile.stdout || "workspaceShare compile failed");
  }
  const require = createRequire(import.meta.url);
  const module = require(path.join(outDir, "workspaceShare.js"));
  return {
    module,
    cleanup: () => fs.rmSync(tempDir, { force: true, recursive: true }),
  };
}

test("workspace share projects real API candles to strict OHLCV", () => {
  const { module, cleanup } = loadWorkspaceShareModule();
  try {
    const payload = module.buildWorkspaceSharePayload("chart-plus-panels", {
      activePanel: "none",
      activePaneId: "chart-pane-1",
      candles: [{
        time: 1_789_459_200,
        timestamp: "2026-09-15T10:00:00Z",
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 42,
        ema_20: 100.5,
        ema_50: 99.5,
        rsi_14: 55,
      }],
      currentTimestamp: "2026-09-15T10:00:00Z",
      layoutName: "Review",
      metrics: null,
      paneLayout: "single",
      panes: [{
        id: "chart-pane-1",
        timeframe: "1m",
        chartStyle: "candles",
        chartSettings: {},
        drawingTool: "crosshair",
        drawings: [],
        indicatorInstances: [],
        magnetMode: "off",
        smoothCandles: false,
      }],
      sidebarCollapsed: false,
      symbol: "EURUSD",
      timeframe: "1m",
      timezone: "UTC",
    });

    assert.deepEqual(Object.keys(payload.chart.candles[0]).sort(), [
      "close",
      "high",
      "low",
      "open",
      "time",
      "timestamp",
      "volume",
    ]);
  } finally {
    cleanup();
  }
});

test("workspace copy artifacts preserve every scoped field through serialized reload", () => {
  const { module, cleanup } = loadWorkspaceShareModule();
  try {
    const source = {
      activePanel: "results",
      activePaneId: "chart-pane-1",
      candles: [{
        time: 1_789_459_200,
        timestamp: "2026-09-15T10:00:00Z",
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 42,
      }],
      currentTimestamp: "2026-09-15T10:00:00Z",
      layoutName: "Review",
      metrics: {
        net_pnl: 125.5,
        win_rate: 60,
        total_trades: 5,
        winning_trades: 3,
        breakeven_trades: 1,
        profit_factor: 1.8,
        max_drawdown: 24,
        average_r: 0.7,
        expectancy: 25.1,
      },
      paneLayout: "grid-4",
      panes: [{
        id: "chart-pane-1",
        timeframe: "1m",
        chartStyle: "candles",
        chartSettings: {},
        drawingTool: "crosshair",
        drawings: [],
        indicatorInstances: [],
        magnetMode: "strong",
        smoothCandles: true,
      }],
      sidebarCollapsed: true,
      symbol: "EURUSD",
      timeframe: "1m",
      timezone: "Europe/London",
    };
    const payload = module.buildWorkspaceSharePayload("complete-workspace", source);
    const artifact = module.createWorkspaceShareCopyArtifact("London replay", payload);
    const reloaded = module.sanitizeWorkspaceShareCopyArtifact(
      JSON.parse(JSON.stringify(artifact)),
    );

    assert.equal(reloaded.scope, "complete-workspace");
    assert.equal(reloaded.payload.chart.symbol, "EURUSD");
    assert.equal(reloaded.payload.chart.candles[0].close, 101);
    assert.equal(reloaded.payload.chart.panes[0].magnetMode, "strong");
    assert.deepEqual(reloaded.payload.panels.metrics, {
      averageR: 0.7,
      breakevenTrades: 1,
      expectancy: 25.1,
      maxDrawdown: 24,
      netPnl: 125.5,
      profitFactor: 1.8,
      totalTrades: 5,
      winRate: 60,
      winningTrades: 3,
    });
    assert.deepEqual(reloaded.payload.workspace, {
      activeView: "backtest",
      layoutName: "Review",
      paneLayout: "grid-4",
      sidebarCollapsed: true,
      timezone: "Europe/London",
    });

    payload.chart.symbol = "MUTATED";
    assert.equal(reloaded.payload.chart.symbol, "EURUSD");
  } finally {
    cleanup();
  }
});

test("panels-only copies remain isolated artifacts and malformed scopes are rejected", () => {
  const { module, cleanup } = loadWorkspaceShareModule();
  try {
    const payload = module.buildWorkspaceSharePayload("panels-only", {
      activePanel: "review",
      activePaneId: null,
      candles: [],
      currentTimestamp: null,
      layoutName: "Panels",
      metrics: { net_pnl: 42, total_trades: 2, win_rate: 50 },
      paneLayout: "single",
      panes: [],
      sidebarCollapsed: false,
      symbol: "NQ",
      timeframe: "5m",
      timezone: "UTC",
    });
    const artifact = module.createWorkspaceShareCopyArtifact("Panel review", payload);

    assert.equal(artifact.scope, "panels-only");
    assert.equal(artifact.payload.chart, null);
    assert.equal(artifact.payload.workspace, null);
    assert.equal(artifact.payload.panels.metrics.netPnl, 42);
    assert.throws(
      () => module.createWorkspaceShareCopyArtifact("Invalid", {
        schemaVersion: 1,
        chart: null,
        panels: null,
        workspace: null,
      }),
      /could not be copied safely/,
    );
  } finally {
    cleanup();
  }
});

test("frontend timezone share payload validates against the strict backend schema", () => {
  const { module, cleanup } = loadWorkspaceShareModule();
  try {
    const payload = module.buildWorkspaceSharePayload("chart-plus-panels", {
      activePanel: "results",
      activePaneId: "chart-pane-1",
      candles: [],
      currentTimestamp: null,
      layoutName: "Timezone proof",
      metrics: { total_trades: 0 },
      paneLayout: "single",
      panes: [{
        id: "chart-pane-1",
        timeframe: "1m",
        chartStyle: "candles",
        chartSettings: { timeZone: "America/New_York" },
        drawingTool: "crosshair",
        drawings: [],
        indicatorInstances: [],
        magnetMode: "off",
        smoothCandles: false,
      }],
      sidebarCollapsed: false,
      symbol: "EURUSD",
      timeframe: "1m",
      timezone: "America/New_York",
    });
    const validation = spawnSync(
      path.join(repoRoot, "backend/.venv/bin/python"),
      [
        "-c",
        [
          "import json, sys",
          "from app.schemas import WorkspaceShareCreate",
          "value = WorkspaceShareCreate.model_validate(json.load(sys.stdin))",
          "print(value.payload.chart.panes[0].chart_settings.time_zone)",
        ].join("; "),
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, PYTHONPATH: path.join(repoRoot, "backend") },
        input: JSON.stringify({
          workspace_key: "replay:timezone-proof",
          title: "Timezone proof",
          scope: "chart-plus-panels",
          payload,
        }),
      },
    );
    assert.equal(validation.status, 0, validation.stderr || validation.stdout);
    assert.equal(validation.stdout.trim(), "America/New_York");
  } finally {
    cleanup();
  }
});

test("copy handoff source contains no session storage payload bridge", () => {
  for (const file of [
    "frontend/src/lib/workspaceShare.ts",
    "frontend/src/pages/SharedWorkspacePage.tsx",
    "frontend/src/App.tsx",
  ]) {
    const source = fs.readFileSync(path.join(repoRoot, file), "utf8");
    assert.doesNotMatch(source, /\bsessionStorage\b/);
    assert.doesNotMatch(source, /stageWorkspaceShareCopy|consumeWorkspaceShareCopy/);
  }
});

test("creating and keying a copy never touches session storage", () => {
  const previousWindow = globalThis.window;
  let sessionStorageTouches = 0;
  globalThis.window = {
    sessionStorage: {
      getItem: () => { sessionStorageTouches += 1; return null; },
      removeItem: () => { sessionStorageTouches += 1; },
      setItem: () => { sessionStorageTouches += 1; },
    },
  };
  const { module, cleanup } = loadWorkspaceShareModule();
  try {
    const payload = module.buildWorkspaceSharePayload("panels-only", {
      activePanel: "results",
      activePaneId: null,
      candles: [],
      currentTimestamp: null,
      layoutName: "Panels",
      metrics: { net_pnl: 5, total_trades: 1, win_rate: 100 },
      paneLayout: "single",
      panes: [],
      sidebarCollapsed: false,
      symbol: "NQ",
      timeframe: "5m",
      timezone: "UTC",
    });
    const artifact = module.createWorkspaceShareCopyArtifact("Panel copy", payload);
    module.workspaceShareCopyStorageKey(artifact.id);
    assert.equal(sessionStorageTouches, 0);
  } finally {
    cleanup();
    globalThis.window = previousWindow;
  }
});

test("copy IDs map to one validated storage key per artifact", () => {
  const { module, cleanup } = loadWorkspaceShareModule();
  try {
    const payload = module.buildWorkspaceSharePayload("panels-only", {
      activePanel: "results",
      activePaneId: null,
      candles: [],
      currentTimestamp: null,
      layoutName: "Panels",
      metrics: { net_pnl: 12, total_trades: 1, win_rate: 100 },
      paneLayout: "single",
      panes: [],
      sidebarCollapsed: false,
      symbol: "NQ",
      timeframe: "5m",
      timezone: "UTC",
    });
    const first = module.createWorkspaceShareCopyArtifact("First", payload);
    const second = module.createWorkspaceShareCopyArtifact("Second", payload);

    assert.notEqual(first.id, second.id);
    assert.equal(
      module.workspaceShareCopyStorageKey(first.id),
      `workspace-share-copy.v1.${first.id}`,
    );
    assert.notEqual(
      module.workspaceShareCopyStorageKey(first.id),
      module.workspaceShareCopyStorageKey(second.id),
    );
    for (const invalidId of [
      "workspace-copy-short",
      "../workspace-copy-12345678",
      "workspace-copy-12345678/extra",
      "workspace-share-copies.v1",
      "",
    ]) {
      assert.throws(
        () => module.workspaceShareCopyStorageKey(invalidId),
        /Invalid workspace copy ID/,
      );
    }
    assert.equal(
      module.sanitizeWorkspaceShareCopyArtifact({ ...first, id: "workspace-copy-short" }),
      null,
    );
  } finally {
    cleanup();
  }
});
