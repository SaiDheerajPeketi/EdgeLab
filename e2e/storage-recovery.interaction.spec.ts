import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { AUTH_SESSION_KEY, betaSessionResponse, gotoStable, installDeterminism, seedApprovedSession } from "./support/app";
import type { BetaAuthSession } from "../frontend/src/lib/api";

const nativeTest = test.extend({ video: "off", screenshot: "off", trace: "off" });
const storagePath = "/app/settings/storage";
const owner = "user-7001";
const operationId = "11111111-1111-4111-8111-111111111111";
const markerKey = `edgelab.app-data-uncertain.v1.${owner}.${operationId}`;
const epochKey = `edgelab.app-data-generation.v1.${owner}`;
const operation = { version: 2, id: operationId, method: "PUT", path: "/settings/preferences" };
const artifactDir = path.resolve(".artifacts/storage-recovery23");
type Receipt = { operation_id: string; method: string | null; path: string | null; status: "reserved" | "running" | "completed" | "canceled"; http_status: number | null; result: null; created_at: string; completed_at: string | null };
const receipt = (id = operationId): Receipt => ({ operation_id: id, method: operation.method, path: operation.path, status: "completed", http_status: 200, result: null, created_at: "2026-09-15T10:00:00Z", completed_at: "2026-09-15T10:00:01Z" });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function fixture(page: Page) {
  await installDeterminism(page);
  await seedApprovedSession(page);
  const receipts = new Map<string, Receipt>();
  const state = { recoveries: [] as Array<{ id: string; token: string | undefined }>, target: receipt(), failQuery: false, queryGate: null as Promise<void> | null, exportGate: null as Promise<void> | null, saveGate: null as Promise<void> | null, saves: 0, imports: 0, exports: [] as string[], session: structuredClone(betaSessionResponse) as BetaAuthSession };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (endpoint === "/auth/session") { await route.fulfill({ json: state.session }); return; }
    const metadata = endpoint.match(/^\/app-data\/operations\/([0-9a-f-]+)\/(reserve|recover)$/);
    if (metadata) {
      const [, id, action] = metadata;
      expect(request.method()).toBe("POST");
      expect(request.headers()["x-edgelab-operation-id"]).toBeUndefined();
      if (action === "reserve") {
        expect(request.headers().authorization).toBe(`Bearer ${state.session.token}`);
        const binding = request.postDataJSON();
        receipts.set(id, { ...receipt(id), ...binding, status: "reserved", http_status: null, completed_at: null });
      } else if (id === operationId) {
        expect(request.headers().authorization).toBe(`Bearer ${state.session.token}`);
        state.recoveries.push({ id, token: request.headers().authorization });
        if (state.queryGate) await state.queryGate;
        if (state.failQuery) { await route.fulfill({ status: 503, json: { detail: "Receipt service temporarily unavailable" } }); return; }
        await route.fulfill({ json: state.target });
        return;
      }
      await route.fulfill({ json: receipts.get(id) });
      return;
    }
    if (endpoint === "/app-data/export") {
      state.exports.push(request.headers().authorization);
      if (state.exportGate) await state.exportGate;
      const tableNames = await page.evaluate(async () => { const modulePath = "/src/lib/api.ts"; return [...(await import(modulePath)).APP_DATA_TABLE_NAMES]; });
      await route.fulfill({ json: { app: "edgelab", version: 1, exported_at: "2026-09-15T10:00:00Z", tables: Object.fromEntries(tableNames.map((name: string) => [name, []])) } });
      return;
    }
    const id = request.headers()["x-edgelab-operation-id"];
    if (id) {
      const bound = receipts.get(id);
      expect(bound).toMatchObject({ status: "reserved", method: request.method(), path: endpoint });
      Object.assign(bound!, { status: "completed", http_status: 200, completed_at: "2026-09-15T10:00:01Z" });
    }
    if (endpoint === "/app-storage/edgelab/tab-proof" && request.method() === "PUT") {
      state.saves += 1;
      if (state.saveGate) await state.saveGate;
      await route.fulfill({ json: { namespace: "edgelab", key: "tab-proof", value: request.postDataJSON().value, updated_at: "2026-09-15T10:00:01Z" } });
      return;
    }
    if (endpoint === "/app-data/import") state.imports += 1;
    await route.fallback();
  });
  await gotoStable(page, storagePath);
  await expect(page.locator('[data-route-group="settings"]')).toHaveAttribute("data-ui-version", "v2");
  await expect(page.getByRole("heading", { name: "Portable data", exact: true })).toBeVisible();
  return state;
}

