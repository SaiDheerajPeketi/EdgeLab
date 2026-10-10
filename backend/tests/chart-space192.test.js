import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const bundle = buildSync({ bundle: true, format: "cjs", platform: "node", packages: "external", write: false, logLevel: "silent", jsx: "automatic", stdin: {
  contents: 'export * from "./frontend/src/lib/useChartViewportHeight.ts"; export * from "./frontend/src/components/ui/WorkspacePanelManager.tsx";',
  loader: "tsx", resolveDir: fileURLToPath(new URL("../..", import.meta.url)), sourcefile: "chart-space192.tsx",
} }).outputFiles[0].text;
const loaded = { exports: {} };
new Function("require", "module", "exports", bundle)(createRequire(new URL("../../frontend/package.json", import.meta.url)), loaded, loaded.exports);
const { chartViewportPriceHeight, WorkspacePanelManager } = loaded.exports;

// The original desktop plot was 568px; phone/tablet floors and the tall-window cap stay intact.
test("chart price plots retain readable desktop space and compact narrow-screen sizing", () => {
  assert.equal(chartViewportPriceHeight(1440, 400), 568);
  assert.equal(chartViewportPriceHeight(1024, -40), 568);
  assert.equal(chartViewportPriceHeight(1023, 200), 320);
  assert.equal(chartViewportPriceHeight(390, 200), 260);
  assert.equal(chartViewportPriceHeight(480, 200), 260);
  assert.equal(chartViewportPriceHeight(481, 200), 320);
  assert.equal(chartViewportPriceHeight(1440, 725.4), 725);
  assert.equal(chartViewportPriceHeight(1440, 1200), 860);
});

const renderPanel = (collapsed, overlayCollapsed, dock = "right") => renderToStaticMarkup(createElement(WorkspacePanelManager, {
  definitions: [{ id: "journal", label: "Journal", icon: () => null, content: createElement("p", null, "Journal panel") }],
  onChange: () => {}, overlayCollapsed,
  value: { activePanel: "journal", collapsed, dock, mode: "compact", width: 360 },
}, createElement("div", null, "Chart")));

test("only opted-in collapsed desktop chart tools leave the content column", () => {
  for (const dock of ["left", "right"]) {
    const html = renderPanel(true, true, dock);
    assert.match(html, /lg:absolute/);
    assert.ok(html.includes(`lg:${dock}-0`));
    assert.ok(html.includes(`data-overlay-tools="${dock}"`));
    assert.match(html, /sticky top-3 self-start/); // Mobile keeps the existing in-flow trigger.
    assert.match(html, /aria-expanded="false"/);
    assert.doesNotMatch(html, /data-workspace-panel-manager="true"/);
  }
  assert.doesNotMatch(renderPanel(true, false), /lg:absolute/);
});

test("expanded chart tools preserve docked panel width and resize controls", () => {
  for (const dock of ["left", "right"]) {
    const html = renderPanel(false, true, dock);
    assert.doesNotMatch(html, /lg:absolute/);
    assert.doesNotMatch(html, /data-overlay-tools=/);
    assert.ok(html.includes(`data-dock="${dock}"`));
    assert.match(html, /--workspace-panel-width:360px/);
    assert.match(html, /role="separator"/);
    assert.match(html, /Journal panel/);
  }
});
