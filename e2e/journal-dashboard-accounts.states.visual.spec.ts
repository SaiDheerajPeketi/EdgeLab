import { expect, test, type Page } from "@playwright/test";
import { expectStableScreenshot, gotoStable, installDeterminism, seedApprovedSession } from "./support/app";

const account = {
  id: 81, broker_account_id: null, source_type: "MANUAL", source_key: "visual-primary",
  name: "Primary Futures — Frankfurt Desk", provider: "EdgeLab", currency: "USD",
  timezone: "Europe/Berlin", initial_balance: "25000", color: "#22d3ee",
  notes: "Deterministic visual fixture", status: "ACTIVE",
  created_at: "2026-09-15T10:30:00.000Z", updated_at: "2026-09-15T10:30:00.000Z",
};
const euroAccount = { ...account, id: 82, source_key: "visual-euro", name: "DAX Swing — München", currency: "EUR", initial_balance: "18000", color: "#60a5fa" };

async function jsonRoute(page: Page, pattern: string, body: unknown, status = 200) {
  await page.route(pattern, (route) => route.fulfill({ body: JSON.stringify(body), contentType: "application/json", status }));
}

async function expectViewportSafe(page: Page) {
  const geometry = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewport + 1);
}

test.describe("Journal dashboard and account critical states", () => {
  test.beforeEach(async ({ page }) => {
    await installDeterminism(page);
    await seedApprovedSession(page);
  });

  test("dashboard partial state", async ({ page }, testInfo) => {
    await jsonRoute(page, "**/api/journal/accounts**", [account]);
    await jsonRoute(page, "**/api/journal/trades**", []);
    await gotoStable(page, "/app/journal/dashboard", { waitForNetworkIdle: false });
    await expect(page.getByRole("heading", { name: "Trading overview" })).toBeVisible();
    const partialMessage = page.getByText("Close trades to build the equity curve.");
    await expect(partialMessage).toBeVisible();
    if (testInfo.project.name !== "desktop") {
      await partialMessage.scrollIntoViewIfNeeded();
      await partialMessage.evaluate((element) => {
        const navigation = document.querySelector<HTMLElement>('[aria-label="Primary workspace"]');
        const navigationTop = navigation?.getBoundingClientRect().top ?? window.innerHeight;
        const overlap = element.getBoundingClientRect().bottom - navigationTop + 16;
        if (overlap > 0) window.scrollBy(0, overlap);
      });
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
      const clearance = await partialMessage.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const navigation = document.querySelector<HTMLElement>('[aria-label="Primary workspace"]');
        const navigationTop = navigation?.getBoundingClientRect().top ?? window.innerHeight;
        return { bottom: box.bottom, navigationTop, top: box.top };
      });
      expect(clearance.top).toBeGreaterThanOrEqual(0);
      expect(clearance.bottom).toBeLessThanOrEqual(clearance.navigationTop - 8);
    }
    await expectViewportSafe(page);
    await expectStableScreenshot(page, "journal-dashboard-partial", { fullPage: false });
  });

  test("dashboard mixed-currency state", async ({ page }) => {
    await jsonRoute(page, "**/api/journal/accounts**", [account, euroAccount]);
    await jsonRoute(page, "**/api/journal/trades**", []);
    await gotoStable(page, "/app/journal/dashboard", { waitForNetworkIdle: false });
    await expect(page.getByText(/Totals are separated because this scope includes/)).toContainText("USD, EUR");
    await expect(page.getByText("Choose accounts with the same currency to compare one continuous curve.")).toBeVisible();
    await expectViewportSafe(page);
    await expectStableScreenshot(page, "journal-dashboard-mixed-currency", { fullPage: false });
  });

  test("dashboard transport error state", async ({ page }) => {
    await jsonRoute(page, "**/api/journal/accounts**", { detail: "Journal accounts unavailable" }, 503);
    await gotoStable(page, "/app/journal/dashboard", { waitForNetworkIdle: false });
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Journal accounts unavailable");
    await expect(alert.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(page.getByText("Build your relational Journal", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create or connect account" })).toHaveCount(0);
    await expectViewportSafe(page);
    await expectStableScreenshot(page, "journal-dashboard-error", { fullPage: false });
  });

  test("accounts empty state", async ({ page }) => {
    await jsonRoute(page, "**/api/journal/accounts**", []);
    await jsonRoute(page, "**/api/journal/trades**", []);
    await gotoStable(page, "/app/journal/accounts", { waitForNetworkIdle: false });
    await expect(page.getByText("Build your relational Journal", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create or connect account" })).toBeVisible();
    await expectViewportSafe(page);
    await expectStableScreenshot(page, "journal-accounts-empty", { fullPage: false });
  });

});
