import { expect, test, type Page } from "@playwright/test";
import { gotoStable, installDeterminism, seedApprovedSession } from "./support/app";

test.use({ video: "off" });

const settingsPath = "/app/settings/appearance";
const storagePath = "/api/app-storage/edgelab/settings-center.v1";
const localKey = "edgelab.settings-center.v1.user-7001";
const draftKey = "edgelab.compatibility.settings-draft.v1";
const initialPreferences = { density: "comfortable", includeDiagnosticsByDefault: false };
const savedPreferences = { density: "compact", includeDiagnosticsByDefault: false };

async function installSettingsFixture(page: Page) {
  await installDeterminism(page, { rollout: "fallback" });
  await seedApprovedSession(page);
  const state = {
    fallback: true,
    failWrites: false,
    reads: [] as string[],
    stored: { ...initialPreferences },
    writeGate: null as Promise<void> | null,
    writes: [] as Array<{ method: string; path: string; body: { value: typeof initialPreferences } }>,
  };
  await page.route("**/api/ui/rollout", (route) => route.fulfill({
    json: {
      revision: state.fallback ? "settings-canary-fallback" : "settings-canary-modern",
      kill_switch: state.fallback,
      flags: { shell: true, journal: true, settings: true, chart: true, public: true },
    },
  }));
  await page.route(`**${storagePath}`, async (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname;
    if (method === "GET") {
      state.reads.push(path);
    } else {
      expect(method).toBe("PUT");
      const body = route.request().postDataJSON() as { value: typeof initialPreferences };
      state.writes.push({ method, path, body });
      if (state.writeGate) await state.writeGate;
      if (state.failWrites) {
        await route.fulfill({ json: { detail: "Settings storage unavailable" }, status: 500 });
        return;
      }
      state.stored = { ...body.value };
    }
    await route.fulfill({
      json: {
        key: "settings-center.v1",
        namespace: "edgelab",
        updated_at: "2026-09-15T10:30:00.000Z",
        value: state.stored,
      },
    });
  });
  return state;
}

function settingsBoundary(page: Page) {
  return page.locator('[data-route-group="settings"]');
}

test("fallback saves an exact settings canary that modern and fallback reload from the shared API", async ({ page }) => {
  const state = await installSettingsFixture(page);
  await gotoStable(page, settingsPath, { waitForNetworkIdle: false });
  await expect(settingsBoundary(page)).toHaveAttribute("data-ui-version", "fallback");
  const density = page.getByLabel("Workspace density");
  await expect(density).toHaveValue("comfortable");
  await density.selectOption("compact");
  await expect(page.getByRole("status").filter({ hasText: /^Unsaved changes$/ })).toBeVisible();

  let releaseWrite!: () => void;
  state.writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  const pendingSave = page.getByRole("button", { name: "Saving…", exact: true });
  await expect(pendingSave).toBeDisabled();
  await expect(density).toBeDisabled();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.stored).toEqual(initialPreferences);
  await expect.poll(() => page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? "null"), draftKey)).toEqual(savedPreferences);
  releaseWrite();
  await expect(page.getByRole("status").filter({ hasText: /^Settings saved$/ })).toBeVisible();
  expect(state.writes).toEqual([{ body: { value: savedPreferences }, method: "PUT", path: storagePath }]);
  expect(state.stored).toEqual(savedPreferences);
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), draftKey)).toBeNull();

  state.fallback = false;
  await page.evaluate((key) => localStorage.removeItem(key), localKey);
  const readsBeforeModern = state.reads.length;
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(settingsBoundary(page)).toHaveAttribute("data-ui-version", "v2");
  await expect(page.getByLabel("Settings density", { exact: true })).toHaveValue("compact");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.density)).toBe("compact");
  await expect.poll(() => state.reads.length).toBeGreaterThan(readsBeforeModern);
  await expect(page).toHaveURL(new RegExp(`${settingsPath}$`));

  state.fallback = true;
  await page.evaluate((key) => localStorage.removeItem(key), localKey);
  const readsBeforeFallback = state.reads.length;
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(settingsBoundary(page)).toHaveAttribute("data-ui-version", "fallback");
  await expect(page.getByLabel("Workspace density")).toHaveValue("compact");
  await expect(page.getByRole("status").filter({ hasText: /^Settings loaded$/ })).toBeVisible();
  await expect.poll(() => state.reads.length).toBeGreaterThan(readsBeforeFallback);
  expect(state.stored).toEqual(savedPreferences);
});

test("fallback save rejection preserves its draft across reload and allows a successful retry", async ({ page }) => {
  const state = await installSettingsFixture(page);
  await gotoStable(page, settingsPath, { waitForNetworkIdle: false });
  const density = page.getByLabel("Workspace density");
  await density.selectOption("compact");
  await expect(page.getByRole("status").filter({ hasText: /^Unsaved changes$/ })).toBeVisible();
  state.failWrites = true;
  let releaseWrite!: () => void;
  state.writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
  await expect(density).toBeDisabled();
  await expect.poll(() => state.writes.length).toBe(1);
  releaseWrite();
  await expect(page.getByRole("alert")).toHaveText("Settings could not be saved. Your changes are kept; try again.");
  await expect(page.getByRole("button", { name: "Save settings", exact: true })).toBeEnabled();
  await expect(density).toBeEnabled();
  await expect(density).toHaveValue("compact");
  await expect.poll(() => page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? "null"), draftKey)).toEqual(savedPreferences);
  expect(state.writes).toEqual([{ body: { value: savedPreferences }, method: "PUT", path: storagePath }]);
  expect(state.stored).toEqual(initialPreferences);

  state.failWrites = false;
  state.writeGate = null;
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("Workspace density")).toHaveValue("compact");
  await expect(page.getByRole("status").filter({ hasText: /^Unsaved changes$/ })).toBeVisible();
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Settings saved$/ })).toBeVisible();
  expect(state.writes).toEqual([
    { body: { value: savedPreferences }, method: "PUT", path: storagePath },
    { body: { value: savedPreferences }, method: "PUT", path: storagePath },
  ]);
  expect(state.stored).toEqual(savedPreferences);
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), draftKey)).toBeNull();
});
