import { expect, test, type Page, type Route } from "@playwright/test";
import {
  expectCertifiedScreenshot,
  expectStableScreenshot,
  gotoStable,
  installDeterminism,
  seedApprovedSession,
  seedChartLayout,
} from "./support/app";

const states = [
  { fixture: "connecting", state: "loading", title: "Connecting live feed" },
  { fixture: "delayed", state: "partial", title: "Market data is delayed" },
  { fixture: "stale", state: "stale", title: "Market data is stale" },
  { fixture: "offline", state: "offline", title: "Live feed offline" },
  { fixture: "unsupported", state: "unsupported", title: "Instrument not supported" },
] as const;

test.describe("live feed health states", () => {
  for (const state of states) {
    test(`${state.fixture} keeps chart context and names the safe next step`, async ({ page }) => {
      await installDeterminism(page, { liveFeedState: state.fixture });
      await seedApprovedSession(page);
      await seedChartLayout(page, "single");
      await gotoStable(page, "/app/live", { waitForNetworkIdle: false });

      const health = page.locator(`[data-state="${state.state}"]`).filter({ hasText: state.title });
      await expect(health).toBeVisible();
      await expect(page.getByRole("region", { name: /BTC.*chart/i }).first()).toBeVisible();
      if (state.fixture === "connecting") {
        await expect(health.getByRole("button")).toHaveCount(0);
      } else {
        const actionName = state.fixture === "unsupported" ? "Choose provider" : state.fixture === "stale" || state.fixture === "delayed" ? "Reconnect" : "Try again";
        await expect(health.getByRole("button", { name: actionName })).toBeVisible();
      }
      const expectedStatus = state.fixture === "stale" ? "Feed stale" : state.fixture === "delayed" ? "Feed delayed" : state.fixture === "unsupported" ? "Unsupported" : state.fixture === "offline" ? "Feed offline" : "Connecting";
      await expect(page.getByText(expectedStatus, { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Streaming", { exact: true })).toHaveCount(0);
      if (state.fixture === "unsupported") {
        await health.getByRole("button", { name: "Choose provider" }).click();
        await expect(page).toHaveURL(/\/app\/settings\/data-providers#settings\/data-providers\/broker-connections$/);
        await page.goBack();
        await expect(health).toBeVisible();
      }
      await expectStableScreenshot(page, `live-${state.fixture}`, { fullPage: false });
    });
  }
});

test.describe("live financial data panels", () => {
  test.beforeEach(async ({ page }) => {
    await installDeterminism(page);
    await seedApprovedSession(page);
    await seedChartLayout(page, "single");
  });

  test("order book exposes deterministic depth and keyboard resize", async ({ page }, testInfo) => {
    await seedPanel(page, "order-book");
    await mockMarketPanels(page);
    await gotoStable(page, "/app/live", { waitForNetworkIdle: false });

    const panel = page.getByRole("tabpanel", { name: "Order book" });
    await expect(panel.getByRole("heading", { name: /Order Book · BTCUSDT/ })).toBeVisible();
    await expect(panel.getByText("68,124.5")).toBeVisible();
    const resize = page.getByRole("separator", { name: "Resize Chart tools" });
    if (testInfo.project.name === "desktop" || testInfo.project.name === "tradingDesktop") {
      await resize.focus();
      await resize.press("ArrowLeft");
      await expect(resize).toHaveAttribute("aria-valuenow", "384");
    } else {
      await expect(resize).toBeHidden();
    }
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await expectCertifiedScreenshot(page, panel, "order-book.png");
  });

  test("alerts supports validation and remains overflow-safe", async ({ page }) => {
    await seedPanel(page, "alerts");
    await mockMarketPanels(page);
    await gotoStable(page, "/app/live", { waitForNetworkIdle: false });

    const panel = page.getByRole("tabpanel", { name: "Alerts" });
    await expect(panel.getByRole("heading", { name: /Alerts · BTCUSDT/ })).toBeVisible();
    await panel.getByRole("button", { name: "Create alert" }).click();
    await expect(panel.getByRole("alert")).toContainText("Name the alert");
    await expect(panel.getByRole("button", { name: "Sound off" })).toHaveAttribute("aria-pressed", "false");
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await expectCertifiedScreenshot(page, panel, "alerts.png");
  });
});

async function seedPanel(page: Page, activePanel: "order-book" | "alerts") {
  const preference = { activePanel, collapsed: false, dock: "right", mode: "compact", width: 360 };
  await page.addInitScript(({ value }) => {
    window.localStorage.setItem("edgelab.journal-panel-layout.v1.user-7001", JSON.stringify(value));
  }, { value: preference });
  await page.route("**/api/app-storage/journal-panel-layout.v1", (route) => json(route, { namespace: "edgelab", key: "journal-panel-layout.v1", value: preference, updated_at: "2026-09-15T10:30:00.000Z" }));
}

async function mockMarketPanels(page: Page) {
  const instrument = { id: 17, canonical_symbol: "BTCUSDT", display_name: "Bitcoin / Tether", asset_class: "CRYPTO", instrument_type: "SPOT", exchange: "BINANCE", currency: "USDT", timezone: "UTC", tick_size: "0.1", active: true, identifiers: [] };
  await page.route("**/api/market-data/instruments**", (route) => json(route, [instrument]));
  await page.route("**/api/market-data/instruments/resolve**", (route) => json(route, instrument));
  await page.route("**/api/market-data/instruments/17/order-book**", (route) => json(route, {
    aggregation_tick_size: 1, captured_at: "2026-09-15T10:30:00.000Z", instrument_id: 17, message: null, provider: "binance", status: "AVAILABLE",
    levels: [
      { order_count: 4, price: "68125.0", side: "ASK", size: "2.4" },
      { order_count: 7, price: "68124.5", side: "BID", size: "3.8" },
    ],
  }));
  await page.route("**/api/market-data/alerts**", (route) => json(route, []));
  await page.route("**/api/market-data/alert-events**", (route) => json(route, []));
}

function json(route: Route, value: unknown) {
  return route.fulfill({ body: JSON.stringify(value), contentType: "application/json", status: 200 });
}
