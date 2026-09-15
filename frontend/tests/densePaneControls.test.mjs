import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSync } from "esbuild";

const frontendRoot = fileURLToPath(new URL("..", import.meta.url));
const bundleDirectory = mkdtempSync(path.join(tmpdir(), "edgelab-dense-pane-controls-"));
const bundlePath = path.join(bundleDirectory, "chart-layouts-test.mjs");
buildSync({
  bundle: true,
  entryPoints: [path.join(frontendRoot, "src/lib/chartLayouts.ts")],
  format: "esm",
  logLevel: "silent",
  outfile: bundlePath,
  platform: "node",
  target: "node22",
});
const { shouldMountPaneDrawingControls } = await import(pathToFileURL(bundlePath).href);
after(() => rmSync(bundleDirectory, { force: true, recursive: true }));

test("only the active dense pane mounts drawing controls", () => {
  for (const paneCount of [1, 2, 4, 6]) {
    assert.equal(shouldMountPaneDrawingControls(paneCount, false), true);
  }
  for (const paneCount of [9, 12, 16]) {
    assert.equal(shouldMountPaneDrawingControls(paneCount, false), false);
    assert.equal(shouldMountPaneDrawingControls(paneCount, true), true);
  }
});

test("inactive controls skip favorite subscriptions, radial listeners, and rail construction", () => {
  const chart = readFileSync(
    path.join(frontendRoot, "src/components/TradingChart.tsx"),
    "utf8",
  );
  const hydrateIndex = chart.indexOf("void hydrateDrawingToolFavorites()");
  const hydrateEffectStart = chart.lastIndexOf("useEffect(() => {", hydrateIndex);
  const radialIndex = chart.indexOf('window.addEventListener("keydown", handleRadialKeyDown)');
  const radialEffectStart = chart.lastIndexOf("useEffect(() => {", radialIndex);
  const hydrateGateIndex = chart.indexOf("if (!drawingControlsActive)", hydrateEffectStart);
  const radialGateIndex = chart.indexOf("if (!drawingControlsActive)", radialEffectStart);

  assert.ok(hydrateEffectStart >= 0 && radialEffectStart >= 0);
  assert.ok(
    hydrateGateIndex >= hydrateEffectStart && hydrateGateIndex < hydrateIndex,
    "favorites must not hydrate for an inactive dense pane",
  );
  assert.ok(
    radialGateIndex >= radialEffectStart && radialGateIndex < radialIndex,
    "radial window listeners must not mount for an inactive dense pane",
  );
  assert.match(chart, /\{drawingControlsActive && radialToolbox && \(/);
  assert.match(chart, /\{showDrawingRail && drawingControlsActive \? \(/);
});

test("hover and focus transfer dense-pane control ownership before Alt handling", () => {
  for (const relativePath of ["src/App.tsx", "src/components/EdgeLabWorkspace.tsx"]) {
    const workspace = readFileSync(path.join(frontendRoot, relativePath), "utf8");
    assert.match(workspace, /onFocusCapture=\{paneDrawingControlsActive \? undefined : \(\) => selectChartPane\(pane\.id\)\}/);
    assert.match(workspace, /onPointerEnter=\{paneDrawingControlsActive \? undefined : \(\) => selectChartPane\(pane\.id\)\}/);
    assert.match(workspace, /drawingControlsActive=\{paneDrawingControlsActive\}/);
  }
});
