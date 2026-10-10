import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
function loadTheme() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "edgelab-theme200-"));
  const src = path.join(temp, "src"), out = path.join(temp, "out");
  fs.mkdirSync(src);
  for (const name of ["settingsPreferences", "workspaceTheme"]) fs.copyFileSync(path.join(repo, "frontend/src/lib", name + ".ts"), path.join(src, name + ".ts"));
  fs.writeFileSync(path.join(src, "authSession.ts"), `let current: any = null;
const listeners = new Set<() => void>();
export const getStoredAuthSession = () => current;
export const hasWorkspaceAccess = (session: any) => session?.user.workspaceAccess === true;
export function subscribeAuthSession(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function setSession(value: any) { current = value; listeners.forEach(listener => listener()); }
`);
  fs.writeFileSync(path.join(src, "appDataBarrier.ts"), `import { getStoredAuthSession } from "./authSession";
export type AppDataAccess = { owner: string; token: string };
export function captureAppDataAccess() { const session = getStoredAuthSession(); return session ? { owner: "user-" + session.user.id, token: session.token } : null; }
export function assertAppDataAccess(access: AppDataAccess | null, _write = false) { const current = captureAppDataAccess(); if (!access || current?.owner !== access.owner || current?.token !== access.token) throw new Error("Owner changed"); }
export function appDataSessionKey(key: string, _owner: string) { return key; }
`);
  fs.writeFileSync(path.join(src, "serverStorage.ts"), `export const reads: Array<{ resolve: (value: any) => void }> = [];
export function loadAppStorageItem<T>(_key: string, _fallback: T): Promise<T> { return new Promise(resolve => reads.push({ resolve })); }
export async function saveAppStorageItemConfirmed<T>(_key: string, value: T) { return { localPersisted: true, serverPersisted: true, value }; }
`);
  const compiled = spawnSync(process.execPath, [path.join(repo, "frontend/node_modules/typescript/bin/tsc"), "--module", "commonjs", "--target", "es2022", "--skipLibCheck", "--outDir", out, path.join(src, "workspaceTheme.ts")], { encoding: "utf8" });
  if (compiled.status !== 0) { fs.rmSync(temp, { recursive: true, force: true }); throw new Error(compiled.stdout || compiled.stderr); }
  const require = createRequire(import.meta.url);
  return { preferences: require(path.join(out, "settingsPreferences.js")), theme: require(path.join(out, "workspaceTheme.js")), auth: require(path.join(out, "authSession.js")), storage: require(path.join(out, "serverStorage.js")), cleanup: () => fs.rmSync(temp, { recursive: true, force: true }) };
}
function browser() {
  const saved = { window: global.window, document: global.document, CustomEvent: global.CustomEvent };
  const values = new Map(), listeners = new Map(), mediaListeners = new Set();
  const dataset = {};
  const media = { matches: true, addEventListener: (_kind, listener) => mediaListeners.add(listener), removeEventListener: (_kind, listener) => mediaListeners.delete(listener) };
  global.document = { documentElement: { dataset } };
  global.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options?.detail; } };
  global.window = { localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }, matchMedia: () => media,
    addEventListener: (kind, listener) => { const set = listeners.get(kind) ?? new Set(); set.add(listener); listeners.set(kind, set); },
    removeEventListener: (kind, listener) => listeners.get(kind)?.delete(listener),
    dispatchEvent: event => { listeners.get(event.type)?.forEach(listener => listener(event)); } };
  return { dataset, values, mediaListeners, system(dark) { media.matches = dark; mediaListeners.forEach(listener => listener({ matches: dark })); },
    restore() { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete global[key]; else global[key] = value; } };
}
const session = id => ({ user: { id, workspaceAccess: true }, token: "owner-" + id });
const prefs = appTheme => ({ appTheme, density: "comfortable", includeDiagnosticsByDefault: true });
const settle = () => new Promise(resolve => setImmediate(resolve));

test("three theme preferences sanitize old profiles and resolve system independently", () => {
  const modules = loadTheme();
  try {
    assert.equal(modules.preferences.sanitizeSettingsPreferences({ density: "compact" }).appTheme, "dark");
    for (const appTheme of ["dark", "light", "system"]) assert.equal(modules.preferences.sanitizeSettingsPreferences({ appTheme }).appTheme, appTheme);
    for (const appTheme of ["auto", null, 1, true]) assert.equal(modules.preferences.sanitizeSettingsPreferences({ appTheme }).appTheme, "dark");
    assert.equal(modules.preferences.resolveAppTheme("system", true), "dark");
    assert.equal(modules.preferences.resolveAppTheme("system", false), "light");
    assert.equal(modules.preferences.resolveAppTheme("dark", false), "dark");
    assert.equal(modules.preferences.resolveAppTheme("light", true), "light");
  } finally { modules.cleanup(); }
});

test("workspace theme uses owner mirrors, rejects stale hydration, follows OS/storage and cleans up public routes", async () => {
  const modules = loadTheme(), environment = browser();
  let stop;
  try {
    modules.auth.setSession(session(1));
    modules.preferences.cacheSettingsPreferences(prefs("light"));
    stop = modules.theme.startWorkspaceTheme();
    assert.equal(environment.dataset.appTheme, "light");
    assert.equal(environment.dataset.workspaceTheme, "active");
    modules.auth.setSession(session(2));
    assert.equal(environment.dataset.appTheme, "dark", "another account must not inherit the first owner's theme");
    modules.storage.reads[0].resolve(prefs("light"));
    await settle();
    assert.equal(environment.dataset.appTheme, "dark", "old account's remote response cannot replace new account presentation");
    modules.storage.reads[1].resolve(prefs("system"));
    await settle();
    assert.equal(environment.dataset.appThemePreference, "system");
    environment.system(false);
    assert.equal(environment.dataset.appTheme, "light");
    environment.system(true);
    assert.equal(environment.dataset.appTheme, "dark");
    const ownerTwoKey = modules.preferences.settingsPreferencesStorageKey();
    environment.values.set(ownerTwoKey, JSON.stringify(prefs("light")));
    window.dispatchEvent({ type: "storage", key: "edgelab.settings-center.v1.user-1" });
    assert.equal(environment.dataset.appTheme, "dark");
    window.dispatchEvent({ type: "storage", key: ownerTwoKey });
    assert.equal(environment.dataset.appTheme, "light");
    environment.system(true);
    assert.equal(environment.dataset.appTheme, "light", "an explicit light preference ignores OS appearance");
    modules.auth.setSession(null);
    assert.equal(environment.dataset.appTheme, undefined, "sign-out restores default presentation immediately");
    stop(); stop = null;
    assert.equal(environment.dataset.workspaceTheme, undefined);
    assert.equal(environment.dataset.appThemePreference, undefined);
    assert.equal(environment.mediaListeners.size, 0);
    modules.preferences.applySettingsPreferences(prefs("light"));
    assert.equal(environment.dataset.appTheme, undefined, "public pages cannot activate workspace appearance");
  } finally { stop?.(); environment.restore(); modules.cleanup(); }
});
