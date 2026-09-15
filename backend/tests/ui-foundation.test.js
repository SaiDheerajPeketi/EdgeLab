import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { buildSync } from "../../node_modules/esbuild/lib/main.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

async function bundle(relativePath, external = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "edgelab-ui-foundation-"));
  const output = path.join(directory, "module.mjs");
  buildSync({ bundle: true, entryPoints: [path.join(ROOT, relativePath)], external, format: "esm", outfile: output, platform: "node" });
  return { cleanup: () => fs.rmSync(directory, { force: true, recursive: true }), module: await import(`${pathToFileURL(output).href}?${Date.now()}`) };
}

test("the UI foundation exposes complete states, save contracts, search ranking, and budgets", async () => {
  const { cleanup, module } = await bundle("frontend/src/lib/uiFoundation.ts");
  try {
    assert.deepEqual(Object.keys(module.UI_STATE_DESCRIPTORS), ["empty", "loading", "partial", "offline", "stale", "permission-denied", "unsupported", "error", "retrying", "success"]);
    assert.ok(Object.values(module.UI_STATE_DESCRIPTORS).every((state) => state.title && state.detail));
    assert.equal(module.saveStrategyFor("toggle"), "immediate");
    assert.equal(module.saveStrategyFor("text"), "debounced");
    assert.equal(module.saveStrategyFor("credential"), "explicit");
    assert.equal(module.saveStrategyFor("workspace"), "revisioned");
    assert.match(module.saveStatusMessage("conflict"), /newer version/i);
    assert.equal(module.commandSearchScore({ label: "Primary account", detail: "Futures", keywords: "broker" }, "primary account"), 6);
    assert.equal(module.commandSearchScore({ label: "Primary account", detail: "Futures", keywords: "broker" }, "missing"), 0);
    assert.ok(module.UI_PERFORMANCE_BUDGETS.inpMs <= 200);
  } finally { cleanup(); }
});

test("a 4 by 4 workspace deduplicates identical stream subscriptions without dropping panes", async () => {
  const { cleanup, module } = await bundle("frontend/src/lib/paneSubscriptions.ts");
  try {
    const panes = Array.from({ length: 16 }, (_, index) => ({ id: `pane-${index + 1}`, symbol: index < 8 ? "MES" : "NQ", timeframe: "1m" }));
    const plan = module.planPaneSubscriptions(panes);
    assert.equal(plan.length, 2);
    assert.equal(plan.flatMap((group) => group.paneIds).length, 16);
    assert.deepEqual(plan.map((group) => group.paneIds.length), [8, 8]);
    assert.equal(new Set(plan.flatMap((group) => group.paneIds)).size, 16);
    assert.equal(module.planPaneSubscriptions([...panes, { id: "pane-17", symbol: "ES", timeframe: "5m" }]).flatMap((group) => group.paneIds).length, 16);
  } finally { cleanup(); }
});

test("route inventory and release contract enumerate responsive, state, accessibility, performance, and fallback evidence", () => {
  const inventory = fs.readFileSync(path.join(ROOT, "docs/ui-surface-inventory.md"), "utf8");
  const quality = fs.readFileSync(path.join(ROOT, "docs/ui-quality-contract.md"), "utf8");
  for (const route of ["`/`", "`/pricing`", "`/auth/signin`", "`/shared`", "`/app/live`", "`/app/replay`", "`/app/journal/*`", "`/app/settings/*`"]) assert.ok(inventory.includes(route), `inventory is missing ${route}`);
  for (const requirement of ["200% zoom", "WCAG 2.2 AA", "Color is redundant", "16-pane workspace", "server-controlled fallback", "Route definition of done"]) assert.match(quality, new RegExp(requirement, "i"));
});
