import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { betaSessionResponse, gotoStable, installDeterminism, seedApprovedSession } from "./support/app";
import type { BetaAuthSession } from "../frontend/src/lib/api";

const nativeTest = test.extend({ video: "off", screenshot: "off", trace: "off" });
const settingsPath = "/app/settings/storage";
const operationId = "11111111-1111-4111-8111-111111111111";
const markerKey = `edgelab.app-data-uncertain.v1.user-7001.${operationId}`;
const epochKey = "edgelab.app-data-generation.v1.user-7001";
const operation = { version: 2, id: operationId, method: "PUT", path: "/settings/preferences" };
const artifactDir = path.resolve(".artifacts/storage-parity24");
const tableNames = ["dataset_settings", "dataset_assets", "dataset_timeframes", "app_storage", "playbooks", "backtest_sessions", "positions", "orders", "trades", "executions", "trade_notes", "journal_accounts", "journal_import_runs", "canonical_trades", "canonical_executions", "journal_tags", "canonical_trade_tags", "canonical_trade_notes", "canonical_trade_screenshots", "journal_daily_notes", "journal_import_rows", "journal_import_diagnostics", "journal_backfill_checkpoints"];
const sourceBundle = { app: "edgelab", version: 1, tables: { app_storage: [{ id: 7, value: { theme: "restored" } }] } };
const emptyExport = { app: "edgelab", version: 1, exported_at: "2026-09-15T10:00:00Z", tables: Object.fromEntries(tableNames.map((name) => [name, []])) };
type Receipt = { operation_id: string; method: string | null; path: string | null; status: "reserved" | "running" | "completed" | "canceled"; http_status: number | null; result: unknown; created_at: string; completed_at: string | null };
const receipt = (id = operationId): Receipt => ({ operation_id: id, method: operation.method, path: operation.path, status: "completed", http_status: 200, result: null, created_at: "2026-09-15T10:00:00Z", completed_at: "2026-09-15T10:00:01Z" });
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }

async function fixture(page: Page, fallback = true) {
  await installDeterminism(page, { rollout: fallback ? "fallback" : "enabled" });
  await seedApprovedSession(page);
  const receipts = new Map<string, Receipt>();
  const state = { fallback, target: receipt(), failQuery: false, queryGate: null as Promise<void> | null, exportGate: null as Promise<void> | null, importGate: null as Promise<void> | null, exportFailure: false, importFailure: false, recoveries: [] as string[], imports: [] as Array<{ token: string | undefined; body: typeof sourceBundle }>, exports: [] as string[], session: structuredClone(betaSessionResponse) as BetaAuthSession };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (endpoint === "/ui/rollout") { await route.fulfill({ json: { revision: state.fallback ? "storage-fallback" : "storage-modern", kill_switch: state.fallback, flags: { shell: true, journal: true, settings: true, chart: true, public: true } } }); return; }
    if (endpoint === "/auth/session") { await route.fulfill({ json: state.session }); return; }
    const metadata = endpoint.match(/^\/app-data\/operations\/([0-9a-f-]+)\/(reserve|recover)$/);
    if (metadata) {
      const [, id, action] = metadata;
      expect(request.method()).toBe("POST");
      expect(request.headers()["x-edgelab-operation-id"]).toBeUndefined();
      if (action === "reserve") {
        expect(request.headers().authorization).toBe(`Bearer ${state.session.token}`);
        receipts.set(id, { ...receipt(id), ...request.postDataJSON(), status: "reserved", http_status: null, completed_at: null });
      } else if (id === operationId) {
        expect(request.headers().authorization).toBe(`Bearer ${state.session.token}`);
        state.recoveries.push(request.headers().authorization);
        if (state.queryGate) await state.queryGate;
        if (state.failQuery) { await route.fulfill({ status: 503, json: { detail: "Receipt service unavailable" } }); return; }
        await route.fulfill({ json: state.target }); return;
      }
      await route.fulfill({ json: receipts.get(id) }); return;
    }
    if (endpoint === "/app-data/export") {
      state.exports.push(request.headers().authorization);
      if (state.exportGate) await state.exportGate;
      await route.fulfill(state.exportFailure ? { status: 503, json: { detail: "Export unavailable" } } : { json: emptyExport }); return;
    }
    const id = request.headers()["x-edgelab-operation-id"];
    const bound = id ? receipts.get(id) : undefined;
    if (bound) expect(bound).toMatchObject({ status: "reserved", method: request.method(), path: endpoint });
    if (endpoint === "/app-data/import") {
      const body = request.postDataJSON();
      state.imports.push({ token: request.headers().authorization, body });
      expect(bound).toBeDefined();
      bound!.status = "running";
      if (state.importGate) await state.importGate;
      const result = state.importFailure ? null : { ok: true, imported_at: "2026-09-15T10:00:01Z", summary: Object.fromEntries(tableNames.map((name) => [name, body.tables[name]?.length ?? 0])) };
      Object.assign(bound!, { status: "completed", http_status: state.importFailure ? 500 : 200, result, completed_at: "2026-09-15T10:00:01Z" });
      await route.fulfill(state.importFailure ? { status: 500, json: { detail: "Import failed" } } : { json: result }); return;
    }
    if (bound) Object.assign(bound, { status: "completed", http_status: 200, completed_at: "2026-09-15T10:00:01Z" });
    await route.fallback();
  });
  await gotoStable(page, settingsPath);
  await expect(page.locator('[data-route-group="settings"]')).toHaveAttribute("data-ui-version", fallback ? "fallback" : "v2");
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("edgelab.app-data-uncertain.v1.")).length)).toBe(0);
  return state;
}

