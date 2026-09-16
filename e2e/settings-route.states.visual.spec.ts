import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  FROZEN_TIME,
  expectStableScreenshot,
  gotoStable,
  installDeterminism,
  seedApprovedSession,
} from "./support/app";

const journalRoute = "/app/settings/journal#settings/journal/journal-defaults";
const providersRoute = "/app/settings/data-providers#settings/data-providers/broker-connections";

const provider = {
  provider_id: "offline-fixture",
  display_name: "Offline fixture",
  availability: "offline-fixture",
  capabilities: {
    accounts: true,
    incremental_sync: true,
    orders: true,
    fills: true,
    live_connectivity: false,
  },
  requires_secret: true,
  description: "Deterministic local provider for reviewing broker workflows.",
};

const connection = {
  id: 401,
  provider: "offline-fixture",
  display_name: "Verified offline fixture",
  secret_id: 301,
  status: "HEALTHY",
  health: "HEALTHY",
  last_error_code: null,
  last_error_message: null,
  last_sync_started_at: FROZEN_TIME,
  last_sync_completed_at: FROZEN_TIME,
  next_retry_at: null,
  created_at: FROZEN_TIME,
  updated_at: FROZEN_TIME,
  revoked_at: null,
};

const secret = {
  id: 301,
  provider: "offline-fixture",
  purpose: "broker-sync",
  key_id: "visual-key",
  cipher_version: 1,
  version: 1,
  state: "active",
  created_at: FROZEN_TIME,
  updated_at: FROZEN_TIME,
  rotated_at: null,
  last_connected_at: FROZEN_TIME,
  revoked_at: null,
};

test.describe("settings route critical-state baselines", () => {
  test.beforeEach(async ({ page }) => {
    await installDeterminism(page);
    await seedApprovedSession(page);
    await page.addInitScript(() => {
      let resolveJournalSave: (() => void) | null = null;
      Object.defineProperty(window, "__edgeLabE2E", {
        configurable: true,
        value: {
          waitForSettingsSave: (key: string) => key === "journal"
            ? new Promise<void>((resolve) => { resolveJournalSave = resolve; })
            : Promise.resolve(),
        },
      });
      Object.defineProperty(window, "__resolveJournalSettingsSave", {
        configurable: true,
        value: () => resolveJournalSave?.(),
      });
    });
  });

  test("loading state stays neutral until provider data resolves", async ({ page }) => {
    await page.route(/\/api\/(?:broker-providers|broker-connections|integration-secrets)(?:\?.*)?$/, () => new Promise<void>(() => undefined));
    await gotoStable(page, providersRoute, { waitForNetworkIdle: false });

    const loading = page.getByRole("status").filter({ hasText: "Loading provider status…" });
    await expect(loading).toBeVisible();
    await expect(page.getByText("No credential records.")).toHaveCount(0);
    await expect(page.getByText("Configured connections")).toHaveCount(0);
    await captureState(page, "settings-loading", loading);
  });

  test("dirty state keeps the draft and apply action explicit", async ({ page }) => {
    await gotoStable(page, journalRoute, { waitForNetworkIdle: false });
    await page.getByLabel("Broker label").fill("Frankfurt futures desk");

    const dirty = page.getByRole("status").filter({ hasText: "Draft changes not applied" });
    const apply = page.getByRole("button", { name: "Apply journal defaults" });
    await expect(dirty).toBeVisible();
    await expect(apply).toBeEnabled();
    await captureState(page, "settings-dirty", apply);
  });

  test("saving state announces progress and prevents duplicate submission", async ({ page }) => {
    await gotoStable(page, journalRoute, { waitForNetworkIdle: false });
    await page.getByLabel("Broker label").fill("Frankfurt futures desk");
    const apply = page.getByRole("button", { name: "Apply journal defaults" });
    await apply.click();

    const saving = page.getByRole("status").filter({ hasText: "Applying locally…" });
    await expect(saving).toBeVisible();
    await expect(apply).toBeDisabled();
    await captureState(page, "settings-saving", saving);
  });

  test("saved state announces completion and clears the draft", async ({ page }) => {
    await gotoStable(page, journalRoute, { waitForNetworkIdle: false });
    await page.getByLabel("Broker label").fill("Frankfurt futures desk");
    const apply = page.getByRole("button", { name: "Apply journal defaults" });
    await apply.click();
    await page.evaluate(() => (window as typeof window & {
      __resolveJournalSettingsSave: () => void;
    }).__resolveJournalSettingsSave());

    const saved = page.getByRole("status").filter({ hasText: "Applied locally" });
    await expect(saved).toBeVisible();
    await expect(page.getByText("All explicit changes applied")).toBeVisible();
    await expect(apply).toBeDisabled();
    await captureState(page, "settings-saved", saved);
  });

  test("danger confirmation explains impact and remains cancellable", async ({ page }) => {
    await jsonRoute(page, /\/api\/broker-providers(?:\?.*)?$/, [provider]);
    await jsonRoute(page, /\/api\/broker-connections(?:\?.*)?$/, [connection]);
    await jsonRoute(page, /\/api\/integration-secrets(?:\?.*)?$/, [secret]);
    let deleteRequests = 0;
    page.on("request", (request) => {
      if (request.method() === "DELETE") deleteRequests += 1;
    });
    await gotoStable(page, providersRoute, { waitForNetworkIdle: false });

    const connectionCard = page.getByRole("group", { name: "Verified offline fixture connection" });
    await expect(connectionCard).toBeVisible();
    await connectionCard.getByRole("button", { name: "Revoke" }).click();
    let confirmation = page.getByRole("region", { name: "Confirm revocation" });
    await expect(confirmation).toContainText("This stops future refreshes. Imported journal data remains. This action is recorded by the service.");
    await expect(confirmation.getByRole("button", { name: "Confirm revoke" })).toBeEnabled();
    await confirmation.getByRole("button", { name: "Cancel" }).click();
    await expect(confirmation).toHaveCount(0);
    expect(deleteRequests).toBe(0);

    await connectionCard.getByRole("button", { name: "Revoke" }).click();
    confirmation = page.getByRole("region", { name: "Confirm revocation" });
    await expect(confirmation).toBeVisible();
    expect(deleteRequests).toBe(0);
    await captureState(page, "settings-danger-confirmation", confirmation, page.locator("#setting-credential-vault"));
  });
});

