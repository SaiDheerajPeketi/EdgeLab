import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoStable, installDeterminism, seedApprovedSession } from "./support/app";

const route = "/app/reports";
const trade = {
  id: 7301, session_id: 4101, status: "CLOSED", side: "LONG",
  entry_time: "2026-09-15T09:05:00.000Z", entry_offset: 13, entry_price: 67920.25,
  quantity: 2, remaining_quantity: 0, stop_loss: 67840, take_profit: 68120,
  exit_time: "2026-09-15T09:42:00.000Z", exit_offset: 20, exit_price: 68118.5,
  gross_pnl: 396.5, realized_pnl: 384.75, r_multiple: 2.35,
  commission_mode: "FIXED", commission_value: 2.5, commission_amount: 5,
  fee_mode: "FIXED", fee_value: 3.375, fee_amount: 6.75,
  strategy_name: "Opening range", playbook_id: 31,
  notes: "Held the retest and followed the planned exit.", mistake_tags: ["patient"],
  emotional_state: "Focused", screenshot_url: null,
};

test.describe("standalone reports state baselines", () => {
  test.beforeEach(async ({ page }) => {
    await installDeterminism(page);
    await seedApprovedSession(page);
  });

  test("report data loading state is announced", async ({ page }) => {
    await page.unroute("**/api/**");
    await page.route("**/api/trades/page**", () => new Promise(() => {}));
    await gotoStable(page, route, { waitForNetworkIdle: false });

    const loading = page.getByRole("status", { name: "Loading report data" });
    await expect(loading).toBeVisible();
    await revealAndExpectRouteGeometry(page, loading);
    await expectStateScreenshot(page, "reports-loading");
  });

  test("empty state explains how reports become populated", async ({ page }) => {
    await installTrades(page, []);
    await openReports(page);

    const empty = page.getByRole("status").filter({ hasText: "No closed backtest trades yet" });
    await expect(empty).toContainText("Complete and close a replay trade");
    await revealAndExpectRouteGeometry(page, empty);
    await expectStateScreenshot(page, "reports-empty");
  });

  test("applied search filter is visible and reversible", async ({ page }) => {
    await installTrades(page, [trade]);
    await openReports(page);
    await page.getByRole("button", { name: "Filters" }).click();
    await page.getByLabel("Search").fill("no-match-symbol");
    await page.getByRole("button", { name: "Apply filters" }).click();

    const empty = page.getByRole("status").filter({ hasText: "No trades match these filters" });
    await expect(empty).toContainText("see all 1 closed trades");
    await expect(empty.getByRole("button", { name: "Reset filters" })).toBeVisible();
    const count = page.getByText("0/1 trades", { exact: true });
    await expect(count).toBeVisible();
    await expect(page.getByRole("button", { name: "Reset", exact: true })).toBeVisible();
    await revealAndExpectRouteGeometry(page, count);
    await expectStateScreenshot(page, "reports-filtered");
  });

  test("report trade opens the inspectable detail drawer", async ({ page }) => {
    await installTrades(page, [trade]);
    await openReports(page);
    await page.getByRole("button", { name: "Trades", exact: true }).click();
    await page.getByRole("button", { name: "Inspect trade #7301" }).click();

    const drawer = page.getByRole("dialog", { name: "Trade 7301 details" });
    await expect(drawer.getByRole("heading", { name: "Trade #7301" })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Close trade details" })).toBeVisible();
    await revealAndExpectRouteGeometry(page, drawer.getByRole("heading", { name: "Trade #7301" }));
    await expectStateScreenshot(page, "reports-selected-trade");
  });
});

async function installTrades(page: Page, items: unknown[]) {
  await page.unroute("**/api/**");
  await page.route("**/api/trades/page**", (request) => request.fulfill({
    json: { items, offset: 0, limit: 200, next_offset: items.length, next_cursor: null, has_more: false },
  }));
}

async function openReports(page: Page) {
  await gotoStable(page, route, { waitForNetworkIdle: false });
  await expect(page.getByRole("heading", { name: "Backtest Performance Reports" })).toBeVisible();
}

async function revealAndExpectRouteGeometry(page: Page, subject: Locator) {
  await subject.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
  const box = await subject.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  const boundary = await fixedBottomBoundary(page, viewport!.height);
  expect(box!.y + box!.height).toBeLessThanOrEqual(boundary - 8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}

async function fixedBottomBoundary(page: Page, viewportHeight: number) {
  let boundary = viewportHeight;
  for (const obstacle of [page.getByRole("navigation", { name: "Primary workspace" }), page.getByRole("button", { name: "Open command palette" })]) {
    if (!(await obstacle.isVisible())) continue;
    const box = await obstacle.boundingBox();
    if (box && box.y > viewportHeight / 2) boundary = Math.min(boundary, box.y);
  }
  return boundary;
}

async function expectStateScreenshot(page: Page, name: string) {
  await expect(page).toHaveScreenshot(`${name}.png`, { animations: "disabled", caret: "hide", fullPage: false, maxDiffPixelRatio: 0.0001, threshold: 0.05 });
}