nativeTest("Storage interface baseline and incumbent captures", async ({ page }, testInfo) => {
  await fixture(page);
  fs.mkdirSync(artifactDir, { recursive: true });
  if (process.env.EDGELAB_CAPTURE_STORAGE_BEFORE === "1") {
    await expect(page.getByLabel("Workspace density")).toBeVisible();
    await page.screenshot({ path: path.join(artifactDir, `before-${testInfo.project.name}-full.png`), animations: "disabled", fullPage: true });
    await page.getByLabel("Workspace density").locator("xpath=ancestor::section[1]").screenshot({ path: path.join(artifactDir, `before-${testInfo.project.name}-target.png`), animations: "disabled" });
    return;
  }
  await expect(page.getByRole("heading", { name: "Portable data", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download export", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Choose JSON bundle", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Check interrupted saves", exact: true })).toBeEnabled();
});

type State = Awaited<ReturnType<typeof fixture>>;
const portable = (page: Page) => page.locator('section[aria-labelledby="settings-portable-data"]');
const draftPrefix = "edgelab.data-transfer-draft.v1.";
async function switchRenderer(page: Page, state: State, fallback: boolean) {
  state.fallback = fallback;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator('[data-route-group="settings"]')).toHaveAttribute("data-ui-version", fallback ? "fallback" : "v2");
}
async function chooseBundle(page: Page, body: unknown = sourceBundle, fileName = "owned-data.json") {
  const button = page.getByRole("button", { name: /^(Choose JSON bundle|Choose a different file)$/ });
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), button.click()]);
  await chooser.setFiles({ name: fileName, mimeType: "application/json", buffer: Buffer.from(typeof body === "string" ? body : JSON.stringify(body)) });
}
async function confirmBundle(page: Page) {
  await expect(portable(page).getByText("owned-data.json", { exact: true })).toBeVisible();
  await page.getByLabel("Type IMPORT to confirm").fill("IMPORT");
  await expect(page.getByRole("button", { name: "Replace data", exact: true })).toBeEnabled();
}
async function seedMarker(page: Page, value = JSON.stringify({ ...operation, phase: "uncertain" })) {
  await page.evaluate(({ key, value }) => {
    localStorage.setItem(key, value);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
  }, { key: markerKey, value });
}
async function capture(page: Page, state: State, label: string, project: string) {
  fs.mkdirSync(artifactDir, { recursive: true });
  await page.getByRole("heading", { name: "Portable data", exact: true }).evaluate((element) => element.scrollIntoView({ block: "start" }));
  const name = `${project}-${state.fallback ? "fallback" : "modern"}-${label}`;
  await page.screenshot({ path: path.join(artifactDir, `${name}.png`), animations: "disabled" });
  await portable(page).screenshot({ path: path.join(artifactDir, `${name}-target.png`), animations: "disabled" });
  await page.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll<HTMLElement>("main, [data-scroll-container]").forEach((element) => { element.scrollTop = 0; }); });
  await page.screenshot({ path: path.join(artifactDir, `${name}-full.png`), animations: "disabled", fullPage: true });
}
async function identityChange(page: Page, state: State, ownerChange: boolean) {
  state.session = { ...state.session, token: ownerChange ? "second-owner-token" : "refreshed-owner-token", user: { ...state.session.user, id: ownerChange ? 7002 : 7001 } };
  await page.evaluate(async (session) => { const modulePath = "/src/lib/authSession.ts"; const auth = await import(modulePath); auth.setStoredAuthSession(auth.toStoredAuthSession(session)); }, state.session);
}

