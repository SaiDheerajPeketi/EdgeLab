import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { buildSync } from "../../node_modules/esbuild/lib/main.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

async function bundle(relativePath) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "edgelab-foundation-"));
  const output = path.join(directory, "module.mjs");
  buildSync({ bundle: true, entryPoints: [path.join(root, relativePath)], format: "esm", outfile: output, platform: "node" });
  return { cleanup: () => fs.rmSync(directory, { force: true, recursive: true }), module: await import(`${pathToFileURL(output).href}?${Date.now()}`) };
}

test("every inventoried route has a maintained UI foundation contract", () => {
  const inventory = JSON.parse(read("docs/ui-surface-inventory.json"));
  const contracts = JSON.parse(read("docs/ui-foundation-contracts.json"));
  assert.deepEqual(Object.keys(contracts.routes).sort(), inventory.routes.map(({ path: route }) => route).sort());
  for (const [route, contract] of Object.entries(contracts.routes)) {
    assert.ok(fs.existsSync(path.join(root, contract.source)), `${route} source is missing`);
    assert.ok(contract.restoration, `${route} has no restoration decision`);
  }
  for (const source of Object.values(contracts.sharedContracts)) assert.ok(fs.existsSync(path.join(root, source)), `${source} is missing`);
});

test("stateful operating routes restore rows, filters, drafts, panels, and chart context", () => {
  const navigation = read("frontend/src/lib/navigationState.ts");
  for (const key of ["draft", "filters", "openPanel", "scrollLeft", "scrollTop", "selectedId", "viewport"]) assert.match(navigation, new RegExp(`\\b${key}\\b`));
  assert.match(read("frontend/src/components/journal/JournalTradesSurface.tsx"), /useRestorableSurfaceState<JournalFilters>[\s\S]*"filters"/);
  assert.match(read("frontend/src/components/journal/JournalTradesSurface.tsx"), /"selectedId"/);
  assert.match(read("frontend/src/components/journal/JournalDashboard.tsx"), /"draft"/);
  assert.match(read("frontend/src/components/ResultsPanel.tsx"), /"reports:results"[\s\S]*"filters"/);
  const chart = `${read("frontend/src/lib/chartWorkspace.ts")}\n${read("frontend/src/App.tsx")}`;
  for (const contract of ["visibleRange", "activePaneId", "panelState", "revision"]) assert.ok(chart.includes(contract), `chart workspace does not retain ${contract}`);
  const settings = read("frontend/src/lib/settingsPreferences.ts");
  assert.match(settings, /localStorage/);
  assert.match(read("frontend/src/lib/journalWorkspaceState.ts"), /saveAppStorageItemConfirmed/);
});

