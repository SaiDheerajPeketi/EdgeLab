import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("reports use comparison hierarchy, shared tables, and persistent states", () => {
  const source = read("frontend/src/components/ReportsPanel.tsx");
  assert.match(source, /data-ui-surface="reports"/);
  assert.match(source, /Strategy comparison/);
  assert.match(source, /<Table label="Strategy performance"/);
  assert.match(source, /<CriticalStateSurface state="empty"/);
});

test("journal uses one dense surface with filters, bulk actions, and explicit feedback", () => {
  const workspace = read("frontend/src/components/journal/RelationalJournalWorkspace.tsx");
  const trades = read("frontend/src/components/journal/JournalTradesSurface.tsx");
  assert.match(workspace, /data-ui-surface="journal"/);
  assert.match(trades, /Select all visible trades/);
  assert.match(trades, /Promise\.all\(selectedIds\.map\(onMarkReviewed\)\)/);
  assert.match(trades, /<Table label="Journal trades"/);
});

test("chart and live tools share spatial panel and state contracts", () => {
  const frame = read("frontend/src/components/chart/ChartWorkspaceFrame.tsx");
  const panels = read("frontend/src/components/ui/WorkspacePanelManager.tsx");
  const market = read("frontend/src/components/chart/MarketToolsPanels.tsx");
  assert.match(frame, /data-ui-surface="chart-live"/);
  assert.match(panels, /data-motion="workspace-panel"/);
  assert.match(panels, /data-dock=\{preferences\.dock\}/);
  assert.match(market, /Depth is stale/);
  assert.match(market, /Provider becomes stale/);
});

test("overlays and feedback are reversible and reduced-motion safe", () => {
  const primitives = read("frontend/src/components/ui/Primitives.tsx");
  const focusReturn = read("frontend/src/components/overlays/useFocusReturn.ts");
  const dismiss = read("frontend/src/components/overlays/useOverlayDismiss.ts");
  const styles = read("frontend/src/styles.css");
  assert.match(focusReturn, /\.focus\(/);
  assert.match(dismiss, /if \(event\.key === "Escape"\)/);
  assert.match(styles, /@keyframes ui-panel-from-right/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /\.ui-action-feedback\[data-state="saved"\]/);
});
