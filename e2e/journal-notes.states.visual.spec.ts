import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoStable, installDeterminism, seedApprovedSession } from "./support/app";

const route = "/app/journal/notes";

test.describe("journal notes state baselines", () => {
  test.beforeEach(async ({ page }) => {
    await installDeterminism(page);
    await seedApprovedSession(page);
  });

  test("empty library is truthful and announced", async ({ page }) => {
    await page.route("**/api/journal/daily-notes**", (request) => request.fulfill({ json: [] }));
    await page.route("**/api/journal/trades**", (request) => request.fulfill({ json: [] }));
    await openNotes(page);

    await expect(page.getByRole("status", { name: "" }).filter({ hasText: "No saved notes yet." })).toBeVisible();
    await expect(page.getByText("No trades on this date")).toBeVisible();
    await expectRouteGeometry(page, page.getByRole("complementary", { name: "Daily note library" }));
    await expectStateScreenshot(page, "journal-notes-empty");
  });

  test("search result keeps selection and context visible", async ({ page }) => {
    await openNotes(page);
    await page.getByLabel("Search notes").fill("opening range");

    const result = page.getByRole("button", { name: /Sep 15, 2026.*Primary Futures/i });
    await expect(result).toBeVisible();
    await result.click();
    await expect(result).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("status")).toHaveCount(0);
    await expectRouteGeometry(page, result);
    await expectStateScreenshot(page, "journal-notes-search-results");
  });

  test("trade review opens from the daily context", async ({ page }) => {
    await openNotes(page);
    await page.getByRole("button", { name: /^Open BTCUSDT trade,/ }).click();

    const drawer = page.locator("[data-journal-review-drawer]");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("heading", { name: "Review BTCUSDT" })).toBeVisible();
    await expectRouteGeometry(page, drawer);
    await expectStateScreenshot(page, "journal-notes-trade-note");
  });
});

async function openNotes(page: Page) {
  await gotoStable(page, route, { waitForNetworkIdle: false });
  await expect(page.getByRole("heading", { name: "Daily notes" })).toBeVisible();
  await expect(page.getByLabel("Search notes")).toBeVisible();
}

async function expectRouteGeometry(page: Page, subject: Locator) {
  const box = await subject.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function expectStateScreenshot(page: Page, name: string) {
  await expect(page).toHaveScreenshot(`${name}.png`, {
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    maxDiffPixelRatio: 0.0001,
    threshold: 0.05,
  });
}
