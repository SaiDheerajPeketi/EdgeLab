import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { installJournalFixture, seedAccount, seedTrade } from "./support/compatibility-journal";
import { gotoStable } from "./support/app";

async function fixture(page: Page, info: TestInfo) {
  const state = await installJournalFixture(page);
  state.fallback = false;
  state.tradePage = [structuredClone(seedTrade),
    { ...structuredClone(seedTrade), id: seedTrade.id + 1, symbol: "EURUSD", side: "SHORT", net_pnl: -50, gross_pnl: -45,
      entry_time: "2026-09-15T10:00:00Z", exit_time: "2026-09-15T11:00:00Z" },
    { ...structuredClone(seedTrade), id: seedTrade.id + 2, symbol: "ETHUSDT", net_pnl: 55, gross_pnl: 60,
      entry_time: "2026-09-15T11:00:00Z", exit_time: "2026-09-15T12:00:00Z" }];
  await page.route("**/api/app-storage/**", route => route.fulfill({ json: {
    namespace: "edgelab", key: new URL(route.request().url()).pathname.split("/").at(-1),
    value: new URL(route.request().url()).pathname.endsWith("settings-center.v1") ? { appTheme: info.project.name.endsWith("light") ? "light" : "dark", density: "comfortable", includeDiagnosticsByDefault: true } : null,
    updated_at: "2026-09-15T10:30:00Z",
  } }));
  return state;
}
async function themed(page: Page, info: TestInfo) {
  await expect(page.locator("html")).toHaveAttribute("data-app-theme", info.project.name.endsWith("light") ? "light" : "dark");
}
async function evidence(page: Page, info: TestInfo, label: string) {
  await page.screenshot({ animations: "disabled", path: `.artifacts/dropdown-hover220/${info.project.name}-${label}.png` });
}
const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { errors.set(page, []); page.on("pageerror", error => errors.get(page)!.push(error.message)); });
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });

test("order flow themed dropdowns select by pointer and keyboard without native selects", async ({ page }, info) => {
  await fixture(page, info);
  const reads: string[] = [];
  const instrument = { id: 2201, canonical_symbol: "BTCUSDT", display_name: "Bitcoin", asset_class: "CRYPTO", instrument_type: "SPOT",
    exchange: "BINANCE", currency: "USDT", timezone: "UTC", tick_size: 0.01, active: true,
    identifiers: [{ provider: "binance", provider_symbol: "BTCUSDT" }] };
  await page.route("**/api/market-data/instruments**", route => {
    const url = new URL(route.request().url());
    reads.push(url.pathname + url.search);
    return route.fulfill({ json: url.pathname.endsWith("/footprints") ? [] : [instrument] });
  });
  await gotoStable(page, "/app/order-flow", { waitForNetworkIdle: false });
  await themed(page, info);
  const timeframe = page.getByRole("combobox", { name: "Timeframe", exact: true });
  await expect(timeframe).toHaveJSProperty("tagName", "BUTTON");
  await expect(timeframe).toHaveText("5m");
  await timeframe.click();
  const menu = page.getByRole("listbox", { name: "Timeframe", exact: true });
  await expect(menu).toBeVisible();
  const palette = await menu.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, text: getComputedStyle(element).color }));
  expect(palette.background).not.toBe("rgba(0, 0, 0, 0)");
  const channels = palette.background.match(/[\d.]+/g)!.slice(0, 3).map(Number);
  expect(channels.reduce((sum, value) => sum + value, 0) / 3)[info.project.name === "light" ? "toBeGreaterThan" : "toBeLessThan"](128);
  await evidence(page, info, "timeframe-menu");
  await menu.getByRole("option", { name: "15m", exact: true }).click();
  await expect(timeframe).toHaveText("15m");
  await expect.poll(() => reads.some(url => url.includes("interval_seconds=900"))).toBe(true);
  await timeframe.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(timeframe).toHaveText("1h");
  await expect(timeframe).toBeFocused();
  await expect.poll(() => reads.some(url => url.includes("interval_seconds=3600"))).toBe(true);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Home");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(timeframe).toHaveText("1h");
  const provider = page.getByRole("combobox", { name: "Provider", exact: true });
  await provider.focus();
  await page.keyboard.press("b");
  await page.keyboard.press("Enter");
  await expect(provider).toHaveText("binance");
  await expect.poll(() => reads.some(url => url.includes("provider=binance"))).toBe(true);
  await expect(page.locator('[aria-label="Order-flow source"] select')).toHaveCount(0);
});

