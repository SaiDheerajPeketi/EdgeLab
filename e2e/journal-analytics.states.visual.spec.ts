import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  FROZEN_TIME,
  expectStableScreenshot,
  gotoStable,
  installDeterminism,
  seedApprovedSession,
} from "./support/app";

const route = "/app/journal/analytics";

const usdAccount = {
  id: 81,
  broker_account_id: null,
  source_type: "MANUAL",
  source_key: "analytics-usd",
  name: "Primary Futures — Frankfurt Desk",
  provider: "EdgeLab",
  currency: "USD",
  timezone: "Europe/Berlin",
  initial_balance: "25000",
  color: "#22d3ee",
  notes: "Deterministic analytics fixture",
  status: "ACTIVE",
  created_at: FROZEN_TIME,
  updated_at: FROZEN_TIME,
};

const eurAccount = {
  ...usdAccount,
  id: 82,
  source_key: "analytics-eur",
  name: "DAX Swing — München",
  currency: "EUR",
  initial_balance: "18000",
  color: "#a78bfa",
};

const setupTag = {
  id: 91,
  category: "SETUP",
  name: "Opening range retest",
  color: "#22d3ee",
  archived_at: null,
  created_at: FROZEN_TIME,
};

const baseTrade = {
  account_id: 81,
  import_run_id: null,
  source_type: "MANUAL",
  entry_type: "TAKEN",
  status: "CLOSED",
  source_symbol: null,
  currency: "USD",
  source_timezone: "Europe/Berlin",
  side: "LONG",
  exit_time: "2026-09-15T09:42:00Z",
  entry_price: "67920.25",
  exit_price: "68118.50",
  quantity: "2",
  remaining_quantity: "0",
  gross_pnl: "396.50",
  net_pnl: "384.75",
  commission: "5",
  fees: "6.75",
  stop_loss: "67840",
  take_profit: "68120",
  planned_entry_price: "67900",
  planned_exit_price: "68120",
  planned_stop_loss: "67830",
  planned_take_profit: "68120",
  r_multiple: "2.35",
  strategy_name: "Opening range",
  emotional_state: "Patient",
  missed_reason: null,
  rating: 5,
  setup_grade: "A",
  reviewed: true,
  reviewed_at: FROZEN_TIME,
  created_at: FROZEN_TIME,
  updated_at: FROZEN_TIME,
  tags: [setupTag],
  notes: [],
  screenshots: [],
  executions: [],
};

function trade(id: number, overrides: Record<string, unknown>) {
  return {
    ...baseTrade,
    id,
    source_ref: `analytics-${id}`,
    duplicate_key: `analytics-${id}`,
    entry_time: `2026-09-15T${String(8 + id - 101).padStart(2, "0")}:05:00Z`,
    symbol: "BTCUSDT",
    ...overrides,
  };
}

const populatedTrades = [
  trade(101, { symbol: "BTCUSDT" }),
  trade(102, { symbol: "ETHUSDT", side: "SHORT", gross_pnl: "-52", net_pnl: "-60", r_multiple: "-0.7", strategy_name: "Failed breakout", reviewed: false, reviewed_at: null }),
  trade(103, { symbol: "MES", entry_price: "6450", exit_price: "6462", gross_pnl: "48", net_pnl: "44", quantity: "1", strategy_name: "Support reclaim" }),
  trade(104, { symbol: "AAPL", entry_price: "224", exit_price: "223", gross_pnl: "-100", net_pnl: "-104", quantity: "100", strategy_name: "VWAP rejection", setup_grade: "B" }),
  trade(105, { symbol: "EURUSD", entry_price: "1.108", exit_price: "1.111", gross_pnl: "150", net_pnl: "144", quantity: "50000", strategy_name: "London continuation", rating: 4 }),
];

