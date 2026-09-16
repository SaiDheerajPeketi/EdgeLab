import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectStableScreenshot, gotoStable, installDeterminism, seedApprovedSession, seedChartLayout } from "./support/app";

const providersRoute = "/app/settings/data-providers#settings/data-providers/broker-connections";

test.describe("consequential overlay evidence", () => {
  test.beforeEach(async ({ page }) => {
    await installDeterminism(page);
    await seedApprovedSession(page);
    await seedChartLayout(page, "single");
  });

  test("broker connection flow is actionable, keyboard reachable, and contained", async ({ page }) => {
    let created = false;
    let createRequests = 0;
    await page.route(/\/api\/broker-providers(?:\?.*)?$/, (route) => route.fulfill({ json: [{
      provider_id: "offline-fixture", display_name: "Offline fixture", availability: "offline-fixture", requires_secret: true,
      description: "Deterministic local provider for reviewing broker workflows.",
      capabilities: { accounts: true, orders: true, fills: true, incremental_sync: true, live_connectivity: false },
    }] }));
    await page.route(/\/api\/integration-secrets(?:\?.*)?$/, (route) => {
      if (route.request().method() === "POST") return route.fulfill({ json: secret() });
      return route.fulfill({ json: created ? [secret()] : [] });
    });
    await page.route(/\/api\/integration-secrets\/301\/connect$/, (route) => route.fulfill({ json: { ...secret(), connection_status: "credentials-ready" } }));
    await page.route(/\/api\/broker-connections(?:\?.*)?$/, (route) => {
      if (route.request().method() === "POST") { created = true; createRequests += 1; return route.fulfill({ json: connection() }); }
      return route.fulfill({ json: created ? [connection()] : [] });
    });
    await gotoStable(page, providersRoute, { waitForNetworkIdle: false });

    const flow = page.getByText("Create broker connection").locator(".." );
    const providerSelect = flow.locator("select").first();
    const connectionName = flow.locator("input").first();
    const credential = flow.locator('input[type="password"]');
    await expect(flow).toBeVisible();
    await tabUntilFocused(page, providerSelect);
    await page.keyboard.press("Tab");
    await expect(connectionName).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(credential).toBeFocused();
    await credential.fill("deterministic-e2e-token");
    const submit = flow.getByRole("button", { name: "Save credential and create connection" });
    await expect(submit).toBeEnabled();
    await assertContained(page, flow);
    await flow.evaluate((node) => node.scrollIntoView({ block: "center", inline: "nearest" }));
    await expectStableScreenshot(page, "overlay-broker-connection", { fullPage: false });
    await submit.click();
    await expect(page.getByRole("group", { name: "Offline fixture connection" })).toBeVisible();
    expect(createRequests).toBe(1);
  });

  test("workspace sharing dialog traps focus, survives viewport constraints, and restores focus", async ({ page }) => {
    await gotoStable(page, "/app/replay", { waitForNetworkIdle: false });
    let createPayload: Record<string, unknown> | null = null;
    await page.route("**/api/workspace-shares", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      createPayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ json: {
        id: 901, workspace_key: "replay", snapshot_version: 1, schema_version: 1,
        scope: "chart-plus-panels", title: "Replay workspace copy", recipient_email: null,
        payload_available: true, public_token: "deterministic-share-token",
        created_at: "2026-09-15T10:00:00Z", expires_at: "2026-09-22T10:00:00Z", revoked_at: null,
      } });
    }, { times: 1 });
    const trigger = page.getByRole("button", { name: "Share copy" });
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "Share a workspace copy" });
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel("Snapshot name")).toBeFocused();
    await expect(dialog.getByRole("tab", { name: /Create link/ })).toHaveAttribute("aria-selected", "true");
    await assertContained(page, dialog);
    await expectStableScreenshot(page, "overlay-workspace-sharing", { fullPage: false });
    await assertFocusTrap(page, dialog);

    await dialog.getByRole("button", { name: "Create secure link" }).click();
    await expect(dialog.getByText("Snapshot v1 is ready")).toBeVisible();
    await expect(dialog.getByLabel("Secure link")).toHaveValue(/deterministic-share-token/);
    expect(createPayload).toMatchObject({ workspace_key: "backtest:draft", scope: "chart-plus-panels" });

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});

async function assertContained(page: Page, subject: Locator) {
  const viewport = page.viewportSize()!;
  const box = await subject.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  if (viewport.width < 640) {
    expect(box!.y).toBeGreaterThanOrEqual(0);
    const fixedBottom = await page.getByRole("navigation", { name: "Primary workspace" }).isVisible()
      ? (await page.getByRole("navigation", { name: "Primary workspace" }).boundingBox())!.y
      : viewport.height;
    expect(box!.y + box!.height).toBeLessThanOrEqual(fixedBottom + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
}

async function tabUntilFocused(page: Page, target: Locator) {
  for (let index = 0; index < 80; index += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((node) => node === document.activeElement)) return;
  }
  expect(await target.evaluate((node) => node === document.activeElement)).toBe(true);
}

async function assertFocusTrap(page: Page, dialog: Locator) {
  const focusable = dialog.locator('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
  const count = await focusable.count();
  for (let index = 0; index <= count; index += 1) { await page.keyboard.press("Tab"); await expect(dialog.locator(":focus")).toHaveCount(1); }
  for (let index = 0; index <= count; index += 1) { await page.keyboard.press("Shift+Tab"); await expect(dialog.locator(":focus")).toHaveCount(1); }
}

function secret() { return { id: 301, provider: "offline-fixture", purpose: "broker-sync", key_id: "e2e-key", cipher_version: 1, version: 1, state: "active", created_at: "2026-09-15T10:00:00Z", updated_at: "2026-09-15T10:00:00Z", rotated_at: null, last_connected_at: "2026-09-15T10:00:00Z", revoked_at: null }; }
function connection() { return { id: 401, provider: "offline-fixture", display_name: "Offline fixture", secret_id: 301, status: "HEALTHY", health: "HEALTHY", last_error_code: null, last_error_message: null, last_sync_started_at: null, last_sync_completed_at: "2026-09-15T10:00:00Z", next_retry_at: null, created_at: "2026-09-15T10:00:00Z", updated_at: "2026-09-15T10:00:00Z", revoked_at: null }; }
