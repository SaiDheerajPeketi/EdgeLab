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
    await expect(page.getByText("Build your relational Journal", { exact: true }).first()).toBeAttached();
    await expect(page.getByRole("button", { name: "Create or connect account" }).first()).toBeAttached();
    await expectStableScreenshot(page, "journal-empty-onboarding", { fullPage: false });
  });

  test("filtered empty trade log baseline", async ({ page }) => {
    await gotoStable(page, "/app/journal/trades", { waitForNetworkIdle: false });
    await page.getByLabel("Search symbol, strategy, tag, or note").fill("NO-SUCH-TRADE-2026");
    await expect(page.getByText("No matching trades", { exact: true })).toBeVisible();
    await expect(page.getByText("Showing 0 of 0 filtered trades", { exact: false })).toBeVisible();
    await expectStableScreenshot(page, "journal-filtered-empty", { fullPage: false });
  });

  test("trade review drawer baseline", async ({ page }) => {
    await gotoStable(page, "/app/journal/trades", { waitForNetworkIdle: false });
    await page.getByRole("table", { name: "Journal trades" }).getByRole("button", { name: "BTCUSDT", exact: true }).first().click({ force: true });
    await expect(page.locator("[data-journal-review-drawer]")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Review BTCUSDT" })).toBeVisible();
    await expectStableScreenshot(page, "journal-review-drawer", { fullPage: false });
  });
});
