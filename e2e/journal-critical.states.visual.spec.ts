import { expect, test } from "@playwright/test";
import {
  expectStableScreenshot,
  gotoStable,
  installDeterminism,
  seedApprovedSession,
} from "./support/app";

test.describe("Journal critical-state visual baselines", () => {
  test.beforeEach(async ({ page }) => {
    await installDeterminism(page);
    await seedApprovedSession(page);
  });

  test("empty Journal onboarding baseline", async ({ page }) => {
    await page.route("**/api/journal/accounts**", (route) => route.fulfill({
      body: "[]",
      contentType: "application/json",
      status: 200,
    }));
    await page.route("**/api/journal/trades**", (route) => route.fulfill({
      body: "[]",
      contentType: "application/json",
      status: 200,
    }));

    await gotoStable(page, "/app/journal/dashboard", { waitForNetworkIdle: false });
    const onboarding = page.locator(".ui-critical-state:visible").filter({ hasText: "Build your relational Journal" });
    await expect(onboarding).toBeVisible();
    await expect(onboarding.getByRole("button", { name: "Create or connect account" })).toBeVisible();
    const geometry = await onboarding.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, viewport: window.innerWidth, scrollWidth: document.documentElement.scrollWidth };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 1);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewport + 1);
    await expectStableScreenshot(page, "journal-empty-onboarding", { fullPage: false });
  });

  test("filtered empty trade log baseline", async ({ page }, testInfo) => {
    await gotoStable(page, "/app/journal/trades", { waitForNetworkIdle: false });
    await page.getByLabel("Search symbol, strategy, tag, or note").fill("NO-SUCH-TRADE-2026");
    const emptyState = page.getByText("No matching trades", { exact: true });
    await expect(emptyState).toBeVisible();
    await expect(page.getByText("Showing 0 of 0 filtered trades", { exact: false })).toBeVisible();
    if (testInfo.project.name === "mobile") {
      await emptyState.scrollIntoViewIfNeeded();
      await expect(emptyState).toBeInViewport();
    }
    await expectStableScreenshot(page, "journal-filtered-empty", { fullPage: false });
  });

  test("trade review drawer baseline", async ({ page }) => {
    await gotoStable(page, "/app/journal/trades", { waitForNetworkIdle: false });
    await page.getByRole("table", { name: "Journal trades" }).getByRole("button", { name: "BTCUSDT", exact: true }).first().click({ force: true });
    const drawer = page.locator("[data-journal-review-drawer]");
    await expect(drawer).toBeVisible();
    await expect(page.getByRole("heading", { name: "Review BTCUSDT" })).toBeVisible();
    const geometry = await drawer.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const controls = [...element.querySelectorAll<HTMLElement>("button, input, select, textarea")]
        .map((control) => control.getBoundingClientRect())
        .filter((control) => control.width > 0 && control.height > 0);
      return {
        controlLeft: Math.min(...controls.map((control) => control.left)),
        controlRight: Math.max(...controls.map((control) => control.right)),
        drawerLeft: box.left,
        drawerRight: box.right,
        drawerScrollWidth: element.scrollWidth,
        drawerWidth: element.clientWidth,
        pageScrollWidth: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
      };
    });
    expect(geometry.drawerLeft).toBeGreaterThanOrEqual(0);
    expect(geometry.drawerRight).toBeLessThanOrEqual(geometry.viewport + 1);
    expect(geometry.drawerScrollWidth).toBeLessThanOrEqual(geometry.drawerWidth + 1);
    expect(geometry.pageScrollWidth).toBeLessThanOrEqual(geometry.viewport + 1);
    expect(geometry.controlLeft).toBeGreaterThanOrEqual(geometry.drawerLeft - 1);
    expect(geometry.controlRight).toBeLessThanOrEqual(geometry.drawerRight + 1);
    await expectStableScreenshot(page, "journal-review-drawer", { fullPage: false });
  });
});
