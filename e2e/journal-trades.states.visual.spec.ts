import { expect, test, type Locator, type Page } from "@playwright/test";
import { buildJournalTradeFixtures, expectCertifiedScreenshot, gotoStable, installDeterminism, seedApprovedSession } from "./support/app";

const route = "/app/journal/trades";

test.describe("journal trades missing state baselines", () => {
  test.beforeEach(async ({ page }) => {
    await installDeterminism(page);
    await seedApprovedSession(page);
  });

  test("loading state is announced and contained", async ({ page }) => {
    await page.route("**/api/journal/accounts**", () => new Promise(() => {}));
    await gotoStable(page, route, { waitForNetworkIdle: false });

    const loading = page.getByRole("status", { name: "Loading Journal" });
    await expect(loading).toHaveAttribute("aria-label", "Loading Journal");
    await revealAndExpectRouteGeometry(page, loading);
    await expectStateScreenshot(page, "journal-trades-loading");
  });

  test("empty trade log explains the next available actions", async ({ page }) => {
    await page.route("**/api/journal/trades**", (request) => request.fulfill({ json: [] }));
    await openTrades(page);

    const empty = page.getByRole("heading", { name: "No matching trades" });
    await expect(empty).toBeVisible();
    await expect(page.getByText("Clear filters or add a manual, imported, broker, or backtest trade.")).toBeVisible();
    await revealAndExpectRouteGeometry(page, empty);
    await expectStateScreenshot(page, "journal-trades-empty");
  });

  test("add trade flow exposes an accessible first step", async ({ page }) => {
    await openTrades(page);
    const trigger = page.getByRole("button", { name: "Add trade" });
    await trigger.focus();
    await trigger.press("Enter");

    const flow = page.getByRole("region", { name: "Add trade" });
    await expect(flow.getByText("Step 1 of 3 · Destination")).toBeVisible();
    await expect(flow.getByLabel("Account")).toBeVisible();
    await expect(flow.getByRole("button", { name: "Close add trade flow" })).toBeVisible();
    const continueButton = flow.getByRole("button", { name: "Continue" });
    await expect(continueButton).toBeEnabled();
    await expect(flow.getByRole("alert")).toHaveCount(0);
    await revealAndExpectRouteGeometry(page, flow.getByRole("heading", { name: "Add trade" }));
    await expectStateScreenshot(page, "journal-trades-add-trade");

    await continueButton.click();
    const validation = flow.getByRole("alert");
    await expect(validation).toHaveText("Choose an account and provide a symbol, currency, and source time zone.");
    await expect(flow.getByText("Step 1 of 3 · Destination")).toBeVisible();
  });

  test("import shortcut opens the staged CSV flow", async ({ page }) => {
    await openTrades(page);
    const shortcut = page.getByRole("button", { name: "Import CSV" });
    await shortcut.focus();
    await shortcut.press("Enter");

    const imports = page.getByRole("region", { name: "CSV imports" });
    await expect(imports).toBeVisible();
    const trigger = imports.getByRole("button", { name: "Import CSV" });
    await trigger.focus();
    await trigger.press("Enter");
    await expect(imports.getByText("Step 1 of 4 · Choose export")).toBeVisible();
    await expect(imports.getByRole("button", { name: "Choose CSV export" })).toBeVisible();
    await revealAndExpectRouteGeometry(page, imports.getByRole("heading", { name: "CSV imports" }));
    await expectStateScreenshot(page, "journal-trades-import");
  });

  test("transport error explains retry and recovers", async ({ page }) => {
    let failAccounts = true;
    await page.route("**/api/journal/accounts**", async (request) => {
      if (failAccounts) {
        failAccounts = false;
        await request.fulfill({
          json: { detail: "Journal is temporarily unavailable. Your trades were not changed; retry when the service recovers." },
          status: 503,
        });
        return;
      }
      await request.fallback();
    });
    await gotoStable(page, route, { waitForNetworkIdle: false });

    const error = page.getByRole("alert").filter({ hasText: "Journal could not update" });
    await expect(error).toContainText("temporarily unavailable");
    await expect(error.getByRole("button", { name: "Retry" })).toBeVisible();
    await revealAndExpectRouteGeometry(page, error);
    await expectStateScreenshot(page, "journal-trades-error");
    await error.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByRole("heading", { name: "Trades" })).toBeVisible();
    await expect(error).toHaveCount(0);
  });

  test("large trade histories keep a bounded 100-row DOM window", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "The long-list runtime budget uses one stable desktop profile.");
    await page.route("**/api/journal/trades**", (route) => {
      const url = new URL(route.request().url());
      const before = Number(url.searchParams.get("before_id") ?? Infinity);
      const limit = Number(url.searchParams.get("limit") ?? 500);
      const trades = buildJournalTradeFixtures(350);
      return route.fulfill({ json: url.searchParams.get("order") === "id"
        ? trades.filter((trade) => trade.id < before).sort((a, b) => b.id - a.id).slice(0, limit) : trades });
    });
    await openTrades(page);
    const table = page.getByRole("table", { name: "Journal trades" });
    await expect(table.getByRole("row")).toHaveCount(101);
    await expect(page.getByText("Showing 1–100 of 350 filtered trades")).toBeVisible();
    const durations: number[] = [];
    for (let iteration = 0; iteration < 5; iteration += 1) {
      const label = iteration % 2 === 0 ? "Next 100" : "Previous 100";
      durations.push(await page.getByRole("button", { name: label }).evaluate(async (button: HTMLButtonElement) => {
        const startedAt = performance.now();
        button.click();
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        return performance.now() - startedAt;
      }));
      await expect(table.getByRole("row")).toHaveCount(101);
    }
    const p95 = [...durations].sort((left, right) => left - right)[Math.ceil(durations.length * 0.95) - 1] ?? Infinity;
    expect(p95).toBeLessThanOrEqual(200);
  });
});

async function openTrades(page: Page) {
  await gotoStable(page, route, { waitForNetworkIdle: false });
  await expect(page.getByRole("heading", { name: "Trades", exact: true })).toBeVisible();
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
  const fixedBottomBoundary = await getFixedBottomBoundary(page, viewport!.height);
  expect(box!.y + box!.height).toBeLessThanOrEqual(fixedBottomBoundary - 8);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function getFixedBottomBoundary(page: Page, viewportHeight: number) {
  let boundary = viewportHeight;
  for (const obstacle of [
    page.getByRole("navigation", { name: "Primary workspace" }),
    page.getByRole("button", { name: "Open command palette" }),
  ]) {
    if (!(await obstacle.isVisible())) continue;
    const box = await obstacle.boundingBox();
    if (box && box.y > viewportHeight / 2) boundary = Math.min(boundary, box.y);
  }
  return boundary;
}

async function expectStateScreenshot(page: Page, name: string) {
  await expectCertifiedScreenshot(page, page, `${name}.png`, {
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    maxDiffPixelRatio: 0.0001,
    threshold: 0.05,
  });
}