nativeTest("exact Storage controls and deep links remain keyboard reachable in both interfaces", async ({ page }, info) => {
  const state = await fixture(page);
  await expect(page.getByLabel("Workspace density")).toHaveCount(0);
  for (const fallback of [true, false]) {
    await switchRenderer(page, state, fallback);
    await page.waitForLoadState("networkidle");
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("edgelab.app-data-uncertain.v1.")).length)).toBe(0);
    await expect(page.getByRole("button", { name: "Choose JSON bundle", exact: true })).toBeEnabled();
    const check = page.getByRole("button", { name: "Check interrupted saves", exact: true });
    const beforeEpoch = await page.evaluate((key) => localStorage.getItem(key), epochKey);
    await check.focus();
    await page.keyboard.press("Enter");
    await expect(portable(page).getByRole("status")).not.toContainText("Checking interrupted saves");
    expect(await portable(page).getByRole("status").textContent(), JSON.stringify({ fallback, beforeEpoch, afterEpoch: await page.evaluate((key) => localStorage.getItem(key), epochKey) })).toContain("No interrupted saves need recovery.");
    await check.focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Download export", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Choose JSON bundle", exact: true })).toBeFocused();
    await capture(page, state, "idle", info.project.name);
  }
  await page.goto(`${settingsPath}#settings/storage/recover-data`);
  await expect(page.locator('[data-setting-control="recover-data"]')).toBeVisible();
  await expect(page.locator('[data-setting-control="recover-data"]')).toBeFocused();
  await switchRenderer(page, state, true);
  await expect(page.locator('[data-setting-control="recover-data"]')).toBeFocused();
});

