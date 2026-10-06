import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tscBin = path.join(repoRoot, "frontend/node_modules/typescript/bin/tsc");

function loadSettingsModules() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "edgelab-settings-center-"));
  const sourceDir = path.join(tempDir, "src");
  const outDir = path.join(tempDir, "out");
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, "frontend/src/components/settings/settingsCatalog.ts"),
    path.join(sourceDir, "settingsCatalog.ts"),
  );
  fs.copyFileSync(
    path.join(repoRoot, "frontend/src/lib/settingsPreferences.ts"),
    path.join(sourceDir, "settingsPreferences.ts"),
  );
  fs.writeFileSync(path.join(sourceDir, "authSession.ts"), "export function getStoredAuthSession() { return null; }\n");
  fs.copyFileSync(path.join(repoRoot, "frontend/src/lib/appDataBarrier.ts"), path.join(sourceDir, "appDataBarrier.ts"));
  fs.writeFileSync(path.join(sourceDir, "serverStorage.ts"), [
    "export async function loadAppStorageItem<T>(_key: string, fallback: T): Promise<T> { return fallback; }",
    "export async function saveAppStorageItemConfirmed<T>(_key: string, value: T) { return { localPersisted: true, serverPersisted: true, value }; }",
  ].join("\n"));
  const compile = spawnSync(process.execPath, [
    tscBin,
    "--module", "commonjs",
    "--target", "es2022",
    "--skipLibCheck",
    "--outDir", outDir,
    path.join(sourceDir, "settingsCatalog.ts"),
    path.join(sourceDir, "settingsPreferences.ts"),
    path.join(sourceDir, "authSession.ts"),
    path.join(sourceDir, "serverStorage.ts"),
  ], { cwd: repoRoot, encoding: "utf8" });
  if (compile.status !== 0) {
    fs.rmSync(tempDir, { force: true, recursive: true });
    throw new Error(compile.stderr || compile.stdout || "settings module compile failed");
  }
  const require = createRequire(import.meta.url);
  return {
    catalog: require(path.join(outDir, "settingsCatalog.js")),
    preferences: require(path.join(outDir, "settingsPreferences.js")),
    cleanup: () => fs.rmSync(tempDir, { force: true, recursive: true }),
  };
}

test("settings catalog contains every operate-mode category without decorative counters", () => {
  const { catalog, cleanup } = loadSettingsModules();
  try {
    assert.deepEqual(catalog.SETTINGS_CATEGORY_IDS, [
      "global", "journal", "backtest", "chart", "appearance",
      "data-providers", "account", "ai", "privacy-security", "storage",
    ]);
    assert.ok(catalog.SETTINGS_CONTROLS.every((control) => control.label && control.description));
    assert.ok(catalog.SETTINGS_CATEGORY_IDS.every((id) => catalog.SETTINGS_CONTROLS.some((control) => control.category === id)));
  } finally {
    cleanup();
  }
});

test("settings search ranks labels and supported synonyms with category filters", () => {
  const { catalog, cleanup } = loadSettingsModules();
  try {
    assert.equal(catalog.searchSettings("broker")[0].id, "broker-connections");
    assert.equal(catalog.searchSettings("logout")[0].id, "current-session");
    assert.equal(catalog.searchSettings("backup", "storage")[0].category, "storage");
    assert.deepEqual(catalog.searchSettings("broker", "appearance"), []);
  } finally {
    cleanup();
  }
});

test("settings deep links resolve exact controls and reject malformed or mismatched targets", () => {
  const { catalog, cleanup } = loadSettingsModules();
  try {
    const hash = catalog.settingsDeepLink("backtest", "default-risk");
    assert.equal(hash, "#settings/backtest/default-risk");
    assert.deepEqual(catalog.parseSettingsDeepLink(hash), { category: "backtest", controlId: "default-risk" });
    assert.equal(catalog.parseSettingsDeepLink("#settings/chart/default-risk"), null);
    assert.equal(catalog.parseSettingsDeepLink("#settings/unknown"), null);
    assert.equal(catalog.parseSettingsDeepLink("#settings/chart/%E0%A4%A"), null);
  } finally {
    cleanup();
  }
});

test("settings preferences sanitize unsupported persisted values", () => {
  const { preferences, cleanup } = loadSettingsModules();
  try {
    assert.deepEqual(preferences.sanitizeSettingsPreferences({ density: "microscopic", includeDiagnosticsByDefault: "yes" }), {
      density: "comfortable",
      includeDiagnosticsByDefault: true,
    });
    assert.deepEqual(preferences.sanitizeSettingsPreferences({ density: "compact", includeDiagnosticsByDefault: false }), {
      density: "compact",
      includeDiagnosticsByDefault: false,
    });
  } finally {
    cleanup();
  }
});

test("settings category paths select every exact category and preserve contextual fallbacks", () => {
  const { catalog, cleanup } = loadSettingsModules();
  try {
    assert.equal(catalog.settingsCategoryForPath("/app/settings"), "global");
    assert.equal(catalog.settingsCategoryForPath("/app/settings/"), "global");
    for (const category of catalog.SETTINGS_CATEGORY_IDS) {
      assert.equal(catalog.settingsCategoryForPath(`/app/settings/${category}`), category);
      assert.equal(catalog.settingsCategoryForPath(`/app/settings/${category}/`), category);
    }
    for (const path of ["/app/journal/settings", "/app/replay", "/app/settings/unknown", "/app/settings/appearance/extra", "/app/settings//", "/app/settings/appearances"]) {
      assert.equal(catalog.settingsCategoryForPath(path), null, path);
    }
  } finally {
    cleanup();
  }
});

test("workspace settings routes use the consolidated center and feedback consumes its privacy default", () => {
  const workspace = fs.readFileSync(path.join(repoRoot, "frontend/src/components/EdgeLabWorkspace.tsx"), "utf8");
  assert.match(workspace, /case "globalSettings":[\s\S]*settingsCenter\("global"\)/);
  assert.match(workspace, /case "journalSettings":[\s\S]*settingsCenter\("journal"\)/);
  assert.match(workspace, /case "settings":[\s\S]*settingsCenter\("backtest"/);
  assert.match(workspace, /loadSettingsPreferences\(\)\.includeDiagnosticsByDefault/);
});
