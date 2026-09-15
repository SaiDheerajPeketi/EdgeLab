import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(repoRoot, file), "utf8");

test("shared controls expose searchable selection and centralized overlays", () => {
  const primitives = read("frontend/src/components/ui/Primitives.tsx");
  for (const contract of [
    "export function Combobox",
    'role="combobox"',
    'aria-autocomplete="list"',
    'role="listbox"',
    'role="option"',
    "aria-activedescendant",
    "OverlaySurface",
  ]) assert.match(primitives, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(primitives, /event\.key === "ArrowDown"/);
  assert.match(primitives, /event\.key === "Escape"/);
  assert.match(primitives, /ui-dialog-surface/);
  assert.match(primitives, /ui-drawer-surface/);
});

test("command palette integrates real Journal entities and exact deep links", () => {
  const app = read("frontend/src/App.tsx");
  const palette = read("frontend/src/components/GlobalCommandPalette.tsx");
  for (const contract of [
    "listJournalAccounts()",
    "listCanonicalTrades({ limit: 200 })",
    "listJournalDailyNotes()",
    'kind: "account" as const',
    'kind: "trade" as const',
    'kind: "note" as const',
    "journalDeepLink",
    'navigateWorkspace("journalAccounts")',
    'navigateWorkspace("journalTrades")',
    'navigateWorkspace("journalNotes")',
  ]) assert.ok(app.includes(contract), `missing ${contract}`);
  assert.match(palette, /symbols\.slice\(0, 200\)/);
  assert.match(palette, /Keyboard shortcut reference/);
  assert.match(palette, /aria-activedescendant/);
  assert.match(palette, /useLayoutEffect/);
  assert.match(palette, /document\.addEventListener\("keydown", keydown, true\)/);
  assert.match(palette, /event\.code === "KeyK"/);
});

test("density, navigation memory, and spatial motion are global contracts", () => {
  const preferences = read("frontend/src/lib/settingsPreferences.ts");
  const navigation = read("frontend/src/lib/navigationState.ts");
  const styles = read("frontend/src/styles.css");
  assert.match(preferences, /document\.documentElement\.dataset\.density/);
  assert.match(preferences, /edgelab:settings-preferences/);
  assert.match(navigation, /rememberNavigationState/);
  assert.match(navigation, /restoreWindowScroll/);
  assert.match(styles, /ui-overlay-below/);
  assert.match(styles, /ui-dialog-enter/);
  assert.match(styles, /ui-drawer-enter/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});