nativeTest("invalid files never submit and the validated table preview survives an interface switch", async ({ page }, info) => {
  const state = await fixture(page);
  await chooseBundle(page, "not JSON", "invalid.json");
  await expect(portable(page).getByRole("alert")).toBeVisible();
  expect(state.imports).toEqual([]);
  await capture(page, state, "invalid-file", info.project.name);
  await switchRenderer(page, state, false);
  await expect(portable(page).getByRole("alert")).toBeVisible();
  await chooseBundle(page);
  await expect(portable(page).getByText(/Validated bundle v1/)).toContainText("1 tables · 1 rows");
  await expect(portable(page).getByText("app_storage", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Replace data", exact: true })).toBeDisabled();
  await confirmBundle(page);
  await switchRenderer(page, state, true);
  await expect(page.getByLabel("Type IMPORT to confirm")).toHaveValue("IMPORT");
  await expect(page.getByRole("button", { name: "Replace data", exact: true })).toBeEnabled();
  expect(state.imports).toEqual([]);
  await capture(page, state, "staged", info.project.name);
});

nativeTest("both interfaces download complete exports and show retryable export errors", async ({ page }, info) => {
  const state = await fixture(page);
  for (const fallback of [true, false]) {
    await switchRenderer(page, state, fallback);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download export", exact: true }).click()]);
    expect(download.suggestedFilename()).toBe("edgelab-export-2026-09-15.json");
    expect(JSON.parse(fs.readFileSync((await download.path())!, "utf8"))).toEqual(emptyExport);
  }
  state.exportFailure = true;
  await page.getByRole("button", { name: "Download export", exact: true }).click();
  await expect(portable(page).getByRole("alert")).toContainText("Export unavailable");
  await switchRenderer(page, state, true);
  await expect(portable(page).getByRole("alert")).toContainText("Export unavailable");
  await expect(page.getByRole("button", { name: "Download export", exact: true })).toBeEnabled();
  expect(state.exports).toEqual(Array(3).fill("Bearer ui-regression-token"));
  await capture(page, state, "export-error", info.project.name);
});

nativeTest("one pending import survives both hot switches and verifies all 23 table counts before reload", async ({ page }, info) => {
  const state = await fixture(page);
  await chooseBundle(page);
  await confirmBundle(page);
  const gate = deferred(); state.importGate = gate.promise;
  await page.getByRole("button", { name: "Replace data", exact: true }).click();
  await expect.poll(() => state.imports.length).toBe(1);
  await switchRenderer(page, state, false);
  await expect(page.getByRole("button", { name: "Download export", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Check interrupted saves", exact: true })).toBeDisabled();
  await switchRenderer(page, state, true);
  await expect(page.getByRole("button", { name: "Choose JSON bundle", exact: true })).toBeDisabled();
  await capture(page, state, "import-pending", info.project.name);
  gate.resolve();
  await expect(portable(page).getByRole("status").filter({ hasText: "Import complete" })).toContainText("1 records applied");
  expect(state.imports).toEqual([{ token: "Bearer ui-regression-token", body: sourceBundle }]);
  await switchRenderer(page, state, false);
  await expect(portable(page).getByRole("status").filter({ hasText: "Import complete" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download export", exact: true })).toBeDisabled();
  await capture(page, state, "import-complete", info.project.name);
  await page.getByRole("button", { name: "Reload workspace", exact: true }).click();
  await expect(page.getByRole("button", { name: "Download export", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Choose JSON bundle", exact: true })).toBeEnabled();
  await expect(portable(page).getByText("owned-data.json", { exact: true })).toHaveCount(0);
  expect(state.imports).toHaveLength(1);
});

nativeTest("a server-confirmed failed import cannot be replayed by switching the interface", async ({ page }, info) => {
  const state = await fixture(page);
  await chooseBundle(page); await confirmBundle(page);
  state.importFailure = true;
  await page.getByRole("button", { name: "Replace data", exact: true }).click();
  await expect(portable(page).getByRole("alert")).toContainText(/failed or was canceled/);
  await expect(page.getByRole("button", { name: "Reload workspace", exact: true })).toBeEnabled();
  await switchRenderer(page, state, false);
  await expect(portable(page).getByRole("alert")).toContainText(/failed or was canceled/);
  await expect(page.getByRole("button", { name: "Download export", exact: true })).toBeDisabled();
  expect(state.imports).toHaveLength(1);
  await capture(page, state, "import-error", info.project.name);
});

nativeTest("running and unavailable receipt checks preserve their marker and terminal recovery survives a hot switch", async ({ page }, info) => {
  const state = await fixture(page);
  await seedMarker(page);
  state.target = { ...receipt(), status: "running", http_status: null, completed_at: null };
  await page.getByRole("button", { name: "Check interrupted saves", exact: true }).click();
  await expect(portable(page).getByRole("alert")).toContainText("still running");
  await switchRenderer(page, state, false);
  await expect(portable(page).getByRole("alert")).toContainText("still running");
  state.failQuery = true;
  await page.getByRole("button", { name: "Check interrupted saves", exact: true }).click();
  await expect(portable(page).getByRole("alert")).toContainText("Could not confirm interrupted saves");
  expect(await page.evaluate((key) => localStorage.getItem(key), markerKey)).not.toBeNull();
  await capture(page, state, "recovery-error", info.project.name);
  state.failQuery = false; state.target = receipt();
  const gate = deferred(); state.queryGate = gate.promise;
  await page.getByRole("button", { name: "Check interrupted saves", exact: true }).click();
  await expect.poll(() => state.recoveries.length).toBe(3);
  await switchRenderer(page, state, true);
  await expect(page.getByRole("button", { name: "Checking saves…", exact: true })).toBeDisabled();
  gate.resolve();
  await expect(page.getByRole("button", { name: "Reload workspace", exact: true })).toBeEnabled();
  expect(await page.evaluate((key) => localStorage.getItem(key), markerKey)).toBeNull();
  await switchRenderer(page, state, false);
  await expect(page.getByRole("button", { name: "Choose JSON bundle", exact: true })).toBeDisabled();
  await capture(page, state, "recovery-complete", info.project.name);
});

nativeTest("staged files reload only for their bound account and confirmation never persists", async ({ page }) => {
  const state = await fixture(page);
  await chooseBundle(page); await confirmBundle(page);
  const saved = await page.evaluate((prefix) => Object.keys(sessionStorage).filter((key) => key.startsWith(prefix)).map((key) => ({ key, raw: sessionStorage.getItem(key)! })), draftPrefix);
  expect(saved).toHaveLength(1);
  expect(saved[0].key).toContain("user-7001");
  expect(saved[0].raw).not.toContain("ui-regression-token");
  expect(JSON.parse(saved[0].raw).binding).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.parse(saved[0].raw).bundle).toEqual(sourceBundle);
  await switchRenderer(page, state, false);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(portable(page).getByText("owned-data.json", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Type IMPORT to confirm")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Replace data", exact: true })).toBeDisabled();
  await switchRenderer(page, state, true);
  await expect(portable(page).getByText("owned-data.json", { exact: true })).toBeVisible();
  expect(state.imports).toEqual([]);
  await page.evaluate(({ key, raw }) => sessionStorage.setItem(key, JSON.stringify({ ...JSON.parse(raw), binding: "0".repeat(64) })), saved[0]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Choose JSON bundle", exact: true })).toBeEnabled();
  await expect(portable(page).getByText("owned-data.json", { exact: true })).toHaveCount(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), saved[0].key)).toBeNull();
});

for (const ownerChange of [true, false]) nativeTest(`${ownerChange ? "account" : "token"} transitions discard staged files and their persisted binding across interface switches`, async ({ page }) => {
  const state = await fixture(page);
  await chooseBundle(page); await confirmBundle(page);
  await switchRenderer(page, state, false);
  await identityChange(page, state, ownerChange);
  await expect(page.getByRole("button", { name: "Choose JSON bundle", exact: true })).toBeEnabled();
  await expect(portable(page).getByText("owned-data.json", { exact: true })).toHaveCount(0);
  await switchRenderer(page, state, true);
  await expect(portable(page).getByText("owned-data.json", { exact: true })).toHaveCount(0);
  expect(await portable(page).locator('input[type="file"]').inputValue()).toBe("");
  expect(await page.evaluate((prefix) => Object.keys(sessionStorage).filter((key) => key.startsWith(prefix)), draftPrefix)).toEqual([]);
  expect(state.imports).toEqual([]);
});

nativeTest("a replacement generation discards staged data and keeps transfers blocked through a renderer switch", async ({ page }) => {
  const state = await fixture(page);
  await chooseBundle(page); await confirmBundle(page);
  await page.evaluate((key) => {
    const value = JSON.stringify({ revision: crypto.randomUUID(), phase: "ready" });
    localStorage.setItem(key, value);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
  }, epochKey);
  await expect(portable(page).getByText("owned-data.json", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reload workspace", exact: true })).toBeEnabled();
  await switchRenderer(page, state, false);
  await expect(page.getByRole("button", { name: "Download export", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Choose JSON bundle", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reload workspace", exact: true })).toBeEnabled();
  expect(await page.evaluate((prefix) => Object.keys(sessionStorage).filter((key) => key.startsWith(prefix)), draftPrefix)).toEqual([]);
  expect(state.imports).toEqual([]);
});

nativeTest("an accepted file read finishes in the retained controller after the interface switches", async ({ page }) => {
  const state = await fixture(page);
  await page.evaluate(() => {
    const browser = window as Window & { storageReadPending?: boolean; releaseStorageRead?: () => void };
    const original = File.prototype.text;
    const gate = new Promise<void>((resolve) => { browser.releaseStorageRead = resolve; });
    File.prototype.text = async function () { browser.storageReadPending = true; const text = await original.call(this); await gate; return text; };
  });
  await chooseBundle(page);
  await expect.poll(() => page.evaluate(() => (window as Window & { storageReadPending?: boolean }).storageReadPending)).toBe(true);
  await switchRenderer(page, state, false);
  await expect(page.getByRole("button", { name: "Validating file…", exact: true })).toBeDisabled();
  await page.evaluate(() => (window as Window & { releaseStorageRead?: () => void }).releaseStorageRead!());
  await expect(portable(page).getByText("owned-data.json", { exact: true })).toBeVisible();
  await switchRenderer(page, state, true);
  await expect(portable(page).getByText("owned-data.json", { exact: true })).toBeVisible();
  expect(state.imports).toEqual([]);
});

nativeTest("detaching a view cancels its native picker lease and suppresses a late export download", async ({ page }) => {
  const state = await fixture(page);
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Choose JSON bundle", exact: true }).click()]);
  await switchRenderer(page, state, false);
  await chooser.setFiles({ name: "detached-view.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(sourceBundle)) });
  await expect(portable(page).getByText("detached-view.json", { exact: true })).toHaveCount(0);
  expect(await portable(page).locator('input[type="file"]').inputValue()).toBe("");
  const gate = deferred(); state.exportGate = gate.promise;
  let downloads = 0; page.on("download", () => { downloads += 1; });
  await page.getByRole("button", { name: "Download export", exact: true }).click();
  await expect.poll(() => state.exports.length).toBe(1);
  await switchRenderer(page, state, true);
  await expect(page.getByRole("button", { name: "Preparing…", exact: true })).toBeDisabled();
  const response = page.waitForResponse((response) => response.url().endsWith("/app-data/export"));
  gate.resolve(); await (await response).finished();
  await expect(page.getByRole("button", { name: "Download export", exact: true })).toBeEnabled();
  expect(downloads).toBe(0);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download export", exact: true }).click()]);
  expect(download.suggestedFilename()).toBe("edgelab-export-2026-09-15.json");
});

nativeTest("legacy uncertainty remains explained and blocked in both interfaces without guessed receipts", async ({ page }) => {
  const state = await fixture(page);
  await seedMarker(page, "u");
  await page.getByRole("button", { name: "Check interrupted saves", exact: true }).click();
  await expect(portable(page).getByRole("alert")).toContainText("Automatic recovery is unavailable");
  await switchRenderer(page, state, false);
  await expect(portable(page).getByRole("alert")).toContainText("Automatic recovery is unavailable");
  expect(await page.evaluate((key) => localStorage.getItem(key), markerKey)).toBe("u");
  expect(state.recoveries).toEqual([]);
  expect(state.imports).toEqual([]);
});

nativeTest("a no-op recovery waiting for a shared save does not turn temporary admission into a required reload", async ({ page }) => {
  const state = await fixture(page);
  const beforeEpoch = await page.evaluate((key) => localStorage.getItem(key), epochKey);
  await page.evaluate(async () => {
    const browser = window as Window & { releaseRecoveryLock?: () => void; recoveryLockDone?: Promise<unknown> };
    let acquired!: () => void;
    const ready = new Promise<void>((resolve) => { acquired = resolve; });
    const held = new Promise<void>((resolve) => { browser.releaseRecoveryLock = resolve; });
    browser.recoveryLockDone = navigator.locks.request("edgelab.app-data.user-7001", { mode: "shared" }, async () => { acquired(); await held; });
    await ready;
  });
  await page.getByRole("button", { name: "Check interrupted saves", exact: true }).click();
  await expect(page.getByRole("button", { name: "Checking saves…", exact: true })).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new Event("edgelab:app-data-state-change")));
  await page.evaluate(async () => {
    const browser = window as Window & { releaseRecoveryLock?: () => void; recoveryLockDone?: Promise<unknown> };
    browser.releaseRecoveryLock!(); await browser.recoveryLockDone;
  });
  await expect(portable(page).getByRole("status")).toContainText("No interrupted saves need recovery.");
  await expect(page.getByRole("button", { name: "Reload workspace", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Download export", exact: true })).toBeEnabled();
  expect(await page.evaluate((key) => localStorage.getItem(key), epochKey)).toBe(beforeEpoch);
  expect(state.recoveries).toEqual([]);
});

nativeTest("a canceled interrupted save is cleared once and its reload survives switching interfaces", async ({ page }, info) => {
  const state = await fixture(page);
  await seedMarker(page);
  state.target = { ...receipt(), method: null, path: null, status: "canceled", http_status: null };
  await page.getByRole("button", { name: "Check interrupted saves", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reload workspace", exact: true })).toBeEnabled();
  expect(await page.evaluate((key) => localStorage.getItem(key), markerKey)).toBeNull();
  await switchRenderer(page, state, false);
  await expect(page.getByRole("button", { name: "Reload workspace", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Choose JSON bundle", exact: true })).toBeDisabled();
  await capture(page, state, "recovery-canceled", info.project.name);
  await page.getByRole("button", { name: "Reload workspace", exact: true }).click();
  await expect(page.getByRole("button", { name: "Download export", exact: true })).toBeEnabled();
  expect(state.recoveries).toHaveLength(1);
  expect(state.imports).toEqual([]);
});
