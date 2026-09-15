import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { buildSync } from "../../node_modules/esbuild/lib/main.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

async function bundle(relativePath, external = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "edgelab-shell-primitives-"));
  const output = path.join(directory, "module.mjs");
  buildSync({ bundle: true, entryPoints: [path.join(ROOT, relativePath)], external, format: "esm", outfile: output, platform: "node" });
  return { cleanup: () => fs.rmSync(directory, { force: true, recursive: true }), module: await import(`${pathToFileURL(output).href}?${Date.now()}`) };
}

test("workspace navigation resolves every destination to stable context copy", async () => {
  const { cleanup, module } = await bundle("frontend/src/lib/workspaceNavigation.ts");
  try {
    for (const view of ["live", "sessions", "reports", "journalTrades", "globalSettings", "feedback"]) {
      const context = module.workspaceNavigationItem(view);
      assert.ok(context.label);
      assert.ok(context.description);
      assert.ok(context.section);
    }
  } finally { cleanup(); }
});

test("shared primitives cover the complete operating component vocabulary", () => {
  const source = fs.readFileSync(path.join(ROOT, "frontend/src/components/ui/Primitives.tsx"), "utf8");
  for (const primitive of ["Button", "IconButton", "Field", "SelectField", "Toggle", "Checkbox", "RadioGroup", "Slider", "SegmentedControl", "Tabs", "Card", "Table", "Badge", "Tooltip", "Menu", "Popover", "Dialog", "Drawer", "Banner", "ToastProvider"]) {
    assert.match(source, new RegExp(`export (?:const|function) ${primitive}\\b`), `missing ${primitive}`);
  }
  for (const behavior of ["aria-invalid", "aria-busy", "aria-modal", "focus-visible", "role=\"switch\"", "role=\"tablist\"", "role=\"menu\""]) assert.ok(source.includes(behavior), `missing ${behavior}`);
});

test("settings expose cross-tab conflict recovery and the selected density", () => {
  const center = fs.readFileSync(path.join(ROOT, "frontend/src/components/settings/SettingsCenter.tsx"), "utf8");
  const preferences = fs.readFileSync(path.join(ROOT, "frontend/src/lib/settingsPreferences.ts"), "utf8");
  assert.match(center, /addEventListener\("storage"/);
  assert.match(center, /Use newer version/);
  assert.match(center, /Keep this version/);
  assert.match(center, /dataset\.density/);
  assert.match(preferences, /settingsPreferencesStorageKey/);
});

test("command palette receives real trade, note, workspace, and safe-action entities", () => {
  const app = fs.readFileSync(path.join(ROOT, "frontend/src/App.tsx"), "utf8");
  for (const kind of ["trade", "note", "workspace", "safe-action"]) assert.match(app, new RegExp(`kind: \"${kind}\"`));
  assert.match(app, /commandEntities=\{commandEntities\}/);
  assert.match(app, /<WorkspaceContextHeader/);
});
