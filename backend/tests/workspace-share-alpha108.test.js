import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../../", import.meta.url));
const bundle = (await build({ bundle: true, format: "esm", platform: "node", write: false,
  logLevel: "silent", stdin: { contents: 'export * from "./frontend/src/lib/workspaceShare.ts";',
    resolveDir: root, loader: "ts" } })).outputFiles[0].text;
const share = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const drawing = (color = "#abc") => ({ id: "fib-alpha", tool: "fib", color,
  createdAt: "2026-10-08T00:00:00Z", points: [{ time: 1_700_000_100, price: 100 }],
  fillOpacity: .4, labelBackgroundOpacity: .3, rewardColor: "#1a2b3c80", riskColor: "#ff000000",
  fibLevels: [{ id: "half", value: .5, color: "#A1b2C340", backgroundOpacity: .25, visible: true }] });
const source = (drawings = [drawing()]) => ({ activePanel: "none", activePaneId: "pane-1",
  candles: [], currentTimestamp: null, layoutName: "Alpha proof", metrics: null,
  paneLayout: "single", panes: [{ id: "pane-1", timeframe: "1m", chartStyle: "candles",
    chartSettings: {}, drawingTool: "crosshair", drawings, indicatorInstances: [],
    magnetMode: "off", smoothCandles: false }], sidebarCollapsed: false,
  symbol: "EURUSD", timeframe: "1m", timezone: "UTC" });
const pane = payload => payload.chart.panes[0];
function validateBackend(payload) {
  const result = spawnSync(root + "backend/.venv/bin/python", ["-c", [
    "import json, sys", "from app.schemas import WorkspaceShareCreate",
    "value = WorkspaceShareCreate.model_validate(json.load(sys.stdin))",
    "print(value.model_dump_json(by_alias=True))",
  ].join("; ")], { cwd: root, encoding: "utf8", env: { ...process.env, PYTHONPATH: root + "backend" },
    input: JSON.stringify({ workspace_key: "replay:alpha108", title: "Alpha proof",
      scope: "complete-workspace", payload }) });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout).payload;
}

test("genuine serialized share validates drawing/Fib/reward/risk alpha at the backend", () => {
  const original = source([drawing("#123456ff"), drawing("#aBc"), drawing("#00ff00")]);
  const before = JSON.stringify(original);
  const payload = share.buildWorkspaceSharePayload("complete-workspace", original);
  const serialized = JSON.parse(JSON.stringify(payload));
  const checked = validateBackend(serialized);
  assert.deepEqual(pane(checked).drawings.map(item => item.color), ["#123456FF", "#AABBCC", "#00FF00"]);
  for (const item of pane(checked).drawings) {
    assert.equal(item.rewardColor, "#1A2B3C80");
    assert.equal(item.riskColor, "#FF000000");
    assert.equal(item.fibLevels[0].color, "#A1B2C340");
    assert.equal(item.fillOpacity, .4);
    assert.equal(item.labelBackgroundOpacity, .3);
    assert.equal(item.fibLevels[0].backgroundOpacity, .25);
  }
  assert.equal(JSON.stringify(original), before);
});

test("share copy roundtrip retains transparent and translucent drawings", () => {
  const payload = share.buildWorkspaceSharePayload("complete-workspace", source([drawing("#01020300")]));
  const copy = share.createWorkspaceShareCopyArtifact("Alpha copy", payload);
  const restored = share.sanitizeWorkspaceShareCopyArtifact(JSON.parse(JSON.stringify(copy)));
  assert.ok(restored);
  assert.deepEqual(restored.payload, copy.payload);
  assert.deepEqual(pane(restored.payload).drawings, pane(payload).drawings);
  assert.equal(pane(restored.payload).drawings[0].color, "#01020300");
});

test("invalid drawing colors retain safe defaults; indicator/chart colors do not acquire alpha", () => {
  const original = source([drawing("#1234")]);
  const item = original.panes[0].drawings[0];
  item.fibLevels[0].color = "rgba(1,2,3,.5)";
  item.rewardColor = "#1234567";
  item.riskColor = "#gg000080";
  original.panes[0].indicatorInstances = [{ id: "ema-1", kind: "ema", visible: true,
    settings: { period: 20, color: "#11223380" } }];
  original.panes[0].chartSettings = { backgroundColor: "#11223380" };
  const payload = share.buildWorkspaceSharePayload("complete-workspace", original);
  const result = pane(payload);
  assert.equal(result.drawings[0].color, "#32D3EE");
  assert.equal(result.drawings[0].fibLevels[0].color, "#32D3EE");
  assert.equal(result.drawings[0].rewardColor, "#22C55E");
  assert.equal(result.drawings[0].riskColor, "#EF4444");
  assert.match(result.indicatorInstances[0].settings.color, /^#[0-9A-F]{6}$/i);
  assert.match(result.chartSettings.backgroundColor, /^#[0-9A-F]{6}$/i);
  validateBackend(payload);
});

test("alpha support preserves existing share collection bounds", () => {
  const oversized = drawing("#11223380");
  oversized.points = Array.from({ length: 70 }, (_, i) => ({ time: 1_700_000_100 + i, price: 100 }));
  oversized.fibLevels = Array.from({ length: 40 }, (_, i) => ({ id: String(i), value: i / 40,
    color: "#abcdef80", visible: true }));
  const payload = share.buildWorkspaceSharePayload("complete-workspace", source(Array.from({ length: 510 }, () => oversized)));
  assert.equal(pane(payload).drawings.length, 500);
  assert.equal(pane(payload).drawings[0].points.length, 64);
  assert.equal(pane(payload).drawings[0].fibLevels.length, 32);
  assert.equal(pane(payload).drawings.at(-1).fibLevels.at(-1).color, "#ABCDEF80");
});