test("journal equity hover and keyboard expose exact balance and trade values", async ({ page }, info) => {
  await fixture(page, info);
  await gotoStable(page, "/app/journal/dashboard", { waitForNetworkIdle: false });
  await themed(page, info);
  const chart = page.getByRole("group", { name: "Journal equity curve", exact: true });
  await expect(chart).toBeVisible();
  await chart.scrollIntoViewIfNeeded();
  await chart.focus();
  await page.keyboard.press("Home");
  const tooltip = page.locator("[data-journal-equity-tooltip]");
  await expect(tooltip).toContainText("25,195.00");
  await expect(tooltip).toContainText(String(seedTrade.id));
  await page.keyboard.press("ArrowRight");
  await expect(tooltip).toContainText("25,145.00");
  await expect(tooltip).toContainText(String(seedTrade.id + 1));
  await page.keyboard.press("End");
  await expect(tooltip).toContainText("25,200.00");
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
  const plot = chart.locator("svg");
  const box = await plot.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(tooltip).toContainText("25,145.00");
  await expect(tooltip).toContainText(String(seedTrade.id + 1));
  await evidence(page, info, "equity-hover-value");
  await page.mouse.move(1, 1);
});

test("journal donut hover and keyboard show exact counts and preserve legend filtering", async ({ page }, info) => {
  await fixture(page, info);
  await gotoStable(page, "/app/journal/analytics", { waitForNetworkIdle: false });
  await themed(page, info);
  const chart = page.getByRole("group", { name: "By market distribution", exact: true });
  await chart.scrollIntoViewIfNeeded();
  const crypto = chart.getByRole("button", { name: "Inspect Crypto: 2 trades, 66.7%", exact: true });
  const forex = chart.getByRole("button", { name: "Inspect Forex: 1 trades, 33.3%", exact: true });
  await crypto.focus();
  const tooltip = page.locator("[data-journal-mix-tooltip]");
  await expect(tooltip).toContainText("Crypto");
  await expect(tooltip).toContainText("2 trades");
  await expect(tooltip).toContainText("66.7%");
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await expect(forex).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(tooltip).toContainText("Forex");
  await expect(tooltip).toContainText("33.3%");
  await page.locator("#workspace-content").focus();
  // Segment paths overlap by bounding box: locate a genuine painted point for pointer hit testing.
  const target = await crypto.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    for (let y = bounds.top; y < bounds.bottom; y += 2) for (let x = bounds.left; x < bounds.right; x += 2) {
      if (document.elementFromPoint(x, y) === element) return { x, y };
    }
    throw Error("No painted segment point is reachable");
  });
  await page.mouse.move(target.x, target.y);
  await expect(tooltip).toContainText("Crypto");
  await expect(tooltip).toContainText("66.7%");
  await evidence(page, info, "donut-hover-value");
  await page.getByRole("button", { name: /^Crypto\s*2/ }).click();
  await expect(chart.getByRole("button", { name: "Inspect Crypto: 2 trades, 100.0%", exact: true })).toBeVisible();
  await expect(chart.getByRole("button", { name: /Inspect Forex/ })).toHaveCount(0);
});