test.describe("Journal analytics critical states", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await installDeterminism(page);
    await seedApprovedSession(page);
  });

  test("empty analytics state explains what is missing", async ({ page }) => {
    await openAnalytics(page, [usdAccount], []);

    const empty = page.locator(".ui-critical-state").filter({ hasText: "No data for this breakdown" });
    await expect(empty).toBeVisible();
    await expect(page.getByText("Position mix appears after trades are added.")).toHaveCount(2);
    await expect(page.getByText("Strength and review rankings appear after closed trades are available.")).toBeVisible();
    await expect(page.getByRole("table", { name: "Market performance breakdown" })).toBeVisible();
    await captureState(page, "journal-analytics-empty", empty);
  });

  test("low-sample state names the uncertainty without relying on color", async ({ page }) => {
    await openAnalytics(page, [usdAccount], [populatedTrades[0]]);

    const notice = page.locator("[data-analytics-sample]");
    await expect(notice).toHaveText(/Limited sample · 1 matching trade\. Small samples can swing sharply/);
    await expect(page.getByText("1 trade sample · open exact rows").first()).toBeVisible();
    await expect(page.getByRole("img", { name: "By market across 1 segments" })).toBeVisible();
    await captureState(page, "journal-analytics-low-sample", notice);
  });

  test("selected segment identifies itself and exposes exact rows", async ({ page }) => {
    await openAnalytics(page, [usdAccount], populatedTrades);

    const segment = page.getByRole("button", { name: "Select Crypto segment" });
    await segment.focus();
    await expect(segment).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(segment).toHaveAttribute("aria-pressed", "true");
    await expect(segment).toContainText("Selected");
    const selectedContext = page.locator("[data-selected-segment]");
    await expect(selectedContext).toContainText("Selected segment");
    await expect(selectedContext).toContainText("Crypto");
    await expect(selectedContext.getByRole("button", { name: "View underlying trades" })).toBeVisible();
    await expect(page.locator("section[aria-labelledby='drilldown-heading']")).toHaveCount(0);
    await captureState(page, "journal-analytics-segment-selected", selectedContext);
  });

  test("mixed-currency state withholds misleading totals", async ({ page }) => {
    const mixedTrades = populatedTrades.map((item, index) => index < 3 ? item : {
      ...item,
      account_id: eurAccount.id,
      currency: "EUR",
      source_timezone: "Europe/Berlin",
    });
    await openAnalytics(page, [usdAccount, eurAccount], mixedTrades);

    const warning = page.locator("[data-analytics-mixed-currency]");
    await expect(warning).toHaveText(/This filter contains USD, EUR\. P&L totals are withheld because currencies cannot be combined/);
    const table = page.getByRole("table", { name: "Market performance breakdown" });
    const withheld = table.getByText("Not combined across currencies");
    expect(await withheld.count()).toBeGreaterThan(0);
    await expect(table.locator("tbody")).toContainText("—");
    await captureState(page, "journal-analytics-mixed-currency", warning);
  });
});

test.describe("Journal reports critical states", () => {
  test.beforeEach(async ({ page }) => {
    await installDeterminism(page);
    await seedApprovedSession(page);
  });

  test("empty reports state", async ({ page }) => {
    await openReports(page, [usdAccount], []);
    const empty = page.locator(".ui-critical-state").filter({ hasText: "No data for this breakdown" });
    await expect(empty).toBeVisible();
    await captureState(page, "journal-reports-empty", empty);
  });

  test("low-sample reports state", async ({ page }) => {
    await openReports(page, [usdAccount], [populatedTrades[0]]);
    const notice = page.locator("[data-analytics-sample]");
    await expect(notice).toContainText("Limited sample · 1 matching trade");
    await captureState(page, "journal-reports-low-sample", notice);
  });

  test("filtered reports state", async ({ page }) => {
    await openReports(page, [usdAccount], populatedTrades);
    await page.getByText("Analytics filters", { exact: true }).click();
    const filters = page.locator("details").filter({ hasText: "Analytics filters" });
    await filters.locator("label").filter({ hasText: /^Symbol/ }).locator("select").selectOption("ETHUSDT");
    await expect(filters).toContainText("1 active");
    await expect(page.getByText("1 matching trades · 0% reviewed")).toBeVisible();
    await captureState(page, "journal-reports-filtered", filters.locator("summary"));
  });

  test("selected segment reports state", async ({ page }) => {
    await openReports(page, [usdAccount], populatedTrades);
    const segment = page.getByRole("button", { name: "Select Crypto segment" });
    await segment.click();
    await expect(segment).toHaveAttribute("aria-pressed", "true");
    await expect(segment).toContainText("Selected");
    const selectedContext = page.locator("[data-selected-segment]");
    await expect(selectedContext).toContainText("Crypto");
    await expect(page.locator("section[aria-labelledby='drilldown-heading']")).toHaveCount(0);
    await captureState(page, "journal-reports-segment-selected", selectedContext);
  });

  test("reports drill-down state", async ({ page }) => {
    await openReports(page, [usdAccount], populatedTrades);
    await page.getByRole("button", { name: "Select Crypto segment" }).click();
    await page.getByRole("button", { name: "View underlying trades" }).click();
    const drilldown = page.locator("section[aria-labelledby='drilldown-heading']");
    await expect(drilldown).toContainText("Selected segment: Crypto");
    await expect(drilldown.getByRole("button").filter({ hasText: "BTCUSDT" })).toBeVisible();
    await expect(drilldown.getByRole("button").filter({ hasText: "ETHUSDT" })).toBeVisible();
    await captureState(page, "journal-reports-drill-down", drilldown);
  });
});

async function openAnalytics(page: Page, accounts: unknown[], trades: unknown[]) {
  await jsonRoute(page, /\/api\/journal\/accounts(?:\?.*)?$/, accounts);
  await jsonRoute(page, /\/api\/journal\/trades(?:\?.*)?$/, trades);
  await jsonRoute(page, /\/api\/journal\/tags(?:\?.*)?$/, [setupTag]);
  await gotoStable(page, route, { waitForNetworkIdle: false });
  await expect(page.getByRole("heading", { name: "Analytics", exact: true })).toBeVisible();
}

