import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Journal route family is explicit and rendered through one relational system", () => {
  const workspace = read("frontend/src/components/EdgeLabWorkspace.tsx");
  const journal = read("frontend/src/components/journal/RelationalJournalWorkspace.tsx");
  for (const route of ["journalAccounts", "journalDashboard", "journalDayView", "journalNotes", "journalPlaybooks", "journalReports", "journalSessions", "journalStrategies", "journalTrades"]) {
    assert.match(workspace, new RegExp(`case \\\"${route}\\\"`));
    assert.match(journal, new RegExp(`${route}: \\{ label:`));
  }
  assert.match(workspace, /case "journalSettings":[\s\S]*settingsCenter\("journal"\)/);
  assert.match(journal, /data-journal-route=\{view\}/);
  assert.match(journal, /JournalPanelManager/);
});

test("major chart and market states use shared persistent state and panel contracts", () => {
  const chart = read("frontend/src/components/chart/ChartWorkspaceFrame.tsx");
  const market = read("frontend/src/components/chart/MarketToolsPanels.tsx");
  const panel = read("frontend/src/components/ui/WorkspacePanelManager.tsx");
  assert.match(chart, /CriticalStateSurface state="loading"/);
  assert.match(chart, /CriticalStateSurface state="empty"/);
  assert.match(market, /CriticalStateSurface state=\{/);
  assert.match(panel, /role="separator"/);
  assert.match(panel, /data-motion="workspace-panel"/);
});

test("dense data, overlays, and microfeedback use shared production contracts", () => {
  const primitives = read("frontend/src/components/ui/Primitives.tsx");
  const journalControls = read("frontend/src/components/journal/JournalControls.tsx");
  const styles = read("frontend/src/styles.css");
  assert.ok(primitives.includes("[&_th]:sticky"));
  assert.ok(primitives.includes("[&_.numeric]:text-end"));
  assert.match(primitives, /trapFocus/);
  assert.match(primitives, /previous\?\.isConnected\) previous\.focus/);
  assert.match(journalControls, /data-motion="microfeedback"/);
  assert.match(styles, /\[data-motion="microfeedback"\]:active/);
  assert.match(styles, /\[data-motion="route-surface"\]/);
});

test("surface inventory covers the full refreshed Journal family", () => {
  const inventory = JSON.parse(read("docs/ui-surface-inventory.json"));
  const paths = new Set(inventory.routes.map((route) => route.path));
  for (const route of ["/app/journal/dashboard", "/app/journal/accounts", "/app/journal/trades", "/app/journal/analytics", "/app/journal/notes", "/app/journal/calendar", "/app/journal/reports", "/app/journal/settings"]) assert.ok(paths.has(route), route);
  assert.deepEqual(inventory.requiredStateFamilies, ["empty", "loading", "skeleton", "partial", "offline", "stale", "permission-denied", "unsupported", "error", "retrying", "success"]);
});
