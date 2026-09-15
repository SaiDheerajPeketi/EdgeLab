import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const matrix = JSON.parse(fs.readFileSync(path.join(root, "docs/ui-release-matrix.json"), "utf8"));
const styles = fs.readFileSync(path.join(root, "frontend/src/styles.css"), "utf8");
const routes = fs.readFileSync(path.join(root, "frontend/src/routes/AppRoutes.tsx"), "utf8");
const foundation = fs.readFileSync(path.join(root, "frontend/src/lib/uiFoundation.ts"), "utf8");
const rollout = fs.readFileSync(path.join(root, "frontend/src/lib/uiRollout.ts"), "utf8");

assert.deepEqual(Object.keys(matrix.viewports), ["mobile", "tablet", "desktop", "tradingDesktop"]);
for (const route of ["landing", "settings", "journal", "chart"]) {
  assert.ok(matrix.routes[route]);
  assert.ok(matrix.routes[route].viewports.length >= 3);
  assert.ok(matrix.routes[route].states.length >= 4);
}
assert.equal(matrix.viewports.mobile.zoom, 2);
assert.equal(matrix.viewports.mobile.pointer, "coarse");
assert.ok(matrix.locales.includes("ar-SA"));
assert.ok(matrix.requiredAssertions.includes("color-redundancy"));
assert.match(styles, /prefers-reduced-motion:\s*reduce/);
assert.match(styles, /pointer:\s*coarse/);
assert.match(styles, /min-height:\s*var\(--density-touch\)/);
assert.match(styles, /\[dir="rtl"\]/);
assert.match(styles, /ui-route-enter/);
assert.match(routes, /RouteTransitionBoundary/);
assert.match(foundation, /bodyTextContrast:\s*4\.5/);
assert.match(foundation, /maximumZoomPercent:\s*200/);
assert.match(foundation, /financialState/);
for (const flag of ["ui.shell.v2", "ui.journal.v2", "ui.settings.v2", "ui.chart.v2", "ui.public.v2"]) assert.ok(rollout.includes(flag));
assert.match(rollout, /killSwitch \? false/);

console.log(`UI release contract: ${Object.keys(matrix.routes).length} route groups, ${Object.keys(matrix.viewports).length} viewport classes, rollout fallback verified.`);
