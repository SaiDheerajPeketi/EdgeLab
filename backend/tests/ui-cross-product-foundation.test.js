import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("navigation context is durable and deep-linkable without leaking drafts", () => {
  const source = read("frontend/src/lib/navigationState.ts");
  assert.match(source, /sessionStorage\.setItem/);
  assert.match(source, /navigationDeepLink/);
  assert.match(source, /parseNavigationDeepLink/);
  assert.doesNotMatch(source.match(/function navigationDeepLink[\s\S]*?^}/m)?.[0] ?? "", /draft|filters/);
});

test("product docks share the resizable persistent panel contract", () => {
  const manager = read("frontend/src/components/ui/WorkspacePanelManager.tsx");
  const journal = read("frontend/src/components/journal/JournalPanelManager.tsx");
  for (const contract of ["role=\"separator\"", "aria-valuemin", "aria-valuemax", "pointermove", "onChange", "collapsed", "dock", "activePanel"]) assert.ok(manager.includes(contract), `missing panel contract ${contract}`);
  assert.match(journal, /WorkspacePanelManager/);
  for (const panel of ["journal", "watchlist", "quant", "data-window", "objects", "code", "order-book", "alerts"]) assert.ok(journal.includes(panel));
});

test("high-traffic product dialogs and drawers use the shared accessible modal surface", () => {
  for (const file of [
    "frontend/src/components/JournalEntryModal.tsx",
    "frontend/src/components/TradeDetailDrawer.tsx",
    "frontend/src/components/WorkspaceShareDialog.tsx",
    "frontend/src/components/IndicatorEditorPanel.tsx",
    "frontend/src/components/journal/JournalReviewDrawer.tsx",
  ]) {
    const source = read(file);
    assert.match(source, /from ["'](?:\.\.\/|\.\/)?.*ui\/Primitives["']/);
    assert.doesNotMatch(source, /createPortal|fixed inset-0/);
  }
  const primitives = read("frontend/src/components/ui/Primitives.tsx");
  for (const contract of ["aria-modal=\"true\"", "trapFocus", "document.body.style.overflow", "preventScroll", "dismissBlocked", "data-modal-surface"]) assert.ok(primitives.includes(contract), `missing modal contract ${contract}`);
});

test("shared icon actions enforce names, help, optical size, and stroke weight", () => {
  const primitives = read("frontend/src/components/ui/Primitives.tsx");
  const styles = read("frontend/src/styles.css");
  assert.match(primitives, /label: string/);
  assert.match(primitives, /tooltip \?\? label/);
  assert.match(primitives, /data-icon-button/);
  assert.match(styles, /--icon-md: 16px/);
  assert.match(styles, /stroke-width: 1\.75/);
});