async function jsonRoute(page: Page, pattern: string | RegExp, body: unknown, status = 200) {
  await page.route(pattern, (route) => route.fulfill({
    body: JSON.stringify(body),
    contentType: "application/json",
    status,
  }));
}

async function captureState(page: Page, name: string, state: Locator, interactiveScope = state) {
  await state.evaluate((element) => element.scrollIntoView({ behavior: "auto", block: "center" }));
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expectStateGeometry(page, state, interactiveScope);
  await expectStableScreenshot(page, name, { fullPage: false });
}

async function expectStateGeometry(page: Page, state: Locator, interactiveScope: Locator) {
  await expect(state).toBeInViewport();
  const viewport = page.viewportSize()!;
  const box = await state.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

  const mobileNav = page.getByRole("navigation", { name: "Primary workspace" });
  const navBox = await mobileNav.isVisible() ? await mobileNav.boundingBox() : null;
  const contentBottom = navBox?.y ?? viewport.height;
  await expectInteractiveGeometry(page, state, viewport, contentBottom, true);
  if (interactiveScope !== state) {
    await expectInteractiveGeometry(page, interactiveScope, viewport, contentBottom, false);
  }

  if (navBox) {
    expect(box!.y + box!.height).toBeLessThanOrEqual(navBox!.y);
  }
}

async function expectInteractiveGeometry(page: Page, scope: Locator, viewport: { height: number; width: number }, contentBottom: number, requireTabletTargets: boolean) {
  const controls = scope.locator("button, input, select, textarea, a[href]");
  for (let index = 0; index < await controls.count(); index += 1) {
    const control = controls.nth(index);
    if (!(await control.isVisible())) continue;
    const controlBox = await control.boundingBox();
    expect(controlBox).not.toBeNull();
    expect(controlBox!.x).toBeGreaterThanOrEqual(0);
    expect(controlBox!.x + controlBox!.width).toBeLessThanOrEqual(viewport.width);
    if (viewport.width < 640) {
      await expect(control).toBeInViewport();
      expect(controlBox!.y).toBeGreaterThanOrEqual(0);
      expect(controlBox!.y + controlBox!.height).toBeLessThanOrEqual(contentBottom);
      expect(controlBox!.height).toBeGreaterThanOrEqual(44);
      expect(controlBox!.width).toBeGreaterThanOrEqual(44);
    } else if (requireTabletTargets && viewport.width < 900 && await control.evaluate((element) => element.matches("button"))) {
      expect(controlBox!.height).toBeGreaterThanOrEqual(40);
    }
  }
}
