import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const matrix = JSON.parse(fs.readFileSync(path.join(root, "docs/ui-release-matrix.json"), "utf8"));
const styles = fs.readFileSync(path.join(root, "frontend/src/styles.css"), "utf8");
const routes = fs.readFileSync(path.join(root, "frontend/src/routes/AppRoutes.tsx"), "utf8");
const compatibility = fs.readFileSync(path.join(root, "frontend/src/components/compatibility/CompatibilityRouteRenderer.tsx"), "utf8");
const foundation = fs.readFileSync(path.join(root, "frontend/src/lib/uiFoundation.ts"), "utf8");
const rollout = fs.readFileSync(path.join(root, "frontend/src/lib/uiRollout.ts"), "utf8");
const uiWorkflow = fs.readFileSync(path.join(root, ".github/workflows/ui-regression.yml"), "utf8");
const inventory = JSON.parse(fs.readFileSync(path.join(root, "docs/ui-surface-inventory.json"), "utf8"));
const snapshotRoot = path.join(root, "e2e/__snapshots__");

assert.deepEqual(Object.keys(matrix.viewports), ["mobile", "tablet", "desktop", "tradingDesktop"]);
for (const route of ["landing", "settings", "journal", "chart"]) {
  assert.ok(matrix.routes[route]);
  assert.ok(matrix.routes[route].viewports.length >= 3);
  assert.ok(matrix.routes[route].states.length >= 4);
}
assert.equal(matrix.viewports.mobile.zoom, 1);
assert.equal(matrix.viewports.mobile.pointer, "coarse");
assert.ok(matrix.locales.includes("ar-SA"));
assert.ok(matrix.requiredAssertions.includes("color-redundancy"));
assert.match(styles, /prefers-reduced-motion:\s*reduce/);
assert.match(styles, /pointer:\s*coarse/);
assert.match(styles, /min-height:\s*var\(--density-touch\)/);
assert.match(styles, /\[dir="rtl"\]/);
assert.match(styles, /ui-route-enter/);
assert.match(routes, /RouteTransitionBoundary/);
assert.match(routes, /CompatibilityRouteRenderer/);
assert.match(routes, /modernUiEnabled \? children : <Suspense fallback=\{<AppRouteFallback \/>\}><CompatibilityRouteRenderer/);
assert.match(compatibility, /data-compatibility-renderer/);
for (const renderer of ["PublicCompatibility", "ShellCompatibility", "JournalCompatibility", "SettingsCompatibility", "ChartCompatibility"]) assert.match(compatibility, new RegExp(`function ${renderer}`));
assert.match(foundation, /bodyTextContrast:\s*4\.5/);
assert.match(foundation, /maximumZoomPercent:\s*200/);
assert.match(foundation, /financialState/);
for (const flag of ["ui.shell.v2", "ui.journal.v2", "ui.settings.v2", "ui.chart.v2", "ui.public.v2"]) assert.ok(rollout.includes(flag));
assert.match(rollout, /killSwitch \? false/);
assert.match(rollout, /UI_COMPATIBILITY_ROUTES/);
assert.match(rollout, /UI_COMPATIBILITY_PATHS/);
assert.match(rollout, /compatibilityRouteIsMapped/);
assert.match(rollout, /UI_COMPATIBILITY_ROUTE_PARITY/);
assert.match(rollout, /compatibilityParityContract/);
assert.ok(inventory.routes.length >= 18);
assert.ok(inventory.routes.every((route) => route.disposition && route.states.length));
const ciSnapshotPlatform = "darwin";
assert.match(uiWorkflow, /runs-on:\s*macos-/);
assert.match(uiWorkflow, /playwright install chromium/);
const protectedSnapshots = path.join(snapshotRoot, `protected-workspace.quality.spec.ts/${ciSnapshotPlatform}`);
for (const viewport of ["mobile", "tablet", "desktop"]) {
  for (const baseline of ["gateway", "chart-compact", "chart-2-pane", "chart-4-pane", "chart-16-pane", "replay", "journal-dashboard", "journal-accounts", "journal-trades", "journal-analytics", "journal-notes", "journal-calendar", "journal-reports", "journal-settings", "reports", "quant", "settings", "shared-ready", "shared-expired", "shared-loading"]) {
    assert.ok(fs.existsSync(path.join(protectedSnapshots, viewport, `${baseline}.png`)), `Missing ${viewport}/${baseline}.png`);
  }
  assert.ok(fs.existsSync(path.join(protectedSnapshots, viewport, "chart-fullscreen.png")), `Missing ${viewport}/chart-fullscreen.png`);
}
for (const assertion of ["contrast-aa", "textual-chart-summary", "zoom-200", "rtl", "server-rollout-fallback"]) assert.ok(matrix.requiredAssertions.includes(assertion));

console.log(`UI release contract: ${Object.keys(matrix.routes).length} route groups, ${Object.keys(matrix.viewports).length} viewport classes, rollout fallback verified.`);