async function openReports(page: Page, accounts: unknown[], trades: unknown[]) {
  await jsonRoute(page, /\/api\/journal\/accounts(?:\?.*)?$/, accounts);
  await jsonRoute(page, /\/api\/journal\/trades(?:\?.*)?$/, trades);
  await jsonRoute(page, /\/api\/journal\/tags(?:\?.*)?$/, [setupTag]);
  await gotoStable(page, "/app/journal/reports", { waitForNetworkIdle: false });
  await expect(page.getByRole("heading", { name: "Analytics", exact: true })).toBeVisible();
}

async function jsonRoute(page: Page, pattern: RegExp, body: unknown) {
  await page.route(pattern, (request) => request.fulfill({
    body: JSON.stringify(body),
    contentType: "application/json",
    status: 200,
  }));
}

async function captureState(page: Page, name: string, target: Locator) {
  const mobile = page.viewportSize()!.width < 640;
  if (mobile) {
    const routeHeading = page.getByRole("heading", { name: "Analytics", exact: true });
    await routeHeading.evaluate((element) => element.scrollIntoView({ behavior: "auto", block: "start", inline: "nearest" }));
  } else {
    await target.evaluate((element) => element.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" }));
  }
  await page.evaluate(() => window.scrollTo({ left: 0 }));
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  if (!mobile) await expect(target).toBeInViewport();
  const viewport = page.viewportSize()!;
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  const horizontal = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    scrollX: window.scrollX,
    offenders: [...document.querySelectorAll<HTMLElement>("body *")].flatMap((element) => {
      const box = element.getBoundingClientRect();
      if (box.width <= 0 || (box.left >= -1 && box.right <= window.innerWidth + 1)) return [];
      return [{
        className: element.className,
        left: Math.round(box.left),
        right: Math.round(box.right),
        tag: element.tagName,
        text: element.textContent?.trim().slice(0, 80),
      }];
    }).slice(0, 8),
  }));
  expect(horizontal.overflow, JSON.stringify(horizontal.offenders)).toBeLessThanOrEqual(1);
  expect(horizontal.scrollX).toBe(0);

  const tableScroller = page.getByRole("table", { name: /performance breakdown/ }).locator("xpath=..");
  const tableGeometry = await tableScroller.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { clientWidth: element.clientWidth, left: box.left, right: box.right, scrollWidth: element.scrollWidth };
  });
  expect(tableGeometry.left).toBeGreaterThanOrEqual(-1);
  expect(tableGeometry.right).toBeLessThanOrEqual(viewport.width + 1);
  if (viewport.width < 1024) expect(tableGeometry.scrollWidth).toBeGreaterThan(tableGeometry.clientWidth);

  const mobileNav = page.getByRole("navigation", { name: "Primary workspace" });
  if (await mobileNav.isVisible()) {
    const navBox = await mobileNav.boundingBox();
    expect(navBox).not.toBeNull();
    expect(navBox!.x).toBeGreaterThanOrEqual(-1);
    expect(navBox!.x + navBox!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(navBox!.y).toBeGreaterThanOrEqual(-1);
    expect(navBox!.y + navBox!.height).toBeLessThanOrEqual(viewport.height + 1);
    if (box!.y < viewport.height && box!.y + box!.height > 0) expect(box!.y + box!.height).toBeLessThanOrEqual(navBox!.y);
    const navButtons = mobileNav.getByRole("button");
    expect(await navButtons.count()).toBe(6);
    const buttonBoxes = [];
    for (let index = 0; index < 6; index += 1) {
      const buttonBox = await navButtons.nth(index).boundingBox();
      expect(buttonBox).not.toBeNull();
      expect(buttonBox!.x).toBeGreaterThanOrEqual(navBox!.x - 1);
      expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(navBox!.x + navBox!.width + 1);
      buttonBoxes.push(buttonBox!);
    }
    expect(buttonBoxes[0].x).toBeLessThanOrEqual(navBox!.x + navBox!.width / 6 + 1);
    expect(buttonBoxes[5].x + buttonBoxes[5].width).toBeGreaterThanOrEqual(navBox!.x + (navBox!.width * 5) / 6 - 1);
  }
  await expectAnalyticsTouchTargets(page);
  await expectStableScreenshot(page, name, { fullPage: mobile });
}

async function expectAnalyticsTouchTargets(page: Page) {
  if (page.viewportSize()!.width >= 640) return;
  const analytics = page.locator("[data-journal-route]");
  const targets = analytics.locator([
    "[role='tab']",
    "section[aria-labelledby='asset-mix-heading'] button",
    "section[aria-labelledby='breakdown-heading'] tbody button",
    "section[aria-labelledby='weak-spots-heading'] button",
    "section[aria-labelledby='drilldown-heading'] button",
  ].join(", "));
  for (let index = 0; index < await targets.count(); index += 1) {
    const target = targets.nth(index);
    if (!(await target.isVisible())) continue;
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height, await target.getAttribute("aria-label") ?? await target.textContent() ?? "analytics control").toBeGreaterThanOrEqual(44);
    expect(box!.width, await target.getAttribute("aria-label") ?? await target.textContent() ?? "analytics control").toBeGreaterThanOrEqual(44);
  }
}
