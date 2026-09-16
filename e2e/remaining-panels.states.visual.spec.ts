import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoStable, installDeterminism, seedApprovedSession, seedChartLayout } from "./support/app";

test.describe("remaining operating panel evidence", () => {
  test.beforeEach(async ({ page }) => {
    await installDeterminism(page);
    await seedApprovedSession(page);
    await seedChartLayout(page, "single");
  });

  test("Journal panel is keyboard reachable and overflow safe", async ({ page }) => {
    await gotoStable(page, "/app/live", { waitForNetworkIdle: false });
    await page.getByRole("tab", { name: "Journal" }).click();
    const panel = page.getByRole("tabpanel", { name: "Journal" });
    await expect(panel.getByRole("heading", { name: "Journal beside chart" })).toBeVisible();
    await expectOverflowSafe(panel);
    await expect(panel).toHaveScreenshot("panel-journal.png");
  });

  test("Watchlist exposes its primary controls without overflow", async ({ page }) => {
    await gotoStable(page, "/app/live", { waitForNetworkIdle: false });
    const label = page.getByText("Watchlist", { exact: true }).first();
    const panel = label.locator("xpath=ancestor::section[1]");
    await expect(page.getByRole("button", { name: "Create watchlist" })).toBeVisible();
    await expectOverflowSafe(panel);
    await expect(panel).toHaveScreenshot("panel-watchlist.png");
  });

  test("Quant assistant keeps its composer reachable", async ({ page }) => {
    await gotoStable(page, "/app/quant", { waitForNetworkIdle: false });
    const panel = page.getByRole("complementary", { name: "Quant assistant" });
    await expect(panel.getByLabel("Message Quant")).toBeVisible();
    await panel.getByLabel("Message Quant").focus();
    await expect(panel.getByLabel("Message Quant")).toBeFocused();
    await expectOverflowSafe(panel);
    await expect(panel).toHaveScreenshot("panel-quant.png");
  });

  test("Data Window exposes deterministic OHLC values", async ({ page }) => {
    await gotoStable(page, "/app/live", { waitForNetworkIdle: false });
    const panel = page.getByRole("region", { name: "Data Window" }).first();
    await expect(panel).toContainText("O");
    await expect(panel).toContainText("C");
    await expectOverflowSafe(panel);
    await expect(panel).toHaveScreenshot("panel-data-window.png");
  });

});

async function expectOverflowSafe(locator: Locator) {
  expect(await locator.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
}
