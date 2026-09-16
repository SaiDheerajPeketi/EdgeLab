import { expect, test, type Page, type Route } from "@playwright/test";
import { expectStableScreenshot, gotoStable, installDeterminism, seedApprovedSession, seedChartLayout } from "./support/app";

test.describe("live route tail states", () => {
  test("empty data names the outcome and keeps recovery controls available", async ({ page }) => {
    await prepare(page);
    await routeKlines(page, (route) => route.fulfill({ body: "[]", contentType: "application/json", status: 200 }));
    await gotoStable(page, "/app/live", { waitForNetworkIdle: false });

    const empty = page.getByRole("status", { name: "Live chart empty state" });
    await expect(empty).toContainText("No live chart data");
    await expect(page.getByRole("button", { name: "Create watchlist" })).toBeVisible();
    await expect(page.getByRole("region", { name: /BTC.*chart/i }).first()).toBeVisible();
    expect(await page.locator("#workspace-content").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await expectStableScreenshot(page, "live-empty", { fullPage: false });
  });

  test("pending data exposes a reduced-motion skeleton without false emptiness", async ({ page }) => {
    await installDeterminism(page, { liveFeedState: "connecting" });
    await seedApprovedSession(page);
    await seedChartLayout(page, "single");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await routeKlines(page, async (route) => {
      await gate;
      await route.fulfill({ body: "[]", contentType: "application/json", status: 200 });
    });
    await gotoStable(page, "/app/live", { waitForNetworkIdle: false });

    const skeleton = page.getByRole("status", { name: "Live chart skeleton" });
    await expect(skeleton).toContainText("Loading live chart data");
    await expect(page.getByRole("status", { name: "Live chart empty state" })).toHaveCount(0);
    await expect(page.getByText("Connecting", { exact: true }).first()).toBeVisible();
    await expectStableScreenshot(page, "live-skeleton", { fullPage: false });
    release();
  });
});

async function prepare(page: Page) {
  await installDeterminism(page);
  await seedApprovedSession(page);
  await seedChartLayout(page, "single");
}

async function routeKlines(page: Page, handler: (route: Route) => Promise<unknown>) {
  for (const host of ["api.binance.com", "data-api.binance.vision"]) {
    await page.route(`https://${host}/**/klines**`, handler);
  }
}
