import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { buildSync } from "../../node_modules/esbuild/lib/main.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

async function loadNavigationHarness() {
  const local = new Map();
  const session = new Map();
  const listeners = new Map();
  globalThis.window = {
    localStorage: { getItem: (key) => local.get(key) ?? null, setItem: (key, value) => local.set(key, value), removeItem: (key) => local.delete(key) },
    sessionStorage: { getItem: (key) => session.get(key) ?? null, setItem: (key, value) => session.set(key, value) },
    addEventListener: (name, listener) => listeners.set(name, listener),
    dispatchEvent: (event) => { listeners.get(event.type)?.(event); return true; },
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "edgelab-navigation-"));
  const output = path.join(directory, "module.mjs");
  buildSync({ bundle: true, entryPoints: [path.join(root, "frontend/src/lib/navigationState.ts")], format: "esm", outfile: output, platform: "node" });
  return { cleanup: () => { fs.rmSync(directory, { force: true, recursive: true }); delete globalThis.window; }, local, module: await import(`${pathToFileURL(output).href}?${Date.now()}`), session };
}

function auth(id) {
  return JSON.stringify({ createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), token: `token-${id}`, user: { approved: true, betaPosition: null, email: `user${id}@example.test`, id, isBetaUser: true, name: `User ${id}`, plan: "beta", provider: "email" } });
}

test("navigation state reloads per authenticated identity and clears on logout", async () => {
  const harness = await loadNavigationHarness();
  try {
    harness.local.set("edgelab.auth.session.v1", auth(1));
    harness.module.reloadNavigationStateForAuth();
    harness.module.rememberNavigationState("journal:trades", { scrollLeft: 0, scrollTop: 72, selectedId: 11 });
    assert.ok(harness.session.has("edgelab.navigation-surfaces.v3.user-1"));

    harness.local.set("edgelab.auth.session.v1", auth(2));
    harness.module.reloadNavigationStateForAuth();
    assert.equal(harness.module.navigationStateFor("journal:trades"), null);
    harness.module.rememberNavigationState("journal:trades", { scrollLeft: 0, scrollTop: 8, selectedId: 22 });

    harness.local.delete("edgelab.auth.session.v1");
    harness.module.reloadNavigationStateForAuth();
    assert.equal(harness.module.navigationStateFor("journal:trades"), null);
    assert.equal(JSON.parse(harness.session.get("edgelab.navigation-surfaces.v3.user-1"))["journal:trades"].selectedId, 11);
    assert.equal(JSON.parse(harness.session.get("edgelab.navigation-surfaces.v3.user-2"))["journal:trades"].selectedId, 22);
  } finally { harness.cleanup(); }
});
