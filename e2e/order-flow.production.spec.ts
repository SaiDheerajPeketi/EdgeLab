import { expect, test, type Page, type Route } from "@playwright/test";
import { gotoStable, installDeterminism, seedApprovedSession } from "./support/app";

const instruments = [
  { id: 17, canonical_symbol: "ESU26", display_name: "E-mini S&P 500", asset_class: "FUTURES", instrument_type: "FUTURE", exchange: "CME", currency: "USD", timezone: "America/Chicago", tick_size: "0.25", active: true, identifiers: [{ provider: "licensed-futures", provider_symbol: "ESU26" }] },
  { id: 23, canonical_symbol: "NQU26", display_name: "E-mini Nasdaq 100", asset_class: "FUTURES", instrument_type: "FUTURE", exchange: "CME", currency: "USD", timezone: "America/Chicago", tick_size: "0.25", active: true, identifiers: [{ provider: "licensed-futures", provider_symbol: "NQU26" }] },
];

test.describe("order-flow production data path", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Production contract is browser-independent.");

  test("renders the newest authenticated persisted footprint and follows selectors", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "One desktop contract run is sufficient.");
    const requests: URL[] = [];
    await prepare(page, async (route, url) => {
      requests.push(url);
      if (url.pathname === "/api/market-data/instruments") return json(route, instruments);
      const instrumentId = Number(url.pathname.split("/")[4]);
      return json(route, [
        footprint(instrumentId, "2026-09-15T10:29:00.000Z", "222", "111"),
        footprint(instrumentId, "2026-09-15T10:24:00.000Z", "9", "8"),
      ]);
    });
    await gotoStable(page, "/app/order-flow", { waitForNetworkIdle: false });

    await expect(page.locator('[data-order-flow-source="persisted-provider-footprint"]')).toBeVisible();
    await expect(page.getByRole("cell", { name: "222" })).toBeVisible();
    await expect(page.getByText(/licensed-futures · persisted 5m aggregate · complete/i)).toBeVisible();
    await page.getByRole("combobox", { name: "Instrument" }).selectOption("23");
    await page.getByRole("combobox", { name: "Timeframe" }).selectOption("900");
    await page.getByRole("combobox", { name: "Provider" }).selectOption("licensed-futures");
    await expect.poll(() => requests.some((url) => url.pathname.endsWith("/23/footprints") && url.searchParams.get("interval_seconds") === "900" && url.searchParams.get("provider") === "licensed-futures")).toBe(true);
  });

  test("shows entitlement and missing-provider responses as actionable unavailable truth", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "One desktop contract run is sufficient.");
    await prepare(page, async (route, url) => {
      if (url.pathname === "/api/market-data/instruments") return json(route, instruments);
      return route.fulfill({ body: JSON.stringify({ detail: "Footprint entitlement required" }), contentType: "application/json", status: 403 });
    });
    await gotoStable(page, "/app/order-flow", { waitForNetworkIdle: false });
    await expect(page.getByRole("heading", { name: "Order flow is unavailable" })).toBeVisible();
    await expect(page.getByText(/entitlement required/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Configure data provider" })).toBeVisible();
    await expect(page.locator('[data-order-flow-source="e2e-deterministic-fixture"]')).toHaveCount(0);
  });

  test("Retry reissues the real footprint request and recovers", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "One desktop contract run is sufficient.");
    let attempts = 0;
    await prepare(page, async (route, url) => {
      if (url.pathname === "/api/market-data/instruments") return json(route, instruments);
      attempts += 1;
      if (attempts === 1) return route.fulfill({ body: JSON.stringify({ detail: "Provider timed out" }), contentType: "application/json", status: 503 });
      return json(route, [footprint(17, "2026-09-15T10:29:00.000Z", "300", "125")]);
    });
    await gotoStable(page, "/app/order-flow", { waitForNetworkIdle: false });
    await expect(page.getByRole("alert")).toContainText("Provider timed out");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator('[data-order-flow-source="persisted-provider-footprint"]')).toBeVisible();
    expect(attempts).toBe(2);
  });

  test("latest controls own rendering when an older provider response arrives last", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "One desktop contract run is sufficient.");
    const disjointCatalog = [
      instruments[0],
      { ...instruments[1], identifiers: [{ provider: "dxfeed", provider_symbol: "NQU26" }] },
    ];
    let releaseSlow: (() => void) | null = null;
    const slowResponse = new Promise<void>((resolve) => { releaseSlow = resolve; });
    let slowRequested = false;
    await prepare(page, async (route, url) => {
      if (url.pathname === "/api/market-data/instruments") return json(route, disjointCatalog);
      const instrumentId = Number(url.pathname.split("/")[4]);
      if (instrumentId === 17 && url.searchParams.get("provider") === "licensed-futures") {
        slowRequested = true;
        await slowResponse;
        if (route.request().isNavigationRequest()) return undefined;
        return json(route, [footprint(17, "2026-09-15T10:29:30.000Z", "999", "1")]).catch(() => undefined);
      }
      return json(route, [footprint(instrumentId, "2026-09-15T10:29:00.000Z", instrumentId === 23 ? "333" : "100", "50")]);
    });
    await gotoStable(page, "/app/order-flow", { waitForNetworkIdle: false });
    await page.getByRole("combobox", { name: "Provider" }).selectOption("licensed-futures");
    await expect.poll(() => slowRequested).toBe(true);
    await page.getByRole("combobox", { name: "Instrument" }).selectOption("23");
    await expect(page.getByRole("cell", { name: "333" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Provider" })).toHaveValue("");
    await expect(page.getByRole("combobox", { name: "Provider" }).getByRole("option", { name: "dxfeed" })).toHaveCount(1);
    releaseSlow?.();
    await page.waitForTimeout(100);
    await expect(page.getByRole("cell", { name: "333" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "999" })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Instrument" })).toHaveValue("23");
  });
});

async function prepare(page: Page, handler: (route: Route, url: URL) => Promise<unknown>) {
  await installDeterminism(page);
  await seedApprovedSession(page);
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    return url.pathname.includes("/market-data/instruments") ? handler(route, url) : route.fallback();
  });
}

function footprint(instrumentId: number, endAt: string, bid: string, ask: string) {
  return { id: Number(`${instrumentId}1`), instrument_id: instrumentId, contract_id: null, provider: "licensed-futures", interval_seconds: 300, start_at: "2026-09-15T10:24:00.000Z", end_at: endAt, tick_size: "0.25", bid_volume: bid, ask_volume: ask, unknown_volume: "0", total_volume: String(Number(bid) + Number(ask)), delta: String(Number(ask) - Number(bid)), trade_count: 9, average_trade_size: "37", complete: true, levels: [{ price: "6500.25", bid_volume: bid, ask_volume: ask, unknown_volume: "0", total_volume: String(Number(bid) + Number(ask)), delta: String(Number(ask) - Number(bid)), trade_count: 9, average_trade_size: "37" }] };
}

function json(route: Route, value: unknown) { return route.fulfill({ body: JSON.stringify(value), contentType: "application/json", status: 200 }); }