test("navigation and mobile overlay use semantic tokens and shared primitives", () => {
  const styles = read("frontend/src/styles.css");
  for (const token of ["--ui-navigation", "--ui-navigation-mobile", "--ui-navigation-active", "--ui-divider", "--ui-danger-surface"]) assert.ok(styles.includes(token), `missing ${token}`);
  for (const file of ["frontend/src/components/Sidebar.tsx", "frontend/src/components/WorkspaceMobileNav.tsx"]) {
    const source = read(file);
    assert.doesNotMatch(source, /#[0-9a-f]{3,8}|rgba?\(/i, `${file} reintroduced one-off colors`);
  }
  const mobile = read("frontend/src/components/WorkspaceMobileNav.tsx");
  assert.match(mobile, /<Drawer[\s\S]*placement="bottom"/);
  assert.doesNotMatch(mobile, /createPortal|role="dialog"|document\.body\.style\.overflow/);
});

test("shared icon and language contracts are used by primary navigation", () => {
  const primitives = read("frontend/src/components/ui/Primitives.tsx");
  assert.match(primitives, /label: string/);
  assert.match(primitives, /tooltip \?\? label/);
  assert.match(primitives, /aria-label=\{label\}/);
  const navigation = read("frontend/src/lib/workspaceNavigation.ts");
  assert.match(navigation, /PRODUCT_TERMS/);
  assert.doesNotMatch(navigation, /\bNotebook\b|\bBacktesting\b|Back test/);
  const language = read("frontend/src/lib/productLanguage.ts");
  for (const term of ["account", "Journal", "chart layout", "Live", "Replay", "report", "session", "settings", "workspace"]) assert.ok(language.includes(`\"${term}\"`), `missing canonical term ${term}`);
});

test("restorable state rejects corrupt and stale schema values", async () => {
  const { cleanup, module } = await bundle("frontend/src/lib/useRestorableSurfaceState.ts");
  try {
    const schema = { version: 2, validate: (value) => Boolean(value && typeof value === "object" && typeof value.query === "string") };
    const fallback = { query: "safe" };
    assert.deepEqual(module.restoreSurfaceValue(null, fallback, schema), fallback);
    assert.deepEqual(module.restoreSurfaceValue({ __schemaVersion: 1, value: { query: "stale" } }, fallback, schema), fallback);
    assert.deepEqual(module.restoreSurfaceValue({ __schemaVersion: 2, value: { query: 42 } }, fallback, schema), fallback);
    assert.deepEqual(module.restoreSurfaceValue({ __schemaVersion: 2, value: { query: "restored" } }, fallback, schema), { query: "restored" });
  } finally { cleanup(); }
});

test("Journal report and settings URLs resolve directly", async () => {
  const { cleanup, module } = await bundle("frontend/src/lib/workspaceRoute.ts");
  try {
    assert.equal(module.workspaceViewFromPath("/app/journal/reports"), "journalReports");
    assert.equal(module.workspaceViewFromPath("/app/journal/reports/weekly"), "journalReports");
    assert.equal(module.workspaceViewFromPath("/app/journal/settings"), "journalSettings");
    assert.equal(module.workspaceViewFromPath("/app/journal/settings/import"), "journalSettings");
  } finally { cleanup(); }
});

test("operating navigation and Journal chrome use semantic surface tokens", () => {
  for (const file of [
    "frontend/src/components/Sidebar.tsx",
    "frontend/src/components/WorkspaceMobileNav.tsx",
    "frontend/src/components/journal/JournalControls.tsx",
    "frontend/src/components/journal/RelationalJournalWorkspace.tsx",
    "frontend/src/components/QuantPanel.tsx",
  ]) assert.doesNotMatch(read(file), /(?:bg|border|text|shadow)-\[?#(?:[0-9a-f]{3,8})/i, `${file} contains a structural one-off color`);
  const journal = read("frontend/src/components/journal/RelationalJournalWorkspace.tsx");
  for (const token of ["--ui-surface", "--ui-divider", "--ui-selection", "--ui-hover", "--ui-focus", "--control-height", "--icon-md"]) assert.ok(journal.includes(token), `Journal chrome missing ${token}`);
});

test("icon-only legacy controls have programmatic names", () => {
  const files = fs.readdirSync(path.join(root, "frontend/src/components"), { recursive: true }).filter((file) => String(file).endsWith(".tsx"));
  for (const relative of files) {
    const file = `frontend/src/components/${relative}`;
    const tags = [...read(file).replaceAll("=>", "⇒").matchAll(/<button\b[^>]*className=(?:"[^"]*icon-button[^"]*"|\{`[^`]*icon-button[^`]*`\})[^>]*>/gs)];
    for (const [tag] of tags) assert.match(tag, /(?:aria-label|title)=/, `${file} has an unnamed icon-only button: ${tag.slice(0, 120)}`);
  }
});

test("floating and docked product tools share sizing and collision contracts", () => {
  const manager = read("frontend/src/components/ui/WorkspacePanelManager.tsx");
  for (const contract of ["FloatingWorkspacePanel", "DockedWorkspacePanel", 'role="separator"', "aria-valuemin", "aria-valuemax", "clampFloatingSize", "--layer-docked-tool"]) assert.ok(manager.includes(contract), `panel manager missing ${contract}`);
  const quant = read("frontend/src/components/QuantPanel.tsx");
  assert.match(quant, /<FloatingWorkspacePanel/);
  assert.doesNotMatch(quant, /<aside|fixed z-\[/);
  const preferences = read("frontend/src/lib/quantAssistant.ts");
  assert.match(preferences, /panelHeight/);
  assert.match(preferences, /panelWidth/);
  const objects = read("frontend/src/components/ChartObjectsPanel.tsx");
  assert.match(objects, /<DockedWorkspacePanel/);
  assert.match(objects, /useRestorableSurfaceState\("chart:objects", "viewport"/);
  assert.match(objects, /OBJECTS_PANEL_SIZE_SCHEMA/);
});

test("interactive overlays delegate portal, focus, dismissal, and layer behavior", () => {
  const palette = read("frontend/src/components/GlobalCommandPalette.tsx");
  assert.match(palette, /<Dialog/);
  assert.doesNotMatch(palette, /createPortal|document\.body\.style\.overflow|event\.key === "Tab"/);
  const chart = read("frontend/src/components/TradingChart.tsx");
  assert.match(chart, /<PointOverlaySurface/);
  assert.doesNotMatch(chart, /createPortal/);
  const overlay = read("frontend/src/components/overlays/OverlaySurface.tsx");
  for (const contract of ["currentPortalHost", "computeOverlayGeometry", "useOverlayDismiss", "useFocusReturn", "PointOverlaySurface"]) assert.ok(overlay.includes(contract), `overlay system missing ${contract}`);
  const catalog = read("frontend/src/components/IndicatorCatalogPanel.tsx");
  assert.match(catalog, /<OverlaySurface/);
  assert.doesNotMatch(catalog, /document\.addEventListener|absolute right-0 top-full|z-\[210\]/);
  const toolbar = read("frontend/src/components/ChartToolbar.tsx");
  assert.match(toolbar, /anchorRef=\{indicatorMenuTriggerRef\}/);
  assert.match(toolbar, /anchorRef=\{commandRef\}/);
  assert.match(toolbar, /anchorRef=\{drawingFavoritesRef\}/);
  assert.match(toolbar, /anchorRef=\{toolsOpen \? settingsTriggerRef : settingsAnchorRef\}/);
  assert.match(toolbar, /triggerRef=\{settingsTriggerRef\}/);
  assert.doesNotMatch(toolbar, /document\.addEventListener\((?:"|')pointerdown|closeOnOutsideClick/);
});

test("provider and account statuses use the product language normalizer", () => {
  const language = read("frontend/src/lib/productLanguage.ts");
  assert.match(language, /humanizeProductStatus/);
  for (const status of ["Disconnected", "Needs attention", "Loading…", "Delayed", "Not supported"]) assert.ok(language.includes(status), `missing direct status copy ${status}`);
  assert.match(read("frontend/src/components/journal/JournalAccountsSurface.tsx"), /humanizeProductStatus\(connection\.status\)/);
});
