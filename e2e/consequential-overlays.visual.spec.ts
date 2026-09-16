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
    await page.route(/\/api\/broker-providers(?:\?.*)?$/, (route) => route.fulfill({ json: [{
      provider_id: "offline-fixture", display_name: "Offline fixture", availability: "offline-fixture", requires_secret: true,
      description: "Deterministic local provider for reviewing broker workflows.",
      capabilities: { accounts: true, orders: true, fills: true, incremental_sync: true, live_connectivity: false },
    }] }));
    await page.route(/\/api\/(?:broker-connections|integration-secrets)(?:\?.*)?$/, (route) => route.fulfill({ json: [] }));
    await gotoStable(page, providersRoute, { waitForNetworkIdle: false });

    const flow = page.getByText("Create broker connection").locator(".." );
    const credential = page.getByLabel("Fixture token");
    await expect(flow).toBeVisible();
    await credential.focus();
    await expect(credential).toBeFocused();
    await credential.fill("deterministic-e2e-token");
    await expect(flow.getByRole("button", { name: "Save credential and create connection" })).toBeEnabled();
    await assertContained(page, flow);
    await expectStableScreenshot(page, "overlay-broker-connection", { fullPage: false });
  });

  test("workspace sharing dialog traps focus, survives viewport constraints, and restores focus", async ({ page }) => {
    await gotoStable(page, "/app/replay", { waitForNetworkIdle: false });
    const trigger = page.getByRole("button", { name: "Share copy" });
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "Share a workspace copy" });
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel("Snapshot name")).toBeFocused();
    await expect(dialog.getByRole("tab", { name: /Create link/ })).toHaveAttribute("aria-selected", "true");
    await assertContained(page, dialog);
    await expectStableScreenshot(page, "overlay-workspace-sharing", { fullPage: false });

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
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
}