async function seedInterruptedSave(page: Page, value = JSON.stringify({ ...operation, phase: "uncertain" })) {
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: markerKey, value });
}

async function capture(page: Page, state: string, projectName: string) {
  fs.mkdirSync(artifactDir, { recursive: true });
  await page.getByRole("heading", { name: "Portable data", exact: true }).evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: path.join(artifactDir, `${projectName}-${state}.png`), animations: "disabled", fullPage: false });
}

nativeTest("storage recovery baseline capture", async ({ page }, testInfo) => {
  await fixture(page);
  await expect(page.getByRole("button", { name: "Download export", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Choose JSON bundle", exact: true })).toBeEnabled();
  if (process.env.EDGELAB_CAPTURE_STORAGE_BEFORE === "1") {
    fs.mkdirSync(artifactDir, { recursive: true });
    await page.getByRole("heading", { name: "Portable data", exact: true }).evaluate((element) => element.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: path.join(artifactDir, `before-${testInfo.project.name}.png`), animations: "disabled" });
  } else await capture(page, "idle", testInfo.project.name);
});

function portable(page: Page) {
  return page.locator('section[aria-labelledby="settings-portable-data"]');
}

async function chooseBundle(page: Page) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Choose JSON bundle", exact: true }).click()]);
  await chooser.setFiles({ name: "owned-data.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ app: "edgelab", version: 1, tables: { app_storage: [{ id: 7 }] } })) });
  await expect(portable(page).getByText("owned-data.json", { exact: true })).toBeVisible();
  await page.getByLabel("Type IMPORT to confirm").fill("IMPORT");
}

async function switchOwner(page: Page, state: Awaited<ReturnType<typeof fixture>>) {
  state.session = { ...state.session, token: "other-owner-token", user: { ...state.session.user, id: 7002, name: "Second Owner", email: "second-owner@example.test" } };
  await page.evaluate(async (session) => {
    const modulePath = "/src/lib/authSession.ts";
    const auth = await import(modulePath);
    auth.setStoredAuthSession(auth.toStoredAuthSession(session));
  }, state.session);
}

for (const status of ["completed", "canceled"] as const) nativeTest(`${status} interrupted save recovery pauses transfers until the workspace reloads`, async ({ page }, testInfo) => {
  const state = await fixture(page);
  await chooseBundle(page);
  await seedInterruptedSave(page);
  state.target = status === "completed" ? receipt() : { ...receipt(), status: "canceled", http_status: null };
  const gate = deferred();
  state.queryGate = gate.promise;
  await page.getByRole("button", { name: "Check interrupted saves", exact: true }).click();
  await expect.poll(() => state.recoveries.length).toBe(1);
  await expect(page.getByRole("button", { name: "Checking saves…", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Download export", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Choose a different file", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Replace data", exact: true })).toBeDisabled();
  if (status === "completed") await capture(page, "checking", testInfo.project.name);
  gate.resolve();
  await expect(portable(page).getByRole("button", { name: "Reload workspace", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download export", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Choose JSON bundle", exact: true })).toBeDisabled();
  expect(state.recoveries).toEqual([{ id: operationId, token: "Bearer ui-regression-token" }]);
  expect(await page.evaluate((key) => localStorage.getItem(key), markerKey)).toBeNull();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).phase, epochKey)).toBe("ready");
  await capture(page, status, testInfo.project.name);
  await portable(page).getByRole("button", { name: "Reload workspace", exact: true }).click();
  await expect(page.getByRole("button", { name: "Download export", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Choose JSON bundle", exact: true })).toBeEnabled();
  await expect(portable(page).getByRole("button", { name: "Reload workspace", exact: true })).toHaveCount(0);
  await expect(portable(page).getByText("owned-data.json", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => typeof navigator.locks?.request)).toBe("function");
  await capture(page, `${status}-reloaded`, testInfo.project.name);
});

nativeTest("a still-running server save retains its marker and offers a completion check without replaying a write", async ({ page }, testInfo) => {
  const state = await fixture(page);
  await chooseBundle(page);
  await seedInterruptedSave(page);
  state.target = { ...receipt(), status: "running", http_status: null, completed_at: null };
  await page.getByRole("button", { name: "Check interrupted saves", exact: true }).click();
  await expect(portable(page).getByRole("alert")).toContainText(/still running/);
  await expect(page.getByRole("button", { name: "Check interrupted saves", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Replace data", exact: true })).toBeDisabled();
  await expect(portable(page).getByRole("button", { name: "Reload workspace", exact: true })).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), markerKey)).not.toBeNull();
  await capture(page, "running", testInfo.project.name);
  state.target = receipt();
  await page.getByRole("button", { name: "Check interrupted saves", exact: true }).click();
  await expect(portable(page).getByRole("button", { name: "Reload workspace", exact: true })).toBeVisible();
  expect(state.recoveries).toHaveLength(2);
});

nativeTest("a failed receipt query keeps the interrupted save and allows a later check", async ({ page }, testInfo) => {
  const state = await fixture(page);
  await seedInterruptedSave(page);
  state.failQuery = true;
  await page.getByRole("button", { name: "Check interrupted saves", exact: true }).click();
  await expect(portable(page).getByRole("alert")).toContainText(/could not verify|remain paused/);
  await expect(page.getByRole("button", { name: "Check interrupted saves", exact: true })).toBeEnabled();
  expect(await page.evaluate((key) => localStorage.getItem(key), markerKey)).not.toBeNull();
  await capture(page, "query-error", testInfo.project.name);
  state.failQuery = false;
  await page.getByRole("button", { name: "Check interrupted saves", exact: true }).click();
  await expect(portable(page).getByRole("button", { name: "Reload workspace", exact: true })).toBeVisible();
  expect(state.recoveries).toHaveLength(2);
});

nativeTest("an older interrupted save is explained without inventing a receipt or clearing its marker", async ({ page }, testInfo) => {
  const state = await fixture(page);
  await seedInterruptedSave(page, "u");
  await page.getByRole("button", { name: "Check interrupted saves", exact: true }).click();
  await expect(portable(page).getByRole("alert")).toContainText(/Automatic recovery is unavailable/);
  expect(state.recoveries).toEqual([]);
  expect(await page.evaluate((key) => localStorage.getItem(key), markerKey)).toBe("u");
  await expect(page.getByRole("button", { name: "Check interrupted saves", exact: true })).toBeEnabled();
  await capture(page, "legacy", testInfo.project.name);
});

nativeTest("checking an account with no interrupted operations leaves transfers available", async ({ page }, testInfo) => {
  const state = await fixture(page);
  await page.getByRole("button", { name: "Check interrupted saves", exact: true }).click();
  await expect(portable(page).getByRole("status")).toContainText(/no interrupted|no pending/i);
  await expect(page.getByRole("button", { name: "Download export", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Choose JSON bundle", exact: true })).toBeEnabled();
  await expect(portable(page).getByRole("button", { name: "Reload workspace", exact: true })).toHaveCount(0);
  expect(state.recoveries).toEqual([]);
  await capture(page, "no-operations", testInfo.project.name);
});

nativeTest("an owner change during a receipt query resets the selected file and discards the old result", async ({ page }, testInfo) => {
  const state = await fixture(page);
  await chooseBundle(page);
  await seedInterruptedSave(page);
  const gate = deferred();
  state.queryGate = gate.promise;
  await page.getByRole("button", { name: "Check interrupted saves", exact: true }).click();
  await expect.poll(() => state.recoveries.length).toBe(1);
  await switchOwner(page, state);
  gate.resolve();
  await expect(page.getByRole("button", { name: "Check interrupted saves", exact: true })).toBeEnabled();
  await expect(portable(page).getByText("owned-data.json", { exact: true })).toHaveCount(0);
  await expect(portable(page).getByRole("button", { name: "Reload workspace", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Choose JSON bundle", exact: true })).toBeEnabled();
  expect(await portable(page).locator('input[type="file"]').inputValue()).toBe("");
  expect(await page.evaluate((key) => localStorage.getItem(key), markerKey)).not.toBeNull();
  expect(await page.evaluate((key) => localStorage.getItem(key), epochKey)).toBeNull();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).user.id, AUTH_SESSION_KEY)).toBe(7002);
  await capture(page, "owner-changed", testInfo.project.name);
});

async function category(page: Page, value: string, label: string) {
  const select = page.getByRole("combobox", { name: "Settings category", exact: true });
  if (await select.count()) await select.selectOption(value);
  else await page.getByRole("button", { name: label, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`(?:/app/settings/${value}|#settings/${value})$`));
}

nativeTest("the shared recovery controller retains current-account status after the Storage view remounts", async ({ page }) => {
  const state = await fixture(page);
  await chooseBundle(page);
  await seedInterruptedSave(page);
  const gate = deferred();
  state.queryGate = gate.promise;
  state.target = { ...receipt(), status: "running", http_status: null, completed_at: null };
  await page.getByRole("button", { name: "Check interrupted saves", exact: true }).click();
  await expect.poll(() => state.recoveries.length).toBe(1);
  await category(page, "appearance", "Appearance");
  gate.resolve();
  await category(page, "storage", "Storage");
  await expect(page.getByRole("button", { name: "Check interrupted saves", exact: true })).toBeEnabled();
  await expect(portable(page).getByText("owned-data.json", { exact: true })).toBeVisible();
  await expect(portable(page).getByRole("alert")).toContainText("still running");
  expect(await page.evaluate((key) => localStorage.getItem(key), markerKey)).not.toBeNull();
});

nativeTest("a file selected in a picker opened by the previous owner is discarded", async ({ page }) => {
  const state = await fixture(page);
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Choose JSON bundle", exact: true }).click()]);
  await switchOwner(page, state);
  await chooser.setFiles({ name: "old-owner-data.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ app: "edgelab", version: 1, tables: {} })) });
  await expect(page.getByRole("button", { name: "Choose JSON bundle", exact: true })).toBeEnabled();
  await expect(portable(page).getByText("old-owner-data.json", { exact: true })).toHaveCount(0);
  await expect(portable(page).getByLabel("Type IMPORT to confirm")).toHaveCount(0);
  expect(await portable(page).locator('input[type="file"]').inputValue()).toBe("");
});

nativeTest("a file read finishing after an owner change cannot publish its preview", async ({ page }) => {
  const state = await fixture(page);
  await page.evaluate(() => {
    const browser = window as Window & { storageRecoveryFilePending?: boolean; releaseStorageRecoveryFile?: () => void };
    const original = File.prototype.text;
    const gate = new Promise<void>((resolve) => { browser.releaseStorageRecoveryFile = resolve; });
    File.prototype.text = async function () { browser.storageRecoveryFilePending = true; const text = await original.call(this); await gate; return text; };
  });
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Choose JSON bundle", exact: true }).click()]);
  await chooser.setFiles({ name: "old-owner-data.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ app: "edgelab", version: 1, tables: {} })) });
  await expect.poll(() => page.evaluate(() => (window as Window & { storageRecoveryFilePending?: boolean }).storageRecoveryFilePending)).toBe(true);
  await switchOwner(page, state);
  await page.evaluate(() => (window as Window & { releaseStorageRecoveryFile?: () => void }).releaseStorageRecoveryFile!());
  await expect(page.getByRole("button", { name: "Choose JSON bundle", exact: true })).toBeEnabled();
  await expect(portable(page).getByText("old-owner-data.json", { exact: true })).toHaveCount(0);
  expect(await portable(page).locator('input[type="file"]').inputValue()).toBe("");
});

nativeTest("an export response belonging to the previous owner never starts a browser download", async ({ page }) => {
  const state = await fixture(page);
  const gate = deferred();
  state.exportGate = gate.promise;
  let downloads = 0;
  page.on("download", () => { downloads += 1; });
  await page.getByRole("button", { name: "Download export", exact: true }).click();
  await expect.poll(() => state.exports.length).toBe(1);
  await switchOwner(page, state);
  const completed = page.waitForResponse((response) => response.url().endsWith("/app-data/export"));
  gate.resolve();
  await (await completed).finished();
  await expect(page.getByRole("button", { name: "Download export", exact: true })).toBeEnabled();
  state.exportGate = null;
  expect(downloads).toBe(0);
  await expect(portable(page).getByRole("alert")).toHaveCount(0);
});

nativeTest("an old export finally cannot release a newer recovery query's busy controls", async ({ page }) => {
  const state = await fixture(page);
  const exportGate = deferred();
  state.exportGate = exportGate.promise;
  await page.getByRole("button", { name: "Download export", exact: true }).click();
  await expect.poll(() => state.exports.length).toBe(1);
  await switchOwner(page, state);
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: markerKey.replace("user-7001", "user-7002"), value: JSON.stringify({ ...operation, phase: "uncertain" }) });
  const queryGate = deferred();
  state.queryGate = queryGate.promise;
  await page.getByRole("button", { name: "Check interrupted saves", exact: true }).click();
  await expect.poll(() => state.recoveries.length).toBe(1);
  const oldResponse = page.waitForResponse((response) => response.url().endsWith("/app-data/export"));
  exportGate.resolve();
  await (await oldResponse).finished();
  await expect(page.getByRole("button", { name: "Checking saves…", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Download export", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Choose JSON bundle", exact: true })).toBeDisabled();
  queryGate.resolve();
  await expect(portable(page).getByRole("button", { name: "Reload workspace", exact: true })).toBeVisible();
});

nativeTest("a no-op completion check after token refresh preserves a required reload", async ({ page }) => {
  const state = await fixture(page);
  await seedInterruptedSave(page);
  await page.getByRole("button", { name: "Check interrupted saves", exact: true }).click();
  await expect(portable(page).getByRole("button", { name: "Reload workspace", exact: true })).toBeVisible();
  state.session = { ...state.session, token: "refreshed-ui-regression-token" };
  await page.evaluate(async (session) => { const modulePath = "/src/lib/authSession.ts"; const auth = await import(modulePath); auth.setStoredAuthSession(auth.toStoredAuthSession(session)); }, state.session);
  await page.getByRole("button", { name: "Check interrupted saves", exact: true }).click();
  await expect(portable(page).getByRole("status")).toContainText(/Reload the workspace/);
  await expect(portable(page).getByRole("button", { name: "Reload workspace", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download export", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Choose JSON bundle", exact: true })).toBeDisabled();
  expect(state.recoveries).toHaveLength(1);
});

nativeTest("a silent owner switch before Replace data cannot submit the previous owner's staged file", async ({ page }) => {
  const state = await fixture(page);
  await chooseBundle(page);
  await expect(page.getByRole("button", { name: "Replace data", exact: true })).toBeEnabled();
  state.session = { ...state.session, token: "other-owner-token", user: { ...state.session.user, id: 7002, name: "Second Owner", email: "second-owner@example.test" } };
  await page.evaluate(({ key, next }) => {
    const session = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(key, JSON.stringify({ ...session, token: next.token, user: { ...session.user, id: next.user.id, name: next.user.name, email: next.user.email } }));
  }, { key: AUTH_SESSION_KEY, next: state.session });
  await page.getByRole("button", { name: "Replace data", exact: true }).click();
  await expect(portable(page).getByText("owned-data.json", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Choose JSON bundle", exact: true })).toBeEnabled();
  expect(state.imports).toBe(0);
  expect(state.recoveries).toEqual([]);
});

nativeTest("a same-tab save's receipt completion resumes import admission without a manual recovery check", async ({ page }) => {
  const state = await fixture(page);
  await chooseBundle(page);
  await expect(page.getByRole("button", { name: "Replace data", exact: true })).toBeEnabled();
  const gate = deferred();
  state.saveGate = gate.promise;
  await page.evaluate(async () => {
    const modulePath = "/src/lib/api.ts";
    const api = await import(modulePath);
    const browser = window as Window & { storageRecoverySaveOutcome?: string };
    void api.putAppStorageItem("edgelab", "tab-proof", { theme: "confirmed" }).then(() => { browser.storageRecoverySaveOutcome = "saved"; }, (error: Error) => { browser.storageRecoverySaveOutcome = error.name; });
  });
  await expect.poll(() => state.saves).toBe(1);
  await expect(page.getByRole("button", { name: "Replace data", exact: true })).toBeDisabled();
  await expect(portable(page).getByRole("status")).toContainText(/save needs confirmation/i);
  gate.resolve();
  await expect.poll(() => page.evaluate(() => (window as Window & { storageRecoverySaveOutcome?: string }).storageRecoverySaveOutcome)).toBe("saved");
  await expect(page.getByRole("button", { name: "Replace data", exact: true })).toBeEnabled();
  await expect(portable(page).getByRole("button", { name: "Reload workspace", exact: true })).toHaveCount(0);
  expect(state.recoveries).toEqual([]);
});