async function choose(page: Page, name: string, label: string, touch = false) {
  const control = page.getByRole("combobox", { name, exact: true });
  await expect(control).toHaveJSProperty("tagName", "BUTTON");
  await control.scrollIntoViewIfNeeded();
  if (touch) await control.tap(); else await control.click();
  const menu = page.getByRole("listbox", { name, exact: true });
  await expect(menu).toBeVisible();
  await withinViewport(menu);
  const option = menu.getByRole("option", { name: label, exact: true });
  if (touch) await option.tap(); else await option.click();
  await expect(control).toHaveText(label);
}
async function withinViewport(element: Locator) {
  const box = await element.boundingBox();
  const viewport = element.page().viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
}
async function paintedPoint(element: Locator) {
  return element.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    for (let y = Math.max(0, bounds.top); y < Math.min(innerHeight, bounds.bottom); y += 2)
      for (let x = Math.max(0, bounds.left); x < Math.min(innerWidth, bounds.right); x += 2)
        if (document.elementFromPoint(x, y) === element) return { x, y };
    throw Error("No painted segment point is reachable");
  });
}

test("journal filter choices and sorting retain exact result state after reload", async ({ page }, info) => {
  await fixture(page, info);
  await gotoStable(page, "/app/journal/trades", { waitForNetworkIdle: false });
  await themed(page, info);
  await page.getByText("Analytics filters", { exact: true }).click();
  await choose(page, "Market", "Crypto");
  const rows = page.getByRole("table", { name: "Journal trades", exact: true }).locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await choose(page, "Sort", "Net P&L high");
  await expect(rows.nth(0)).toContainText("BTCUSDT");
  await expect(rows.nth(1)).toContainText("ETHUSDT");
  const sort = page.getByRole("combobox", { name: "Sort", exact: true });
  await sort.focus(); await page.keyboard.press("ArrowDown"); await page.keyboard.press("End"); await page.keyboard.press("Enter");
  await expect(sort).toHaveText("Net P&L low");
  await expect(rows.nth(0)).toContainText("ETHUSDT");
  await expect(rows.nth(1)).toContainText("BTCUSDT");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(sort).toHaveText("Net P&L low");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("ETHUSDT");
  await page.getByText("Analytics filters", { exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Market", exact: true })).toHaveText("Crypto");
  await choose(page, "Symbol", "BTCUSDT");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("BTCUSDT");
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("EURUSD");
  await evidence(page, info, "journal-filter-sort");
});

test("CSV import choices preserve destination grouping and implicit header mapping", async ({ page }, info) => {
  const state = await fixture(page, info);
  const second = { ...seedAccount, id: seedAccount.id + 1, name: "Import destination", currency: "EUR", timezone: "Europe/Berlin" };
  state.accounts.push(second);
  const writes: any[] = [], runs: any[] = [];
  const csv = "entry_time,side,entry_price,quantity,symbol,Fill Group,Comment\n2026-09-15T09:00:00Z,LONG,100,1,ES,group-a,kept note\n";
  await page.route("**/api/journal/imports", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: runs });
    const payload = route.request().postDataJSON(); writes.push(payload);
    const run = { id: 2201, account_id: payload.destination_account_id, source_name: payload.source_name, status: "COMPLETED",
      source_timezone: payload.source_timezone, currency: payload.currency, default_symbol: payload.default_symbol,
      column_mapping: payload.column_mapping, grouping: payload.grouping, source_digest: "fixture220",
      detected_columns: csv.split("\n")[0].split(","), total_rows: 1, imported_rows: 1, skipped_rows: 0,
      duplicate_rows: 0, error_rows: 0, created_at: "2026-09-15T10:30:00Z", completed_at: "2026-09-15T10:30:00Z", rolled_back_at: null, rows: [], diagnostics: [] };
    runs.push(run); return route.fulfill({ json: { run, trades: [] } });
  });
  await gotoStable(page, "/app/journal/accounts", { waitForNetworkIdle: false });
  await themed(page, info);
  const flow = page.locator('section[aria-labelledby="journal-import-title"]');
  await flow.getByRole("button", { name: "Import CSV", exact: true }).click();
  await choose(page, "Broker export guide", "Tradovate");
  await expect(flow).toContainText("Export Orders, not Performance.");
  await flow.getByLabel("CSV export file", { exact: true }).setInputFiles({ name: "mapped220.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await choose(page, "Destination", "Create account");
  await flow.getByLabel("New account name", { exact: true }).fill("Retained draft");
  await choose(page, "Destination", "Existing account");
  await choose(page, "Account", "Import destination · EUR");
  await expect(flow.getByLabel("Currency", { exact: true })).toHaveValue("EUR");
  await expect(flow.getByLabel("Source time zone", { exact: true })).toHaveValue("Europe/Berlin");
  await flow.getByRole("button", { name: "Review mapping", exact: true }).click();
  await choose(page, "Trade grouping", "Group fills by a column");
  // These header options intentionally omit HTML value; text must remain the submitted value.
  await choose(page, "Grouping column", "Fill Group");
  await choose(page, "Comment", "notes");
  await expect(page.getByRole("combobox", { name: "entry_time", exact: true })).toHaveText("entry time");
  await flow.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Account", exact: true })).toHaveText("Import destination · EUR");
  await flow.getByRole("button", { name: "Review mapping", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Grouping column", exact: true })).toHaveText("Fill Group");
  await expect(page.getByRole("combobox", { name: "Comment", exact: true })).toHaveText("notes");
  await evidence(page, info, "csv-mapping-retained");
  await flow.getByRole("button", { name: "Import", exact: true }).click();
  await expect(flow.getByText("Import complete", { exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ destination_account_id: second.id, currency: "EUR", source_timezone: "Europe/Berlin",
    source_name: "mapped220.csv", csv_text: csv, grouping: { mode: "COLUMN", column: "Fill Group" },
    column_mapping: { entry_time: "entry_time", side: "side", entry_price: "entry_price", quantity: "quantity", symbol: "symbol", Comment: "notes" } });
});

test("mobile touch dropdown equity and donut stay within the 390px viewport", async ({ page }, info) => {
  await fixture(page, info);
  await gotoStable(page, "/app/journal/dashboard", { waitForNetworkIdle: false });
  await themed(page, info);
  const scope = page.getByRole("combobox", { name: "Account scope", exact: true });
  await scope.tap();
  const menu = page.getByRole("listbox", { name: "Account scope", exact: true });
  await expect(menu).toBeVisible(); await withinViewport(menu);
  await evidence(page, info, "touch-dropdown");
  await menu.getByRole("option", { name: "UIR-83 seed account · USD", exact: true }).tap();
  await expect(scope).toHaveText("UIR-83 seed account · USD");
  const chart = page.getByRole("group", { name: "Journal equity curve", exact: true });
  await chart.scrollIntoViewIfNeeded();
  const box = await chart.locator("svg").boundingBox();
  await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
  const equityValue = page.locator("[data-journal-equity-tooltip]");
  await expect(equityValue).toContainText("25,145.00"); await expect(equityValue).toContainText(String(seedTrade.id + 1));
  await withinViewport(equityValue);
  const equityBox = (await equityValue.boundingBox())!, chartBox = (await chart.boundingBox())!;
  expect(equityBox.x).toBeGreaterThanOrEqual(chartBox.x);
  expect(equityBox.x + equityBox.width).toBeLessThanOrEqual(chartBox.x + chartBox.width);
  await evidence(page, info, "touch-equity");
  await gotoStable(page, "/app/journal/analytics", { waitForNetworkIdle: false });
  const ring = page.getByRole("group", { name: "By market distribution", exact: true });
  await ring.scrollIntoViewIfNeeded();
  const point = await paintedPoint(ring.getByRole("button", { name: "Inspect Crypto: 2 trades, 66.7%", exact: true }));
  await page.touchscreen.tap(point.x, point.y);
  const value = page.locator("[data-journal-mix-tooltip]");
  await expect(value).toContainText("Crypto"); await expect(value).toContainText("2 trades"); await expect(value).toContainText("66.7%");
  await withinViewport(page.getByRole("tooltip"));
  await expect(ring.getByRole("button", { name: /Inspect Forex/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await evidence(page, info, "touch-donut");
});
